import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { signedRequestSignature } from '../src/internal-service-auth.ts';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: capabilities V2.1 integration tests need PostgreSQL.');
const sql = postgres(process.env.DATABASE_URL, { max: 6, connect_timeout: 5 });
await migrateDatabase(sql);
const keyId = 'v21-home-v1', secret = Buffer.alloc(32, 41).toString('base64url');
const app = buildServer(process.env.DATABASE_URL, { trainingCapabilitiesKeys: { [keyId]: { caller: 'home', secret } } });
after(async () => { await app.close(); await sql.end({ timeout: 2 }); });

const V2 = personId => `/api/internal/platform/v2/persons/${personId}/training-capabilities`;
const V21 = personId => `/api/internal/platform/v2.1/persons/${personId}/training-capabilities`;
const headers = (path, requestId = randomUUID()) => { const timestamp = new Date().toISOString(); return { 'x-2j-key-id': keyId, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signedRequestSignature(secret, { keyId, timestamp, requestId, method: 'GET', path }) }; };
const get = (path, signedPath = path) => app.inject({ method: 'GET', url: path, headers: headers(signedPath) });
const person = async () => { const id = randomUUID(); await sql`INSERT INTO platform_persons(id,status,created_by) VALUES (${id}::uuid,'active','v21-test')`; return id; };
const link = async (personId, status = 'active') => { const [row] = await sql`INSERT INTO training_account_links(request_id,person_id,training_user_id,method,created_by,updated_by) VALUES (${randomUUID()},${personId}::uuid,${`training-${randomUUID()}`},'explicit_admin','v21-test','v21-test') RETURNING link_id,training_user_id`; if (status === 'revoked') await sql`UPDATE training_account_links SET status='revoked',revoked_at=now(),updated_by='v21-test' WHERE link_id=${row.link_id}`; return row.training_user_id; };
const suspend = async (personId, action = 'suspended') => sql`INSERT INTO platform_training_access_events(person_id,action,reason,actor_id,idempotency_key,request_hash) VALUES (${personId}::uuid,${action},'v2.1 test suspension reason','v21-test',${randomUUID()}::uuid,${'a'.repeat(64)})`;

test('V2.1 endpoint: a registered person with NO Training link gets the free baseline (A23), V2 for the same person is unchanged (blocked, link missing)', async () => {
  const personId = await person();
  const v21 = await get(V21(personId));
  assert.equal(v21.statusCode, 200, v21.body);
  const body = v21.json();
  assert.equal(body.contract, '2J-CAPABILITIES-V2.1'); assert.equal(body.revision, 1); assert.equal(body.version, 2);
  assert.deepEqual({ level: body.capabilityLevel, state: body.accessState, reason: body.reasonCode, link: body.trainingSubject }, { level: 'baseline', state: 'baseline', reason: 'FREE_BASELINE', link: { linkStatus: 'not_linked' } });
  assert.equal(body.capabilities.guidedTraining, true); assert.equal(body.capabilities.premiumPrograms, true);
  assert.equal(body.capabilities.aiCoach, false); assert.equal(body.capabilities.professionalFollowUp, false);
  assert.equal(v21.headers['cache-control'], 'no-store');
  const v2 = (await get(V2(personId))).json();
  assert.deepEqual({ contract: v2.contract, level: v2.capabilityLevel, reason: v2.reasonCode, guided: v2.capabilities.guidedTraining }, { contract: '2J-CAPABILITIES-V2', level: 'blocked', reason: 'TRAINING_LINK_MISSING', guided: false });
  assert.equal('revision' in v2, false);
});

test('V2.1 endpoint: linked person gets the richer baseline; revoked stays blocked; suspension blocks linked and unlinked alike; a lift returns to the baseline', async () => {
  const linked = await person(); const trainingUserId = await link(linked);
  const base = (await get(V21(linked))).json();
  assert.deepEqual({ level: base.capabilityLevel, subject: base.trainingSubject, guided: base.capabilities.guidedTraining, premium: base.capabilities.premiumPrograms }, { level: 'baseline', subject: { linkStatus: 'active', trainingUserId }, guided: true, premium: true });
  const revoked = await person(); await link(revoked, 'revoked');
  const revokedBody = (await get(V21(revoked))).json();
  assert.deepEqual({ level: revokedBody.capabilityLevel, reason: revokedBody.reasonCode, subject: revokedBody.trainingSubject }, { level: 'blocked', reason: 'TRAINING_LINK_REVOKED', subject: { linkStatus: 'revoked' } });
  await suspend(linked);
  const suspendedLinked = (await get(V21(linked))).json();
  assert.deepEqual({ level: suspendedLinked.capabilityLevel, reason: suspendedLinked.reasonCode, state: suspendedLinked.accessState, flags: Object.values(suspendedLinked.capabilities).some(Boolean) }, { level: 'blocked', reason: 'ADMIN_SUSPENDED', state: 'suspended', flags: false });
  const unlinked = await person(); await suspend(unlinked);
  const suspendedUnlinked = (await get(V21(unlinked))).json();
  assert.deepEqual({ level: suspendedUnlinked.capabilityLevel, reason: suspendedUnlinked.reasonCode, subject: suspendedUnlinked.trainingSubject }, { level: 'blocked', reason: 'ADMIN_SUSPENDED', subject: { linkStatus: 'not_linked' } });
  await suspend(linked, 'lifted');
  assert.equal((await get(V21(linked))).json().capabilityLevel, 'baseline');
});

test('V2.1 endpoint keeps the service-authentication rules: a V2 signature does not open V2.1, unknown people are 404, bad ids are 400, no member session is accepted', async () => {
  const personId = await person();
  assert.equal((await get(V21(personId), V2(personId))).statusCode, 401, 'the signed path must be the V2.1 path');
  assert.equal((await get(V2(personId), V21(personId))).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: V21(personId) })).statusCode, 401);
  assert.equal((await get(V21(randomUUID()))).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/api/internal/platform/v2.1/persons/not-a-uuid/training-capabilities', headers: headers('/api/internal/platform/v2.1/persons/not-a-uuid/training-capabilities') })).statusCode, 400);
  const replayId = randomUUID(), replayHeaders = headers(V21(personId), replayId);
  assert.equal((await app.inject({ method: 'GET', url: V21(personId), headers: replayHeaders })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: V21(personId), headers: replayHeaders })).statusCode, 401, 'a request id is single use');
});
