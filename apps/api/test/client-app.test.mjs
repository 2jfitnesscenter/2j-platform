import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { createBookingEligibilityResolver } from '../src/booking-eligibility.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: PostgreSQL client-app integration tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 12, connect_timeout: 5 });
await migrateDatabase(sql);
const eligibility = createBookingEligibilityResolver();
const admin = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'client-app-test-admin', role: 'admin' }), bookingEligibilityResolver: eligibility });
const anonymous = buildServer(process.env.DATABASE_URL);
const makeClient = async name => {
  const response = await admin.inject({ method: 'POST', url: '/api/clients', headers: { 'idempotency-key': randomUUID() }, payload: { firstName: name, lastName: `Client app ${randomUUID().slice(0,8)}` } });
  assert.equal(response.statusCode, 201, response.body); return response.json();
};
const a = await makeClient('Ada'); const b = await makeClient('Bea');
const [area] = await sql`SELECT id FROM areas WHERE status='active' ORDER BY id LIMIT 1`;
const serviceResponse = await admin.inject({ method: 'POST', url: '/api/services', payload: { name: `App client ${randomUUID()}`, areaId: area.id, status: 'active' } });
assert.equal(serviceResponse.statusCode, 201, serviceResponse.body);
const service = serviceResponse.json();
const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const planResponse = await admin.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': randomUUID() }, payload: {
  name: `Client self-service ${randomUUID()}`, serviceIds: [service.id], kind: 'session_pack', renewalCadence: null, basePriceCents: 1000,
  modules: [{ module: 'reservations', accessLevel: 'full', capabilities: [] }],
  rights: [{ rightType: 'service_access', serviceId: service.id }, { rightType: 'sessions_quota', serviceId: service.id, quotaScope: 'per_service', quantity: 10 }],
} });
assert.equal(planResponse.statusCode, 201, planResponse.body);
assert.equal((await admin.inject({ method: 'POST', url: `/api/plans/${planResponse.json().id}/activate`, payload: {} })).statusCode, 200);
for (const client of [a, b]) {
  const sale = await admin.inject({ method: 'POST', url: `/api/clients/${client.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: { planId: planResponse.json().id, startsOn: localDate, dueOn: localDate, amountCents: 1000 } });
  assert.equal(sale.statusCode, 201, sale.body);
}
const startsAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
const [session] = await sql`INSERT INTO calendar_sessions(service_id,area_id,starts_at,duration_minutes,capacity,created_by) VALUES (${service.id},${area.id},${startsAt},45,1,'client-app-test') RETURNING id`;
const byClient = clientId => buildServer(process.env.DATABASE_URL, {
  clientAuthorizationResolver: async () => ({ clientId }),
  bookingEligibilityResolver: eligibility,
});
const appA = byClient(a.id); const appB = byClient(b.id);
after(async () => {
  await Promise.all([admin.close(), anonymous.close(), appA.close(), appB.close()]);
  await sql.end();
});

test('self-service facade derives the identity server-side and hides another client’s bookings', async () => {
  const me = await appA.inject({ method: 'GET', url: '/api/me' });
  assert.equal(me.statusCode, 200); assert.equal(me.json().profile.id, a.id);
  const querySpoof = await appA.inject({ method: 'GET', url: `/api/me?clientId=${b.id}` });
  assert.equal(querySpoof.statusCode, 200); assert.equal(querySpoof.json().profile.id, a.id);
  const ownMembership = await appA.inject({ method: 'GET', url: '/api/me/membership' });
  const assignment = await sql`SELECT id FROM client_plan_assignments WHERE client_id=${a.id} ORDER BY created_at DESC,id DESC LIMIT 1`;
  assert.equal(ownMembership.statusCode, 200); assert.equal(ownMembership.json().assignments[0].id, assignment[0].id);
  const spoof = await appA.inject({ method: 'POST', url: `/api/me/sessions/${session.id}/reservations`, payload: { clientId: b.id } });
  assert.equal(spoof.statusCode, 400); assert.equal(spoof.json().error, 'invalid_self_service_request');
  const reserved = await appA.inject({ method: 'POST', url: `/api/me/sessions/${session.id}/reservations`, headers: { 'idempotency-key': randomUUID() }, payload: {} });
  assert.equal(reserved.statusCode, 201, reserved.body);
  assert.equal((await sql`SELECT client_id FROM calendar_reservations WHERE id=${reserved.json().id}`)[0].client_id, a.id);
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const publicSessions = await appA.inject({ method: 'GET', url: `/api/me/sessions?from=${localDate}&to=${new Date(Date.now()+8*86_400_000).toISOString().slice(0,10)}` });
  assert.equal(publicSessions.statusCode, 200);
  const publicSession = publicSessions.json().sessions.find(row => row.id === session.id);
  assert.equal(publicSession.myReservationStatus, 'reserved');
  assert.equal(publicSession.professionalName === null || typeof publicSession.professionalName === 'string', true);
  assert.equal(JSON.stringify(publicSession).includes(b.firstName), false);
  assert.equal('email' in publicSession || 'phone' in publicSession || 'clientId' in publicSession, false);
  assert.deepEqual((await appB.inject({ method: 'GET', url: '/api/me/bookings' })).json().reservations, []);
  const foreignCancel = await appB.inject({ method: 'PATCH', url: `/api/me/bookings/${reserved.json().id}/cancel`, payload: {} });
  assert.equal(foreignCancel.statusCode, 404);
  const foreignPreview = await appB.inject({ method: 'GET', url: `/api/me/bookings/${reserved.json().id}/cancellation-preview` });
  assert.equal(foreignPreview.statusCode, 404);
  assert.equal((await sql`SELECT status FROM calendar_reservations WHERE id=${reserved.json().id}`)[0].status, 'reserved');
});

test('self-service waitlist and cancellation are owner-scoped and use the central booking engine', async () => {
  const joined = await appB.inject({ method: 'POST', url: `/api/me/sessions/${session.id}/waitlist`, headers: { 'idempotency-key': randomUUID() }, payload: {} });
  assert.equal(joined.statusCode, 201, joined.body);
  const row = await sql`SELECT client_id,status FROM calendar_waitlist_entries WHERE id=${joined.json().id}`;
  assert.equal(row[0].client_id, b.id); assert.equal(row[0].status, 'waiting');
  const spoof = await appB.inject({ method: 'POST', url: `/api/me/sessions/${session.id}/waitlist`, payload: { clientId: a.id } });
  assert.equal(spoof.statusCode, 400);
  const foreignLeave = await appA.inject({ method: 'PATCH', url: `/api/me/waitlist/${joined.json().id}/cancel`, payload: {} });
  assert.equal(foreignLeave.statusCode, 404);
  const left = await appB.inject({ method: 'PATCH', url: `/api/me/waitlist/${joined.json().id}/cancel`, headers: { 'idempotency-key': randomUUID() }, payload: {} });
  assert.equal(left.statusCode, 200, left.body); assert.equal(left.json().status, 'cancelled');

  const [ownSession] = await sql`INSERT INTO calendar_sessions(service_id,area_id,starts_at,duration_minutes,capacity,created_by) VALUES (${service.id},${area.id},${new Date(Date.now()+5*86_400_000).toISOString()},45,2,'client-app-test') RETURNING id`;
  const ownReservation = await appB.inject({ method: 'POST', url: `/api/me/sessions/${ownSession.id}/reservations`, headers: { 'idempotency-key': randomUUID() }, payload: {} });
  assert.equal(ownReservation.statusCode, 201, ownReservation.body);
  const preview = await appB.inject({ method: 'GET', url: `/api/me/bookings/${ownReservation.json().id}/cancellation-preview` });
  assert.equal(preview.statusCode, 200); assert.equal(preview.json().canCancel, true);
  const cancelled = await appB.inject({ method: 'PATCH', url: `/api/me/bookings/${ownReservation.json().id}/cancel`, headers: { 'idempotency-key': randomUUID() }, payload: {} });
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  assert.equal((await sql`SELECT status FROM calendar_reservations WHERE id=${ownReservation.json().id}`)[0].status, 'cancelled');
});

test('client API fails closed when the host has no client identity resolver', async () => {
  const response = await anonymous.inject({ method: 'GET', url: '/api/me' });
  assert.equal(response.statusCode, 401); assert.equal(response.json().error, 'client_authentication_required');
  const mutation = await anonymous.inject({ method: 'POST', url: `/api/me/sessions/${session.id}/reservations`, payload: {} });
  assert.equal(mutation.statusCode, 401);
});
