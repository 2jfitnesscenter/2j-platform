import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { ensureCashSessionForActor } from './cash-fixture.mjs';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: contracts tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 6, connect_timeout: 5 });
await migrateDatabase(sql);
const as = (role) => buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: `contracts-${role}`, role }) });
const admin = as('admin');
const trainer = as('trainer');
const accountant = as('accountant');
const anonymous = buildServer(process.env.DATABASE_URL);
after(async () => { await Promise.all([admin.close(), trainer.close(), accountant.close(), anonymous.close()]); await sql.end(); });

const tag = randomUUID().slice(0, 8);
const canaryToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = (days) => { const base = new Date(`${canaryToday()}T00:00:00Z`); base.setUTCDate(base.getUTCDate() + days); return base.toISOString().slice(0, 10); };
const post = (url, payload, app = admin) => app.inject({ method: 'POST', url, headers: { 'idempotency-key': randomUUID() }, payload });
const [area] = await sql`SELECT id FROM areas WHERE normalized_name='la sala'`;

async function contractFor(lastName, { startsOn, endsOn, dueOn }) {
  const service = (await post('/api/services', { name: `Servicio ${randomUUID()}`, areaId: area.id, status: 'active' })).json();
  const plan = await post('/api/plans', { name: `Plan ${tag} ${randomUUID().slice(0, 4)}`, serviceIds: [service.id], kind: 'recurring', renewalCadence: 'monthly', basePriceCents: 4500, rights: [{ rightType: 'service_access', serviceId: service.id }] });
  assert.equal(plan.statusCode, 201, plan.body);
  assert.equal((await admin.inject({ method: 'POST', url: `/api/plans/${plan.json().id}/activate` })).statusCode, 200);
  const client = (await post('/api/clients', { firstName: 'Contrato', lastName: `${lastName} ${tag}` })).json();
  const sale = await post(`/api/clients/${client.id}/plans`, { planId: plan.json().id, startsOn, endsOn, dueOn, amountCents: 4500 });
  assert.equal(sale.statusCode, 201, sale.body);
  return { clientId: client.id, chargeId: sale.json().chargeId };
}
const list = async (query = '', app = admin) => { const response = await app.inject({ method: 'GET', url: `/api/contracts?q=${tag}${query}` }); assert.equal(response.statusCode, 200, response.body); return response.json(); };

test('contracts need authentication and entitlement + client read permission', async () => {
  assert.equal((await anonymous.inject({ method: 'GET', url: '/api/contracts' })).statusCode, 401);
  assert.equal((await admin.inject({ method: 'GET', url: '/api/contracts?status=nope' })).statusCode, 400);
});

test('contracts list shows status, payment state, expiring-soon and pending totals; money is hidden without billing permission', async () => {
  const expiring = await contractFor('Vence', { startsOn: shift(-20), endsOn: shift(3), dueOn: shift(-2) });
  await contractFor('Futuro', { startsOn: shift(10), endsOn: shift(40), dueOn: shift(10) });
  const body = await list();
  const byName = Object.fromEntries(body.items.map((item) => [item.clientName.split(' ')[1], item]));
  assert.equal(byName.Vence.status, 'active');
  assert.equal(byName.Vence.paymentState, 'unpaid', 'a due charge without payment is overdue');
  assert.equal(byName.Vence.expiringSoon, true);
  assert.equal(byName.Vence.balanceCents, 4500);
  assert.equal(byName.Futuro.status, 'scheduled');
  assert.equal(byName.Futuro.expiringSoon, false);
  assert.ok(body.summary.pendingCents >= 9000 && body.summary.expiringSoonCount >= 1);
  assert.deepEqual((await list('&expiring=1')).items.map((item) => item.clientName.split(' ')[1]), ['Vence']);
  assert.deepEqual((await list('&payment=unpaid')).items.map((item) => item.clientName.split(' ')[1]), ['Vence']);
  assert.equal((await list('&status=expired')).items.length, 0);
  await ensureCashSessionForActor(sql, 'contracts-admin');
  const paid = await post('/api/economics/payments', { chargeId: expiring.chargeId, splits: [{ method: 'card', amountCents: 4500 }] });
  assert.equal(paid.statusCode, 201, paid.body);
  const after = Object.fromEntries((await list()).items.map((item) => [item.clientName.split(' ')[1], item]));
  assert.equal(after.Vence.paymentState, 'paid');
  assert.equal(after.Vence.balanceCents, 0);
  const limited = await list('', trainer);
  assert.ok(limited.items.length >= 2);
  for (const item of limited.items) { assert.equal(item.amountCents, null); assert.equal(item.paymentState, null); }
  assert.equal(limited.summary.pendingCents, null);
  assert.equal((await trainer.inject({ method: 'GET', url: `/api/contracts?q=${tag}&payment=paid` })).statusCode, 403, 'the payment filter needs billing permission');
});
