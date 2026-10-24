// MEASURES (does not assert a guarantee) how long an already-open kiosk token keeps working after an administrative suspension WHEN the signed
// Platform -> Búnker signal (2J-CAPABILITY-SIGNAL-V1, proof of concept) is switched on, to compare with kiosk-suspension-latency.mjs (cache only, ≈ 60 s).
// Real Platform + real Búnker processes on loopback, disposable PostgreSQL, random secrets, synthetic data. Measurements:
//   A  suspension -> first 403 at the kiosk, at random cache ages (the signal makes it independent of the cache age); and lift -> access back
//   B  Platform stopped RIGHT AFTER the suspension call (before it could deliver) and restarted: the durable outbox delivers after the restart
//   C  Búnker stopped during the suspension and restarted: the retry delivers (the kiosk token survives a Búnker restart: it is signed, not stored)
// Usage (from apps/api): same variables as kiosk-suspension-latency.mjs  [SIGNAL_TRIALS=6]
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
const TRIALS = Number(process.env.SIGNAL_TRIALS || 6), POLL_MS = 100;
const out = resolveOutDir('signal', repoRoot);
const postgres = await import(pathToFileURL(createRequire(path.join(platformApiDir, 'package.json')).resolve('postgres')).href).then(m => m.default ?? m);
const platformKey = { id: 'sig-bunker-v1', secret: randomBytes(32) }, proofKey = { id: 'sig-platform-v1', secret: randomBytes(32) };
const SECRET = randomSecret(), passkey = passkeyCookieFor(SECRET), MEMBER = 'http://127.0.0.1:5173';
const ports = { platform: await freePort(), bunker: await freePort() };
const P = `http://127.0.0.1:${ports.platform}`, B = `http://localhost:${ports.bunker}`;
const dbName = `sig_${randomUUID().replaceAll('-', '')}`;
let sql, platform, bunker, dbUrl;

async function startPlatform() {
  platform = startProcess(out, 'platform', ['--import', 'tsx', 'src/server.ts'], platformApiDir, {
    DATABASE_URL: dbUrl, HOST: '127.0.0.1', PORT: String(ports.platform), NODE_ENV: 'development', LOCAL_DEMO_ROLE: 'admin', PILOT_MEMBER_AUTH_ENABLED: 'true', MEMBER_APP_ORIGIN: MEMBER, CORS_ORIGIN: MEMBER,
    PLATFORM_INTERNAL_SERVICE_KEYS: JSON.stringify({ [platformKey.id]: { caller: 'bunker', secret: b64(platformKey.secret) } }),
    TRAINING_SERVICE_CALLS_ENABLED: 'true', TRAINING_SERVICE_ALLOW_INSECURE_LOOPBACK: 'true', TRAINING_SERVICE_BASE_URL: B, TRAINING_SERVICE_KEY_ID: proofKey.id, TRAINING_SERVICE_SECRET: b64(proofKey.secret),
    TRAINING_SIGNALS_ENABLED: 'true', TRAINING_SIGNALS_INTERVAL_MS: '500',
  });
  await waitHttp(`${P}/health`, 'Platform', out);
}
async function startBunker() {
  bunker = startProcess(out, 'bunker', ['server.js'], bunkerApiDir, {
    PORT: String(ports.bunker), DATA_DIR: path.join(out, 'bunker-data'), SECRET_FILE: path.join(out, 'bunker-data', 'secret'), RP_ID: 'localhost', ORIGIN: B,
    PLATFORM_SSO_ENABLED: 'true', PLATFORM_API_BASE_URL: P, PLATFORM_API_KEY_ID: platformKey.id, PLATFORM_API_KEY_SECRET: b64(platformKey.secret),
    PLATFORM_PROOF_ISSUANCE_ENABLED: 'true', PLATFORM_PROOF_EXCHANGE_ENABLED: 'true', PLATFORM_LINK_LIFECYCLE_ENABLED: 'true', PLATFORM_SIGNALS_ENABLED: 'true',
    PLATFORM_SERVICE_AUTH_KEYS: JSON.stringify({ [proofKey.id]: b64(proofKey.secret) }),
  });
  await waitHttp(`${B}/api/health`, 'Búnker', out);
}

const adm = await postgres(adminUrl, { max: 1 }); await adm.unsafe(`CREATE DATABASE "${dbName}"`); await adm.end();
const dbU = new URL(adminUrl); dbU.pathname = `/${dbName}`; dbUrl = dbU.toString();
sql = postgres(dbUrl, { max: 3 });
await new Promise((resolve, reject) => spawn(process.execPath, ['--import', 'tsx', 'src/migrate.ts'], { cwd: platformApiDir, env: childEnv({ DATABASE_URL: dbUrl }), stdio: 'ignore', windowsHide: true }).on('exit', c => c === 0 ? resolve() : reject(new Error('migrate ' + c))));
await startPlatform();
const dataDir = path.join(out, 'bunker-data'); fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: 'sig-member', name: 'Señal', username: 'sig' }, { id: 'sig-admin', name: 'Admin', username: 'sadmin', admin: true, trainer: true }], creds: [], subs: [], invites: [], recoveries: [] }, null, 2));
fs.writeFileSync(path.join(dataDir, 'state-sig-member.json'), JSON.stringify({ unit: 'kg', lang: 'es', routines: [], workouts: [] }));
await startBunker();

const padmin = (method, route, body, headers = {}) => httpCall(P, method, route, { body, headers: { 'idempotency-key': randomUUID(), ...headers } });
const client = (await padmin('POST', '/api/clients', { firstName: 'Señal', lastName: 'E2E' })).json;
const personId = (await padmin('POST', '/api/platform/v1/persons', { clientId: client.id })).json.personId;
await sql`INSERT INTO training_account_links(request_id,person_id,training_user_id,method,created_by,updated_by) VALUES (${randomUUID()},${personId},'sig-member','explicit_admin','sig','sig')`;
const [link] = await sql`SELECT link_id FROM training_account_links WHERE person_id=${personId}`;
const ctx = { transactionId: randomUUID(), personId, audience: '2j-training-account-link', purpose: 'training-account-link', challengeDigest: randomBytes(32).toString('hex') };
const issued = await httpCall(B, 'POST', '/api/platform/v1/link-proofs', { cookie: passkey('sig-member'), body: { v: 1, ...ctx, expiresAt: new Date(Date.now() + 240_000).toISOString() } });
const exBody = JSON.stringify({ v: 1, code: issued.json.code, ...ctx });
await httpCall(B, 'POST', '/api/platform/v1/link-proofs/exchange', { body: exBody, headers: signRequest(proofKey, 'POST', '/api/platform/v1/link-proofs/exchange', Buffer.from(exBody)) });
const acked = await activateTrainingLink(B, proofKey, { linkId: link.link_id, personId, trainingUserId: 'sig-member' });
if (acked.status !== 200) throw new Error('link acknowledgement failed: ' + acked.text);
const setMode = mode => httpCall(B, 'POST', '/api/admin/platform-enforcement', { cookie: passkey('sig-admin'), body: { userId: 'sig-member', mode } });
await setMode('shadow'); const enforced = await setMode('enforced'); if (enforced.status !== 200) throw new Error('enforce failed: ' + enforced.text);

const pin = (await httpCall(B, 'GET', '/api/bunker/pin', { cookie: passkey('sig-member') })).json.pin;
const checkin = async () => { for (let i = 0; i < 240; i++) { const r = await httpCall(B, 'POST', '/api/bunker/checkin', { body: { pin } }); if (r.status === 200 && r.json?.token) return r.json.token; await sleep(250); } throw new Error('could not check in'); };
const kiosk = token => httpCall(B, 'GET', '/api/bunker/session', { headers: { authorization: `Bearer ${token}` } });
const action = name => padmin('POST', `/api/platform/v1/persons/${personId}/training-suspension/${name}`, { reason: 'signal latency measurement, synthetic account' });
const percentile = (values, p) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };
const untilBlocked = async (token, t0, limitMs = 130_000) => { while (Date.now() - t0 < limitMs) { const r = await kiosk(token); if (r.status === 403) return Date.now() - t0; await sleep(POLL_MS); } return null; };
const untilOpen = async (limitMs = 130_000) => { const t0 = Date.now(); while (Date.now() - t0 < limitMs) { const r = await httpCall(B, 'POST', '/api/bunker/checkin', { body: { pin } }); if (r.status === 200 && r.json?.token) return { token: r.json.token, ms: Date.now() - t0 }; await sleep(POLL_MS); } return { token: null, ms: null }; };

const report = { startedAt: new Date().toISOString(), mechanism: 'signed Platform -> Búnker signal, dispatcher poll 500 ms (proof of concept)', pollMs: POLL_MS, trials: [] };
try {
  // A. Suspension at random cache ages, and the way back.
  let token = await checkin();
  for (let i = 0; i < TRIALS; i++) {
    if ((await kiosk(token)).status !== 200) throw new Error('kiosk unusable right after a successful check-in');
    const age = Math.floor(Math.random() * 45_000);
    await sleep(age);
    const t0 = Date.now(); const s = await action('suspend'); if (![200, 201].includes(s.status)) throw new Error('suspend failed ' + s.text);
    const latencyMs = await untilBlocked(token, t0);
    const l0 = Date.now(); await action('lift');
    const reopened = await untilOpen();
    report.trials.push({ trial: i + 1, cacheAgeBeforeSuspensionMs: age, blockLatencyMs: latencyMs, restoreLatencyMs: reopened.token ? Date.now() - l0 : null });
    token = reopened.token ?? await checkin();
  }
  const lat = report.trials.map(t => t.blockLatencyMs).filter(v => v !== null), res = report.trials.map(t => t.restoreLatencyMs).filter(v => v !== null);
  report.suspension = { n: lat.length, minMs: Math.min(...lat), p50Ms: percentile(lat, 0.5), p95Ms: percentile(lat, 0.95), maxMs: Math.max(...lat), neverBlocked: report.trials.length - lat.length };
  report.restoration = { n: res.length, minMs: Math.min(...res), p50Ms: percentile(res, 0.5), maxMs: Math.max(...res) };

  // B. Platform dies right after accepting the suspension: the signal waits in the durable outbox and goes out after the restart.
  token = await checkin(); await sleep(15_000);
  const sB = await action('suspend'); if (![200, 201].includes(sB.status)) throw new Error('suspend B failed');
  const tB = Date.now(); await stopProcess(platform);
  const during = (await kiosk(token)).status;                                       // Platform is down and no signal could have left (or it already did: recorded)
  await sleep(4_000); await startPlatform();
  const blockedB = await untilBlocked(token, tB, 60_000);
  report.platformStoppedAfterSuspension = { kioskStatusWhileDown: during, blockedAfterMs: blockedB, note: 'if the signal left before the process died the kiosk is already blocked while Platform is down (status 403); otherwise it is delivered after the restart' };
  await action('lift'); const back = await untilOpen(); token = back.token ?? await checkin();

  // C. Búnker down during the suspension: retried until it is back.
  await sleep(10_000);
  await stopProcess(bunker);
  const sC = await action('suspend'); if (![200, 201].includes(sC.status)) throw new Error('suspend C failed');
  await sleep(4_000);
  const tC = Date.now(); await startBunker();
  const blockedC = await untilBlocked(token, tC, 60_000);
  report.bunkerRestartedAfterSuspension = { blockedAfterBunkerReadyMs: blockedC, note: 'the kiosk token is signed (not stored), so it survives the restart; the dispatcher retries with backoff until Búnker answers' };
  const [stats] = await sql`SELECT count(*) FILTER (WHERE state='delivered')::int AS delivered, count(*) FILTER (WHERE state='pending')::int AS pending, count(*) FILTER (WHERE state='superseded')::int AS superseded, max(attempts)::int AS "maxAttempts" FROM platform_training_signal_deliveries`;
  report.deliveries = stats;
} finally {
  report.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(report, null, 2));
  if (process.env.E2E_SIGNAL_REPORT) fs.writeFileSync(process.env.E2E_SIGNAL_REPORT, JSON.stringify(report, null, 2));
  await stopProcess(bunker); await stopProcess(platform);
  try { await sql.end(); } catch { /* closing */ }
  try { const a = postgres(adminUrl, { max: 1 }); await a.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`); await a.end(); } catch { /* disposable */ }
  fs.rmSync(out, { recursive: true, force: true });
}
