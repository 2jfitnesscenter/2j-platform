import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: PostgreSQL integration tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 20, connect_timeout: 5 });
await migrateDatabase(sql);
const eligible = async ({ clientId }) => ({ eligible: true, entitlementId: `test-entitlement:${clientId}` });
const admin = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'calendar-admin', role: 'admin' }), bookingEligibilityResolver: eligible });
const reception = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'calendar-reception', role: 'reception-management' }), bookingEligibilityResolver: eligible });
const receptionNoOverride = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'calendar-reception-restricted', role: 'reception-management', deniedPermissions: ['scheduling.override_capacity'] }), bookingEligibilityResolver: eligible });
const failClosed = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'calendar-fail-closed', role: 'reception-management' }) });
const trainer = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'calendar-trainer', role: 'trainer' }) });
const accountant = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'calendar-accountant', role: 'accountant' }) });
const anonymous = buildServer(process.env.DATABASE_URL);
const [area] = await sql`SELECT id FROM areas WHERE normalized_name='la sala'`;
after(async () => { await Promise.all([admin.close(), reception.close(), receptionNoOverride.close(), failClosed.close(), trainer.close(), accountant.close(), anonymous.close()]); await sql.end(); });

async function createClient(firstName) {
  const result = await admin.inject({ method: 'POST', url: '/api/clients', headers: { 'idempotency-key': randomUUID() }, payload: { firstName, lastName: `Calendar ${randomUUID().slice(0, 8)}` } });
  assert.equal(result.statusCode, 201, result.body);
  return result.json();
}
async function createService() {
  const result = await admin.inject({ method: 'POST', url: '/api/services', payload: { name: `Calendar service ${randomUUID()}`, areaId: area.id, status: 'active' } });
  assert.equal(result.statusCode, 201, result.body);
  return result.json();
}
async function createSession({ capacity = 3, startsAt = new Date(Date.now() + 86400000).toISOString(), service = null, app = reception } = {}) {
  const selectedService = service ?? await createService();
  const result = await app.inject({ method: 'POST', url: '/api/calendar/sessions', payload: { serviceId: selectedService.id, areaId: area.id, startsAt, durationMinutes: 60, capacity } });
  assert.equal(result.statusCode, 201, result.body);
  return { ...result.json(), service: selectedService };
}
function mondayKey(value) { const day = new Date(value); day.setUTCHours(0, 0, 0, 0); day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7)); return day.toISOString().slice(0, 10); }
async function reserve(sessionId, clientId, options = {}) { return reception.inject({ method: 'POST', url: `/api/calendar/sessions/${sessionId}/reservations`, payload: { clientId, ...options } }); }

test('creates a session from active service and area and returns it in the Canary week with empty seat counts', async () => {
  const session = await createSession();
  const weekStart = mondayKey(session.startsAt);
  const result = await trainer.inject({ method: 'GET', url: `/api/calendar/week?weekStart=${weekStart}` });
  assert.equal(result.statusCode, 200, result.body);
  const row = result.json().sessions.find((item) => item.id === session.id);
  assert.equal(row.occupiedCount, 0);
  assert.equal(row.capacity, 3);
  assert.equal(row.source, 'manual');
});

test('staff can reserve and cancel a client; client 360 reads the same reservation through client_id', async () => {
  const session = await createSession(); const client = await createClient('Reservation');
  const created = await reserve(session.id, client.id);
  assert.equal(created.statusCode, 201, created.body);
  const reservationId = created.json().id;
  const profile = await reception.inject({ method: 'GET', url: `/api/clients/${client.id}` });
  assert.equal(profile.statusCode, 200, profile.body);
  assert.equal(profile.json().reservations.some((item) => item.id === reservationId), true);
  const cancelled = await reception.inject({ method: 'PATCH', url: `/api/calendar/reservations/${reservationId}/cancel` });
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  const afterCancel = await admin.inject({ method: 'GET', url: `/api/calendar/sessions/${session.id}/attendees` });
  assert.equal(afterCancel.json().reservations.find((item) => item.id === reservationId).status, 'cancelled');
});

test('capacity is enforced and simultaneous attempts for the last place permit exactly one reservation', async () => {
  const session = await createSession({ capacity: 1 }); const clients = await Promise.all([createClient('First'), createClient('Second')]);
  const results = await Promise.all(clients.map((client) => reserve(session.id, client.id)));
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [201, 409]);
  assert.equal(results.filter((result) => result.statusCode === 409 && result.json().error === 'capacity_full').length, 1);
  const weekStart = mondayKey(session.startsAt);
  const week = await trainer.inject({ method: 'GET', url: `/api/calendar/week?weekStart=${weekStart}` });
  assert.equal(week.json().sessions.find((item) => item.id === session.id).occupiedCount, 1);
});

test('a full session accepts a waitlist entry, supports withdrawal and re-entry, without automatic promotion', async () => {
  const session = await createSession({ capacity: 1 }); const clients = await Promise.all([createClient('Booked'), createClient('Waiting')]);
  assert.equal((await reserve(session.id, clients[0].id)).statusCode, 201);
  const joined = await reception.inject({ method: 'POST', url: `/api/calendar/sessions/${session.id}/waitlist`, payload: { clientId: clients[1].id } });
  assert.equal(joined.statusCode, 201, joined.body);
  const duplicate = await reception.inject({ method: 'POST', url: `/api/calendar/sessions/${session.id}/waitlist`, payload: { clientId: clients[1].id } });
  assert.equal(duplicate.json().error, 'client_already_added');
  const left = await reception.inject({ method: 'PATCH', url: `/api/calendar/waitlist/${joined.json().id}/cancel` });
  assert.equal(left.statusCode, 200);
  const reentered = await reception.inject({ method: 'POST', url: `/api/calendar/sessions/${session.id}/waitlist`, payload: { clientId: clients[1].id } });
  assert.equal(reentered.statusCode, 201, reentered.body);
  const data = await admin.inject({ method: 'GET', url: `/api/calendar/sessions/${session.id}/attendees` });
  assert.equal(data.json().waitlist.length, 1);
  assert.equal(data.json().waitlist[0].clientId, clients[1].id);
});

test('calendar template and generated session are distinct entities and generation is explicit and idempotent', async () => {
  const service = await createService();
  const target = new Date(); target.setDate(target.getDate() + 8);
  const sessionDate = target.toISOString().slice(0, 10); const weekday = target.getUTCDay();
  const created = await reception.inject({ method: 'POST', url: '/api/calendar/templates', payload: { serviceId: service.id, areaId: area.id, weekday, localStartTime: '09:30', durationMinutes: 45, capacity: 8, startsOn: sessionDate, endsOn: null } });
  assert.equal(created.statusCode, 201, created.body);
  const generated = await reception.inject({ method: 'POST', url: `/api/calendar/templates/${created.json().id}/sessions`, payload: { sessionDate } });
  assert.equal(generated.statusCode, 201, generated.body);
  assert.equal(generated.json().source, 'template');
  assert.equal(generated.json().templateId, created.json().id);
  const duplicate = await reception.inject({ method: 'POST', url: `/api/calendar/templates/${created.json().id}/sessions`, payload: { sessionDate } });
  assert.equal(duplicate.statusCode, 409);
  assert.equal((await sql`SELECT count(*)::int AS total FROM recurring_session_templates WHERE id=${created.json().id}`).at(0).total, 1);
});

test('rejects missing clients, archived services, invalid attendance transitions, and bookings in cancelled sessions', async () => {
  const session = await createSession({ capacity: 2 });
  const missing = await reserve(session.id, randomUUID());
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error, 'client_not_found');
  const client = await createClient('Archived service');
  const archivedService = await createService();
  assert.equal((await admin.inject({ method: 'PATCH', url: `/api/services/${archivedService.id}/archive` })).statusCode, 200);
  const invalidSession = await reception.inject({ method: 'POST', url: '/api/calendar/sessions', payload: { serviceId: archivedService.id, areaId: area.id, startsAt: new Date(Date.now() + 86400000).toISOString(), durationMinutes: 60, capacity: 3 } });
  assert.equal(invalidSession.statusCode, 409);
  assert.equal(invalidSession.json().error, 'service_archived');
  const archivedClient = await createClient('Archived reservation');
  await admin.inject({ method: 'PATCH', url: `/api/clients/${archivedClient.id}/archive` });
  const archivedClientBooking = await reserve(session.id, archivedClient.id);
  assert.equal(archivedClientBooking.statusCode, 409);
  assert.equal(archivedClientBooking.json().error, 'client_archived');
  const reserved = await reserve(session.id, client.id);
  assert.equal(reserved.statusCode, 201);
  await reception.inject({ method: 'PATCH', url: `/api/calendar/sessions/${session.id}/cancel` });
  const blocked = await reserve(session.id, (await createClient('Cancelled session')).id);
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json().error, 'session_cancelled');
});

test('calendar management, attendance and attendee PII require server-side permissions', async () => {
  const session = await createSession({ capacity: 1 }); const client = await createClient('Permission');
  const secondClient = await createClient('Overbook reception'); const thirdClient = await createClient('Overbook admin');
  assert.equal((await anonymous.inject({ method: 'GET', url: '/api/calendar/week?weekStart=2026-10-05' })).statusCode, 401);
  assert.equal((await accountant.inject({ method: 'GET', url: '/api/calendar/week?weekStart=2026-10-05' })).statusCode, 403);
  assert.equal((await trainer.inject({ method: 'POST', url: `/api/calendar/sessions/${session.id}/reservations`, payload: { clientId: client.id } })).statusCode, 403);
  assert.equal((await receptionNoOverride.inject({ method: 'POST', url: `/api/calendar/sessions/${session.id}/reservations`, payload: { clientId: secondClient.id, overbook: true } })).statusCode, 403);
  assert.equal((await accountant.inject({ method: 'GET', url: `/api/calendar/sessions/${session.id}/attendees` })).statusCode, 403);
  const booked = await reserve(session.id, client.id);
  assert.equal(booked.statusCode, 201);
  const attendance = await reception.inject({ method: 'PATCH', url: `/api/calendar/reservations/${booked.json().id}/attendance`, payload: { status: 'attended' } });
  assert.equal(attendance.statusCode, 200);
  assert.equal(attendance.json().status, 'attended');
  const overbookedByStaff = await reception.inject({ method: 'POST', url: `/api/calendar/sessions/${session.id}/reservations`, payload: { clientId: secondClient.id, overbook: true } });
  assert.equal(overbookedByStaff.statusCode, 201, overbookedByStaff.body);
  const overbooked = await admin.inject({ method: 'POST', url: `/api/calendar/sessions/${session.id}/reservations`, payload: { clientId: thirdClient.id, overbook: true } });
  assert.equal(overbooked.statusCode, 201, overbooked.body);
  assert.equal((await sql`SELECT count(*)::int AS total FROM calendar_audit_events WHERE session_id=${session.id} AND action='reservation.overbooked'`).at(0).total, 2);
});

test('booking eligibility contract fails closed when no client entitlement resolver is connected', async () => {
  const session = await createSession({ capacity: 1 }); const client = await createClient('No entitlement');
  const result = await failClosed.inject({ method: 'POST', url: `/api/calendar/sessions/${session.id}/reservations`, payload: { clientId: client.id } });
  assert.equal(result.statusCode, 409);
  assert.equal(result.json().error, 'entitlement_unavailable');
  assert.equal((await sql`SELECT count(*)::int AS total FROM calendar_reservations WHERE session_id=${session.id}`).at(0).total, 0);
});

test('critical calendar actions append audit records without copying client PII', async () => {
  const session = await createSession({ capacity: 1 }); const client = await createClient('Audited');
  const booking = await reserve(session.id, client.id);
  const audit = await sql`SELECT action,resource_type,session_id,client_id,details FROM calendar_audit_events WHERE session_id=${session.id} ORDER BY occurred_at,id`;
  assert.deepEqual(audit.map((row) => row.action), ['session.created', 'reservation.created']);
  assert.equal(audit[1].client_id, client.id);
  assert.deepEqual(audit[1].details, { overbooked: false });
  const cancel = await reception.inject({ method: 'PATCH', url: `/api/calendar/reservations/${booking.json().id}/cancel` });
  assert.equal(cancel.statusCode, 200);
  assert.ok((await sql`SELECT id FROM calendar_audit_events WHERE session_id=${session.id} AND action='reservation.cancelled'`).length === 1);
  await assert.rejects(sql`UPDATE calendar_audit_events SET actor_id='tamper' WHERE session_id=${session.id}`, (error) => error.code === '55000');
});

test('individual appointment creates a single client-linked reservation transactionally', async () => {
  const service = await createService(); const client = await createClient('Individual');
  const result = await reception.inject({ method: 'POST', url: '/api/calendar/sessions', payload: { serviceId: service.id, areaId: area.id, startsAt: new Date(Date.now() + 86400000).toISOString(), durationMinutes: 60, capacity: 1, individualClientId: client.id } });
  assert.equal(result.statusCode, 201, result.body);
  const rows = await reception.inject({ method: 'GET', url: `/api/calendar/sessions/${result.json().id}/attendees` });
  assert.equal(rows.json().reservations.length, 1);
  assert.equal(rows.json().reservations[0].clientId, client.id);
});
