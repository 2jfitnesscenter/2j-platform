import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { enqueuePushForClient } from '../src/push.ts';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: push producer tests need PostgreSQL.');
const sql = postgres(process.env.DATABASE_URL, { max: 4, connect_timeout: 5 });
await migrateDatabase(sql);
const admin = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'push-producers-admin', role: 'admin' }) });
after(async () => { await admin.close(); await sql.end(); });

async function makeClient(name, { linked }) {
  const response = await admin.inject({ method: 'POST', url: '/api/clients', headers: { 'idempotency-key': randomUUID() }, payload: { firstName: name, lastName: `Producer ${randomUUID().slice(0, 8)}` } });
  assert.equal(response.statusCode, 201, response.body);
  const client = response.json(), personId = randomUUID();
  if (linked) {
    await sql`INSERT INTO platform_persons(id,status,created_by) VALUES (${personId}::uuid,'active','push-producers-test')`;
    await sql`INSERT INTO platform_person_clients(person_id,client_id,linked_by) VALUES (${personId}::uuid,${client.id}::uuid,'push-producers-test')`;
  }
  return { clientId: client.id, personId: linked ? personId : null };
}

test('a linked member gets one push intent per business event, addressed to the person and idempotent', async () => {
  const member = await makeClient('Linked', { linked: true });
  const key = `waitlist-promoted:${randomUUID()}`;
  const first = await enqueuePushForClient(sql, member.clientId, 'waitlist.promoted', key);
  const again = await enqueuePushForClient(sql, member.clientId, 'waitlist.promoted', key);
  assert.equal(first.created, true);
  assert.equal(again.created, false);
  assert.equal(again.intentId, first.intentId);
  const [row] = await sql`SELECT person_id, kind, category, title FROM platform_push_intents WHERE id=${first.intentId}::uuid`;
  assert.equal(String(row.person_id), member.personId);
  assert.equal(row.kind, 'waitlist.promoted');
  assert.equal(row.category, 'essential');
  assert.equal(row.title, 'Reserva confirmada');
});

test('grouped cancellation push carries only the count, with the fixed Spanish text', async () => {
  const member = await makeClient('Grouped', { linked: true });
  const key = `membership-period-cancelled-push:${randomUUID()}:${member.clientId}`;
  const result = await enqueuePushForClient(sql, member.clientId, 'booking.cancelled_by_membership', key, { count: 3 });
  assert.equal(result.created, true);
  const [row] = await sql`SELECT body FROM platform_push_intents WHERE id=${result.intentId}::uuid`;
  assert.equal(row.body, 'Se han cancelado 3 reservas por un cambio en tu cuota.');
});

test('a client without a linked Platform person queues nothing and the caller is not affected', async () => {
  const unlinked = await makeClient('Unlinked', { linked: false });
  const result = await enqueuePushForClient(sql, unlinked.clientId, 'waitlist.promoted', `k-${randomUUID()}`);
  assert.equal(result, null);
  assert.equal(await enqueuePushForClient(sql, randomUUID(), 'waitlist.promoted', `k-${randomUUID()}`), null);
  assert.equal(await enqueuePushForClient(sql, 'not-a-uuid', 'waitlist.promoted', `k-${randomUUID()}`), null);
});
