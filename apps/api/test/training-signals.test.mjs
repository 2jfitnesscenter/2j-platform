import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { createTrainingSignalDispatcher, TRAINING_SIGNAL_PATH } from '../src/training-signals.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: Training signal tests cannot be skipped.');
process.env.NODE_ENV = 'test';
const sql = postgres(process.env.DATABASE_URL, { max: 8, connect_timeout: 5 });
await migrateDatabase(sql);

// A Training that records what it is told and can be made unavailable, refuse, or accept. It validates its answer with the schema the dispatcher passes.
const trainingCalls = [];
let trainingMode = 'ok';
const training = {
  enabled: true,
  async post(path, body, schema) {
    trainingCalls.push({ path, body: JSON.parse(JSON.stringify(body)) });
    if (trainingMode === 'down') return { ok: false, status: 'unavailable' };
    if (trainingMode === 'not-found') return { ok: false, status: 404, error: 'link_not_found' };
    if (trainingMode === 'disabled') return { ok: false, status: 423, error: 'platform_link_disabled' };
    return { ok: true, data: schema.parse({ v: 1, status: 'applied', signalId: body.signalId }) };
  },
};
const base = { logger: false, trainingServiceCallsEnabled: true, trainingServiceClient: training, trainingSignalsIntervalMs: 3_600_000 };
const adminApp = buildServer(process.env.DATABASE_URL, { logger: false, authorizationResolver: async () => ({ actorId: 'qa-admin', role: 'admin' }) });
const apps = [];
const withSignals = options => { const app = buildServer(process.env.DATABASE_URL, { ...base, ...options }); apps.push(app); return app; };
const signalsApp = withSignals({ trainingSignalsEnabled: true });
const offApp = withSignals({});
after(async () => { await Promise.all([adminApp.close(), ...apps.map(app => app.close())]); await sql.end(); });

async function person({ link = true } = {}) {
  const personId = randomUUID(), trainingUserId = `training-${randomUUID()}`;
  await sql`INSERT INTO platform_persons(id,created_by) VALUES (${personId},'signal-test')`;
  if (link) await sql`INSERT INTO training_account_links(request_id,person_id,training_user_id,method,created_by,updated_by) VALUES (${randomUUID()},${personId},${trainingUserId},'explicit_admin','signal-test','signal-test')`;
  return { personId, trainingUserId };
}
const reasonText = 'Motivo interno de la suspensión: no debe viajar';
const act = (personId, action) => adminApp.inject({ method: 'POST', url: `/api/platform/v1/persons/${personId}/training-suspension/${action}`, headers: { 'idempotency-key': randomUUID() }, payload: { reason: action === 'suspend' ? reasonText : 'Revisión completada y acceso restituido' } });
const deliveries = personId => sql`SELECT seq::int AS seq,kind,state,attempts,last_error AS "lastError",signal_id AS "signalId",next_attempt_at AS "nextAt" FROM platform_training_signal_deliveries WHERE person_id=${personId} ORDER BY seq`;
const due = personId => sql`UPDATE platform_training_signal_deliveries SET next_attempt_at=now() WHERE person_id=${personId} AND state='pending'`;
const reset = () => { trainingCalls.length = 0; trainingMode = 'ok'; };

test('it does nothing at all unless explicitly enabled, and the proof of concept refuses to start outside development/test', async () => {
  const p = await person();
  assert.equal((await act(p.personId, 'suspend')).statusCode, 201);
  assert.equal(offApp.trainingSignals.enabled, false);
  assert.deepEqual(await offApp.trainingSignals.tick(), { delivered: 0, pending: 0 });
  assert.equal((await deliveries(p.personId)).length, 0);
  assert.equal(trainingCalls.length, 0);
  const saved = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try { assert.throws(() => buildServer(process.env.DATABASE_URL, { ...base, trainingSignalsEnabled: true }), /restricted to development\/test/); }
  finally { process.env.NODE_ENV = saved; }
  // Enabled but with the Training service calls off: still inert.
  const inert = withSignals({ trainingSignalsEnabled: true, trainingServiceCallsEnabled: false });
  assert.equal(inert.trainingSignals.enabled, false);
});

test('history before the dispatcher was first enabled is never replayed', async () => {
  const before = await person();
  assert.equal((await act(before.personId, 'suspend')).statusCode, 201);
  await sql`DELETE FROM platform_training_signal_state`;           // "first run": the cut-off is taken now
  await new Promise(resolve => setTimeout(resolve, 20));
  reset();
  await signalsApp.trainingSignals.tick();
  assert.equal((await deliveries(before.personId)).length, 0, 'an old suspension is not announced again');
  assert.equal(trainingCalls.length, 0);
});

test('a suspension is announced with ids only: the reason text never leaves Platform; the delivery is recorded', async () => {
  reset();
  const p = await person();
  assert.equal((await act(p.personId, 'suspend')).statusCode, 201);
  const result = await signalsApp.trainingSignals.tick();
  assert.equal(trainingCalls.length, 1, JSON.stringify(trainingCalls));
  const [{ path, body }] = trainingCalls;
  assert.equal(path, TRAINING_SIGNAL_PATH); assert.equal(path, '/api/platform/v1/signals');
  assert.deepEqual(Object.keys(body).sort(), ['kind', 'occurredAt', 'personId', 'sequence', 'signalId', 'trainingUserId', 'v']);
  assert.equal(body.v, 1); assert.equal(body.kind, 'suspended'); assert.equal(body.personId, p.personId); assert.equal(body.trainingUserId, p.trainingUserId);
  assert.match(body.signalId, /^[0-9a-f-]{36}$/); assert.match(body.occurredAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/); assert.ok(Number.isSafeInteger(body.sequence) && body.sequence > 0);
  assert.ok(!JSON.stringify(body).includes('Motivo interno'), 'no reason text is sent');
  const [row] = await deliveries(p.personId);
  assert.equal(row.state, 'delivered'); assert.equal(row.seq, body.sequence, 'the sequence Training orders by is the delivery sequence');
  assert.equal(result.pending, 0);
  const stored = JSON.stringify(await sql`SELECT * FROM platform_training_signal_deliveries WHERE person_id=${p.personId}`);
  assert.ok(!stored.includes('Motivo interno'), 'and none is stored in the delivery bookkeeping either');
});

test('an unreachable Training is retried with backoff and nothing is lost; a second dispatcher never sends the same delivery twice', async () => {
  reset(); trainingMode = 'down';
  const p = await person();
  assert.equal((await act(p.personId, 'suspend')).statusCode, 201);
  const first = await signalsApp.trainingSignals.tick();
  assert.equal(first.pending, 1);
  let [row] = await deliveries(p.personId);
  assert.equal(row.state, 'pending'); assert.equal(row.attempts, 1); assert.match(row.lastError, /^retry_unavailable$/);
  assert.ok(new Date(row.nextAt).getTime() > Date.now(), 'the next attempt is in the future (lease/backoff)');
  const before = trainingCalls.length;
  await signalsApp.trainingSignals.tick();
  assert.equal(trainingCalls.length, before, 'not due yet: not sent again');
  trainingMode = 'ok'; await due(p.personId);
  const other = createTrainingSignalDispatcher(sql, { client: training, enabled: true });      // a second worker on the same table
  await Promise.all([signalsApp.trainingSignals.tick(), other.tick()]);
  [row] = await deliveries(p.personId);
  assert.equal(row.state, 'delivered');
  assert.equal(trainingCalls.length - before, 1, 'exactly one successful send, even with two workers');
});

test('only the latest state of a person is worth telling: a suspension that never got through is superseded by the lift', async () => {
  reset(); trainingMode = 'down';
  const p = await person();
  assert.equal((await act(p.personId, 'suspend')).statusCode, 201);
  assert.equal((await act(p.personId, 'lift')).statusCode, 201);
  await signalsApp.trainingSignals.tick();                       // both are due; the older sees the newer and steps aside, the newer fails and stays pending
  trainingMode = 'ok'; await due(p.personId);
  await signalsApp.trainingSignals.tick();
  const rows = await deliveries(p.personId);
  assert.deepEqual(rows.map(item => [item.kind, item.state]), [['suspended', 'superseded'], ['lifted', 'delivered']]);
  const kinds = trainingCalls.filter(call => call.body.personId === p.personId).map(call => call.body.kind);
  assert.deepEqual([...new Set(kinds)], ['lifted'], 'the stale suspension was never sent at all: only the latest state travels');
  assert.ok(rows[1].seq > rows[0].seq);
});

test('there is nobody to tell when no link is active, and a Training that does not know the link ends the attempt; a Training with signals off keeps being retried and alerts', async () => {
  reset();
  const unlinked = await person({ link: false });
  assert.equal((await act(unlinked.personId, 'suspend')).statusCode, 201);
  const alerts = [];
  const watcher = createTrainingSignalDispatcher(sql, { client: training, enabled: true, onAlert: (kind, detail) => alerts.push([kind, detail]) });
  await watcher.tick();
  let [row] = await deliveries(unlinked.personId);
  assert.equal(row.state, 'abandoned'); assert.equal(row.lastError, 'no_active_link'); assert.equal(trainingCalls.length, 0);

  trainingMode = 'not-found';
  const p = await person();
  assert.equal((await act(p.personId, 'suspend')).statusCode, 201);
  await watcher.tick();
  [row] = await deliveries(p.personId);
  assert.equal(row.state, 'abandoned'); assert.equal(row.lastError, 'training_link_not_found');
  assert.ok(alerts.some(([kind]) => kind === 'platform_signal_refused'), 'a refusal is worth a look');

  trainingMode = 'disabled';
  const q = await person();
  assert.equal((await act(q.personId, 'suspend')).statusCode, 201);
  await watcher.tick();
  [row] = await deliveries(q.personId);
  assert.equal(row.state, 'pending', 'signals switched off at Training: keep trying, the capability cache still converges meanwhile');
  assert.ok(alerts.some(([kind]) => kind === 'platform_signal_not_accepted'));
});

test('an undelivered signal is abandoned after its maximum age, and the backlog is visible', async () => {
  reset(); trainingMode = 'down';
  const p = await person();
  assert.equal((await act(p.personId, 'suspend')).statusCode, 201);
  await signalsApp.trainingSignals.tick();
  const status = await signalsApp.trainingSignals.status();
  assert.ok(status.pending >= 1); assert.ok(status.oldestPendingSeconds >= 0);
  await sql`UPDATE platform_training_signal_deliveries SET created_at=now()-interval '25 hours' WHERE person_id=${p.personId}`;
  await due(p.personId);
  const alerts = [];
  const aged = createTrainingSignalDispatcher(sql, { client: training, enabled: true, onAlert: (kind) => alerts.push(kind) });
  await aged.tick();
  const [row] = await deliveries(p.personId);
  assert.equal(row.state, 'abandoned'); assert.equal(row.lastError, 'max_age'); assert.ok(alerts.includes('platform_signal_abandoned'));
});

test('the bookkeeping is constrained: states, kinds and error text are validated, and every delivery belongs to exactly one access event', async () => {
  const p = await person();
  assert.equal((await act(p.personId, 'suspend')).statusCode, 201);
  reset();
  await signalsApp.trainingSignals.tick();
  const [event] = await sql`SELECT id FROM platform_training_access_events WHERE person_id=${p.personId}`;
  await assert.rejects(sql`INSERT INTO platform_training_signal_deliveries(event_id,person_id,kind) VALUES (${event.id},${p.personId},'suspended')`, { code: '23505' });
  await assert.rejects(sql`UPDATE platform_training_signal_deliveries SET state='granted' WHERE person_id=${p.personId}`, { code: '23514' });
  await assert.rejects(sql`UPDATE platform_training_signal_deliveries SET kind='granted' WHERE person_id=${p.personId}`, { code: '23514' });
  await assert.rejects(sql`UPDATE platform_training_signal_deliveries SET last_error=${'x'.repeat(81)} WHERE person_id=${p.personId}`, { code: '23514' });
  await assert.rejects(sql`UPDATE platform_training_signal_deliveries SET delivered_at=NULL WHERE person_id=${p.personId} AND state='delivered'`, { code: '23514' });
});
