import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { canonicalizeTrainingServiceRequest } from '../src/training-integration.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: Training link flow tests cannot be skipped.');
process.env.NODE_ENV = 'test';
const sql = postgres(process.env.DATABASE_URL, { max: 8, connect_timeout: 5 });
await migrateDatabase(sql);

const KEY = { id: 'qa-platform-to-training-v1', secret: Buffer.alloc(32, 7).toString('base64url') };
const memberOrigin = 'http://127.0.0.1:5173';

/* ---------------------------------------------------------------- fake Training service (loopback, signature-verifying) */
const training = { calls: [], mode: 'ok', only: null, refuse: null, users: new Map(), nextUser: 1, seenIds: new Set(), badSignatures: 0 };
const sha = value => createHash('sha256').update(value).digest('hex');
const trainingServer = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const send = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
    try {
      const canonical = canonicalizeTrainingServiceRequest({ keyId: req.headers['x-2j-key-id'], timestamp: req.headers['x-2j-timestamp'], requestId: req.headers['x-2j-request-id'], method: req.method, path: req.url, body });
      const expected = createHmac('sha256', Buffer.from(KEY.secret, 'base64url')).update(canonical).digest('base64url');
      if (req.headers['x-2j-key-id'] !== KEY.id || expected !== req.headers['x-2j-signature']) { training.badSignatures++; return send(401, { error: 'signature_invalid' }); }
      if (training.seenIds.has(req.headers['x-2j-request-id'])) return send(409, { error: 'service_request_replayed' });
      training.seenIds.add(req.headers['x-2j-request-id']);
    } catch { training.badSignatures++; return send(400, { error: 'invalid_request' }); }
    const json = JSON.parse(body.toString('utf8'));
    training.calls.push({ path: req.url, json });
    if (training.mode === 'down' && (!training.only || training.only === req.url)) { req.socket.destroy(); return; }
    if (training.refuse && req.url !== '/api/platform/v1/link-proofs/exchange' && req.url !== '/api/platform/v1/link-proofs/reconcile') return send(409, { error: training.refuse });
    const now = new Date().toISOString();
    switch (req.url) {
      case '/api/platform/v1/link-proofs/exchange': {
        const proof = training.proofs.get(json.code);
        if (!proof || sha(proof.challenge) !== json.challengeDigest) return send(401, { error: 'invalid_proof' });
        return send(200, { v: 1, transactionId: json.transactionId, personId: json.personId, trainingUserId: proof.trainingUserId, audience: json.audience, purpose: json.purpose, verifiedAt: now });
      }
      case '/api/platform/v1/link-proofs/reconcile': {
        const found = [...training.proofs.values()].find(proof => sha(proof.challenge) === json.challengeDigest);
        if (!found) return send(404, { error: 'not_found' });
        return send(200, { v: 1, status: 'verified', receiptId: found.receiptId, receiptVersion: 1, transactionId: json.transactionId, personId: json.personId, trainingUserId: found.trainingUserId, audience: json.audience, purpose: json.purpose, challengeDigest: json.challengeDigest, verifiedAt: now });
      }
      case '/api/platform/v1/link/activate': {
        if (json.origin === 'proof' && ![...training.proofs.values()].some(proof => proof.receiptId === json.receiptId && proof.trainingUserId === json.trainingUserId)) return send(409, { error: 'proof_required' });
        return send(200, { v: 1, status: 'active', replay: false, ackId: `ack-${randomUUID()}`, linkId: json.linkId, linkVersion: json.linkVersion, trainingUserId: json.trainingUserId });
      }
      case '/api/platform/v1/link/revoke':
        return send(200, { v: 1, status: 'revoked', ackId: `rack-${randomUUID()}`, linkId: json.linkId, trainingUserId: json.trainingUserId });
      case '/api/platform/v1/provision': {
        const previous = training.users.get(json.idempotencyKey);
        if (previous) return send(200, { v: 1, status: 'provisioned', replay: true, trainingUserId: previous, linkState: 'pending' });
        const id = `training-prov-${training.nextUser++}-${randomUUID().slice(0, 8)}`;
        training.users.set(json.idempotencyKey, id);
        return send(201, { v: 1, status: 'provisioned', replay: false, trainingUserId: id, linkState: 'pending' });
      }
      default: return send(404, { error: 'unknown' });
    }
  });
});
training.proofs = new Map();
await new Promise(resolve => trainingServer.listen(0, '127.0.0.1', resolve));
process.env.TRAINING_SERVICE_BASE_URL = `http://127.0.0.1:${trainingServer.address().port}`;
process.env.TRAINING_SERVICE_KEY_ID = KEY.id;
process.env.TRAINING_SERVICE_SECRET = KEY.secret;

let currentAuth = null, actor = { actorId: 'qa-admin', role: 'admin' };
const flags = { trainingVerifiedLinkingEnabled: true, trainingServiceCallsEnabled: true, trainingCanonicalLinkingEnabled: true, trainingLinkLifecycleEnabled: true, trainingProvisioningEnabled: true, trainingServiceAllowInsecureLoopback: true };
const base = { logger: false, memberAppOrigin: memberOrigin, memberPilotAuthEnabled: false, resolvePersonAuth: async () => currentAuth, authorizationResolver: async () => actor };
const app = buildServer(process.env.DATABASE_URL, { ...base, ...flags });
const disabled = buildServer(process.env.DATABASE_URL, { ...base });
const noProvisioning = buildServer(process.env.DATABASE_URL, { ...base, ...flags, trainingProvisioningEnabled: false });
after(async () => { await Promise.all([app.close(), disabled.close(), noProvisioning.close()]); await new Promise(resolve => trainingServer.close(resolve)); await sql.end(); });

async function createPerson() {
  const personId = randomUUID(), authSubject = `link-flow-${randomUUID()}`;
  await sql`INSERT INTO platform_persons(id,created_by) VALUES (${personId},'link-flow-test')`;
  await sql`INSERT INTO platform_person_auth_subjects(id,person_id,auth_subject,provider,status,created_by) VALUES (${randomUUID()},${personId},${authSubject},'platform-pilot','active','link-flow-test')`;
  return { personId, authSubject, auth: { personId, authSubject, provider: 'platform-pilot', providerVersion: 1 } };
}
const member = (method, url, payload) => app.inject({ method, url, headers: { ...(payload === undefined ? {} : { 'content-type': 'application/json' }), origin: memberOrigin }, ...(payload === undefined ? {} : { payload }) });
const admin = (method, url, payload, headers = {}) => app.inject({ method, url, headers: { 'content-type': 'application/json', ...headers }, ...(payload === undefined ? {} : { payload }) });
const linkOf = personId => sql`SELECT link_id,status,method,training_user_id,training_ack_id,revocation_ack_id,link_version FROM training_account_links WHERE person_id=${personId} ORDER BY created_at DESC`;
const audit = (personId, action) => sql`SELECT details FROM platform_identity_audit_events WHERE person_id=${personId} AND action=${action}`;
const reset = () => { training.mode = 'ok'; training.only = null; training.refuse = null; training.calls.length = 0; };

/** Starts a verified-linking transaction the way the member UI does and registers the owner's proof on the fake Training. */
async function startProof(person, trainingUserId) {
  currentAuth = person.auth;
  const created = await member('POST', '/api/platform/v1/training-link-transactions', { requestId: randomUUID() });
  assert.equal(created.statusCode, 201, created.body);
  const { transaction, challenge } = created.json();
  const code = randomUUID().replaceAll('-', '').padEnd(43, 'A').slice(0, 43);
  training.proofs.set(code, { challenge, trainingUserId, receiptId: randomUUID() });
  return { transactionId: transaction.transactionId, challenge, code };
}

test('every lifecycle route is off by default and needs the exact origin / authentication / permission', async () => {
  const person = await createPerson(); currentAuth = person.auth;
  assert.equal((await disabled.inject({ method: 'POST', url: '/api/me/training/link', headers: { 'content-type': 'application/json', origin: memberOrigin }, payload: {} })).statusCode, 423);
  assert.equal((await disabled.inject({ method: 'DELETE', url: '/api/me/training/link', headers: { origin: memberOrigin } })).statusCode, 423);
  assert.equal((await noProvisioning.inject({ method: 'POST', url: `/api/platform/v1/persons/${person.personId}/training-provision`, headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() }, payload: { displayName: 'A' } })).statusCode, 423);
  const body = { transactionId: randomUUID(), challenge: 'x'.repeat(43), code: 'y'.repeat(43) };
  assert.equal((await app.inject({ method: 'POST', url: '/api/me/training/link', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, payload: body })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/me/training/link', headers: { 'content-type': 'application/json' }, payload: body })).statusCode, 403, 'missing Origin');
  currentAuth = null;
  assert.equal((await member('POST', '/api/me/training/link', body)).statusCode, 401);
  currentAuth = person.auth;
  assert.equal((await member('POST', '/api/me/training/link', { ...body, extra: 1 })).statusCode, 400, 'strict body');
  actor = { actorId: 'qa-trainer', role: 'trainer' };
  assert.equal((await admin('POST', `/api/platform/v1/persons/${person.personId}/training-link/revoke`, { reason: 'abc' })).statusCode, 403);
  assert.equal((await admin('POST', `/api/platform/v1/persons/${person.personId}/training-provision`, { displayName: 'A' }, { 'idempotency-key': randomUUID() })).statusCode, 403);
  actor = { actorId: 'qa-admin', role: 'admin' };
  assert.equal((await admin('POST', `/api/platform/v1/persons/${person.personId}/training-provision`, { displayName: 'A' })).statusCode, 400, 'Idempotency-Key is mandatory');
  assert.equal(training.calls.length, 0, 'nothing reached Training');
});

test('linking an existing account: proof -> pending -> Training ACK -> active; replay is idempotent; the proof is bound to its own account', async () => {
  reset();
  const person = await createPerson(), trainingUserId = `hist-${randomUUID()}`;
  const proof = await startProof(person, trainingUserId);
  const done = await member('POST', '/api/me/training/link', proof);
  assert.equal(done.statusCode, 200, done.body); assert.equal(done.json().status, 'active');
  const [link] = await linkOf(person.personId);
  assert.equal(link.status, 'active'); assert.equal(link.method, 'verified_training_proof'); assert.equal(link.training_user_id, trainingUserId);
  assert.match(link.training_ack_id, /^ack-/); assert.equal(link.link_version, 2);
  const activate = training.calls.find(call => call.path === '/api/platform/v1/link/activate');
  assert.equal(activate.json.origin, 'proof'); assert.ok(activate.json.receiptId); assert.equal(activate.json.personId, person.personId);
  assert.equal(training.badSignatures, 0, 'every call to Training carried a valid 2J-SERVICE-AUTH-V1 signature');
  const retry = await member('POST', '/api/me/training/link', proof);
  assert.equal(retry.statusCode, 200, 'a lost response can be retried'); assert.equal((await linkOf(person.personId)).length, 1);
  assert.equal((await audit(person.personId, 'training.link_activated')).length, 1);
  // The same Training account cannot be claimed by someone else, with a perfectly valid proof of their own transaction.
  const other = await createPerson();
  const stolen = await startProof(other, trainingUserId);
  const refused = await member('POST', '/api/me/training/link', stolen);
  assert.equal(refused.statusCode, 409, 'duplicate training user');
  assert.equal((await linkOf(other.personId)).filter(row => row.status === 'active').length, 0);
});

test('Training unavailable or refusing: the link stays pending (retryable) or ends as conflict; admin resume completes a lost ACK', async () => {
  reset();
  const person = await createPerson(), trainingUserId = `hist-${randomUUID()}`;
  const proof = await startProof(person, trainingUserId);
  training.mode = 'down'; training.only = '/api/platform/v1/link/activate';
  const first = await member('POST', '/api/me/training/link', proof);
  assert.equal(first.statusCode, 202, first.body); assert.equal(first.json().retry, true);
  training.mode = 'ok';
  const [pending] = await linkOf(person.personId);
  assert.equal(pending.status, 'pending'); assert.equal(pending.training_ack_id, null, 'never active without the ACK');
  const resumed = await admin('POST', `/api/platform/v1/persons/${person.personId}/training-link/resume`, {});
  assert.equal(resumed.statusCode, 200, resumed.body);
  assert.equal((await linkOf(person.personId))[0].status, 'active');
  // A definitive refusal closes the attempt.
  const refused = await createPerson(), refusedUser = `hist-${randomUUID()}`;
  const proof2 = await startProof(refused, refusedUser);
  training.refuse = 'proof_required';
  const result = await member('POST', '/api/me/training/link', proof2);
  assert.equal(result.statusCode, 409); assert.equal(result.json().error, 'proof_required');
  assert.equal((await linkOf(refused.personId))[0].status, 'conflict');
  assert.equal((await audit(refused.personId, 'training.link_ack_failed')).length, 1);
  training.refuse = null;
  assert.equal((await admin('POST', `/api/platform/v1/persons/${refused.personId}/training-link/resume`, {})).statusCode, 404, 'a conflicted link is final');
});

test('the database refuses to activate or revoke a canonical link without the matching Training acknowledgement', async () => {
  reset();
  const person = await createPerson(), trainingUserId = `hist-${randomUUID()}`;
  const proof = await startProof(person, trainingUserId);
  training.mode = 'down'; training.only = '/api/platform/v1/link/activate';
  await member('POST', '/api/me/training/link', proof);
  training.mode = 'ok';
  const [pending] = await linkOf(person.personId);
  assert.equal(pending.status, 'pending');
  await assert.rejects(sql`UPDATE training_account_links SET status='active',link_version=link_version+1 WHERE link_id=${pending.link_id}`, { code: '55000' });
  await assert.rejects(sql`UPDATE training_account_links SET status='active',link_version=link_version+1,training_ack_id='' WHERE link_id=${pending.link_id}`, /check|23514/i);
  await assert.rejects(sql`UPDATE training_account_links SET status='revoked',link_version=link_version+1,revocation_ack_id='x' WHERE link_id=${pending.link_id}`, { code: '55000' });
  await admin('POST', `/api/platform/v1/persons/${person.personId}/training-link/resume`, {});
  await assert.rejects(sql`UPDATE training_account_links SET status='revoked',link_version=link_version+1 WHERE link_id=${pending.link_id}`, { code: '55000' }, 'active cannot jump to revoked');
  await assert.rejects(sql`UPDATE training_account_links SET status='revocation_pending',link_version=link_version+1,training_ack_id='forged' WHERE link_id=${pending.link_id}`, { code: '55000' }, 'acks are immutable');
});

test('revocation: access stops at once; closed for good with Training ACK, an unknown link, or an audited waiver; outage keeps it revocation_pending', async () => {
  reset();
  const person = await createPerson(), trainingUserId = `hist-${randomUUID()}`;
  currentAuth = person.auth;
  assert.equal((await member('DELETE', '/api/me/training/link')).statusCode, 404, 'nothing to revoke');
  assert.equal((await member('POST', '/api/me/training/link', await startProof(person, trainingUserId))).statusCode, 200);
  training.mode = 'down';
  const stuck = await member('DELETE', '/api/me/training/link');
  assert.equal(stuck.statusCode, 202, stuck.body);
  assert.equal((await linkOf(person.personId))[0].status, 'revocation_pending', 'revocation_pending is not an active link');
  assert.equal((await audit(person.personId, 'training.link_revocation_requested')).length, 1);
  training.mode = 'ok';
  const retried = await member('DELETE', '/api/me/training/link');
  assert.equal(retried.statusCode, 200, retried.body);
  const [revoked] = await linkOf(person.personId);
  assert.equal(revoked.status, 'revoked'); assert.match(revoked.revocation_ack_id, /^rack-/);
  assert.equal((await member('DELETE', '/api/me/training/link')).statusCode, 404);
  // A new link after revocation needs a brand-new proof (the old transaction/receipt cannot be reused).
  const again = await startProof(person, trainingUserId);
  assert.equal((await member('POST', '/api/me/training/link', again)).statusCode, 200);
  assert.equal((await linkOf(person.personId))[0].status, 'active');
  // Administrative waiver when Training stays unreachable.
  training.mode = 'down';
  const noWaiver = await admin('POST', `/api/platform/v1/persons/${person.personId}/training-link/revoke`, { reason: 'lost device' });
  assert.equal(noWaiver.statusCode, 202);
  const waived = await admin('POST', `/api/platform/v1/persons/${person.personId}/training-link/revoke`, { reason: 'lost device', waiveAcknowledgement: true });
  assert.equal(waived.statusCode, 200, waived.body); assert.equal(waived.json().waived, true);
  const closed = (await linkOf(person.personId))[0];
  assert.equal(closed.status, 'revoked'); assert.match(closed.revocation_ack_id, /^waived:qa-admin/);
  assert.ok((await audit(person.personId, 'training.link_revoked')).some(row => row.details.waived === true), 'the waiver is audited');
  training.mode = 'ok';
});

test('provisioning: idempotent, one profile per person, resumes after outages, refuses conflicts, never links a duplicate', async () => {
  reset();
  const person = await createPerson(), key = randomUUID();
  const url = `/api/platform/v1/persons/${person.personId}/training-provision`;
  training.mode = 'down';
  const down = await admin('POST', url, { displayName: 'Nuevo Socio' }, { 'idempotency-key': key });
  assert.equal(down.statusCode, 202); assert.equal(down.json().status, 'provisioning_pending');
  training.mode = 'ok';
  const done = await admin('POST', url, { displayName: 'Nuevo Socio' }, { 'idempotency-key': key });
  assert.equal(done.statusCode, 201, done.body); assert.equal(done.json().status, 'active');
  const trainingUserId = done.json().trainingUserId;
  const [link] = await linkOf(person.personId);
  assert.equal(link.status, 'active'); assert.equal(link.method, 'provisioned'); assert.equal(link.training_user_id, trainingUserId);
  const replay = await admin('POST', url, { displayName: 'Nuevo Socio' }, { 'idempotency-key': key });
  assert.equal(replay.statusCode, 201); assert.equal(replay.json().trainingUserId, trainingUserId);
  assert.equal((await linkOf(person.personId)).length, 1);
  assert.equal((await sql`SELECT count(*)::int AS n FROM platform_training_provisioning WHERE person_id=${person.personId}`)[0].n, 1);
  assert.equal((await admin('POST', url, { displayName: 'Otro Nombre' }, { 'idempotency-key': key })).statusCode, 409, 'same key, different request');
  assert.equal((await admin('POST', url, { displayName: 'Nuevo Socio' }, { 'idempotency-key': randomUUID() })).statusCode, 409, 'a second profile for the same person');
  assert.equal((await admin('POST', url, { displayName: '<b>x</b>' }, { 'idempotency-key': randomUUID() })).statusCode, 400);
  assert.equal((await admin('POST', `/api/platform/v1/persons/${randomUUID()}/training-provision`, { displayName: 'Nadie' }, { 'idempotency-key': randomUUID() })).statusCode, 404);
  // ACK outage after provisioning leaves a pending link that can be resumed; the profile is not re-created.
  const second = await createPerson(), key2 = randomUUID(), url2 = `/api/platform/v1/persons/${second.personId}/training-provision`;
  training.refuse = null;
  const originalMode = training.mode;
  training.calls.length = 0;
  training.mode = 'ok';
  const hold = new Promise(resolve => setImmediate(resolve)); await hold;
  const flaky = await admin('POST', url2, { displayName: 'Segundo Socio' }, { 'idempotency-key': key2 });
  assert.equal(flaky.statusCode, 201);
  assert.equal(training.calls.filter(call => call.path === '/api/platform/v1/provision').length, 1);
  training.mode = originalMode;
  // Revoking a provisioned link and provisioning again for the same person is a deliberate admin decision, not an automatic duplicate.
  assert.equal((await admin('POST', `/api/platform/v1/persons/${second.personId}/training-link/revoke`, { reason: 'closed account' })).statusCode, 200);
  assert.equal((await admin('POST', url2, { displayName: 'Segundo Socio' }, { 'idempotency-key': randomUUID() })).statusCode, 409, 'the person already has a Training profile on record');
  assert.equal(training.badSignatures, 0);
});

test('a definitive Training refusal during provisioning is recorded and final; audit trails never contain codes or secrets', async () => {
  reset();
  const person = await createPerson(), key = randomUUID();
  training.refuse = 'already_provisioned';
  const refused = await admin('POST', `/api/platform/v1/persons/${person.personId}/training-provision`, { displayName: 'Rechazado' }, { 'idempotency-key': key });
  assert.equal(refused.statusCode, 409); assert.equal(refused.json().error, 'already_provisioned');
  assert.equal((await sql`SELECT state FROM platform_training_provisioning WHERE idempotency_key=${key}`)[0].state, 'failed');
  training.refuse = null;
  const retry = await admin('POST', `/api/platform/v1/persons/${person.personId}/training-provision`, { displayName: 'Rechazado' }, { 'idempotency-key': key });
  assert.equal(retry.statusCode, 409, 'the failed record is final for that key');
  const dump = JSON.stringify(await sql`SELECT * FROM platform_identity_audit_events WHERE person_id=${person.personId}`);
  assert.ok(!dump.includes(KEY.secret));
});
