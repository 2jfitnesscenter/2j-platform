import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { seedDemoData } from '../scripts/seed-demo.ts';
import { createBookingEligibilityResolver } from '../src/booking-eligibility.ts';
import { dispatchNotificationBatch } from '../src/notifications.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: member pilot seed tests require PostgreSQL.');
process.env.NODE_ENV = 'test';
const sql = postgres(process.env.DATABASE_URL, { max: 8, connect_timeout: 5 });
await migrateDatabase(sql);
const origin = 'http://127.0.0.1:5173';
const app = buildServer(process.env.DATABASE_URL, { logger: false, memberPilotAuthEnabled: true, memberPilotBookingEnabled: true, memberAppOrigin: origin, bookingEligibilityResolver: createBookingEligibilityResolver() });
const staffAdmin = buildServer(process.env.DATABASE_URL, { logger: false, authorizationResolver: async () => ({ actorId: 'member-seed-test-admin', role: 'admin' }) });
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const dateKey = days => new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + days * 86_400_000));
after(async () => { await Promise.all([app.close(), staffAdmin.close()]); await sql.end(); });

test('deterministic demo seed is repeatable and provisions distinct member identities and only member A rights', async () => {
  await seedDemoData(sql);
  await seedDemoData(sql);
  const rows = await sql`SELECT p.id AS "personId",f.client_id AS "clientId",s.auth_subject AS "authSubject",s.status AS "subjectStatus",c.code_hash AS "codeHash",c.status AS "credentialStatus"
    FROM platform_persons p JOIN platform_person_clients f ON f.person_id=p.id
    JOIN platform_person_auth_subjects s ON s.person_id=p.id AND s.provider='platform-pilot'
    JOIN platform_member_pilot_credentials c ON c.auth_subject_link_id=s.id
    WHERE p.id IN ('d0840000-0000-4000-8000-000000000001','d0840000-0000-4000-8000-000000000002') ORDER BY p.id`;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].clientId, 'd0700000-0000-4000-8000-000000000001');
  assert.equal(rows[1].clientId, 'd0700000-0000-4000-8000-000000000002');
  assert.equal(rows[0].authSubject, 'member-a'); assert.equal(rows[1].authSubject, 'member-b');
  assert.equal(rows.every(row => row.subjectStatus === 'active' && row.credentialStatus === 'active'), true);
  assert.equal(rows[0].codeHash, hash('2j-member-a-local')); assert.equal(rows[1].codeHash, hash('2j-member-b-local'));
  const assignment = await sql`SELECT a.client_id AS "clientId",a.status,v.frozen_at AS "frozenAt",p.status AS "planStatus",l.quantity
    FROM client_plan_assignments a JOIN plans p ON p.id=a.plan_id JOIN plan_versions v ON v.plan_id=a.plan_id AND v.version=a.plan_version
    JOIN client_entitlement_ledger l ON l.assignment_id=a.id
    WHERE a.id='d0840000-0000-4000-8000-000000000105'::uuid AND l.right_key='d0840000-0000-4000-8000-000000000103'`;
  assert.equal(assignment.length, 1); assert.equal(assignment[0].clientId, rows[0].clientId); assert.equal(assignment[0].status, 'active');
  assert.equal(assignment[0].planStatus, 'active'); assert.ok(assignment[0].frozenAt); assert.equal(assignment[0].quantity, 12);
  assert.equal((await sql`SELECT count(*)::int AS count FROM client_plan_assignments WHERE client_id=${rows[1].clientId}`)[0].count, 0);
  assert.equal((await sql`SELECT count(*)::int AS count FROM calendar_sessions WHERE id='d0840000-0000-4000-8000-000000000112'::uuid AND status='scheduled'`)[0].count, 1);
  const cohorts = await sql`SELECT person_id,status FROM platform_member_booking_pilot_cohort WHERE person_id IN ('d0840000-0000-4000-8000-000000000001','d0840000-0000-4000-8000-000000000002') ORDER BY person_id`;
  assert.equal(cohorts.length, 1); assert.equal(cohorts[0].person_id, 'd0840000-0000-4000-8000-000000000001'); assert.equal(cohorts[0].status, 'active');
  assert.equal((await sql`SELECT count(*)::int AS count FROM calendar_reservations WHERE id='d0840000-0000-4000-8000-000000000114'::uuid AND client_id=${rows[1].clientId} AND status='reserved'`)[0].count, 1);

  const loginA = await app.inject({ method: 'POST', url: '/api/pilot/member/login', headers: { origin, 'content-type': 'application/json' }, payload: { code: '2j-member-a-local' } });
  assert.equal(loginA.statusCode, 200, loginA.body); const cookieA = loginA.headers['set-cookie'].split(';')[0];
  const sessionsA = await app.inject({ method: 'GET', url: `/api/me/sessions?from=${dateKey(0)}&to=${dateKey(7)}`, headers: { cookie: cookieA } });
  assert.equal(sessionsA.statusCode, 200, sessionsA.body);
  const eligibleA = sessionsA.json().sessions.find(session => session.id === 'd0840000-0000-4000-8000-000000000112');
  assert.ok(eligibleA);
  const detailA = await app.inject({ method: 'GET', url: `/api/me/sessions/${eligibleA.id}`, headers: { cookie: cookieA } });
  assert.equal(detailA.statusCode, 200, detailA.body); assert.equal(detailA.json().session.eligible, true);
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/me/booking-access', headers: { cookie: cookieA } })).json(), { enabled: true });
  const quota = async () => Number((await sql`SELECT COALESCE(sum(quantity),0)::int AS balance FROM client_entitlement_ledger WHERE assignment_id='d0840000-0000-4000-8000-000000000105'::uuid AND right_key='d0840000-0000-4000-8000-000000000103'`)[0].balance);
  const initialQuota = await quota();
  const reserveKey = randomUUID();
  const occupancyBefore = Number((await sql`SELECT count(*)::int AS count FROM calendar_reservations WHERE session_id=${eligibleA.id} AND status='reserved'`)[0].count);
  const reservation = await app.inject({ method: 'POST', url: `/api/me/sessions/${eligibleA.id}/reservations`, headers: { cookie: cookieA, origin, 'idempotency-key': reserveKey }, payload: {} });
  assert.equal(reservation.statusCode, 201, reservation.body);
  const replay = await app.inject({ method: 'POST', url: `/api/me/sessions/${eligibleA.id}/reservations`, headers: { cookie: cookieA, origin, 'idempotency-key': reserveKey }, payload: {} });
  assert.equal(replay.statusCode, 200, replay.body); assert.equal(replay.json().id, reservation.json().id);
  assert.equal(await quota(), initialQuota - 1);
  assert.equal(Number((await sql`SELECT count(*)::int AS count FROM calendar_reservations WHERE session_id=${eligibleA.id} AND status='reserved'`)[0].count), occupancyBefore + 1);
  assert.equal((await sql`SELECT count(*)::int AS count FROM calendar_reservations WHERE session_id=${eligibleA.id} AND client_id=${rows[0].clientId} AND status='reserved'`)[0].count, 1);
  await dispatchNotificationBatch(sql);
  assert.equal((await sql`SELECT count(*)::int AS count FROM notifications WHERE recipient_kind='client' AND recipient_id=${rows[0].clientId} AND dedupe_key=${`booking-confirmed:${reservation.json().id}`}`)[0].count, 1);
  const cancelKey = randomUUID();
  const cancelled = await app.inject({ method: 'PATCH', url: `/api/me/bookings/${reservation.json().id}/cancel`, headers: { cookie: cookieA, origin, 'idempotency-key': cancelKey }, payload: {} });
  assert.equal(cancelled.statusCode, 200, cancelled.body); assert.equal(await quota(), initialQuota);
  assert.equal(Number((await sql`SELECT count(*)::int AS count FROM calendar_reservations WHERE session_id=${eligibleA.id} AND status='reserved'`)[0].count), occupancyBefore);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/me/bookings/${reservation.json().id}/cancel`, headers: { cookie: cookieA, origin, 'idempotency-key': cancelKey }, payload: {} })).statusCode, 200, 'cancel retry is safely replayed');
  await dispatchNotificationBatch(sql);
  assert.equal((await sql`SELECT count(*)::int AS count FROM notifications WHERE recipient_kind='client' AND recipient_id=${rows[0].clientId} AND dedupe_key=${`booking-cancelled:${reservation.json().id}`}`)[0].count, 1);
  assert.ok((await sql`SELECT id FROM calendar_audit_events WHERE resource_id=${reservation.json().id} AND action='reservation.cancelled'`).length > 0);
  assert.equal((await app.inject({ method: 'GET', url: '/api/me/bookings', headers: { cookie: cookieA } })).statusCode, 200);
  const full = await app.inject({ method: 'GET', url: '/api/me/sessions/d0840000-0000-4000-8000-000000000113', headers: { cookie: cookieA } });
  assert.equal(full.statusCode, 200, full.body); assert.equal(full.json().session.canJoinWaitlist, true);
  const waitKey = randomUUID();
  const joined = await app.inject({ method: 'POST', url: '/api/me/sessions/d0840000-0000-4000-8000-000000000113/waitlist', headers: { cookie: cookieA, origin, 'idempotency-key': waitKey }, payload: {} });
  assert.equal(joined.statusCode, 201, joined.body);
  const joinedReplay = await app.inject({ method: 'POST', url: '/api/me/sessions/d0840000-0000-4000-8000-000000000113/waitlist', headers: { cookie: cookieA, origin, 'idempotency-key': waitKey }, payload: {} });
  assert.equal(joinedReplay.statusCode, 200, joinedReplay.body); assert.equal(joinedReplay.json().id, joined.json().id);
  const entries = await app.inject({ method: 'GET', url: '/api/me/bookings', headers: { cookie: cookieA } });
  assert.ok(entries.json().waitlist.some(entry => entry.id === joined.json().id && entry.status === 'waiting'));
  const leaveKey = randomUUID();
  const leave = await app.inject({ method: 'PATCH', url: `/api/me/waitlist/${joined.json().id}/cancel`, headers: { cookie: cookieA, origin, 'idempotency-key': leaveKey }, payload: {} });
  assert.equal(leave.statusCode, 200, leave.body);
  const leaveReplay = await app.inject({ method: 'PATCH', url: `/api/me/waitlist/${joined.json().id}/cancel`, headers: { cookie: cookieA, origin, 'idempotency-key': leaveKey }, payload: {} });
  assert.equal(leaveReplay.statusCode, 200, 'a repeated leave request is safely replayed');
  const joinedForPromotion = await app.inject({ method: 'POST', url: '/api/me/sessions/d0840000-0000-4000-8000-000000000113/waitlist', headers: { cookie: cookieA, origin, 'idempotency-key': randomUUID() }, payload: {} });
  assert.equal(joinedForPromotion.statusCode, 201, joinedForPromotion.body);
  const seedReservationId = 'd0840000-0000-4000-8000-000000000114';
  const crossMemberCancel = await app.inject({ method: 'PATCH', url: `/api/me/bookings/${seedReservationId}/cancel`, headers: { cookie: cookieA, origin, 'idempotency-key': randomUUID() }, payload: {} });
  assert.equal(crossMemberCancel.statusCode, 404, 'a cohort member cannot cancel another member’s reservation');
  const memberBWaitlist = (await sql`INSERT INTO calendar_waitlist_entries(session_id,client_id,entitlement_reference,created_by) VALUES ('d0840000-0000-4000-8000-000000000113'::uuid,${rows[1].clientId},'synthetic-local-pilot','member-b-seed') RETURNING id`)[0];
  const crossMemberLeave = await app.inject({ method: 'PATCH', url: `/api/me/waitlist/${memberBWaitlist.id}/cancel`, headers: { cookie: cookieA, origin, 'idempotency-key': randomUUID() }, payload: {} });
  assert.equal(crossMemberLeave.statusCode, 404, 'a cohort member cannot leave another member’s waitlist entry');
  assert.equal((await sql`SELECT status FROM calendar_waitlist_entries WHERE id=${memberBWaitlist.id}`)[0].status, 'waiting');
  assert.equal((await staffAdmin.inject({ method: 'PATCH', url: `/api/calendar/reservations/${seedReservationId}/cancel`, payload: {} })).statusCode, 200);
  const promoted = await sql`SELECT status FROM calendar_waitlist_entries WHERE id=${joinedForPromotion.json().id}`;
  assert.equal(promoted[0].status, 'promoted');
  assert.equal((await quota()), initialQuota - 1);
  await dispatchNotificationBatch(sql);
  assert.equal((await sql`SELECT count(*)::int AS count FROM notifications WHERE recipient_kind='client' AND recipient_id=${rows[0].clientId} AND type='waitlist_promoted'`)[0].count, 1);
  const [pilotService] = await sql`SELECT service_id AS "serviceId",area_id AS "areaId" FROM calendar_sessions WHERE id=${eligibleA.id}`;
  const [policy] = await sql`SELECT cancellation_window_minutes AS "windowMinutes",late_cancellation_policy AS "latePolicy" FROM services WHERE id=${pilotService.serviceId}`;
  const lateSession = (await sql`INSERT INTO calendar_sessions(service_id,area_id,starts_at,duration_minutes,capacity,created_by) VALUES (${pilotService.serviceId},${pilotService.areaId},${new Date(Date.now()+2*86_400_000).toISOString()},45,2,'member-seed-late-test') RETURNING id`)[0];
  await sql`UPDATE services SET cancellation_window_minutes=10080,late_cancellation_policy='consume' WHERE id=${pilotService.serviceId}`;
  try {
    const beforeLateQuota = await quota();
    const lateBooking = await app.inject({ method: 'POST', url: `/api/me/sessions/${lateSession.id}/reservations`, headers: { cookie: cookieA, origin, 'idempotency-key': randomUUID() }, payload: {} });
    assert.equal(lateBooking.statusCode, 201, lateBooking.body);
    const latePreview = await app.inject({ method: 'GET', url: `/api/me/bookings/${lateBooking.json().id}/cancellation-preview`, headers: { cookie: cookieA } });
    assert.equal(latePreview.statusCode, 200); assert.equal(latePreview.json().cancellation.late, true); assert.equal(latePreview.json().cancellation.restoresEntitlement, false);
    const lateCancel = await app.inject({ method: 'PATCH', url: `/api/me/bookings/${lateBooking.json().id}/cancel`, headers: { cookie: cookieA, origin, 'idempotency-key': randomUUID() }, payload: {} });
    assert.equal(lateCancel.statusCode, 200, lateCancel.body); assert.equal(await quota(), beforeLateQuota - 1);
  } finally {
    await sql`UPDATE services SET cancellation_window_minutes=${policy.windowMinutes},late_cancellation_policy=${policy.latePolicy} WHERE id=${pilotService.serviceId}`;
  }
  const loginB = await app.inject({ method: 'POST', url: '/api/pilot/member/login', headers: { origin, 'content-type': 'application/json' }, payload: { code: '2j-member-b-local' } });
  assert.equal(loginB.statusCode, 200, loginB.body); const cookieB = loginB.headers['set-cookie'].split(';')[0];
  const detailB = await app.inject({ method: 'GET', url: `/api/me/sessions/${eligibleA.id}`, headers: { cookie: cookieB } });
  assert.equal(detailB.statusCode, 200, detailB.body); assert.notEqual(detailB.json().session.eligible, true);
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/me/booking-access', headers: { cookie: cookieB } })).json(), { enabled: false });
  const blocked = await app.inject({ method: 'POST', url: `/api/me/sessions/${eligibleA.id}/reservations`, headers: { cookie: cookieB, origin, 'idempotency-key': randomUUID() }, payload: {} });
  assert.equal(blocked.statusCode, 403); assert.equal(blocked.json().error, 'member_pilot_action_not_enabled');
});
