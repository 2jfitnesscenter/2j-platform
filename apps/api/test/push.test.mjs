import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import webpush from 'web-push';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { PUSH_KINDS, PushIntentError, createPushService, enqueuePushIntent } from '../src/push.ts';
import { createWebPushProvider, generateVapidKeys } from '../src/push-web-provider.ts';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: push integration tests need PostgreSQL.');
const sql = postgres(process.env.DATABASE_URL, { max: 8, connect_timeout: 5 });
await migrateDatabase(sql);

const ORIGIN = 'http://127.0.0.1:5173';
const admin = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'push-test-admin', role: 'admin' }) });
const sessions = new Map();           // test "session": header x-test-client -> { clientId, personId }
const resolver = async request => sessions.get(String(request.headers['x-test-client'] ?? '')) ?? null;

/** A scripted push provider: records what would be sent and answers per endpoint. */
function fakeProvider() {
  const sent = [], script = new Map();
  return { sent, script, send: async (subscription, payload) => {
    sent.push({ endpoint: subscription.endpoint, payload });
    const next = script.get(subscription.endpoint)?.shift();
    return next ?? { ok: true };
  } };
}
const makeMember = async name => {
  const response = await admin.inject({ method: 'POST', url: '/api/clients', headers: { 'idempotency-key': randomUUID() }, payload: { firstName: name, lastName: `Push ${randomUUID().slice(0, 8)}` } });
  assert.equal(response.statusCode, 201, response.body);
  const client = response.json(), personId = randomUUID();
  await sql`INSERT INTO platform_persons(id,status,created_by) VALUES (${personId}::uuid,'active','push-test')`;
  await sql`INSERT INTO platform_person_clients(person_id,client_id,linked_by) VALUES (${personId}::uuid,${client.id}::uuid,'push-test')`;
  sessions.set(client.id, { clientId: client.id, personId });
  return { clientId: client.id, personId, header: { 'x-test-client': client.id, origin: ORIGIN } };
};
const fakeKey = length => Buffer.alloc(length, 7).toString('base64url');
const subscription = (n = 'a') => ({ endpoint: `https://push.example.test/send/${n}-${randomUUID()}`, keys: { p256dh: fakeKey(65), auth: fakeKey(16) } });
const apps = [];
const appWith = (provider, extra = {}) => {
  const app = buildServer(process.env.DATABASE_URL, { clientAuthorizationResolver: resolver, memberAppOrigin: ORIGIN, pushEnabled: true, pushProvider: provider, pushVapidPublicKey: 'public-key-for-tests', ...extra });
  apps.push(app); return app;
};
const service = (provider, extra = {}) => createPushService(sql, { enabled: true, provider, retryDelaySeconds: 0, ...extra });

after(async () => { for (const app of apps) await app.close(); await admin.close(); await sql.end({ timeout: 2 }); });

test('it does nothing unless explicitly enabled: routes answer 423 and nothing is ever sent', async () => {
  const member = await makeMember('Off');
  const provider = fakeProvider();
  const off = buildServer(process.env.DATABASE_URL, { clientAuthorizationResolver: resolver, memberAppOrigin: ORIGIN, pushProvider: provider });
  apps.push(off);
  assert.deepEqual((await off.inject({ method: 'GET', url: '/api/me/push/config', headers: member.header })).json(), { enabled: false });
  for (const [method, url, payload] of [['PUT', '/api/me/push/consent', { granted: true }], ['POST', '/api/me/push/subscriptions', subscription()], ['DELETE', '/api/me/push/subscriptions', { endpoint: 'https://x.example.test/abcdefghij' }]]) {
    assert.equal((await off.inject({ method, url, headers: member.header, payload })).statusCode, 423, `${method} ${url}`);
  }
  const disabled = createPushService(sql, { enabled: false, provider });
  await enqueuePushIntent(sql, { personId: member.personId, kind: 'waitlist.promoted', dedupeKey: `off-${randomUUID()}` });
  assert.deepEqual(await disabled.dispatch(), { processed: 0 });
  assert.equal(provider.sent.length, 0);
  assert.throws(() => buildServer(process.env.DATABASE_URL, { pushEnabled: true }), /PUSH_VAPID_PUBLIC_KEY/);
});

test('member routes: authenticated, same-origin, consent first, the person always comes from the session', async () => {
  const member = await makeMember('Routes'), other = await makeMember('Other');
  const app = appWith(fakeProvider());
  const anonymous = await app.inject({ method: 'GET', url: '/api/me/push/config' });
  assert.equal(anonymous.statusCode, 401);
  assert.equal((await app.inject({ method: 'PUT', url: '/api/me/push/consent', headers: { ...member.header, origin: 'https://evil.example' }, payload: { granted: true } })).statusCode, 403);
  const config = (await app.inject({ method: 'GET', url: '/api/me/push/config', headers: member.header })).json();
  assert.deepEqual(config, { enabled: true, vapidPublicKey: 'public-key-for-tests', consent: 'unset', activeDevices: 0 });
  const mine = subscription('mine');
  assert.equal((await app.inject({ method: 'POST', url: '/api/me/push/subscriptions', headers: member.header, payload: mine })).statusCode, 409, 'no subscription without consent');
  assert.equal((await app.inject({ method: 'PUT', url: '/api/me/push/consent', headers: member.header, payload: { granted: true, personId: other.personId } })).statusCode, 400, 'strict body: no person in the body');
  assert.deepEqual((await app.inject({ method: 'PUT', url: '/api/me/push/consent', headers: member.header, payload: { granted: true } })).json(), { consent: 'granted' });
  assert.equal((await app.inject({ method: 'POST', url: '/api/me/push/subscriptions', headers: member.header, payload: { ...mine, extra: 1 } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/me/push/subscriptions', headers: member.header, payload: { ...mine, endpoint: 'http://insecure.example.test/x/yyyyyyyyyy' } })).statusCode, 400, 'https only');
  assert.equal((await app.inject({ method: 'POST', url: '/api/me/push/subscriptions', headers: member.header, payload: mine })).statusCode, 201);
  assert.equal((await app.inject({ method: 'POST', url: '/api/me/push/subscriptions', headers: member.header, payload: mine })).statusCode, 201, 'idempotent per endpoint');
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM platform_push_subscriptions WHERE person_id=${member.personId}::uuid AND status='active'`;
  assert.equal(n, 1);
  assert.equal((await app.inject({ method: 'GET', url: '/api/me/push/config', headers: member.header })).json().activeDevices, 1);
  assert.equal((await app.inject({ method: 'GET', url: '/api/me/push/config', headers: other.header })).json().activeDevices, 0, 'another member sees nothing of it');
  assert.deepEqual((await app.inject({ method: 'DELETE', url: '/api/me/push/subscriptions', headers: member.header, payload: { endpoint: mine.endpoint } })).json(), { removed: true });
  assert.deepEqual((await app.inject({ method: 'DELETE', url: '/api/me/push/subscriptions', headers: member.header, payload: { endpoint: mine.endpoint } })).json(), { removed: false });
});

test('withdrawing consent switches every device off at once and is recorded; an endpoint moves to the person who registered it last', async () => {
  const first = await makeMember('Shared1'), second = await makeMember('Shared2');
  const app = appWith(fakeProvider());
  const device = subscription('shared');
  for (const member of [first, second]) await app.inject({ method: 'PUT', url: '/api/me/push/consent', headers: member.header, payload: { granted: true } });
  assert.equal((await app.inject({ method: 'POST', url: '/api/me/push/subscriptions', headers: first.header, payload: device })).statusCode, 201);
  assert.equal((await app.inject({ method: 'POST', url: '/api/me/push/subscriptions', headers: second.header, payload: device })).statusCode, 201);
  const [row] = await sql`SELECT person_id FROM platform_push_subscriptions WHERE endpoint=${device.endpoint}`;
  assert.equal(String(row.person_id), second.personId, 'a shared browser belongs to whoever is signed in');
  await app.inject({ method: 'POST', url: '/api/me/push/subscriptions', headers: second.header, payload: subscription('second-phone') });
  assert.deepEqual((await app.inject({ method: 'PUT', url: '/api/me/push/consent', headers: second.header, payload: { granted: false } })).json(), { consent: 'revoked' });
  const [{ active }] = await sql`SELECT count(*)::int AS active FROM platform_push_subscriptions WHERE person_id=${second.personId}::uuid AND status='active'`;
  assert.equal(active, 0);
  const events = await sql`SELECT action FROM platform_push_consent_events WHERE person_id=${second.personId}::uuid ORDER BY occurred_at,id`;
  assert.deepEqual(events.map(event => event.action), ['granted', 'revoked']);
  await assert.rejects(() => sql`UPDATE platform_push_consent_events SET action='granted' WHERE person_id=${second.personId}::uuid`, /append-only/);
  await assert.rejects(() => sql`DELETE FROM platform_push_consent_events WHERE person_id=${second.personId}::uuid`, /append-only/);
});

test('the intent API: only approved kinds with FIXED generic texts, integer params only, idempotent per person+key, joins the caller transaction', async () => {
  const member = await makeMember('Intent');
  const key = `k-${randomUUID()}`;
  assert.deepEqual(Object.keys(PUSH_KINDS).sort(), ['booking.cancelled_by_membership', 'booking.recovered', 'document.rejected', 'document.requested', 'waitlist.promoted', 'waitlist.suspended']);
  const created = await enqueuePushIntent(sql, { personId: member.personId, kind: 'waitlist.promoted', dedupeKey: key });
  const again = await enqueuePushIntent(sql, { personId: member.personId, kind: 'waitlist.promoted', dedupeKey: key });
  assert.equal(created.created, true); assert.equal(again.created, false); assert.equal(again.intentId, created.intentId);
  for (const [patch, code] of [[{ kind: 'booking.confirmed' }, 'unknown_push_kind'], [{ kind: 'evaluation.published' }, 'unknown_push_kind'], [{ kind: 'toString' }, 'unknown_push_kind'], [{ kind: '__proto__' }, 'unknown_push_kind'],
    [{ params: { count: -1 } }, 'invalid_params'], [{ params: { count: 1.5 } }, 'invalid_params'], [{ params: { count: 1000 } }, 'invalid_params'], [{ params: { count: '3' } }, 'invalid_params'], [{ params: { name: 'Ana' } }, 'invalid_params'], [{ personId: 'nope' }, 'invalid_person'], [{ dedupeKey: '' }, 'invalid_dedupe_key']]) {
    await assert.rejects(() => enqueuePushIntent(sql, { personId: member.personId, kind: 'waitlist.promoted', dedupeKey: `bad-${randomUUID()}`, ...patch }), error => error instanceof PushIntentError && error.code === code, JSON.stringify(patch));
  }
  // The text can only be one of the written templates: no names, amounts or health data can reach a lock screen, whatever the caller does.
  const stored = async (kind, params) => { const { intentId } = await enqueuePushIntent(sql, { personId: member.personId, kind, dedupeKey: `t-${randomUUID()}`, ...(params ? { params } : {}) }); const [row] = await sql`SELECT title, body, url FROM platform_push_intents WHERE id=${intentId}::uuid`; return row; };
  assert.deepEqual(await stored('booking.cancelled_by_membership', { count: 1 }), { title: 'Reservas canceladas', body: 'Se ha cancelado 1 reserva por un cambio en tu cuota.', url: '/reservas' });
  assert.equal((await stored('booking.cancelled_by_membership', { count: 3 })).body, 'Se han cancelado 3 reservas por un cambio en tu cuota.');
  assert.equal((await stored('booking.recovered', { recovered: 2, notRecovered: 1 })).body, 'Se han recuperado 2 reservas y 1 no ha podido recuperarse.');
  assert.equal((await stored('waitlist.promoted', { count: 2 })).body, 'Se te ha asignado una plaza. Se han cancelado 2 esperas que se solapaban.');
  assert.equal((await stored('waitlist.promoted')).body, 'Se te ha asignado una plaza desde la lista de espera.');
  const everyText = [];
  for (const kind of Object.keys(PUSH_KINDS)) { const row = await stored(kind, { count: 2, recovered: 1, notRecovered: 1 }); everyText.push(row.title, row.body); }
  for (const text of everyText) assert.doesNotMatch(text, /[€$]|\d+[.,]\d{2}|salud|lesi[oó]n|m[eé]dic|diagn/i, text);
  // Atomic with the business event: a rolled-back transaction leaves no intent behind.
  const rolledBack = `rb-${randomUUID()}`;
  await assert.rejects(() => sql.begin(async tx => { await enqueuePushIntent(tx, { personId: member.personId, kind: 'waitlist.promoted', dedupeKey: rolledBack }); throw new Error('business failure'); }), /business failure/);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM platform_push_intents WHERE dedupe_key=${rolledBack}`;
  assert.equal(n, 0);
});

test('delivery: every active device gets it, the attempt is logged, dead tokens are discarded, regular needs consent and every kind needs a device', async () => {
  const member = await makeMember('Deliver');
  const provider = fakeProvider(), push = service(provider);
  const phone = subscription('phone'), laptop = subscription('laptop');
  const app = appWith(provider);
  await app.inject({ method: 'PUT', url: '/api/me/push/consent', headers: member.header, payload: { granted: true } });
  for (const device of [phone, laptop]) await app.inject({ method: 'POST', url: '/api/me/push/subscriptions', headers: member.header, payload: device });
  provider.script.set(laptop.endpoint, [{ ok: false, status: 410, code: 'http_410', gone: true, retryable: false }]);
  const { intentId } = await enqueuePushIntent(sql, { personId: member.personId, kind: 'booking.cancelled_by_membership', dedupeKey: `d-${randomUUID()}`, params: { count: 3 } });
  await push.dispatch();
  const [intent] = await sql`SELECT status, attempts FROM platform_push_intents WHERE id=${intentId}::uuid`;
  assert.deepEqual({ status: intent.status, attempts: intent.attempts }, { status: 'sent', attempts: 1 });
  const deliveries = await sql`SELECT d.status, d.http_status, s.endpoint FROM platform_push_deliveries d JOIN platform_push_subscriptions s ON s.id=d.subscription_id WHERE d.intent_id=${intentId}::uuid`;
  assert.equal(deliveries.find(row => row.endpoint === phone.endpoint).status, 'sent');
  assert.equal(deliveries.find(row => row.endpoint === laptop.endpoint).status, 'gone');
  assert.equal((await sql`SELECT status FROM platform_push_subscriptions WHERE endpoint=${laptop.endpoint}`)[0].status, 'invalid', 'a dead token is discarded');
  const sentPayload = provider.sent.find(entry => entry.endpoint === phone.endpoint).payload;
  assert.deepEqual(Object.keys(sentPayload).sort(), ['body', 'kind', 'tag', 'title', 'url']);
  // Consent withdrawn: essential still reaches the (re-registered) device, regular does not.
  await app.inject({ method: 'PUT', url: '/api/me/push/consent', headers: member.header, payload: { granted: false } });
  const regular = await enqueuePushIntent(sql, { personId: member.personId, kind: 'document.requested', dedupeKey: `r-${randomUUID()}` });
  await push.dispatch();
  assert.equal((await sql`SELECT status FROM platform_push_intents WHERE id=${regular.intentId}::uuid`)[0].status, 'skipped_no_consent');
  const essential = await enqueuePushIntent(sql, { personId: member.personId, kind: 'waitlist.promoted', dedupeKey: `e-${randomUUID()}` });
  await push.dispatch();
  assert.equal((await sql`SELECT status FROM platform_push_intents WHERE id=${essential.intentId}::uuid`)[0].status, 'skipped_no_subscription', 'essential needs a device; consent withdrawal switched every device off');
});

test('retry: one retry after a transient failure, never to a device that already received it; then it gives up', async () => {
  const member = await makeMember('Retry');
  const provider = fakeProvider(), push = service(provider);
  const app = appWith(provider);
  const good = subscription('good'), flaky = subscription('flaky');
  await app.inject({ method: 'PUT', url: '/api/me/push/consent', headers: member.header, payload: { granted: true } });
  for (const device of [good, flaky]) await app.inject({ method: 'POST', url: '/api/me/push/subscriptions', headers: member.header, payload: device });
  const transient = { ok: false, status: 503, code: 'http_503', gone: false, retryable: true };
  provider.script.set(flaky.endpoint, [transient, { ok: true }]);
  const first = await enqueuePushIntent(sql, { personId: member.personId, kind: 'waitlist.promoted', dedupeKey: `t-${randomUUID()}` });
  await push.dispatch();
  assert.equal((await sql`SELECT status FROM platform_push_intents WHERE id=${first.intentId}::uuid`)[0].status, 'pending', 'waits for its retry');
  await push.dispatch();
  assert.equal((await sql`SELECT status, attempts FROM platform_push_intents WHERE id=${first.intentId}::uuid`)[0].status, 'sent');
  assert.equal(provider.sent.filter(entry => entry.endpoint === good.endpoint && entry.payload.tag === first.intentId).length, 1, 'the healthy device is not pushed twice');
  assert.equal(provider.sent.filter(entry => entry.endpoint === flaky.endpoint && entry.payload.tag === first.intentId).length, 2);
  // Gives up after the single retry.
  provider.script.set(flaky.endpoint, [transient, transient]); provider.script.set(good.endpoint, [{ ok: false, status: 500, code: 'http_500', gone: false, retryable: true }, { ok: false, status: 500, code: 'http_500', gone: false, retryable: true }]);
  const second = await enqueuePushIntent(sql, { personId: member.personId, kind: 'waitlist.promoted', dedupeKey: `t2-${randomUUID()}` });
  await push.dispatch(); await push.dispatch(); await push.dispatch();
  assert.deepEqual((await sql`SELECT status, attempts FROM platform_push_intents WHERE id=${second.intentId}::uuid`).map(row => [row.status, row.attempts]), [['failed', 2]]);
  assert.equal((await sql`SELECT count(*)::int AS n FROM platform_push_deliveries WHERE intent_id=${second.intentId}::uuid`)[0].n, 4, 'every attempt is logged');
});

test('expired intents are not sent; two dispatchers never send the same intent; a provider that throws is a retryable failure', async () => {
  const member = await makeMember('Race');
  const provider = fakeProvider();
  const app = appWith(provider);
  const device = subscription('race');
  await app.inject({ method: 'PUT', url: '/api/me/push/consent', headers: member.header, payload: { granted: true } });
  await app.inject({ method: 'POST', url: '/api/me/push/subscriptions', headers: member.header, payload: device });
  const old = await enqueuePushIntent(sql, { personId: member.personId, kind: 'waitlist.promoted', dedupeKey: `x-${randomUUID()}` });
  await sql`UPDATE platform_push_intents SET expires_at=now()-interval '1 minute' WHERE id=${old.intentId}::uuid`;
  const fresh = await enqueuePushIntent(sql, { personId: member.personId, kind: 'waitlist.promoted', dedupeKey: `y-${randomUUID()}` });
  await Promise.all([service(provider).dispatch(), service(provider).dispatch(), service(provider).dispatch()]);
  assert.equal((await sql`SELECT status FROM platform_push_intents WHERE id=${old.intentId}::uuid`)[0].status, 'expired');
  assert.equal((await sql`SELECT status FROM platform_push_intents WHERE id=${fresh.intentId}::uuid`)[0].status, 'sent');
  assert.equal(provider.sent.filter(entry => entry.payload.tag === fresh.intentId).length, 1, 'exactly one send across three concurrent dispatchers');
  const throwing = { send: async () => { throw new Error('boom'); } };
  const again = await enqueuePushIntent(sql, { personId: member.personId, kind: 'waitlist.promoted', dedupeKey: `z-${randomUUID()}` });
  await service(throwing).dispatch();
  assert.equal((await sql`SELECT status FROM platform_push_intents WHERE id=${again.intentId}::uuid`)[0].status, 'pending');
});

test('the Web Push provider validates its VAPID configuration and maps push-service answers (404/410 gone, 429/5xx/network retryable, other 4xx final)', async () => {
  const keys = generateVapidKeys();
  assert.throws(() => createWebPushProvider({ ...keys, subject: 'http://insecure.example' }), /PUSH_VAPID_SUBJECT/);
  const provider = createWebPushProvider({ publicKey: keys.publicKey, privateKey: keys.privateKey, subject: 'mailto:push@example.test' });
  const target = { endpoint: 'https://push.example.test/send/abcdefghijklmnop', keys: { p256dh: fakeKey(65), auth: fakeKey(16) } };
  const payload = { title: "x", body: "y", url: null, kind: 'waitlist.promoted', tag: 'abc' };
  const original = webpush.sendNotification;
  const answer = outcome => { webpush.sendNotification = async (...args) => { calls.push(args); if (outcome === 'ok') return {}; throw outcome === 'network' ? new Error('ECONNRESET') : Object.assign(new Error('push service'), { statusCode: outcome }); }; };
  const calls = [];
  try {
    answer('ok'); assert.deepEqual(await provider.send(target, payload, { ttlSeconds: 60 }), { ok: true });
    const [, body, options] = calls[0];
    assert.deepEqual(Object.keys(JSON.parse(body)).sort(), ['body', 'kind', 'lang', 'silent', 'tag', 'title', 'url']);
    assert.equal(options.TTL, 60);
    for (const [outcome, expected] of [[404, { gone: true, retryable: false }], [410, { gone: true, retryable: false }], [429, { gone: false, retryable: true }], [503, { gone: false, retryable: true }], ['network', { gone: false, retryable: true }], [400, { gone: false, retryable: false }], [401, { gone: false, retryable: false }]]) {
      answer(outcome);
      const result = await provider.send(target, payload, { ttlSeconds: 60 });
      assert.equal(result.ok, false); assert.equal(result.gone, expected.gone, String(outcome)); assert.equal(result.retryable, expected.retryable, String(outcome));
    }
  } finally { webpush.sendNotification = original; }
});
