import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: link review integration tests need PostgreSQL.');
const sql = postgres(process.env.DATABASE_URL, { max: 6, connect_timeout: 5 });
await migrateDatabase(sql);

const ORIGIN = 'http://127.0.0.1:5173';
const people = new Map();                // x-test-person -> { personId, ... }
const roles = new Map();                 // x-test-role -> { actorId, role }
const options = { memberAppOrigin: ORIGIN, resolvePersonAuth: async request => people.get(String(request.headers['x-test-person'] ?? '')) ?? null, authorizationResolver: async request => roles.get(String(request.headers['x-test-role'] ?? '')) ?? null };
const on = buildServer(process.env.DATABASE_URL, { ...options, trainingLinkReviewEnabled: true });
const off = buildServer(process.env.DATABASE_URL, options);
roles.set('admin', { actorId: 'review-admin', role: 'admin' }); roles.set('trainer', { actorId: 'review-trainer', role: 'trainer' });
after(async () => { await on.close(); await off.close(); await sql.end({ timeout: 2 }); });

async function member(name = 'Lia') {
  const personId = randomUUID(), clientId = randomUUID();
  await sql`INSERT INTO clients(id,first_name,last_name,status) VALUES (${clientId}::uuid,${name},${`Review ${randomUUID().slice(0, 6)}`},'active')`;
  await sql`INSERT INTO platform_persons(id,status,created_by) VALUES (${personId}::uuid,'active','review-test')`;
  await sql`INSERT INTO platform_person_clients(person_id,client_id,linked_by) VALUES (${personId}::uuid,${clientId}::uuid,'review-test')`;
  const key = `p-${randomUUID()}`;
  people.set(key, { personId, provider: 'fixture-central-auth', providerVersion: 1, authSubject: `s-${randomUUID()}` });
  return { personId, header: { 'x-test-person': key, origin: ORIGIN } };
}
const open = (who, payload = { reason: 'lost_passkey', note: 'Perdí el móvil' }) => on.inject({ method: 'POST', url: '/api/me/training/link-review', headers: who.header, payload });
const resolve = (id, payload, role = 'admin') => on.inject({ method: 'POST', url: `/api/platform/v1/training-link-review/${id}/resolve`, headers: { 'x-test-role': role }, payload });
const approval = (extra = {}) => ({ action: 'approve', note: 'Verificado en persona con DNI en recepción', verification: { method: 'in_person' }, trainingUserId: `training-${randomUUID()}`, ...extra });

test('it does nothing unless explicitly enabled: every route answers 423', async () => {
  const who = await member();
  for (const [method, url, headers, payload] of [['POST', '/api/me/training/link-review', who.header, { reason: 'other' }], ['GET', '/api/me/training/link-review', who.header], ['GET', '/api/platform/v1/training-link-review', { 'x-test-role': 'admin' }], ['GET', `/api/platform/v1/training-link-review/${randomUUID()}`, { 'x-test-role': 'admin' }], ['POST', `/api/platform/v1/training-link-review/${randomUUID()}/resolve`, { 'x-test-role': 'admin' }, approval()]]) {
    assert.equal((await off.inject({ method, url, headers, ...(payload ? { payload } : {}) })).statusCode, 423, `${method} ${url}`);
  }
});

test('member: authenticated, same-origin, strict body; one open case per person; the answer never names a Training account', async () => {
  const who = await member();
  assert.equal((await on.inject({ method: 'POST', url: '/api/me/training/link-review', headers: { origin: ORIGIN }, payload: { reason: 'lost_passkey' } })).statusCode, 401);
  assert.equal((await open({ header: { ...who.header, origin: 'https://evil.example' } })).statusCode, 403);
  assert.equal((await open(who, { reason: 'lost_passkey', trainingUserId: 'someone-else' })).statusCode, 400, 'a member cannot name a Training account');
  assert.equal((await open(who, { reason: 'bogus' })).statusCode, 400);
  assert.equal((await open(who, { reason: 'other', note: 'x'.repeat(501) })).statusCode, 400);
  const first = await open(who); assert.equal(first.statusCode, 201, first.body);
  const again = await open(who); assert.equal(again.statusCode, 200); assert.deepEqual({ id: again.json().id, created: again.json().created }, { id: first.json().id, created: false });
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM training_link_review_cases WHERE person_id=${who.personId}::uuid`;
  assert.equal(n, 1);
  const mine = (await on.inject({ method: 'GET', url: '/api/me/training/link-review', headers: who.header })).json();
  assert.deepEqual(Object.keys(mine.case).sort(), ['createdAt', 'id', 'reason', 'resolvedAt', 'status']);
  assert.equal((await on.inject({ method: 'GET', url: '/api/me/training/link-review' })).statusCode, 401);
});

test('member: someone who already has (or is getting) a link has nothing to review', async () => {
  const who = await member();
  await sql`INSERT INTO training_account_links(request_id,person_id,training_user_id,method,created_by,updated_by) VALUES (${randomUUID()},${who.personId}::uuid,${`t-${randomUUID()}`},'explicit_admin','review-test','review-test')`;
  const response = await open(who);
  assert.equal(response.statusCode, 409); assert.equal(response.json().error, 'link_already_in_progress_or_active');
});

test('admin queue: only administrators (not trainers, not anonymous); the case shows who the person is; resolution notes stay internal', async () => {
  const who = await member('Nerea'); const { id } = (await open(who)).json();
  assert.equal((await on.inject({ method: 'GET', url: '/api/platform/v1/training-link-review' })).statusCode, 401);
  assert.equal((await on.inject({ method: 'GET', url: '/api/platform/v1/training-link-review', headers: { 'x-test-role': 'trainer' } })).statusCode, 403, 'D143: trainers do not resolve');
  assert.equal((await resolve(id, approval(), 'trainer')).statusCode, 403);
  const list = (await on.inject({ method: 'GET', url: '/api/platform/v1/training-link-review?status=open&limit=200', headers: { 'x-test-role': 'admin' } })).json();
  const row = list.cases.find(item => item.id === id);
  assert.equal(row.personId, who.personId); assert.match(row.person.displayName, /^Nerea /); assert.equal(row.status, 'open');
  assert.equal((await on.inject({ method: 'GET', url: '/api/platform/v1/training-link-review?status=bogus', headers: { 'x-test-role': 'admin' } })).statusCode, 400);
  const detail = (await on.inject({ method: 'GET', url: `/api/platform/v1/training-link-review/${id}`, headers: { 'x-test-role': 'admin' } })).json();
  assert.deepEqual(detail.events.map(event => event.action), ['opened']);
  assert.equal((await on.inject({ method: 'GET', url: `/api/platform/v1/training-link-review/${randomUUID()}`, headers: { 'x-test-role': 'admin' } })).statusCode, 404);
});

test('resolve: approval needs an identity check, a note and the Training user; reject/dismiss need a note and carry nothing else; strict bodies', async () => {
  const who = await member(); const { id } = (await open(who)).json();
  for (const [payload, label] of [[{ action: 'approve', note: 'Verificado en persona con DNI' }, 'approve without verification and user'], [approval({ verification: undefined }), 'approve without verification'], [approval({ trainingUserId: undefined }), 'approve without user'],
    [approval({ note: 'corto' }), 'note too short'], [approval({ extra: 1 }), 'unknown field'], [approval({ trainingUserId: 'bad\u0000id' }), 'control characters'], [{ action: 'reject', note: 'No se pudo comprobar la identidad', trainingUserId: 'x' }, 'reject carrying a user'],
    [{ action: 'dismiss', note: 'Duplicado de otro caso ya resuelto', verification: { method: 'in_person' } }, 'dismiss carrying a verification'], [{ action: 'merge', note: 'una nota suficientemente larga' }, 'unknown action']]) {
    assert.equal((await resolve(id, payload)).statusCode, 400, label);
  }
  assert.equal((await sql`SELECT status FROM training_link_review_cases WHERE id=${id}::uuid`)[0].status, 'open', 'nothing changed');
});

test('resolve: approval records the decision but creates NO link; it is idempotent, final, and refuses an already-linked Training user or person', async () => {
  const who = await member(); const { id } = (await open(who)).json();
  const body = approval();
  const approved = await resolve(id, body);
  assert.equal(approved.statusCode, 200, approved.body);
  assert.deepEqual({ status: approved.json().status, replay: approved.json().replay, next: approved.json().nextStep }, { status: 'approved', replay: false, next: 'admin_link' });
  const [{ links }] = await sql`SELECT count(*)::int AS links FROM training_account_links WHERE person_id=${who.personId}::uuid`;
  assert.equal(links, 0, 'the review never links by itself');
  const [stored] = await sql`SELECT status,training_user_id,verification_method,resolved_by,resolution_note FROM training_link_review_cases WHERE id=${id}::uuid`;
  assert.deepEqual({ status: stored.status, uid: stored.training_user_id, method: stored.verification_method, by: stored.resolved_by }, { status: 'approved', uid: body.trainingUserId, method: 'in_person', by: 'review-admin' });
  const replay = await resolve(id, body); assert.equal(replay.statusCode, 200); assert.equal(replay.json().replay, true);
  assert.equal((await resolve(id, approval())).statusCode, 409, 'a different Training user for a resolved case');
  assert.equal((await resolve(id, { action: 'reject', note: 'Cambio de opinión del administrador' })).statusCode, 409, 'a resolved case is final');
  assert.deepEqual((await sql`SELECT action,actor FROM training_link_review_events WHERE case_id=${id}::uuid ORDER BY occurred_at,id`).map(row => `${row.action}:${row.actor.startsWith('person:') ? 'person' : row.actor}`), ['opened:person', 'approved:review-admin']);
  // The member can ask again after a resolution (a new case), and the original stays as it was.
  const second = await open(who); assert.equal(second.statusCode, 201); assert.notEqual(second.json().id, id);
  // A Training user that already belongs to another person, and a person that already has a link, cannot be approved.
  const other = await member(); const otherCase = (await open(other)).json().id;
  const takenUid = `taken-${randomUUID()}`;
  const holder = await member();
  await sql`INSERT INTO training_account_links(request_id,person_id,training_user_id,method,created_by,updated_by) VALUES (${randomUUID()},${holder.personId}::uuid,${takenUid},'explicit_admin','review-test','review-test')`;
  const taken = await resolve(otherCase, approval({ trainingUserId: takenUid })); assert.equal(taken.statusCode, 409); assert.equal(taken.json().error, 'training_identity_already_linked');
  const linkedLater = await member(); const linkedCase = (await open(linkedLater)).json().id;
  await sql`INSERT INTO training_account_links(request_id,person_id,training_user_id,method,created_by,updated_by) VALUES (${randomUUID()},${linkedLater.personId}::uuid,${`mine-${randomUUID()}`},'explicit_admin','review-test','review-test')`;
  const already = await resolve(linkedCase, approval()); assert.equal(already.statusCode, 409); assert.equal(already.json().error, 'person_already_linked');
});

test('resolve: reject and dismiss close the case with a note; the database refuses to edit history or a resolved case', async () => {
  const a = await member(), b = await member();
  const caseA = (await open(a)).json().id, caseB = (await open(b)).json().id;
  assert.equal((await resolve(caseA, { action: 'reject', note: 'No se pudo comprobar la titularidad' })).json().status, 'rejected');
  assert.equal((await resolve(caseB, { action: 'dismiss', note: 'La persona ya resolvió con su passkey' })).json().status, 'dismissed');
  await assert.rejects(() => sql`UPDATE training_link_review_cases SET status='open',resolved_at=NULL,resolved_by=NULL WHERE id=${caseA}::uuid`, /final|55000/);
  await assert.rejects(() => sql`DELETE FROM training_link_review_cases WHERE id=${caseA}::uuid`, /retained|55000/);
  await assert.rejects(() => sql`UPDATE training_link_review_events SET actor='someone' WHERE case_id=${caseA}::uuid`, /append-only/);
  await assert.rejects(() => sql`DELETE FROM training_link_review_events WHERE case_id=${caseA}::uuid`, /append-only/);
  const c = await member(); const openedC = await open(c); assert.equal(openedC.statusCode, 201, openedC.body); const caseC = openedC.json().id;
  await assert.rejects(() => sql`UPDATE training_link_review_cases SET reason='other' WHERE id=${caseC}::uuid`, /immutable|55000/);
  await assert.rejects(() => sql`UPDATE training_link_review_cases SET status='approved',resolved_at=now(),resolved_by='x',resolution_note='una nota suficientemente larga' WHERE id=${caseC}::uuid`, /training_link_review_approval_check|violates check/);
});
