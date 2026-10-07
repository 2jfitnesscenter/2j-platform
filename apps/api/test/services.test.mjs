import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, planInput, serviceInput } from '../src/server.ts';
import { readFile, readdir } from 'node:fs/promises';
import postgres from 'postgres';

test('service input trims and rejects empty names or unknown fields', () => {
  assert.deepEqual(serviceInput.parse({ name: '  La Sala ', area: ' La Sala ', status: 'draft' }), { name: 'La Sala', area: 'La Sala', status: 'draft' });
  assert.equal(serviceInput.safeParse({ name: ' ', area: 'Sala', status: 'draft' }).success, false);
  assert.equal(serviceInput.safeParse({ name: 'Sala', area: 'Sala', status: 'draft', active: true }).success, false);
  assert.equal(serviceInput.safeParse({ name: 'Sala', area: 'Sala' }).success, false);
});

test('plan rights require a quota and a period for periodic quotas', () => {
  const valid = { name: 'Sala 8', billingCadence: 'monthly', rights: [{ rightType: 'period_quota', quantity: 8, period: 'month' }, { rightType: 'service_access' }] };
  assert.equal(planInput.safeParse(valid).success, true);
  assert.equal(planInput.safeParse({ ...valid, rights: [{ rightType: 'sessions_quota' }] }).success, false);
  assert.equal(planInput.safeParse({ ...valid, rights: [{ rightType: 'period_quota', quantity: 8 }] }).success, false);
});

test('health endpoint announces local-only mode without database access', async (t) => {
  const app = buildServer('postgres://local:local@127.0.0.1:54329/2j_platform');
  t.after(async () => app.close());
  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok', mode: 'local-only' });
});

test('PostgreSQL persists service, plan and rights as one coherent workflow', { skip: !process.env.DATABASE_URL && 'DATABASE_URL is not configured' }, async (t) => {
  const databaseUrl = process.env.DATABASE_URL;
  const sql = postgres(databaseUrl);
  const migrationDirectory = new URL('../migrations/', import.meta.url);
  for (const file of (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort()) await sql.unsafe(await readFile(new URL(file, migrationDirectory), 'utf8'));
  const app = buildServer(databaseUrl);
  t.after(async () => { await app.close(); await sql.end(); });
  const marker = `QA ${crypto.randomUUID()}`;
  const serviceResponse = await app.inject({ method: 'POST', url: '/api/services', payload: { name: marker, area: 'QA', status: 'draft' } });
  assert.equal(serviceResponse.json().status, 'draft');
  assert.equal(serviceResponse.statusCode, 201);
  const service = serviceResponse.json();
  const planResponse = await app.inject({ method: 'POST', url: `/api/services/${service.id}/plans`, payload: { name: 'Cuota QA', billingCadence: 'monthly', rights: [{ rightType: 'period_quota', quantity: 8, period: 'month' }] } });
  assert.equal(planResponse.statusCode, 201);
  assert.equal(planResponse.json().rights[0].quantity, 8);
  const listResponse = await app.inject({ method: 'GET', url: `/api/services/${service.id}/plans` });
  assert.equal(listResponse.json()[0].rights[0].period, 'month');
  assert.equal((await sql`SELECT currency FROM plans WHERE id=${planResponse.json().id}`)[0].currency, null);
  await sql`DELETE FROM plans WHERE service_id=${service.id}`;
  await sql`DELETE FROM services WHERE id=${service.id}`;
});
