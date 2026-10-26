import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#home' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { AppShell } = await import('../src/app-shell.tsx');
const { CommandCenter } = await import('../src/command-center.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; delete dom.window.matchMedia; dom.window.localStorage.clear(); });
after(() => dom.window.close());
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const permissions = { calendar: true, clients: true, communications: true, documents: true, sensitiveReview: false, followup: true, billing: false, cash: false, transfers: false, staff: true, absences: true, timeclock: true };
const model = {
  timezone: 'Atlantic/Canary', permissions,
  today: { sessionCount: 0, upcomingCount: 0, capacity: 0, occupied: 0, waitlistCount: 0, unassignedCount: 0, sessions: [], nextSession: null },
  clients: { active: 12, recentSignups: 2 }, attention: [], economics: null, team: null, unread: 0, quickActions: [],
};
const capabilities = { calendar: true, clients: true, communications: true, billing: false, staff: true };
const serve = (summary) => { globalThis.fetch = async (url) => String(url).includes('/api/dashboard/command-center') ? response(summary) : String(url).includes('/api/session/capabilities') ? response(capabilities) : response({ groups: [] }); };
const mount = () => render(React.createElement(AppShell, null, React.createElement(CommandCenter)));

test('the Resumen shows the quick actions the server grants, each a link to its section with a decorative icon', async () => {
  serve({ ...model, quickActions: [
    { id: 'new-client', label: 'Abrir clientes', href: '#clients' },
    { id: 'new-reservation', label: 'Abrir agenda', href: '#calendar' },
    { id: 'send-message', label: 'Abrir mensajes', href: '#communication' },
  ] });
  window.location.hash = '#home'; mount();
  const nav = await screen.findByRole('navigation', { name: 'Accesos rápidos' });
  const links = within(nav).getAllByRole('link');
  assert.deepEqual(links.map((link) => [link.textContent, link.getAttribute('href')]), [['Abrir clientes', '#clients'], ['Abrir agenda', '#calendar'], ['Abrir mensajes', '#communication']]);
  for (const link of links) assert.equal(link.querySelector('svg')?.getAttribute('aria-hidden'), 'true');
});

test('a profile without quick actions gets no empty strip, and an unsafe href is never rendered as a link', async () => {
  serve(model);
  window.location.hash = '#home'; mount();
  await screen.findByRole('heading', { name: 'Resumen' });
  assert.equal(screen.queryByRole('navigation', { name: 'Accesos rápidos' }), null);
  cleanup();
  serve({ ...model, quickActions: [{ id: 'new-client', label: 'Abrir clientes', href: 'javascript:alert(1)' }, { id: 'cash', label: 'Abrir caja', href: '#economics' }] });
  mount();
  const nav = await screen.findByRole('navigation', { name: 'Accesos rápidos' });
  assert.deepEqual(within(nav).getAllByRole('link').map((link) => link.getAttribute('href')), ['#economics']);
});
