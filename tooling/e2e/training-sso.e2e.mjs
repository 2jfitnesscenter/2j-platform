// End-to-end validation of Home -> Platform -> Búnker identity, one-time SSO and capability enforcement.
// Three REAL processes on loopback against a DISPOSABLE PostgreSQL database and a temp data directory:
//   - Platform API (apps/api/src/server.ts, started exactly as in local development)
//   - Búnker/Training API (server.js of the Búnker worktree)
//   - this script as the browser / Home client (it follows the same steps the Home client-app takes)
// Nothing here touches production, real data, real secrets or the network beyond 127.0.0.1. Child processes get a minimal
// environment (no inherited credentials) and per-run random secrets. Artefacts go to <2J root>/temp/e2e (or E2E_OUT_DIR) and are
// deleted at the end unless E2E_KEEP=1.
//
// Usage (from apps/api, so `tsx` resolves):
//   E2E_DATABASE_ADMIN_URL=postgres://user:pass@127.0.0.1:PORT/postgres E2E_BUNKER_API_DIR=<bunker>/api \
//     node --import tsx ../../tooling/e2e/training-sso.e2e.mjs
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { activateTrainingLink, b64, beginBrowserFlow, s256, childEnv, cookieOf, freePort, httpCall, monthRange, passkeyCookieFor, randomSecret, resolveOutDir, sha256hex, signRequest, sleep, startProcess, stopProcess, waitHttp } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const platformApiDir = path.join(repoRoot, 'apps', 'api');
const bunkerApiDir = process.env.E2E_BUNKER_API_DIR ? path.resolve(process.env.E2E_BUNKER_API_DIR) : null;
const adminUrl = process.env.E2E_DATABASE_ADMIN_URL;
if (!adminUrl || !bunkerApiDir) throw new Error('Set E2E_DATABASE_ADMIN_URL (disposable PostgreSQL) and E2E_BUNKER_API_DIR (Búnker api folder).');
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(adminUrl).hostname)) throw new Error('E2E only runs against a loopback database.');

const out = resolveOutDir('run', repoRoot);
const requireFromApi = createRequire(path.join(platformApiDir, 'package.json'));
const postgres = await import(pathToFileURL(requireFromApi.resolve('postgres')).href).then(m => m.default ?? m);

const MEMBER_ORIGIN = 'http://127.0.0.1:5173';
const emptyCashDenominations = { coin_0_01: 0, coin_0_02: 0, coin_0_05: 0, coin_0_10: 0, coin_0_20: 0, coin_0_50: 0, coin_1: 0, coin_2: 0, bill_5: 0, bill_10: 0, bill_20: 0, bill_50: 0, bill_100: 0, bill_200: 0, bill_500: 0 };
const BUNKER_SECRET_TEXT = randomSecret();
const platformKey = { id: 'e2e-bunker-v1', secret: randomBytes(32) };      // Búnker -> Platform
const proofKey = { id: 'e2e-platform-v1', secret: randomBytes(32) };        // Platform -> Búnker (link proofs)
const state = { browsers: new Map(), platform: null, bunker: null, sql: null, dbName: null, dbUrl: null, ports: {}, people: {}, cases: [], notes: {}, secretsSeen: new Set() };
const bunkerPasskeyCookie = passkeyCookieFor(BUNKER_SECRET_TEXT);

/* ------------------------------------------------------------------ helpers */
const P = () => `http://127.0.0.1:${state.ports.platform}`;
const B = () => `http://localhost:${state.ports.bunker}`;
const http_ = httpCall;
const padmin = (method, route, body, idem = true) => httpCall(P(), method, route, { body, headers: idem ? { 'idempotency-key': randomUUID() } : {} });
const remember = value => { if (value) state.secretsSeen.add(value); return value; };
const capsRoute = personId => `/api/internal/platform/v2/persons/${personId}/training-capabilities`;
/** The Platform answer as Búnker sees it (signed, single use). */
const platformCaps = async who => (await httpCall(P(), 'GET', capsRoute(state.people[who].personId), { headers: signRequest(platformKey, 'GET', capsRoute(state.people[who].personId), Buffer.alloc(0)) })).json;

/** A route family probe: which capability gates answer for this session. */
async function probe(cookie) {
  const denied = r => r.status === 403 && ['capability_required', 'platform_access_blocked', 'passkey_required'].includes(r.json?.code);
  const calls = {
    history: ['GET', '/api/data'], guided: ['GET', '/api/guided'], premium: ['GET', '/api/premium'],
    coach: ['POST', '/api/coach/plan'], followup: ['GET', '/api/followup'],
  };
  const result = {};
  for (const [name, [method, route]] of Object.entries(calls)) result[name] = !denied(await httpCall(B(), method, route, { cookie, body: method === 'POST' ? {} : undefined }));
  return result;
}
const FREE = { history: true, guided: false, premium: false, coach: false, followup: false };
const OTHER = { history: true, guided: true, premium: true, coach: false, followup: false };
const FUERZA = { history: true, guided: true, premium: true, coach: true, followup: true };
const BLOCKED = { history: false, guided: false, premium: false, coach: false, followup: false };

async function loginMember(label) {
  const person = state.people[label];
  const response = await httpCall(P(), 'POST', '/api/pilot/member/login', { body: { code: person.memberCode }, headers: { origin: MEMBER_ORIGIN } });
  assert.equal(response.status, 200, `member login ${label}: ${response.text}`);
  person.memberCookie = remember(cookieOf(response));
  return person.memberCookie;
}
/**
 * The browser-bound flow, as a browser does it. Step 1 happens at Búnker (start page: the secret stays in an HttpOnly cookie, Home gets only its S256 challenge).
 * Step 2 is Home asking Platform for a code for THAT challenge. Step 3 is the same browser redeeming it at Búnker. `browser` is that browser's state.
 */
async function newBrowser() {
  const browser = await beginBrowserFlow(B());
  assert.equal(browser.status, 302, 'the start page redirects'); assert.ok(browser.cookie && browser.challenge, 'and sets the binding cookie');
  remember(browser.verifier);
  return browser;
}
async function startSso(label, browser) {
  const person = state.people[label];
  const cookie = person.memberCookie || await loginMember(label);
  browser ??= await newBrowser();
  const response = await httpCall(P(), 'POST', '/api/me/training/sso', { body: { challenge: browser.challenge }, cookie, headers: { origin: MEMBER_ORIGIN } });
  const code = response.status === 201 ? remember(new URL(response.json.redirectUrl).hash.slice('#code='.length)) : null;
  if (code) state.browsers.set(code, browser);
  return { response, code, browser };
}
/** Redeems with the browser that started the flow for this code (default), or with another one: `as` is a browser state, or null for a browser that never started it. */
async function redeem(code, origin = B(), as) {
  const browser = as === undefined ? state.browsers.get(code) ?? await newBrowser() : as;
  const response = await httpCall(B(), 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code }, headers: { origin }, ...(browser?.cookie ? { cookie: browser.cookie } : {}) });
  const session = (response.headers.getSetCookie?.() ?? []).find(item => item.startsWith('gymsid='));
  return { response, cookie: remember(session ? session.split(';')[0] : ''), setCookie: response.headers.getSetCookie?.() ?? [] };
}
async function ssoSession(label) {
  const { response, code } = await startSso(label);
  assert.equal(response.status, 201, `sso start ${label}: ${response.text}`);
  const redeemed = await redeem(code);
  assert.equal(redeemed.response.status, 200, `redeem ${label}: ${redeemed.response.text}`);
  state.people[label].ssoCookie = redeemed.cookie;
  return { cookie: redeemed.cookie, code, redeemed: redeemed.response };
}
/** Each case creates the session it needs, so a single case can be run on its own. */
const ensureSso = async label => state.people[label].ssoCookie ?? (await ssoSession(label)).cookie;
const adminSetMode = (uid, mode) => httpCall(B(), 'POST', '/api/admin/platform-enforcement', { cookie: bunkerPasskeyCookie('e2e-admin'), body: { userId: uid, mode } });
const bunkerState = uid => path.join(out, 'bunker-data', `state-${uid}.json`);
/** How long every cached Búnker answer and every one-time code live, read from the systems instead of assumed. */
async function lifetimesMs(codeHash) {
  const caps = await platformCaps('outfull');
  const capsTtl = Date.parse(caps.expiresAt) - Date.parse(caps.generatedAt);
  const [row] = await state.sql`SELECT (EXTRACT(EPOCH FROM expires_at-created_at)*1000)::int AS ttl FROM platform_training_sso_codes WHERE code_hash=${codeHash}`;
  return Math.max(capsTtl, row.ttl);
}

/* ------------------------------------------------------------------ environment */
async function startPlatform() {
  state.platform = startProcess(out, 'platform', ['--import', 'tsx', 'src/server.ts'], platformApiDir, {
    DATABASE_URL: state.dbUrl, HOST: '127.0.0.1', PORT: String(state.ports.platform), NODE_ENV: 'development', LOCAL_DEMO_ROLE: 'admin',
    PILOT_MEMBER_AUTH_ENABLED: 'true', MEMBER_APP_ORIGIN: MEMBER_ORIGIN, CORS_ORIGIN: MEMBER_ORIGIN,
    PLATFORM_INTERNAL_SERVICE_KEYS: JSON.stringify({ [platformKey.id]: { caller: 'bunker', secret: b64(platformKey.secret) } }),
    TRAINING_SSO_ENABLED: 'true', TRAINING_SSO_REDIRECT_URL: `http://localhost:${state.ports.bunker}/sso`,
  });
  await waitHttp(`${P()}/health`, 'Platform', out);
}
async function startBunker() {
  state.bunker = startProcess(out, 'bunker', ['server.js'], bunkerApiDir, {
    PORT: String(state.ports.bunker), DATA_DIR: path.join(out, 'bunker-data'), SECRET_FILE: path.join(out, 'bunker-data', 'secret'), RP_ID: 'localhost', ORIGIN: B(),
    PLATFORM_SSO_ENABLED: 'true', PLATFORM_HOME_URL: MEMBER_ORIGIN, PLATFORM_API_BASE_URL: P(), PLATFORM_API_KEY_ID: platformKey.id, PLATFORM_API_KEY_SECRET: b64(platformKey.secret),
    PLATFORM_PROOF_ISSUANCE_ENABLED: 'true', PLATFORM_PROOF_EXCHANGE_ENABLED: 'true', PLATFORM_BREAKER_BASE_MS: '200', PLATFORM_LINK_LIFECYCLE_ENABLED: 'true',
    PLATFORM_SERVICE_AUTH_KEYS: JSON.stringify({ [proofKey.id]: b64(proofKey.secret) }),
  });
  await waitHttp(`${B()}/api/health`, 'Búnker', out);
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
    const migrate = spawn(process.execPath, ['--import', 'tsx', 'src/migrate.ts'], { cwd: platformApiDir, env: childEnv({ DATABASE_URL: state.dbUrl }), stdio: 'ignore', windowsHide: true });
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
  const cash = await padmin('POST', '/api/economics/cash/open', { openingDenominations: emptyCashDenominations });
  assert.equal(cash.status, 201, `open synthetic cash session: ${cash.text}`);

  for (const [label, name] of PERSONAS) {
    const client = await padmin('POST', '/api/clients', { firstName: name, lastName: `E2E ${label}` });
    assert.equal(client.status, 201, client.text);
    const person = await padmin('POST', '/api/platform/v1/persons', { clientId: client.json.id });
    assert.equal(person.status, 201, person.text);
    const personId = person.json.personId, uid = `e2e-${label}`, memberCode = remember(`code-${label}-${randomUUID()}`), subjectId = randomUUID();
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

  // Búnker side of the bilateral link, through the real proof endpoints (passkey-backed issue, Platform-signed exchange).
  for (const [label] of PERSONAS) {
    const person = state.people[label];
    const context = { transactionId: randomUUID(), personId: person.personId, audience: '2j-training-account-link', purpose: 'training-account-link', challengeDigest: sha256hex(randomBytes(32)) };
    const issued = await httpCall(B(), 'POST', '/api/platform/v1/link-proofs', { cookie: bunkerPasskeyCookie(person.uid), body: { v: 1, ...context, expiresAt: new Date(Date.now() + 240_000).toISOString() } });
    assert.equal(issued.status, 201, `proof issue ${label}: ${issued.text}`);
    const body = JSON.stringify({ v: 1, code: issued.json.code, ...context });
    const exchanged = await httpCall(B(), 'POST', '/api/platform/v1/link-proofs/exchange', { body, headers: signRequest(proofKey, 'POST', '/api/platform/v1/link-proofs/exchange', Buffer.from(body)) });
    assert.equal(exchanged.status, 200, `proof exchange ${label}: ${exchanged.text}`);
    if (label === 'forbid') continue;                                   // its confirmation is part of case 06a
    const [link] = await state.sql`SELECT link_id FROM training_account_links WHERE person_id=${person.personId}`;
    const acked = await activateTrainingLink(B(), proofKey, { linkId: link.link_id, personId: person.personId, trainingUserId: person.uid });
    assert.equal(acked.status, 200, `Búnker acknowledgement ${label}: ${acked.text}`);
    // Sessions follow the mode of the user (H1): these personas are opted in to enforcement, exactly like an administrator would do one by one.
    assert.equal((await adminSetMode(person.uid, 'shadow')).status, 200, `shadow ${label}`);
    assert.equal((await adminSetMode(person.uid, 'enforced')).status, 200, `enforced ${label}`);
  }
});

after(async () => {
  await stopProcess(state.bunker); await stopProcess(state.platform);
  try { await state.sql?.end(); } catch { /* closing */ }
  try { const admin = postgres(adminUrl, { max: 1 }); await admin.unsafe(`DROP DATABASE IF EXISTS "${state.dbName}" WITH (FORCE)`); await admin.end(); } catch { /* disposable */ }
  const report = { at: new Date().toISOString(), cases: state.cases, notes: state.notes };
  console.log(`E2E report: ${JSON.stringify(report)}`);
  if (process.env.E2E_KEEP === '1') { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(`E2E artefacts kept in ${out}`); }
  else fs.rmSync(out, { recursive: true, force: true });
});

const E2E = (id, title, fn) => test(`E2E ${id} — ${title}`, async () => {
  try { await fn(); state.cases.push({ id, title, result: 'pass' }); }
  catch (error) { state.cases.push({ id, title, result: 'FAIL', error: String(error?.message ?? error).slice(0, 400) }); throw error; }
});

/* ------------------------------------------------------------------ cases, in the order they must run */
E2E('00', 'link bilateral: Home SSO → Platform → Búnker opens a member-level session for a linked person', async () => {
  const { response, code, browser } = await startSso('free');
  assert.equal(response.status, 201);
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  // Step 1 of the bound flow: Búnker's start page sent the browser to Home carrying only the S256 of the secret that stays in its cookie.
  const toHome = new URL(browser.location);
  assert.equal(toHome.origin, MEMBER_ORIGIN); assert.equal(toHome.search, ''); assert.equal(browser.challenge, s256(browser.verifier)); assert.ok(!browser.location.includes(browser.verifier));
  assert.match(browser.setCookie.find(item => item.startsWith('j2ssob=')), /HttpOnly/);
  const url = new URL(response.json.redirectUrl);
  assert.equal(url.origin, B()); assert.equal(url.pathname, '/sso'); assert.equal(url.search, '');
  // Home's own destination validation accepts exactly this URL (the Home client follows only that). It must run: skipping needs an explicit opt-out.
  if (process.env.E2E_SKIP_HOME === '1') state.notes.homeValidation = 'skipped by E2E_SKIP_HOME=1';
  else {
    const home = await import(pathToFileURL(path.join(repoRoot, 'apps', 'client-app', 'src', 'client-app.tsx')).href);
    assert.equal(home.trainingSsoDestination(response.json.redirectUrl, B()), response.json.redirectUrl);
    assert.equal(home.trainingSsoDestination(response.json.redirectUrl, 'https://app.2jfitnesscenter.com'), null);
    assert.equal(home.trainingSsoDestination(`${B()}/other#code=${code}`, B()), null, 'only /sso is followed');
    assert.equal(home.ssoChallengeFromHash(toHome.hash), browser.challenge, 'Home reads exactly the challenge Búnker sent');
    assert.equal(home.trainingSsoStartUrl(B()), `${B()}/api/platform/v1/sso/start`, 'and Home\'s "Abrir Búnker" leaves for exactly that start page');
    state.notes.homeValidation = 'executed';
  }
  const redeemed = await redeem(code);
  assert.equal(redeemed.response.status, 200, redeemed.response.text);
  assert.equal(redeemed.response.json.user.authLevel, 'sso'); assert.equal(redeemed.response.json.user.admin, false);
  const me = await httpCall(B(), 'GET', '/api/me', { cookie: redeemed.cookie });
  assert.equal(me.status, 200); assert.equal(me.json.user.id, 'e2e-free'); assert.equal(me.json.user.authLevel, 'sso');
  state.people.free.ssoCookie = redeemed.cookie;
});

E2E('01', 'usuario sin cuota: capacidades gratuitas, sin comerciales ni profesionales', async () => {
  assert.deepEqual(await probe(await ensureSso('free')), FREE);
});

E2E('02', 'cuota Fuerza activa: acceso completo', async () => {
  assert.deepEqual(await probe(await ensureSso('fuerza')), FUERZA);
});

E2E('03', 'otra cuota activa: guiado y Premium, sin IA ni seguimiento profesional', async () => {
  assert.deepEqual(await probe(await ensureSso('otra')), OTHER);
});

E2E('04', 'impago: vuelve al baseline gratuito, sin perder la cuenta', async () => {
  assert.deepEqual(await probe(await ensureSso('impago')), FREE);
});

E2E('05', 'contrato vencido: vuelve al baseline gratuito', async () => {
  assert.deepEqual(await probe(await ensureSso('vencido')), FREE);
});

E2E('06a', 'modos por usuario: legacy sin llamadas a Platform, shadow no bloquea, enforced aplica el contrato', async () => {
  const uid = state.people.forbid.uid, cookie = bunkerPasskeyCookie(uid);
  assert.deepEqual(await probe(cookie), { history: true, guided: true, premium: true, coach: true, followup: true }, 'legacy keeps today\'s full access');
  assert.equal((await adminSetMode(uid, 'enforced')).json.error, 'transition_not_allowed');
  assert.equal((await adminSetMode(uid, 'shadow')).status, 409, 'a link confirmed by Búnker is required first');
  const person = state.people.forbid, [link] = await state.sql`SELECT link_id FROM training_account_links WHERE person_id=${person.personId}`;
  assert.equal((await activateTrainingLink(B(), proofKey, { linkId: link.link_id, personId: person.personId, trainingUserId: uid })).status, 200);   // Búnker confirms the link
  await ensureSso('forbid');
  assert.equal((await adminSetMode(uid, 'shadow')).status, 200);
  assert.deepEqual(await probe(cookie), { history: true, guided: true, premium: true, coach: true, followup: true }, 'shadow never blocks');
  assert.equal((await adminSetMode(uid, 'enforced')).status, 200);
  assert.deepEqual(await probe(cookie), FREE, 'enforced applies the free baseline to a passkey session too');
});

E2E('13', 'acceso directo al API sin autorización', async () => {
  // Búnker: no cookie, forged cookie, wrong signature, and an sso session reaching staff/passkey-only routes.
  for (const [method, route] of [['GET', '/api/data'], ['GET', '/api/me'], ['GET', '/api/guided'], ['POST', '/api/coach/plan']]) {
    assert.equal((await httpCall(B(), method, route, { body: method === 'POST' ? {} : undefined })).status, 401, `${method} ${route} without a session`);
  }
  assert.equal((await httpCall(B(), 'GET', '/api/data', { cookie: 'gymsid=forged.value' })).status, 401);
  const sso = await ensureSso('fuerza');
  for (const [method, route] of [['GET', '/api/admin/users'], ['POST', '/api/trainer/member-program'], ['POST', '/api/admin/platform-enforcement'], ['GET', '/api/me/passkeys'], ['POST', '/api/me/delete'], ['POST', '/api/logout/all'], ['GET', '/api/me/export'], ['POST', '/api/me/sessions/revoke']]) {
    const r = await httpCall(B(), method, route, { cookie: sso, body: method === 'POST' ? {} : undefined });
    assert.equal(r.status, 403, `${method} ${route} -> ${r.status}`); assert.equal(r.json?.code, 'passkey_required');
  }
  assert.equal((await httpCall(B(), 'POST', '/api/admin/platform-enforcement', { cookie: bunkerPasskeyCookie(state.people.free.uid), body: { userId: 'e2e-free', mode: 'shadow' } })).status, 403, 'a non-admin passkey session cannot move users between modes');
  // Redeem endpoints: wrong origin, malformed body, no code.
  assert.equal((await httpCall(B(), 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code: randomBytes(32).toString('base64url') }, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await httpCall(B(), 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code: 'x' }, headers: { origin: B() } })).status, 400);
  // Platform: no member session, forged member cookie, wrong/missing origin (CSRF), internal endpoints without or with the wrong service signature.
  const anyChallenge = () => ({ challenge: s256(randomBytes(32).toString('base64url')) });
  assert.equal((await httpCall(P(), 'POST', '/api/me/training/sso', { body: anyChallenge(), headers: { origin: MEMBER_ORIGIN } })).status, 401);
  assert.equal((await httpCall(P(), 'POST', '/api/me/training/sso', { body: anyChallenge(), cookie: `2j_member_pilot=${'A'.repeat(43)}`, headers: { origin: MEMBER_ORIGIN } })).status, 401);
  const cookie = state.people.free.memberCookie || await loginMember('free');
  assert.equal((await httpCall(P(), 'POST', '/api/me/training/sso', { body: anyChallenge(), cookie, headers: { origin: 'https://evil.example' } })).status, 403, 'Platform rejects a cross-site request');
  assert.equal((await httpCall(P(), 'POST', '/api/me/training/sso', { body: anyChallenge(), cookie })).status, 403, 'and a request with no Origin at all');
  const noChallenge = await httpCall(P(), 'POST', '/api/me/training/sso', { body: {}, cookie, headers: { origin: MEMBER_ORIGIN } });
  assert.equal(noChallenge.status, 400); assert.equal(noChallenge.json.error, 'binding_challenge_required', 'a code is never issued without the challenge of the browser that started the flow');
  const redeemPath = '/api/internal/platform/v2/sso/redeem', body = JSON.stringify({ v: 2, code: randomBytes(32).toString('base64url'), verifier: randomBytes(32).toString('base64url'), audience: '2j-training-sso', purpose: 'training-session' });
  assert.equal((await httpCall(P(), 'POST', redeemPath, { body })).status, 401, 'unsigned');
  const wrong = { id: platformKey.id, secret: randomBytes(32) };
  assert.equal((await httpCall(P(), 'POST', redeemPath, { body, headers: signRequest(wrong, 'POST', redeemPath, Buffer.from(body)) })).status, 401, 'wrong secret');
  const personId = state.people.free.personId;
  assert.equal((await httpCall(P(), 'GET', capsRoute(personId))).status, 401, 'capabilities need service auth, not a member session');
  const replayHeaders = signRequest(platformKey, 'GET', capsRoute(personId), Buffer.alloc(0));
  assert.equal((await httpCall(P(), 'GET', capsRoute(personId), { headers: replayHeaders })).status, 200);
  assert.equal((await httpCall(P(), 'GET', capsRoute(personId), { headers: replayHeaders })).status, 401, 'a signed request is accepted once');
});

E2E('10', 'código SSO reutilizado: el segundo canje falla (también en paralelo)', async () => {
  const { code } = await startSso('codes');
  const [one, two, three] = await Promise.all([redeem(code), redeem(code), redeem(code)]);
  const statuses = [one, two, three].map(r => r.response.status).sort();
  assert.deepEqual(statuses, [200, 400, 400], 'exactly one winner');
  assert.equal((await redeem(code)).response.status, 400);
  const fresh = await startSso('codes');
  assert.equal((await redeem(fresh.code)).response.status, 200, 'a new code works: the account was not locked');
  // A newer code supersedes the previous live one.
  const older = await startSso('codes'), newer = await startSso('codes');
  assert.equal((await redeem(older.code)).response.status, 400, 'the superseded code is dead');
  const winner = await redeem(newer.code); assert.equal(winner.response.status, 200);
  state.people.codes.ssoCookie = winner.cookie;
});

E2E('10b', 'login CSRF y enlaces reenviados: un código solo se canjea desde el navegador que inició el flujo', async () => {
  // The attacker (a linked account) runs the flow in THEIR browser and keeps the code. They send the victim to /sso#code=<that code>.
  const attacker = await startSso('codes');
  assert.equal(attacker.response.status, 201);
  const victim = await newBrowser();                                              // the victim's browser holds its own, unrelated binding cookie
  const cold = await redeem(attacker.code, B(), null);                           // a victim who never started a flow: no cookie at all
  assert.equal(cold.response.status, 400); assert.equal(cold.response.json.error, 'sso_binding_missing'); assert.equal(cold.cookie, '');
  const warm = await redeem(attacker.code, B(), victim);                          // a victim who did start one (their own)
  assert.equal(warm.response.status, 400); assert.equal(warm.response.json.error, 'sso_binding_mismatch'); assert.equal(warm.cookie, '', 'no session for the victim');
  const [pending] = await state.sql`SELECT state FROM platform_training_sso_codes WHERE code_hash=${sha256hex(attacker.code)}`;
  assert.equal(pending.state, 'pending', 'the wrong browsers did not burn the attacker\'s code, and did not use it');
  // The victim signed in as someone else is not offered a switch either: the ticket exists only after a VALID redemption.
  const someone = await ensureSso('free');
  const withSession = await httpCall(B(), 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code: attacker.code }, headers: { origin: B() }, cookie: `${someone}; ${victim.cookie}` });
  assert.equal(withSession.status, 400); assert.equal(withSession.json.error, 'sso_binding_mismatch'); assert.equal(withSession.json.ticket, undefined);
  assert.equal((await httpCall(B(), 'GET', '/api/me', { cookie: someone })).json.user.id, 'e2e-free', 'the victim is still themselves');
  // The legitimate flow is unharmed: the attacker's own browser signs in to the attacker\'s own account.
  const own = await redeem(attacker.code);
  assert.equal(own.response.status, 200); assert.equal(own.response.json.user.id, 'e2e-codes');
  assert.ok(own.setCookie.some(item => /^j2ssob=;.*Max-Age=0/i.test(item)), 'and the binding cookie is spent');
  const [audit] = await state.sql`SELECT count(*)::int AS n FROM platform_identity_audit_events e JOIN platform_training_sso_codes c ON c.id=e.resource_id WHERE c.code_hash=${sha256hex(attacker.code)} AND e.action='training.sso_rejected'`;
  assert.ok(audit.n >= 1 && audit.n <= 5, 'Platform audited the refused attempts, boundedly');
  state.people.codes.ssoCookie = own.cookie;
});

E2E('14a', 'datos históricos intactos tras todos los casos anteriores', async () => {
  for (const label of ['free', 'fuerza', 'otra', 'impago', 'vencido', 'forbid', 'codes']) {
    const saved = JSON.parse(fs.readFileSync(bunkerState(`e2e-${label}`), 'utf8'));
    assert.equal(saved.routines[0].name, `Rutina histórica ${label}`);
    assert.equal(saved.workouts.length, 1);
  }
  const users = JSON.parse(fs.readFileSync(path.join(out, 'bunker-data', 'db.json'), 'utf8')).users;
  assert.equal(users.filter(u => u.id.startsWith('e2e-')).length, PERSONAS.length + 1, 'no Training account was created, merged or removed by SSO');
  assert.ok(users.every(u => !u.id.includes('@')), 'accounts are never keyed by email');
});

/* ---- time-dependent block: one real wait window (Platform up) then one with Platform DOWN ---- */
E2E('06b-08-09', 'suspensión, vínculo revocado y código caducado se hacen efectivos con Platform activo', async () => {
  // Sessions and a state change on Platform while their Búnker answers are cached (<= their TTL).
  for (const label of ['susp', 'revoc', 'outfull', 'outsusp']) await ssoSession(label);
  assert.deepEqual(await probe(state.people.susp.ssoCookie), FREE);
  for (const who of ['susp', 'outsusp']) {
    const suspended = await padmin('POST', `/api/platform/v1/persons/${state.people[who].personId}/training-suspension/suspend`, { reason: 'Prueba E2E de suspensión administrativa' });
    assert.equal(suspended.status, 201, suspended.text);
    assert.equal((await platformCaps(who)).reasonCode, 'ADMIN_SUSPENDED');
  }
  await state.sql`UPDATE training_account_links SET status='revoked',updated_by='e2e' WHERE person_id=${state.people.revoc.personId}`;
  assert.equal((await platformCaps('revoc')).reasonCode, 'TRAINING_LINK_REVOKED');
  // A code that will be past its life when redeemed.
  const expiring = await startSso('codes'); state.expiredCode = expiring.code;
  // Platform refuses NEW codes for suspended / revoked people immediately.
  const refusedSusp = await startSso('susp'); assert.equal(refusedSusp.response.status, 403); assert.equal(refusedSusp.response.json.error, 'training_access_suspended');
  const refusedLink = await startSso('revoc'); assert.equal(refusedLink.response.status, 409); assert.equal(refusedLink.response.json.reasonCode, 'TRAINING_LINK_REVOKED');
  const lifetime = await lifetimesMs(sha256hex(state.expiredCode));
  state.waitStarted = Date.now();
  await sleep(lifetime + 2000);                                         // every cached Búnker answer and the code now expire

  // 06 Suspension reaches Búnker; sessions blocked, data untouched.
  for (const who of ['susp', 'outsusp']) {
    const r = await httpCall(B(), 'GET', '/api/data', { cookie: state.people[who].ssoCookie });
    assert.equal(r.status, 403, who); assert.equal(r.json.code, 'platform_access_blocked'); assert.equal(r.json.reasonCode, 'ADMIN_SUSPENDED');
  }
  assert.deepEqual(await probe(state.people.susp.ssoCookie), BLOCKED);
  // 08 Revoked link: the sso session is closed (401), and the account's passkey login still works.
  const closed = await httpCall(B(), 'GET', '/api/data', { cookie: state.people.revoc.ssoCookie });
  assert.equal(closed.status, 403);
  assert.equal((await httpCall(B(), 'GET', '/api/me', { cookie: state.people.revoc.ssoCookie })).status, 401, 'sso sessions of a revoked link are revoked');
  assert.equal((await httpCall(B(), 'GET', '/api/me', { cookie: bunkerPasskeyCookie(state.people.revoc.uid) })).status, 200, 'the passkey login of the account is untouched');
  // 09 Expired one-time code.
  const expired = await redeem(state.expiredCode);
  assert.equal(expired.response.status, 400); assert.equal(expired.response.json.error, 'sso_code_invalid');
  const [row] = await state.sql`SELECT state,terminal_reason FROM platform_training_sso_codes WHERE code_hash=${sha256hex(state.expiredCode)}`;
  assert.equal(row.state, 'expired');
  state.notes.windowSeconds = Math.round((Date.now() - state.waitStarted) / 1000);
  state.lifetimeMs = lifetime;
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
  await sleep(state.lifetimeMs + 2000);                                 // the cache expires while Platform is unreachable
  // 12 Expired cache + outage: free functions survive, paid ones are NOT granted without verification.
  assert.deepEqual(await probe(state.people.outfull.ssoCookie), FREE);
  // 11 A suspension Búnker had already learned keeps blocking while Platform is down; and so does a lift it cannot verify yet.
  assert.deepEqual(await probe(state.people.outsusp.ssoCookie), BLOCKED);
  assert.deepEqual(await probe(state.people.susp.ssoCookie), BLOCKED, 'an unverified lift is not assumed');
  // New sign-ins cannot happen without Platform; the passkey login keeps working.
  const outageBrowser = await newBrowser();                              // starting the flow needs no Platform
  const noPlatform = await httpCall(B(), 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code: randomBytes(32).toString('base64url') }, headers: { origin: B() }, cookie: outageBrowser.cookie });
  assert.equal(noPlatform.status, 503);
  assert.equal((await httpCall(B(), 'GET', '/api/me', { cookie: bunkerPasskeyCookie(state.people.outfull.uid) })).status, 200);
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
    assert.equal((await httpCall(B(), 'GET', '/api/me', { cookie: bunkerPasskeyCookie(`e2e-${label}`) })).status, 200, `${label} still signs in with its own credentials`);
  }
  const [counts] = await state.sql`SELECT (SELECT count(*) FROM platform_persons)::int AS persons, (SELECT count(*) FROM training_account_links)::int AS links`;
  assert.equal(counts.persons, PERSONAS.length); assert.equal(counts.links, PERSONAS.length);
  const audit = await state.sql`SELECT action,count(*)::int AS n FROM platform_identity_audit_events WHERE action LIKE 'training.sso_%' GROUP BY action`;
  state.notes.ssoAudit = Object.fromEntries(audit.map(row => [row.action, row.n]));
  assert.ok(state.notes.ssoAudit['training.sso_issued'] > 0 && state.notes.ssoAudit['training.sso_redeemed'] > 0 && state.notes.ssoAudit['training.sso_rejected'] > 0);
  const events = (await httpCall(B(), 'GET', '/api/me/security-events', { cookie: bunkerPasskeyCookie('e2e-free') })).json.events;
  assert.ok(events.some(item => item.event === 'platform_sso_login'), 'Búnker keeps its own record of the SSO sign-in');
});

E2E('15', 'los logs de Platform y Búnker no contienen errores inesperados ni códigos, cookies o secretos', async () => {
  const read = name => fs.readFileSync(path.join(out, `${name}.log`), 'utf8');
  const platformLog = read('platform'), bunkerLog = read('bunker');
  const errors = platformLog.split('\n').filter(line => /"level":(50|60)\b/.test(line));
  assert.deepEqual(errors.map(line => line.slice(0, 200)), [], 'Platform logged no errors');
  const bunkerErrors = bunkerLog.split('\n').filter(line => /\b(TypeError|ReferenceError|SyntaxError|UnhandledPromiseRejection|ERR_[A-Z_]+)\b/.test(line));
  assert.deepEqual(bunkerErrors.map(line => line.slice(0, 200)), [], 'Búnker logged no unexpected errors');
  const everything = `${platformLog}\n${bunkerLog}`;
  for (const pattern of [/#code=[A-Za-z0-9_-]{43}/, /gymsid=[^;\s]{20,}/, /2j_member_pilot=[A-Za-z0-9_-]{40,}/, /x-2j-signature/i]) assert.doesNotMatch(everything, pattern, `logs must not contain ${pattern}`);
  for (const secret of [...state.secretsSeen, BUNKER_SECRET_TEXT, b64(platformKey.secret), b64(proofKey.secret)]) {
    const value = secret.includes('=') ? secret.split('=').pop() : secret;
    if (value && value.length >= 20) assert.ok(!everything.includes(value), 'a code, cookie or secret value appeared in a log');
  }
  state.notes.logsChecked = { platformBytes: platformLog.length, bunkerBytes: bunkerLog.length, secretsChecked: state.secretsSeen.size + 3 };
});
