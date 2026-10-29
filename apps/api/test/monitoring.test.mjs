import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: monitoring tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 4, connect_timeout: 5 });
await migrateDatabase(sql);
const as = (role, explicitPermissions) => buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: `monitoring-${role}`, role, ...(explicitPermissions ? { explicitPermissions } : {}) }) });
const owner = as('admin', ['owner.panel.read']);
const admin = as('admin');
const trainer = as('trainer');
const anonymous = buildServer(process.env.DATABASE_URL);
after(async () => { await Promise.all([owner.close(), admin.close(), trainer.close(), anonymous.close()]); await sql.end(); });
const get = (app) => app.inject({ method: 'GET', url: '/api/admin/monitoring' });

test('monitoring needs authentication and the explicit owner.panel.read grant', async () => {
  assert.equal((await get(anonymous)).statusCode, 401);
  for (const app of [admin, trainer]) assert.equal((await get(app)).statusCode, 403);
  const response = await get(owner);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('monitoring reports yes/no checks and counters only, and never secrets, environment, connection strings or paths', async () => {
  const body = (await get(owner)).json();
  assert.deepEqual(Object.keys(body).sort(), ['checkedAt', 'checks', 'counts', 'healthy', 'timezone', 'uptimeSeconds']);
  assert.deepEqual(body.checks.map((check) => check.id), ['database', 'migrations', 'data', 'api']);
  assert.equal(body.healthy, true);
  assert.ok(body.checks.every((check) => check.ok === true && typeof check.detail === 'string'));
  assert.deepEqual(Object.keys(body.counts).sort(), ['activeClients', 'activePlanAssignments', 'openCashRegisters', 'scheduledSessionsNext7Days']);
  for (const value of Object.values(body.counts)) assert.ok(Number.isInteger(value) && value >= 0);
  const text = JSON.stringify(body);
  for (const forbidden of [process.env.DATABASE_URL, 'postgres://', 'password', 'secret', 'token', 'apikey', 'node_modules', process.cwd()]) assert.equal(text.toLowerCase().includes(String(forbidden).toLowerCase()), false, `no "${forbidden}"`);
});
