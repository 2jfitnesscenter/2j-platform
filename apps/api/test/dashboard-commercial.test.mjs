import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';

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
  assert.equal(after.lowStock.count, before.lowStock.count + 1, 'a tracked variant left with 3 units (<= 3) counts as low stock');
  assert.equal((await post(`/api/admin/store/sales/${sale.json().id}/void`, { reason: 'Prueba' })).statusCode, 200);
  const voided = (await center()).commercial;
  assert.equal(voided.storeSales.monthCount, before.storeSales.monthCount, 'voided sales leave the month total');
  assert.equal(voided.lowStock.count, before.lowStock.count, 'the units return to stock when a sale is voided (4 > 3: no longer low)');
  const limited = (await center(trainer)).commercial;
  assert.equal(limited.storeSales, null, 'no store sales without store.sales.read');
  assert.equal(limited.lowStock, null, 'no stock without store.inventory.read');
  assert.ok(limited.transfers, 'trainers do validate transfers (D105), so they get that count');
});
