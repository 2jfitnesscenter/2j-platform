import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: client purchases tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 6, connect_timeout: 5 });
await migrateDatabase(sql);
const as = (role) => buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: `purchases-test-${role}`, role }) });
const admin = as('admin');
const trainer = as('trainer');
const accountant = as('accountant');
after(async () => { await Promise.all([admin.close(), trainer.close(), accountant.close()]); await sql.end(); });

const post = (url, payload, headers = {}) => admin.inject({ method: 'POST', url, headers, payload });
async function createClient(label) {
  const response = await post('/api/clients', { firstName: label, lastName: `Compras ${randomUUID().slice(0, 8)}` }, { 'idempotency-key': randomUUID() });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().id;
}
async function variantWithStock(label, priceCents) {
  const product = (await post('/api/admin/store/products', { category: 'nutrition', name: `Producto ${randomUUID()}`, description: 'Prueba' })).json();
  const variant = (await post(`/api/admin/store/products/${product.id}/variants`, { label, priceCents, stockTracked: true, active: true, sku: null })).json();
  assert.equal((await post(`/api/admin/store/variants/${variant.id}/movements`, { type: 'opening', quantity: 10, reason: 'Apertura sintética' })).statusCode, 201);
  return { product, variant };
}
const sale = (clientId, variantId, quantity) => post('/api/admin/store/sales', { clientId, lines: [{ variantId, quantity }], paymentState: 'pending', paymentMethod: null, note: '' }, { 'idempotency-key': randomUUID() });

test('the client profile lists the client store purchases newest first, with lines, total, state and voided sales', async () => {
  const clientId = await createClient('Ana');
  const otherId = await createClient('Otra');
  const { variant } = await variantWithStock('Bote 300 g', 1250);
  const first = await sale(clientId, variant.id, 2);
  assert.equal(first.statusCode, 201, first.body);
  const second = await sale(clientId, variant.id, 1);
  assert.equal(second.statusCode, 201, second.body);
  assert.equal((await sale(otherId, variant.id, 1)).statusCode, 201);
  assert.equal((await post(`/api/admin/store/sales/${first.json().id}/void`, { reason: 'Prueba de anulación' })).statusCode, 200);

  const profile = await admin.inject({ method: 'GET', url: `/api/clients/${clientId}` });
  assert.equal(profile.statusCode, 200, profile.body);
  const body = profile.json();
  assert.deepEqual(body.sections.find((section) => section.id === 'purchases'), { id: 'purchases', label: 'Compras', sourceLabel: 'Tienda', access: 'available', dataState: 'ready' });
  const purchases = body.summary.purchases.data;
  assert.deepEqual(purchases.map((item) => item.id), [second.json().id, first.json().id], 'newest first, only this client');
  assert.equal(Number(purchases[0].totalCents), 1250);
  assert.deepEqual(purchases[0].lines, [{ productName: purchases[0].lines[0].productName, variantLabel: 'Bote 300 g', quantity: 1 }]);
  assert.equal(purchases[0].status, 'completed');
  assert.equal(purchases[1].status, 'voided');
  assert.equal(Number(purchases[1].totalCents), 2500);
});

test('without store.sales.read the Compras section is forbidden and no purchase data is sent', async () => {
  const clientId = await createClient('Sin permiso');
  const { variant } = await variantWithStock('Bote 500 g', 2000);
  assert.equal((await sale(clientId, variant.id, 1)).statusCode, 201);
  const accountantProfile = await accountant.inject({ method: 'GET', url: `/api/clients/${clientId}` });
  assert.equal(accountantProfile.body.includes('Bote 500 g'), false, 'the accountant never receives purchase detail either');
  for (const app of [trainer]) {
    const profile = await app.inject({ method: 'GET', url: `/api/clients/${clientId}` });
    assert.equal(profile.statusCode, 200, profile.body);
    const body = profile.json();
    assert.equal(body.sections.find((section) => section.id === 'purchases').access, 'forbidden');
    assert.equal(body.summary.purchases, undefined);
    assert.equal(profile.body.includes('Bote 500 g'), false, 'no purchase detail leaks to roles without store access');
  }
});

test('a client with no purchases gets an empty list, not an error', async () => {
  const clientId = await createClient('Vacío');
  const profile = await admin.inject({ method: 'GET', url: `/api/clients/${clientId}` });
  assert.equal(profile.statusCode, 200, profile.body);
  assert.deepEqual(profile.json().summary.purchases.data, []);
});
