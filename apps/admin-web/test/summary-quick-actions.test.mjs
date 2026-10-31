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

test('quick actions use Base44 verbs and deep links, and the strip is exactly what the server grants', async () => {
  serve({ ...model, quickActions: [
    { id: 'new-client', label: 'Nuevo cliente', href: '#clients?new=1' },
    { id: 'new-reservation', label: 'Crear reserva', href: '#calendar?book=1' },
    { id: 'new-sale', label: 'Registrar venta', href: '#store?sale=1' },
    { id: 'assign-plan', label: 'Asignar cuota', href: '#clients?intent=assign-plan' },
    { id: 'collect-payment', label: 'Registrar pago', href: '#economics' },
    { id: 'send-message', label: 'Enviar mensaje', href: '#clients?intent=message' },
  ] });
  window.location.hash = '#home'; mount();
  const nav = await screen.findByRole('navigation', { name: 'Accesos rápidos' });
  assert.deepEqual(within(nav).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]), [
    ['Nuevo cliente', '#clients?new=1'], ['Crear reserva', '#calendar?book=1'], ['Registrar venta', '#store?sale=1'],
    ['Asignar cuota', '#clients?intent=assign-plan'], ['Registrar pago', '#economics'], ['Enviar mensaje', '#clients?intent=message'],
  ]);
});

test('Resumen opens invoice and ticket documents only when the server grants invoice-read permission', async () => {
  const chargeId = 'f54f1b1a-ef3b-4ae3-8c95-f1b23b53e8a2';
  const summary = { ...model, permissions: { ...permissions, billing: true, invoices: true }, commercial: { recentMovements: [{ id: 'payment-1', chargeId, kind: 'payment', amountCents: 1200, concept: 'Cuota mensual', clientName: 'Cliente Demo', occurredAt: '2026-10-30T09:00:00.000Z' }] } };
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/api/dashboard/command-center')) return response(summary);
    if (target.includes('/api/session/capabilities')) return response(capabilities);
    if (target.includes(`/api/economics/charges/${chargeId}/documents`)) return response({ items: [{ id: 'document-1', documentType: 'full_invoice', status: 'issued', documentNumber: 'F-2026-0001', documentDate: '2026-10-30', grossCents: 1200, isRectified: false }], canIssue: false });
    return response({ groups: [] });
  };
  window.location.hash = '#home'; mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Factura y ticket' }));
  const dialog = await screen.findByRole('dialog', { name: 'Factura y ticket' });
  assert.ok(within(dialog).getByText('Factura F-2026-0001'));
  assert.ok(within(dialog).getByRole('link', { name: 'Descargar' }));
  cleanup();

  serve({ ...summary, permissions: { ...summary.permissions, invoices: false } });
  window.location.hash = '#home'; mount();
  await screen.findByRole('region', { name: 'Últimos movimientos' });
  assert.equal(screen.queryByRole('button', { name: 'Factura y ticket' }), null);
});

test('the commercial tiles appear in the Base44 order only for the blocks the API grants; Ver informes links to #reports', async () => {
  serve({ ...model, permissions: { ...permissions, billing: true, transfers: true },
    today: { ...model.today, sessionCount: 1, capacity: 10, occupied: 4 },
    economics: { pendingCents: 5000, overdueCount: 0, collectedTodayCents: 0, cashSession: null },
    commercial: { plans: { activeCount: 3, expiringSoonCount: 1 }, transfers: { pendingCount: 2 }, storeSales: { monthCount: 1, monthTotalCents: 3000 }, lowStock: { count: 0 } } });
  window.location.hash = '#home'; mount();
  const strip = await screen.findByRole('list', { name: 'Indicadores de hoy' });
  assert.deepEqual([...strip.querySelectorAll('.summary-metric-label')].map((node) => node.textContent), ['Clientes activos', 'Cuotas vigentes', 'Reservas hoy', 'Ocupación hoy', 'Pendiente de cobro', 'Transferencias por validar', 'Ventas del mes', 'Productos con stock bajo']);
  assert.ok(within(strip).getByText('1 vence en 7 días'));
  assert.match(within(strip).getByText('1 vence en 7 días').className, /is-warning/);
  assert.ok(within(strip).getByText('1 operación'));
  assert.ok(within(strip).getByText('Stock suficiente'));
  assert.equal(screen.getByRole('link', { name: 'Ver informes' }).getAttribute('href'), '#reports', 'the shell has the #reports screen (Informes), so the button exists');
  cleanup();
  serve({ ...model, commercial: { plans: null, transfers: null, storeSales: null, lowStock: null } });
  mount();
  const limited = await screen.findByRole('list', { name: 'Indicadores de hoy' });
  assert.deepEqual([...limited.querySelectorAll('.summary-metric-label')].map((node) => node.textContent), ['Clientes activos', 'Reservas hoy'], 'blocks without permission are not rendered');
});

test('coming back to the Resumen after Cobrar, Vender or Caja refreshes it by itself instead of showing stale figures', async () => {
  let clients = 12; let loads = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/dashboard/command-center')) { loads += 1; return response({ ...model, clients: { active: clients, recentSignups: 2 } }); }
    return String(url).includes('/api/session/capabilities') ? response(capabilities) : response({});
  };
  function Host() { const [away, setAway] = React.useState(false); return React.createElement('div', null, React.createElement('button', { onClick: () => setAway((value) => !value) }, 'alternar'), away ? React.createElement('p', null, 'otra pantalla') : React.createElement(CommandCenter)); }
  render(React.createElement(AppShell, null, React.createElement(Host)));
  await screen.findByText('12');
  const firstLoads = loads;
  assert.equal(firstLoads, 1, 'the first visit loads the summary once, with no duplicate request');
  fireEvent.click(screen.getByRole('button', { name: 'alternar' }));
  await screen.findByText('otra pantalla');
  clients = 13;
  fireEvent.click(screen.getByRole('button', { name: 'alternar' }));
  await screen.findByText('13');
  assert.equal(loads, firstLoads + 1, 'returning reloads exactly once');
});

test('the Resumen offers "Nueva venta" only to profiles the server lets sell or collect, and it opens the client picker without leaving the page', async () => {
  serve({ ...model, quickActions: [{ id: 'new-client', label: 'Nuevo cliente', href: '#clients?new=1' }, { id: 'new-sale', label: 'Vender', href: '#store?sale=1' }] });
  window.location.hash = '#home'; mount();
  await screen.findByRole('heading', { name: 'Resumen' });
  assert.equal(screen.queryByRole('button', { name: 'Nueva venta' }), null, 'no plan or payment permission (store-only sellers keep "Vender"), no button');
  cleanup();
  serve({ ...model, quickActions: [{ id: 'collect-payment', label: 'Cobrar', href: '#economics' }] });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Nueva venta' }));
  const picker = await screen.findByRole('dialog', { name: 'Nueva venta' });
  assert.ok(within(picker).getByLabelText('Buscar cliente'));
  assert.equal(window.location.hash, '#home', 'the page does not change');
});
