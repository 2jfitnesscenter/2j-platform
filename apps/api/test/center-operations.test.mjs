import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: center operations tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 6, connect_timeout: 5 });
await migrateDatabase(sql);
const owner = buildServer(process.env.DATABASE_URL, { ownerActorId: 'a45-owner-test', authorizationResolver: async () => ({ actorId: 'a45-owner-test', role: 'admin' }) });
const admin = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'a45-nonowner-admin', role: 'admin' }) });
const anonymous = buildServer(process.env.DATABASE_URL);
after(async () => { await Promise.all([owner.close(), admin.close(), anonymous.close()]); await sql.end(); });

test('center hours, owner-assigned shifts and staffing gaps are owner-only and audited', async () => {
  const localDate = new Date(Date.now() + (50 + Math.floor(Math.random() * 1000)) * 86_400_000).toISOString().slice(0, 10);
  const weekday = new Date(`${localDate}T00:00:00Z`).getUTCDay();
  assert.equal((await anonymous.inject({ method: 'GET', url: '/api/center/opening-hours' })).statusCode, 401);
  assert.equal((await admin.inject({ method: 'GET', url: '/api/center/opening-hours' })).statusCode, 403, 'Admin wildcard does not imply owner capabilities');
  assert.equal((await admin.inject({ method: 'GET', url: '/api/center/coverage?date=2026-10-26' })).statusCode, 403);

  const badHours = await owner.inject({ method: 'POST', url: '/api/center/opening-hours', payload: { effectiveFrom: localDate, intervals: [
    { weekday, opensAt: '09:00', closesAt: '12:00' }, { weekday, opensAt: '11:30', closesAt: '17:00' },
  ] } });
  assert.equal(badHours.statusCode, 400, badHours.body);

  const hours = await owner.inject({ method: 'POST', url: '/api/center/opening-hours', payload: { effectiveFrom: localDate, intervals: [
    { weekday, opensAt: '09:00', closesAt: '17:00' },
  ] } });
  assert.equal(hours.statusCode, 201, hours.body);
  assert.equal(hours.json().timezone, 'Atlantic/Canary');
  assert.equal(hours.json().intervals.length, 1);

  const staff = await owner.inject({ method: 'POST', url: '/api/staff', payload: {
    firstName: 'A45', lastName: `Test ${randomUUID().slice(0, 8)}`, displayName: `A45 Test ${randomUUID().slice(0, 8)}`, baseRole: 'trainer',
  } });
  assert.equal(staff.statusCode, 201, staff.body);
  const shift = await owner.inject({ method: 'POST', url: '/api/center/shifts', payload: {
    professionalId: staff.json().id, localDate, startsAt: '09:00', endsAt: '13:00',
  } });
  assert.equal(shift.statusCode, 201, shift.body);
  assert.equal(shift.json().localDate, localDate);

  const deactivateWithFutureShift = await owner.inject({ method: 'PATCH', url: `/api/staff/${staff.json().id}/status`, payload: { status: 'inactive' } });
  assert.equal(deactivateWithFutureShift.statusCode, 409, deactivateWithFutureShift.body);
  assert.equal(deactivateWithFutureShift.json().error, 'future_calendar_items_exist');
  const archiveWithFutureShift = await owner.inject({ method: 'PATCH', url: `/api/staff/${staff.json().id}/archive` });
  assert.equal(archiveWithFutureShift.statusCode, 409, archiveWithFutureShift.body);
  assert.equal(archiveWithFutureShift.json().error, 'future_calendar_items_exist');

  const overlap = await owner.inject({ method: 'POST', url: '/api/center/shifts', payload: {
    professionalId: staff.json().id, localDate, startsAt: '12:30', endsAt: '15:00',
  } });
  assert.equal(overlap.statusCode, 409, overlap.body);

  const coverage = await owner.inject({ method: 'GET', url: `/api/center/coverage?date=${localDate}` });
  assert.equal(coverage.statusCode, 200, coverage.body);
  assert.deepEqual(coverage.json().staffingGaps, [{ startsAt: new Date(shift.json().endsAt).toISOString(), endsAt: coverage.json().openingIntervals[0].endsAt }]);
  assert.equal(coverage.json().cashCustody.status, 'incomplete');
  assert.match(coverage.json().cashCustody.reason, /traspasos/);

  const listed = await owner.inject({ method: 'GET', url: `/api/center/shifts?from=${localDate}&to=${localDate}` });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(listed.json().shifts.length, 1);
  const cancelled = await owner.inject({ method: 'PATCH', url: `/api/center/shifts/${shift.json().id}/cancel` });
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  assert.equal(cancelled.json().status, 'cancelled');
  const deactivateAfterCancellingShift = await owner.inject({ method: 'PATCH', url: `/api/staff/${staff.json().id}/status`, payload: { status: 'inactive' } });
  assert.equal(deactivateAfterCancellingShift.statusCode, 200, deactivateAfterCancellingShift.body);
  assert.equal(deactivateAfterCancellingShift.json().status, 'inactive');
  const coverageAfterDeactivation = await owner.inject({ method: 'GET', url: `/api/center/coverage?date=${localDate}` });
  assert.equal(coverageAfterDeactivation.statusCode, 200, coverageAfterDeactivation.body);
  assert.equal(coverageAfterDeactivation.json().assignedShifts.length, 0, 'inactive professionals must not count toward assigned coverage');

  const revisedHours = await owner.inject({ method: 'POST', url: '/api/center/opening-hours', payload: { effectiveFrom: localDate, intervals: [
    { weekday, opensAt: '09:00', closesAt: '18:00' },
  ] } });
  assert.equal(revisedHours.statusCode, 201, revisedHours.body);

  const audit = await sql`SELECT action,details FROM staff_audit_events WHERE resource_type IN ('staff_shift_assignment','center_opening_hours') AND actor_id='a45-owner-test' ORDER BY occurred_at,id`;
  assert.ok(audit.some(row => row.action === 'staff.shift.created'));
  assert.ok(audit.some(row => row.action === 'staff.shift.cancelled'));
  assert.ok(audit.some(row => row.action === 'center.hours.created'));
  assert.ok(audit.some(row => row.action === 'center.hours.replaced' && row.details.before && row.details.after), 'opening-hours change keeps both audit snapshots');
});

test('only the configured owner actor gets explicit owner-only A45 capabilities', async () => {
  const contexts = await Promise.all([
    owner.inject({ method: 'GET', url: '/api/center/shifts?from=2026-10-26&to=2026-10-26' }),
    admin.inject({ method: 'GET', url: '/api/center/shifts?from=2026-10-26&to=2026-10-26' }),
  ]);
  assert.equal(contexts[0].statusCode, 200);
  assert.equal(contexts[1].statusCode, 403);
});

test('editing a selected opening-hours period preserves every future effective period', async () => {
  const dateAt = offset => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  // Place this fixture after existing schedules so repeated runs against a reused synthetic DB stay isolated.
  const [{ latestEffectiveFrom }] = await sql`SELECT max(valid_from)::text AS "latestEffectiveFrom" FROM center_opening_hours`;
  const daysUntilLatest = latestEffectiveFrom ? Math.ceil((Date.parse(`${latestEffectiveFrom}T00:00:00Z`) - Date.now()) / 86_400_000) : 0;
  const offset = Math.max(10_000, daysUntilLatest + 2);
  const effectiveFrom = dateAt(offset);
  const futureFrom = dateAt(offset + 10);
  const weekday = new Date(`${effectiveFrom}T00:00:00Z`).getUTCDay();
  const futureWeekday = new Date(`${futureFrom}T00:00:00Z`).getUTCDay();
  assert.ok(futureFrom > effectiveFrom);

  const initial = await owner.inject({ method: 'POST', url: '/api/center/opening-hours', payload: { effectiveFrom, intervals: [
    { weekday, opensAt: '09:00', closesAt: '17:00' },
  ] } });
  assert.equal(initial.statusCode, 201, initial.body);
  const future = await owner.inject({ method: 'POST', url: '/api/center/opening-hours', payload: { effectiveFrom: futureFrom, intervals: [
    { weekday: futureWeekday, opensAt: '10:00', closesAt: '18:00' },
  ] } });
  assert.equal(future.statusCode, 201, future.body);
  assert.equal(future.json().intervals[0].validUntil, null);

  const revised = await owner.inject({ method: 'POST', url: '/api/center/opening-hours', payload: { effectiveFrom, intervals: [
    { weekday, opensAt: '08:00', closesAt: '19:00' },
  ] } });
  assert.equal(revised.statusCode, 201, revised.body);
  assert.equal(revised.json().intervals[0].validUntil, new Date(Date.parse(`${futureFrom}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10));

  const currentAtStart = await owner.inject({ method: 'GET', url: `/api/center/opening-hours?date=${effectiveFrom}` });
  assert.equal(currentAtStart.statusCode, 200, currentAtStart.body);
  assert.equal(currentAtStart.json().intervals.length, 1);
  assert.equal(currentAtStart.json().intervals[0].opensAt, '08:00');
  assert.equal(currentAtStart.json().intervals[0].closesAt, '19:00');
  const roundTrip = await owner.inject({ method: 'POST', url: '/api/center/opening-hours', payload: { effectiveFrom, intervals: currentAtStart.json().intervals.map(({ weekday, opensAt, closesAt }) => ({ weekday, opensAt, closesAt })) } });
  assert.equal(roundTrip.statusCode, 201, roundTrip.body);
  const futureAtStart = await owner.inject({ method: 'GET', url: `/api/center/opening-hours?date=${futureFrom}` });
  assert.equal(futureAtStart.statusCode, 200, futureAtStart.body);
  assert.equal(futureAtStart.json().effectiveOn, futureFrom);
  assert.equal(futureAtStart.json().intervals.length, 1);
  assert.equal(futureAtStart.json().intervals[0].opensAt, '10:00');
  assert.equal(futureAtStart.json().intervals[0].validFrom, futureFrom);
});

test('concurrent overlapping shift requests serialize and only one assignment is created', async () => {
  const localDate = new Date(Date.now() + (1200 + Math.floor(Math.random() * 1000)) * 86_400_000).toISOString().slice(0, 10);
  const staff = await owner.inject({ method: 'POST', url: '/api/staff', payload: {
    firstName: 'A45', lastName: `Concurrent ${randomUUID().slice(0, 8)}`, displayName: `A45 Concurrent ${randomUUID().slice(0, 8)}`, baseRole: 'trainer',
  } });
  assert.equal(staff.statusCode, 201, staff.body);

  let markLocked;
  const acquired = new Promise(resolve => { markLocked = resolve; });
  let unblock;
  const gate = new Promise(resolve => { unblock = resolve; });
  const lockProfessional = sql.begin(async tx => {
    await tx`SELECT id FROM staff_professionals WHERE id=${staff.json().id} FOR UPDATE`;
    markLocked();
    await gate;
  });
  await acquired;

  const makeShift = (startsAt, endsAt) => owner.inject({ method: 'POST', url: '/api/center/shifts', payload: {
    professionalId: staff.json().id, localDate, startsAt, endsAt,
  } });
  const requests = [makeShift('09:00', '13:00'), makeShift('10:00', '14:00')];
  let blocked = 0;
  try {
    for (let attempt = 0; attempt < 200 && blocked < 2; attempt += 1) {
      const [row] = await sql`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%staff_professionals%'`;
      blocked = row?.count ?? 0;
      if (blocked < 2) await new Promise(resolve => setTimeout(resolve, 5));
    }
  } finally {
    unblock();
  }

  const responses = await Promise.all(requests);
  await lockProfessional;
  assert.equal(blocked, 2, 'both API transactions must be waiting on the professional row lock before release');
  assert.deepEqual(responses.map(response => response.statusCode).sort(), [201, 409]);
  const [rows] = await sql`SELECT count(*)::int AS count FROM staff_shift_assignments WHERE professional_id=${staff.json().id} AND local_date=${localDate}::date AND status='scheduled'`;
  assert.equal(rows?.count, 1);
});
