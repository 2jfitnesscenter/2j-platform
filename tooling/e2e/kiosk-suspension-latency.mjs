// MEASURES (does not assert a guarantee) how long an already-open kiosk token keeps working after an administrative suspension.
// Real Platform + real Búnker processes on loopback, disposable PostgreSQL, random secrets, synthetic data. Three measurements:
//   A  Platform suspension  -> first 403 at the kiosk       (bounded by the 60 s capability cache; measured at random cache ages)
//   B  Platform DOWN, then an administrator disables the account locally in Búnker -> first 401 at the kiosk  (the emergency procedure)
//   C  Platform DOWN and nobody acts -> the kiosk keeps working with the free baseline (the exposure the emergency procedure closes)
// Usage (from apps/api):
//   E2E_DATABASE_ADMIN_URL=postgres://user:pass@127.0.0.1:PORT/postgres E2E_BUNKER_API_DIR=<bunker>/api [LATENCY_TRIALS=8] [LATENCY_POLL_MS=250] \
//     node --import tsx ../../tooling/e2e/kiosk-suspension-latency.mjs
// Prints a JSON report (also written to E2E_LATENCY_REPORT if set). Exit code 0 even when a latency is "long": the numbers are the result.
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { activateTrainingLink, b64, childEnv, freePort, httpCall, passkeyCookieFor, randomSecret, resolveOutDir, signRequest, sleep, startProcess, stopProcess, waitHttp } from './lib.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const platformApiDir = path.join(repoRoot, 'apps', 'api');
const adminUrl = process.env.E2E_DATABASE_ADMIN_URL, bunkerApiDir = process.env.E2E_BUNKER_API_DIR ? path.resolve(process.env.E2E_BUNKER_API_DIR) : null;
if (!adminUrl || !bunkerApiDir) throw new Error('Set E2E_DATABASE_ADMIN_URL and E2E_BUNKER_API_DIR.');
if (!['127.0.0.1', 'localhost'].includes(new URL(adminUrl).hostname)) throw new Error('Loopback database only.');
const TRIALS = Number(process.env.LATENCY_TRIALS || 8), POLL_MS = Number(process.env.LATENCY_POLL_MS || 250);
const out = resolveOutDir('latency', repoRoot);
const postgres = await import(pathToFileURL(createRequire(path.join(platformApiDir, 'package.json')).resolve('postgres')).href).then(m => m.default ?? m);
const platformKey = { id: 'lat-bunker-v1', secret: randomBytes(32) }, proofKey = { id: 'lat-platform-v1', secret: randomBytes(32) };
const SECRET = randomSecret(), passkey = passkeyCookieFor(SECRET), MEMBER = 'http://127.0.0.1:5173';
const ports = { platform: await freePort(), bunker: await freePort() };
const P = `http://127.0.0.1:${ports.platform}`, B = `http://localhost:${ports.bunker}`;
const dbName = `lat_${randomUUID().replaceAll('-', '')}`;
let sql, platform, bunker;

async function startPlatform() {
  platform = startProcess(out, 'platform', ['--import', 'tsx', 'src/server.ts'], platformApiDir, {
    DATABASE_URL: dbUrl, HOST: '127.0.0.1', PORT: String(ports.platform), NODE_ENV: 'development', LOCAL_DEMO_ROLE: 'admin', PILOT_MEMBER_AUTH_ENABLED: 'true', MEMBER_APP_ORIGIN: MEMBER, CORS_ORIGIN: MEMBER,
    PLATFORM_INTERNAL_SERVICE_KEYS: JSON.stringify({ [platformKey.id]: { caller: 'bunker', secret: b64(platformKey.secret) } }),
  });
  await waitHttp(`${P}/health`, 'Platform', out);
}
async function startBunker() {
  bunker = startProcess(out, 'bunker', ['server.js'], bunkerApiDir, {
    PORT: String(ports.bunker), DATA_DIR: path.join(out, 'bunker-data'), SECRET_FILE: path.join(out, 'bunker-data', 'secret'), RP_ID: 'localhost', ORIGIN: B,
    PLATFORM_SSO_ENABLED: 'true', PLATFORM_API_BASE_URL: P, PLATFORM_API_KEY_ID: platformKey.id, PLATFORM_API_KEY_SECRET: b64(platformKey.secret),
    PLATFORM_PROOF_ISSUANCE_ENABLED: 'true', PLATFORM_PROOF_EXCHANGE_ENABLED: 'true', PLATFORM_LINK_LIFECYCLE_ENABLED: 'true', PLATFORM_SERVICE_AUTH_KEYS: JSON.stringify({ [proofKey.id]: b64(proofKey.secret) }),
  });
  await waitHttp(`${B}/api/health`, 'Búnker', out);
}

const adm = await postgres(adminUrl, { max: 1 }); await adm.unsafe(`CREATE DATABASE "${dbName}"`); await adm.end();
const dbU = new URL(adminUrl); dbU.pathname = `/${dbName}`; const dbUrl = dbU.toString();
sql = postgres(dbUrl, { max: 3 });
await new Promise((resolve, reject) => spawn(process.execPath, ['--import', 'tsx', 'src/migrate.ts'], { cwd: platformApiDir, env: childEnv({ DATABASE_URL: dbUrl }), stdio: 'ignore', windowsHide: true }).on('exit', c => c === 0 ? resolve() : reject(new Error('migrate ' + c))));
await startPlatform();
const dataDir = path.join(out, 'bunker-data'); fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: 'lat-member', name: 'Latencia', username: 'lat' }, { id: 'lat-admin', name: 'Admin', username: 'ladmin', admin: true, trainer: true }], creds: [], subs: [], invites: [], recoveries: [] }, null, 2));
fs.writeFileSync(path.join(dataDir, 'state-lat-member.json'), JSON.stringify({ unit: 'kg', lang: 'es', routines: [], workouts: [] }));
await startBunker();

const padmin = (method, route, body, headers = {}) => httpCall(P, method, route, { body, headers: { 'idempotency-key': randomUUID(), ...headers } });
const client = (await padmin('POST', '/api/clients', { firstName: 'Latencia', lastName: 'E2E' })).json;
const personId = (await padmin('POST', '/api/platform/v1/persons', { clientId: client.id })).json.personId;
await sql`INSERT INTO training_account_links(request_id,person_id,training_user_id,method,created_by,updated_by) VALUES (${randomUUID()},${personId},'lat-member','explicit_admin','lat','lat')`;
const [link] = await sql`SELECT link_id FROM training_account_links WHERE person_id=${personId}`;
// Búnker's own evidence + acknowledgement of the link (what the real proof/activation flow produces).
const ctx = { transactionId: randomUUID(), personId, audience: '2j-training-account-link', purpose: 'training-account-link', challengeDigest: randomBytes(32).toString('hex') };
const issued = await httpCall(B, 'POST', '/api/platform/v1/link-proofs', { cookie: passkey('lat-member'), body: { v: 1, ...ctx, expiresAt: new Date(Date.now() + 240_000).toISOString() } });
const exBody = JSON.stringify({ v: 1, code: issued.json.code, ...ctx });
await httpCall(B, 'POST', '/api/platform/v1/link-proofs/exchange', { body: exBody, headers: signRequest(proofKey, 'POST', '/api/platform/v1/link-proofs/exchange', Buffer.from(exBody)) });
const acked = await activateTrainingLink(B, proofKey, { linkId: link.link_id, personId, trainingUserId: 'lat-member' });
if (acked.status !== 200) throw new Error('link acknowledgement failed: ' + acked.text);
const setMode = mode => httpCall(B, 'POST', '/api/admin/platform-enforcement', { cookie: passkey('lat-admin'), body: { userId: 'lat-member', mode } });
await setMode('shadow'); const enforced = await setMode('enforced'); if (enforced.status !== 200) throw new Error('enforce failed: ' + enforced.text);

const pin = (await httpCall(B, 'GET', '/api/bunker/pin', { cookie: passkey('lat-member') })).json.pin;
/** After a lift the previous suspension can still be cached for up to 60 s: keep trying to check in; `waitedMs` is the RESTORATION latency. */
const checkin = async () => {
  const t0 = Date.now();
  for (let i = 0; i < 480; i++) { const r = await httpCall(B, 'POST', '/api/bunker/checkin', { body: { pin } }); if (r.status === 200 && r.json?.token) return { ...r.json, waitedMs: Date.now() - t0 }; await sleep(250); }
  throw new Error('could not check in within 120 s');
};
const kiosk = token => httpCall(B, 'GET', '/api/bunker/session', { headers: { authorization: `Bearer ${token}` } });
const suspension = action => padmin('POST', `/api/platform/v1/persons/${personId}/training-suspension/${action}`, { reason: 'latency measurement, synthetic account' });
const percentile = (values, p) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };

let liftedAt = 0;
const report = { startedAt: new Date().toISOString(), pollMs: POLL_MS, capabilityCacheMaxMs: 60_000, trials: [] };
try {
  // A. Platform suspension at random cache ages.
  for (let i = 0; i < TRIALS; i++) {
    const session = await checkin(); const token = session.token;       // waits until the previous lift is visible
    if (liftedAt) report.trials.at(-1).restorationMs = Date.now() - liftedAt;
    if ((await kiosk(token)).status !== 200) throw new Error('kiosk unusable right after a successful check-in');
    const age = Math.floor(Math.random() * 55_000);                                                    // let the cache age before the suspension
    await sleep(age);
    const t0 = Date.now(); const s = await suspension('suspend'); if (![200, 201].includes(s.status)) throw new Error('suspend failed ' + s.text);
    let blockedAt = null;
    while (Date.now() - t0 < 130_000) { const r = await kiosk(token); if (r.status === 403) { blockedAt = Date.now(); break; } await sleep(POLL_MS); }
    report.trials.push({ trial: i + 1, cacheAgeBeforeSuspensionMs: age, latencyMs: blockedAt ? blockedAt - t0 : null });
    await suspension('lift'); liftedAt = Date.now();
    await sleep(200);
  }
  const lat = report.trials.map(t => t.latencyMs).filter(v => v !== null);
  report.platformSuspension = { n: lat.length, minMs: Math.min(...lat), p50Ms: percentile(lat, 0.5), p95Ms: percentile(lat, 0.95), maxMs: Math.max(...lat), neverBlocked: report.trials.length - lat.length };

  // B/C. Platform down.
  const session = await checkin(); const token = session.token;
  for (let t = 0; t < 40 && (await kiosk(token)).status !== 200; t++) await sleep(500);
  await stopProcess(platform);
  await sleep(1_000);
  const tDown = Date.now(); const duringOutage = [];
  while (Date.now() - tDown < 75_000) { duringOutage.push((await kiosk(token)).status); await sleep(2_500); }
  report.platformDownNobodyActs = { observedMs: Date.now() - tDown, statuses: [...new Set(duringOutage)], kioskStillWorking: duringOutage.every(s => s === 200), note: 'free baseline includes autonomousTraining: an unknown (undeliverable) suspension does not reach the kiosk until Platform is back or someone disables the account locally' };
  const t1 = Date.now(); const disabled = await httpCall(B, 'POST', '/api/admin/user/disable', { cookie: passkey('lat-admin'), body: { id: 'lat-member', disabled: true } });
  let localBlock = null;
  while (Date.now() - t1 < 10_000) { const r = await kiosk(token); if ([401, 403].includes(r.status)) { localBlock = { status: r.status, ms: Date.now() - t1 }; break; } await sleep(100); }
  report.emergencyLocalDisable = { adminCallStatus: disabled.status, firstBlockedAfter: localBlock, note: 'independent of Platform; the account cannot sign in at all until re-enabled' };
} finally {
  report.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(report, null, 2));
  if (process.env.E2E_LATENCY_REPORT) fs.writeFileSync(process.env.E2E_LATENCY_REPORT, JSON.stringify(report, null, 2));
  await stopProcess(bunker); await stopProcess(platform);
  try { await sql.end(); } catch { /* closing */ }
  try { const a = postgres(adminUrl, { max: 1 }); await a.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`); await a.end(); } catch { /* disposable */ }
  fs.rmSync(out, { recursive: true, force: true });
}
