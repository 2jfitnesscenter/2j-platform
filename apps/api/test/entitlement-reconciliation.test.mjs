import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { reconcileClientReservationCoverage } from '../src/entitlement-reconciliation.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: reconciliation tests need disposable PostgreSQL.');
const sourceUrl = new URL(process.env.DATABASE_URL);
const databaseName = `recon_${randomUUID().replaceAll('-', '')}`;
const adminUrl = new URL(sourceUrl); adminUrl.pathname = '/postgres';
const root = postgres(adminUrl.toString(), { max: 1, connect_timeout: 5 });
await root.unsafe(`CREATE DATABASE "${databaseName}"`);
const databaseUrl = new URL(sourceUrl); databaseUrl.pathname = `/${databaseName}`;
const sql = postgres(databaseUrl.toString(), { max: 12, connect_timeout: 5 });
await migrateDatabase(sql);
const app = buildServer(databaseUrl.toString(), { authorizationResolver: async () => ({ actorId: 'recon-admin', role: 'admin' }) });
const [area] = await sql`SELECT id FROM areas WHERE normalized_name='la sala'`;
assert.ok(area, 'Synthetic fixture area La Sala is missing.');

const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const [y, m] = localDate.split('-').map(Number);
const nextMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
const endsOn = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
const dueOn = `${nextMonth.slice(0, 7)}-10`;
const sessionDay = `${nextMonth.slice(0, 8)}15T12:00:00.000Z`;

after(async () => {
  await app.close(); await sql.end();
  await root.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`); await root.end();
});

async function bookedMember() {
  const service = (await app.inject({ method: 'POST', url: '/api/services', payload: { name: `Recon ${randomUUID()}`, areaId: area.id, status: 'active' } })).json();
  const planCreate = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': randomUUID() }, payload: {
    name: `Recon ${randomUUID()}`, serviceIds: [service.id], kind: 'recurring', renewalCadence: 'monthly', basePriceCents: 4500,
    termKind: 'natural_month', paymentBlock: 'enforce', paymentRule: 'monthly_day10_v1',
    rights: [{ rightType: 'service_access', serviceId: service.id }, { rightType: 'sessions_quota', serviceId: service.id, quotaScope: 'per_service', weeklyFrequency: 2, quantityRule: 'weekday_ratio_v1' }],
  } }); assert.equal(planCreate.statusCode, 201, planCreate.body); const plan = planCreate.json();
  const activation = await app.inject({ method: 'POST', url: `/api/plans/${plan.id}/activate` }); assert.equal(activation.statusCode, 200, activation.body);
  const client = (await app.inject({ method: 'POST', url: '/api/clients', headers: { 'idempotency-key': randomUUID() }, payload: { firstName: 'Recon', lastName: randomUUID().slice(0, 8) } })).json();
  const sale = await app.inject({ method: 'POST', url: `/api/clients/${client.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: { planId: plan.id, startsOn: nextMonth, endsOn, dueOn, amountCents: 4500 } });
  assert.equal(sale.statusCode, 201, sale.body);
  const assignment = sale.json();
  const session = (await app.inject({ method: 'POST', url: '/api/calendar/sessions', payload: { serviceId: service.id, areaId: area.id, startsAt: sessionDay, durationMinutes: 60, capacity: 4 } })).json();
  const booking = await app.inject({ method: 'POST', url: `/api/calendar/sessions/${session.id}/reservations`, headers: { 'idempotency-key': randomUUID() }, payload: { clientId: client.id } });
  assert.equal(booking.statusCode, 201, booking.body);
  return { client, assignment, reservationId: booking.json().id };
}

async function cancelEventOnly(assignmentId) {
  await sql`INSERT INTO client_plan_assignment_events(assignment_id,event_type,effective_on,reason,actor_id,actor_role,idempotency_key,request_hash)
    VALUES (${assignmentId}::uuid,'cancelled',${localDate}::date,'Reconciliación de prueba','recon-test','admin',${randomUUID()}::uuid,${createHash('sha256').update(randomUUID()).digest('hex')})`;
}
async function reservationStatus(id) {
  const [row] = await sql`SELECT status FROM calendar_reservations WHERE id=${id}::uuid`;
  return row.status;
}
async function restoreRows(clientId) {
  return sql`SELECT id FROM client_entitlement_ledger WHERE client_id=${clientId}::uuid AND entry_type='restore'`;
}
async function reconcile(clientId, eventKey) {
  return sql.begin(tx => reconcileClientReservationCoverage(tx, { clientId, actorId: 'recon-test', eventKey }));
}

test('cancelling an assignment through the product route releases its uncovered booking and restores quota once', async () => {
  const member = await bookedMember();
  assert.equal(await reservationStatus(member.reservationId), 'reserved');
  const cancel = await app.inject({ method: 'POST', url: `/api/clients/${member.client.id}/plans/${member.assignment.id}/cancel`, headers: { 'idempotency-key': randomUUID() }, payload: { reason: 'Reconciliación de prueba' } });
  assert.ok([200, 201].includes(cancel.statusCode), cancel.body);
  assert.equal(await reservationStatus(member.reservationId), 'cancelled_by_membership');
  assert.equal((await restoreRows(member.client.id)).length, 1);
});

test('repeating the same reconciliation does not cancel or restore twice', async () => {
  const member = await bookedMember();
  const eventKey = `evt-${randomUUID()}`;
  await cancelEventOnly(member.assignment.id);
  const first = await reconcile(member.client.id, eventKey);
  const second = await reconcile(member.client.id, eventKey);
  assert.equal(first.cancelled, 1);
  assert.equal(second.cancelled, 0);
  assert.equal(second.restored, 0);
  assert.equal((await restoreRows(member.client.id)).length, 1);
});

test('two concurrent reconciliations for the same member never double-cancel or double-restore', async () => {
  const member = await bookedMember();
  await cancelEventOnly(member.assignment.id);
  const [a, b] = await Promise.all([reconcile(member.client.id, `evt-a-${randomUUID()}`), reconcile(member.client.id, `evt-b-${randomUUID()}`)]);
  assert.equal(a.cancelled + b.cancelled, 1, `cancel must happen exactly once: ${a.cancelled}+${b.cancelled}`);
  assert.equal(a.restored + b.restored, 1, `restore must happen exactly once: ${a.restored}+${b.restored}`);
  assert.equal(await reservationStatus(member.reservationId), 'cancelled_by_membership');
  assert.equal((await restoreRows(member.client.id)).length, 1);
});
