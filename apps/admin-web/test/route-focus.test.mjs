import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#store', pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');
const { AppShell } = await import('../src/app-shell.tsx');
const { usePageResetOnModuleChange } = await import('../src/route-focus.ts');
afterEach(() => { cleanup(); globalThis.fetch = undefined; delete dom.window.matchMedia; dom.window.localStorage.clear(); });
after(() => dom.window.close());

// jsdom has no layout: back scrollTop with a plain value so resets are observable.
let scrollTop = 0;
Object.defineProperty(dom.window.document.documentElement, 'scrollTop', { configurable: true, get: () => scrollTop, set: (value) => { scrollTop = value; } });

const response = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const adminPermissions = { calendar: true, clients: true, communications: true, documents: true, sensitiveReview: false, followup: true, billing: true, cash: true, transfers: false, staff: true, absences: true, timeclock: true };
const model = (permissions) => ({
  timezone: 'Atlantic/Canary', permissions,
  today: { sessionCount: 0, upcomingCount: 0, capacity: 0, occupied: 0, waitlistCount: 0, unassignedCount: 0, sessions: [], nextSession: null },
  clients: null, attention: [], economics: null, team: null, unread: 0, quickActions: [],
});
const admin = { calendar: true, clients: true, communications: true, billing: true, staff: true, store: true };
const trainer = { calendar: true, clients: true, communications: true, billing: false, staff: false };
const serve = (capabilities, permissions) => {
  globalThis.fetch = async (url) => String(url).includes('/api/dashboard/command-center') ? response(model(permissions)) : String(url).includes('/api/session/capabilities') ? response(capabilities) : response({});
};
const routeId = () => window.location.hash.slice(1).split('?')[0] || 'home';

/** Mirrors App in main.tsx: route from the hash, the hook, the real AppShell, and a page with a local tab, a modal and an input. */
function Page({ route }) {
  const [tab, setTab] = React.useState('uno');
  const [open, setOpen] = React.useState(false);
  return React.createElement('main', null,
    React.createElement('h1', null, `Pantalla ${route}`),
    React.createElement('div', { role: 'tablist' },
      React.createElement('button', { role: 'tab', 'aria-selected': tab === 'uno', onClick: () => setTab('uno') }, 'Pestaña uno'),
      React.createElement('button', { role: 'tab', 'aria-selected': tab === 'dos', onClick: () => setTab('dos') }, 'Pestaña dos')),
    React.createElement('p', null, `Contenido ${tab}`),
    React.createElement('input', { 'aria-label': 'Campo de texto' }),
    React.createElement('button', { onClick: () => setOpen(true) }, 'Abrir modal'),
    open && React.createElement('div', { role: 'dialog', 'aria-label': 'Modal' }, React.createElement('button', { onClick: () => setOpen(false) }, 'Cerrar modal')));
}
function Harness() {
  const [route, setRoute] = React.useState(routeId);
  React.useEffect(() => { const change = () => setRoute(routeId()); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  usePageResetOnModuleChange(route);
  return React.createElement(AppShell, null, React.createElement(Page, { route }));
}
const go = async (hash, heading) => {
  window.location.hash = hash;
  await screen.findByRole('heading', { name: heading });
};
const mount = async (hash, capabilities, permissions) => {
  serve(capabilities, permissions);
  window.location.hash = hash; scrollTop = 0;
  render(React.createElement(Harness));
  await screen.findByRole('heading', { name: `Pantalla ${hash.slice(1)}` });
};

for (const [profile, capabilities, permissions, from, to] of [['Admin', admin, adminPermissions, '#store', '#home'], ['Trainer', trainer, { ...adminPermissions, billing: false, cash: false, staff: false }, '#clients', '#calendar']]) {
  test(`${profile}: changing module scrolls to the top and focuses the new h1`, async () => {
    await mount(from, capabilities, permissions);
    scrollTop = 900;
    await go(to, `Pantalla ${to.slice(1)}`);
    const heading = screen.getByRole('heading', { name: `Pantalla ${to.slice(1)}` });
    await waitFor(() => assert.ok(document.activeElement === heading, 'the new h1 has focus'));
    assert.equal(scrollTop, 0, 'scroll is back at the top');
    assert.equal(heading.getAttribute('tabindex'), '-1', 'h1 is programmatically focusable only');
  });
}

test('the module switch does not alter navigation: links still work and the hash is the one clicked', async () => {
  await mount('#store', admin, adminPermissions);
  scrollTop = 500;
  fireEvent.click(screen.getByRole('link', { name: 'Resumen' }));
  await screen.findByRole('heading', { name: 'Pantalla home' });
  assert.equal(window.location.hash, '#home');
});

test('opening and closing a modal does not reset the scroll or move focus to the h1', async () => {
  await mount('#clients', admin, adminPermissions);
  scrollTop = 640;
  fireEvent.click(screen.getByRole('button', { name: 'Abrir modal' }));
  await screen.findByRole('dialog', { name: 'Modal' });
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar modal' }));
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  assert.equal(scrollTop, 640);
  assert.ok(document.activeElement !== screen.getByRole('heading', { name: 'Pantalla clients' }), 'focus stays put');
});

test('a local tab change and typing are not module navigation', async () => {
  await mount('#clients', admin, adminPermissions);
  scrollTop = 410;
  fireEvent.click(screen.getByRole('tab', { name: 'Pestaña dos' }));
  await screen.findByText('Contenido dos');
  fireEvent.change(screen.getByLabelText('Campo de texto'), { target: { value: 'abc' } });
  assert.equal(scrollTop, 410);
  assert.ok(document.activeElement !== screen.getByRole('heading', { name: 'Pantalla clients' }), 'focus stays put');
});

test('a query-only hash change inside the same module is not a module change', async () => {
  await mount('#clients', admin, adminPermissions);
  scrollTop = 330;
  window.location.hash = '#clients?client=abc';
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(scrollTop, 330);
});

test('focus is not taken from a field the user is already using on the new page', async () => {
  await mount('#clients', admin, adminPermissions);
  window.location.hash = '#calendar';
  await screen.findByRole('heading', { name: 'Pantalla calendar' });
  const calendarHeading = screen.getByRole('heading', { name: 'Pantalla calendar' });
  await waitFor(() => assert.ok(document.activeElement === calendarHeading, 'h1 has focus'));
  const input = document.querySelector('input[aria-label="Campo de texto"]');
  input.focus();
  scrollTop = 200;
  fireEvent.change(input, { target: { value: 'x' } });
  assert.ok(document.activeElement === input, "focus stays in the field");
  assert.equal(scrollTop, 200);
});

test('drawer layout (narrow screens): the drawer closing does not leave focus on the menu button', async () => {
  dom.window.matchMedia = (query) => {
    const max = Number(/max-width:s*([d.]+)px/.exec(query)?.[1] ?? Infinity);
    return { matches: 390 <= max, media: query, addEventListener() {}, removeEventListener() {} };
  };
  await mount('#store', admin, adminPermissions);
  scrollTop = 700;
  fireEvent.click(screen.getByRole('button', { name: 'Abrir navegación' }));
  fireEvent.click(await screen.findByRole('link', { name: 'Resumen' }));
  const heading = await screen.findByRole('heading', { name: 'Pantalla home' });
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.ok(document.activeElement === heading, 'h1 keeps focus after the drawer closes');
  assert.equal(scrollTop, 0);
});

test('main.tsx wires the hook to the current professional module id', () => {
  const source = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(source, /usePageResetOnModuleChange\(route\)/);
});
