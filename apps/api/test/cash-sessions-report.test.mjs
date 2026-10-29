import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: cash sessions report PostgreSQL tests cannot be skipped.');
const sourceUrl = new URL(process.env.DATABASE_URL), databaseName = `cash_report_${randomUUID().replaceAll('-', '')}`;
const adminUrl = new URL(sourceUrl); adminUrl.pathname = '/postgres'; const admin = postgres(adminUrl.toString(), { max: 2, connect_timeout: 5 });
await admin.unsafe(`CREATE DATABASE "${databaseName}"`); sourceUrl.pathname = `/${databaseName}`;
const databaseUrl = sourceUrl.toString(), sql = postgres(databaseUrl, { max: 8, connect_timeout: 5 }); await migrateDatabase(sql);
const actor = (actorId, role = 'trainer') => buildServer(databaseUrl, { authorizationResolver: async () => ({ actorId, role }), ...(actorId === 'rep-owner' ? { ownerActorId: actorId } : {}) });
const bunkerCashier = actor('rep-bunker'), salaCashier = actor('rep-sala'), owner = actor('rep-owner', 'admin'), plainAdmin = actor('rep-admin', 'admin');
const keys = ['coin_0_01', 'coin_0_02', 'coin_0_05', 'coin_0_10', 'coin_0_20', 'coin_0_50', 'coin_1', 'coin_2', 'bill_5', 'bill_10', 'bill_20', 'bill_50', 'bill_100', 'bill_200', 'bill_500'];
const count = cents => Object.fromEntries(keys.map((key, index) => [key, index === 0 ? cents : 0]));
after(async () => { await Promise.all([bunkerCashier.close(), salaCashier.close(), owner.close(), plainAdmin.close()]); await sql.end(); await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`); await admin.end(); });

test('GET /api/economics/cash/sessions: owner sees per-register totals and difference, cashiers stay blind and see only their own sessions', async () => {
  await sql`INSERT INTO staff_professionals(first_name,last_name,display_name,base_role,auth_actor_id,created_by) VALUES ('Rep','Bunker','Rep Búnker','trainer','rep-bunker','test'),('Rep','Sala','Rep Sala','trainer','rep-sala','test')`;
  for (const app of [bunkerCashier, salaCashier]) assert.equal((await app.inject({ method: 'POST', url: '/api/timeclock/clock-in', payload: { origin: 'web' } })).statusCode, 201);
  const openBunker = await bunkerCashier.inject({ method: 'POST', url: '/api/economics/cash/open', payload: { registerCode: 'bunker', openingDenominations: count(5000) } });
  assert.equal(openBunker.statusCode, 201, openBunker.body);
  const openSala = await salaCashier.inject({ method: 'POST', url: '/api/economics/cash/open', payload: { registerCode: 'sala', openingDenominations: count(3000) } });
  assert.equal(openSala.statusCode, 201, openSala.body);

  // Open day: no counted/difference totals yet.
  const openDay = await owner.inject({ method: 'GET', url: '/api/economics/cash/sessions' });
  assert.equal(openDay.statusCode, 200, openDay.body);
  assert.equal(openDay.json().items.length, 2);
  assert.equal(openDay.json().days.length, 1);
  assert.equal(openDay.json().days[0].closed, false);
  assert.equal(openDay.json().days[0].differenceCents, null);

  assert.equal((await bunkerCashier.inject({ method: 'POST', url: `/api/economics/cash/${openBunker.json().id}/close`, payload: { countedDenominations: count(4900) } })).statusCode, 200);
  assert.equal((await salaCashier.inject({ method: 'POST', url: `/api/economics/cash/${openSala.json().id}/close`, payload: { countedDenominations: count(3000) } })).statusCode, 200);

  const ownerReport = await owner.inject({ method: 'GET', url: '/api/economics/cash/sessions' });
  assert.equal(ownerReport.statusCode, 200, ownerReport.body);
  const bunker = ownerReport.json().items.find(item => item.registerCode === 'bunker');
  const sala = ownerReport.json().items.find(item => item.registerCode === 'sala');
  assert.deepEqual([bunker.openingCents, bunker.expectedCents, bunker.countedCents, bunker.differenceCents, bunker.balanced], [5000, 5000, 4900, -100, false]);
  assert.deepEqual([sala.openingCents, sala.expectedCents, sala.countedCents, sala.differenceCents, sala.balanced], [3000, 3000, 3000, 0, true]);
  assert.equal(bunker.openedByName, 'Rep Búnker');
  const day = ownerReport.json().days[0];
  assert.deepEqual([day.closed, day.expectedCents, day.countedCents, day.differenceCents, day.balanced], [true, 8000, 7900, -100, false]);
  const filtered = await owner.inject({ method: 'GET', url: '/api/economics/cash/sessions?registerCode=sala' });
  assert.deepEqual(filtered.json().items.map(item => item.registerCode), ['sala']);

  // A cashier never sees expected, counted, opening or difference (D111/A38), and only their own register.
  const cashierReport = await bunkerCashier.inject({ method: 'GET', url: '/api/economics/cash/sessions' });
  assert.equal(cashierReport.statusCode, 200, cashierReport.body);
  assert.deepEqual(cashierReport.json().items.map(item => item.registerCode), ['bunker']);
  for (const key of ['openingCents', 'expectedCents', 'countedCents', 'differenceCents', 'balanced']) {
    assert.equal(Object.hasOwn(cashierReport.json().items[0], key), false, `cashier item must hide ${key}`);
    assert.equal(Object.hasOwn(cashierReport.json().days[0], key.replace('openingCents', 'balanced')), false, `cashier day must hide ${key}`);
  }
  for (const key of ['expectedCents', 'countedCents', 'differenceCents', 'balanced']) assert.equal(Object.hasOwn(cashierReport.json().days[0], key), false);

  // A plain admin has cash permission but not owner.panel.read: blind too.
  const adminReport = await plainAdmin.inject({ method: 'GET', url: '/api/economics/cash/sessions' });
  if (adminReport.statusCode === 200) for (const item of adminReport.json().items) assert.equal(Object.hasOwn(item, 'differenceCents'), false);

  // Validation and unauthenticated access.
  assert.equal((await owner.inject({ method: 'GET', url: '/api/economics/cash/sessions?from=2026-01-01&to=2026-12-31' })).statusCode, 400);
  assert.equal((await owner.inject({ method: 'GET', url: '/api/economics/cash/sessions?registerCode=otra' })).statusCode, 400);
  assert.equal((await owner.inject({ method: 'GET', url: '/api/economics/cash/sessions?foo=1' })).statusCode, 400);
  const anonymous = buildServer(databaseUrl, { authorizationResolver: async () => null });
  assert.equal((await anonymous.inject({ method: 'GET', url: '/api/economics/cash/sessions' })).statusCode, 401);
  await anonymous.close();
});
