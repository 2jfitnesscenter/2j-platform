import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: dashboard API tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 6, connect_timeout: 5 });
await migrateDatabase(sql);
const admin = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'quick-actions-admin', role: 'admin' }) });
const accountant = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'quick-actions-accountant', role: 'accountant' }) });
after(async () => { await Promise.all([admin.close(), accountant.close(), sql.end()]); });

test('command center publishes Cobrar and Vender only for the corresponding API capabilities', async () => {
  const response = await admin.inject({ method: 'GET', url: '/api/dashboard/command-center' });
  assert.equal(response.statusCode, 200, response.body);
  const actions = response.json().quickActions;
  assert.deepEqual(actions.filter((item) => ['collect-payment', 'new-sale'].includes(item.id)), [
    { id: 'new-sale', label: 'Vender', href: '#store?sale=1' },
    { id: 'collect-payment', label: 'Cobrar', href: '#economics' },
  ]);
  const restricted = await accountant.inject({ method: 'GET', url: '/api/dashboard/command-center' });
  assert.equal(restricted.statusCode, 200, restricted.body);
  assert.ok(!restricted.json().quickActions.some((item) => ['collect-payment', 'new-sale'].includes(item.id)));
});
