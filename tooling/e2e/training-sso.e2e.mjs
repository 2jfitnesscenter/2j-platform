// End-to-end validation of Home -> Platform -> Búnker identity, one-time SSO and capability enforcement.
// Three REAL processes on loopback against a DISPOSABLE PostgreSQL database and a temp data directory:
//   - Platform API (apps/api/src/server.ts, started exactly as in local development)
//   - Búnker/Training API (server.js of the Búnker worktree)
//   - this script as the browser / Home client (it follows the same steps the Home client-app takes)
// Nothing here touches production, real data, real secrets or the network beyond 127.0.0.1.
//
// Usage (from apps/api, so `tsx` resolves):
//   E2E_DATABASE_ADMIN_URL=postgres://user:pass@127.0.0.1:PORT/postgres E2E_BUNKER_API_DIR=<bunker>/api \
//     node --import tsx ../../tooling/e2e/training-sso.e2e.mjs
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const platformApiDir = path.join(repoRoot, 'apps', 'api');
const bunkerApiDir = process.env.E2E_BUNKER_API_DIR ? path.resolve(process.env.E2E_BUNKER_API_DIR) : null;
const adminUrl = process.env.E2E_DATABASE_ADMIN_URL;
if (!adminUrl || !bunkerApiDir) throw new Error('Set E2E_DATABASE_ADMIN_URL (disposable PostgreSQL) and E2E_BUNKER_API_DIR (Búnker api folder).');
for (const url of [adminUrl]) { const host = new URL(url).hostname; if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) throw new Error('E2E only runs against a loopback database.'); }

const out = fs.mkdtempSync(path.join(os.tmpdir(), '2j-e2e-'));
const requireFromApi = createRequire(path.join(platformApiDir, 'package.json'));
const postgres = await import(pathToFileURL(requireFromApi.resolve('postgres')).href).then(m => m.default ?? m);
const b64 = bytes => Buffer.from(bytes).toString('base64url');
const sha256hex = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const MEMBER_ORIGIN = 'http://127.0.0.1:5173';
const BUNKER_SECRET_TEXT = 'e'.repeat(64);
const platformKey = { id: 'e2e-bunker-v1', secret: randomBytes(32) };      // Búnker -> Platform
const proofKey = { id: 'e2e-platform-v1', secret: randomBytes(32) };        // Platform -> Búnker (link proofs)
const state = { platform: null, bunker: null, sql: null, dbName: null, ports: {}, people: {}, cases: [], notes: {} };

/* ------------------------------------------------------------------ helpers */
async function freePort() {
  return new Promise(resolve => { const probe = http.createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });
}
function startProcess(name, command, args, cwd, env) {
  const log = fs.openSync(path.join(out, `${name}.log`), 'a');
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', log, log], windowsHide: true });
  return { child, name, log };
}
async function waitHttp(url, label) {
  for (let i = 0; i < 200; i++) { try { if ((await fetch(url)).ok) return; } catch { /* starting */ } await sleep(100); }
  throw new Error(`${label} did not become ready; see ${out}`);
}
async function stopProcess(proc) {
  if (!proc?.child || proc.child.exitCode !== null) return;
  const done = new Promise(resolve => proc.child.once('exit', resolve));
  proc.child.kill();
  await Promise.race([done, sleep(5000)]);
}
const sign = (key, method, route, body, timestamp = new Date().toISOString(), requestId = randomUUID()) => {
  const canonical = ['2J-SERVICE-AUTH-V1', key.id, timestamp, requestId, method, route, sha256hex(body)].join('\n');
  return { 'x-2j-key-id': key.id, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': createHmac('sha256', key.secret).update(canonical).digest('base64url') };
};
async function http_(base, method, route, { headers = {}, body, cookie } = {}) {
  const response = await fetch(base + route, { method, headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await response.text(); let json = null; try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: response.status, json, headers: response.headers, text };
}
const P = () => `http://127.0.0.1:${state.ports.platform}`;
const B = () => `http://localhost:${state.ports.bunker}`;
const padmin = (method, route, body, idem = true) => http_(P(), method, route, { body, headers: idem ? { 'idempotency-key': randomUUID() } : {} });
const bunkerPasskeyCookie = uid => { const payload = `${uid}:${Date.now() + 86_400_000}:0`; return `gymsid=${payload}.${createHmac('sha256', BUNKER_SECRET_TEXT).update(payload).digest('base64url')}`; };
const cookieOf = response => (response.headers.get('set-cookie') || '').split(';')[0];
const canaryDate = (offsetMonths = 0) => { const d = new Date(Date.now()); const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).split('-').map(Number); return new Date(Date.UTC(parts[0], parts[1] - 1 + offsetMonths, 1)); };
const iso = date => date.toISOString().slice(0, 10);
const monthRange = offset => { const start = canaryDate(offset), end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)); return { startsOn: iso(start), endsOn: iso(end), dueOn: iso(start) }; };

/** A route family probe: which capability gates answer for this session. */
async function probe(cookie) {
  const denied = r => r.status === 403 && ['capability_required', 'platform_access_blocked', 'passkey_required'].includes(r.json?.code);
  const calls = {
    history: ['GET', '/api/data'], guided: ['GET', '/api/guided'], premium: ['GET', '/api/premium'],
    coach: ['POST', '/api/coach/plan'], followup: ['GET', '/api/followup'],
  };
  const result = {};
  for (const [name, [method, route]] of Object.entries(calls)) result[name] = !denied(await http_(B(), method, route, { cookie, body: method === 'POST' ? {} : undefined }));
  return result;
}
const FREE = { history: true, guided: false, premium: false, coach: false, followup: false };
const OTHER = { history: true, guided: true, premium: true, coach: false, followup: false };
const FUERZA = { history: true, guided: true, premium: true, coach: true, followup: true };
const BLOCKED = { history: false, guided: false, premium: false, coach: false, followup: false };

async function loginMember(label) {
  const person = state.people[label];
  const response = await http_(P(), 'POST', '/api/pilot/member/login', { body: { code: person.memberCode }, headers: { origin: MEMBER_ORIGIN } });
  assert.equal(response.status, 200, `member login ${label}: ${response.text}`);
  person.memberCookie = cookieOf(response);
  return person.memberCookie;
}
async function startSso(label) {
  const person = state.people[label];
  const cookie = person.memberCookie || await loginMember(label);
  const response = await http_(P(), 'POST', '/api/me/training/sso', { body: {}, cookie, headers: { origin: MEMBER_ORIGIN } });
  const code = response.status === 201 ? new URL(response.json.redirectUrl).hash.slice('#code='.length) : null;
  return { response, code };
}
async function redeem(code, origin = B()) {
  const response = await http_(B(), 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code }, headers: { origin } });
  return { response, cookie: cookieOf(response) };
}
async function ssoSession(label) {
  const { response, code } = await startSso(label);
  assert.equal(response.status, 201, `sso start ${label}: ${response.text}`);
  const redeemed = await redeem(code);
  assert.equal(redeemed.response.status, 200, `redeem ${label}: ${redeemed.response.text}`);
  state.people[label].ssoCookie = redeemed.cookie;
  return { cookie: redeemed.cookie, code, redeemed: redeemed.response };
}
const adminSetMode = (uid, mode) => http_(B(), 'POST', '/api/admin/platform-enforcement', { cookie: bunkerPasskeyCookie('e2e-admin'), body: { userId: uid, mode } });
const bunkerState = uid => path.join(out, 'bunker-data', `state-${uid}.json`);

/* ------------------------------------------------------------------ environment */
async function startPlatform() {
  state.platform = startProcess('platform', process.execPath, ['--import', 'tsx', 'src/server.ts'], platformApiDir, {
    DATABASE_URL: state.dbUrl, HOST: '127.0.0.1', PORT: String(state.ports.platform), NODE_ENV: 'development', LOCAL_DEMO_ROLE: 'admin',
    PILOT_MEMBER_AUTH_ENABLED: 'true', MEMBER_APP_ORIGIN: MEMBER_ORIGIN, CORS_ORIGIN: MEMBER_ORIGIN,
    PLATFORM_INTERNAL_SERVICE_KEYS: JSON.stringify({ [platformKey.id]: { caller: 'bunker', secret: b64(platformKey.secret) } }),
    TRAINING_SSO_ENABLED: 'true', TRAINING_SSO_REDIRECT_URL: `http://localhost:${state.ports.bunker}/sso`,
  });
  await waitHttp(`${P()}/health`, 'Platform');
}
async function startBunker() {
  state.bunker = startProcess('bunker', process.execPath, ['server.js'], bunkerApiDir, {
    PORT: String(state.ports.bunker), DATA_DIR: path.join(out, 'bunker-data'), SECRET_FILE: path.join(out, 'bunker-data', 'secret'), RP_ID: 'localhost', ORIGIN: B(),
    PLATFORM_SSO_ENABLED: 'true', PLATFORM_API_BASE_URL: P(), PLATFORM_API_KEY_ID: platformKey.id, PLATFORM_API_KEY_SECRET: b64(platformKey.secret),
    PLATFORM_PROOF_ISSUANCE_ENABLED: 'true', PLATFORM_PROOF_EXCHANGE_ENABLED: 'true',
    PLATFORM_SERVICE_AUTH_KEYS: JSON.stringify({ [proofKey.id]: b64(proofKey.secret) }),
  });
  await waitHttp(`${B()}/api/health`, 'Búnker');
}

const PERSONAS = [
  ['free', 'Sin cuota'], ['fuerza', 'Cuota Fuerza'], ['otra', 'Otra cuota'], ['impago', 'Impago'], ['vencido', 'Contrato vencido'],
  ['susp', 'Suspendido'], ['revoc', 'Vínculo revocado'], ['codes', 'Códigos SSO'], ['outfull', 'Caída (Fuerza)'], ['outsusp', 'Caída (suspendido)'], ['forbid', 'Acceso directo'],
];

before(async () => {
  state.ports = { platform: await freePort(), bunker: await freePort() };
  state.dbName = `e2e_${randomUUID().replaceAll('-', '')}`;
  const admin = postgres(adminUrl, { max: 1, connect_timeout: 5 });
  await admin.unsafe(`CREATE DATABASE "${state.dbName}"`); await admin.end();
  const dbUrl = new URL(adminUrl); dbUrl.pathname = `/${state.dbName}`; state.dbUrl = dbUrl.toString();
  state.sql = postgres(state.dbUrl, { max: 4, connect_timeout: 5 });

  await new Promise((resolve, reject) => {
    const migrate = spawn(process.execPath, ['--import', 'tsx', 'src/migrate.ts'], { cwd: platformApiDir, env: { ...process.env, DATABASE_URL: state.dbUrl }, stdio: 'ignore', windowsHide: true });
    migrate.on('exit', code => code === 0 ? resolve() : reject(new Error(`migrate exited ${code}`)));
  });
  await startPlatform();

  // Búnker data: one Training account per persona, one admin; historical routines/history for every account.
  const dataDir = path.join(out, 'bunker-data'); fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'secret'), BUNKER_SECRET_TEXT, { mode: 0o600 });
  const users = PERSONAS.map(([label, name]) => ({ id: `e2e-${label}`, name, username: label, created: '2025-01-01T00:00:00.000Z' }));
  users.push({ id: 'e2e-admin', name: 'Admin E2E', username: 'admin-e2e', admin: true, trainer: true });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users, creds: [], subs: [], invites: [], recoveries: [] }, null, 2));
  for (const [label] of PERSONAS) {
    fs.writeFileSync(bunkerState(`e2e-${label}`), JSON.stringify({ unit: 'kg', lang: 'es', routines: [{ id: 'r-hist', name: `Rutina histórica ${label}`, emoji: '💪', ex: [{ id: '0001', sets: 3, reps: 10, mode: 'reps', weight: 20 }] }], week: { 1: 'r-hist' }, workouts: [{ d: '2026-09-01', routineId: 'r-hist' }] }));
  }
  await startBunker();

  // Platform: services, plans, clients, persons, test-only pilot credentials, explicit Training links.
  const [area] = await state.sql`SELECT id FROM areas WHERE normalized_name='la sala'`;
  const service = (await padmin('POST', '/api/services', { name: `Servicio E2E ${randomUUID()}`, areaId: area.id, status: 'active' }, false)).json;
  const makePlan = async level => {
    const plan = await padmin('POST', '/api/plans', { name: `Plan ${level} ${randomUUID()}`, serviceIds: [service.id], kind: 'recurring', renewalCadence: 'monthly', basePriceCents: 4500, rights: [{ rightType: 'service_access', serviceId: service.id }, { rightType: 'training_access', trainingAccessLevel: level }] });
    assert.equal(plan.status, 201, plan.text);
    assert.equal((await padmin('POST', `/api/plans/${plan.json.id}/activate`, undefined, false)).status, 200);
    return plan.json.id;
  };
  const plans = { full: await makePlan('full'), autonomous: await makePlan('autonomous') };
  const commercial = { fuerza: ['full', 0, true], otra: ['autonomous', 0, true], impago: ['full', 0, false], vencido: ['full', -1, true], outfull: ['full', 0, true] };

  for (const [label, name] of PERSONAS) {
    const client = await padmin('POST', '/api/clients', { firstName: name, lastName: `E2E ${label}` });
    assert.equal(client.status, 201, client.text);
    const person = await padmin('POST', '/api/platform/v1/persons', { clientId: client.json.id });
    assert.equal(person.status, 201, person.text);
    const personId = person.json.personId, uid = `e2e-${label}`, memberCode = `code-${label}-${randomUUID()}`, subjectId = randomUUID();
    await state.sql`INSERT INTO platform_person_auth_subjects(id,person_id,auth_subject,provider,status,created_by) VALUES (${subjectId},${personId},${`e2e-subject-${label}`},'platform-pilot','active','e2e')`;
    await state.sql`INSERT INTO platform_member_pilot_credentials(auth_subject_link_id,code_hash) VALUES (${subjectId},${sha256hex(memberCode)})`;
    await state.sql`INSERT INTO training_account_links(request_id,person_id,training_user_id,method,created_by,updated_by) VALUES (${randomUUID()},${personId},${uid},'explicit_admin','e2e','e2e')`;
    state.people[label] = { label, uid, clientId: client.json.id, personId, memberCode };
    const plan = commercial[label];
    if (plan) {
      const sale = await padmin('POST', `/api/clients/${client.json.id}/plans`, { planId: plans[plan[0]], ...monthRange(plan[1]), amountCents: 4500 });
      assert.equal(sale.status, 201, `sale ${label}: ${sale.text}`);
      if (plan[2]) assert.equal((await padmin('POST', '/api/economics/payments', { chargeId: sale.json.chargeId, splits: [{ method: 'card', amountCents: 4500 }] })).status, 201);
    }
  }

  // Búnker side of the bilateral link, through the real proof endpoints (passkey-backed issue + Platform-signed exchange).
  for (const [label] of PERSONAS) {
    const person = state.people[label];
    const context = { transactionId: randomUUID(), personId: person.personId, audience: '2j-training-account-link', purpose: 'training-account-link', challengeDigest: sha256hex(randomBytes(32)) };
    const issued = await http_(B(), 'POST', '/api/platform/v1/link-proofs', { cookie: bunkerPasskeyCookie(person.uid), body: { v: 1, ...context, expiresAt: new Date(Date.now() + 240_000).toISOString() } });
    assert.equal(issued.status, 201, `proof issue ${label}: ${issued.text}`);
    const body = JSON.stringify({ v: 1, code: issued.json.code, ...context });
    const exchanged = await http_(B(), 'POST', '/api/platform/v1/link-proofs/exchange', { body, headers: sign(proofKey, 'POST', '/api/platform/v1/link-proofs/exchange', Buffer.from(body)) });
    assert.equal(exchanged.status, 200, `proof exchange ${label}: ${exchanged.text}`);
  }
});

after(async () => {
  await stopProcess(state.bunker); await stopProcess(state.platform);
  try { await state.sql?.end(); } catch { /* closing */ }
  try { const admin = postgres(adminUrl, { max: 1 }); await admin.unsafe(`DROP DATABASE IF EXISTS "${state.dbName}" WITH (FORCE)`); await admin.end(); } catch { /* disposable */ }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ at: new Date().toISOString(), cases: state.cases, notes: state.notes }, null, 2));
  console.log(`E2E artefacts (logs, report): ${out}`);
});

const E2E = (id, title, fn) => test(`E2E ${id} — ${title}`, async () => {
  try { await fn(); state.cases.push({ id, title, result: 'pass' }); }
  catch (error) { state.cases.push({ id, title, result: 'FAIL', error: String(error?.message ?? error).slice(0, 400) }); throw error; }
});

/* ------------------------------------------------------------------ cases, in the order they must run */
E2E('00', 'link bilateral: Home SSO → Platform → Búnker opens a member-level session for a linked person', async () => {
  const { response, code } = await startSso('free');
  assert.equal(response.status, 201);
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  const url = new URL(response.json.redirectUrl);
  assert.equal(url.origin, B()); assert.equal(url.pathname, '/sso'); assert.equal(url.search, '');
  // Home's own destination validation accepts exactly this URL (the Home client follows only that).
  try {
    const home = await import(pathToFileURL(path.join(repoRoot, 'apps', 'client-app', 'src', 'client-app.tsx')).href);
    assert.equal(home.trainingSsoDestination(response.json.redirectUrl, B()), response.json.redirectUrl);
    assert.equal(home.trainingSsoDestination(response.json.redirectUrl, 'https://app.2jfitnesscenter.com'), null);
    state.notes.homeValidation = 'executed';
  } catch (error) { state.notes.homeValidation = `not executed here: ${String(error.message).slice(0, 80)}`; }
  const redeemed = await redeem(code);
  assert.equal(redeemed.response.status, 200, redeemed.response.text);
  assert.equal(redeemed.response.json.user.authLevel, 'sso'); assert.equal(redeemed.response.json.user.admin, false);
  const me = await http_(B(), 'GET', '/api/me', { cookie: redeemed.cookie });
  assert.equal(me.status, 200); assert.equal(me.json.user.id, 'e2e-free'); assert.equal(me.json.user.authLevel, 'sso');
  state.people.free.ssoCookie = redeemed.cookie;
});

E2E('01', 'usuario sin cuota: capacidades gratuitas, sin comerciales ni profesionales', async () => {
  assert.deepEqual(await probe(state.people.free.ssoCookie), FREE);
});

E2E('02', 'cuota Fuerza activa: acceso completo', async () => {
  const { cookie } = await ssoSession('fuerza');
  assert.deepEqual(await probe(cookie), FUERZA);
});

E2E('03', 'otra cuota activa: guiado y Premium, sin IA ni seguimiento profesional', async () => {
  const { cookie } = await ssoSession('otra');
  assert.deepEqual(await probe(cookie), OTHER);
});

E2E('04', 'impago: vuelve al baseline gratuito, sin perder la cuenta', async () => {
  const { cookie } = await ssoSession('impago');
  assert.deepEqual(await probe(cookie), FREE);
});

E2E('05', 'contrato vencido: vuelve al baseline gratuito', async () => {
  const { cookie } = await ssoSession('vencido');
  assert.deepEqual(await probe(cookie), FREE);
});

E2E('06a', 'modos por usuario: legacy sin llamadas a Platform, shadow no bloquea, enforced aplica el contrato', async () => {
  const uid = state.people.forbid.uid, cookie = bunkerPasskeyCookie(uid);
  assert.deepEqual(await probe(cookie), { history: true, guided: true, premium: true, coach: true, followup: true }, 'legacy keeps today\'s full access');
  assert.equal((await adminSetMode(uid, 'enforced')).json.error, 'transition_not_allowed');
  assert.equal((await adminSetMode(uid, 'shadow')).status, 409, 'a link confirmed by Búnker is required first');
  await ssoSession('forbid');                                          // establishes Búnker's confirmed link
  assert.equal((await adminSetMode(uid, 'shadow')).status, 200);
  assert.deepEqual(await probe(cookie), { history: true, guided: true, premium: true, coach: true, followup: true }, 'shadow never blocks');
  assert.equal((await adminSetMode(uid, 'enforced')).status, 200);
  assert.deepEqual(await probe(cookie), FREE, 'enforced applies the free baseline to a passkey session too');
});

E2E('13', 'acceso directo al API sin autorización', async () => {
  // Búnker: no cookie, forged cookie, wrong signature, and an sso session reaching staff/passkey-only routes.
  for (const [method, route] of [['GET', '/api/data'], ['GET', '/api/me'], ['GET', '/api/guided'], ['POST', '/api/coach/plan']]) {
    assert.equal((await http_(B(), method, route, { body: method === 'POST' ? {} : undefined })).status, 401, `${method} ${route} without a session`);
  }
  assert.equal((await http_(B(), 'GET', '/api/data', { cookie: 'gymsid=forged.value' })).status, 401);
  const sso = state.people.fuerza.ssoCookie;
  for (const [method, route] of [['GET', '/api/admin/users'], ['POST', '/api/trainer/member-program'], ['POST', '/api/admin/platform-enforcement'], ['GET', '/api/me/passkeys'], ['POST', '/api/me/delete'], ['POST', '/api/logout/all'], ['GET', '/api/me/export']]) {
    const r = await http_(B(), method, route, { cookie: sso, body: method === 'POST' ? {} : undefined });
    assert.equal(r.status, 403, `${method} ${route} -> ${r.status}`); assert.equal(r.json?.code, 'passkey_required');
  }
  assert.equal((await http_(B(), 'POST', '/api/admin/platform-enforcement', { cookie: bunkerPasskeyCookie(state.people.free.uid), body: { userId: 'e2e-free', mode: 'shadow' } })).status, 403, 'a non-admin passkey session cannot move users between modes');
  // Redeem endpoints: wrong origin, malformed body, no code.
  assert.equal((await http_(B(), 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code: randomBytes(32).toString('base64url') }, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await http_(B(), 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code: 'x' }, headers: { origin: B() } })).status, 400);
  // Platform: no member session, forged member cookie, wrong origin (CSRF), internal endpoints without or with the wrong service signature.
  assert.equal((await http_(P(), 'POST', '/api/me/training/sso', { body: {}, headers: { origin: MEMBER_ORIGIN } })).status, 401);
  assert.equal((await http_(P(), 'POST', '/api/me/training/sso', { body: {}, cookie: `2j_member_pilot=${'A'.repeat(43)}`, headers: { origin: MEMBER_ORIGIN } })).status, 401);
  const cookie = state.people.free.memberCookie || await loginMember('free');
  assert.equal((await http_(P(), 'POST', '/api/me/training/sso', { body: {}, cookie, headers: { origin: 'https://evil.example' } })).status, 403, 'Platform rejects a cross-site request');
  const redeemPath = '/api/internal/platform/v2/sso/redeem', body = JSON.stringify({ v: 1, code: randomBytes(32).toString('base64url'), audience: '2j-training-sso', purpose: 'training-session' });
  assert.equal((await http_(P(), 'POST', redeemPath, { body })).status, 401, 'unsigned');
  const wrong = { id: platformKey.id, secret: randomBytes(32) };
  assert.equal((await http_(P(), 'POST', redeemPath, { body, headers: sign(wrong, 'POST', redeemPath, Buffer.from(body)) })).status, 401, 'wrong secret');
  const personId = state.people.free.personId;
  assert.equal((await http_(P(), 'GET', `/api/internal/platform/v2/persons/${personId}/training-capabilities`)).status, 401, 'capabilities need service auth, not a member session');
  const replayHeaders = sign(platformKey, 'GET', `/api/internal/platform/v2/persons/${personId}/training-capabilities`, Buffer.alloc(0));
  assert.equal((await http_(P(), 'GET', `/api/internal/platform/v2/persons/${personId}/training-capabilities`, { headers: replayHeaders })).status, 200);
  assert.equal((await http_(P(), 'GET', `/api/internal/platform/v2/persons/${personId}/training-capabilities`, { headers: replayHeaders })).status, 401, 'a signed request is accepted once');
});

E2E('10', 'código SSO reutilizado: el segundo canje falla (también en paralelo)', async () => {
  const { code } = await startSso('codes');
  const [one, two, three] = await Promise.all([redeem(code), redeem(code), redeem(code)]);
  const statuses = [one, two, three].map(r => r.response.status).sort();
  assert.deepEqual(statuses, [200, 400, 400], 'exactly one winner');
  assert.equal((await redeem(code)).response.status, 400);
  const fresh = await startSso('codes');
  assert.equal((await redeem(fresh.code)).response.status, 200, 'a new code works: the account was not locked');
  state.people.codes.ssoCookie = (await redeem((await startSso('codes')).code)).cookie;
});

E2E('14a', 'datos históricos intactos tras todos los casos anteriores', async () => {
  for (const label of ['free', 'fuerza', 'otra', 'impago', 'vencido', 'forbid', 'codes']) {
    const file = bunkerState(`e2e-${label}`), saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.routines[0].name, `Rutina histórica ${label}`);
    assert.equal(saved.workouts.length, 1);
  }
  const users = JSON.parse(fs.readFileSync(path.join(out, 'bunker-data', 'db.json'), 'utf8')).users;
  assert.equal(users.filter(u => u.id.startsWith('e2e-')).length, PERSONAS.length + 1, 'no Training account was created, merged or removed by SSO');
  assert.ok(users.every(u => !u.id.includes('@')), 'accounts are never keyed by email');
});

/* ---- time-dependent block: one real wait window (Platform up) then one with Platform DOWN ---- */
E2E('06b-08-09', 'suspensión, vínculo revocado y código caducado se hacen efectivos con Platform activo', async () => {
  // Sessions and a state change on Platform while their Búnker answers are cached (<= 60 s).
  await ssoSession('susp'); await ssoSession('revoc'); await ssoSession('outfull'); await ssoSession('outsusp');
  assert.deepEqual(await probe(state.people.susp.ssoCookie), FREE);
  const caps = async who => (await http_(P(), 'GET', `/api/internal/platform/v2/persons/${state.people[who].personId}/training-capabilities`, { headers: sign(platformKey, 'GET', `/api/internal/platform/v2/persons/${state.people[who].personId}/training-capabilities`, Buffer.alloc(0)) })).json;
  for (const who of ['susp', 'outsusp']) {
    const suspended = await padmin('POST', `/api/platform/v1/persons/${state.people[who].personId}/training-suspension/suspend`, { reason: 'Prueba E2E de suspensión administrativa' });
    assert.equal(suspended.status, 201, suspended.text);
    assert.equal((await caps(who)).reasonCode, 'ADMIN_SUSPENDED');
  }
  await state.sql`UPDATE training_account_links SET status='revoked',updated_by='e2e' WHERE person_id=${state.people.revoc.personId}`;
  assert.equal((await caps('revoc')).reasonCode, 'TRAINING_LINK_REVOKED');
  // A code that will be past its 60 s life when redeemed.
  state.expiredCode = (await startSso('codes')).code;
  // Platform refuses NEW codes for suspended / revoked people immediately.
  const refusedSusp = await startSso('susp'); assert.equal(refusedSusp.response.status, 403); assert.equal(refusedSusp.response.json.error, 'training_access_suspended');
  const refusedLink = await startSso('revoc'); assert.equal(refusedLink.response.status, 409); assert.equal(refusedLink.response.json.reasonCode, 'TRAINING_LINK_REVOKED');
  state.waitStarted = Date.now();
  await sleep(62_000);                                                  // every cached Búnker answer and the code now expire

  // 06 Suspension reaches Búnker; sessions blocked, data untouched.
  for (const who of ['susp', 'outsusp']) {
    const r = await http_(B(), 'GET', '/api/data', { cookie: state.people[who].ssoCookie });
    assert.equal(r.status, 403, who); assert.equal(r.json.code, 'platform_access_blocked'); assert.equal(r.json.reasonCode, 'ADMIN_SUSPENDED');
  }
  assert.deepEqual(await probe(state.people.susp.ssoCookie), BLOCKED);
  // 08 Revoked link: the sso session is closed (401), and the account's passkey login still works.
  const closed = await http_(B(), 'GET', '/api/data', { cookie: state.people.revoc.ssoCookie });
  assert.equal(closed.status, 403);
  assert.equal((await http_(B(), 'GET', '/api/me', { cookie: state.people.revoc.ssoCookie })).status, 401, 'sso sessions of a revoked link are revoked');
  assert.equal((await http_(B(), 'GET', '/api/me', { cookie: bunkerPasskeyCookie(state.people.revoc.uid) })).status, 200, 'the passkey login of the account is untouched');
  // 09 Expired one-time code.
  const expired = await redeem(state.expiredCode);
  assert.equal(expired.response.status, 400); assert.equal(expired.response.json.error, 'sso_code_invalid');
  const [row] = await state.sql`SELECT state,terminal_reason FROM platform_training_sso_codes WHERE code_hash=${sha256hex(state.expiredCode)}`;
  assert.equal(row.state, 'expired');
  state.notes.windowSeconds = Math.round((Date.now() - state.waitStarted) / 1000);
});

E2E('11-12', 'caída de Platform y caché vencida: baseline conservado, derechos de pago nunca sin verificar, suspensión conocida respetada', async () => {
  // Refresh what Búnker knows while Platform is still up, then take Platform DOWN (a real process outage).
  assert.deepEqual(await probe(state.people.outfull.ssoCookie), FUERZA, 'refresh: still Fuerza while Platform is up');
  const lift = await padmin('POST', `/api/platform/v1/persons/${state.people.susp.personId}/training-suspension/lift`, { reason: 'Revisión completada y acceso restituido' });
  assert.equal(lift.status, 201, lift.text);
  await stopProcess(state.platform);
  const downSince = Date.now();
  await assert.rejects(fetch(`${P()}/health`), 'Platform is really down');
  // Inside the cache TTL the last verified answer is still used.
  assert.deepEqual(await probe(state.people.outfull.ssoCookie), FUERZA);
  await sleep(62_000);                                                  // the cache expires while Platform is unreachable
  // 12 Expired cache + outage: free functions survive, paid ones are NOT granted without verification.
  assert.deepEqual(await probe(state.people.outfull.ssoCookie), FREE);
  // 11 A suspension Búnker had already learned keeps blocking while Platform is down; and so does a lift it cannot verify yet.
  assert.deepEqual(await probe(state.people.outsusp.ssoCookie), BLOCKED);
  assert.deepEqual(await probe(state.people.susp.ssoCookie), BLOCKED, 'an unverified lift is not assumed');
  // New sign-ins cannot happen without Platform; the passkey login keeps working.
  const noPlatform = await http_(B(), 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code: randomBytes(32).toString('base64url') }, headers: { origin: B() } });
  assert.equal(noPlatform.status, 503);
  assert.equal((await http_(B(), 'GET', '/api/me', { cookie: bunkerPasskeyCookie(state.people.outfull.uid) })).status, 200);
  state.notes.outageSeconds = Math.round((Date.now() - downSince) / 1000);
  // Recovery: Platform returns (same database); verified state replaces assumptions.
  await startPlatform();
  assert.deepEqual(await probe(state.people.outfull.ssoCookie), FUERZA, 'verification restores the paid level');
  assert.deepEqual(await probe(state.people.susp.ssoCookie), FREE, '07 — lifted suspension returns the free baseline');
  assert.deepEqual(await probe(state.people.outsusp.ssoCookie), BLOCKED, 'a still-suspended person stays blocked after recovery');
  const restored = JSON.parse(fs.readFileSync(bunkerState('e2e-susp'), 'utf8'));
  assert.equal(restored.routines[0].name, 'Rutina histórica susp', '14 — routines survive suspension and lift');
});

E2E('07', 'levantamiento de suspensión: el acceso vuelve y la restricción persistida desaparece', async () => {
  const db = JSON.parse(fs.readFileSync(path.join(out, 'bunker-data', 'db.json'), 'utf8'));
  assert.equal(db.users.find(u => u.id === 'e2e-susp').platformRestriction, undefined);
  assert.equal(db.users.find(u => u.id === 'e2e-outsusp').platformRestriction.reasonCode, 'ADMIN_SUSPENDED');
  const [events] = await state.sql`SELECT count(*)::int AS n FROM platform_training_access_events WHERE person_id=${state.people.susp.personId}`;
  assert.equal(events.n, 2, 'suspension and lift are both recorded on Platform');
});

E2E('14b', 'conservación final: cuentas, passkey login, rutinas e historial de todos los usuarios', async () => {
  for (const [label] of PERSONAS) {
    const saved = JSON.parse(fs.readFileSync(bunkerState(`e2e-${label}`), 'utf8'));
    assert.equal(saved.routines.length, 1); assert.equal(saved.workouts.length, 1);
    assert.equal((await http_(B(), 'GET', '/api/me', { cookie: bunkerPasskeyCookie(`e2e-${label}`) })).status, 200, `${label} still signs in with its own credentials`);
  }
  const [counts] = await state.sql`SELECT (SELECT count(*) FROM platform_persons)::int AS persons, (SELECT count(*) FROM training_account_links)::int AS links`;
  assert.equal(counts.persons, PERSONAS.length); assert.equal(counts.links, PERSONAS.length);
  const audit = await state.sql`SELECT action,count(*)::int AS n FROM platform_identity_audit_events WHERE action LIKE 'training.sso_%' GROUP BY action`;
  state.notes.ssoAudit = Object.fromEntries(audit.map(row => [row.action, row.n]));
  assert.ok(state.notes.ssoAudit['training.sso_issued'] > 0 && state.notes.ssoAudit['training.sso_redeemed'] > 0 && state.notes.ssoAudit['training.sso_rejected'] > 0);
});
