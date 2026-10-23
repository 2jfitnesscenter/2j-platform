// End-to-end validation of the BILATERAL account link lifecycle between Platform and Búnker/Training:
// linking a historical account with its owner's proof, anti-takeover and anti-duplication, safe revocation (including an outage),
// idempotent provisioning (including an outage and retries). Same isolation rules as training-sso.e2e.mjs: loopback only, disposable
// PostgreSQL database, temp data directory, random secrets, minimal child environment. Nothing real is touched.
//
// Usage (from apps/api):
//   E2E_DATABASE_ADMIN_URL=postgres://user:pass@127.0.0.1:PORT/postgres E2E_BUNKER_API_DIR=<bunker>/api \
//     node --import tsx ../../tooling/e2e/training-link.e2e.mjs
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { activateTrainingLink, b64, childEnv, cookieOf, freePort, httpCall, passkeyCookieFor, randomSecret, resolveOutDir, sha256hex, sleep, startProcess, stopProcess, waitHttp } from './lib.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const platformApiDir = path.join(repoRoot, 'apps', 'api');
const bunkerApiDir = process.env.E2E_BUNKER_API_DIR ? path.resolve(process.env.E2E_BUNKER_API_DIR) : null;
const adminUrl = process.env.E2E_DATABASE_ADMIN_URL;
if (!adminUrl || !bunkerApiDir) throw new Error('Set E2E_DATABASE_ADMIN_URL (disposable PostgreSQL) and E2E_BUNKER_API_DIR (Búnker api folder).');
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(adminUrl).hostname)) throw new Error('E2E only runs against a loopback database.');

const out = resolveOutDir('link', repoRoot);
const requireFromApi = createRequire(path.join(platformApiDir, 'package.json'));
const postgres = await import(pathToFileURL(requireFromApi.resolve('postgres')).href).then(m => m.default ?? m);

const MEMBER_ORIGIN = 'http://127.0.0.1:5173';
const BUNKER_SECRET_TEXT = randomSecret();
const platformKey = { id: 'e2e-bunker-v1', secret: randomBytes(32) };     // Búnker -> Platform (capabilities)
const proofKey = { id: 'e2e-platform-v1', secret: randomBytes(32) };       // Platform -> Búnker (proofs, link lifecycle, provisioning)
const state = { platform: null, bunker: null, sql: null, dbName: null, dbUrl: null, ports: {}, people: {}, cases: [], secrets: new Set() };
const bunkerPasskeyCookie = passkeyCookieFor(BUNKER_SECRET_TEXT);
const P = () => `http://127.0.0.1:${state.ports.platform}`;
const B = () => `http://localhost:${state.ports.bunker}`;
const remember = value => { if (value) state.secrets.add(value); return value; };
const padmin = (method, route, body, headers = {}) => httpCall(P(), method, route, { body, headers: { 'idempotency-key': randomUUID(), ...headers } });
const bunkerDb = () => { for (let i = 0; i < 20; i++) { try { return JSON.parse(fs.readFileSync(path.join(out, 'bunker-data', 'db.json'), 'utf8')); } catch { /* being written */ } } throw new Error('db.json unreadable'); };
const waitFor = async (check, label) => { for (let i = 0; i < 60; i++) { const value = check(); if (value) return value; await sleep(100); } throw new Error(`timeout waiting for ${label}`); };
const bunkerUser = id => bunkerDb().users.find(user => user.id === id);

async function startPlatform() {
  state.platform = startProcess(out, 'platform', ['--import', 'tsx', 'src/server.ts'], platformApiDir, {
    DATABASE_URL: state.dbUrl, HOST: '127.0.0.1', PORT: String(state.ports.platform), NODE_ENV: 'development', LOCAL_DEMO_ROLE: 'admin',
    PILOT_MEMBER_AUTH_ENABLED: 'true', MEMBER_APP_ORIGIN: MEMBER_ORIGIN, CORS_ORIGIN: MEMBER_ORIGIN,
    PLATFORM_INTERNAL_SERVICE_KEYS: JSON.stringify({ [platformKey.id]: { caller: 'bunker', secret: b64(platformKey.secret) } }),
    TRAINING_SSO_ENABLED: 'true', TRAINING_SSO_REDIRECT_URL: `http://localhost:${state.ports.bunker}/sso`,
    TRAINING_SERVICE_CALLS_ENABLED: 'true', TRAINING_VERIFIED_LINKING_ENABLED: 'true', TRAINING_CANONICAL_LINKING_ENABLED: 'true',
    TRAINING_LINK_LIFECYCLE_ENABLED: 'true', TRAINING_PROVISIONING_ENABLED: 'true', TRAINING_SERVICE_ALLOW_INSECURE_LOOPBACK: 'true',
    TRAINING_SERVICE_BASE_URL: `http://localhost:${state.ports.bunker}`, TRAINING_SERVICE_KEY_ID: proofKey.id, TRAINING_SERVICE_SECRET: b64(proofKey.secret),
  });
  await waitHttp(`${P()}/health`, 'Platform', out);
}
async function startBunker() {
  state.bunker = startProcess(out, 'bunker', ['server.js'], bunkerApiDir, {
    PORT: String(state.ports.bunker), DATA_DIR: path.join(out, 'bunker-data'), SECRET_FILE: path.join(out, 'bunker-data', 'secret'), RP_ID: 'localhost', ORIGIN: B(),
    PLATFORM_SSO_ENABLED: 'true', PLATFORM_API_BASE_URL: P(), PLATFORM_API_KEY_ID: platformKey.id, PLATFORM_API_KEY_SECRET: b64(platformKey.secret),
    PLATFORM_PROOF_ISSUANCE_ENABLED: 'true', PLATFORM_PROOF_EXCHANGE_ENABLED: 'true', PLATFORM_PROOF_RECONCILIATION_ENABLED: 'true', PLATFORM_LINK_LIFECYCLE_ENABLED: 'true', PLATFORM_PROVISIONING_ENABLED: 'true',
    PLATFORM_SERVICE_AUTH_KEYS: JSON.stringify({ [proofKey.id]: b64(proofKey.secret) }),
  });
  await waitHttp(`${B()}/api/health`, 'Búnker', out);
}
const restartBunker = async () => { await stopProcess(state.bunker); await startBunker(); };

async function createPerson(label, { pilot = true } = {}) {
  const client = await padmin('POST', '/api/clients', { firstName: label, lastName: 'Link E2E' });
  assert.equal(client.status, 201, client.text);
  const person = await padmin('POST', '/api/platform/v1/persons', { clientId: client.json.id });
  assert.equal(person.status, 201, person.text);
  const personId = person.json.personId, entry = { label, personId, clientId: client.json.id };
  if (pilot) {
    const code = remember(`code-${label}-${randomUUID()}`), subjectId = randomUUID();
    await state.sql`INSERT INTO platform_person_auth_subjects(id,person_id,auth_subject,provider,status,created_by) VALUES (${subjectId},${personId},${`link-subject-${label}`},'platform-pilot','active','e2e')`;
    await state.sql`INSERT INTO platform_member_pilot_credentials(auth_subject_link_id,code_hash) VALUES (${subjectId},${sha256hex(code)})`;
    entry.memberCode = code;
  }
  state.people[label] = entry;
  return entry;
}
async function memberCookie(label) {
  const person = state.people[label];
  if (person.cookie) return person.cookie;
  const response = await httpCall(P(), 'POST', '/api/pilot/member/login', { body: { code: person.memberCode }, headers: { origin: MEMBER_ORIGIN } });
  assert.equal(response.status, 200, response.text);
  return (person.cookie = remember(cookieOf(response)));
}
const member = async (label, method, route, body) => httpCall(P(), method, route, { cookie: await memberCookie(label), body, headers: { origin: MEMBER_ORIGIN } });

/** What the Home client does to finish linking an existing Training account: challenge -> owner proof at Búnker -> verify at Platform. */
async function linkViaProof(label, trainingUserId, { proofFor = trainingUserId, personForProof = label } = {}) {
  const person = state.people[label];
  const created = await member(label, 'POST', '/api/platform/v1/training-link-transactions', { requestId: randomUUID() });
  assert.equal(created.status, 201, created.text);
  const { transaction, challenge } = created.json; remember(challenge);
  const context = { transactionId: transaction.transactionId, personId: state.people[personForProof].personId, audience: '2j-training-account-link', purpose: 'training-account-link', challengeDigest: sha256hex(challenge) };
  const issued = await httpCall(B(), 'POST', '/api/platform/v1/link-proofs', { cookie: bunkerPasskeyCookie(proofFor), body: { v: 1, ...context, expiresAt: new Date(Date.now() + 240_000).toISOString() } });
  if (issued.status !== 201) return { issued };
  remember(issued.json.code);
  return { issued, response: await member(label, 'POST', '/api/me/training/link', { transactionId: transaction.transactionId, challenge, code: issued.json.code }), person, trainingUserId };
}
const platformLinks = label => state.sql`SELECT link_id,status,method,training_user_id,training_ack_id,revocation_ack_id FROM training_account_links WHERE person_id=${state.people[label].personId} ORDER BY created_at`;
async function ssoCookie(label) {
  const started = await member(label, 'POST', '/api/me/training/sso', {});
  if (started.status !== 201) return { started };
  const code = remember(new URL(started.json.redirectUrl).hash.slice('#code='.length));
  const redeemed = await httpCall(B(), 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code }, headers: { origin: B() } });
  return { started, redeemed, cookie: remember(cookieOf(redeemed)) };
}

before(async () => {
  state.ports = { platform: await freePort(), bunker: await freePort() };
  state.dbName = `e2elink_${randomUUID().replaceAll('-', '')}`;
  const admin = postgres(adminUrl, { max: 1, connect_timeout: 5 });
  await admin.unsafe(`CREATE DATABASE "${state.dbName}"`); await admin.end();
  const dbUrl = new URL(adminUrl); dbUrl.pathname = `/${state.dbName}`; state.dbUrl = dbUrl.toString();
  state.sql = postgres(state.dbUrl, { max: 4, connect_timeout: 5 });
  await new Promise((resolve, reject) => spawn(process.execPath, ['--import', 'tsx', 'src/migrate.ts'], { cwd: platformApiDir, env: childEnv({ DATABASE_URL: state.dbUrl }), stdio: 'ignore', windowsHide: true })
    .on('exit', code => code === 0 ? resolve() : reject(new Error(`migrate exited ${code}`))));
  await startPlatform();
  const dataDir = path.join(out, 'bunker-data'); fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'secret'), BUNKER_SECRET_TEXT, { mode: 0o600 });
  const users = ['hist-a', 'hist-b'].map(id => ({ id, name: `Histórico ${id}`, username: id, created: '2025-01-01T00:00:00.000Z' }));
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users, creds: [], subs: [], invites: [], recoveries: [] }, null, 2));
  for (const { id } of users) fs.writeFileSync(path.join(dataDir, `state-${id}.json`), JSON.stringify({ unit: 'kg', lang: 'es', routines: [{ id: 'r-hist', name: `Rutina histórica ${id}`, emoji: '💪', ex: [{ id: '0001', sets: 3, reps: 10, mode: 'reps', weight: 20 }] }], workouts: [{ d: '2026-09-01', routineId: 'r-hist' }] }));
  await startBunker();
  for (const label of ['a', 'b', 'c', 'd']) await createPerson(label, { pilot: label !== 'd' });
});

after(async () => {
  await stopProcess(state.bunker); await stopProcess(state.platform);
  try { await state.sql?.end(); } catch { /* closing */ }
  try { const admin = postgres(adminUrl, { max: 1 }); await admin.unsafe(`DROP DATABASE IF EXISTS "${state.dbName}" WITH (FORCE)`); await admin.end(); } catch { /* disposable */ }
  console.log(`E2E link report: ${JSON.stringify(state.cases)}`);
  if (process.env.E2E_KEEP === '1') console.log(`E2E artefacts kept in ${out}`); else fs.rmSync(out, { recursive: true, force: true });
});

const E2E = (id, title, fn) => test(`E2E-LINK ${id} — ${title}`, async () => {
  try { await fn(); state.cases.push({ id, title, result: 'pass' }); }
  catch (error) { state.cases.push({ id, title, result: 'FAIL', error: String(error?.message ?? error).slice(0, 400) }); throw error; }
});

E2E('L1', 'a historical account links only with its owner\'s proof; both sides acknowledge; history untouched; SSO then works', async () => {
  const unlinked = await ssoCookie('a');
  assert.notEqual(unlinked.started.status, 201, 'no link, no SSO');
  const done = await linkViaProof('a', 'hist-a');
  assert.equal(done.response.status, 200, done.response.text); assert.equal(done.response.json.status, 'active');
  const [link] = await platformLinks('a');
  assert.equal(link.status, 'active'); assert.equal(link.method, 'verified_training_proof'); assert.ok(link.training_ack_id);
  const user = await waitFor(() => { const u = bunkerUser('hist-a'); return u?.platformLink?.state === 'active' ? u : null; }, 'Búnker link');
  assert.equal(user.personId, state.people.a.personId); assert.equal(user.platformLink.origin, 'proof');
  const sso = await ssoCookie('a');
  assert.equal(sso.redeemed.status, 200, sso.redeemed.text);
  const data = await httpCall(B(), 'GET', '/api/data', { cookie: sso.cookie });
  assert.equal(data.status, 200); assert.match(JSON.stringify(data.json), /Rutina histórica hist-a/, 'historical routines survive the link');
  state.people.a.sso = sso.cookie;
});

E2E('L2', 'takeover is refused: a fabricated proof and a signed Platform call without the owner evidence', async () => {
  // B has no proof for hist-a: a fabricated code and A's own (already used) material are both rejected.
  const created = await member('b', 'POST', '/api/platform/v1/training-link-transactions', { requestId: randomUUID() });
  assert.equal(created.status, 201);
  remember(created.json.challenge);
  const forged = await member('b', 'POST', '/api/me/training/link', { transactionId: created.json.transaction.transactionId, challenge: created.json.challenge, code: randomBytes(32).toString('base64url') });
  assert.equal(forged.status, 409, forged.text); assert.equal(forged.json.error, 'proof_rejected');
  // A leaked Platform service key alone is not enough: Búnker demands its own evidence for a historical account.
  const [link] = await state.sql`INSERT INTO training_account_links(request_id,person_id,training_user_id,method,created_by,updated_by) VALUES (${randomUUID()},${state.people.b.personId},'hist-b','explicit_admin','e2e','e2e') RETURNING link_id`;
  const direct = await activateTrainingLink(B(), proofKey, { linkId: link.link_id, personId: state.people.b.personId, trainingUserId: 'hist-b' });
  assert.equal(direct.status, 409); assert.equal(direct.json.error, 'proof_required');
  assert.equal(bunkerUser('hist-b').platformLink, undefined);
});

E2E('L3', 'revocation closes the link on both sides, ends the Búnker sso session and a stale proof cannot re-link', async () => {
  const revoked = await member('a', 'DELETE', '/api/me/training/link');
  assert.equal(revoked.status, 200, revoked.text); assert.equal(revoked.json.status, 'revoked');
  const [link] = await platformLinks('a');
  assert.equal(link.status, 'revoked'); assert.ok(link.revocation_ack_id);
  const user = await waitFor(() => { const u = bunkerUser('hist-a'); return u?.platformLink?.state === 'revoked' ? u : null; }, 'Búnker revocation');
  assert.equal(user.personId, undefined, 'the person is freed');
  assert.notEqual((await httpCall(B(), 'GET', '/api/data', { cookie: state.people.a.sso })).status, 200, 'the sso session ended');
  assert.notEqual((await ssoCookie('a')).started.status, 201, 'no active link, no SSO');
  // Re-linking with the old material is impossible; a fresh proof works.
  const [row] = await state.sql`SELECT source_receipt_id FROM training_account_links WHERE person_id=${state.people.a.personId}`;
  const stale = await activateTrainingLink(B(), proofKey, { linkId: randomUUID(), linkVersion: 2, personId: state.people.a.personId, trainingUserId: 'hist-a' });
  assert.equal(stale.status, 409, 'old receipt predates the revocation'); assert.equal(stale.json.error, 'proof_required');
  assert.ok(row.source_receipt_id);
  const again = await linkViaProof('a', 'hist-a');
  assert.equal(again.response.status, 200, again.response.text);
});

E2E('L4', 'revocation while Búnker is down: access stops at once (revocation_pending), and the retry completes it', async () => {
  await stopProcess(state.bunker);
  const pending = await member('a', 'DELETE', '/api/me/training/link');
  assert.equal(pending.status, 202, pending.text); assert.equal(pending.json.status, 'revocation_pending');
  assert.equal((await platformLinks('a')).at(-1).status, 'revocation_pending');
  assert.notEqual((await member('a', 'POST', '/api/me/training/sso', {})).status, 201, 'Platform stops issuing SSO immediately');
  await startBunker();
  const done = await member('a', 'DELETE', '/api/me/training/link');
  assert.equal(done.status, 200, done.text);
  assert.equal((await platformLinks('a')).at(-1).status, 'revoked');
  await waitFor(() => bunkerUser('hist-a')?.platformLink?.state === 'revoked', 'Búnker revoked');
});

E2E('P1', 'provisioning creates one minimal enforced profile, is idempotent and the new member signs in with the free baseline', async () => {
  const key = randomUUID(), route = `/api/platform/v1/persons/${state.people.c.personId}/training-provision`;
  const first = await padmin('POST', route, { displayName: 'Nuevo Socio' }, { 'idempotency-key': key });
  assert.equal(first.status, 201, first.text); assert.equal(first.json.status, 'active');
  const trainingUserId = first.json.trainingUserId;
  const created = await waitFor(() => bunkerDb().users.filter(user => user.platformLink?.provisioningKey === key), 'provisioned user');
  assert.equal(created.length, 1); assert.equal(created[0].id, trainingUserId); assert.equal(created[0].platformEnforcement, 'enforced'); assert.equal(created[0].platformLink.state, 'active');
  assert.equal(created[0].personId, state.people.c.personId);
  const [link] = await platformLinks('c'); assert.equal(link.method, 'provisioned'); assert.equal(link.status, 'active'); assert.ok(link.training_ack_id);
  const replay = await padmin('POST', route, { displayName: 'Nuevo Socio' }, { 'idempotency-key': key });
  assert.equal(replay.status, 201); assert.equal(replay.json.trainingUserId, trainingUserId);
  assert.equal(bunkerDb().users.filter(user => user.personId === state.people.c.personId).length, 1, 'no duplicate profile');
  assert.equal((await padmin('POST', route, { displayName: 'Nuevo Socio' }, { 'idempotency-key': randomUUID() })).status, 409, 'a second profile for the same person');
  const sso = await ssoCookie('c');
  assert.equal(sso.redeemed.status, 200, sso.redeemed.text);
  assert.equal((await httpCall(B(), 'GET', '/api/data', { cookie: sso.cookie })).status, 200, 'free personal routines work without a fee');
  assert.notEqual((await httpCall(B(), 'GET', '/api/premium', { cookie: sso.cookie })).status, 200, 'commercial features stay closed without the right');
});

E2E('P2', 'provisioning during an outage is resumed by the same key without duplicates', async () => {
  await createPerson('e', { pilot: false });
  const key = randomUUID(), route = `/api/platform/v1/persons/${state.people.e.personId}/training-provision`;
  await stopProcess(state.bunker);
  const down = await padmin('POST', route, { displayName: 'Socio Reintento' }, { 'idempotency-key': key });
  assert.equal(down.status, 202, down.text); assert.equal(down.json.status, 'provisioning_pending');
  assert.equal((await platformLinks('e')).length, 0, 'no link without a Training profile');
  await startBunker();
  const done = await padmin('POST', route, { displayName: 'Socio Reintento' }, { 'idempotency-key': key });
  assert.equal(done.status, 201, done.text);
  assert.equal(bunkerDb().users.filter(user => user.personId === state.people.e.personId).length, 1);
  assert.equal((await padmin('POST', route, { displayName: 'Otro Nombre' }, { 'idempotency-key': key })).status, 409, 'same key, different request');
});

E2E('L5', 'duplication is refused: a second person cannot claim an account that is already linked, even with a valid proof of it', async () => {
  assert.equal((await linkViaProof('a', 'hist-a')).response.status, 200);
  await createPerson('x');
  const duplicate = await linkViaProof('x', 'hist-a');
  assert.equal(duplicate.issued.status, 201, 'Búnker issues proofs to whoever holds that account passkey session');
  assert.equal(duplicate.response.status, 409, duplicate.response.text);
  assert.equal((await platformLinks('x')).filter(link => link.status === 'active').length, 0);
  assert.equal(bunkerUser('hist-a').personId, state.people.a.personId, 'hist-a still belongs to A');
  assert.equal(bunkerUser('hist-a').platformLink.state, 'active');
});

E2E('X1', 'logs of both services contain no proof codes, challenges, cookies or secrets', async () => {
  let checked = 0;
  for (const name of ['platform', 'bunker']) {
    const text = fs.readFileSync(path.join(out, `${name}.log`), 'utf8');
    for (const secret of [...state.secrets, BUNKER_SECRET_TEXT, b64(proofKey.secret), b64(platformKey.secret)]) { assert.ok(!text.includes(secret), `${name} log leaks a secret`); checked += 1; }
  }
  assert.ok(checked > 10);
});
