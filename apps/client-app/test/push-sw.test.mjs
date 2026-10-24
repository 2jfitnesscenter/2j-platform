import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const handlersPath = new URL('../public/push-sw-handlers.js', import.meta.url);
const workerPath = new URL('../public/service-worker.js', import.meta.url);

test('service worker handles safe same-origin push payloads and notification clicks', async () => {
  const listeners = new Map();
  let shown;
  let focused = false;
  let navigatedTo;
  const windowClient = {
    url: 'https://home.example.test/',
    focus: async () => { focused = true; return windowClient; },
    navigate: async url => { navigatedTo = url; return windowClient; },
  };
  const self = {
    location: { origin: 'https://home.example.test' },
    registration: { showNotification: async (title, options) => { shown = { title, options }; } },
    clients: {
      matchAll: async () => [windowClient],
      openWindow: async () => assert.fail('existing Home window should be reused'),
    },
    addEventListener: (name, handler) => listeners.set(name, handler),
  };
  vm.runInNewContext(await readFile(handlersPath, 'utf8'), { self, URL });

  let pushDone;
  listeners.get('push')({ data: { json: () => ({ title: 'Aviso', body: 'Texto general', url: '/bookings', tag: 'booking' }) }, waitUntil: promise => { pushDone = promise; } });
  await pushDone;
  assert.equal(shown.title, 'Aviso');
  assert.equal(shown.options.body, 'Texto general');
  assert.equal(shown.options.silent, true);
  assert.equal(shown.options.data.url, '/bookings');

  let clickDone;
  let closed = false;
  listeners.get('notificationclick')({ notification: { data: { url: '//evil.example.test/path' }, close: () => { closed = true; } }, waitUntil: promise => { clickDone = promise; } });
  await clickDone;
  assert.equal(closed, true);
  assert.equal(focused, true);
  assert.equal(navigatedTo, 'https://home.example.test/');
});

test('Home service worker imports push handlers and excludes API requests from cache handling', async () => {
  const source = await readFile(workerPath, 'utf8');
  assert.match(source, /^importScripts\('\/push-sw-handlers\.js'\);/);
  assert.match(source, /if \(request\.method !== 'GET' \|\| url\.origin !== self\.location\.origin \|\| url\.pathname\.startsWith\('\/api\/'\)\) return;/);
});
