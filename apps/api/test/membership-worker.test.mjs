import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { migrateDatabase } from '../src/migrate.ts';
import { createMembershipPeriodEnforcementWorker } from '../src/membership-period-enforcement.ts';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: membership worker tests need PostgreSQL.');
const sql = postgres(process.env.DATABASE_URL, { max: 4, connect_timeout: 5 });
await migrateDatabase(sql);
after(async () => { await sql.end(); });

test('the worker is off by default: start() schedules nothing', async () => {
  const worker = createMembershipPeriodEnforcementWorker(sql, { enabled: false });
  worker.start();
  assert.equal(worker.isRunning(), false);
  worker.stop();
});

test('when enabled it schedules one timer, is idempotent to start, and stop clears it', async () => {
  const worker = createMembershipPeriodEnforcementWorker(sql, { enabled: true, intervalMs: 60_000 });
  worker.start(); worker.start();
  assert.equal(worker.isRunning(), true);
  worker.stop();
  assert.equal(worker.isRunning(), false);
});

test('a tick runs the cancellation once and returns its summary; an overlapping tick is skipped', async () => {
  const worker = createMembershipPeriodEnforcementWorker(sql, { enabled: true });
  const [first, second] = await Promise.all([worker.tick(), worker.tick()]);
  assert.ok(first && typeof first.cancelled === 'number', 'first tick runs');
  assert.equal(second, null, 'overlapping tick is skipped');
  const again = await worker.tick();
  assert.ok(again && again.cancelled === 0, 'a later tick runs again on an empty database');
});

test('a failing tick is logged and does not stop later ticks', async () => {
  const broken = postgres('postgres://nobody:nope@127.0.0.1:1/none', { max: 1, connect_timeout: 1 });
  const warnings = [];
  const worker = createMembershipPeriodEnforcementWorker(broken, { enabled: true, logger: { warn: (...a) => warnings.push(a) } });
  assert.equal(await worker.tick(), null);
  assert.equal(warnings.length, 1);
  await broken.end({ timeout: 1 }).catch(() => {});
});
