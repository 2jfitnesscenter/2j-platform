import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#home' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
const { takeDeepLink } = await import('../src/deep-link.ts');
afterEach(() => { dom.window.location.hash = '#home'; });
after(() => dom.window.close());

test('takeDeepLink returns the requested parameters once and removes only them from the URL, keeping the rest', () => {
  dom.window.location.hash = '#clients?new=1&clientId=abc&intent=message';
  assert.deepEqual(takeDeepLink(['new', 'intent']), { new: '1', intent: 'message' });
  assert.equal(dom.window.location.hash, '#clients?clientId=abc');
  assert.deepEqual(takeDeepLink(['new', 'intent']), {}, 'a second read finds nothing: the action never repeats');
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

test('takeDeepLink drops the question mark when nothing else remains and ignores other keys', () => {
  dom.window.location.hash = '#store?sale=1';
  assert.deepEqual(takeDeepLink(['sale']), { sale: '1' });
  assert.equal(dom.window.location.hash, '#store');
  dom.window.location.hash = '#calendar?foo=bar';
  assert.deepEqual(takeDeepLink(['book']), {});
  assert.equal(dom.window.location.hash, '#calendar?foo=bar', 'unknown parameters are left alone');
});

test('cleaning the link never fires hashchange, so the router does not react and Back does not reopen the dialog', async () => {
  let fired = 0;
  dom.window.addEventListener('hashchange', () => { fired += 1; });
  dom.window.location.hash = '#clients?new=1';
  await tick();
  fired = 0;
  takeDeepLink(['new']);
  await tick();
  assert.equal(fired, 0);
  assert.equal(dom.window.location.hash, '#clients');
});
