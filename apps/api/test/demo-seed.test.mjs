import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { seedDemoData, validateDemoSeedTarget } from '../scripts/seed-demo.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: PostgreSQL integration tests cannot be skipped.');

test('demo seed target stays loopback-only and staging requires the explicit 2jfit.com flag', () => {
  const local = { NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/2j_demo' };
  assert.equal(validateDemoSeedTarget(local), 'local');
  assert.equal(validateDemoSeedTarget({ NODE_ENV: 'development', DATABASE_URL: 'postgres://127.0.0.1/2j_demo', STAGING_SEED: '1', STAGING_SEED_HOST: '2jfit.com' }), 'staging');
  assert.throws(() => validateDemoSeedTarget({ ...local, STAGING_SEED: 'true', STAGING_SEED_HOST: '2jfit.com' }), /exactly 1/);
  assert.throws(() => validateDemoSeedTarget({ NODE_ENV: 'production', DATABASE_URL: 'postgres://127.0.0.1/2j_demo', STAGING_SEED: '1', STAGING_SEED_HOST: '2jfit.com' }), /development runner/);
  assert.throws(() => validateDemoSeedTarget({ NODE_ENV: 'development', DATABASE_URL: 'postgres://127.0.0.1/2j_demo', STAGING_SEED: '1', STAGING_SEED_HOST: '2jfit.es' }), /exactly 2jfit.com/);
  assert.throws(() => validateDemoSeedTarget({ NODE_ENV: 'development', DATABASE_URL: 'postgres://production-db/production', STAGING_SEED: '1', STAGING_SEED_HOST: '2jfit.com' }), /isolated local 2j_demo/);
});

test('synthetic trainer seed creates and repairs the fixed account link without changing auth semantics', async () => {
  const databaseName = `demo_seed_${randomUUID().replaceAll('-', '')}`;
  const admin = postgres(process.env.DATABASE_URL, { max: 2, connect_timeout: 5 });
  const databaseUrl = new URL(process.env.DATABASE_URL);
  databaseUrl.pathname = `/${databaseName}`;
  let sql;
  let trainer;
  let adminStaff;
  let unlinked;
  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    sql = postgres(databaseUrl.toString(), { max: 8, connect_timeout: 5 });
    await migrateDatabase(sql);

    await seedDemoData(sql);
    const demoId = 'd0700000-0000-4000-8000-000000000101';
    const demoAdminId = 'd0700000-0000-4000-8000-000000000105';
    let [demo] = await sql`SELECT id,display_name,auth_actor_id FROM staff_professionals WHERE id=${demoId}::uuid`;
    assert.equal(demo.display_name, 'Alex Rivera');
    assert.equal(demo.auth_actor_id, 'local-demo:trainer');
    const [adminProfile] = await sql`SELECT display_name,base_role,auth_actor_id FROM staff_professionals WHERE id=${demoAdminId}::uuid`;
    assert.deepEqual(adminProfile, { display_name: 'Sofía Demo', base_role: 'admin', auth_actor_id: 'local-demo:admin' });
    const [secondTrainer] = await sql`SELECT display_name,base_role,status FROM staff_professionals WHERE id='d0700000-0000-4000-8000-000000000102'::uuid`;
    assert.deepEqual(secondTrainer, { display_name: 'Nora Vega', base_role: 'trainer', status: 'active' });

    const daySessions = await sql`SELECT s.id,s.capacity,count(DISTINCT r.id)::int AS reservations,count(DISTINCT w.id)::int AS waiting
      FROM calendar_sessions s LEFT JOIN calendar_reservations r ON r.session_id=s.id AND r.status='reserved'
      LEFT JOIN calendar_waitlist_entries w ON w.session_id=s.id AND w.status='waiting'
      WHERE s.id IN ('d0700000-0000-4000-8000-000000000201','d0700000-0000-4000-8000-000000000202','d0700000-0000-4000-8000-000000000203')
      GROUP BY s.id,s.capacity ORDER BY s.id`;
    assert.equal(daySessions.length, 3, 'the synthetic active day has multiple sessions across services');
    assert.deepEqual(daySessions.map(({ capacity, reservations, waiting }) => ({ capacity, reservations, waiting })), [
      { capacity: 8, reservations: 3, waiting: 1 },
      { capacity: 6, reservations: 2, waiting: 0 },
      { capacity: 2, reservations: 2, waiting: 0 },
    ]);
    await sql`UPDATE calendar_sessions SET starts_at=now()-interval '3 days' WHERE id='d0700000-0000-4000-8000-000000000510'::uuid`;
    const demoFollowup = await sql`SELECT a.client_id AS "clientId",f.category,a.status,a.required,(a.due_at<now()) AS overdue,r.answers IS NOT NULL AS responded
      FROM client_form_assignments a JOIN client_form_versions v ON v.id=a.form_version_id JOIN client_forms f ON f.id=v.form_id
      LEFT JOIN client_form_responses r ON r.assignment_id=a.id
      WHERE a.id IN ('d0700000-0000-4000-8000-000000000903','d0700000-0000-4000-8000-000000000905') ORDER BY a.id`;
    assert.equal(demoFollowup.length, 2, 'synthetic form assignments cover pending follow-up and review');
    assert.deepEqual(demoFollowup.map(({ clientId, category, status, required, overdue, responded }) => ({ clientId, category, status, required, overdue, responded })), [
      { clientId: 'd0700000-0000-4000-8000-000000000001', category: 'check_in', status: 'assigned', required: true, overdue: true, responded: false },
      { clientId: 'd0700000-0000-4000-8000-000000000008', category: 'check_in', status: 'review_required', required: true, overdue: false, responded: true },
    ]);
    assert.equal((await sql`SELECT count(*)::int AS count FROM communication_conversations WHERE client_id='d0700000-0000-4000-8000-000000000001'::uuid`)[0].count, 1, 'the primary review profile has a synthetic message thread');
    assert.equal((await sql`SELECT count(*)::int AS count FROM economic_charges WHERE client_id='d0700000-0000-4000-8000-000000000001'::uuid AND state='pending'`)[0].count, 1, 'the primary review profile has a pending synthetic charge');

    await sql`UPDATE staff_professionals SET auth_actor_id=NULL WHERE id=${demoId}::uuid`;
    await seedDemoData(sql);
    [demo] = await sql`SELECT auth_actor_id FROM staff_professionals WHERE id=${demoId}::uuid`;
    assert.equal(demo.auth_actor_id, 'local-demo:trainer', 'an existing synthetic database is repaired by the additive seed');
    const [reviewSession] = await sql`SELECT (starts_at AT TIME ZONE 'Atlantic/Canary')::date=(now() AT TIME ZONE 'Atlantic/Canary')::date AS is_today FROM calendar_sessions WHERE id='d0700000-0000-4000-8000-000000000510'::uuid`;
    assert.equal(reviewSession.is_today,true,'re-running the owner-review seed moves only the fixed synthetic visible session back to today');

    trainer = buildServer(databaseUrl.toString(), { authorizationResolver: async () => ({ actorId: 'local-demo:trainer', role: 'trainer' }) });
    adminStaff = buildServer(databaseUrl.toString(), { authorizationResolver: async () => ({ actorId: 'local-demo:admin', role: 'admin' }) });
    unlinked = buildServer(databaseUrl.toString(), { authorizationResolver: async () => ({ actorId: 'production-style-unlinked-actor', role: 'trainer' }) });
    const clock = await trainer.inject({ method: 'GET', url: '/api/timeclock/self' });
    assert.equal(clock.statusCode, 200, clock.body);
    assert.equal(clock.json().professional.displayName, 'Alex Rivera');
    const adminClock = await adminStaff.inject({ method: 'GET', url: '/api/timeclock/self' });
    assert.equal(adminClock.statusCode, 200, adminClock.body);
    assert.equal(adminClock.json().professional.displayName, 'Sofía Demo', 'the admin actor resolves to the attached synthetic professional instead of a second identity override');
    assert.equal((await unlinked.inject({ method: 'GET', url: '/api/timeclock/self' })).statusCode, 404);
    assert.deepEqual((await unlinked.inject({ method: 'GET', url: '/api/timeclock/self' })).json(), { error: 'staff_account_unlinked' });

    const [other] = await sql`INSERT INTO staff_professionals(first_name,last_name,display_name,status,base_role,created_by)
      VALUES ('Otra','Persona','Otra Persona','active','trainer','demo-seed-test') RETURNING id`;
    await sql`UPDATE staff_professionals SET auth_actor_id=NULL WHERE id=${demoId}::uuid`;
    await sql`UPDATE staff_professionals SET auth_actor_id='local-demo:trainer' WHERE id=${other.id}`;
    await assert.rejects(seedDemoData(sql), /already linked to another professional/);
    const [preserved] = await sql`SELECT auth_actor_id FROM staff_professionals WHERE id=${other.id}`;
    const [unclaimedDemo] = await sql`SELECT auth_actor_id FROM staff_professionals WHERE id=${demoId}::uuid`;
    assert.equal(preserved.auth_actor_id, 'local-demo:trainer');
    assert.equal(unclaimedDemo.auth_actor_id, null);
  } finally {
    await Promise.all([trainer?.close(), adminStaff?.close(), unlinked?.close(), sql?.end()]);
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }
});
