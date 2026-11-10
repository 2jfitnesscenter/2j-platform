import { after, before, describe, test } from 'node:test';
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
async function entitle(clientId, { training = true, startsOn = today, endsOn = null } = {}) {
  const [area] = await sql`SELECT id FROM areas WHERE status='active' ORDER BY id LIMIT 1`;
  const service = (await admin.inject({ method: 'POST', url: '/api/services', payload: { name: `Training slice ${randomUUID()}`, areaId: area.id, status: 'active' } })).json();
  const rights = [{ rightType: 'service_access', serviceId: service.id }, { rightType: 'sessions_quota', serviceId: service.id, quotaScope: 'per_service', quantity: 10 }];
  if (training) rights.push({ rightType: 'training_access', trainingAccessLevel: 'full' });
  const plan = await admin.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': randomUUID() }, payload: {
    name: `Training slice plan ${randomUUID()}`, serviceIds: [service.id], kind: 'session_pack', renewalCadence: null, basePriceCents: 1000,
    modules: [{ module: 'training', accessLevel: 'full', capabilities: [] }],
    rights,
  } });
  assert.equal(plan.statusCode, 201, plan.body);
  assert.equal((await admin.inject({ method: 'POST', url: `/api/plans/${plan.json().id}/activate`, payload: {} })).statusCode, 200);
  const sale = await admin.inject({ method: 'POST', url: `/api/clients/${clientId}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: { planId: plan.json().id, startsOn: today, dueOn: today, amountCents: 1000 } });
  assert.equal(sale.statusCode, 201, sale.body);
  const [charge] = await sql`INSERT INTO economic_charges(client_id,plan_id,concept,amount_cents,due_on,state,exempt_reason,created_by,idempotency_key,request_hash)
    VALUES (${clientId}::uuid,${plan.json().id},'Training slice fixture',1000,${today}::date,'exempt','Synthetic API fixture','training-member-test',${randomUUID()}::uuid,${'c'.repeat(64)}) RETURNING id`;
  await sql`INSERT INTO client_plan_assignments(client_id,plan_id,plan_version,charge_id,starts_on,ends_on,status,idempotency_key,request_hash,created_by,sale_price_cents,snapshot)
    VALUES (${clientId}::uuid,${plan.json().id},1,${charge.id},${startsOn}::date,${endsOn}::date,'active',${randomUUID()}::uuid,${'d'.repeat(64)},'training-member-test',1000,'{}'::jsonb)`;
}

const daysFromToday = offset => canaryBusinessDate(new Date(now.getTime() + offset * 86_400_000));

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
  assert.deepEqual(json(saved).set, { exerciseName: 'Sentadilla', setIndex: 1, setType: 'work', done: true, reps: 8, weightKg: 80, rir: 2, rpe: null, feel: null, seconds: null, minutes: null, speedKmh: null });
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

describe("follow-up hardening", () => {
const anonymous = buildServer(process.env.DATABASE_URL, {});
after(async () => {
  await Promise.all([anonymous.close(), appNoSets.close(), appNoRight.close(), appExpired.close(), appPrevious.close()]);
});
let noSetsClient; let noRightClient; let expiredClient; let previousClient; let previousRoutine; let appNoSets; let appNoRight; let appExpired; let appPrevious;
// Preparación en before(): los tests se ejecutan en cuanto se registran, y un await de nivel superior aún pendiente cerraría la base antes de tiempo.
before(async () => {
  noSetsClient = await makeClient('Eva'); await entitle(noSetsClient); await addRoutine(noSetsClient, { weekdays: [weekday] });
  noRightClient = await makeClient('Fara'); await entitle(noRightClient, { training: false }); await addRoutine(noRightClient, { weekdays: [weekday] });
  expiredClient = await makeClient('Gala'); await entitle(expiredClient, { startsOn: daysFromToday(-3), endsOn: daysFromToday(-1) }); await addRoutine(expiredClient, { weekdays: [weekday] });
  previousClient = await makeClient('Hana'); await entitle(previousClient); previousRoutine = await addRoutine(previousClient, { weekdays: [weekday] });
  appNoSets = appFor(noSetsClient); appNoRight = appFor(noRightClient); appExpired = appFor(expiredClient); appPrevious = appFor(previousClient);
});

test('finishing an empty session answers no_sets_logged and keeps the session open', async () => {
  assert.equal((await appNoSets.inject({ method: 'POST', url: '/api/me/training/sessions', payload: {} })).statusCode, 201);
  const [session] = await sql`SELECT id FROM training_sessions WHERE client_id=${noSetsClient}::uuid AND status='in_progress'`;
  const finish = await appNoSets.inject({ method: 'POST', url: `/api/me/training/sessions/${session.id}/finish`, payload: {} });
  assert.equal(finish.statusCode, 409, finish.body);
  assert.equal(json(finish).error, 'no_sets_logged');
  const [{ status }] = await sql`SELECT status FROM training_sessions WHERE id=${session.id}::uuid`;
  assert.equal(status, 'in_progress');
});

test('a second finish is idempotent, keeps the first finish time, and refuses later sets', async () => {
  const [session] = await sql`SELECT id FROM training_sessions WHERE client_id=${noSetsClient}::uuid AND status='in_progress'`;
  assert.equal((await appNoSets.inject({ method: 'POST', url: `/api/me/training/sessions/${session.id}/sets`, payload: { exerciseName: 'Sentadilla', setIndex: 1, reps: 8, weightKg: 80 } })).statusCode, 200);
  assert.equal((await appNoSets.inject({ method: 'POST', url: `/api/me/training/sessions/${session.id}/finish`, payload: {} })).statusCode, 200);
  const [first] = await sql`SELECT finished_at FROM training_sessions WHERE id=${session.id}::uuid`;
  const again = await appNoSets.inject({ method: 'POST', url: `/api/me/training/sessions/${session.id}/finish`, payload: {} });
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(json(again).session.status, 'finished');
  const [second] = await sql`SELECT finished_at FROM training_sessions WHERE id=${session.id}::uuid`;
  assert.equal(second.finished_at.getTime(), first.finished_at.getTime());
  const late = await appNoSets.inject({ method: 'POST', url: `/api/me/training/sessions/${session.id}/sets`, payload: { exerciseName: 'Press banca', setIndex: 1, reps: 5, weightKg: 60 } });
  assert.equal(late.statusCode, 409);
  assert.equal(json(late).error, 'session_not_open');
});

test('a plan without training_access blocks every training screen and reports no entitlement', async () => {
  for (const [method, url] of [['GET', '/api/me/training/today'], ['POST', '/api/me/training/sessions'], ['GET', '/api/me/training/history']]) {
    const response = await appNoRight.inject({ method, url, payload: method === 'POST' ? {} : undefined });
    assert.equal(response.statusCode, 403, `${method} ${url}: ${response.body}`);
    assert.equal(json(response).reason, 'entitlement_required');
  }
  assert.deepEqual(json(await appNoRight.inject({ method: 'GET', url: '/api/me/training/access' })), { entitled: false });
});

test('an expired plan blocks training even with a routine scheduled today', async () => {
  const response = await appExpired.inject({ method: 'GET', url: '/api/me/training/today' });
  assert.equal(response.statusCode, 403, response.body);
  assert.equal(json(response).error, 'training_entitlement_required');
});

test('training requests without client authentication answer 401', async () => {
  for (const [method, url] of [['GET', '/api/me/training/today'], ['POST', '/api/me/training/sessions'], ['GET', '/api/me/training/history'], ['GET', '/api/me/training/access']]) {
    const response = await anonymous.inject({ method, url, payload: method === 'POST' ? {} : undefined });
    assert.equal(response.statusCode, 401, `${method} ${url}: ${response.body}`);
  }
});

test('history isolation: a member never sees another member sessions', async () => {
  const mine = await sql`SELECT id FROM training_sessions WHERE client_id=${entitled}::uuid AND status='finished'`;
  assert.ok(mine.length > 0);
  const theirs = json(await appOther.inject({ method: 'GET', url: '/api/me/training/history' })).sessions.map(session => session.id);
  for (const row of mine) assert.equal(theirs.includes(String(row.id)), false);
});

test('an open session from a previous day is abandoned at day change and never resumed', async () => {
  const [old] = await sql`INSERT INTO training_sessions(client_id,routine_id,status,business_date,started_at)
    VALUES (${previousClient}::uuid,${previousRoutine}::uuid,'in_progress',${daysFromToday(-1)}::date,now() - interval '1 day') RETURNING id`;
  const started = await appPrevious.inject({ method: 'POST', url: '/api/me/training/sessions', payload: {} });
  assert.equal(started.statusCode, 201, started.body);
  assert.notEqual(json(started).session.id, String(old.id));
  const [{ status, finished_at: finishedAt }] = await sql`SELECT status, finished_at FROM training_sessions WHERE id=${old.id}::uuid`;
  assert.equal(status, 'abandoned');
  assert.equal(finishedAt, null);
  const today = json(await appPrevious.inject({ method: 'GET', url: '/api/me/training/today' }));
  assert.equal(today.openSessionId, json(started).session.id);
});

test('weight is rounded to two decimals and out-of-range weights are rejected', async () => {
  const started = await appEntitled.inject({ method: 'POST', url: '/api/me/training/sessions', payload: {} });
  const sessionId = json(started).session.id;
  const url = `/api/me/training/sessions/${sessionId}/sets`;
  const rounded = await appEntitled.inject({ method: 'POST', url, payload: { exerciseName: 'Sentadilla', setIndex: 4, reps: 5, weightKg: 82.554 } });
  assert.equal(rounded.statusCode, 200, rounded.body);
  assert.equal(json(rounded).set.weightKg, 82.55);
  assert.equal((await appEntitled.inject({ method: 'POST', url, payload: { exerciseName: 'Sentadilla', setIndex: 5, reps: 5, weightKg: 1000.01 } })).statusCode, 400);
  assert.equal((await appEntitled.inject({ method: 'POST', url, payload: { exerciseName: 'Sentadilla', setIndex: 5, reps: 5, weightKg: -1 } })).statusCode, 400);
});

test('the access endpoint tells the home card whether the member is entitled, without revealing routines', async () => {
  assert.deepEqual(json(await appEntitled.inject({ method: 'GET', url: '/api/me/training/access' })), { entitled: true });
  assert.deepEqual(json(await appBlocked.inject({ method: 'GET', url: '/api/me/training/access' })), { entitled: false });
});
});

test('routines: create with exercises, replace the list, default fields, and archive', async () => {
  const created = await appOther.inject({ method: 'POST', url: '/api/me/training/routines', payload: { name: 'Cardio y fuerza', scheduledWeekdays: [weekday, weekday],
    exercises: [{ exerciseName: 'Bici', mode: 'cardio', targetSets: 1, target: { minutes: 20 } }, { exerciseName: 'Sentadilla', targetSets: 4, supersetGroup: 'A', progressionPolicy: 'linear' }] } });
  assert.equal(created.statusCode, 201, created.body);
  const routine = json(created).routine;
  assert.deepEqual(routine.scheduledWeekdays, [weekday]);
  assert.deepEqual(routine.exercises.map(exercise => [exercise.position, exercise.exerciseName, exercise.mode]), [[1, 'Bici', 'cardio'], [2, 'Sentadilla', 'reps']]);
  assert.deepEqual(routine.exercises[0].target, { minutes: 20 });
  assert.equal(routine.exercises[1].supersetGroup, 'A');
  assert.equal(routine.exercises[1].progressionPolicy, 'linear');
  const listed = json(await appOther.inject({ method: 'GET', url: '/api/me/training/routines' }));
  assert.ok(listed.routines.some(item => item.id === routine.id));
  const replaced = await appOther.inject({ method: 'PATCH', url: `/api/me/training/routines/${routine.id}`, payload: { exercises: [{ exerciseName: 'Press banca' }] } });
  assert.equal(replaced.statusCode, 200, replaced.body);
  assert.deepEqual(json(replaced).routine.exercises.map(exercise => [exercise.position, exercise.exerciseName, exercise.targetSets, exercise.mode]), [[1, 'Press banca', 3, 'reps']]);
  assert.equal(json(replaced).routine.scheduledWeekdays[0], weekday);
  const archived = await appOther.inject({ method: 'PATCH', url: `/api/me/training/routines/${routine.id}`, payload: { status: 'archived' } });
  assert.equal(archived.statusCode, 200, archived.body);
  assert.equal(json(archived).routine.status, 'archived');
  assert.equal((await appOther.inject({ method: 'POST', url: '/api/me/training/routines', payload: { name: 'X', exercises: [{ exerciseName: 'Remo', mode: 'bogus' }] } })).statusCode, 400);
  assert.equal((await appOther.inject({ method: 'PATCH', url: `/api/me/training/routines/${routine.id}`, payload: {} })).statusCode, 400);
  assert.equal((await appOther.inject({ method: 'PATCH', url: `/api/me/training/routines/${randomUUID()}`, payload: { name: 'Nada' } })).statusCode, 404);
  assert.equal((await appBlocked.inject({ method: 'GET', url: '/api/me/training/routines' })).statusCode, 403);
});

test('sets: time, cardio, undone and warmup sets are stored and only work sets close a session', async () => {
  const fran = await makeClient('Fran');
  await entitle(fran);
  await addRoutine(fran, { weekdays: [weekday] });
  const appFran = appFor(fran);
  try {
  const started = await appFran.inject({ method: 'POST', url: '/api/me/training/sessions', payload: {} });
  assert.equal(started.statusCode, 201, started.body);
  const sessionId = json(started).session.id;
  const url = `/api/me/training/sessions/${sessionId}/sets`;
  assert.equal((await appFran.inject({ method: 'POST', url, payload: { exerciseName: 'Press banca', setIndex: 1, setType: 'warmup', reps: 10, weightKg: 20 } })).statusCode, 200);
  const warmupOnly = await appFran.inject({ method: 'POST', url: `/api/me/training/sessions/${sessionId}/finish`, payload: {} });
  assert.equal(warmupOnly.statusCode, 409, warmupOnly.body);
  assert.equal(json(warmupOnly).error, 'no_sets_logged');
  const plank = await appFran.inject({ method: 'POST', url, payload: { exerciseName: 'Plancha', setIndex: 1, seconds: 45, feel: 'good' } });
  assert.equal(plank.statusCode, 200, plank.body);
  assert.equal(json(plank).set.seconds, 45); assert.equal(json(plank).set.reps, null); assert.equal(json(plank).set.feel, 'good');
  const bike = await appFran.inject({ method: 'POST', url, payload: { exerciseName: 'Bici', setIndex: 1, minutes: 20, speedKmh: 12.5 } });
  assert.equal(bike.statusCode, 200, bike.body);
  assert.equal(json(bike).set.minutes, 20); assert.equal(json(bike).set.speedKmh, 12.5);
  assert.equal((await appFran.inject({ method: 'POST', url, payload: { exerciseName: 'Remo', setIndex: 1 } })).statusCode, 400);
  assert.equal((await appFran.inject({ method: 'POST', url, payload: { exerciseName: 'Remo', setIndex: 1, reps: 8, rir: 1.3 } })).statusCode, 400);
  const undone = await appFran.inject({ method: 'POST', url, payload: { exerciseName: 'Press banca', setIndex: 2, reps: 6, weightKg: 60, rir: 1.5, rpe: 8.5, done: false } });
  assert.equal(undone.statusCode, 200, undone.body);
  assert.equal(json(undone).set.done, false); assert.equal(json(undone).set.rir, 1.5); assert.equal(json(undone).set.rpe, 8.5);
  const finished = await appFran.inject({ method: 'POST', url: `/api/me/training/sessions/${sessionId}/finish`, payload: {} });
  assert.equal(finished.statusCode, 200, finished.body);
  const history = json(await appFran.inject({ method: 'GET', url: '/api/me/training/history' }));
  const latest = history.sessions[0];
  assert.equal(latest.id, sessionId);
  const pressBanca = latest.exercises.find(exercise => exercise.exerciseName === 'Press banca');
  assert.deepEqual(pressBanca.sets.map(set => [set.setIndex, set.setType, set.done]), [[1, 'warmup', true]]);
  assert.equal(latest.setCount, 3);
  } finally {
    await appFran.close();
  }
});

test('resume and reference: a member reads an own session with its sets, and the last time of each exercise', async () => {
  const gala = await makeClient('Gala');
  await entitle(gala);
  const galaRoutine = await addRoutine(gala, { weekdays: [otherWeekday], name: 'Libre' });
  const app = appFor(gala);
  try {
    // Una rutina que hoy no toca se puede empezar indicándola.
    const started = await app.inject({ method: 'POST', url: '/api/me/training/sessions', payload: { routineId: galaRoutine } });
    assert.equal(started.statusCode, 201, started.body);
    const sessionId = json(started).session.id;
    for (const [setIndex, reps, weightKg] of [[1, 8, 60], [2, 7, 60]]) {
      assert.equal((await app.inject({ method: 'POST', url: `/api/me/training/sessions/${sessionId}/sets`, payload: { exerciseName: 'Sentadilla', setIndex, reps, weightKg, rir: 1.5 } })).statusCode, 200);
    }
    const open = json(await app.inject({ method: 'GET', url: `/api/me/training/sessions/${sessionId}` })).session;
    assert.equal(open.status, 'in_progress'); assert.equal(open.routineName, 'Libre');
    assert.deepEqual(open.exercises.map(exercise => exercise.exerciseName), ['Sentadilla', 'Press banca']);
    assert.deepEqual(open.sets.map(set => [set.exerciseName, set.setIndex, set.reps, set.weightKg, set.rir]), [['Sentadilla', 1, 8, 60, 1.5], ['Sentadilla', 2, 7, 60, 1.5]]);
    assert.equal((await appOther.inject({ method: 'GET', url: `/api/me/training/sessions/${sessionId}` })).statusCode, 404, 'another member cannot read it');
    assert.equal((await appBlocked.inject({ method: 'GET', url: `/api/me/training/sessions/${sessionId}` })).statusCode, 403);

    const before = json(await app.inject({ method: 'GET', url: '/api/me/training/last?exercise=Sentadilla' }));
    assert.deepEqual(before.last, [], 'an open session is not a reference yet');
    assert.equal((await app.inject({ method: 'POST', url: `/api/me/training/sessions/${sessionId}/finish`, payload: {} })).statusCode, 200);
    const last = json(await app.inject({ method: 'GET', url: '/api/me/training/last?exercise=Sentadilla&exercise=Press%20banca' })).last;
    assert.deepEqual(last.map(item => [item.exerciseName, item.sets.map(set => `${set.reps}x${set.weightKg}`)]), [['Sentadilla', ['8x60', '7x60']]]);
    assert.deepEqual(json(await appOther.inject({ method: 'GET', url: '/api/me/training/last?exercise=Sentadilla' })).last.filter(item => item.sets.some(set => set.weightKg === 60 && set.reps === 7)), [], 'never another member\'s data');
    assert.equal((await app.inject({ method: 'GET', url: '/api/me/training/last' })).statusCode, 400);
  } finally { await app.close(); }
});

test('routines: a member cannot keep more than the allowed number of active routines', async () => {
  const hugo = await makeClient('Hugo');
  await entitle(hugo);
  await sql`INSERT INTO training_routines(client_id,name) SELECT ${hugo}::uuid, 'R' || n FROM generate_series(1,30) n`;
  const app = appFor(hugo);
  try {
    const over = await app.inject({ method: 'POST', url: '/api/me/training/routines', payload: { name: 'Una más' } });
    assert.equal(over.statusCode, 409); assert.equal(json(over).error, 'training_routine_limit');
  } finally { await app.close(); }
});
