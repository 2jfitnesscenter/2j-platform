import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { ensureCashSessionForActor } from './cash-fixture.mjs';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: dashboard commercial tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 6, connect_timeout: 5 });
await migrateDatabase(sql);
const as = (role) => buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: `dashboard-commercial-${role}`, role }) });
const admin = as('admin');
const trainer = as('trainer');
after(async () => { await Promise.all([admin.close(), trainer.close()]); await sql.end(); });

const post = (url, payload, headers = {}) => admin.inject({ method: 'POST', url, headers, payload });
const center = async (app = admin) => { const response = await app.inject({ method: 'GET', url: '/api/dashboard/command-center' }); assert.equal(response.statusCode, 200, response.body); return response.json(); };

test('quick actions use Base44 verbs and deep links, each only with its permission', async () => {
  const body = await center();
  assert.deepEqual(body.quickActions.map((item) => [item.id, item.label, item.href]), [
    ['new-client', 'Nuevo cliente', '#clients?new=1'],
    ['new-reservation', 'Crear reserva', '#calendar?book=1'],
    ['new-sale', 'Registrar venta', '#store?sale=1'],
    ['assign-plan', 'Asignar cuota', '#clients?intent=assign-plan'],
    ['collect-payment', 'Registrar pago', '#economics'],
    ['send-message', 'Enviar mensaje', '#clients?intent=message'],
    ['timeclock-toggle', 'Fichar entrada/salida', '#timeclock?intent=toggle'],
    ['open-cash', 'Abrir caja', '#economics?intent=open-cash'],
    ['close-cash', 'Cerrar caja', '#economics?intent=close-cash'],
  ]);
  const trainerBody = await center(trainer);
  const allowed = new Set(trainerBody.quickActions.map((item) => item.id));
  for (const forbidden of ['new-sale', 'assign-plan', 'collect-payment']) assert.equal(allowed.has(forbidden), false, `trainer must not get ${forbidden}`);
});

test('commercial tiles: store sales of the month and low stock move with real data, and the store blocks are null for a profile without store permissions', async () => {
  const before = (await center()).commercial;
  assert.ok(before.plans && Number.isInteger(before.plans.activeCount) && before.plans.expiringSoonCount <= before.plans.activeCount);
  assert.ok(before.transfers && Number.isInteger(before.transfers.pendingCount));
  const client = (await post('/api/clients', { firstName: 'Tiles', lastName: `Resumen ${randomUUID().slice(0, 8)}` }, { 'idempotency-key': randomUUID() })).json();
  const product = (await post('/api/admin/store/products', { category: 'nutrition', name: `Producto ${randomUUID()}`, description: 'Prueba' })).json();
  const variant = (await post(`/api/admin/store/products/${product.id}/variants`, { label: 'Bote', priceCents: 1500, stockTracked: true, active: true, sku: null })).json();
  assert.equal((await post(`/api/admin/store/variants/${variant.id}/movements`, { type: 'opening', quantity: 4, reason: 'Apertura sintética' })).statusCode, 201);
  const sale = await post('/api/admin/store/sales', { clientId: client.id, lines: [{ variantId: variant.id, quantity: 1 }], paymentState: 'pending', paymentMethod: null, note: '' }, { 'idempotency-key': randomUUID() });
  assert.equal(sale.statusCode, 201, sale.body);
  const after = (await center()).commercial;
  assert.equal(after.storeSales.monthCount, before.storeSales.monthCount + 1);
  assert.equal(after.storeSales.monthTotalCents, before.storeSales.monthTotalCents + 1500);
  const [stockAfterSale] = await sql`SELECT COALESCE(sum(quantity_delta),0)::int AS quantity FROM store_inventory_movements WHERE variant_id=${variant.id}`;
  assert.equal(stockAfterSale.quantity,3,'the test variant has three units after one sale from four');
  assert.ok(after.lowStock.count >= before.lowStock.count, 'the sale can only maintain or increase the global low-stock count');
  // D113 (#97): annulling a sale leaves a movement linked to an open shift, so the shift must exist first (already open is fine).
  const shift = await ensureCashSessionForActor(sql, 'dashboard-commercial-admin');
  assert.ok(shift.id);
  assert.equal((await post(`/api/admin/store/sales/${sale.json().id}/void`, { reason: 'Prueba' })).statusCode, 200);
  const voided = (await center()).commercial;
  assert.equal(voided.storeSales.monthCount, before.storeSales.monthCount, 'voided sales leave the month total');
  const [stockAfterVoid] = await sql`SELECT COALESCE(sum(quantity_delta),0)::int AS quantity FROM store_inventory_movements WHERE variant_id=${variant.id}`;
  assert.equal(stockAfterVoid.quantity,4,'void restores the test variant stock');
  assert.equal(voided.lowStock.count, after.lowStock.count - 1, 'the test variant is no longer low stock after the void');
  const limited = (await center(trainer)).commercial;
  assert.equal(limited.storeSales, null, 'no store sales without store.sales.read');
  assert.equal(limited.lowStock, null, 'no stock without store.inventory.read');
  assert.ok(limited.transfers, 'trainers do validate transfers (D105), so they get that count');
});

test('Resumen lists the latest payments and the plans that expire within a week, only for profiles that can read them', async () => {
  const tag = randomUUID().slice(0, 8);
  const client = (await post('/api/clients', { firstName: 'Movimiento', lastName: `Resumen ${tag}` }, { 'idempotency-key': randomUUID() })).json();
  const charge = await post('/api/economics/charges', { clientId: client.id, concept: `Cuota ${tag}`, amountCents: 3300, dueOn: '2099-12-10' }, { 'idempotency-key': randomUUID() });
  assert.equal(charge.statusCode, 201, charge.body);
  await ensureCashSessionForActor(sql, 'dashboard-commercial-admin');
  const payment = await post('/api/economics/payments', { chargeId: charge.json().id, splits: [{ method: 'card', amountCents: 3300 }] }, { 'idempotency-key': randomUUID() });
  assert.equal(payment.statusCode, 201, payment.body);
  const { commercial } = await center();
  assert.ok(Array.isArray(commercial.recentMovements) && commercial.recentMovements.length <= 6);
  const latest = commercial.recentMovements[0];
  assert.equal(latest.kind, 'payment');
  assert.equal(latest.amountCents, 3300);
  assert.equal(latest.concept, `Cuota ${tag}`);
  assert.equal(latest.clientName, `Movimiento Resumen ${tag}`);
  assert.ok(Array.isArray(commercial.expiringPlans), 'admins read plans');
  for (const plan of commercial.expiringPlans) assert.match(plan.endsOn, /^\d{4}-\d{2}-\d{2}$/);
  const limited = (await center(trainer)).commercial;
  assert.equal(limited.recentMovements, null, 'no payments without billing.read-basic');
});
