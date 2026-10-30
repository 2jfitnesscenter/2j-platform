import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#home' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { AppShell } = await import('../src/app-shell.tsx');
const { ActivityPage } = await import('../src/activity-page.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; delete dom.window.matchMedia; dom.window.localStorage.clear(); });
after(() => dom.window.close());
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const permissions = { calendar: true, clients: true, communications: true, documents: true, sensitiveReview: false, followup: true, billing: true, cash: false, transfers: false, staff: true, absences: true, timeclock: true };
const model = {
  timezone: 'Atlantic/Canary', permissions,
  today: { sessionCount: 0, upcomingCount: 0, capacity: 0, occupied: 0, waitlistCount: 0, unassignedCount: 0, sessions: [], nextSession: null },
  clients: { active: 12, recentSignups: 2 }, attention: [{ id: 'att-1', kind: 'overdue_payments', title: '1 cargo vencido', summary: 'Revisar saldos pendientes', href: '#economics', ageAt: null }], economics: null, team: null, unread: 0, quickActions: [],
};
const capabilities = { calendar: true, clients: true, communications: true, billing: true, staff: true };
const item = (n, overrides = {}) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, area: 'economy', occurredAt: new Date(Date.UTC(2026, 9, 25, 12, 0, 0) - n * 60_000).toISOString(), actorId: `actor-${n}`, action: 'payment.recorded', resourceType: 'transaction', ...overrides });
const serve = ({ audit = () => response({ items: [], nextCursor: null }) } = {}) => {
  const auditUrls = [];
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes('/api/activity/audit')) { auditUrls.push(path); return audit(path); }
    if (path.includes('/api/dashboard/command-center')) return response(model);
    if (path.includes('/api/session/capabilities')) return response(capabilities);
    return response({ groups: [] });
  };
  return auditUrls;
};
const mount = () => render(React.createElement(AppShell, null, React.createElement(ActivityPage)));

test('Actividad opens on Avisos with the attention items and has an Auditoría tab', async () => {
  serve(); window.location.hash = '#activity'; mount();
  assert.ok(await screen.findByRole('heading', { name: 'Actividad' }));
  assert.equal(screen.getByRole('button', { name: 'Avisos' }).getAttribute('aria-pressed'), 'true');
  assert.ok(await screen.findByText('1 cargo vencido'));
  assert.ok(screen.getByRole('button', { name: 'Auditoría' }));
});

test('Auditoría lists action, area, resource and actor without any detail, filters by action and pages with the cursor', async () => {
  const urls = serve({ audit: (path) => path.includes('beforeAt=')
    ? response({ items: [item(3, { action: 'cash.closed', area: 'economy', resourceType: 'cash_session' })], nextCursor: null })
    : response({ items: [item(1), item(2, { action: 'session.created', area: 'calendar', resourceType: 'session' })], nextCursor: { beforeAt: item(2).occurredAt, beforeId: item(2).id } }) });
  window.location.hash = '#activity'; mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Auditoría' }));
  const list = await screen.findByRole('list', { name: 'Registro de auditoría' });
  assert.equal(within(list).getAllByRole('listitem').length, 2);
  assert.ok(within(list).getByText('payment.recorded'));
  assert.ok(within(list).getByText(/Agenda · session · actor-2/));
  fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
  await waitFor(() => assert.equal(within(screen.getByRole('list', { name: 'Registro de auditoría' })).getAllByRole('listitem').length, 3));
  assert.ok(urls[1].includes(`beforeAt=${encodeURIComponent(item(2).occurredAt)}`) && urls[1].includes(`beforeId=${item(2).id}`));
  assert.equal(screen.queryByRole('button', { name: 'Cargar más' }), null, 'no more pages');
  fireEvent.change(screen.getByLabelText('Filtrar por acción'), { target: { value: 'cash' } });
  const filtered = within(screen.getByRole('list', { name: 'Registro de auditoría' })).getAllByRole('listitem');
  assert.equal(filtered.length, 1);
  assert.ok(within(filtered[0]).getByText('cash.closed'));
});

test('a profile without audit permission gets a clear message instead of an error, and a failing feed offers a retry', async () => {
  serve({ audit: () => response({ error: 'permission_denied' }, 403) });
  window.location.hash = '#activity'; mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Auditoría' }));
  assert.ok(await screen.findByText('Tu perfil no puede consultar la auditoría.'));
  cleanup();
  serve({ audit: () => response({ error: 'x' }, 500) });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Auditoría' }));
  assert.ok(await screen.findByText('No se pudo cargar el registro'));
  assert.ok(screen.getByRole('button', { name: 'Reintentar' }));
});

test('the navigation has an Actividad group with Avisos y auditoría and Mensajes', async () => {
  serve(); window.location.hash = '#activity'; mount();
  await screen.findByRole('heading', { name: 'Actividad' });
  const nav = within(document.querySelector('.app-navigation'));
  assert.equal(nav.getByRole('link', { name: 'Avisos y auditoría' }).getAttribute('aria-current'), 'page');
  assert.ok(nav.getByRole('link', { name: /Mensajes/ }));
});
