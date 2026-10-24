import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disablePush, enablePush, pushSupport, urlBase64ToUint8Array } from '../src/push/push-client.ts';

const KEY = Buffer.alloc(65, 4).toString('base64url');          // a fake 65-byte point, built at run time
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
function env(overrides = {}) {
  const calls = [], state = { subscription: null, unsubscribed: false, permission: 'default' };
  const sub = { endpoint: 'https://push.example.test/abc', toJSON: () => ({ endpoint: 'https://push.example.test/abc', keys: { p256dh: 'p'.repeat(40), auth: 'a'.repeat(16) } }), unsubscribe: async () => { state.unsubscribed = true; state.subscription = null; return true; } };
  const server = { config: { enabled: true, vapidPublicKey: KEY, consent: 'unset', activeDevices: 0 } };
  const e = {
    fetch: async (path, init) => { calls.push([init.method, path, init.body ? JSON.parse(init.body) : undefined]); return path.endsWith('/config') ? json(200, server.config) : json(path.endsWith('subscriptions') ? 201 : 200, {}); },
    serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: async () => state.subscription, subscribe: async options => { calls.push(['subscribe', String(options.userVisibleOnly), options.applicationServerKey.length]); state.subscription = sub; return sub; } } }) },
    Notification: { get permission() { return state.permission; }, requestPermission: async () => { state.permission = 'granted'; return 'granted'; } },
    hasPushManager: true, isIos: false, isStandalone: false, userAgent: 'test-agent', ...overrides,
  };
  return { e, calls, state, server };
}

test('support: iOS needs the installed PWA, missing APIs are unsupported, a denied permission is reported', () => {
  assert.equal(pushSupport(env().e), 'supported');
  assert.equal(pushSupport(env({ isIos: true, isStandalone: false }).e), 'needs-install');
  assert.equal(pushSupport(env({ isIos: true, isStandalone: true }).e), 'supported');
  assert.equal(pushSupport(env({ hasPushManager: false }).e), 'unsupported');
  assert.equal(pushSupport(env({ serviceWorker: undefined }).e), 'unsupported');
  const denied = env(); denied.state.permission = 'denied';
  assert.equal(pushSupport(denied.e), 'denied');
});

test('enable: asks the center first, the browser second, records consent, subscribes with the VAPID key and registers the device', async () => {
  const { e, calls } = env();
  assert.equal(await enablePush(e), 'enabled');
  assert.deepEqual(calls.map(call => `${call[0]} ${call[1]} ${call[2] && typeof call[2] === 'number' ? call[2] : ''}`.trim()), ['GET /api/me/push/config', 'PUT /api/me/push/consent', 'subscribe true 65', 'POST /api/me/push/subscriptions']);
  assert.deepEqual(calls[1][2], { granted: true });
  assert.deepEqual(Object.keys(calls[3][2]).sort(), ['endpoint', 'keys', 'userAgent']);
});

test('enable: does nothing while the center has push off, when unsupported, and when the person refuses the browser prompt', async () => {
  const off = env(); off.server.config = { enabled: false };
  assert.equal(await enablePush(off.e), 'disabled-by-center');
  assert.equal(off.calls.filter(call => call[0] === 'PUT' || call[0] === 'POST').length, 0, 'no consent, no subscription');
  assert.equal(await enablePush(env({ isIos: true }).e), 'needs-install');
  const refused = env(); refused.e.Notification.requestPermission = async () => 'denied';
  assert.equal(await enablePush(refused.e), 'denied');
  assert.equal(refused.calls.filter(call => call[0] === 'PUT').length, 0, 'consent is recorded only after the browser agrees');
});

test('disable: withdraws consent on the server and drops this browser subscription', async () => {
  const { e, calls, state } = env();
  await enablePush(e);
  await disablePush(e);
  assert.deepEqual(calls.filter(call => call[0] === 'PUT').at(-1)[2], { granted: false });
  assert.equal(state.unsubscribed, true);
});

test('base64url VAPID keys decode to the 65 bytes of an uncompressed P-256 point', () => {
  assert.equal(urlBase64ToUint8Array(KEY).length, 65);
});
