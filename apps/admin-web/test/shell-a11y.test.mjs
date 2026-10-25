import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#clients' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');
const { AppShell } = await import('../src/app-shell.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; dom.window.localStorage.clear(); });
after(() => dom.window.close());

const response = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
globalThis.fetch = undefined;
const serve = () => { globalThis.fetch = async (url) => String(url).includes('/api/session/capabilities') ? response({ calendar: true, clients: true, communications: true, billing: false, staff: true }) : response({ ok: false }); };

test('the skip link is the first focusable element, moves focus to the page content and leaves the route hash alone', async () => {
  serve();
  window.location.hash = '#clients';
  render(React.createElement(AppShell, null, React.createElement('main', null, React.createElement('h1', null, 'Clientes'))));
  const link = await screen.findByRole('link', { name: 'Saltar al contenido' });
  const firstFocusable = document.querySelector('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])');
  assert.ok(firstFocusable === link, 'skip link comes first in tab order');
  fireEvent.click(link);
  const target = document.getElementById('main-content');
  assert.ok(target && document.activeElement === target, 'focus lands on the page content');
  assert.equal(target.getAttribute('tabindex'), '-1');
  assert.equal(window.location.hash, '#clients', 'the hash route is not touched');
  assert.ok(target.contains(screen.getByRole('heading', { name: 'Clientes' })), 'the target contains the page');
});

// Placeholders that prompt for text end with an ellipsis (Web Interface Guidelines). Values, numbers and states are exempt.
const EXEMPT_VALUES = new Set(['0,00', 'Ej. 2 o -1', 'Sin precio definido', 'Sin caducidad']);
// Files owned by the stacked pilot PRs #50-#52; their placeholders are handled once those land (see docs/handoffs/RM-00-02.md).
const DEFERRED_FILES = new Set(['calendar-page.tsx', 'services-page.tsx', 'store-page.tsx']);
test('text placeholders end with an ellipsis', () => {
  const dir = new URL('../src/', import.meta.url);
  const offenders = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.tsx') && !DEFERRED_FILES.has(name))) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    for (const match of source.matchAll(/placeholder="([^"]*)"/g)) {
      if (!match[1].endsWith('…') && !EXEMPT_VALUES.has(match[1])) offenders.push(`${file}: ${match[1]}`);
    }
  }
  assert.deepEqual(offenders, []);
});
