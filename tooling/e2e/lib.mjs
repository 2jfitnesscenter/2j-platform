// Shared helpers for the local end-to-end tooling (harness and smoke stack). Loopback only; nothing here talks to a real service.
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const sha256hex = value => createHash('sha256').update(value).digest('hex');
export const b64 = bytes => Buffer.from(bytes).toString('base64url');
export const randomSecret = () => randomBytes(32).toString('hex');   // 64 hex characters, new for every run: nothing predictable is committed

/** Only what a child process needs to run; the developer's own credentials (AI providers, cloud, tokens) are never inherited. */
const ENV_ALLOW = new Set(['path', 'systemroot', 'windir', 'comspec', 'pathext', 'temp', 'tmp', 'tmpdir', 'home', 'userprofile', 'appdata', 'localappdata', 'programdata', 'programfiles', 'programfiles(x86)', 'number_of_processors', 'processor_architecture', 'os', 'lang', 'tz']);
export function childEnv(extra = {}) {
  const base = {};
  for (const [key, value] of Object.entries(process.env)) if (ENV_ALLOW.has(key.toLowerCase())) base[key] = value;
  return { ...base, ...extra };
}

export async function freePort() {
  return new Promise(resolve => { const probe = http.createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });
}

/** Artefacts go under `<2J root>/temp/e2e` (AGENTS.md / CLAUDE.md), or E2E_OUT_DIR, falling back to the OS temp directory outside the 2J layout. */
export function resolveOutDir(prefix, startDir) {
  let base = process.env.E2E_OUT_DIR ? path.resolve(process.env.E2E_OUT_DIR) : null;
  if (!base) {
    for (let dir = startDir, i = 0; i < 8 && !base; i += 1, dir = path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, 'worktrees')) && fs.existsSync(path.join(dir, 'AGENTS.md'))) base = path.join(dir, 'temp', 'e2e');
    }
  }
  base ??= path.join(os.tmpdir(), '2j-e2e');
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, `${prefix}-`));
}

export function startProcess(outDir, name, args, cwd, env) {
  const log = fs.openSync(path.join(outDir, `${name}.log`), 'a');
  const child = spawn(process.execPath, args, { cwd, env: childEnv(env), stdio: ['ignore', log, log], windowsHide: true });
  return { child, name, log };
}

export async function waitHttp(url, label, outDir) {
  for (let i = 0; i < 200; i++) { try { if ((await fetch(url)).ok) return; } catch { /* starting */ } await sleep(100); }
  throw new Error(`${label} did not become ready; see ${outDir}`);
}

export async function stopProcess(proc) {
  if (!proc?.child || proc.child.exitCode !== null) return;
  const done = new Promise(resolve => proc.child.once('exit', resolve));
  proc.child.kill();
  await Promise.race([done, sleep(5000)]);
}

/** 2J-SERVICE-AUTH-V1 request headers. */
export function signRequest(key, method, route, body, timestamp = new Date().toISOString(), requestId = randomUUID()) {
  const canonical = ['2J-SERVICE-AUTH-V1', key.id, timestamp, requestId, method, route, sha256hex(body)].join('\n');
  return { 'x-2j-key-id': key.id, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': createHmac('sha256', key.secret).update(canonical).digest('base64url') };
}

export async function httpCall(base, method, route, { headers = {}, body, cookie } = {}) {
  const response = await fetch(base + route, { method, headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await response.text(); let json = null; try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: response.status, json, headers: response.headers, text };
}

export const passkeyCookieFor = secretText => uid => { const payload = `${uid}:${Date.now() + 86_400_000}:0`; return `gymsid=${payload}.${createHmac('sha256', secretText).update(payload).digest('base64url')}`; };
export const cookieOf = response => (response.headers.get('set-cookie') || '').split(';')[0];

export const canaryMonth = (offsetMonths = 0) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1 + offsetMonths, 1));
};
export const monthRange = offset => {
  const start = canaryMonth(offset), end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const iso = d => d.toISOString().slice(0, 10);
  return { startsOn: iso(start), endsOn: iso(end), dueOn: iso(start) };
};

/** Búnker's acknowledgement of an existing Platform link (what Platform's link flow asks for after a verified proof). Used to seed already-linked personas. */
export async function activateTrainingLink(bunkerBase, proofKey, { linkId, personId, trainingUserId, linkVersion = 1 }) {
  const route = '/api/platform/v1/link/activate';
  const body = JSON.stringify({ v: 1, linkId, linkVersion, personId, trainingUserId, origin: 'proof' });
  return httpCall(bunkerBase, 'POST', route, { body, headers: signRequest(proofKey, 'POST', route, Buffer.from(body)) });
}
