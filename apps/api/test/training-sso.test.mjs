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
const memberOrigin = 'http://127.0.0.1:5173';
const base = { trainingCapabilitiesKeys: keys, resolvePersonAuth: async () => currentAuth, trainingSsoRedirectUrl: redirectUrl, memberAppOrigin: memberOrigin };
const app = buildServer(process.env.DATABASE_URL, { ...base, logger: false, trainingSsoEnabled: true });
const disabledApp = buildServer(process.env.DATABASE_URL, { ...base, logger: false });
const unconfiguredApp = buildServer(process.env.DATABASE_URL, { ...base, logger: false, trainingSsoEnabled: true, trainingSsoRedirectUrl: null });
const adminApp = buildServer(process.env.DATABASE_URL, { logger: false, authorizationResolver: async () => ({ actorId: 'qa-admin', role: 'admin' }) });
after(async () => { await Promise.all([app.close(), disabledApp.close(), unconfiguredApp.close(), adminApp.close()]); await sql.end(); });

const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
// Browser binding: the verifier belongs to the browser that started the flow at Training; Platform only ever sees its S256 challenge until redemption.
const verifiers = new Map();
const newVerifier = () => randomBytes(32).toString('base64url');
const challengeFor = verifier => createHash('sha256').update(verifier, 'ascii').digest('base64url');
const startFlow = () => { const verifier = newVerifier(); return { verifier, challenge: challengeFor(verifier) }; };
const issueHeaders = { 'content-type': 'application/json', origin: memberOrigin };
async function insertCode(person, code, interval) {
  const { verifier, challenge } = startFlow();
  verifiers.set(code, verifier);
  await sql`INSERT INTO platform_training_sso_codes(code_hash,person_id,auth_subject_link_id,training_user_id,audience,purpose,binding_challenge,expires_at)
    VALUES (${hash(code)},${person.personId},${person.subjectId},${person.trainingUserId},'2j-training-sso','training-session',${challenge},now()+${interval}::interval)`;
}

async function createPerson({ link = true } = {}) {
  const personId = randomUUID(), subjectId = randomUUID(), authSubject = `sso-test-${randomUUID()}`, trainingUserId = `training-${randomUUID()}`;
  await sql`INSERT INTO platform_persons(id,created_by) VALUES (${personId},'sso-test')`;
  await sql`INSERT INTO platform_person_auth_subjects(id,person_id,auth_subject,provider,status,created_by) VALUES (${subjectId},${personId},${authSubject},'platform-pilot','active','sso-test')`;
  if (link) await sql`INSERT INTO training_account_links(request_id,person_id,training_user_id,method,created_by,updated_by) VALUES (${randomUUID()},${personId},${trainingUserId},'explicit_admin','sso-test','sso-test')`;
  return { personId, subjectId, authSubject, trainingUserId, auth: { personId, authSubject, provider: 'platform-pilot', providerVersion: 1 } };
}

async function issue(person, server = app) {
  currentAuth = person.auth;
  const { verifier, challenge } = startFlow();
  const response = await server.inject({ method: 'POST', url: '/api/me/training/sso', headers: issueHeaders, payload: { challenge } });
  const code = response.statusCode === 201 ? new URL(response.json().redirectUrl).hash.slice('#code='.length) : null;
  if (code) verifiers.set(code, verifier);
  return { response, code, verifier };
}

function redeemRequest(code, overrides = {}) {
  const requestId = overrides.requestId ?? randomUUID();
  const timestamp = overrides.timestamp ?? new Date().toISOString();
  const key = overrides.key ?? bunkerKey;
  const body = Buffer.from(JSON.stringify({ v: 2, code, verifier: verifiers.get(code) ?? newVerifier(), audience: '2j-training-sso', purpose: 'training-session', ...overrides.body }), 'utf8');
  const signature = overrides.signature ?? signedRequestSignature(key.secret, { keyId: key.id, timestamp, requestId, method: 'POST', path: REDEEM, body });
  return { method: 'POST', url: REDEEM, headers: { 'content-type': 'application/json', 'x-2j-key-id': key.id, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signature }, payload: body };
}

test('issuance is off by default, needs configuration and an authenticated person, and never persists the raw code', async () => {
  const person = await createPerson();
  currentAuth = person.auth;
  const body = () => ({ challenge: startFlow().challenge });
  const off = await disabledApp.inject({ method: 'POST', url: '/api/me/training/sso', headers: issueHeaders, payload: body() });
  assert.equal(off.statusCode, 423); assert.equal(off.json().error, 'training_sso_disabled');
  const unconfigured = await unconfiguredApp.inject({ method: 'POST', url: '/api/me/training/sso', headers: issueHeaders, payload: body() });
  assert.equal(unconfigured.statusCode, 503);
  currentAuth = null;
  assert.equal((await app.inject({ method: 'POST', url: '/api/me/training/sso', headers: issueHeaders, payload: body() })).statusCode, 401);
  currentAuth = { ...person.auth, authSubject: 'someone-else' };
  assert.equal((await app.inject({ method: 'POST', url: '/api/me/training/sso', headers: issueHeaders, payload: body() })).statusCode, 401, 'a subject that is not bound to the person is rejected');

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
  await insertCode(person, code, '1 second');
  await new Promise(resolve => setTimeout(resolve, 1300));
  const expired = await app.inject(redeemRequest(code));
  assert.equal(expired.statusCode, 410); assert.equal(expired.json().error, 'sso_code_expired');
  const [row] = await sql`SELECT state,terminal_reason FROM platform_training_sso_codes WHERE code_hash=${hash(code)}`;
  assert.equal(row.state, 'expired'); assert.equal(row.terminal_reason, 'ttl_elapsed');
  await assert.rejects(sql`UPDATE platform_training_sso_codes SET expires_at=now()+interval '30 seconds' WHERE code_hash=${hash(code)}`, { code: '55000' });
  await assert.rejects(sql`UPDATE platform_training_sso_codes SET state='pending' WHERE code_hash=${hash(code)}`, { code: '55000' });
  await assert.rejects(sql`DELETE FROM platform_training_sso_codes WHERE code_hash=${hash(code)}`, { code: '55000' });
  await assert.rejects(insertCode(person, randomBytes(32).toString('base64url'), '5 minutes'), { code: '23514' });
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

test('a person has at most one live code: a new one supersedes the previous, and issuance is rate limited per minute', async () => {
  const person = await createPerson();
  const first = await issue(person), second = await issue(person);
  assert.equal(first.response.statusCode, 201); assert.equal(second.response.statusCode, 201);
  const old = await app.inject(redeemRequest(first.code));
  assert.equal(old.statusCode, 409); assert.equal(old.json().error, 'sso_code_revoked', 'the superseded code can no longer be redeemed');
  const [{ live }] = await sql`SELECT count(*)::int AS live FROM platform_training_sso_codes WHERE person_id=${person.personId} AND state='pending'`;
  assert.equal(live, 1, 'exactly one pending code per person');
  assert.equal((await sql`SELECT terminal_reason FROM platform_training_sso_codes WHERE code_hash=${hash(first.code)}`)[0].terminal_reason, 'superseded');
  assert.equal((await app.inject(redeemRequest(second.code))).statusCode, 200, 'the newest code works');
  for (let index = 0; index < 8; index += 1) assert.equal((await issue(person)).response.statusCode, 201);
  const limited = await issue(person);
  assert.equal(limited.response.statusCode, 429); assert.equal(limited.response.json().error, 'training_sso_rate_limited');
});

test('issuance requires the member-app origin for every authentication provider (CSRF), not only the pilot', async () => {
  const person = await createPerson();
  currentAuth = person.auth;
  const attempt = headers => app.inject({ method: 'POST', url: '/api/me/training/sso', headers: { 'content-type': 'application/json', ...headers }, payload: { challenge: startFlow().challenge } });
  assert.equal((await attempt({})).statusCode, 403, 'no Origin');
  assert.equal((await attempt({ origin: 'https://attacker.example' })).statusCode, 403, 'foreign Origin');
  assert.equal((await attempt({ origin: `${memberOrigin}.attacker.example` })).statusCode, 403, 'lookalike Origin');
  assert.equal((await attempt({ origin: memberOrigin, 'sec-fetch-site': 'cross-site' })).statusCode, 403, 'browser says cross-site');
  assert.equal((await sql`SELECT count(*)::int AS n FROM platform_training_sso_codes WHERE person_id=${person.personId}`)[0].n, 0, 'nothing is issued for a rejected request');
  assert.equal((await attempt({ origin: memberOrigin, 'sec-fetch-site': 'same-site' })).statusCode, 201);
  const noOriginConfigured = buildServer(process.env.DATABASE_URL, { ...base, memberAppOrigin: undefined, logger: false, trainingSsoEnabled: true });
  try { assert.equal((await noOriginConfigured.inject({ method: 'POST', url: '/api/me/training/sso', headers: issueHeaders, payload: { challenge: startFlow().challenge } })).statusCode, 503, 'without a configured member origin it fails closed'); }
  finally { await noOriginConfigured.close(); }
});

test('a suspension committed while a redemption is in flight is never ignored (no stale capability snapshot)', async () => {
  const person = await createPerson();
  const { code } = await issue(person);
  const path = `/api/platform/v1/persons/${person.personId}/training-suspension`;
  let redemption;
  // The suspension transaction holds the person lock, exactly as the admin route does; the redemption starts meanwhile and must wait for it.
  await sql.begin(async tx => {
    await tx`SELECT id FROM platform_persons WHERE id=${person.personId} FOR UPDATE`;
    await tx`INSERT INTO platform_training_access_events(person_id,action,reason,actor_id,idempotency_key,request_hash) VALUES (${person.personId},'suspended','Prueba de carrera en canje','qa',${randomUUID()},${hash(randomUUID())})`;
    redemption = app.inject(redeemRequest(code));
    await new Promise(resolve => setTimeout(resolve, 400));
    const early = await Promise.race([redemption.then(() => 'finished'), new Promise(resolve => setTimeout(() => resolve('waiting'), 50))]);
    assert.equal(early, 'waiting', 'the redemption blocks on the person lock instead of reading around it');
  });
  const result = await redemption;
  assert.equal(result.statusCode, 403, result.body); assert.equal(result.json().reasonCode, 'ADMIN_SUSPENDED');
  assert.equal((await sql`SELECT state,terminal_reason FROM platform_training_sso_codes WHERE code_hash=${hash(code)}`)[0].terminal_reason, 'capability_blocked');
  assert.ok(path);
});

test('replays of a dead code stay rejected but leave bounded evidence', async () => {
  const person = await createPerson();
  const { code } = await issue(person);
  assert.equal((await app.inject(redeemRequest(code))).statusCode, 200);
  for (let index = 0; index < 12; index += 1) assert.equal((await app.inject(redeemRequest(code))).statusCode, 409, 'every replay is refused');
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM platform_identity_audit_events WHERE person_id=${person.personId} AND action='training.sso_rejected'`;
  assert.equal(n, 5, 'rejection evidence is capped per code');
  const expiredCode = randomBytes(32).toString('base64url');
  await insertCode(person, expiredCode, '1 second');
  await new Promise(resolve => setTimeout(resolve, 1300));
  for (let index = 0; index < 8; index += 1) assert.equal((await app.inject(redeemRequest(expiredCode))).statusCode, 410);
  const [{ expiredAudits }] = await sql`SELECT count(*)::int AS "expiredAudits" FROM platform_identity_audit_events r JOIN platform_training_sso_codes c ON c.id=r.resource_id WHERE c.code_hash=${hash(expiredCode)} AND r.action='training.sso_rejected'`;
  assert.ok(expiredAudits <= 5);
});

// ---- Browser binding (PKCE S256): a code works only for the browser that started the flow at Training ----

test('issuance requires the challenge of the starting browser, and stores only that challenge', async () => {
  const person = await createPerson();
  currentAuth = person.auth;
  const post = payload => app.inject({ method: 'POST', url: '/api/me/training/sso', headers: issueHeaders, payload });
  const { verifier, challenge } = startFlow();
  for (const bad of [{}, { challenge: '' }, { challenge: 'short' }, { challenge: `${challenge}x` }, { challenge: `${challenge.slice(1)}!` }, { challenge: 42 }, { challenge, extra: 1 }, { verifier }, { challenge: verifier + verifier }]) {
    const rejected = await post(bad);
    assert.equal(rejected.statusCode, 400, JSON.stringify(bad)); assert.equal(rejected.json().error, 'binding_challenge_required');
  }
  assert.equal((await app.inject({ method: 'POST', url: '/api/me/training/sso', headers: { origin: memberOrigin } })).statusCode, 400, 'no body at all');
  assert.equal((await sql`SELECT count(*)::int AS n FROM platform_training_sso_codes WHERE person_id=${person.personId}`)[0].n, 0, 'nothing is issued without a challenge');

  const issued = await post({ challenge });
  assert.equal(issued.statusCode, 201, issued.body);
  const [row] = await sql`SELECT binding_challenge FROM platform_training_sso_codes WHERE person_id=${person.personId}`;
  assert.equal(row.binding_challenge.trim(), challenge);
  const everything = JSON.stringify([await sql`SELECT * FROM platform_training_sso_codes`, await sql`SELECT * FROM platform_identity_audit_events WHERE person_id=${person.personId}`]);
  assert.ok(!everything.includes(verifier), 'the verifier never reaches Platform before redemption, so it can never be stored');
  assert.ok(!issued.body.includes(challenge), 'the response does not echo the challenge');
});

test('redemption needs the verifier of the starting browser: a wrong, missing or foreign verifier never succeeds and never burns the code', async () => {
  const person = await createPerson(), stranger = await createPerson();
  const { code, verifier } = await issue(person);
  const other = await issue(stranger);
  const bodyWith = verifierValue => ({ body: { verifier: verifierValue } });
  for (const [label, attempt] of [
    ['random verifier', redeemRequest(code, bodyWith(newVerifier()))],
    ['the verifier of another person\'s flow', redeemRequest(code, bodyWith(other.verifier))],
    ['the challenge used as if it were the verifier', redeemRequest(code, bodyWith(challengeFor(verifier)))],
  ]) {
    const result = await app.inject(attempt);
    assert.equal(result.statusCode, 403, `${label}: ${result.body}`); assert.equal(result.json().error, 'sso_binding_mismatch');
  }
  const missing = redeemRequest(code); const parsed = JSON.parse(missing.payload.toString('utf8')); delete parsed.verifier;
  const payload = Buffer.from(JSON.stringify(parsed), 'utf8');
  const requestId = randomUUID(), timestamp = new Date().toISOString();
  const signature = signedRequestSignature(bunkerKey.secret, { keyId: bunkerKey.id, timestamp, requestId, method: 'POST', path: REDEEM, body: payload });
  assert.equal((await app.inject({ method: 'POST', url: REDEEM, headers: { ...missing.headers, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signature }, payload })).statusCode, 400, 'no verifier at all');
  assert.equal((await app.inject(redeemRequest(code, { body: { v: 1 } }))).statusCode, 400, 'the previous request version is not accepted');
  assert.equal((await app.inject(redeemRequest(code, { body: { verifier: 'short' } }))).statusCode, 400);

  assert.equal((await sql`SELECT state FROM platform_training_sso_codes WHERE code_hash=${hash(code)}`)[0].state, 'pending', 'wrong verifiers do not consume the code (a leaked code cannot be burned by its holder)');
  const [{ audited }] = await sql`SELECT count(*)::int AS audited FROM platform_identity_audit_events WHERE person_id=${person.personId} AND action='training.sso_rejected'`;
  assert.ok(audited >= 1 && audited <= 5, 'mismatches are audited, boundedly');
  const ok = await app.inject(redeemRequest(code));
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().trainingUserId, person.trainingUserId, 'the starting browser redeems it normally');
  assert.equal((await app.inject(redeemRequest(code))).statusCode, 409, 'and only once');
});

test('login CSRF: a code minted for the attacker\'s browser cannot be redeemed with anything a victim\'s browser holds', async () => {
  const attacker = await createPerson(), victim = await createPerson();
  const attackerFlow = await issue(attacker);                 // the attacker runs the flow in their own browser and keeps the code
  const victimFlow = startFlow();                             // the victim's browser holds its own, unrelated verifier
  const forged = await app.inject(redeemRequest(attackerFlow.code, { body: { verifier: victimFlow.verifier } }));
  assert.equal(forged.statusCode, 403); assert.equal(forged.json().error, 'sso_binding_mismatch');
  const noCookie = await app.inject(redeemRequest(attackerFlow.code, { body: { verifier: newVerifier() } }));
  assert.equal(noCookie.statusCode, 403, 'a browser without the starting cookie cannot do it either');
  const real = await app.inject(redeemRequest(attackerFlow.code));
  assert.equal(real.statusCode, 200); assert.equal(real.json().trainingUserId, attacker.trainingUserId, 'only the attacker\'s own browser signs into the attacker\'s account');
  assert.notEqual(real.json().trainingUserId, victim.trainingUserId);
});

test('the binding is immutable and every stored code carries one', async () => {
  const person = await createPerson();
  const { code } = await issue(person);
  await assert.rejects(sql`UPDATE platform_training_sso_codes SET binding_challenge=${startFlow().challenge},version=version+1 WHERE code_hash=${hash(code)}`, { code: '55000' });
  await assert.rejects(sql`INSERT INTO platform_training_sso_codes(code_hash,person_id,auth_subject_link_id,training_user_id,audience,purpose,expires_at)
    VALUES (${hash(randomUUID())},${person.personId},${person.subjectId},${person.trainingUserId},'2j-training-sso','training-session',now()+interval '30 seconds')`, { code: '23514' });
  await assert.rejects(sql`INSERT INTO platform_training_sso_codes(code_hash,person_id,auth_subject_link_id,training_user_id,audience,purpose,binding_challenge,expires_at)
    VALUES (${hash(randomUUID())},${person.personId},${person.subjectId},${person.trainingUserId},'2j-training-sso','training-session','not-a-challenge',now()+interval '30 seconds')`, { code: '23514' });
});

test('concurrent redemption: exactly one winner, and a wrong verifier never wins', async () => {
  const person = await createPerson();
  const { code } = await issue(person);
  const results = await Promise.all([app.inject(redeemRequest(code)), app.inject(redeemRequest(code)), app.inject(redeemRequest(code, { body: { verifier: newVerifier() } }))]);
  const statuses = results.map(item => item.statusCode).sort();
  assert.equal(statuses.filter(status => status === 200).length, 1, `one winner: ${statuses}`);
  assert.ok([403, 409].includes(results[2].statusCode), `the wrong verifier was refused (mismatch, or already used if it came last): ${results[2].statusCode}`);
  assert.ok(results.every(item => item.statusCode !== 200 || item.json().trainingUserId === person.trainingUserId));
});
