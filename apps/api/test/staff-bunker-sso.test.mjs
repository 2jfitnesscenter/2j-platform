import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { signedRequestSignature } from '../src/internal-service-auth.ts';
import { can } from '@2j/permissions';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: staff Bunker SSO tests cannot be skipped.');
process.env.NODE_ENV = 'test';
const sql = postgres(process.env.DATABASE_URL, { max: 8, connect_timeout: 5 });
await migrateDatabase(sql);

const REDEEM = '/api/internal/platform/v2/staff-sso/redeem';
const ISSUE = '/api/staff/bunker/sso';
const bunkerKey = { id: 'qa-bunker-staff-v1', secret: Buffer.alloc(32, 21).toString('base64url') };
const homeKey = { id: 'qa-home-staff-v1', secret: Buffer.alloc(32, 22).toString('base64url') };
const keys = { [bunkerKey.id]: { caller: 'bunker', secret: bunkerKey.secret }, [homeKey.id]: { caller: 'home', secret: homeKey.secret } };
const redirectUrl = 'http://127.0.0.1:8081/admin/sso';
const origin = 'http://127.0.0.1:5173';
let currentContext = null;
const base = { trainingCapabilitiesKeys: keys, bunkerAdminSsoRedirectUrl: redirectUrl, authorizationResolver: async () => currentContext, logger: false };
const app = buildServer(process.env.DATABASE_URL, { ...base, bunkerAdminSsoEnabled: true });
const disabledApp = buildServer(process.env.DATABASE_URL, base);
after(async () => { await Promise.all([app.close(), disabledApp.close()]); await sql.end(); });

const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const challengeFor = verifier => createHash('sha256').update(verifier, 'ascii').digest('base64url');
const verifiers = new Map();
const headers = { 'content-type': 'application/json', origin };

/** A staff member as Platform stores them: person, active auth subject, active professional with a base role (the profile), and a live staff session. */
async function createStaff(role = 'admin') {
  const personId = randomUUID(), subjectId = randomUUID(), authSubject = `staff-sso-${randomUUID()}`;
  await sql`INSERT INTO platform_persons(id,created_by) VALUES (${personId},'staff-sso-test')`;
  await sql`INSERT INTO platform_person_auth_subjects(id,person_id,auth_subject,provider,status,created_by) VALUES (${subjectId},${personId},${authSubject},'platform-passkey','active','staff-sso-test')`;
  const [professional] = await sql`INSERT INTO staff_professionals(first_name,last_name,display_name,base_role,auth_actor_id,created_by) VALUES ('Test','Staff','Test Staff',${role},${authSubject},'staff-sso-test') RETURNING id`;
  await sql`INSERT INTO platform_person_staff(person_id,professional_id,linked_by) VALUES (${personId},${professional.id},'staff-sso-test')`;
  const sessionHash = hash(randomBytes(32).toString('base64url'));
  await sql`INSERT INTO platform_staff_sessions(session_hash,person_id,auth_subject_link_id,expires_at) VALUES (${sessionHash},${personId},${subjectId},now()+interval '1 hour')`;
  return { personId, subjectId, authSubject, professionalId: professional.id, sessionHash, context: { actorId: authSubject, personId, role } };
}

async function issue(staff, { server = app, extraHeaders = {} } = {}) {
  currentContext = staff?.context ?? null;
  const verifier = randomBytes(32).toString('base64url');
  const response = await server.inject({ method: 'POST', url: ISSUE, headers: { ...headers, ...extraHeaders }, payload: { challenge: challengeFor(verifier) } });
  const code = response.statusCode === 201 ? new URL(response.json().redirectUrl).hash.slice('#code='.length) : null;
  if (code) verifiers.set(code, verifier);
  return { response, code, verifier };
}

function redeemRequest(code, overrides = {}) {
  const requestId = overrides.requestId ?? randomUUID();
  const timestamp = overrides.timestamp ?? new Date().toISOString();
  const key = overrides.key ?? bunkerKey;
  const body = Buffer.from(JSON.stringify({ v: 2, code, verifier: verifiers.get(code) ?? randomBytes(32).toString('base64url'), audience: '2j-bunker-admin-sso', purpose: 'bunker-admin-session', ...overrides.body }), 'utf8');
  const signature = overrides.signature ?? signedRequestSignature(key.secret, { keyId: key.id, timestamp, requestId, method: 'POST', path: REDEEM, body });
  return { method: 'POST', url: REDEEM, headers: { 'content-type': 'application/json', 'x-2j-key-id': key.id, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signature }, payload: body };
}

test('the permission is per profile: admin and owner profiles have it, the other profiles do not, and nobody gets it per person', () => {
  assert.equal(can({ actorId: 'a', role: 'admin' }, 'bunker.admin.access'), true);
  for (const role of ['trainer', 'reception-management', 'accountant']) assert.equal(can({ actorId: 'a', role }, 'bunker.admin.access'), false, role);
  assert.equal(can({ actorId: 'a', role: 'owner' }, 'bunker.admin.access'), false, 'the owner profile has no inherited permissions');
  assert.equal(can({ actorId: 'a', role: 'owner', explicitPermissions: ['bunker.admin.access'] }, 'bunker.admin.access'), true);
  assert.equal(can({ actorId: 'a', role: 'admin', deniedPermissions: ['bunker.admin.access'] }, 'bunker.admin.access'), false);
});

test('session capabilities expose bunkerAdmin only to a profile that holds the permission', async () => {
  currentContext = { actorId: 'cap-admin', role: 'admin' };
  assert.equal((await app.inject({ method: 'GET', url: '/api/session/capabilities' })).json().bunkerAdmin, true);
  currentContext = { actorId: 'cap-trainer', role: 'trainer' };
  assert.equal((await app.inject({ method: 'GET', url: '/api/session/capabilities' })).json().bunkerAdmin, false);
});

test('no permission means no handoff: unauthenticated, wrong profile, cross-site and disabled requests issue nothing', async () => {
  const trainer = await createStaff('trainer');
  const admin = await createStaff('admin');
  const off = await issue(admin, { server: disabledApp });
  assert.equal(off.response.statusCode, 423);
  assert.equal((await issue(null)).response.statusCode, 401);
  const denied = await issue(trainer);
  assert.equal(denied.response.statusCode, 403); assert.equal(denied.response.json().error, 'permission_denied');
  assert.equal((await issue(admin, { extraHeaders: { origin: 'https://evil.example' } })).response.statusCode, 403);
  assert.equal((await issue(admin, { extraHeaders: { 'sec-fetch-site': 'cross-site' } })).response.statusCode, 403);
  currentContext = admin.context;
  assert.equal((await app.inject({ method: 'POST', url: ISSUE, headers, payload: {} })).statusCode, 400, 'a browser-binding challenge is required');
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM platform_staff_sso_codes WHERE person_id IN (${trainer.personId},${admin.personId})`;
  assert.equal(n, 0, 'nothing was stored for any rejected request');
});

test('a permitted profile gets a handoff with its own audience and purpose; only the hash of the code is stored', async () => {
  const admin = await createStaff('admin');
  const { response, code } = await issue(admin);
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.ok(response.json().redirectUrl.startsWith(`${redirectUrl}#code=`), 'the code travels in the URL fragment only');
  const [row] = await sql`SELECT code_hash,audience,purpose,state,EXTRACT(EPOCH FROM expires_at-created_at)::int AS ttl FROM platform_staff_sso_codes WHERE person_id=${admin.personId}`;
  assert.equal(row.code_hash.trim(), hash(code)); assert.notEqual(row.code_hash.trim(), code);
  assert.equal(row.audience, '2j-bunker-admin-sso'); assert.equal(row.purpose, 'bunker-admin-session'); assert.equal(row.state, 'pending');
  assert.ok(row.ttl > 0 && row.ttl <= 60);
  const dump = JSON.stringify(await sql`SELECT * FROM platform_identity_audit_events WHERE person_id=${admin.personId}`);
  assert.ok(!dump.includes(code), 'audit never contains the code');
  await assert.rejects(sql`INSERT INTO platform_staff_sso_codes(code_hash,person_id,auth_subject_link_id,audience,purpose,binding_challenge,expires_at) VALUES (${hash('x')},${admin.personId},${admin.subjectId},'2j-training-sso','training-session',${challengeFor('v')},now()+interval '30 seconds')`, { code: '23514' });
});

test('redemption is Bunker-only, single-use, replay-safe and maps the handoff to the same Platform person', async () => {
  const admin = await createStaff('admin');
  const { code } = await issue(admin);
  assert.equal((await app.inject({ method: 'POST', url: REDEEM, headers: { 'content-type': 'application/json' }, payload: { v: 2, code } })).statusCode, 401);
  assert.equal((await app.inject(redeemRequest(code, { signature: 'A'.repeat(43) }))).statusCode, 401);
  assert.equal((await app.inject(redeemRequest(code, { key: homeKey }))).statusCode, 403, 'only the Bunker service may redeem');
  assert.equal((await disabledApp.inject(redeemRequest(code))).statusCode, 423);
  assert.equal((await app.inject(redeemRequest(randomBytes(32).toString('base64url')))).statusCode, 404);
  const ok = await app.inject(redeemRequest(code));
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual(ok.json(), { v: 1, personId: admin.personId, authSubject: admin.authSubject, role: 'admin', permission: 'bunker.admin.access' });
  const again = await app.inject(redeemRequest(code));
  assert.equal(again.statusCode, 409); assert.equal(again.json().error, 'sso_code_already_used');
  const actions = (await sql`SELECT action FROM platform_identity_audit_events WHERE person_id=${admin.personId} AND action LIKE 'staff.bunker_sso_%' ORDER BY occurred_at,id`).map(item => item.action);
  assert.deepEqual(actions, ['staff.bunker_sso_issued', 'staff.bunker_sso_redeemed', 'staff.bunker_sso_rejected']);
});

test('wrong audience or purpose is rejected, including a member Training SSO context', async () => {
  const admin = await createStaff('admin');
  const { code } = await issue(admin);
  for (const body of [{ audience: '2j-training-sso', purpose: 'training-session' }, { audience: '2j-bunker-admin-sso', purpose: 'training-session' }, { audience: 'other', purpose: 'bunker-admin-session' }]) {
    const rejected = await app.inject(redeemRequest(code, { body }));
    assert.equal(rejected.statusCode, 409, JSON.stringify(body)); assert.equal(rejected.json().error, 'sso_context_mismatch');
  }
  assert.equal((await sql`SELECT state FROM platform_staff_sso_codes WHERE code_hash=${hash(code)}`)[0].state, 'pending', 'rejected attempts do not consume the code');
  assert.equal((await app.inject(redeemRequest(code))).statusCode, 200);
});

test('expired handoffs are rejected and finalised', async () => {
  const admin = await createStaff('admin');
  const code = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
  verifiers.set(code, verifier);
  await sql`INSERT INTO platform_staff_sso_codes(code_hash,person_id,auth_subject_link_id,audience,purpose,binding_challenge,expires_at) VALUES (${hash(code)},${admin.personId},${admin.subjectId},'2j-bunker-admin-sso','bunker-admin-session',${challengeFor(verifier)},now()+interval '1 second')`;
  await new Promise(resolve => setTimeout(resolve, 1300));
  const expired = await app.inject(redeemRequest(code));
  assert.equal(expired.statusCode, 410); assert.equal(expired.json().error, 'sso_code_expired');
  const [row] = await sql`SELECT state,terminal_reason FROM platform_staff_sso_codes WHERE code_hash=${hash(code)}`;
  assert.equal(row.state, 'expired'); assert.equal(row.terminal_reason, 'ttl_elapsed');
  assert.equal((await app.inject(redeemRequest(code))).statusCode, 410, 'still rejected afterwards');
});

test('replay and concurrency: exactly one redemption wins; a newer handoff supersedes the previous one', async () => {
  const admin = await createStaff('admin');
  const { code } = await issue(admin);
  const results = await Promise.all([app.inject(redeemRequest(code)), app.inject(redeemRequest(code)), app.inject(redeemRequest(code))]);
  assert.deepEqual(results.map(item => item.statusCode).sort(), [200, 409, 409]);
  const first = await issue(admin), second = await issue(admin);
  const superseded = await app.inject(redeemRequest(first.code));
  assert.equal(superseded.statusCode, 409); assert.equal(superseded.json().error, 'sso_code_revoked');
  assert.equal((await app.inject(redeemRequest(second.code))).statusCode, 200);
});

test('binding to the starting browser: a wrong verifier is refused and does not burn the code', async () => {
  const admin = await createStaff('admin');
  const { code } = await issue(admin);
  const wrong = await app.inject(redeemRequest(code, { body: { verifier: randomBytes(32).toString('base64url') } }));
  assert.equal(wrong.statusCode, 403); assert.equal(wrong.json().error, 'sso_binding_mismatch');
  assert.equal((await app.inject(redeemRequest(code))).statusCode, 200);
});

test('access is re-read at redemption: a profile change, deactivation or sign-out inside the window refuses the handoff', async () => {
  const demoted = await createStaff('admin');
  const demotedCode = (await issue(demoted)).code;
  await sql`UPDATE staff_professionals SET base_role='trainer' WHERE id=${demoted.professionalId}`;
  const afterDemotion = await app.inject(redeemRequest(demotedCode));
  assert.equal(afterDemotion.statusCode, 403); assert.equal(afterDemotion.json().error, 'bunker_access_denied');
  assert.equal((await sql`SELECT terminal_reason FROM platform_staff_sso_codes WHERE code_hash=${hash(demotedCode)}`)[0].terminal_reason, 'permission_changed');

  const signedOut = await createStaff('admin');
  const signedOutCode = (await issue(signedOut)).code;
  await sql`UPDATE platform_staff_sessions SET revoked_at=now() WHERE session_hash=${signedOut.sessionHash}`;
  assert.equal((await app.inject(redeemRequest(signedOutCode))).statusCode, 403);

  const deactivated = await createStaff('admin');
  const deactivatedCode = (await issue(deactivated)).code;
  await sql`UPDATE staff_professionals SET status='inactive' WHERE id=${deactivated.professionalId}`;
  assert.equal((await app.inject(redeemRequest(deactivatedCode))).statusCode, 403);
});

test('the configured owner holds the permission through the owner grants and can redeem, without a staff professional record', async () => {
  const personId = randomUUID(), subjectId = randomUUID(), authSubject = `owner-sso-${randomUUID()}`;
  await sql`INSERT INTO platform_persons(id,created_by) VALUES (${personId},'staff-sso-test')`;
  await sql`INSERT INTO platform_person_auth_subjects(id,person_id,auth_subject,provider,status,created_by) VALUES (${subjectId},${personId},${authSubject},'platform-passkey','active','staff-sso-test')`;
  await sql`INSERT INTO platform_staff_sessions(session_hash,person_id,auth_subject_link_id,expires_at) VALUES (${hash(randomBytes(32).toString('base64url'))},${personId},${subjectId},now()+interval '1 hour')`;
  const ownerApp = buildServer(process.env.DATABASE_URL, { ...base, bunkerAdminSsoEnabled: true, ownerPersonId: personId });
  try {
    const owner = { context: { actorId: authSubject, personId, role: 'owner', explicitPermissions: ['bunker.admin.access'] } };
    const { code } = await issue(owner, { server: ownerApp });
    assert.ok(code);
    const ok = await ownerApp.inject(redeemRequest(code));
    assert.equal(ok.statusCode, 200, ok.body); assert.equal(ok.json().role, 'owner');
    const withoutGrant = await issue({ context: { actorId: authSubject, personId, role: 'owner' } }, { server: ownerApp });
    assert.equal(withoutGrant.response.statusCode, 403, 'the owner role alone carries no inherited permission');
  } finally { await ownerApp.close(); }
});
