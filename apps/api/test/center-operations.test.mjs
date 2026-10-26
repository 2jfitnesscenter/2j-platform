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
