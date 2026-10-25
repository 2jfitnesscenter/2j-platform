import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: report integration tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 6, connect_timeout: 5 });
await migrateDatabase(sql);
const as = (role) => buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: `reports-test-${role}`, role }) });
const admin = as('admin');
const accountant = as('accountant');
const trainer = as('trainer');
const reception = as('reception-management');
const anonymous = buildServer(process.env.DATABASE_URL);
after(async () => { await Promise.all([admin.close(), accountant.close(), trainer.close(), reception.close(), anonymous.close()]); await sql.end(); });

const tag = randomUUID().slice(0, 8);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const range = `from=${today}&to=${today}`;
const post = (url, payload, headers = {}) => admin.inject({ method: 'POST', url, headers: { 'idempotency-key': randomUUID(), ...headers }, payload });
async function client(lastName, firstName = 'Informe') {
  const response = await post('/api/clients', { firstName, lastName: `${lastName} ${tag}` });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().id;
}
async function charge(clientId, concept, amountCents) {
  const response = await post('/api/economics/charges', { clientId, concept, amountCents, dueOn: '2099-12-10' });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().id;
}
async function pay(chargeId, method, amountCents) {
  const response = await post('/api/economics/payments', { chargeId, splits: [{ method, amountCents }] });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().id;
}
const rows = async (extra = '', app = admin) => { const response = await app.inject({ method: 'GET', url: `/api/reports/sales?${range}&limit=500${extra}` }); assert.equal(response.statusCode, 200, response.body); return response.json(); };
const mine = (body) => body.items.filter((item) => item.clientName.endsWith(tag));

test('reports need authentication and billing.read-basic; only billing.export roles can download the CSV', async () => {
  assert.equal((await anonymous.inject({ method: 'GET', url: `/api/reports/sales?${range}` })).statusCode, 401);
  assert.equal((await trainer.inject({ method: 'GET', url: `/api/reports/sales?${range}` })).statusCode, 403);
  const receptionList = await reception.inject({ method: 'GET', url: `/api/reports/sales?${range}` });
  assert.equal(receptionList.statusCode, 200, 'reception already reads charges (billing.read-basic)');
  assert.equal(receptionList.json().capabilities.export, false, 'but cannot export');
  assert.equal((await accountant.inject({ method: 'GET', url: `/api/reports/sales?${range}` })).statusCode, 200);
  assert.equal((await accountant.inject({ method: 'GET', url: `/api/reports/sales.csv?${range}` })).statusCode, 200);
  assert.equal((await reception.inject({ method: 'GET', url: `/api/reports/sales.csv?${range}` })).statusCode, 403);
  assert.equal((await trainer.inject({ method: 'GET', url: `/api/reports/sales.csv?${range}` })).statusCode, 403);
  assert.equal((await anonymous.inject({ method: 'GET', url: `/api/reports/sales.csv?${range}` })).statusCode, 401);
  assert.equal((await admin.inject({ method: 'GET', url: `/api/reports/sales?${range}` })).json().capabilities.export, true);
});

test('sold versus collected: paid, partial, pending and voided charges and store sales appear with the right state and totals', async () => {
  const [paidId, partialId, pendingId, voidedId, storeId] = await Promise.all([client('Pagada'), client('Parcial'), client('Pendiente'), client('Anulada'), client('Tienda')]);
  await pay(await charge(paidId, `Cuota completa ${tag}`, 5000), 'card', 5000);
  await pay(await charge(partialId, `Cuota parcial ${tag}`, 6000), 'transfer', 2000);
  await charge(pendingId, `Cuota pendiente ${tag}`, 4000);
  const toVoid = await charge(voidedId, `Cuota anulada ${tag}`, 3000);
  const voidResponse = await admin.inject({ method: 'POST', url: `/api/economics/charges/${toVoid}/void`, headers: { 'idempotency-key': randomUUID() }, payload: { reason: 'Prueba de informe' } });
  assert.ok([200, 201].includes(voidResponse.statusCode), voidResponse.body);
  const product = (await post('/api/admin/store/products', { category: 'nutrition', name: `Producto ${tag}`, description: 'Prueba' })).json();
  const variant = (await post(`/api/admin/store/products/${product.id}/variants`, { label: 'Bote', priceCents: 1500, stockTracked: true, active: true, sku: null })).json();
  assert.equal((await post(`/api/admin/store/variants/${variant.id}/movements`, { type: 'opening', quantity: 5, reason: 'Apertura sintética' })).statusCode, 201);
  const sale = await post('/api/admin/store/sales', { clientId: storeId, lines: [{ variantId: variant.id, quantity: 2 }], paymentState: 'pending', paymentMethod: null, note: '' });
  assert.equal(sale.statusCode, 201, sale.body);

  const body = await rows();
  const byClient = Object.fromEntries(mine(body).map((item) => [item.clientName.split(' ')[1], item]));
  assert.deepEqual([byClient.Pagada.status, byClient.Pagada.soldCents, byClient.Pagada.collectedCents, byClient.Pagada.methods, byClient.Pagada.kind], ['paid', 5000, 5000, ['card'], 'charge']);
  assert.deepEqual([byClient.Parcial.status, byClient.Parcial.soldCents, byClient.Parcial.collectedCents, byClient.Parcial.methods], ['partial', 6000, 2000, ['transfer']]);
  assert.deepEqual([byClient.Pendiente.status, byClient.Pendiente.collectedCents], ['pending', 0]);
  assert.equal(byClient.Anulada.status, 'void');
  assert.equal(byClient.Tienda.kind, 'store');
  assert.deepEqual([byClient.Tienda.soldCents, byClient.Tienda.collectedCents, byClient.Tienda.status], [3000, 0, 'pending']);
  assert.match(byClient.Tienda.concept, /2 × Producto/);

  const only = { ...body, items: mine(body) };
  const totals = (await admin.inject({ method: 'GET', url: `/api/reports/sales?${range}&limit=500&q=${encodeURIComponent(tag)}` })).json().totals;
  assert.equal(totals.soldCents, 5000 + 6000 + 4000 + 3000, 'voided charges are not sold');
  assert.equal(totals.collectedCents, 5000 + 2000);
  assert.equal(totals.pendingCents, totals.soldCents - totals.collectedCents);
  assert.equal(totals.voidedCount, 1);
  assert.equal(totals.voidedCents, 3000);
  assert.equal(only.items.length, 5);
});

test('filters: kind, payment method, invoice and free text (accent-insensitive) narrow the list; the date range is respected', async () => {
  const filtered = async (extra) => mine(await rows(`&q=${encodeURIComponent(tag)}${extra}`)).map((item) => item.clientName.split(' ')[1]).sort();
  assert.deepEqual(await filtered('&kind=store'), ['Tienda']);
  assert.deepEqual(await filtered('&kind=charge'), ['Anulada', 'Pagada', 'Parcial', 'Pendiente']);
  assert.deepEqual(await filtered('&method=transfer'), ['Parcial']);
  assert.deepEqual(await filtered('&method=card'), ['Pagada']);
  assert.deepEqual(await filtered('&invoice=with'), []);
  assert.equal((await filtered('&invoice=without')).length, 5);
  const accented = (await admin.inject({ method: 'GET', url: `/api/reports/sales?${range}&q=${encodeURIComponent(`informe pagada ${tag}`.toUpperCase())}` })).json();
  assert.equal(accented.items.length, 1);
  const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary' }).format(new Date(Date.now() - 2 * 86_400_000));
  const past = (await admin.inject({ method: 'GET', url: `/api/reports/sales?from=${yesterday}&to=${yesterday}&q=${encodeURIComponent(tag)}` })).json();
  assert.deepEqual(past.items, [], 'nothing was created on that earlier day');
});

test('invalid queries are rejected: inverted or very long ranges, unknown keys, bad enums and limits', async () => {
  for (const query of ['from=2026-02-01&to=2026-01-01', 'from=2024-01-01&to=2026-01-01', `${range}&x=1`, `${range}&kind=nope`, `${range}&method=bitcoin`, `${range}&limit=501`, 'from=2026-13-40&to=2026-13-41', `from=${today}`]) {
    assert.equal((await admin.inject({ method: 'GET', url: `/api/reports/sales?${query}` })).statusCode, 400, query);
  }
});

test('the CSV has a BOM, semicolons, Spanish decimals, the same rows as the list, and neutralises formula-looking text', async () => {
  const evil = await client('Fórmula', '=HYPERLINK("x")');
  await charge(evil, `+Cuota ${tag}`, 1234);
  const response = await admin.inject({ method: 'GET', url: `/api/reports/sales.csv?${range}&q=${encodeURIComponent(tag)}` });
  assert.equal(response.statusCode, 200, response.body);
  assert.match(response.headers['content-type'], /text\/csv/);
  assert.match(response.headers['content-disposition'], /ventas-.*\.csv/);
  const text = response.body;
  assert.equal(text.charCodeAt(0), 0xFEFF, 'UTF-8 BOM so Excel reads accents');
  const lines = text.trim().split('\r\n');
  assert.equal(lines[0], '"Fecha";"Cliente";"Concepto";"Tipo";"Vendido (EUR)";"Cobrado (EUR)";"Pendiente (EUR)";"Estado";"Métodos";"Factura"');
  assert.equal(lines.length - 1, (await rows(`&q=${encodeURIComponent(tag)}`)).items.length, 'same number of rows as the list');
  assert.ok(lines.some((line) => line.includes('"12,34"')), 'euros use a decimal comma');
  assert.ok(lines.some((line) => line.includes(`"'+Cuota ${tag}"`)), 'a concept starting with + is neutralised');
  assert.ok(lines.some((line) => line.includes('"\'=HYPERLINK')), 'a client name starting with = is neutralised');
});
