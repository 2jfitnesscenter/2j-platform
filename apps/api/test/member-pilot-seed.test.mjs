import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { seedDemoData } from '../scripts/seed-demo.ts';
import { createBookingEligibilityResolver } from '../src/booking-eligibility.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: member pilot seed tests require PostgreSQL.');
process.env.NODE_ENV = 'test';
const sql = postgres(process.env.DATABASE_URL, { max: 8, connect_timeout: 5 });
await migrateDatabase(sql);
const origin = 'http://127.0.0.1:5173';
const app = buildServer(process.env.DATABASE_URL, { logger: false, memberPilotAuthEnabled: true, memberAppOrigin: origin, bookingEligibilityResolver: createBookingEligibilityResolver() });
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const dateKey = days => new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + days * 86_400_000));
after(async () => { await app.close(); await sql.end(); });

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
    WHERE a.id='d0840000-0000-4000-8000-000000000105'::uuid`;
  assert.equal(assignment.length, 1); assert.equal(assignment[0].clientId, rows[0].clientId); assert.equal(assignment[0].status, 'active');
  assert.equal(assignment[0].planStatus, 'active'); assert.ok(assignment[0].frozenAt); assert.equal(assignment[0].quantity, 12);
  assert.equal((await sql`SELECT count(*)::int AS count FROM client_plan_assignments WHERE client_id=${rows[1].clientId}`)[0].count, 0);
  assert.equal((await sql`SELECT count(*)::int AS count FROM calendar_sessions WHERE id='d0840000-0000-4000-8000-000000000112'::uuid AND status='scheduled'`)[0].count, 1);

  const loginA = await app.inject({ method: 'POST', url: '/api/pilot/member/login', headers: { origin, 'content-type': 'application/json' }, payload: { code: '2j-member-a-local' } });
  assert.equal(loginA.statusCode, 200, loginA.body); const cookieA = loginA.headers['set-cookie'].split(';')[0];
  const sessionsA = await app.inject({ method: 'GET', url: `/api/me/sessions?from=${dateKey(0)}&to=${dateKey(7)}`, headers: { cookie: cookieA } });
  assert.equal(sessionsA.statusCode, 200, sessionsA.body);
  const eligibleA = sessionsA.json().sessions.find(session => session.id === 'd0840000-0000-4000-8000-000000000112');
  assert.ok(eligibleA);
  const detailA = await app.inject({ method: 'GET', url: `/api/me/sessions/${eligibleA.id}`, headers: { cookie: cookieA } });
  assert.equal(detailA.statusCode, 200, detailA.body); assert.equal(detailA.json().session.eligible, true);
  const loginB = await app.inject({ method: 'POST', url: '/api/pilot/member/login', headers: { origin, 'content-type': 'application/json' }, payload: { code: '2j-member-b-local' } });
  assert.equal(loginB.statusCode, 200, loginB.body); const cookieB = loginB.headers['set-cookie'].split(';')[0];
  const detailB = await app.inject({ method: 'GET', url: `/api/me/sessions/${eligibleA.id}`, headers: { cookie: cookieB } });
  assert.equal(detailB.statusCode, 200, detailB.body); assert.notEqual(detailB.json().session.eligible, true);
});
