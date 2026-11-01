import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { canaryBusinessDate } from '@2j/domain';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { isoWeekday } from '../src/training-member.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: training member tests cannot be skipped.');
process.env.NODE_ENV ??= 'test';
const sql = postgres(process.env.DATABASE_URL, { max: 8, connect_timeout: 5 });
await migrateDatabase(sql);

const now = new Date();
const today = canaryBusinessDate(now);
const weekday = isoWeekday(today);
const otherWeekday = weekday === 7 ? 1 : weekday + 1;
const admin = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'training-member-test-admin', role: 'admin' }) });

async function makeClient(name) {
  const id = randomUUID();
  await sql`INSERT INTO clients(id,first_name,last_name,status) VALUES (${id}::uuid,${name},'Training slice test','active')`;
  return id;
}

/** Entitlement through Platform's own plan and assignment path, the same one the membership gates read. */
async function entitle(clientId) {
  const [area] = await sql`SELECT id FROM areas WHERE status='active' ORDER BY id LIMIT 1`;
  const service = (await admin.inject({ method: 'POST', url: '/api/services', payload: { name: `Training slice ${randomUUID()}`, areaId: area.id, status: 'active' } })).json();
  const plan = await admin.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': randomUUID() }, payload: {
    name: `Training slice plan ${randomUUID()}`, serviceIds: [service.id], kind: 'session_pack', renewalCadence: null, basePriceCents: 1000,
    modules: [{ module: 'training', accessLevel: 'full', capabilities: [] }],
    rights: [{ rightType: 'service_access', serviceId: service.id }, { rightType: 'sessions_quota', serviceId: service.id, quotaScope: 'per_service', quantity: 10 }, { rightType: 'training_access', trainingAccessLevel: 'full' }],
  } });
  assert.equal(plan.statusCode, 201, plan.body);
  assert.equal((await admin.inject({ method: 'POST', url: `/api/plans/${plan.json().id}/activate`, payload: {} })).statusCode, 200);
  const sale = await admin.inject({ method: 'POST', url: `/api/clients/${clientId}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: { planId: plan.json().id, startsOn: today, dueOn: today, amountCents: 1000 } });
  assert.equal(sale.statusCode, 201, sale.body);
  const [charge] = await sql`INSERT INTO economic_charges(client_id,plan_id,concept,amount_cents,due_on,state,exempt_reason,created_by,idempotency_key,request_hash)
    VALUES (${clientId}::uuid,${plan.json().id},'Training slice fixture',1000,${today}::date,'exempt','Synthetic API fixture','training-member-test',${randomUUID()}::uuid,${'c'.repeat(64)}) RETURNING id`;
  await sql`INSERT INTO client_plan_assignments(client_id,plan_id,plan_version,charge_id,starts_on,status,idempotency_key,request_hash,created_by,sale_price_cents,snapshot)
    VALUES (${clientId}::uuid,${plan.json().id},1,${charge.id},${today}::date,'active',${randomUUID()}::uuid,${'d'.repeat(64)},'training-member-test',1000,'{}'::jsonb)`;
}

async function addRoutine(clientId, { weekdays, name = 'Fuerza A' }) {
  const [routine] = await sql`INSERT INTO training_routines(client_id,name,scheduled_weekdays) VALUES (${clientId}::uuid,${name},${weekdays}::smallint[]) RETURNING id`;
  await sql`INSERT INTO training_routine_exercises(routine_id,position,exercise_name,target_sets) VALUES
    (${routine.id}::uuid,1,'Sentadilla',3),(${routine.id}::uuid,2,'Press banca',3)`;
  return String(routine.id);
}

const appFor = clientId => buildServer(process.env.DATABASE_URL, {
  clientAuthorizationResolver: async () => ({ clientId }),
  memberNowProvider: () => now,
});

const entitled = await makeClient('Ada');
const restDay = await makeClient('Bea');
const blocked = await makeClient('Celia');
const other = await makeClient('Dalia');
await entitle(entitled); await entitle(restDay); await entitle(other);
const routineId = await addRoutine(entitled, { weekdays: [weekday] });
await addRoutine(restDay, { weekdays: [otherWeekday] });
await addRoutine(blocked, { weekdays: [weekday] });
const appEntitled = appFor(entitled); const appRest = appFor(restDay); const appBlocked = appFor(blocked); const appOther = appFor(other);

after(async () => {
  await Promise.all([admin.close(), appEntitled.close(), appRest.close(), appBlocked.close(), appOther.close()]);
  await sql.end();
});

const json = (response) => response.json();

test('Inicio shows today\'s routine for an entitled member and a rest day otherwise', async () => {
  const today = await appEntitled.inject({ method: 'GET', url: '/api/me/training/today' });
  assert.equal(today.statusCode, 200, today.body);
  assert.equal(json(today).status, 'training_day');
  assert.equal(json(today).routine.id, routineId);
  assert.deepEqual(json(today).routine.exercises.map(exercise => exercise.exerciseName), ['Sentadilla', 'Press banca']);
  const rest = await appRest.inject({ method: 'GET', url: '/api/me/training/today' });
  assert.equal(rest.statusCode, 200, rest.body);
  assert.equal(json(rest).status, 'rest_day');
});

test('starting a session creates one open session and resumes it on a second start', async () => {
  const first = await appEntitled.inject({ method: 'POST', url: '/api/me/training/sessions', payload: {} });
  assert.equal(first.statusCode, 201, first.body);
  const sessionId = json(first).session.id;
  assert.equal(json(first).session.routineId, routineId);
  const again = await appEntitled.inject({ method: 'POST', url: '/api/me/training/sessions', payload: {} });
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(json(again).session.id, sessionId);
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM training_sessions WHERE client_id=${entitled}::uuid AND status='in_progress'`;
  assert.equal(count, 1);
});

test('saving sets stores reps, weight and RIR, updates an existing set, and rejects invalid input', async () => {
  const [session] = await sql`SELECT id FROM training_sessions WHERE client_id=${entitled}::uuid AND status='in_progress'`;
  const url = `/api/me/training/sessions/${session.id}/sets`;
  const saved = await appEntitled.inject({ method: 'POST', url, payload: { exerciseName: 'Sentadilla', setIndex: 1, reps: 8, weightKg: 80, rir: 2 } });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(json(saved).set, { exerciseName: 'Sentadilla', setIndex: 1, reps: 8, weightKg: 80, rir: 2 });
  const corrected = await appEntitled.inject({ method: 'POST', url, payload: { exerciseName: 'Sentadilla', setIndex: 1, reps: 9, weightKg: 82.5 } });
  assert.equal(corrected.statusCode, 200, corrected.body);
  assert.equal(json(corrected).set.reps, 9); assert.equal(json(corrected).set.rir, null);
  const rows = await sql`SELECT count(*)::int AS count FROM training_session_sets WHERE session_id=${session.id}::uuid`;
  assert.equal(rows[0].count, 1);
  assert.equal((await appEntitled.inject({ method: 'POST', url, payload: { exerciseName: 'Sentadilla', setIndex: 2, reps: 101, weightKg: 80 } })).statusCode, 400);
  assert.equal((await appEntitled.inject({ method: 'POST', url, payload: { exerciseName: 'Sentadilla', setIndex: 2, reps: 5, weightKg: 80, unexpected: true } })).statusCode, 400);
});

test('finishing a session requires at least one saved set and then closes it', async () => {
  const [session] = await sql`SELECT id FROM training_sessions WHERE client_id=${entitled}::uuid AND status='in_progress'`;
  await appEntitled.inject({ method: 'POST', url: `/api/me/training/sessions/${session.id}/sets`, payload: { exerciseName: 'Press banca', setIndex: 1, reps: 6, weightKg: 60, rir: 1 } });
  const finished = await appEntitled.inject({ method: 'POST', url: `/api/me/training/sessions/${session.id}/finish`, payload: {} });
  assert.equal(finished.statusCode, 200, finished.body);
  assert.equal(json(finished).session.status, 'finished');
  const late = await appEntitled.inject({ method: 'POST', url: `/api/me/training/sessions/${session.id}/sets`, payload: { exerciseName: 'Sentadilla', setIndex: 3, reps: 8, weightKg: 80 } });
  assert.equal(late.statusCode, 409, late.body);
  assert.equal(json(late).error, 'session_not_open');
  const empty = await appOther.inject({ method: 'POST', url: '/api/me/training/sessions', payload: {} });
  assert.equal(empty.statusCode, 409, empty.body);
  assert.equal(json(empty).error, 'no_routine_today');
});

test('history order lists finished sessions newest first with their sets grouped by exercise', async () => {
  const older = await sql`INSERT INTO training_sessions(client_id,routine_id,status,business_date,started_at,finished_at)
    VALUES (${entitled}::uuid,${routineId}::uuid,'finished',${today}::date,now() - interval '3 days',now() - interval '3 days' + interval '1 hour') RETURNING id`;
  await sql`INSERT INTO training_session_sets(session_id,exercise_name,set_index,reps,weight_kg,rir) VALUES (${older[0].id}::uuid,'Sentadilla',1,5,70,3)`;
  const history = await appEntitled.inject({ method: 'GET', url: '/api/me/training/history' });
  assert.equal(history.statusCode, 200, history.body);
  const sessions = json(history).sessions;
  assert.equal(sessions.length, 2);
  assert.ok(sessions[0].startedAt > sessions[1].startedAt, 'newest session first');
  // La sesión más reciente es la de las pruebas anteriores: Sentadilla (serie 1, corregida) y Press banca (serie 1).
  assert.equal(sessions[0].setCount, 2);
  assert.deepEqual(sessions[0].exercises.map(exercise => exercise.exerciseName), ['Press banca', 'Sentadilla']);
  assert.equal(sessions[1].exercises[0].sets[0].weightKg, 70);
  assert.equal(sessions[1].routineName, 'Fuerza A');
});

test('access blocked without entitlement: every training screen answers with the reason and the action, and nothing is written', async () => {
  for (const [method, url] of [['GET', '/api/me/training/today'], ['POST', '/api/me/training/sessions'], ['GET', '/api/me/training/history']]) {
    const response = await appBlocked.inject({ method, url, payload: method === 'POST' ? {} : undefined });
    assert.equal(response.statusCode, 403, `${method} ${url}: ${response.body}`);
    assert.deepEqual(json(response), { error: 'training_entitlement_required', reason: 'entitlement_required', action: 'contact_front_desk' });
  }
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM training_sessions WHERE client_id=${blocked}::uuid`;
  assert.equal(count, 0);
});

test('a member cannot read or write another member\'s session', async () => {
  const [session] = await sql`SELECT id FROM training_sessions WHERE client_id=${entitled}::uuid ORDER BY started_at DESC LIMIT 1`;
  assert.equal((await appOther.inject({ method: 'POST', url: `/api/me/training/sessions/${session.id}/sets`, payload: { exerciseName: 'Sentadilla', setIndex: 1, reps: 1, weightKg: 1 } })).statusCode, 404);
  assert.equal((await appOther.inject({ method: 'POST', url: `/api/me/training/sessions/${session.id}/finish`, payload: {} })).statusCode, 404);
});
