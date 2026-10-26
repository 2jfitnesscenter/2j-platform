import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: settings overview tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 4, connect_timeout: 5 });
await migrateDatabase(sql);
const as = (role, options = {}) => buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: `settings-test-${role}`, role }), ...options });
const admin = as('admin');
const adminWithFlags = as('admin', { trainingSsoEnabled: true, pushEnabled: true, pushProvider: { send: async () => ({ ok: true }) } });
const trainer = as('trainer');
const accountant = as('accountant');
const reception = as('reception-management');
const anonymous = buildServer(process.env.DATABASE_URL);
after(async () => { await Promise.all([admin.close(), adminWithFlags.close(), trainer.close(), accountant.close(), reception.close(), anonymous.close()]); await sql.end(); });
const overview = (app) => app.inject({ method: 'GET', url: '/api/settings/overview' });

test('the settings overview needs authentication and settings.manage: only Administración can read it', async () => {
  assert.equal((await overview(anonymous)).statusCode, 401);
  for (const app of [trainer, accountant, reception]) assert.equal((await overview(app)).statusCode, 403);
  const response = await overview(admin);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('payment rules come from economic_settings (day 10, grace days, timezone, fiscal gate closed) and the methods are the fixed list', async () => {
  const [row] = await sql`SELECT due_day,grace_days,debt_blocks_new_reservations,fiscal_legal_gate_open FROM economic_settings WHERE singleton=true`;
  const { payments, timezone } = (await overview(admin)).json();
  assert.equal(timezone, 'Atlantic/Canary');
  assert.equal(payments.dueDay, Number(row.due_day));
  assert.equal(payments.graceDays, Number(row.grace_days));
  assert.equal(payments.timezone, 'Atlantic/Canary');
  assert.equal(payments.debtBlocksNewReservations, row.debt_blocks_new_reservations);
  assert.equal(payments.fiscalLegalGateOpen, row.fiscal_legal_gate_open);
  assert.equal(payments.fiscalLegalGateOpen, false, 'the fiscal gate stays closed');
  assert.deepEqual(payments.methods, ['cash', 'card', 'transfer', 'direct_debit', 'other']);
});

test('profiles are reusable roles with their permissions grouped, never per-user; Administración is the wildcard', async () => {
  const { profiles } = (await overview(admin)).json();
  assert.deepEqual(profiles.map((profile) => profile.id), ['admin', 'trainer', 'reception-management', 'accountant']);
  const byId = Object.fromEntries(profiles.map((profile) => [profile.id, profile]));
  assert.equal(byId.admin.wildcard, true);
  assert.deepEqual(byId.admin.groups, []);
  assert.equal(byId.admin.permissionCount, null);
  assert.equal(byId.accountant.permissionCount, 3);
  assert.deepEqual(byId.accountant.groups.map((group) => group.id), ['billing']);
  assert.deepEqual(byId.accountant.groups[0].permissions, ['billing.export', 'billing.read-basic', 'billing.read-tax']);
  assert.equal(byId.trainer.groups.reduce((sum, group) => sum + group.permissions.length, 0), byId.trainer.permissionCount);
  assert.equal(profiles.some((profile) => 'userId' in profile || 'users' in profile), false);
});

test('integrations are booleans only and follow the server flags; nothing secret or configured leaks', async () => {
  const off = (await overview(admin)).json().integrations;
  assert.deepEqual(Object.keys(off).sort(), ['memberAuthPilot', 'memberBookingPilot', 'passkeys', 'push', 'trainingLinking', 'trainingProvisioning', 'trainingServiceCalls', 'trainingSignals', 'trainingSso']);
  for (const value of Object.values(off)) assert.equal(typeof value, 'boolean');
  assert.equal(off.trainingSso, false); assert.equal(off.push, false);
  const flagged = await overview(adminWithFlags);
  assert.equal(flagged.statusCode, 200, flagged.body);
  const on = flagged.json().integrations;
  assert.equal(on.trainingSso, true); assert.equal(on.push, true); assert.equal(on.trainingLinking, false);
  assert.doesNotMatch(flagged.body, /secret|token|api[_-]?key|https?:\/\//i, 'no values, URLs or keys in the payload');
});
