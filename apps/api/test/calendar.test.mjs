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
const trainerEligible = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'calendar-trainer-eligible', role: 'trainer' }), bookingEligibilityResolver: eligible });
const accountant = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'calendar-accountant', role: 'accountant' }) });
const anonymous = buildServer(process.env.DATABASE_URL);
const [area] = await sql`SELECT id FROM areas WHERE normalized_name='la sala'`;
after(async () => { await Promise.all([admin.close(), reception.close(), receptionNoOverride.close(), failClosed.close(), trainer.close(), trainerEligible.close(), accountant.close(), anonymous.close()]); await sql.end(); });

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
  const result = await app.inject({ method: 'POST', url: '/api/calendar/sessions', payload: { serviceId: selectedService.id, areaId: selectedService.areaId, startsAt, durationMinutes: 60, capacity } });
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
  assert.equal(row.isIndividual, false);
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
  assert.equal(data.json().waitlist.filter((item) => item.status === 'waiting').length, 1);
  assert.equal(data.json().waitlist.find((item) => item.status === 'waiting').clientId, clients[1].id);
  assert.equal(data.json().waitlist.filter((item) => item.status === 'cancelled').length, 1);
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

test('bulk schedule creates the selected weekday and time matrix as reusable templates', async () => {
  const selected = await createService();
  const from = new Date(Date.now() + 14 * 86400000); from.setUTCHours(0, 0, 0, 0); from.setUTCDate(from.getUTCDate() + ((1 - from.getUTCDay() + 7) % 7));
  const startsOn = from.toISOString().slice(0, 10);
  const created = await reception.inject({ method: 'POST', url: '/api/calendar/templates/batch', payload: { serviceId: selected.id, areaId: selected.areaId, weekdays: [1, 3, 5], blocks: ['07:00', '08:00', '09:00'].map((localStartTime) => ({ localStartTime, durationMinutes: 60, capacity: 12 })), startsOn, endsOn: null } });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().templates.length, 9);
  assert.equal((await sql`SELECT count(*)::int AS total FROM recurring_session_templates WHERE service_id=${selected.id} AND status='active'`).at(0).total, 9);
  assert.equal((await sql`SELECT count(*)::int AS total FROM calendar_sessions WHERE service_id=${selected.id}`).at(0).total, 0);
  assert.equal((await sql`SELECT count(*)::int AS total FROM calendar_audit_events WHERE resource_type='calendar_template' AND resource_id IN (SELECT id FROM recurring_session_templates WHERE service_id=${selected.id})`).at(0).total, 9);
});

test('bulk schedule detects internal and existing template conflicts without partial writes', async () => {
  const selected = await createService();
  const from = new Date(Date.now() + 21 * 86400000); from.setUTCHours(0, 0, 0, 0); from.setUTCDate(from.getUTCDate() + ((1 - from.getUTCDay() + 7) % 7));
  const startsOn = from.toISOString().slice(0, 10);
  const base = { serviceId: selected.id, areaId: selected.areaId, weekdays: [1], blocks: [{ localStartTime: '07:00', durationMinutes: 60, capacity: 10 }], startsOn, endsOn: null };
  const first = await reception.inject({ method: 'POST', url: '/api/calendar/templates/batch', payload: base });
  assert.equal(first.statusCode, 201, first.body);
  const before = Number((await sql`SELECT count(*)::int AS total FROM recurring_session_templates WHERE service_id=${selected.id}`).at(0).total);
  const existingConflict = await reception.inject({ method: 'POST', url: '/api/calendar/templates/batch', payload: { ...base, blocks: [{ localStartTime: '07:30', durationMinutes: 60, capacity: 10 }] } });
  assert.equal(existingConflict.statusCode, 409); assert.equal(existingConflict.json().error, 'schedule_conflict');
  const internalConflict = await reception.inject({ method: 'POST', url: '/api/calendar/templates/batch', payload: { ...base, weekdays: [1, 3], blocks: [{ localStartTime: '07:00', durationMinutes: 60, capacity: 10 }, { localStartTime: '07:30', durationMinutes: 60, capacity: 10 }] } });
  assert.equal(internalConflict.statusCode, 409); assert.equal(internalConflict.json().error, 'schedule_conflict');
  assert.equal(Number((await sql`SELECT count(*)::int AS total FROM recurring_session_templates WHERE service_id=${selected.id}`).at(0).total), before);
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
  assert.equal((await trainerEligible.inject({ method: 'POST', url: `/api/calendar/sessions/${session.id}/reservations`, payload: { clientId: client.id } })).statusCode, 201);
  assert.equal((await receptionNoOverride.inject({ method: 'POST', url: `/api/calendar/sessions/${session.id}/reservations`, payload: { clientId: secondClient.id, overbook: true } })).statusCode, 403);
  assert.equal((await accountant.inject({ method: 'GET', url: `/api/calendar/sessions/${session.id}/attendees` })).statusCode, 403);
  const booked = await reserve(session.id, client.id);
  assert.equal(booked.statusCode, 409); // the trainer already created the reservation
  const trainerBooking = await sql`SELECT id FROM calendar_reservations WHERE session_id=${session.id} AND client_id=${client.id}`;
  const bookedId = trainerBooking[0].id;
  assert.equal((await reception.inject({ method: 'PATCH', url: `/api/calendar/reservations/${bookedId}/attendance`, payload: { status: 'attended' } })).statusCode, 403);
  const attendance = await trainerEligible.inject({ method: 'PATCH', url: `/api/calendar/reservations/${bookedId}/attendance`, payload: { status: 'attended' } });
  assert.equal(attendance.statusCode, 200);
  assert.equal(attendance.json().status, 'attended');
  const overbookedByTrainer = await trainerEligible.inject({ method: 'POST', url: `/api/calendar/sessions/${session.id}/reservations`, payload: { clientId: secondClient.id, overbook: true } });
  assert.equal(overbookedByTrainer.statusCode, 201, overbookedByTrainer.body);
  const deniedReceptionOverbook = await reception.inject({ method: 'POST', url: `/api/calendar/sessions/${session.id}/reservations`, payload: { clientId: secondClient.id, overbook: true } });
  assert.equal(deniedReceptionOverbook.statusCode, 403);
  const overbooked = await admin.inject({ method: 'POST', url: `/api/calendar/sessions/${session.id}/reservations`, payload: { clientId: thirdClient.id, overbook: true } });
  assert.equal(overbooked.statusCode, 201, overbooked.body);
  assert.equal((await sql`SELECT count(*)::int AS total FROM calendar_audit_events WHERE session_id=${session.id} AND action='reservation.overbooked'`).at(0).total, 2);
});

test('trainer can create and archive templates, cancel group sessions, and override capacity', async () => {
  const service = await createService();
  const future = new Date(Date.now() + 3 * 86400000);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(future);
  const startsOnIso = `${parts.find((part) => part.type === 'year').value}-${parts.find((part) => part.type === 'month').value}-${parts.find((part) => part.type === 'day').value}`;
  const weekday = new Date(`${startsOnIso}T00:00:00.000Z`).getUTCDay();
  const template = await trainerEligible.inject({ method: 'POST', url: '/api/calendar/templates', payload: { serviceId: service.id, areaId: service.areaId, weekday, localStartTime: '10:00', durationMinutes: 60, capacity: 2, startsOn: startsOnIso } });
  assert.equal(template.statusCode, 201, template.body);
  assert.equal((await trainerEligible.inject({ method: 'PATCH', url: `/api/calendar/templates/${template.json().id}/archive` })).statusCode, 200);
  const session = await createSession({ app: trainerEligible });
  assert.equal((await trainerEligible.inject({ method: 'PATCH', url: `/api/calendar/sessions/${session.id}/cancel` })).statusCode, 200);
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
  assert.deepEqual(audit[1].details, { overbooked: false, debtOverride: false, debtOverrideReason: null });
  const cancel = await reception.inject({ method: 'PATCH', url: `/api/calendar/reservations/${booking.json().id}/cancel` });
  assert.equal(cancel.statusCode, 200);
  assert.ok((await sql`SELECT id FROM calendar_audit_events WHERE session_id=${session.id} AND action='reservation.cancelled'`).length === 1);
  await assert.rejects(sql`UPDATE calendar_audit_events SET actor_id='tamper' WHERE session_id=${session.id}`, (error) => error.code === '55000');
});

test('individual appointment creates a single client-linked reservation transactionally', async () => {
  const service = await createService(); const client = await createClient('Individual');
  const result = await reception.inject({ method: 'POST', url: '/api/calendar/sessions', payload: { serviceId: service.id, areaId: area.id, startsAt: new Date(Date.now() + 86400000).toISOString(), durationMinutes: 60, capacity: 1, individualClientId: client.id } });
  assert.equal(result.statusCode, 201, result.body);
  const week = await trainer.inject({ method: 'GET', url: `/api/calendar/week?weekStart=${mondayKey(result.json().startsAt)}` });
  const calendarRow = week.json().sessions.find((item) => item.id === result.json().id);
  assert.equal(calendarRow.isIndividual, true);
  assert.equal(Object.hasOwn(calendarRow, 'individualClientId'), false, 'weekly marker must not expose client identity');
  const rows = await reception.inject({ method: 'GET', url: `/api/calendar/sessions/${result.json().id}/attendees` });
  assert.equal(rows.json().reservations.length, 1);
  assert.equal(rows.json().reservations[0].clientId, client.id);
  const other = await createClient('Other individual');
  assert.equal((await reserve(result.json().id, other.id)).json().error, 'individual_session_client_mismatch');
  assert.equal((await reception.inject({ method: 'POST', url: `/api/calendar/sessions/${result.json().id}/waitlist`, payload: { clientId: other.id } })).json().error, 'individual_session_client_mismatch');
  await assert.rejects(sql`UPDATE calendar_sessions SET individual_client_id=NULL WHERE id=${result.json().id}`, (error) => error.code === '55000');
  await assert.rejects(sql`UPDATE calendar_sessions SET capacity=2 WHERE id=${result.json().id}`, (error) => error.code === '23514');
  await assert.rejects(sql`INSERT INTO calendar_reservations(session_id,client_id,entitlement_reference,created_by) VALUES (${result.json().id},${other.id},'direct','test')`, (error) => error.code === '23514');
});

test('template validity boundaries compare Canary-local ISO dates and API returns date strings', async () => {
  const service = await createService();
  const start = new Date(); start.setUTCDate(start.getUTCDate() + 14);
  const startsOn = start.toISOString().slice(0, 10); const weekday = start.getUTCDay();
  const created = await reception.inject({ method: 'POST', url: '/api/calendar/templates', payload: { serviceId: service.id, areaId: area.id, weekday, localStartTime: '10:00', durationMinutes: 45, capacity: 4, startsOn, endsOn: startsOn } });
  assert.equal(created.statusCode, 201, created.body);
  const listed = await trainer.inject({ method: 'GET', url: `/api/calendar/week?weekStart=${mondayKey(start)}` });
  const template = listed.json().templates.find((item) => item.id === created.json().id);
  assert.equal(template.startsOn, startsOn); assert.equal(template.endsOn, startsOn);
  for (const delta of [-7, 7]) {
    const outside = new Date(start); outside.setUTCDate(outside.getUTCDate() + delta);
    const denied = await reception.inject({ method: 'POST', url: `/api/calendar/templates/${created.json().id}/sessions`, payload: { sessionDate: outside.toISOString().slice(0, 10) } });
    assert.equal(denied.statusCode, 409); assert.equal(denied.json().error, 'template_inactive');
  }
  const within = await reception.inject({ method: 'POST', url: `/api/calendar/templates/${created.json().id}/sessions`, payload: { sessionDate: startsOn } });
  assert.equal(within.statusCode, 201, within.body);
});

test('session cancellation preserves cancelled-by-center history and blocks later attendance changes', async () => {
  const session = await createSession({ capacity: 1 }); const clients = await Promise.all([createClient('Cancel reserved'), createClient('Cancel waiting')]);
  const booked = await reserve(session.id, clients[0].id); assert.equal(booked.statusCode, 201);
  const waiting = await reception.inject({ method: 'POST', url: `/api/calendar/sessions/${session.id}/waitlist`, payload: { clientId: clients[1].id } }); assert.equal(waiting.statusCode, 201);
  const cancelled = await reception.inject({ method: 'PATCH', url: `/api/calendar/sessions/${session.id}/cancel` }); assert.equal(cancelled.statusCode, 200, cancelled.body);
  await assert.rejects(sql`UPDATE calendar_sessions SET status='scheduled' WHERE id=${session.id}`, (error) => error.code === '55000');
  const rows = await admin.inject({ method: 'GET', url: `/api/calendar/sessions/${session.id}/attendees` });
  assert.equal(rows.json().reservations[0].status, 'cancelled_by_center');
  assert.equal(rows.json().waitlist[0].status, 'cancelled_by_center');
  assert.equal((await trainerEligible.inject({ method: 'PATCH', url: `/api/calendar/reservations/${booked.json().id}/attendance`, payload: { status: 'attended' } })).json().error, 'session_cancelled');
  assert.equal((await reception.inject({ method: 'PATCH', url: `/api/calendar/reservations/${booked.json().id}/cancel` })).statusCode, 409);
  assert.equal((await reception.inject({ method: 'PATCH', url: `/api/calendar/waitlist/${waiting.json().id}/cancel` })).statusCode, 409);
  const audit = await sql`SELECT action,actor_id,details,occurred_at FROM calendar_audit_events WHERE session_id=${session.id} AND action IN ('reservation.cancelled_by_center','waitlist.cancelled_by_center') ORDER BY action`;
  assert.equal(audit.length, 2); assert.ok(audit.every((item) => item.actor_id === 'calendar-reception' && item.occurred_at));
  assert.deepEqual(audit.map((item) => item.details.newStatus).sort(), ['cancelled_by_center','cancelled_by_center']);
});

test('attendance and no-show are reversible and audit each old/new status, actor and time', async () => {
  const session = await createSession({ capacity: 1 }); const client = await createClient('Reversible attendance');
  const booking = await reserve(session.id, client.id);
  const states = ['attended','no_show','reserved'];
  for (const status of states) {
    const changed = await trainerEligible.inject({ method: 'PATCH', url: `/api/calendar/reservations/${booking.json().id}/attendance`, payload: { status } });
    assert.equal(changed.statusCode, 200, changed.body); assert.equal(changed.json().status, status);
  }
  const audit = await sql`SELECT actor_id,details,occurred_at FROM calendar_audit_events WHERE session_id=${session.id} AND action='reservation.attendance_changed' ORDER BY occurred_at,id`;
  assert.equal(audit.length, 3);
  assert.deepEqual(audit.map((row) => [row.details.previousStatus,row.details.newStatus]), [['reserved','attended'],['attended','no_show'],['no_show','reserved']]);
  assert.ok(audit.every((row) => row.actor_id === 'calendar-trainer-eligible' && row.occurred_at));
});

test('future scheduled sessions block service and area archival, including under direct SQL', async () => {
  const uniqueArea = await admin.inject({ method: 'POST', url: '/api/areas', payload: { name: `Calendar area ${randomUUID()}` } });
  assert.equal(uniqueArea.statusCode, 201, uniqueArea.body);
  const selected = await admin.inject({ method: 'POST', url: '/api/services', payload: { name: `Calendar archive ${randomUUID()}`, areaId: uniqueArea.json().id, status: 'active' } });
  const session = await createSession({ service: selected.json(), app: reception });
  assert.equal((await admin.inject({ method: 'PATCH', url: `/api/services/${selected.json().id}/archive` })).statusCode, 409);
  assert.equal((await admin.inject({ method: 'PATCH', url: `/api/areas/${uniqueArea.json().id}/archive` })).statusCode, 409);
  await assert.rejects(sql`UPDATE services SET status='archived' WHERE id=${selected.json().id}`, (error) => error.code === '23514');
  await assert.rejects(sql`UPDATE areas SET status='archived' WHERE id=${uniqueArea.json().id}`, (error) => error.code === '23514');
  await reception.inject({ method: 'PATCH', url: `/api/calendar/sessions/${session.id}/cancel` });
  assert.equal((await admin.inject({ method: 'PATCH', url: `/api/services/${selected.json().id}/archive` })).statusCode, 200);
  assert.equal((await admin.inject({ method: 'PATCH', url: `/api/areas/${uniqueArea.json().id}/archive` })).statusCode, 200);
});

test('archiving a recurring template is audited and releases its service archival blocker', async () => {
  const service = await createService(); const start = new Date(); start.setUTCDate(start.getUTCDate() + 20); const date = start.toISOString().slice(0, 10);
  const template = await reception.inject({ method: 'POST', url: '/api/calendar/templates', payload: { serviceId: service.id, areaId: area.id, weekday: start.getUTCDay(), localStartTime: '11:00', durationMinutes: 60, capacity: 8, startsOn: date, endsOn: null } });
  assert.equal(template.statusCode, 201, template.body);
  assert.equal((await admin.inject({ method: 'PATCH', url: `/api/services/${service.id}/archive` })).statusCode, 409);
  const archived = await reception.inject({ method: 'PATCH', url: `/api/calendar/templates/${template.json().id}/archive` });
  assert.equal(archived.statusCode, 200, archived.body); assert.equal(archived.json().status, 'archived');
  const generation = await reception.inject({ method: 'POST', url: `/api/calendar/templates/${template.json().id}/sessions`, payload: { sessionDate: date } });
  assert.equal(generation.statusCode, 409); assert.equal(generation.json().error, 'template_inactive');
  assert.equal((await admin.inject({ method: 'PATCH', url: `/api/services/${service.id}/archive` })).statusCode, 200);
  const audit = await sql`SELECT actor_id,action FROM calendar_audit_events WHERE resource_id=${template.json().id}`;
  assert.deepEqual(audit.map((row) => [row.actor_id,row.action]), [['calendar-reception','template.archived']]);
});

test('reservation and waitlist revalidate service and area status at write time', async () => {
  const service = await createService(); const session = await createSession({ service, capacity: 2 });
  await sql`UPDATE calendar_sessions SET starts_at=now()-interval '1 minute' WHERE id=${session.id}`;
  assert.equal((await admin.inject({ method: 'PATCH', url: `/api/services/${service.id}/archive` })).statusCode, 200);
  await sql`UPDATE calendar_sessions SET starts_at=now()+interval '1 day' WHERE id=${session.id}`;
  const reserveResponse = await reserve(session.id, (await createClient('Archived at reserve')).id);
  assert.equal(reserveResponse.statusCode, 409); assert.equal(reserveResponse.json().error, 'service_archived');

  const areaResponse = await admin.inject({ method: 'POST', url: '/api/areas', payload: { name: `Calendar recheck ${randomUUID()}` } });
  const areaService = await admin.inject({ method: 'POST', url: '/api/services', payload: { name: `Calendar recheck ${randomUUID()}`, areaId: areaResponse.json().id, status: 'active' } });
  const areaSession = await createSession({ service: areaService.json(), capacity: 1 });
  await sql`UPDATE calendar_sessions SET starts_at=now()-interval '1 minute' WHERE id=${areaSession.id}`;
  assert.equal((await admin.inject({ method: 'PATCH', url: `/api/services/${areaService.json().id}/archive` })).statusCode, 200);
  const areaArchive = await admin.inject({ method: 'PATCH', url: `/api/areas/${areaResponse.json().id}/archive` });
  assert.equal(areaArchive.statusCode, 200, areaArchive.body);
  // Simulate legacy/corrupt data to verify the reservation path independently checks the area too.
  await sql`UPDATE services SET status='active' WHERE id=${areaService.json().id}`;
  await sql`UPDATE calendar_sessions SET starts_at=now()+interval '1 day' WHERE id=${areaSession.id}`;
  const waitlist = await reception.inject({ method: 'POST', url: `/api/calendar/sessions/${areaSession.id}/waitlist`, payload: { clientId: (await createClient('Archived at waitlist')).id } });
  assert.equal(waitlist.statusCode, 409); assert.equal(waitlist.json().error, 'area_archived');
});
