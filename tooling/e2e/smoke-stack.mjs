// Local, disposable stack for a real-browser smoke test of Home -> Platform -> Búnker SSO.
// Starts Platform (3100) and the Búnker API (4301) on loopback against a disposable database and temp data, seeds two linked
// test people and prints their TEST-ONLY member codes. Keep it running while Vite serves Home (5173) and the Búnker frontend (4300).
// Secrets are random per run and child processes get a minimal environment. Stop it with Ctrl+C or by creating the `stop` file it prints.
// Run from apps/api:
//   E2E_DATABASE_ADMIN_URL=... E2E_BUNKER_API_DIR=... node --import tsx ../../tooling/e2e/smoke-stack.mjs
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { activateTrainingLink, b64, childEnv, httpCall, monthRange, passkeyCookieFor, randomSecret, resolveOutDir, sha256hex, signRequest, sleep, startProcess, waitHttp } from './lib.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const platformApiDir = path.join(repoRoot, 'apps', 'api');
const adminUrl = process.env.E2E_DATABASE_ADMIN_URL;
if (!adminUrl || !process.env.E2E_BUNKER_API_DIR) throw new Error('Set E2E_DATABASE_ADMIN_URL and E2E_BUNKER_API_DIR.');
const bunkerApiDir = path.resolve(process.env.E2E_BUNKER_API_DIR);
if (!['127.0.0.1', 'localhost'].includes(new URL(adminUrl).hostname)) throw new Error('Loopback database only.');
const PORTS = { platform: 3100, bunkerApi: 4301, bunkerWeb: 4300, home: 5173 };
const MEMBER_ORIGIN = `http://127.0.0.1:${PORTS.home}`;
const BUNKER_ORIGIN = `http://localhost:${PORTS.bunkerWeb}`;
const out = resolveOutDir('smoke', repoRoot);
const requireFromApi = createRequire(path.join(platformApiDir, 'package.json'));
const postgres = await import(pathToFileURL(requireFromApi.resolve('postgres')).href).then(m => m.default ?? m);
const platformKey = { id: 'smoke-bunker-v1', secret: randomBytes(32) }, proofKey = { id: 'smoke-platform-v1', secret: randomBytes(32) };
const BUNKER_SECRET = randomSecret();
const passkeyCookie = passkeyCookieFor(BUNKER_SECRET);

const procs = [];
const start = (name, args, cwd, env) => { const proc = startProcess(out, name, args, cwd, env); procs.push(proc.child); return proc; };

const dbName = `smoke_${randomUUID().replaceAll('-', '')}`;
const admin = postgres(adminUrl, { max: 1 }); await admin.unsafe(`CREATE DATABASE "${dbName}"`); await admin.end();
const dbUrl = new URL(adminUrl); dbUrl.pathname = `/${dbName}`;
const sql = postgres(dbUrl.toString(), { max: 3 });
await new Promise((res, rej) => spawn(process.execPath, ['--import', 'tsx', 'src/migrate.ts'], { cwd: platformApiDir, env: childEnv({ DATABASE_URL: dbUrl.toString() }), stdio: 'ignore', windowsHide: true }).on('exit', c => c === 0 ? res() : rej(new Error(`migrate ${c}`))));
start('platform', ['--import', 'tsx', 'src/server.ts'], platformApiDir, {
  DATABASE_URL: dbUrl.toString(), HOST: '127.0.0.1', PORT: String(PORTS.platform), NODE_ENV: 'development', LOCAL_DEMO_ROLE: 'admin',
  PILOT_MEMBER_AUTH_ENABLED: 'true', MEMBER_APP_ORIGIN: MEMBER_ORIGIN, CORS_ORIGIN: MEMBER_ORIGIN,
  PLATFORM_INTERNAL_SERVICE_KEYS: JSON.stringify({ [platformKey.id]: { caller: 'bunker', secret: b64(platformKey.secret) } }),
  TRAINING_SSO_ENABLED: 'true', TRAINING_SSO_REDIRECT_URL: `${BUNKER_ORIGIN}/sso`,
});
const P = `http://127.0.0.1:${PORTS.platform}`;
await waitHttp(`${P}/health`, 'Platform', out);

const dataDir = path.join(out, 'bunker-data'); fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'secret'), BUNKER_SECRET, { mode: 0o600 });
const people = [['demo-free', 'María', null], ['demo-fuerza', 'Carlos', 'full']];
fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: people.map(([uid, name]) => ({ id: uid, name, username: uid })), creds: [], subs: [], invites: [], recoveries: [] }, null, 2));
for (const [uid, name] of people) fs.writeFileSync(path.join(dataDir, `state-${uid}.json`), JSON.stringify({ unit: 'kg', lang: 'es', routines: [{ id: 'r1', name: `Rutina histórica de ${name}`, emoji: '💪', ex: [{ id: '0001', sets: 3, reps: 10, mode: 'reps', weight: 20 }] }], week: { 1: 'r1' }, workouts: [{ d: '2026-09-01', routineId: 'r1' }] }));
start('bunker', ['server.js'], bunkerApiDir, {
  PORT: String(PORTS.bunkerApi), DATA_DIR: dataDir, SECRET_FILE: path.join(dataDir, 'secret'), RP_ID: 'localhost', ORIGIN: BUNKER_ORIGIN,
  PLATFORM_SSO_ENABLED: 'true', PLATFORM_HOME_URL: MEMBER_ORIGIN, PLATFORM_API_BASE_URL: P, PLATFORM_API_KEY_ID: platformKey.id, PLATFORM_API_KEY_SECRET: b64(platformKey.secret),
  PLATFORM_PROOF_ISSUANCE_ENABLED: 'true', PLATFORM_PROOF_EXCHANGE_ENABLED: 'true', PLATFORM_LINK_LIFECYCLE_ENABLED: 'true', PLATFORM_SERVICE_AUTH_KEYS: JSON.stringify({ [proofKey.id]: b64(proofKey.secret) }),
});
const BA = `http://127.0.0.1:${PORTS.bunkerApi}`;
await waitHttp(`${BA}/api/health`, 'Búnker', out);

const adm = (m, r, b, idem = true) => httpCall(P, m, r, { body: b, headers: idem ? { 'idempotency-key': randomUUID() } : {} });
const [area] = await sql`SELECT id FROM areas WHERE normalized_name='la sala'`;
const service = (await adm('POST', '/api/services', { name: `Servicio ${randomUUID()}`, areaId: area.id, status: 'active' }, false)).json;
const plan = (await adm('POST', '/api/plans', { name: `Plan Fuerza ${randomUUID()}`, serviceIds: [service.id], kind: 'recurring', renewalCadence: 'monthly', basePriceCents: 4500, rights: [{ rightType: 'service_access', serviceId: service.id }, { rightType: 'training_access', trainingAccessLevel: 'full' }] })).json;
await adm('POST', `/api/plans/${plan.id}/activate`, undefined, false);
const codes = {};
for (const [uid, name, level] of people) {
  const client = (await adm('POST', '/api/clients', { firstName: name, lastName: 'Demo' })).json;
  const personId = (await adm('POST', '/api/platform/v1/persons', { clientId: client.id })).json.personId;
  const code = `demo-code-${uid}-${randomUUID().slice(0, 8)}`, subjectId = randomUUID();
  await sql`INSERT INTO platform_person_auth_subjects(id,person_id,auth_subject,provider,status,created_by) VALUES (${subjectId},${personId},${`subject-${uid}`},'platform-pilot','active','smoke')`;
  await sql`INSERT INTO platform_member_pilot_credentials(auth_subject_link_id,code_hash) VALUES (${subjectId},${sha256hex(code)})`;
  await sql`INSERT INTO training_account_links(request_id,person_id,training_user_id,method,created_by,updated_by) VALUES (${randomUUID()},${personId},${uid},'explicit_admin','smoke','smoke')`;
  if (level) {
    const sale = (await adm('POST', `/api/clients/${client.id}/plans`, { planId: plan.id, ...monthRange(0), amountCents: 4500 })).json;
    await adm('POST', '/api/economics/payments', { chargeId: sale.chargeId, splits: [{ method: 'card', amountCents: 4500 }] });
  }
  const ctx = { transactionId: randomUUID(), personId, audience: '2j-training-account-link', purpose: 'training-account-link', challengeDigest: sha256hex(randomBytes(32)) };
  const issued = await httpCall(BA, 'POST', '/api/platform/v1/link-proofs', { cookie: passkeyCookie(uid), body: { v: 1, ...ctx, expiresAt: new Date(Date.now() + 240_000).toISOString() } });
  const body = JSON.stringify({ v: 1, code: issued.json.code, ...ctx });
  const ex = await httpCall(BA, 'POST', '/api/platform/v1/link-proofs/exchange', { body, headers: signRequest(proofKey, 'POST', '/api/platform/v1/link-proofs/exchange', Buffer.from(body)) });
  if (ex.status !== 200) throw new Error(`link proof failed for ${uid}: ${ex.text}`);
  const [link] = await sql`SELECT link_id FROM training_account_links WHERE person_id=${personId}`;
  const acked = await activateTrainingLink(BA, proofKey, { linkId: link.link_id, personId, trainingUserId: uid });
  if (acked.status !== 200) throw new Error(`Búnker acknowledgement failed for ${uid}: ${acked.text}`);
  codes[uid] = code;
}
const stopFile = path.join(out, 'stop');
fs.writeFileSync(path.join(out, 'stack.json'), JSON.stringify({ ports: PORTS, memberCodes: codes, out, stopFile }, null, 2));
console.log(JSON.stringify({ ready: true, out, stopFile, ports: PORTS, memberCodes: codes }));
const shutdown = async () => {
  for (const p of procs) p.kill();
  try { await sql.end(); } catch { /* closing */ }
  const a = postgres(adminUrl, { max: 1 }); await a.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {}); await a.end();
  if (process.env.E2E_KEEP !== '1') fs.rmSync(out, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
while (!fs.existsSync(stopFile)) await sleep(1000);
await shutdown();
