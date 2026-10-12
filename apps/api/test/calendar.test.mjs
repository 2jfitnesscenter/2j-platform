import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { materializeCalendarTemplates } from '../src/calendar-materializer.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: PostgreSQL integration tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 20, connect_timeout: 5 });
await migrateDatabase(sql);
const eligible = async ({ clientId }) => ({ eligible: true, entitlementId: `test-entitlement:${clientId}` });
const admin = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'calendar-admin', role: 'admin' }), bookingEligibilityResolver: eligible });
const reception = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'calendar-reception', role: 'reception-management' }), bookingEligibilityResolver: eligible });
const receptionNoOverride = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'calendar-reception-restricted', role: 'reception-management', deniedPermissions: ['scheduling.override_capacity'] }), bookingEligibilityResolver: eligible });
const failClosed = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'calendar-fail-closed', role: 'reception-management' }) });
const engineAdmin = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'calendar-engine-admin', role: 'admin' }) });
const trainer = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'calendar-trainer', role: 'trainer' }) });
const trainerEligible = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'calendar-trainer-eligible', role: 'trainer' }), bookingEligibilityResolver: eligible });
const accountant = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'calendar-accountant', role: 'accountant' }) });
const anonymous = buildServer(process.env.DATABASE_URL);
const [area] = await sql`SELECT id FROM areas WHERE normalized_name='la sala'`;
after(async () => { await Promise.all([admin.close(), reception.close(), receptionNoOverride.close(), failClosed.close(), engineAdmin.close(), trainer.close(), trainerEligible.close(), accountant.close(), anonymous.close()]); await sql.end(); });

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
function canaryDate(date=new Date()) { const values=new Intl.DateTimeFormat('en-GB',{timeZone:'Atlantic/Canary',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);const get=type=>values.find(item=>item.type===type).value;return `${get('year')}-${get('month')}-${get('day')}`; }
async function createEntitledClient(service,{rightType='sessions_quota',quantity=2,period=null,validDays=null,validDaysStartRule=null}={}) {
  const client=await createClient(`Entitled ${randomUUID()}`);
  const isPack=rightType==='sessions_quota';
  const rights=[{rightType:'service_access',serviceId:service.id},isPack?{rightType:'sessions_quota',serviceId:service.id,quotaScope:'per_service',quantity,...(validDays?{validDays,validDaysStartRule}:{})}:{rightType:'period_quota',serviceId:null,quotaScope:'shared',quantity,period,periodMode:'calendar',timezone:'Atlantic/Canary',...(validDays?{validDays,validDaysStartRule}:{})}];
  const payload={name:`Booking plan ${randomUUID()}`,serviceIds:[service.id],kind:isPack?'session_pack':'recurring',renewalCadence:isPack?null:'monthly',basePriceCents:1000,rights};
  const plan=await engineAdmin.inject({method:'POST',url:'/api/plans',headers:{'idempotency-key':randomUUID()},payload});assert.equal(plan.statusCode,201,plan.body);
  assert.equal((await engineAdmin.inject({method:'POST',url:`/api/plans/${plan.json().id}/activate`})).statusCode,200);
  const today=canaryDate();
  const sale=await engineAdmin.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':randomUUID()},payload:{planId:plan.json().id,startsOn:today,endsOn:null,dueOn:today,amountCents:1000}});assert.equal(sale.statusCode,201,sale.body);
  const [right]=await sql`SELECT id FROM plan_rights WHERE plan_id=${plan.json().id} AND right_type=${rightType}`;
  return {client,plan:plan.json(),assignment:sale.json(),rightId:right.id};
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

test('calendar exposes current-week birthdays only to client managers and permits nullable birth dates', async () => {
  const client = (await admin.inject({ method:'POST', url:'/api/clients', headers:{'idempotency-key':randomUUID()}, payload:{firstName:'Cumple',lastName:`Semana ${randomUUID().slice(0,8)}`,birthDate:'2000-10-12'} })).json();
  assert.equal(client.birthDate,'2000-10-12');
  const weekStart='2026-10-12';
  const adminWeek=await admin.inject({method:'GET',url:`/api/calendar/week?weekStart=${weekStart}`});
  assert.ok(adminWeek.json().birthdays.some(item=>item.clientId===client.id&&item.birthdayDate==='2026-10-12'));
  assert.equal(Number.isInteger(adminWeek.json().birthdaysTodayCount),true);
  const trainerWeek=await trainer.inject({method:'GET',url:`/api/calendar/week?weekStart=${weekStart}`});
  assert.deepEqual(trainerWeek.json().birthdays,[]);
  assert.equal(trainerWeek.json().birthdaysTodayCount,0,'today count remains permission-filtered');
  const noBirthDate=await admin.inject({method:'POST',url:'/api/clients',headers:{'idempotency-key':randomUUID()},payload:{firstName:'Sin',lastName:`Fecha ${randomUUID().slice(0,8)}`}});
  assert.equal(noBirthDate.statusCode,201);
  assert.equal(noBirthDate.json().birthDate,null);
});

test('staff can reserve and cancel a client; client 360 reads the same reservation through client_id', async () => {
  const session = await createSession(); const client = await createClient('Reservation');
  const created = await reserve(session.id, client.id);
  assert.equal(created.statusCode, 201, created.body);
  const reservationId = created.json().id;
  const [createdEvent]=await sql`SELECT id FROM domain_events_outbox WHERE dedupe_key=${`booking-confirmed:${reservationId}`}`;assert.ok(createdEvent);
  const profile = await reception.inject({ method: 'GET', url: `/api/clients/${client.id}` });
  assert.equal(profile.statusCode, 200, profile.body);
  assert.equal(profile.json().reservations.some((item) => item.id === reservationId), true);
  const cancelled = await reception.inject({ method: 'PATCH', url: `/api/calendar/reservations/${reservationId}/cancel` });
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  const [cancelledEvent]=await sql`SELECT id FROM domain_events_outbox WHERE dedupe_key=${`booking-cancelled:${reservationId}`}`;assert.ok(cancelledEvent);
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

test('a full session accepts eligible waitlist entry, supports withdrawal and promotes in queue order on cancellation', async () => {
  const service=await createService();const session = await createSession({ capacity: 1,service });
  const booked=await createEntitledClient(service,{quantity:2});const waiting=await createEntitledClient(service,{quantity:2});
  assert.equal((await engineAdmin.inject({method:'POST',url:`/api/calendar/sessions/${session.id}/reservations`,headers:{'idempotency-key':randomUUID()},payload:{clientId:booked.client.id}})).statusCode,201);
  const joined = await engineAdmin.inject({ method: 'POST', url: `/api/calendar/sessions/${session.id}/waitlist`,headers:{'idempotency-key':randomUUID()}, payload: { clientId: waiting.client.id } });
  assert.equal(joined.statusCode, 201, joined.body);
  const [waitlistEvent]=await sql`SELECT id FROM domain_events_outbox WHERE dedupe_key=${`waitlist-joined:${joined.json().id}`}`;assert.ok(waitlistEvent);
  const duplicate = await engineAdmin.inject({ method: 'POST', url: `/api/calendar/sessions/${session.id}/waitlist`, payload: { clientId: waiting.client.id } });
  assert.equal(duplicate.json().error, 'duplicate_booking');
  const left = await engineAdmin.inject({ method: 'PATCH', url: `/api/calendar/waitlist/${joined.json().id}/cancel` });
  assert.equal(left.statusCode, 200);
  const reentered = await engineAdmin.inject({ method: 'POST', url: `/api/calendar/sessions/${session.id}/waitlist`,headers:{'idempotency-key':randomUUID()}, payload: { clientId: waiting.client.id } });
  assert.equal(reentered.statusCode, 201, reentered.body);
  const cancelledBooking=await engineAdmin.inject({method:'PATCH',url:`/api/calendar/reservations/${(await sql`SELECT id FROM calendar_reservations WHERE session_id=${session.id} AND client_id=${booked.client.id}`).at(0).id}/cancel`});
  assert.equal(cancelledBooking.statusCode,200,cancelledBooking.body);
  const [promotedEvent]=await sql`SELECT id FROM domain_events_outbox WHERE dedupe_key=${`waitlist-promoted:${reentered.json().id}`}`;assert.ok(promotedEvent);
  const data = await admin.inject({ method: 'GET', url: `/api/calendar/sessions/${session.id}/attendees` });
  assert.equal(data.json().waitlist.filter((item) => item.status === 'waiting').length, 0);
  assert.equal(data.json().waitlist.find((item) => item.status === 'promoted').clientId, waiting.client.id);
  assert.equal(data.json().reservations.filter((item) => item.clientId===waiting.client.id&&item.status==='reserved').length,1);
  assert.equal(data.json().waitlist.filter((item) => item.status === 'cancelled').length, 1);
});

test('calendar template creates concrete upcoming sessions automatically and keeps manual generation idempotent', async () => {
  const service = await createService();
  const target = new Date(); target.setDate(target.getDate() + 8);
  const sessionDate = target.toISOString().slice(0, 10); const weekday = target.getUTCDay();
  const created = await reception.inject({ method: 'POST', url: '/api/calendar/templates', payload: { serviceId: service.id, areaId: area.id, weekday, localStartTime: '09:30', durationMinutes: 45, capacity: 8, startsOn: sessionDate, endsOn: null } });
  assert.equal(created.statusCode, 201, created.body);
  assert.ok(created.json().materializedCount >= 1);
  const [automatic] = await sql`SELECT * FROM calendar_sessions WHERE template_id=${created.json().id}`;
  assert.ok(automatic, 'template insertion materializes the upcoming occurrence');
  assert.equal(automatic.source, 'template');
  assert.equal((await sql`SELECT extract(dow FROM starts_at AT TIME ZONE 'Atlantic/Canary')::int AS weekday FROM calendar_sessions WHERE id=${automatic.id}`).at(0).weekday, weekday);
  const generated = await reception.inject({ method: 'POST', url: `/api/calendar/templates/${created.json().id}/sessions`, payload: { sessionDate } });
  assert.equal(generated.statusCode, 409);
  assert.equal(generated.json().error, 'session_already_generated');
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
  assert.ok(Number((await sql`SELECT count(*)::int AS total FROM calendar_sessions WHERE service_id=${selected.id}`).at(0).total) > 0);
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

test('central booking eligibility blocks clients without an active explicit service entitlement', async () => {
  const session = await createSession({ capacity: 1 }); const client = await createClient('No entitlement');
  const result = await failClosed.inject({ method: 'POST', url: `/api/calendar/sessions/${session.id}/reservations`, payload: { clientId: client.id } });
  assert.equal(result.statusCode, 409);
  assert.equal(result.json().error, 'service_not_allowed');
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
  const invalidGroupEdit = await reception.inject({ method: 'PATCH', url: `/api/calendar/sessions/${result.json().id}`, payload: { capacity: 2 } });
  assert.equal(invalidGroupEdit.statusCode, 409); assert.equal(invalidGroupEdit.json().error, 'individual_capacity_fixed');
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
  assert.equal(within.statusCode, 409, within.body);
  assert.equal(within.json().error, 'session_already_generated');
});

test('rolling materialization is bounded to 90 Canary dates, idempotent, DST-safe, and preserves cancelled/overridden occurrences', async () => {
  const service = await createService();
  const from = '2025-03-24'; // Monday before the Atlantic/Canary spring DST change.
  const created = await reception.inject({ method: 'POST', url: '/api/calendar/templates', payload: { serviceId: service.id, areaId: service.areaId, weekday: 1, localStartTime: '09:15', durationMinutes: 45, capacity: 8, startsOn: from, endsOn: '2025-04-07' } });
  assert.equal(created.statusCode, 201, created.body);
  const concurrentRuns = await Promise.all([
    sql.begin((tx) => materializeCalendarTemplates(tx, new Date('2025-03-24T12:00:00Z'))),
    sql.begin((tx) => materializeCalendarTemplates(tx, new Date('2025-03-24T12:00:00Z'))),
  ]);
  assert.equal(concurrentRuns.reduce((total, item) => total + item.created, 0), 3);
  const initial = await sql`SELECT id,starts_at AS "startsAt",capacity FROM calendar_sessions WHERE template_id=${created.json().id} ORDER BY starts_at`;
  assert.deepEqual(initial.map((row) => new Date(row.startsAt).toISOString().slice(0,10)), ['2025-03-24','2025-03-31','2025-04-07']);
  const localTimes = await sql`SELECT to_char(starts_at AT TIME ZONE 'Atlantic/Canary','YYYY-MM-DD HH24:MI') AS value FROM calendar_sessions WHERE template_id=${created.json().id} ORDER BY starts_at`;
  assert.deepEqual(localTimes.map((row) => row.value), ['2025-03-24 09:15','2025-03-31 09:15','2025-04-07 09:15']);
  const [rolling] = await sql`INSERT INTO recurring_session_templates(service_id,area_id,weekday,local_start_time,duration_minutes,capacity,starts_on,created_by) VALUES (${service.id},${service.areaId},2,'10:00',45,8,${from},'2J-080-test') RETURNING id`;
  assert.ok(rolling);
  await sql.begin((tx) => materializeCalendarTemplates(tx, new Date('2025-03-24T12:00:00Z')));
  const horizonDates = await sql`SELECT to_char(starts_at AT TIME ZONE 'Atlantic/Canary','YYYY-MM-DD') AS value FROM calendar_sessions WHERE template_id=${rolling.id} ORDER BY starts_at`;
  assert.equal(horizonDates.length, 13);
  assert.ok(horizonDates.every((row) => row.value >= '2025-03-24' && row.value < '2025-06-22'));
  await sql`UPDATE calendar_sessions SET status='cancelled' WHERE id=${initial[0].id}`;
  const overridden = await reception.inject({ method: 'PATCH', url: `/api/calendar/sessions/${initial[1].id}`, payload: { startsAt: '2025-03-31T09:45:00+01:00', capacity: 10 } });
  assert.equal(overridden.statusCode, 200, overridden.body);
  assert.equal(overridden.json().occurrenceOverridden, true);
  await sql.begin((tx) => materializeCalendarTemplates(tx, new Date('2025-03-24T12:00:00Z')));
  const after = await sql`SELECT id,status,capacity,starts_at AS "startsAt",to_char(template_occurrence_date,'YYYY-MM-DD') AS "occurrenceDate" FROM calendar_sessions WHERE template_id=${created.json().id} ORDER BY template_occurrence_date`;
  assert.equal(after.length, 3);
  assert.equal(after[0].status, 'cancelled');
  assert.equal(after[1].capacity, 10);
  assert.equal(new Date(after[1].startsAt).toISOString(), '2025-03-31T08:45:00.000Z');
  assert.equal(String(after[1].occurrenceDate).slice(0,10), '2025-03-31');
  assert.equal((await sql`SELECT count(*)::int AS total FROM calendar_audit_events WHERE session_id=${initial[1].id} AND action='session.occurrence_overridden'`).at(0).total, 1);
  const materialized = await sql.begin((tx) => materializeCalendarTemplates(tx, new Date('2025-03-24T12:00:00Z')));
  assert.equal(materialized.created, 0);
});

test('editing a recurring occurrence changes only that scheduled date and preserves its reservations', async () => {
  const service = await createService();
  const next = new Date(); next.setUTCHours(12,0,0,0); next.setUTCDate(next.getUTCDate() + 14 + ((1 - next.getUTCDay() + 7) % 7)); const startsOn = next.toISOString().slice(0,10); const weekday = next.getUTCDay();
  const [professional] = await sql`INSERT INTO staff_professionals(first_name,last_name,display_name,base_role,created_by) VALUES ('Recurrence','Trainer',${`Recurrence Trainer ${randomUUID()}`},'trainer','2J-080-test') RETURNING id`;
  assert.ok(professional);
  await sql`INSERT INTO staff_schedule_slots(professional_id,weekday,starts_at,ends_at,valid_from,created_by) VALUES (${professional.id},${weekday},'08:00','12:00',${startsOn},'2J-080-test')`;
  const template = await reception.inject({ method: 'POST', url: '/api/calendar/templates', payload: { serviceId: service.id, areaId: service.areaId, weekday, localStartTime: '09:00', durationMinutes: 60, capacity: 4, startsOn, endsOn: null } });
  assert.equal(template.statusCode, 201, template.body);
  const [rows] = await sql`SELECT id,starts_at AS "startsAt" FROM calendar_sessions WHERE template_id=${template.json().id} ORDER BY starts_at LIMIT 2`;
  assert.ok(rows);
  const bookingClients = await Promise.all([createClient('Occurrence edit booking'), createClient('Occurrence edit second')]);
  const booking = await reception.inject({ method: 'POST', url: `/api/calendar/sessions/${rows.id}/reservations`, payload: { clientId: bookingClients[0].id } });
  assert.equal(booking.statusCode, 201, booking.body);
  const secondBooking = await reception.inject({ method: 'POST', url: `/api/calendar/sessions/${rows.id}/reservations`, payload: { clientId: bookingClients[1].id } });
  assert.equal(secondBooking.statusCode, 201, secondBooking.body);
  const moved = new Date(rows.startsAt); moved.setUTCHours(moved.getUTCHours()+1);
  const edited = await reception.inject({ method: 'PATCH', url: `/api/calendar/sessions/${rows.id}`, payload: { startsAt: moved.toISOString(), durationMinutes: 60, capacity: 5, professionalId: professional.id } });
  assert.equal(edited.statusCode, 200, edited.body);
  assert.equal(edited.json().occurrenceOverridden, true);
  const [sibling] = await sql`SELECT starts_at AS "startsAt",duration_minutes AS "durationMinutes",capacity FROM calendar_sessions WHERE template_id=${template.json().id} AND id<>${rows.id} ORDER BY starts_at LIMIT 1`;
  assert.equal(sibling.durationMinutes, 60); assert.equal(sibling.capacity, 4);
  assert.equal((await sql`SELECT status FROM calendar_reservations WHERE id=${booking.json().id}`).at(0).status, 'reserved');
  assert.equal((await sql`SELECT session_id FROM calendar_reservations WHERE id=${booking.json().id}`).at(0).session_id, rows.id);
  assert.equal((await sql`SELECT count(*)::int AS total FROM calendar_reservations WHERE session_id=${rows.id} AND status='reserved'`).at(0).total, 2);
  assert.equal((await sql`SELECT local_start_time AS value FROM recurring_session_templates WHERE id=${template.json().id}`).at(0).value.slice(0,5), '09:00');
  const collisionStarts = new Date(moved.getTime()+60*60_000);
  const collision = await reception.inject({ method: 'POST', url: '/api/calendar/sessions', payload: { serviceId: service.id, areaId: service.areaId, startsAt: collisionStarts.toISOString(), durationMinutes: 30, capacity: 2, professionalId: professional.id } });
  assert.equal(collision.statusCode, 201, collision.body);
  const conflictEdit = await reception.inject({ method: 'PATCH', url: `/api/calendar/sessions/${rows.id}`, payload: { startsAt: new Date(collisionStarts.getTime()-30*60_000).toISOString() } });
  assert.equal(conflictEdit.statusCode, 409); assert.equal(conflictEdit.json().error, 'professional_session_conflict');
  const tooSmall = await reception.inject({ method: 'PATCH', url: `/api/calendar/sessions/${rows.id}`, payload: { capacity: 1 } });
  assert.equal(tooSmall.statusCode, 409); assert.equal(tooSmall.json().error, 'capacity_below_occupancy');
  assert.equal((await accountant.inject({ method: 'PATCH', url: `/api/calendar/sessions/${rows.id}`, payload: { capacity: 6 } })).statusCode, 403);
  assert.equal((await reception.inject({ method: 'PATCH', url: `/api/calendar/sessions/${rows.id}`, payload: { capacity: 0 } })).statusCode, 400);
  assert.ok((await sql`SELECT id FROM calendar_audit_events WHERE session_id=${rows.id} AND action='session.occurrence_overridden'`).length);
});

test('member session list refills recurring horizon idempotently and preserves cancelled occurrence identity', async () => {
  const service = await createService();
  const { client } = await createEntitledClient(service);
  const start = new Date(); start.setUTCDate(start.getUTCDate() + 14);
  const startsOn = canaryDate(start); const weekday = new Date(`${startsOn}T12:00:00Z`).getUTCDay();
  const [template] = await sql`INSERT INTO recurring_session_templates(service_id,area_id,weekday,local_start_time,duration_minutes,capacity,starts_on,created_by) VALUES (${service.id},${service.areaId},${weekday},'10:00',45,8,${startsOn},'2J-080-test') RETURNING id`;
  assert.ok(template);
  assert.equal((await sql`SELECT count(*)::int AS total FROM calendar_sessions WHERE template_id=${template.id}`).at(0).total, 0, 'fixture starts with an unmaterialized horizon');
  const member = buildServer(process.env.DATABASE_URL, { clientAuthorizationResolver: async () => ({ clientId: client.id }), bookingEligibilityResolver: eligible });
  try {
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 30);
    const url = `/api/me/sessions?from=${startsOn}&to=${canaryDate(end)}`;
    const firstRead = await member.inject({ method: 'GET', url });
    assert.equal(firstRead.statusCode, 200, firstRead.body);
    const visible = firstRead.json().sessions.filter((item) => item.serviceId === service.id);
    assert.ok(visible.length >= 2, 'newly materialized occurrences are visible to the member');
    const cancelled = visible[0];
    await sql`UPDATE calendar_sessions SET status='cancelled' WHERE id=${cancelled.id}`;
    const secondRead = await member.inject({ method: 'GET', url });
    assert.equal(secondRead.statusCode, 200, secondRead.body);
    assert.equal((await sql`SELECT status FROM calendar_sessions WHERE id=${cancelled.id}`).at(0).status, 'cancelled');
    const count = (await sql`SELECT count(*)::int AS total FROM calendar_sessions WHERE template_id=${template.id} AND template_occurrence_date=${canaryDate(new Date(cancelled.startsAt))}::date`).at(0).total;
    assert.equal(count, 1, 'repeated member reads do not duplicate occurrence identities');
    assert.ok(secondRead.json().sessions.some((item) => item.id === visible[1].id));
  } finally { await member.close(); }
});

test('single occurrence edits require an authorized, reasoned availability override and preserve siblings', async () => {
  const service = await createService();
  const start = new Date(); start.setUTCDate(start.getUTCDate() + 21);
  const startsOn = canaryDate(start); const weekday = new Date(`${startsOn}T12:00:00Z`).getUTCDay();
  const [professional] = await sql`INSERT INTO staff_professionals(first_name,last_name,display_name,base_role,created_by) VALUES ('Availability','Trainer',${`Availability Trainer ${randomUUID()}`},'trainer','2J-080-test') RETURNING id`;
  assert.ok(professional);
  await sql`INSERT INTO staff_schedule_slots(professional_id,weekday,starts_at,ends_at,valid_from,created_by) VALUES (${professional.id},${weekday},'08:00','12:00',${startsOn},'2J-080-test')`;
  const template = await reception.inject({ method: 'POST', url: '/api/calendar/templates', payload: { serviceId: service.id, areaId: service.areaId, professionalId: professional.id, weekday, localStartTime: '09:00', durationMinutes: 45, capacity: 4, startsOn, endsOn: startsOn } });
  assert.equal(template.statusCode, 201, template.body);
  const [session] = await sql`SELECT id,starts_at AS "startsAt" FROM calendar_sessions WHERE template_id=${template.json().id}`;
  assert.ok(session);
  const ordinary = await reception.inject({ method: 'PATCH', url: `/api/calendar/sessions/${session.id}`, payload: { capacity: 5 } });
  assert.equal(ordinary.statusCode, 200, ordinary.body);
  const outside = new Date(`${startsOn}T15:00:00Z`).toISOString();
  const warning = await admin.inject({ method: 'PATCH', url: `/api/calendar/sessions/${session.id}`, payload: { startsAt: outside } });
  assert.equal(warning.statusCode, 409); assert.equal(warning.json().error, 'professional_availability_confirmation_required');
  const missingReason = await admin.inject({ method: 'PATCH', url: `/api/calendar/sessions/${session.id}`, payload: { startsAt: outside, overrideAvailability: true } });
  assert.equal(missingReason.statusCode, 400);
  const unauthorized = await reception.inject({ method: 'PATCH', url: `/api/calendar/sessions/${session.id}`, payload: { startsAt: outside, overrideAvailability: true, availabilityReason: 'Cobertura extraordinaria' } });
  assert.equal(unauthorized.statusCode, 403); assert.equal(unauthorized.json().error, 'permission_denied');
  const approved = await admin.inject({ method: 'PATCH', url: `/api/calendar/sessions/${session.id}`, payload: { startsAt: outside, overrideAvailability: true, availabilityReason: 'Cobertura extraordinaria' } });
  assert.equal(approved.statusCode, 200, approved.body);
  const conflictStarts = new Date(`${startsOn}T16:00:00Z`).toISOString();
  const concrete = await admin.inject({ method: 'POST', url: '/api/calendar/sessions', payload: { serviceId: service.id, areaId: service.areaId, startsAt: conflictStarts, durationMinutes: 45, capacity: 2, professionalId: professional.id, overrideAvailability: true, availabilityReason: 'Cobertura extraordinaria' } });
  assert.equal(concrete.statusCode, 201, concrete.body);
  const conflict = await admin.inject({ method: 'PATCH', url: `/api/calendar/sessions/${session.id}`, payload: { startsAt: new Date(new Date(conflictStarts).getTime() + 15 * 60_000).toISOString(), overrideAvailability: true, availabilityReason: 'Cobertura extraordinaria' } });
  assert.equal(conflict.statusCode, 409); assert.equal(conflict.json().error, 'professional_session_conflict');
  assert.equal((await sql`SELECT local_start_time::text AS value FROM recurring_session_templates WHERE id=${template.json().id}`).at(0).value.slice(0,5), '09:00');
  assert.equal((await sql`SELECT count(*)::int AS total FROM calendar_sessions WHERE template_id=${template.json().id}`).at(0).total, 1);
  const audit = await sql`SELECT action,actor_id,details FROM calendar_audit_events WHERE session_id=${session.id} AND action IN ('session.occurrence_overridden','session.availability_override') ORDER BY action`;
  assert.equal(audit.filter((item) => item.action === 'session.availability_override').length, 1);
  assert.ok(audit.some((item) => item.action === 'session.occurrence_overridden'));
  assert.equal(audit.find((item) => item.action === 'session.availability_override').actor_id, 'calendar-admin');
  assert.equal(audit.find((item) => item.action === 'session.availability_override').details.reason, 'Cobertura extraordinaria');
});

test('2J-080 end-to-end: service, entitlement, rolling sessions, self booking, one-date edit, cancellation and replay safety', async () => {
  const service = await createService();
  const client = await createClient('2J-080 pilot member');
  const today = canaryDate();
  const planResponse = await engineAdmin.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': randomUUID() }, payload: {
    name: `2J-080 recurring access ${randomUUID()}`, serviceIds: [service.id], kind: 'session_pack', renewalCadence: null, basePriceCents: 1000,
    modules: [{ module: 'reservations', accessLevel: 'full', capabilities: [] }],
    rights: [{ rightType: 'service_access', serviceId: service.id }, { rightType: 'sessions_quota', serviceId: service.id, quotaScope: 'per_service', quantity: 5 }],
  } });
  assert.equal(planResponse.statusCode, 201, planResponse.body);
  assert.equal((await engineAdmin.inject({ method: 'POST', url: `/api/plans/${planResponse.json().id}/activate` })).statusCode, 200);
  const assigned = await engineAdmin.inject({ method: 'POST', url: `/api/clients/${client.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: { planId: planResponse.json().id, startsOn: today, dueOn: today, amountCents: 1000 } });
  assert.equal(assigned.statusCode, 201, assigned.body);
  const start = new Date(); start.setUTCDate(start.getUTCDate()+3); const startsOn = start.toISOString().slice(0,10); const weekday = start.getUTCDay();
  const template = await reception.inject({ method: 'POST', url: '/api/calendar/templates', payload: { serviceId: service.id, areaId: service.areaId, weekday, localStartTime: '10:00', durationMinutes: 45, capacity: 4, startsOn, endsOn: null } });
  assert.equal(template.statusCode, 201, template.body);
  const occurrences = await sql`SELECT id,starts_at AS "startsAt",status,capacity FROM calendar_sessions WHERE template_id=${template.json().id} ORDER BY starts_at`;
  assert.ok(occurrences.length >= 3);
  assert.ok(occurrences.every((item) => item.status === 'scheduled'));
  const member = buildServer(process.env.DATABASE_URL, { clientAuthorizationResolver: async () => ({ clientId: client.id }) });
  try {
    const rangeEnd = new Date(start); rangeEnd.setUTCDate(rangeEnd.getUTCDate()+28);
    const memberSessions = await member.inject({ method: 'GET', url: `/api/me/sessions?from=${startsOn}&to=${canaryDate(rangeEnd)}` });
    assert.equal(memberSessions.statusCode, 200, memberSessions.body);
    const first = occurrences[0]; const visible = memberSessions.json().sessions.find((item) => item.id === first.id);
    assert.ok(visible);
    const details = await member.inject({ method: 'GET', url: `/api/me/sessions/${first.id}` });
    assert.equal(details.statusCode, 200, details.body); assert.equal(details.json().session.eligible, true);
    const reservation = await member.inject({ method: 'POST', url: `/api/me/sessions/${first.id}/reservations`, headers: { 'idempotency-key': randomUUID() }, payload: {} });
    assert.equal(reservation.statusCode, 201, reservation.body);
    const consumed = await sql`SELECT quantity FROM client_entitlement_ledger WHERE external_reference LIKE ${`calendar_reservation:${reservation.json().id}%`}`;
    assert.equal(consumed.reduce((total, row) => total + Number(row.quantity), 0), -1);
    const moved = new Date(first.startsAt); moved.setTime(moved.getTime()+30*60_000);
    const edit = await reception.inject({ method: 'PATCH', url: `/api/calendar/sessions/${first.id}`, payload: { startsAt: moved.toISOString() } });
    assert.equal(edit.statusCode, 200, edit.body);
    assert.equal((await sql`SELECT session_id FROM calendar_reservations WHERE id=${reservation.json().id}`).at(0).session_id, first.id);
    const sibling = occurrences[1];
    const cancelled = await reception.inject({ method: 'PATCH', url: `/api/calendar/sessions/${sibling.id}/cancel` });
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    await sql.begin((tx) => materializeCalendarTemplates(tx));
    const sessionsAfter = await sql`SELECT id,status,starts_at AS "startsAt",to_char(template_occurrence_date,'YYYY-MM-DD') AS "occurrenceDate" FROM calendar_sessions WHERE template_id=${template.json().id} ORDER BY template_occurrence_date`;
    assert.equal(sessionsAfter.length, occurrences.length, 'editing an occurrence time must not create a replacement on its original date');
    assert.equal(sessionsAfter.find((item) => item.id === sibling.id).status, 'cancelled');
    assert.equal(sessionsAfter.find((item) => item.id === first.id).status, 'scheduled');
    assert.equal(new Date(sessionsAfter.find((item) => item.id === first.id).startsAt).toISOString(), moved.toISOString());
    assert.equal(Number((await sql`SELECT count(*)::int AS total FROM calendar_sessions WHERE template_id=${template.json().id} AND starts_at=(SELECT starts_at FROM calendar_sessions WHERE id=${sibling.id})`).at(0).total), 1);
    const nextAvailable = occurrences[2];
    const finalBooking = await member.inject({ method: 'POST', url: `/api/me/sessions/${nextAvailable.id}/reservations`, headers: { 'idempotency-key': randomUUID() }, payload: {} });
    assert.equal(finalBooking.statusCode, 201, finalBooking.body);
    assert.equal((await sql`SELECT count(*)::int AS total FROM calendar_audit_events WHERE session_id=${first.id} AND action='session.occurrence_overridden'`).at(0).total, 1);
  } finally { await member.close(); }
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
  const scheduledBeforeArchive = Number((await sql`SELECT count(*)::int AS total FROM calendar_sessions WHERE template_id=${template.json().id} AND status='scheduled'`).at(0).total);
  assert.ok(scheduledBeforeArchive > 0);
  const occurrences = await sql`SELECT id FROM calendar_sessions WHERE template_id=${template.json().id} AND status='scheduled'`;
  for (const occurrence of occurrences) await reception.inject({ method: 'PATCH', url: `/api/calendar/sessions/${occurrence.id}/cancel` });
  await sql.begin((tx) => materializeCalendarTemplates(tx));
  assert.equal(Number((await sql`SELECT count(*)::int AS total FROM calendar_sessions WHERE template_id=${template.json().id}`).at(0).total), scheduledBeforeArchive);
  assert.equal((await admin.inject({ method: 'PATCH', url: `/api/services/${service.id}/archive` })).statusCode, 200);
  const audit = await sql`SELECT actor_id,action FROM calendar_audit_events WHERE resource_id=${template.json().id} ORDER BY occurred_at,id`;
  assert.deepEqual(audit.map((row) => [row.actor_id,row.action]), [['calendar-reception','template.created'],['calendar-reception','template.archived']]);
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

test('central engine consumes one bonus session atomically, retries idempotently and restores on valid cancellation', async () => {
  const service=await createService();const session=await createSession({service,capacity:2});
  const {client,assignment,rightId}=await createEntitledClient(service,{rightType:'sessions_quota',quantity:1});
  const preview=await engineAdmin.inject({method:'GET',url:`/api/calendar/sessions/${session.id}/booking-eligibility?clientId=${client.id}`});
  assert.equal(preview.statusCode,200,preview.body);assert.equal(preview.json().allowed,true);assert.equal(preview.json().selectedEntitlement.availableBalance,1);
  const key=randomUUID();const payload={clientId:client.id};
  const first=await engineAdmin.inject({method:'POST',url:`/api/calendar/sessions/${session.id}/reservations`,headers:{'idempotency-key':key},payload});
  assert.equal(first.statusCode,201,first.body);assert.equal(first.json().entitlementAssignmentId,assignment.id);
  const replay=await engineAdmin.inject({method:'POST',url:`/api/calendar/sessions/${session.id}/reservations`,headers:{'idempotency-key':key},payload});
  assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().id,first.json().id);
  const [balance]=await sql`SELECT COALESCE(sum(quantity),0)::int AS value FROM client_entitlement_ledger WHERE assignment_id=${assignment.id} AND right_key=${rightId}::text`;
  assert.equal(balance.value,0);
  assert.equal((await sql`SELECT count(*)::int AS value FROM client_entitlement_ledger WHERE assignment_id=${assignment.id} AND right_key=${rightId}::text AND entry_type='consume'`).at(0).value,1);
  const cancelKey=randomUUID();const cancel=await engineAdmin.inject({method:'PATCH',url:`/api/calendar/reservations/${first.json().id}/cancel`,headers:{'idempotency-key':cancelKey}});
  assert.equal(cancel.statusCode,200,cancel.body);assert.equal(cancel.json().restored,true);
  const cancelReplay=await engineAdmin.inject({method:'PATCH',url:`/api/calendar/reservations/${first.json().id}/cancel`,headers:{'idempotency-key':cancelKey}});
  assert.equal(cancelReplay.statusCode,200,cancelReplay.body);
  const [restored]=await sql`SELECT COALESCE(sum(quantity),0)::int AS value FROM client_entitlement_ledger WHERE assignment_id=${assignment.id} AND right_key=${rightId}::text`;
  assert.equal(restored.value,1);
  const history=await sql`SELECT entry_type,quantity FROM client_entitlement_ledger WHERE assignment_id=${assignment.id} AND right_key=${rightId}::text ORDER BY occurred_at,id`;
  assert.deepEqual(history.map(row=>[row.entry_type,row.quantity]),[['grant',1],['consume',-1],['restore',1]]);
});

test('weekly quota locks the assignment so concurrent bookings cannot exceed the configured period limit', async () => {
  const service=await createService();const {client}=await createEntitledClient(service,{rightType:'period_quota',quantity:1,period:'week'});
  const monday=new Date();monday.setUTCHours(12,0,0,0);monday.setUTCDate(monday.getUTCDate()+((8-monday.getUTCDay())%7));
  const firstAt=new Date(monday.getTime()+24*60*60*1000).toISOString();const secondAt=new Date(monday.getTime()+48*60*60*1000).toISOString();
  const first=await createSession({service,startsAt:firstAt});const second=await createSession({service,startsAt:secondAt});
  const results=await Promise.all([first,second].map(session=>engineAdmin.inject({method:'POST',url:`/api/calendar/sessions/${session.id}/reservations`,headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id}})));
  assert.deepEqual(results.map(response=>response.statusCode).sort(),[201,409]);
  const blocked=results.find(response=>response.statusCode===409);assert.equal(blocked.json().error,'weekly_limit_reached');
  const [count]=await sql`SELECT count(*)::int AS value FROM calendar_reservations WHERE client_id=${client.id} AND status='reserved'`;
  assert.equal(count.value,1);
});

test('waitlist promotion re-evaluates the candidate and consumes only after promotion', async () => {
  const service=await createService();const session=await createSession({service,capacity:1});
  const booked=await createEntitledClient(service,{rightType:'sessions_quota',quantity:1});
  const waiting=await createEntitledClient(service,{rightType:'sessions_quota',quantity:1});
  const first=await engineAdmin.inject({method:'POST',url:`/api/calendar/sessions/${session.id}/reservations`,headers:{'idempotency-key':randomUUID()},payload:{clientId:booked.client.id}});assert.equal(first.statusCode,201,first.body);
  const joined=await engineAdmin.inject({method:'POST',url:`/api/calendar/sessions/${session.id}/waitlist`,headers:{'idempotency-key':randomUUID()},payload:{clientId:waiting.client.id}});assert.equal(joined.statusCode,201,joined.body);
  const [before]=await sql`SELECT COALESCE(sum(quantity),0)::int AS value FROM client_entitlement_ledger WHERE assignment_id=${waiting.assignment.id} AND right_key=${waiting.rightId}::text`;
  assert.equal(before.value,1,'waitlist entry does not consume the bonus');
  const cancelled=await engineAdmin.inject({method:'PATCH',url:`/api/calendar/reservations/${first.json().id}/cancel`,headers:{'idempotency-key':randomUUID()}});assert.equal(cancelled.statusCode,200,cancelled.body);
  assert.equal(cancelled.json().promotedReservationIds.length,1);
  const [after]=await sql`SELECT COALESCE(sum(quantity),0)::int AS value FROM client_entitlement_ledger WHERE assignment_id=${waiting.assignment.id} AND right_key=${waiting.rightId}::text`;
  assert.equal(after.value,0,'promotion atomically consumes one session');
  const entry=(await sql`SELECT status,promoted_reservation_id FROM calendar_waitlist_entries WHERE id=${joined.json().id}`).at(0);
  assert.equal(entry.status,'promoted');assert.equal(entry.promoted_reservation_id,cancelled.json().promotedReservationIds[0]);
});

test('first-use validity begins on the first actual booking and then expires by Canary local date', async () => {
  const service=await createService();const {client}=await createEntitledClient(service,{rightType:'sessions_quota',quantity:3,validDays:1,validDaysStartRule:'first_use'});
  const first=await createSession({service,startsAt:new Date(Date.now()+3*86400000).toISOString()});
  const second=await createSession({service,startsAt:new Date(Date.now()+6*86400000).toISOString()});
  const firstBooking=await engineAdmin.inject({method:'POST',url:`/api/calendar/sessions/${first.id}/reservations`,headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id}});
  assert.equal(firstBooking.statusCode,201,firstBooking.body);
  const expired=await engineAdmin.inject({method:'POST',url:`/api/calendar/sessions/${second.id}/reservations`,headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id}});
  assert.equal(expired.statusCode,409);assert.equal(expired.json().error,'entitlement_expired');
});

test('concurrent bookings cannot spend the last session-pack credit twice', async () => {
  const service=await createService();const {client,assignment,rightId}=await createEntitledClient(service,{rightType:'sessions_quota',quantity:1});
  const [first,second]=await Promise.all([createSession({service,startsAt:new Date(Date.now()+86400000).toISOString()}),createSession({service,startsAt:new Date(Date.now()+2*86400000).toISOString()})]);
  const results=await Promise.all([first,second].map(session=>engineAdmin.inject({method:'POST',url:`/api/calendar/sessions/${session.id}/reservations`,headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id}})));
  assert.deepEqual(results.map(result=>result.statusCode).sort(),[201,409]);
  assert.equal(results.find(result=>result.statusCode===409).json().error,'entitlement_exhausted');
  const [totals]=await sql`SELECT COALESCE(sum(quantity),0)::int AS balance,count(*) FILTER(WHERE entry_type='consume')::int AS consumed FROM client_entitlement_ledger WHERE assignment_id=${assignment.id} AND right_key=${rightId}::text`;
  assert.equal(totals.balance,0);assert.equal(totals.consumed,1);
});
