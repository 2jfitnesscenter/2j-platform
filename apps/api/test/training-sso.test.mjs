import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { signedRequestSignature } from '../src/internal-service-auth.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: Training SSO tests cannot be skipped.');
process.env.NODE_ENV = 'test';
const sql = postgres(process.env.DATABASE_URL, { max: 8, connect_timeout: 5 });
await migrateDatabase(sql);

const REDEEM = '/api/internal/platform/v2/sso/redeem';
const bunkerKey = { id: 'qa-bunker-v1', secret: Buffer.alloc(32, 11).toString('base64url') };
const homeKey = { id: 'qa-home-v1', secret: Buffer.alloc(32, 12).toString('base64url') };
const keys = { [bunkerKey.id]: { caller: 'bunker', secret: bunkerKey.secret }, [homeKey.id]: { caller: 'home', secret: homeKey.secret } };
let currentAuth = null;
const redirectUrl = 'http://127.0.0.1:8080/sso';
const base = { trainingCapabilitiesKeys: keys, resolvePersonAuth: async () => currentAuth, trainingSsoRedirectUrl: redirectUrl };
const app = buildServer(process.env.DATABASE_URL, { ...base, logger: false, trainingSsoEnabled: true });
const disabledApp = buildServer(process.env.DATABASE_URL, { ...base, logger: false });
const unconfiguredApp = buildServer(process.env.DATABASE_URL, { ...base, logger: false, trainingSsoEnabled: true, trainingSsoRedirectUrl: null });
const adminApp = buildServer(process.env.DATABASE_URL, { logger: false, authorizationResolver: async () => ({ actorId: 'qa-admin', role: 'admin' }) });
after(async () => { await Promise.all([app.close(), disabledApp.close(), unconfiguredApp.close(), adminApp.close()]); await sql.end(); });

const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');

async function createPerson({ link = true } = {}) {
  const personId = randomUUID(), subjectId = randomUUID(), authSubject = `sso-test-${randomUUID()}`, trainingUserId = `training-${randomUUID()}`;
  await sql`INSERT INTO platform_persons(id,created_by) VALUES (${personId},'sso-test')`;
  await sql`INSERT INTO platform_person_auth_subjects(id,person_id,auth_subject,provider,status,created_by) VALUES (${subjectId},${personId},${authSubject},'platform-pilot','active','sso-test')`;
  if (link) await sql`INSERT INTO training_account_links(request_id,person_id,training_user_id,method,created_by,updated_by) VALUES (${randomUUID()},${personId},${trainingUserId},'explicit_admin','sso-test','sso-test')`;
  return { personId, subjectId, authSubject, trainingUserId, auth: { personId, authSubject, provider: 'platform-pilot', providerVersion: 1 } };
}

async function issue(person, server = app) {
  currentAuth = person.auth;
  const response = await server.inject({ method: 'POST', url: '/api/me/training/sso', headers: { 'content-type': 'application/json' }, payload: {} });
  const code = response.statusCode === 201 ? new URL(response.json().redirectUrl).hash.slice('#code='.length) : null;
  return { response, code };
}

function redeemRequest(code, overrides = {}) {
  const requestId = overrides.requestId ?? randomUUID();
  const timestamp = overrides.timestamp ?? new Date().toISOString();
  const key = overrides.key ?? bunkerKey;
  const body = Buffer.from(JSON.stringify({ v: 1, code, audience: '2j-training-sso', purpose: 'training-session', ...overrides.body }), 'utf8');
  const signature = overrides.signature ?? signedRequestSignature(key.secret, { keyId: key.id, timestamp, requestId, method: 'POST', path: REDEEM, body });
  return { method: 'POST', url: REDEEM, headers: { 'content-type': 'application/json', 'x-2j-key-id': key.id, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signature }, payload: body };
}

test('issuance is off by default, needs configuration and an authenticated person, and never persists the raw code', async () => {
  const person = await createPerson();
  currentAuth = person.auth;
  const off = await disabledApp.inject({ method: 'POST', url: '/api/me/training/sso', headers: { 'content-type': 'application/json' }, payload: {} });
  assert.equal(off.statusCode, 423); assert.equal(off.json().error, 'training_sso_disabled');
  const unconfigured = await unconfiguredApp.inject({ method: 'POST', url: '/api/me/training/sso', headers: { 'content-type': 'application/json' }, payload: {} });
  assert.equal(unconfigured.statusCode, 503);
  currentAuth = null;
  assert.equal((await app.inject({ method: 'POST', url: '/api/me/training/sso', headers: { 'content-type': 'application/json' }, payload: {} })).statusCode, 401);
  currentAuth = { ...person.auth, authSubject: 'someone-else' };
  assert.equal((await app.inject({ method: 'POST', url: '/api/me/training/sso', headers: { 'content-type': 'application/json' }, payload: {} })).statusCode, 401, 'a subject that is not bound to the person is rejected');

  const { response, code } = await issue(person);
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.headers['cache-control'], 'no-store'); assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.ok(response.json().redirectUrl.startsWith(`${redirectUrl}#code=`), 'the code travels in the URL fragment only');
  assert.equal(new URL(response.json().redirectUrl).search, '');
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  const rows = await sql`SELECT code_hash,state,training_user_id,EXTRACT(EPOCH FROM expires_at-created_at)::int AS ttl FROM platform_training_sso_codes WHERE person_id=${person.personId}`;
  assert.equal(rows.length, 1); assert.equal(rows[0].code_hash.trim(), hash(code)); assert.notEqual(rows[0].code_hash.trim(), code);
  assert.equal(rows[0].state, 'pending'); assert.equal(rows[0].training_user_id, person.trainingUserId);
  assert.ok(rows[0].ttl > 0 && rows[0].ttl <= 60, 'TTL is at most 60 seconds');
  const dump = JSON.stringify(await sql`SELECT * FROM platform_identity_audit_events WHERE person_id=${person.personId}`);
  assert.ok(!dump.includes(code), 'audit never contains the code');
});

test('redemption is service-authenticated, bunker-only, single-use, and returns the Platform capability payload', async () => {
  const person = await createPerson();
  const { code } = await issue(person);
  assert.equal((await app.inject({ method: 'POST', url: REDEEM, headers: { 'content-type': 'application/json' }, payload: { v: 1, code } })).statusCode, 401, 'a member session or no signature is not service auth');
  assert.equal((await app.inject(redeemRequest(code, { signature: 'A'.repeat(43) }))).statusCode, 401);
  assert.equal((await app.inject(redeemRequest(code, { timestamp: new Date(Date.now() - 31_000).toISOString() }))).statusCode, 401);
  assert.equal((await app.inject(redeemRequest(code, { key: homeKey }))).statusCode, 403, 'only the Training service may redeem');
  assert.equal((await disabledApp.inject(redeemRequest(code))).statusCode, 423);
  assert.equal((await app.inject(redeemRequest(code, { body: { audience: 'other-audience' } }))).statusCode, 409);
  assert.equal((await app.inject(redeemRequest(randomBytes(32).toString('base64url')))).statusCode, 404);
  assert.equal((await sql`SELECT state FROM platform_training_sso_codes WHERE code_hash=${hash(code)}`)[0].state, 'pending', 'failed attempts do not consume the code');

  const replayId = randomUUID();
  const ok = await app.inject(redeemRequest(code, { requestId: replayId }));
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.headers['cache-control'], 'no-store');
  const body = ok.json();
  assert.equal(body.personId, person.personId); assert.equal(body.trainingUserId, person.trainingUserId);
  assert.equal(body.capabilities.contract, '2J-CAPABILITIES-V2'); assert.equal(body.capabilities.capabilityLevel, 'baseline');
  assert.deepEqual(body.capabilities.capabilities, { autonomousTraining: true, routineCreation: false, personalRoutineCreation: true, personalRoutineManagement: true, workoutRecording: true, workoutHistory: true, guidedTraining: false, premiumPrograms: false, aiCoach: false, professionalFollowUp: false });
  const again = await app.inject(redeemRequest(code));
  assert.equal(again.statusCode, 409); assert.equal(again.json().error, 'sso_code_already_used');
  assert.equal((await app.inject(redeemRequest(code, { requestId: replayId }))).statusCode, 401, 'a service request id is accepted once');
  const [row] = await sql`SELECT state,consumed_key_id FROM platform_training_sso_codes WHERE code_hash=${hash(code)}`;
  assert.equal(row.state, 'consumed'); assert.equal(row.consumed_key_id, bunkerKey.id);
  const actions = (await sql`SELECT action FROM platform_identity_audit_events WHERE person_id=${person.personId} AND action LIKE 'training.sso_%' ORDER BY occurred_at,id`).map(item => item.action);
  assert.deepEqual(actions, ['training.sso_issued', 'training.sso_redeemed', 'training.sso_rejected']);
});

test('concurrent redemption has exactly one winner', async () => {
  const person = await createPerson();
  const { code } = await issue(person);
  const results = await Promise.all([app.inject(redeemRequest(code)), app.inject(redeemRequest(code)), app.inject(redeemRequest(code))]);
  assert.deepEqual(results.map(item => item.statusCode).sort(), [200, 409, 409]);
});

test('expired codes are rejected and finalised; a stored code cannot be extended or reused', async () => {
  const person = await createPerson();
  const code = randomBytes(32).toString('base64url');
  await sql`INSERT INTO platform_training_sso_codes(code_hash,person_id,auth_subject_link_id,training_user_id,audience,purpose,expires_at)
    VALUES (${hash(code)},${person.personId},${person.subjectId},${person.trainingUserId},'2j-training-sso','training-session',now()+interval '1 second')`;
  await new Promise(resolve => setTimeout(resolve, 1300));
  const expired = await app.inject(redeemRequest(code));
  assert.equal(expired.statusCode, 410); assert.equal(expired.json().error, 'sso_code_expired');
  const [row] = await sql`SELECT state,terminal_reason FROM platform_training_sso_codes WHERE code_hash=${hash(code)}`;
  assert.equal(row.state, 'expired'); assert.equal(row.terminal_reason, 'ttl_elapsed');
  await assert.rejects(sql`UPDATE platform_training_sso_codes SET expires_at=now()+interval '30 seconds' WHERE code_hash=${hash(code)}`, { code: '55000' });
  await assert.rejects(sql`UPDATE platform_training_sso_codes SET state='pending' WHERE code_hash=${hash(code)}`, { code: '55000' });
  await assert.rejects(sql`DELETE FROM platform_training_sso_codes WHERE code_hash=${hash(code)}`, { code: '55000' });
  await assert.rejects(sql`INSERT INTO platform_training_sso_codes(code_hash,person_id,auth_subject_link_id,training_user_id,audience,purpose,expires_at)
    VALUES (${hash(randomUUID())},${person.personId},${person.subjectId},${person.trainingUserId},'2j-training-sso','training-session',now()+interval '5 minutes')`, { code: '23514' });
});

test('issuance and redemption fail closed for a missing, revoked or changed Training link', async () => {
  const unlinked = await createPerson({ link: false });
  const missing = await issue(unlinked);
  assert.equal(missing.response.statusCode, 409); assert.equal(missing.response.json().reasonCode, 'TRAINING_LINK_MISSING');
  assert.equal((await sql`SELECT count(*)::int AS n FROM platform_training_sso_codes WHERE person_id=${unlinked.personId}`)[0].n, 0);

  const person = await createPerson();
  const { code } = await issue(person);
  await sql`UPDATE training_account_links SET status='revoked',updated_by='sso-test' WHERE person_id=${person.personId}`;
  const revoked = await app.inject(redeemRequest(code));
  assert.equal(revoked.statusCode, 409); assert.equal(revoked.json().error, 'sso_binding_changed');
  assert.equal((await sql`SELECT state,terminal_reason FROM platform_training_sso_codes WHERE code_hash=${hash(code)}`)[0].terminal_reason, 'binding_changed');
  const afterRevoke = await issue(person);
  assert.equal(afterRevoke.response.statusCode, 409); assert.equal(afterRevoke.response.json().reasonCode, 'TRAINING_LINK_REVOKED');

  const revokedSubject = await createPerson();
  const issued = await issue(revokedSubject);
  await sql`UPDATE platform_person_auth_subjects SET status='revoked',revoked_by='sso-test' WHERE id=${revokedSubject.subjectId}`;
  assert.equal((await app.inject(redeemRequest(issued.code))).statusCode, 409, 'a revoked auth subject cannot complete a pending code');
  assert.equal((await issue(revokedSubject)).response.statusCode, 401);
});

test('administrative suspension blocks issuance and redemption, is reversible, and is not confused with a missing fee', async () => {
  const person = await createPerson();
  const { code } = await issue(person);
  const path = `/api/platform/v1/persons/${person.personId}/training-suspension`;
  const suspend = await adminApp.inject({ method: 'POST', url: `${path}/suspend`, headers: { 'idempotency-key': randomUUID() }, payload: { reason: 'Incumplimiento de normas internas' } });
  assert.equal(suspend.statusCode, 201, suspend.body);
  const blocked = await app.inject(redeemRequest(code));
  assert.equal(blocked.statusCode, 403); assert.equal(blocked.json().reasonCode, 'ADMIN_SUSPENDED');
  assert.equal((await sql`SELECT terminal_reason FROM platform_training_sso_codes WHERE code_hash=${hash(code)}`)[0].terminal_reason, 'capability_blocked');
  const denied = await issue(person);
  assert.equal(denied.response.statusCode, 403); assert.equal(denied.response.json().error, 'training_access_suspended');
  const lift = await adminApp.inject({ method: 'POST', url: `${path}/lift`, headers: { 'idempotency-key': randomUUID() }, payload: { reason: 'Revisión completada y acceso restituido' } });
  assert.equal(lift.statusCode, 201, lift.body);
  const restored = await issue(person);
  assert.equal(restored.response.statusCode, 201);
  const ok = await app.inject(redeemRequest(restored.code));
  assert.equal(ok.statusCode, 200); assert.equal(ok.json().capabilities.capabilityLevel, 'baseline', 'no fee does not mean blocked');
  const [link] = await sql`SELECT status,training_user_id AS "trainingUserId" FROM training_account_links WHERE person_id=${person.personId}`;
  assert.equal(link.status, 'active'); assert.equal(link.trainingUserId, person.trainingUserId, 'suspension keeps identity and link');
});

test('a person cannot hold more than five pending codes', async () => {
  const person = await createPerson();
  for (let index = 0; index < 5; index += 1) assert.equal((await issue(person)).response.statusCode, 201);
  const limited = await issue(person);
  assert.equal(limited.response.statusCode, 429); assert.equal(limited.response.json().error, 'training_sso_rate_limited');
});
