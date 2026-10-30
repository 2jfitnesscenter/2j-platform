import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for member invitation integration tests.');
const sql = postgres(process.env.DATABASE_URL, { max: 4, connect_timeout: 5 });
await migrateDatabase(sql);
const actor = { actorId: 'invitation-admin-test', role: 'admin' };
const on = buildServer(process.env.DATABASE_URL, { authorizationResolver: async request => request.headers['x-test-role'] === 'admin' ? actor : request.headers['x-test-role'] === 'inviter' ? { actorId: 'invitation-explicit-test', role: 'trainer', explicitPermissions: ['member.invitations.manage'] } : request.headers['x-test-role'] === 'trainer' ? { actorId: 'invitation-trainer-test', role: 'trainer' } : null });
after(async () => { await on.close(); await sql.end({ timeout: 2 }); });
const get = (url, role) => on.inject({ method: 'GET', url, ...(role ? { headers: { 'x-test-role': role } } : {}) });

test('member invitation requires explicit management permission and returns no-store', async () => {
  assert.equal((await get('/api/platform/v1/member-invitations')).statusCode, 401);
  assert.equal((await get('/api/platform/v1/member-invitations', 'trainer')).statusCode, 403);
  const allowed = await get('/api/platform/v1/member-invitations', 'inviter');
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.headers['cache-control'], 'no-store');
  assert.deepEqual(Object.keys(allowed.json()).sort(), ['invitations','v']);
});

test('create reveals a 256-bit secret once, persists only its digest, and revoke is audited and final', async () => {
  const created = await on.inject({ method: 'POST', url: '/api/platform/v1/member-invitations', headers: { 'x-test-role': 'admin' }, payload: {} });
  assert.equal(created.statusCode, 201, created.body);
  const { invitation, secret } = created.json();
  assert.equal(secret.length, 43, '32 random bytes encode to 43 base64url characters');
  assert.equal(created.headers['cache-control'], 'no-store');
  assert.equal(created.json().invitation.status, 'pending');
  const [stored] = await sql`SELECT token_hash,status,created_by,expires_at>now() AS not_expired FROM platform_member_invitations WHERE id=${invitation.id}::uuid`;
  assert.equal(stored.token_hash, createHash('sha256').update(secret).digest('hex'));
  assert.notEqual(stored.token_hash, secret);
  assert.equal(stored.status, 'pending'); assert.equal(stored.created_by, actor.actorId); assert.equal(stored.not_expired, true);
  const list = await get('/api/platform/v1/member-invitations?status=all', 'admin');
  assert.equal(list.statusCode, 200); assert.equal(JSON.stringify(list.json()).includes(secret), false); assert.equal(JSON.stringify(list.json()).includes('tokenHash'), false);
  assert.equal(JSON.stringify(list.json()).includes(stored.token_hash), false);
  const denied = await on.inject({ method: 'POST', url: `/api/platform/v1/member-invitations/${invitation.id}/revoke`, headers: { 'x-test-role': 'trainer' }, payload: { reason: 'Revocación solicitada por el propietario.' } });
  assert.equal(denied.statusCode, 403);
  const revoked = await on.inject({ method: 'POST', url: `/api/platform/v1/member-invitations/${invitation.id}/revoke`, headers: { 'x-test-role': 'inviter' }, payload: { reason: 'La entrega debe repetirse por otro canal.' } });
  assert.equal(revoked.statusCode, 200, revoked.body); assert.equal(revoked.json().invitation.status, 'revoked');
  const again = await on.inject({ method: 'POST', url: `/api/platform/v1/member-invitations/${invitation.id}/revoke`, headers: { 'x-test-role': 'admin' }, payload: { reason: 'Segundo intento de revocación.' } });
  assert.equal(again.statusCode, 409);
  const [finalRow] = await sql`SELECT status,revoked_by,revoke_reason FROM platform_member_invitations WHERE id=${invitation.id}::uuid`;
  assert.deepEqual(finalRow, { status: 'revoked', revoked_by: 'invitation-explicit-test', revoke_reason: 'La entrega debe repetirse por otro canal.' });
  assert.deepEqual((await sql`SELECT action,actor_id FROM platform_member_invitation_events WHERE invitation_id=${invitation.id}::uuid ORDER BY occurred_at,id`).map(row => [row.action,row.actor_id]), [['created',actor.actorId],['revoked','invitation-explicit-test']]);
  await assert.rejects(sql`DELETE FROM platform_member_invitations WHERE id=${invitation.id}::uuid`, /retained|55000/);
  await assert.rejects(sql`UPDATE platform_member_invitation_events SET actor_id='rewritten' WHERE invitation_id=${invitation.id}::uuid`, /append-only|55000/);
});

test('invitation request rejects identity/contact fields and does not create people, clients, or Training identities', async () => {
  const before = await sql`SELECT (SELECT count(*)::int FROM platform_persons) AS persons,(SELECT count(*)::int FROM clients) AS clients,(SELECT count(*)::int FROM training_account_links) AS links`;
  const invalid = await on.inject({ method: 'POST', url: '/api/platform/v1/member-invitations', headers: { 'x-test-role': 'admin' }, payload: { email: 'someone@example.invalid', personId: randomUUID() } });
  assert.equal(invalid.statusCode, 400);
  const afterCounts = await sql`SELECT (SELECT count(*)::int FROM platform_persons) AS persons,(SELECT count(*)::int FROM clients) AS clients,(SELECT count(*)::int FROM training_account_links) AS links`;
  assert.deepEqual(afterCounts[0], before[0]);
});
