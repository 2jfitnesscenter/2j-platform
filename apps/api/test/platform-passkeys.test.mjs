import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { rpIdMatchesOrigin } from '../src/platform-passkeys.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: Platform passkey tests cannot be skipped.');
process.env.NODE_ENV = 'test';
const sql = postgres(process.env.DATABASE_URL, { max: 8, connect_timeout: 5 });
await migrateDatabase(sql);

const RP_ID = 'localhost', ORIGIN = 'http://localhost:5173';
const b64 = value => Buffer.from(value).toString('base64url');
const sha = value => createHash('sha256').update(value).digest();

/* ------------------------------------------------ a tiny virtual authenticator (ES256, "none" attestation) */
const head = (major, n) => n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
const cbor = value => {
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === 'string') { const raw = Buffer.from(value, 'utf8'); return Buffer.concat([head(3, raw.length), raw]); }
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (value instanceof Map) return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
  throw new Error('unsupported cbor value');
};
const counterBytes = n => { const out = Buffer.alloc(4); out.writeUInt32BE(n); return out; };
function createAuthenticator({ rpId = RP_ID, origin = ORIGIN } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credentialId = randomBytes(32);
  const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
  const device = {
    credentialId: b64(credentialId), counter: 0,
    register(challenge, overrides = {}) {
      const authData = Buffer.concat([sha(overrides.rpId ?? rpId), Buffer.from([0x45]), counterBytes(0), Buffer.alloc(16), Buffer.from([credentialId.length >> 8, credentialId.length & 255]), credentialId, cose]);
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin: overrides.origin ?? origin, crossOrigin: false }));
      return { id: device.credentialId, rawId: device.credentialId, type: 'public-key', response: { clientDataJSON: b64(clientData), attestationObject: b64(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))), transports: ['internal'] }, clientExtensionResults: {} };
    },
    assert(challenge, overrides = {}) {
      const counter = overrides.counter ?? ++device.counter;
      const authData = Buffer.concat([sha(overrides.rpId ?? rpId), Buffer.from([overrides.flags ?? 0x05]), counterBytes(counter)]);
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: overrides.origin ?? origin, crossOrigin: false }));
      const signature = sign('sha256', Buffer.concat([authData, sha(clientData)]), overrides.privateKey ?? privateKey);
      return { id: device.credentialId, rawId: device.credentialId, type: 'public-key', response: { authenticatorData: b64(authData), clientDataJSON: b64(clientData), signature: b64(signature) }, clientExtensionResults: {} };
    },
    otherKey: () => generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey,
  };
  return device;
}

let actor = { actorId: 'qa-admin', role: 'admin' };
const flags = { logger: process.env.TEST_LOG ? { level: 'error' } : false, memberAppOrigin: ORIGIN, authorizationResolver: async () => actor };
const app = buildServer(process.env.DATABASE_URL, { ...flags, platformPasskeysEnabled: true, platformPasskeyRpId: RP_ID, platformPasskeyMaxRequestsPerMinute: 10_000, trainingVerifiedLinkingEnabled: true });
const throttled = buildServer(process.env.DATABASE_URL, { ...flags, platformPasskeysEnabled: true, platformPasskeyRpId: RP_ID, platformPasskeyMaxRequestsPerMinute: 3 });
const off = buildServer(process.env.DATABASE_URL, { ...flags, memberPilotAuthEnabled: true });
after(async () => { await Promise.all([app.close(), off.close(), throttled.close()]); await sql.end(); });

const post = (server, url, payload, headers = {}) => server.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers }, payload: payload ?? {} });
async function createPerson() {
  const personId = randomUUID();
  await sql`INSERT INTO platform_persons(id,created_by) VALUES (${personId},'passkey-test')`;
  return personId;
}
async function enroll(personId) {
  const issued = await post(app, `/api/platform/v1/persons/${personId}/passkey-enrollments`, {}, { origin: 'http://admin.invalid' });
  assert.equal(issued.statusCode, 201, issued.body);
  return issued.json().enrollmentToken;
}
async function registerDevice(personId, device = createAuthenticator()) {
  const enrollmentToken = await enroll(personId);
  const begin = await post(app, '/api/me/passkeys/register/options', { enrollmentToken });
  assert.equal(begin.statusCode, 200, begin.body);
  const { challengeId, options } = begin.json();
  assert.equal(options.rp.id, RP_ID); assert.equal(options.authenticatorSelection.userVerification, 'required'); assert.equal(options.authenticatorSelection.residentKey, 'required'); assert.equal(options.attestation, 'none');
  const done = await post(app, '/api/me/passkeys/register/verify', { enrollmentToken, challengeId, response: device.register(options.challenge) });
  assert.equal(done.statusCode, 201, done.body);
  return { device, enrollmentToken };
}
async function loginOptions() {
  const begin = await post(app, '/api/me/passkeys/login/options');
  assert.equal(begin.statusCode, 200, begin.body);
  return begin.json();
}
async function login(device, overrides = {}) {
  const { challengeId, options } = await loginOptions();
  return post(app, '/api/me/passkeys/login/verify', { challengeId, response: device.assert(options.challenge, overrides) });
}
const cookieOf = response => String(response.headers['set-cookie']).split(';')[0];
const sessionWorks = async cookie => (await post(app, '/api/platform/v1/training-link-transactions', { requestId: randomUUID() }, { cookie })).statusCode;

test('relying-party id must match the member origin; passkeys are off by default and refused outside development/test', async () => {
  assert.equal(rpIdMatchesOrigin('home.2jfitnesscenter.com', 'https://home.2jfitnesscenter.com'), true);
  assert.equal(rpIdMatchesOrigin('2jfitnesscenter.com', 'https://home.2jfitnesscenter.com'), true, 'a registrable parent is valid but would widen the credential scope');
  assert.equal(rpIdMatchesOrigin('other.example', 'https://home.2jfitnesscenter.com'), false);
  assert.equal(rpIdMatchesOrigin('com', 'https://home.2jfitnesscenter.com'), false);
  assert.equal(rpIdMatchesOrigin('127.0.0.1', 'http://127.0.0.1:5173'), false);
  assert.equal(rpIdMatchesOrigin('home.2jfitnesscenter.com', 'http://home.2jfitnesscenter.com'), false, 'plain http only for loopback');
  assert.throws(() => buildServer(process.env.DATABASE_URL, { ...flags, platformPasskeysEnabled: true, platformPasskeyRpId: 'evil.example' }), /relying-party/);
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try { assert.throws(() => buildServer(process.env.DATABASE_URL, { ...flags, platformPasskeysEnabled: true, platformPasskeyRpId: RP_ID }), /restricted to development\/test/); } finally { process.env.NODE_ENV = previous; }
  const disabled = await post(off, '/api/me/passkeys/login/options');
  assert.equal(disabled.statusCode, 423); assert.equal(disabled.json().error, 'platform_passkeys_disabled');
  assert.equal((await post(off, `/api/platform/v1/persons/${randomUUID()}/passkey-enrollments`)).statusCode, 423);
});

test('enrollment is admin-issued, single-use, hash-only; registration verifies a real WebAuthn attestation bound to rpId and origin', async () => {
  const personId = await createPerson();
  actor = { actorId: 'qa-trainer', role: 'trainer' };
  assert.equal((await post(app, `/api/platform/v1/persons/${personId}/passkey-enrollments`)).statusCode, 403);
  actor = { actorId: 'qa-admin', role: 'admin' };
  assert.equal((await post(app, `/api/platform/v1/persons/${randomUUID()}/passkey-enrollments`)).statusCode, 404);
  const token = await enroll(personId);
  const stored = await sql`SELECT token_hash FROM platform_passkey_enrollments WHERE person_id=${personId}`;
  assert.equal(stored.length, 1); assert.notEqual(stored[0].token_hash.trim(), token); assert.equal(stored[0].token_hash.trim(), createHash('sha256').update(token).digest('hex'));
  // wrong origin / bad token
  assert.equal((await post(app, '/api/me/passkeys/register/options', { enrollmentToken: token }, { origin: 'https://evil.example' })).statusCode, 403);
  assert.equal((await post(app, '/api/me/passkeys/register/options', { enrollmentToken: randomBytes(32).toString('base64url') })).statusCode, 401);
  // attestation for a different rp id / origin is refused and the challenge is spent
  const device = createAuthenticator();
  const begin = (await post(app, '/api/me/passkeys/register/options', { enrollmentToken: token })).json();
  const wrongRp = await post(app, '/api/me/passkeys/register/verify', { enrollmentToken: token, challengeId: begin.challengeId, response: device.register(begin.options.challenge, { rpId: 'other.example' }) });
  assert.equal(wrongRp.statusCode, 400);
  const replay = await post(app, '/api/me/passkeys/register/verify', { enrollmentToken: token, challengeId: begin.challengeId, response: device.register(begin.options.challenge) });
  assert.equal(replay.statusCode, 401, 'a challenge is single-use even after a failed attempt');
  const second = (await post(app, '/api/me/passkeys/register/options', { enrollmentToken: token })).json();
  const wrongOrigin = await post(app, '/api/me/passkeys/register/verify', { enrollmentToken: token, challengeId: second.challengeId, response: device.register(second.options.challenge, { origin: 'https://evil.example' }) });
  assert.equal(wrongOrigin.statusCode, 400);
  const third = (await post(app, '/api/me/passkeys/register/options', { enrollmentToken: token })).json();
  const ok = await post(app, '/api/me/passkeys/register/verify', { enrollmentToken: token, challengeId: third.challengeId, response: device.register(third.options.challenge) });
  assert.equal(ok.statusCode, 201, ok.body);
  assert.equal((await post(app, '/api/me/passkeys/register/options', { enrollmentToken: token })).statusCode, 401, 'enrollment is spent');
  const [key] = await sql`SELECT rp_id,sign_count,status FROM platform_passkeys WHERE person_id=${personId}`;
  assert.equal(key.rp_id, RP_ID); assert.equal(Number(key.sign_count), 0); assert.equal(key.status, 'active');
  const [subject] = await sql`SELECT provider,status FROM platform_person_auth_subjects WHERE person_id=${personId}`;
  assert.equal(subject.provider, 'platform-passkey'); assert.equal(subject.status, 'active');
  // an issued-but-unused older enrollment is retired by a newer one
  const t1 = await enroll(personId), t2 = await enroll(personId);
  assert.equal((await post(app, '/api/me/passkeys/register/options', { enrollmentToken: t1 })).statusCode, 401);
  assert.equal((await post(app, '/api/me/passkeys/register/options', { enrollmentToken: t2 })).statusCode, 200);
  // a challenge of one enrollment cannot finish another's ceremony
  const person2 = await createPerson(), token2 = await enroll(person2);
  const mine = (await post(app, '/api/me/passkeys/register/options', { enrollmentToken: token2 })).json();
  const other = (await post(app, '/api/me/passkeys/register/options', { enrollmentToken: t2 })).json();
  const crossed = await post(app, '/api/me/passkeys/register/verify', { enrollmentToken: token2, challengeId: other.challengeId, response: createAuthenticator().register(other.options.challenge) });
  assert.equal(crossed.statusCode, 401);
  assert.equal(mine.options.rp.id, RP_ID);
  // expired enrollment
  const expiredToken = randomBytes(32).toString('base64url');
  const [subj] = await sql`SELECT id FROM platform_person_auth_subjects WHERE person_id=${person2}`;
  await sql`INSERT INTO platform_passkey_enrollments(token_hash,person_id,auth_subject_link_id,created_by,created_at,expires_at) VALUES (${createHash('sha256').update(expiredToken).digest('hex')},${person2},${subj.id},'test',now()-interval '2 hours',now()-interval '1 hour')`;
  assert.equal((await post(app, '/api/me/passkeys/register/options', { enrollmentToken: expiredToken })).statusCode, 401);
});

test('login: discoverable assertion creates a member session that resolves the person; sessions need a live active passkey', async () => {
  const personId = await createPerson();
  const { device } = await registerDevice(personId);
  assert.equal(await sessionWorks(''), 401, 'no cookie, no session');
  const ok = await login(device);
  assert.equal(ok.statusCode, 200, ok.body);
  const cookie = cookieOf(ok);
  assert.match(String(ok.headers['set-cookie']), /HttpOnly/); assert.match(String(ok.headers['set-cookie']), /SameSite=Lax/);
  assert.equal(await sessionWorks(cookie), 201, 'the passkey session resolves the person (verified linking is available to it)');
  const [key] = await sql`SELECT sign_count,last_used_at FROM platform_passkeys WHERE person_id=${personId}`;
  assert.equal(Number(key.sign_count), 1); assert.ok(key.last_used_at);
  assert.equal((await sql`SELECT count(*)::int AS n FROM platform_identity_audit_events WHERE person_id=${personId} AND action='passkey.login'`)[0].n, 1);
  // origin and CSRF
  const { challengeId, options } = await loginOptions();
  assert.equal((await post(app, '/api/me/passkeys/login/verify', { challengeId, response: device.assert(options.challenge) }, { origin: 'https://evil.example' })).statusCode, 403);
  // Revoking the passkeys ends the session and blocks new logins.
  const revoke = await post(app, `/api/platform/v1/persons/${personId}/passkeys/revoke`, { reason: 'lost device' });
  assert.equal(revoke.statusCode, 200); assert.equal(revoke.json().revokedPasskeys, 1);
  assert.equal(await sessionWorks(cookie), 401, 'existing session ended');
  assert.equal((await login(device)).statusCode, 401, 'revoked passkey cannot log in');
  await assert.rejects(sql`UPDATE platform_passkeys SET status='active',revoked_at=NULL WHERE person_id=${personId}`, { code: '55000' });
  assert.equal((await sql`SELECT count(*)::int AS n FROM platform_identity_audit_events WHERE person_id=${personId} AND action='passkey.revoked'`)[0].n, 1);
});

test('login rejects forged, replayed, wrong-origin, wrong-rp, no-UV and cloned-counter assertions, and never consumes a challenge twice', async () => {
  const personId = await createPerson();
  const { device } = await registerDevice(personId);
  const attempt = async overrides => login(device, overrides);
  assert.equal((await attempt({ privateKey: device.otherKey() })).statusCode, 401, 'signature by another key');
  assert.equal((await attempt({ origin: 'https://evil.example' })).statusCode, 401);
  assert.equal((await attempt({ rpId: 'other.example' })).statusCode, 401);
  assert.equal((await attempt({ flags: 0x01 })).statusCode, 401, 'user verification is mandatory');
  const good = await attempt({});
  assert.equal(good.statusCode, 200, good.body);
  assert.equal((await attempt({ counter: 1 })).statusCode, 401, 'counter regression indicates a cloned credential');
  assert.equal((await sql`SELECT count(*)::int AS n FROM platform_identity_audit_events WHERE person_id=${personId} AND action='passkey.login_rejected'`)[0].n >= 1, true);
  // replay of a captured assertion against a new challenge fails; the same challenge cannot be reused
  const { challengeId, options } = await loginOptions();
  const response = device.assert(options.challenge);
  assert.equal((await post(app, '/api/me/passkeys/login/verify', { challengeId, response })).statusCode, 200);
  assert.equal((await post(app, '/api/me/passkeys/login/verify', { challengeId, response })).statusCode, 401, 'challenge consumed');
  const next = await loginOptions();
  assert.equal((await post(app, '/api/me/passkeys/login/verify', { challengeId: next.challengeId, response })).statusCode, 401, 'assertion bound to the previous challenge');
  assert.equal((await post(app, '/api/me/passkeys/login/verify', { challengeId: randomUUID(), response })).statusCode, 401);
  assert.equal((await post(app, '/api/me/passkeys/login/verify', { challengeId: next.challengeId, response, extra: 1 })).statusCode, 400);
  // an unknown credential id is a plain rejection
  const stranger = createAuthenticator();
  const probe = await loginOptions();
  assert.equal((await post(app, '/api/me/passkeys/login/verify', { challengeId: probe.challengeId, response: stranger.assert(probe.options.challenge) })).statusCode, 401);
  // a suspended person (inactive) cannot log in even with a valid passkey
  await sql`UPDATE platform_person_auth_subjects SET status='revoked',revoked_at=now(),revoked_by='test' WHERE person_id=${personId}`;
  assert.equal((await login(device)).statusCode, 401, 'revoked auth subject');
});

test('ceremony endpoints are rate limited per client', async () => {
  const results = [];
  for (let i = 0; i < 5; i++) results.push((await post(throttled, '/api/me/passkeys/login/options')).statusCode);
  assert.deepEqual(results, [200, 200, 200, 429, 429]);
});
