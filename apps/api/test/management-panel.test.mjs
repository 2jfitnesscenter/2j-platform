import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { ensureCashSessionForActor } from './cash-fixture.mjs';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: management panel tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 6, connect_timeout: 5 });
await migrateDatabase(sql);
const as = (role, explicitPermissions) => buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: `management-panel-${role}`, role, ...(explicitPermissions ? { explicitPermissions } : {}) }) });
const owner = as('admin', ['owner.panel.read']);
const admin = as('admin');
const trainer = as('trainer');
const reception = as('reception-management');
const anonymous = buildServer(process.env.DATABASE_URL);
after(async () => { await Promise.all([owner.close(), admin.close(), trainer.close(), reception.close(), anonymous.close()]); await sql.end(); });
const get = (app) => app.inject({ method: 'GET', url: '/api/admin/management-panel' });

test('the management panel needs authentication and the explicit owner.panel.read grant (A38: nobody else sees cash differences)', async () => {
  assert.equal((await get(anonymous)).statusCode, 401);
  for (const app of [admin, trainer, reception]) assert.equal((await get(app)).statusCode, 403, 'not even the generic Admin profile');
  const response = await get(owner);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('the panel lists open registers, closed shifts, the accumulated difference and today clockings without hour totals', async () => {
  const shift = await ensureCashSessionForActor(sql, 'management-panel-admin');
  assert.ok(shift.id);
  const body = (await get(owner)).json();
  assert.equal(body.timezone, 'Atlantic/Canary');
  assert.deepEqual(Object.keys(body).sort(), ['accumulatedDifference', 'closedShifts', 'openRegisters', 'teamClockings', 'timezone', 'windows']);
  assert.ok(body.openRegisters.some((row) => row.id === shift.id), 'the shift opened by the fixture is listed as open');
  for (const row of body.openRegisters) assert.deepEqual(Object.keys(row).sort(), ['custodian', 'forgotten', 'id', 'localDate', 'openedAt', 'registerName']);
  assert.ok(Number.isInteger(body.accumulatedDifference.differenceCents) && Number.isInteger(body.accumulatedDifference.shifts));
  for (const row of body.closedShifts) assert.notEqual(row.status, 'open');
  const text = JSON.stringify(body).toLowerCase();
  for (const forbidden of ['totalhours', 'hours', 'email', 'phone', 'health', 'salud']) assert.equal(text.includes(forbidden), false, `no "${forbidden}" in the panel`);
});
