import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { seedDemoData } from '../scripts/seed-demo.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: PostgreSQL integration tests cannot be skipped.');

test('synthetic trainer seed creates and repairs the fixed account link without changing auth semantics', async () => {
  const databaseName = `demo_seed_${randomUUID().replaceAll('-', '')}`;
  const admin = postgres(process.env.DATABASE_URL, { max: 2, connect_timeout: 5 });
  const databaseUrl = new URL(process.env.DATABASE_URL);
  databaseUrl.pathname = `/${databaseName}`;
  let sql;
  let trainer;
  let unlinked;
  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    sql = postgres(databaseUrl.toString(), { max: 8, connect_timeout: 5 });
    await migrateDatabase(sql);

    await seedDemoData(sql);
    const demoId = 'd0700000-0000-4000-8000-000000000101';
    let [demo] = await sql`SELECT id,display_name,auth_actor_id FROM staff_professionals WHERE id=${demoId}::uuid`;
    assert.equal(demo.display_name, 'Alex Rivera');
    assert.equal(demo.auth_actor_id, 'local-demo:trainer');

    await sql`UPDATE staff_professionals SET auth_actor_id=NULL WHERE id=${demoId}::uuid`;
    await seedDemoData(sql);
    [demo] = await sql`SELECT auth_actor_id FROM staff_professionals WHERE id=${demoId}::uuid`;
    assert.equal(demo.auth_actor_id, 'local-demo:trainer', 'an existing synthetic database is repaired by the additive seed');

    trainer = buildServer(databaseUrl.toString(), { authorizationResolver: async () => ({ actorId: 'local-demo:trainer', role: 'trainer' }) });
    unlinked = buildServer(databaseUrl.toString(), { authorizationResolver: async () => ({ actorId: 'production-style-unlinked-actor', role: 'trainer' }) });
    const clock = await trainer.inject({ method: 'GET', url: '/api/timeclock/self' });
    assert.equal(clock.statusCode, 200, clock.body);
    assert.equal(clock.json().professional.displayName, 'Alex Rivera');
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
    await Promise.all([trainer?.close(), unlinked?.close(), sql?.end()]);
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }
});
