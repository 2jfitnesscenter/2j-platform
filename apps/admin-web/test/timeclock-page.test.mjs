import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#home' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { AppShell } = await import('../src/app-shell.tsx');
const { TimeClockPage } = await import('../src/timeclock-page.tsx');
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
const event = (id, eventType, iso, origin = 'web') => ({ id, eventType, occurredAt: iso, effectiveOccurredAt: iso, origin });
const history = [event('e4', 'clock_out', '2026-10-24T16:00:00Z', 'staff_app'), event('e3', 'clock_in', '2026-10-24T08:00:00Z'), event('e2', 'clock_out', '2026-10-20T15:30:00Z'), event('e1', 'clock_in', '2026-10-20T07:55:00Z')];
const selfOf = (overrides = {}) => ({ professional: { id: 'p1', displayName: 'Ana' }, timezone: 'Atlantic/Canary', openShift: false, lastEvent: { eventType: 'clock_out', occurredAt: history[0].occurredAt }, workedSecondsToday: 3600, workedSecondsThisWeek: 7200, workedSecondsThisMonth: 9000, history, ...overrides });
const serve = ({ self = () => response(selfOf()), punch = () => response({ id: 'new' }, 201) } = {}) => {
  const posts = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes('/api/timeclock/self')) return self();
    if (path.includes('/api/timeclock/clock-')) { posts.push({ path, body: JSON.parse(options.body) }); return punch(); }
    if (path.includes('/api/dashboard/command-center')) return response(model);
    if (path.includes('/api/session/capabilities')) return response(capabilities);
    return response({ groups: [] });
  };
  return posts;
};
const mount = () => render(React.createElement(AppShell, null, React.createElement(TimeClockPage)));

test('Fichaje shows a closed shift with Fichar entrada and a Día / Entrada / Salida / Estado table, newest first, with no accumulated totals (D121)', async () => {
  serve(); window.location.hash = '#timeclock'; mount();
  assert.ok(await screen.findByRole('heading', { name: 'Sin jornada abierta' }));
  assert.ok(screen.getByRole('button', { name: 'Fichar entrada' }));
  assert.equal(screen.queryByRole('button', { name: 'Fichar salida' }), null);
  const table = await screen.findByRole('table', { name: /Mis fichajes/ });
  assert.deepEqual(within(table).getAllByRole('columnheader').map((cell) => cell.textContent), ['Día', 'Entrada', 'Salida', 'Estado']);
  const rows = within(table).getAllByRole('row').slice(1);
  assert.equal(rows.length, 2, 'each clock-in is paired with its clock-out');
  assert.match(rows[0].textContent, /24 oct 2026/);
  assert.match(rows[0].textContent, /Cerrado/);
  assert.match(rows[0].textContent, /Panel web/);
  assert.match(rows[1].textContent, /20 oct 2026/);
  assert.equal(document.body.textContent.includes('Esta semana'), false, 'no weekly/monthly totals');
  assert.equal(/d+ h d{2} min/.test(document.body.textContent), false, 'no accumulated hours');
});

test('a clock-in without a clock-out is an open row with a dash, never an invented exit time (D123)', async () => {
  serve({ self: () => response(selfOf({ openShift: true, history: [event('open-1', 'clock_in', '2026-10-25T08:00:00Z'), ...history] })) });
  window.location.hash = '#timeclock'; mount();
  const table = await screen.findByRole('table', { name: /Mis fichajes/ });
  const rows = within(table).getAllByRole('row').slice(1);
  assert.equal(rows.length, 3);
  assert.match(rows[0].textContent, /Abierto/);
  assert.ok(within(rows[0]).getByLabelText('Sin salida registrada'));
});

test('an open shift offers only Fichar salida; punching sends origin web, reloads and confirms', async () => {
  let open = true;
  const posts = serve({ self: () => response(selfOf({ openShift: open, lastEvent: { eventType: open ? 'clock_in' : 'clock_out', occurredAt: '2026-10-25T08:00:00Z' } })), punch: () => { open = false; return response({ id: 'x' }, 201); } });
  window.location.hash = '#timeclock'; mount();
  assert.ok(await screen.findByRole('heading', { name: 'Jornada en curso' }));
  assert.equal(screen.queryByRole('button', { name: 'Fichar entrada' }), null);
  fireEvent.click(screen.getByRole('button', { name: 'Fichar salida' }));
  assert.ok(await screen.findByText('Salida registrada.'));
  assert.deepEqual(posts.map((post) => [post.path.split('/').pop(), post.body]), [['clock-out', { origin: 'web' }]]);
  assert.ok(await screen.findByRole('heading', { name: 'Sin jornada abierta' }));
});

test('the date filter narrows the list and can be cleared; server refusals show a clear message', async () => {
  serve({ punch: () => response({ error: 'shift_already_open' }, 409) }); window.location.hash = '#timeclock'; mount();
  await screen.findByRole('heading', { name: 'Mis fichajes' });
  fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-23' } });
  assert.equal(within(screen.getByRole('table')).getAllByRole('row').length - 1, 1);
  fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-23' } });
  assert.ok(await screen.findByText('Sin fichajes en estas fechas'));
  fireEvent.click(screen.getByRole('button', { name: 'Quitar filtro' }));
  assert.equal(within(screen.getByRole('table')).getAllByRole('row').length - 1, 2);
  fireEvent.click(screen.getByRole('button', { name: 'Fichar entrada' }));
  assert.ok(await screen.findByText(/Ya tienes la entrada fichada y la jornada sigue abierta/));
});

test('an unlinked account and a profile without permission get explanations instead of buttons', async () => {
  serve({ self: () => response({ error: 'staff_account_unlinked' }, 404) }); window.location.hash = '#timeclock'; mount();
  assert.ok(await screen.findByText('Tu cuenta no está vinculada a una ficha de profesional'));
  assert.equal(screen.queryByRole('button', { name: /Fichar/ }), null);
  cleanup();
  serve({ self: () => response({ error: 'permission_denied' }, 403) }); mount();
  assert.ok(await screen.findByText('Tu perfil no puede fichar'));
});

test('the navigation has a top-level Fichaje link for profiles with staff access', async () => {
  serve(); window.location.hash = '#timeclock'; mount();
  await screen.findByRole('heading', { name: 'Mis fichajes' });
  const nav = within(document.querySelector('.app-navigation'));
  assert.equal(nav.getByRole('link', { name: 'Fichaje' }).getAttribute('aria-current'), 'page');
});

test('A74/A75: every refusal of Fichar entrada or salida names the cause and the action, for known codes, server failures and a dead network', async () => {
  const attempt = async (punch, label, self) => {
    serve({ punch, self }); window.location.hash = '#timeclock'; mount();
    await screen.findByRole('heading', { name: 'Mis fichajes' });
    fireEvent.click(screen.getByRole('button', { name: label }));
    const alert = await screen.findByRole('alert');
    const text = alert.textContent;
    cleanup(); globalThis.fetch = undefined;
    return text;
  };
  const open = () => response(selfOf({ openShift: true }));
  const custody = await attempt(() => response({ error: 'clock_out_conflict' }, 409), 'Fichar salida', open);
  assert.match(custody, /al fichar la salida/); assert.match(custody, /código: clock_out_conflict/);
  const gone = await attempt(() => response({ error: 'cash_register_must_be_closed_or_handed_over' }, 409), 'Fichar salida', open);
  assert.match(gone, /código: cash_register_must_be_closed_or_handed_over/, 'a retired code still gets a quotable fallback, not a wrong explanation');
  const noShift = await attempt(() => response({ error: 'no_open_shift' }, 409), 'Fichar salida', open);
  assert.match(noShift, /No tienes ninguna entrada fichada/); assert.match(noShift, /Ficha primero la entrada/);
  const unlinked = await attempt(() => response({ error: 'staff_account_unlinked' }, 409), 'Fichar entrada');
  assert.match(unlinked, /Pide a Administración que la vincule/);
  const server = await attempt(() => response({ error: 'internal_error' }, 500), 'Fichar entrada');
  assert.match(server, /error interno/); assert.match(server, /repítela/);
  const unknown = await attempt(() => response({ error: 'something_new' }, 422), 'Fichar entrada');
  assert.match(unknown, /al fichar la entrada/); assert.match(unknown, /código: something_new/); assert.match(unknown, /avisa a Administración/);
  const dead = await attempt(() => { throw new TypeError('Failed to fetch'); }, 'Fichar entrada');
  assert.match(dead, /No hay conexión con el servidor para fichar la entrada/);
  for (const text of [custody, gone, noShift, unlinked, server, unknown, dead]) assert.ok(!/No se pudo completar|No se pudo fichar\.?$/.test(text), `generic message: ${text}`);
});
