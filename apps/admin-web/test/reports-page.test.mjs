import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#home' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { AppShell } = await import('../src/app-shell.tsx');
const { ReportsPage } = await import('../src/reports-page.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; delete dom.window.matchMedia; dom.window.localStorage.clear(); });
after(() => dom.window.close());
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const permissions = { calendar: true, clients: true, communications: true, documents: true, sensitiveReview: false, followup: true, billing: true, cash: false, transfers: false, staff: true, absences: true, timeclock: true };
const model = {
  timezone: 'Atlantic/Canary', permissions,
  today: { sessionCount: 0, upcomingCount: 0, capacity: 0, occupied: 0, waitlistCount: 0, unassignedCount: 0, sessions: [], nextSession: null },
  clients: { active: 12, recentSignups: 2 }, attention: [], economics: null, team: null, unread: 0, quickActions: [],
};
const capabilities = { calendar: true, clients: true, communications: true, billing: true, staff: true };
const row = (n, overrides = {}) => ({ id: `r-${n}`, kind: 'plan', occurredAt: `2026-10-${String(10 + n).padStart(2, '0')}T10:00:00Z`, clientId: `c-${n}`, clientName: `Cliente ${n}`, concept: `Cuota ${n}`, soldCents: 5000, collectedCents: 5000, status: 'paid', methods: ['card'], invoice: 'none', ...overrides });
const sales = (items, extra = {}) => ({ currency: 'EUR', timezone: 'Atlantic/Canary', items, truncated: false, totals: { soldCents: 9000, collectedCents: 5000, pendingCents: 4000, voidedCount: 1, voidedCents: 3000, rowCount: items.length }, capabilities: { export: true }, ...extra });
const serve = (handler) => {
  const urls = [];
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes('/api/reports/sales')) { urls.push(path); return handler(path); }
    if (path.includes('/api/dashboard/command-center')) return response(model);
    if (path.includes('/api/session/capabilities')) return response(capabilities);
    return response({ groups: [] });
  };
  return urls;
};
const mount = () => render(React.createElement(AppShell, null, React.createElement(ReportsPage)));

test('Informes shows sold versus collected, the voided sales differentiated, and the sales table with state, method and invoice', async () => {
  serve(() => response(sales([row(1), row(2, { kind: 'store', concept: '2 × Proteína', soldCents: 4000, collectedCents: 0, status: 'pending', methods: [] }), row(3, { status: 'void', soldCents: 3000, collectedCents: 0, kind: 'charge' })])));
  window.location.hash = '#reports'; mount();
  assert.ok(await screen.findByRole('heading', { name: 'Informes' }));
  const totals = await screen.findByRole('list', { name: 'Totales del periodo' });
  await waitFor(() => assert.match(totals.textContent, /90,00/));
  assert.match(totals.textContent, /50,00/); assert.match(totals.textContent, /40,00/); assert.match(totals.textContent, /Anuladas/);
  const table = await screen.findByRole('table', { name: 'Ventas del periodo' });
  assert.deepEqual(within(table).getAllByRole('columnheader').map((cell) => cell.textContent), ['Fecha', 'Cliente', 'Concepto', 'Tipo', 'Vendido', 'Cobrado', 'Estado', 'Método', 'Factura']);
  const rows = within(table).getAllByRole('row').slice(1);
  assert.equal(rows.length, 3);
  assert.match(rows[0].textContent, /Cobrada/); assert.match(rows[0].textContent, /Tarjeta/); assert.match(rows[0].textContent, /Sin factura/);
  assert.match(rows[1].textContent, /Tienda/); assert.match(rows[1].textContent, /Pendiente/);
  assert.match(rows[2].textContent, /Anulada/); assert.ok(rows[2].classList.contains('is-voided'));
  assert.equal(document.querySelector('canvas, svg.recharts-surface'), null, 'D108: no charts');
});

test('changing a filter requests the report again with that filter and the CSV link carries the same filters when the profile may export', async () => {
  const urls = serve(() => response(sales([row(1)])));
  window.location.hash = '#reports'; mount();
  await screen.findByRole('table', { name: 'Ventas del periodo' });
  fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'store' } });
  fireEvent.change(screen.getByLabelText('Método de pago'), { target: { value: 'transfer' } });
  fireEvent.change(screen.getByLabelText('Cliente o concepto'), { target: { value: 'Marta' } });
  await waitFor(() => assert.ok(urls.at(-1).includes('kind=store') && urls.at(-1).includes('method=transfer') && urls.at(-1).includes('q=Marta')), { timeout: 3000 });
  const link = await screen.findByRole('link', { name: 'Exportar CSV' });
  assert.ok(link.getAttribute('href').includes('/api/reports/sales.csv?') && link.getAttribute('href').includes('kind=store') && link.getAttribute('href').includes('method=transfer'));
  assert.equal(link.hasAttribute('download'), true);
});

test('a profile that cannot export gets no CSV link; an inverted range blocks the request; empty and denied states are explained', async () => {
  const urls = serve(() => response(sales([], { capabilities: { export: false } })));
  window.location.hash = '#reports'; mount();
  assert.ok(await screen.findByText('Sin ventas en este periodo'));
  assert.equal(screen.queryByRole('link', { name: 'Exportar CSV' }), null);
  fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2999-01-01' } });
  fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2998-01-01' } });
  assert.ok(await screen.findByText('La fecha final no puede ser anterior a la inicial.'));
  const before = urls.length;
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(urls.length, before, 'no request while the range is invalid');
  cleanup();
  serve(() => response({ error: 'permission_denied' }, 403)); mount();
  assert.ok(await screen.findByText('Tu perfil no puede consultar los informes'));
});

test('a failing report shows a retry, and a truncated list says so', async () => {
  let fail = true;
  serve(() => fail ? response({ error: 'x' }, 500) : response(sales([row(1)], { truncated: true })));
  window.location.hash = '#reports'; mount();
  assert.ok(await screen.findByText('No se pudo cargar el informe'));
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  assert.ok(await screen.findByText(/Se muestran las 500 ventas más recientes/));
});

test('the navigation lists Informes inside Negocio for profiles with billing access', async () => {
  serve(() => response(sales([row(1)]))); window.location.hash = '#reports'; mount();
  await screen.findByRole('heading', { name: 'Informes' });
  const nav = within(document.querySelector('.app-navigation'));
  assert.equal(nav.getByRole('link', { name: 'Informes' }).getAttribute('aria-current'), 'page');
});

const summaryBody = (extra = {}) => ({
  currency: 'EUR', timezone: 'Atlantic/Canary', from: '2026-05-01', to: '2026-10-29',
  monthly: [{ month: '2026-09', soldCents: 120000, collectedCents: 90000 }, { month: '2026-10', soldCents: 80000, collectedCents: 60000 }],
  overdue: { cents: 25000, count: 4 }, averageFee: { cents: 4500, count: 30 },
  occupancy: { sessions: 20, capacity: 160, occupied: 120, rate: 0.75 }, attendance: { attended: 90, noShow: 10, rate: 0.9 },
  reservationsByService: [{ name: 'Funcional', count: 70 }, { name: 'Yoga', count: 50 }],
  feesByPlan: [{ name: 'Mensual', count: 20, soldCents: 90000 }], collectedByMethod: [{ method: 'card', cents: 100000 }, { method: 'cash', cents: 50000 }],
  capabilities: { export: true }, ...extra,
});
const serveSummary = (summary) => {
  const urls = serve(() => response(sales([row(1)])));
  const base = globalThis.fetch;
  globalThis.fetch = async (url, init) => { if (String(url).includes('/api/reports/summary')) { urls.push(String(url)); return summary(String(url)); } return base(url, init); };
  return urls;
};

test('A59: the Resumen tab shows financial and operational KPIs and accessible SVG charts next to the sales list', async () => {
  const urls = serveSummary(() => response(summaryBody()));
  window.location.hash = '#reports'; mount();
  const tabs = await screen.findByRole('tablist', { name: 'Secciones de informes' });
  assert.deepEqual(within(tabs).getAllByRole('tab').map((tab) => tab.textContent), ['Ventas', 'Resumen']);
  await screen.findByRole('table', { name: 'Ventas del periodo' });
  fireEvent.click(within(tabs).getByRole('tab', { name: 'Resumen' }));
  const kpis = await screen.findByRole('list', { name: 'Indicadores del periodo' });
  assert.match(kpis.textContent, /Vencido sin cobrar/); assert.match(kpis.textContent, /250,00/); assert.match(kpis.textContent, /4 cuotas y cargos vencidos/);
  assert.match(kpis.textContent, /Cuota media/); assert.match(kpis.textContent, /45,00/);
  assert.match(kpis.textContent, /75 %/); assert.match(kpis.textContent, /120 de 160 plazas/);
  assert.match(kpis.textContent, /90 %/); assert.match(kpis.textContent, /90 asistencias y 10 ausencias/);
  for (const name of ['Ingresos mensuales', 'Reservas por servicio', 'Cuotas por plan', 'Cobros por método']) {
    assert.ok(screen.getByRole('heading', { name }), name);
    assert.ok(screen.getAllByRole('img').some((svg) => svg.getAttribute('aria-label')?.startsWith(name)), `${name} chart has a text alternative`);
    assert.ok(screen.getByRole('table', { name }), `${name} has an equivalent table`);
  }
  assert.match(screen.getByRole('table', { name: 'Reservas por servicio' }).textContent, /Funcional.*70/);
  assert.equal(document.querySelectorAll('svg.reports-chart-svg').length, 4);
  assert.ok(urls.some((url) => /\/api\/reports\/summary\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/.test(url)));
  const link = screen.getByRole('link', { name: 'Exportar Excel' });
  assert.ok(link.getAttribute('href').includes('/api/reports/export.xlsx?from='));
  assert.ok(!/Cliente \d/.test(document.body.textContent), 'no personal data in the summary');
});

test('A59: without billing.export there is no Excel link, a bad range blocks the request and a failure offers retry', async () => {
  let fail = true;
  const urls = serveSummary(() => (fail ? response({}, 500) : response(summaryBody({ capabilities: { export: false } }))));
  window.location.hash = '#reports'; mount();
  fireEvent.click(await screen.findByRole('tab', { name: 'Resumen' }));
  assert.ok(await screen.findByText('No se pudo cargar el resumen'));
  fail = false; fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByRole('list', { name: 'Indicadores del periodo' });
  assert.equal(screen.queryByRole('link', { name: 'Exportar Excel' }), null);
  const before = urls.length;
  fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2020-01-01' } });
  assert.ok(await screen.findByText(/como máximo 366 días/));
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(urls.length, before, 'a range over 366 days is never requested');
});
