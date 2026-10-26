import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: owner panel tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 6, connect_timeout: 5 });
await migrateDatabase(sql);
const as = (role, explicitPermissions) => buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: `owner-panel-test-${role}`, role, ...(explicitPermissions ? { explicitPermissions } : {}) }) });
const owner = as('admin', ['owner.panel.read']);
const admin = as('admin');
const trainer = as('trainer');
const accountant = as('accountant');
const reception = as('reception-management');
const anonymous = buildServer(process.env.DATABASE_URL);
after(async () => { await Promise.all([owner.close(), admin.close(), trainer.close(), accountant.close(), reception.close(), anonymous.close()]); await sql.end(); });

const post = (url, payload, headers = {}) => admin.inject({ method: 'POST', url, headers, payload });
const panel = async () => { const response = await owner.inject({ method: 'GET', url: '/api/admin/owner-panel' }); assert.equal(response.statusCode, 200, response.body); return response.json(); };
const canaryDate = (instant) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));

test('the owner panel needs authentication and the explicit owner.panel.read grant; no role, not even Admin, implies it', async () => {
  assert.equal((await anonymous.inject({ method: 'GET', url: '/api/admin/owner-panel' })).statusCode, 401);
  for (const app of [admin, trainer, accountant, reception]) assert.equal((await app.inject({ method: 'GET', url: '/api/admin/owner-panel' })).statusCode, 403, 'not even the generic Admin profile');
  const response = await owner.inject({ method: 'GET', url: '/api/admin/owner-panel' });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('the panel returns the HOY / SEMANA / MES blocks with only counters, amounts and short labels (no contact, health, notes or fiscal data)', async () => {
  const body = await panel();
  assert.equal(body.timezone, 'Atlantic/Canary');
  assert.deepEqual(Object.keys(body).sort(), ['asOf', 'localDate', 'month', 'timezone', 'today', 'week']);
  assert.deepEqual(Object.keys(body.today).sort(), ['cash', 'classes', 'clients', 'clockedIn', 'collections', 'reviews', 'teamAlerts', 'waitlist']);
  assert.deepEqual(Object.keys(body.week).sort(), ['dueSoon', 'lowStock', 'sessions', 'storeSales']);
  assert.deepEqual(Object.keys(body.month).sort(), ['bunkerLinkedClients', 'newClients', 'occupancyBySlot', 'revenue']);
  assert.deepEqual(Object.keys(body.month.revenue.byMethod).sort(), ['card', 'cash', 'direct_debit', 'other', 'transfer']);
  for (const value of [body.today.collections.pendingCents, body.today.clients.overdue, body.today.clients.blocked, body.today.waitlist.entries, body.today.reviews.transfers, body.today.reviews.bunkerLinks, body.week.dueSoon.assignments, body.month.bunkerLinkedClients]) assert.ok(Number.isInteger(value) && value >= 0, `non-negative integer: ${value}`);
  assert.ok(['none', 'open', 'closed', 'late_close'].includes(body.today.cash.state));
  const text = JSON.stringify(body).toLowerCase();
  for (const forbidden of ['email', 'phone', 'health', 'salud', 'note', 'tax_id', 'taxid', 'birth', 'address']) assert.equal(text.includes(forbidden), false, `no "${forbidden}" in the panel`);
});

test('new clients, store sales and low stock move the matching counters and lists', async () => {
  const before = await panel();
  const created = await post('/api/clients', { firstName: 'Panel', lastName: `Propietario ${randomUUID().slice(0, 8)}` }, { 'idempotency-key': randomUUID() });
  assert.equal(created.statusCode, 201, created.body);

  const productName = `Panel ${randomUUID()}`;
  const product = (await post('/api/admin/store/products', { category: 'nutrition', name: productName, description: 'Prueba' })).json();
  const variant = (await post(`/api/admin/store/products/${product.id}/variants`, { label: 'Bote panel', priceCents: 1990, stockTracked: true, active: true, sku: null })).json();
  assert.equal((await post(`/api/admin/store/variants/${variant.id}/movements`, { type: 'opening', quantity: 3, reason: 'Apertura sintética' })).statusCode, 201);
  const sale = await post('/api/admin/store/sales', { clientId: created.json().id, lines: [{ variantId: variant.id, quantity: 1 }], paymentState: 'pending', paymentMethod: null, note: '' }, { 'idempotency-key': randomUUID() });
  assert.equal(sale.statusCode, 201, sale.body);

  const after = await panel();
  assert.equal(after.month.newClients.thisMonth, before.month.newClients.thisMonth + 1);
  assert.equal(after.week.storeSales.count, before.week.storeSales.count + 1);
  assert.equal(after.week.storeSales.pendingCents, before.week.storeSales.pendingCents + 1990);
  assert.equal(after.week.storeSales.collectedCents, before.week.storeSales.collectedCents, 'a pending sale is not collected');
  const item = after.week.lowStock.items.find((entry) => entry.productName === productName);
  assert.deepEqual(item && { variantLabel: item.variantLabel, stock: item.stock }, { variantLabel: 'Bote panel', stock: 2 });
});

test('today classes count occupancy, waitlist and unassigned sessions; cancelling a session removes it', async () => {
  const area = (await post('/api/areas', { name: `Sala panel ${randomUUID().slice(0, 8)}` })).json();
  const service = (await post('/api/services', { name: `Servicio panel ${randomUUID()}`, areaId: area.id, status: 'active' })).json();
  const before = await panel();
  const startsAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const session = await post('/api/calendar/sessions', { serviceId: service.id, areaId: area.id, startsAt, durationMinutes: 60, capacity: 4 });
  assert.equal(session.statusCode, 201, session.body);
  const after = await panel();
  if (canaryDate(startsAt) === before.localDate) {
    assert.equal(after.today.classes.sessionCount, before.today.classes.sessionCount + 1);
    assert.equal(after.today.classes.capacity, before.today.classes.capacity + 4);
    assert.ok(after.today.classes.sessions.length <= 10, 'the list is capped');
  }
  assert.equal(after.today.teamAlerts.unassignedSessions, before.today.teamAlerts.unassignedSessions + 1, 'a session without professional is an alert');
  const cancelled = await admin.inject({ method: 'PATCH', url: `/api/calendar/sessions/${session.json().id}/cancel`, payload: { reason: 'Prueba del panel' } });
  assert.ok([200, 204].includes(cancelled.statusCode), cancelled.body);
  const last = await panel();
  assert.equal(last.today.teamAlerts.unassignedSessions, before.today.teamAlerts.unassignedSessions);
});

test('the session capabilities tell the shell whether to offer the panel: true only with the explicit grant', async () => {
  const withGrant = await owner.inject({ method: 'GET', url: '/api/session/capabilities' });
  assert.equal(withGrant.statusCode, 200, withGrant.body);
  assert.equal(withGrant.json().ownerPanel, true);
  for (const app of [admin, trainer, accountant, reception]) assert.equal((await app.inject({ method: 'GET', url: '/api/session/capabilities' })).json().ownerPanel, false);
});
