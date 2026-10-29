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
const serve = (summary, caps = capabilities) => { globalThis.fetch = async (url) => String(url).includes('/api/dashboard/command-center') ? response(summary) : String(url).includes('/api/session/capabilities') ? response(caps) : response({ groups: [] }); };
/** Fake matchMedia: `width` decides which of the two shell queries match. */
const viewport = (width) => {
  dom.window.matchMedia = (query) => {
    const max = Number(/max-width:\s*([\d.]+)px/.exec(query)?.[1] ?? Infinity);
    return { matches: width <= max, media: query, addEventListener() {}, removeEventListener() {} };
  };
};
const mount = () => render(React.createElement(AppShell, null, React.createElement(CommandCenter)));

test('V2 shell uses Lucide SVG icons and no Unicode glyph icons for navigation', async () => {
  serve(model);
  window.location.hash = '#home'; mount();
  await screen.findByRole('heading', { name: 'Resumen' });
  await screen.findByRole('link', { name: 'Agenda' });
  const nav = document.querySelector('.app-navigation');
  assert.equal(nav.querySelector('.nav-glyph'), null);
  const icons = nav.querySelectorAll('svg.lucide');
  assert.ok(icons.length >= 6, 'every destination renders a Lucide icon');
  for (const icon of icons) assert.equal(icon.getAttribute('aria-hidden'), 'true');
  assert.doesNotMatch(nav.textContent, /[⌂▦◉♙✉€◇▣⌄«»]/u);
  assert.equal(document.querySelector('.app-sidebar').getAttribute('data-2j-design'), 'v2');
  assert.equal(document.querySelector('.app-sidebar').querySelector('.app-nav-item.active')?.getAttribute('aria-current'), 'page');
});

test('desktop >=1280 keeps the expanded sidebar with a labelled fold button and no drawer controls', async () => {
  viewport(1440); serve(model);
  mount();
  await screen.findByRole('heading', { name: 'Resumen' });
  const frame = document.querySelector('.app-frame');
  assert.equal(frame.classList.contains('is-rail'), false);
  assert.equal(frame.classList.contains('is-drawer'), false);
  assert.ok(screen.getByRole('button', { name: 'Compactar menú' }));
  assert.equal(screen.queryByRole('button', { name: 'Abrir navegación' }), null);
});

test('tablet 1024-1279 switches to the rail automatically and groups still open from their trigger', async () => {
  viewport(1100); serve(model);
  mount();
  await screen.findByRole('heading', { name: 'Resumen' });
  const frame = document.querySelector('.app-frame');
  assert.ok(frame.classList.contains('is-rail'));
  assert.equal(screen.queryByRole('button', { name: 'Compactar menú' }), null, 'the rail is automatic here, no fold toggle');
  const group = screen.getByRole('button', { name: 'Operación' });
  assert.equal(group.getAttribute('aria-expanded'), 'false');
  assert.equal(group.getAttribute('title'), 'Operación');
  fireEvent.click(group);
  assert.equal(group.getAttribute('aria-expanded'), 'true');
  assert.ok(within(document.querySelector('.app-sidebar')).getByRole('link', { name: /Agenda/ }));
});

test('below 1024 the sidebar is an off-canvas drawer opened from the top bar, with focus management and Escape', async () => {
  viewport(390); serve(model);
  mount();
  await screen.findByRole('heading', { name: 'Resumen' });
  const frame = document.querySelector('.app-frame');
  assert.ok(frame.classList.contains('is-drawer'));
  const sidebar = document.querySelector('.app-sidebar');
  assert.equal(sidebar.getAttribute('aria-hidden'), 'true', 'closed drawer is hidden from assistive tech');
  const menu = screen.getByRole('button', { name: 'Abrir navegación' });
  assert.equal(menu.getAttribute('aria-expanded'), 'false');
  assert.equal(menu.getAttribute('aria-controls'), 'app-sidebar');
  fireEvent.click(menu);
  await waitFor(() => assert.ok(frame.classList.contains('drawer-open')));
  assert.equal(sidebar.getAttribute('role'), 'dialog');
  assert.equal(sidebar.getAttribute('aria-modal'), 'true');
  assert.equal(sidebar.getAttribute('aria-hidden'), null);
  await waitFor(() => assert.ok(sidebar.contains(document.activeElement)), { timeout: 5000 });
  assert.ok(document.querySelector('.app-scrim'));
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => assert.equal(frame.classList.contains('drawer-open'), false));
  await waitFor(() => assert.ok(document.activeElement === menu), { timeout: 5000 });
  assert.equal(document.querySelector('.app-scrim'), null);
});

test('choosing a destination closes the drawer; there is no professional bottom navigation', async () => {
  viewport(390); serve(model);
  mount();
  await screen.findByRole('heading', { name: 'Resumen' });
  fireEvent.click(screen.getByRole('button', { name: 'Abrir navegación' }));
  const frame = document.querySelector('.app-frame');
  await waitFor(() => assert.ok(frame.classList.contains('drawer-open')));
  window.location.hash = '#clients';
  window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));
  await waitFor(() => assert.equal(frame.classList.contains('drawer-open'), false));
  assert.equal(document.querySelector('nav[aria-label="Navegación inferior"], .bottom-nav'), null);
  window.location.hash = '#home';
});

test('shell keeps permission-driven destinations in every mode (capabilities unchanged)', async () => {
  viewport(1100); serve(model, { calendar: false, clients: true, communications: false, billing: false, staff: false });
  mount();
  await screen.findByRole('heading', { name: 'Resumen' });
  fireEvent.click(screen.getByRole('button', { name: 'Operación' }));
  assert.ok(screen.getByRole('link', { name: 'Clientes' }));
  assert.equal(screen.queryByRole('button', { name: 'Comercial' }), null);
  assert.equal(screen.queryByRole('link', { name: 'Equipo' }), null);
});

test('Resumen shows metrics only from real, permitted data and omits what the API does not provide', async () => {
  serve({ ...model, permissions: { ...permissions, billing: false }, today: { ...model.today, capacity: 0, occupied: 0 }, clients: null });
  mount();
  await screen.findByRole('heading', { name: 'Resumen' });
  const strip = screen.getByRole('list', { name: 'Indicadores de hoy' });
  assert.deepEqual([...strip.querySelectorAll('.summary-metric-label')].map((node) => node.textContent), ['Reservas hoy'], 'no occupancy for zero capacity, no clients without data, no finance without grant');
  assert.equal(screen.queryByText('Pendiente de cobro'), null);
});

test('Resumen metrics include occupancy, finance (with overdue tone) and clients when the API grants them', async () => {
  serve({
    ...model, permissions: { ...permissions, billing: true },
    today: { ...model.today, sessionCount: 2, capacity: 20, occupied: 15 },
    economics: { pendingCents: 12500, overdueCount: 2, collectedTodayCents: 0, cashSession: null },
  }, { ...capabilities, billing: true });
  mount();
  await screen.findByRole('heading', { name: 'Resumen' });
  const strip = screen.getByRole('list', { name: 'Indicadores de hoy' });
  assert.deepEqual([...strip.querySelectorAll('.summary-metric-label')].map((node) => node.textContent), ['Clientes activos', 'Reservas hoy', 'Ocupación hoy', 'Pendiente de cobro']);
  assert.ok(within(strip).getByText('75 %'));
  assert.ok(within(strip).getByText('5 plazas libres'));
  assert.match(within(strip).getByText('2 cargos vencidos').className, /is-danger/);
});

test('Requiere atención orders by urgency, pairs each item with a text chip and one destination, and never invents PP-01 signals', async () => {
  serve({
    ...model, permissions: { ...permissions, billing: true },
    attention: [
      { id: 'w', kind: 'waitlist', title: 'Lista de espera por resolver', summary: '1 persona', href: '#calendar', ageAt: null },
      { id: 'p', kind: 'overdue_payments', title: '1 cargo vencido', summary: 'Revisar saldos', href: '#economics', ageAt: null },
      { id: 'd', kind: 'document_pending', title: 'Documento pendiente', summary: 'Lucía Demo', href: '#clients?clientId=1&tab=documents', ageAt: null },
    ],
    economics: { pendingCents: 0, overdueCount: 1, collectedTodayCents: 0, cashSession: null },
  }, { ...capabilities, billing: true });
  mount();
  const list = await screen.findByRole('list', { name: 'Elementos que requieren atención' });
  const rows = within(list).getAllByRole('link');
  assert.deepEqual(rows.map((row) => row.querySelector('strong').textContent), ['1 cargo vencido', 'Documento pendiente', 'Lista de espera por resolver']);
  assert.deepEqual(rows.map((row) => row.querySelector('.ui-chip').textContent), ['Vencido', 'Revisar', 'Lista de espera']);
  assert.ok(rows[0].querySelector('.ui-chip--danger svg'), 'urgency is never colour alone: icon plus text');
  assert.equal(within(screen.getByRole('region', { name: 'Requiere atención' })).queryByText(/no-show|sin actividad|plan próximo/i), null);
});

test('Próximas sesiones shows fill = capacity, Lleno and En curso as text chips, and flags a missing professional', async () => {
  const start = (hours) => new Date(Date.now() + hours * 60 * 60_000).toISOString();
  serve({
    ...model,
    today: { ...model.today, sessionCount: 3, capacity: 28, occupied: 24, sessions: [
      { id: 'a', serviceName: 'Pilates', professionalName: null, startsAt: start(1), occupied: 8, capacity: 8, free: 0, waitlistCount: 2, isNow: false, state: 'upcoming' },
      { id: 'b', serviceName: 'Funcional', professionalName: 'Alex Rivera', startsAt: start(-0.2), occupied: 6, capacity: 10, free: 4, waitlistCount: 0, isNow: true, state: 'in_progress' },
    ] },
  });
  mount();
  const list = await screen.findByRole('list', { name: 'Próximas sesiones de hoy' });
  const rows = within(list).getAllByRole('link');
  assert.match(rows[0].className, /is-current/);
  assert.ok(within(rows[0]).getByText('En curso'));
  assert.equal(rows[0].querySelector('.summary-fill > span').style.width, '60%');
  assert.ok(within(rows[1]).getByText('Lleno'));
  assert.equal(rows[1].querySelector('.summary-fill > span').style.width, '100%');
  assert.match(within(rows[1]).getByText('Profesional sin asignar').className, /is-missing/);
  assert.ok(within(rows[1]).getByText('2 en espera'));
});

test('Resumen exposes a single h1, labelled card regions and the last-update line', async () => {
  serve(model);
  mount();
  await screen.findByRole('heading', { level: 1, name: 'Resumen' });
  assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1);
  assert.ok(screen.getByRole('region', { name: 'Requiere atención' }));
  assert.ok(screen.getByRole('region', { name: 'Próximas sesiones' }));
  await waitFor(() => assert.ok(document.querySelector('.ui-page-meta')));
  assert.match(document.querySelector('.ui-page-meta').textContent, /^Actualizado a las \d{2}:\d{2} · hora de Canarias$/);
  assert.equal(screen.getByRole('main').getAttribute('data-2j-design'), 'v2');
});
