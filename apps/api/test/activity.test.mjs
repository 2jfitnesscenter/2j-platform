import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: Activity integration tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 4, connect_timeout: 5 });
await migrateDatabase(sql);
const as = (role) => buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: `activity-test-${role}`, role }) });
const admin = as('admin');
const trainer = as('trainer');
const accountant = as('accountant');
const reception = as('reception-management');
const anonymous = buildServer(process.env.DATABASE_URL);
after(async () => { await Promise.all([admin.close(), trainer.close(), accountant.close(), reception.close(), anonymous.close()]); await sql.end(); });

const marker = `activity-${randomUUID()}`;
async function seed(minutesAgo, area, action) {
  const id = randomUUID();
  const at = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  if (area === 'economy') await sql`INSERT INTO economic_audit_events(id,actor_id,action,resource_type,resource_id,details,occurred_at) VALUES (${id},${marker},${action},'transaction',${randomUUID()},${sql.json({ secretNote: 'must never be returned' })},${at})`;
  if (area === 'staff') await sql`INSERT INTO staff_audit_events(id,actor_id,action,resource_type,resource_id,details,occurred_at) VALUES (${id},${marker},${action},'professional',${randomUUID()},${sql.json({ secretNote: 'must never be returned' })},${at})`;
  if (area === 'calendar') await sql`INSERT INTO calendar_audit_events(id,actor_id,action,resource_type,resource_id,details,occurred_at) VALUES (${id},${marker},${action},'session',${randomUUID()},${sql.json({ secretNote: 'must never be returned' })},${at})`;
  return id;
}
const get = (app, url) => app.inject({ method: 'GET', url });

test('the audit feed needs authentication and the audit permission; no other role can read it', async () => {
  assert.equal((await get(anonymous, '/api/activity/audit')).statusCode, 401);
  for (const app of [trainer, accountant, reception]) assert.equal((await get(app, '/api/activity/audit')).statusCode, 403);
  assert.equal((await get(admin, '/api/activity/audit')).statusCode, 200);
});

test('events from several domains come back newest first with only action, resource kind, actor, area and instant', async () => {
  const oldest = await seed(30, 'economy', 'payment.recorded');
  const middle = await seed(20, 'staff', 'absence.created');
  const newest = await seed(10, 'calendar', 'session.created');
  const response = await get(admin, '/api/activity/audit?limit=100');
  assert.equal(response.statusCode, 200, response.body);
  const mine = response.json().items.filter((item) => item.actorId === marker);
  assert.deepEqual(mine.map((item) => item.id), [newest, middle, oldest]);
  assert.deepEqual(mine.map((item) => item.area), ['calendar', 'staff', 'economy']);
  for (const item of mine) assert.deepEqual(Object.keys(item).sort(), ['action', 'actorId', 'area', 'id', 'occurredAt', 'resourceType']);
  assert.equal(response.body.includes('must never be returned'), false, 'the details payload is never exposed');
});

test('the cursor pages without skipping or repeating events that share the same instant', async () => {
  const at = new Date(Date.now() - 5 * 60_000).toISOString();
  const ids = [];
  for (let index = 0; index < 5; index += 1) {
    const id = randomUUID();
    ids.push(id);
    await sql`INSERT INTO economic_audit_events(id,actor_id,action,resource_type,resource_id,occurred_at) VALUES (${id},${`${marker}-page`},'payment.recorded','transaction',${randomUUID()},${at})`;
  }
  const seen = [];
  let url = '/api/activity/audit?limit=2';
  for (let page = 0; page < 20; page += 1) {
    const body = (await get(admin, url)).json();
    seen.push(...body.items.map((item) => item.id));
    if (!body.nextCursor) break;
    url = `/api/activity/audit?limit=2&beforeAt=${encodeURIComponent(body.nextCursor.beforeAt)}&beforeId=${body.nextCursor.beforeId}`;
  }
  assert.equal(new Set(seen).size, seen.length, 'no event is repeated across pages');
  for (const id of ids) assert.ok(seen.includes(id), 'no event sharing an instant is skipped');
});

test('the cursor does not skip events whose instant has microseconds (the cursor travels as JSON milliseconds)', async () => {
  const ids = [];
  for (let index = 0; index < 5; index += 1) {
    const id = randomUUID();
    ids.push(id);
    await sql`INSERT INTO economic_audit_events(id,actor_id,action,resource_type,resource_id,occurred_at) VALUES (${id},${marker + '-micro'},'payment.recorded','transaction',${randomUUID()},date_trunc('second', now()) - interval '9 minutes' + interval '123456 microseconds')`;
  }
  const seen = [];
  let url = '/api/activity/audit?limit=2';
  for (let page = 0; page < 40; page += 1) {
    const body = (await get(admin, url)).json();
    seen.push(...body.items.map((item) => item.id));
    if (!body.nextCursor) break;
    url = `/api/activity/audit?limit=2&beforeAt=${encodeURIComponent(body.nextCursor.beforeAt)}&beforeId=${body.nextCursor.beforeId}`;
  }
  assert.equal(new Set(seen).size, seen.length, 'no event is repeated across pages');
  for (const id of ids) assert.ok(seen.includes(id), 'no event with a sub-millisecond instant is skipped');
});

test('bad queries are rejected: unknown keys, out-of-range limits and an incomplete cursor', async () => {
  for (const url of ['/api/activity/audit?limit=0', '/api/activity/audit?limit=101', '/api/activity/audit?x=1', `/api/activity/audit?beforeAt=${encodeURIComponent(new Date().toISOString())}`, `/api/activity/audit?beforeId=${randomUUID()}`, '/api/activity/audit?beforeAt=yesterday&beforeId=nope']) {
    assert.equal((await get(admin, url)).statusCode, 400, url);
  }
});
