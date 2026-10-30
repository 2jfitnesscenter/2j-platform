import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: center profile API tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 6, connect_timeout: 5 });
await migrateDatabase(sql);
const admin = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'center-profile-admin', role: 'admin' }) });
const trainer = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'center-profile-trainer', role: 'trainer' }) });
const anonymous = buildServer(process.env.DATABASE_URL);
after(async () => { await Promise.all([admin.close(), trainer.close(), anonymous.close(), sql.end()]); });

test('center business profile is private, editable only by settings managers, and audit stores changed field names only', async () => {
  assert.equal((await anonymous.inject({ method: 'GET', url: '/api/admin/center-profile' })).statusCode, 401);
  assert.equal((await trainer.inject({ method: 'GET', url: '/api/admin/center-profile' })).statusCode, 403);
  assert.equal((await admin.inject({ method: 'GET', url: '/api/admin/center-profile' })).json().profile, null);
  const input = { businessName: '  Gimnasio 2J  ', contactEmail: 'CONTACTO@2J.EXAMPLE', contactPhone: '+34 600 123 456', address: 'Calle 2J, 1', city: 'La Laguna', postalCode: '38200' };
  const saved = await admin.inject({ method: 'PUT', url: '/api/admin/center-profile', payload: input });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual({ businessName: saved.json().profile.businessName, contactEmail: saved.json().profile.contactEmail, contactPhone: saved.json().profile.contactPhone }, { businessName: 'Gimnasio 2J', contactEmail: 'contacto@2j.example', contactPhone: '+34 600 123 456' });
  assert.equal((await trainer.inject({ method: 'PUT', url: '/api/admin/center-profile', payload: input })).statusCode, 403);
  const [event] = await sql`SELECT actor_id AS "actorId",changed_fields AS "changedFields" FROM center_business_profile_audit_events ORDER BY occurred_at DESC,id DESC LIMIT 1`;
  assert.equal(event.actorId, 'center-profile-admin');
  assert.deepEqual(event.changedFields, ['businessName','contactEmail','contactPhone','address','city','postalCode']);
  assert.equal(JSON.stringify(event).includes('contacto@2j.example'), false);
  await assert.rejects(sql`UPDATE center_business_profile_audit_events SET changed_fields='[]' WHERE actor_id='center-profile-admin'`, (error) => error.code === '55000');
});

test('center profile rejects fiscal, health, opening-hours and unknown fields instead of creating shadow settings', async () => {
  const base = { businessName: '2J', contactEmail: null, contactPhone: null, address: null, city: null, postalCode: null };
  for (const extra of [{ taxId: 'X123' }, { healthQuestionnaires: true }, { openingTime: '08:00' }, { arbitrary: 'value' }]) {
    const response = await admin.inject({ method: 'PUT', url: '/api/admin/center-profile', payload: { ...base, ...extra } });
    assert.equal(response.statusCode, 400, response.body);
  }
  assert.equal((await admin.inject({ method: 'PUT', url: '/api/admin/center-profile', payload: { ...base, contactEmail: 'no-es-correo' } })).statusCode, 400);
});
