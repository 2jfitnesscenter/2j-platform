import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#home' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { AppShell } = await import('../src/app-shell.tsx');
const { MyGymPage } = await import('../src/my-gym-page.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; delete dom.window.matchMedia; dom.window.localStorage.clear(); });
after(() => dom.window.close());
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const permissions = { calendar: true, clients: true, communications: true, documents: true, sensitiveReview: false, followup: true, billing: false, cash: false, transfers: false, staff: true, absences: true, timeclock: true };
const model = {
  timezone: 'Atlantic/Canary', permissions,
  today: { sessionCount: 0, upcomingCount: 0, capacity: 0, occupied: 0, waitlistCount: 0, unassignedCount: 0, sessions: [], nextSession: null },
  clients: { active: 12, recentSignups: 2 }, attention: [], economics: null, team: null, unread: 0, quickActions: [],
};
const capabilities = { calendar: true, clients: true, communications: true, billing: true, staff: true, ownerPanel: true };
const panelData = {
  timezone: 'Atlantic/Canary', asOf: '2026-10-25T12:00:00.000Z', localDate: '2026-10-25',
  today: {
    classes: { sessionCount: 2, capacity: 16, occupied: 9, sessions: [{ id: 's1', startsAt: '2026-10-25T09:00:00.000Z', serviceName: 'Pilates', capacity: 8, occupied: 6 }, { id: 's2', startsAt: '2026-10-25T17:00:00.000Z', serviceName: 'Fuerza', capacity: 8, occupied: 3 }] },
    clockedIn: [{ id: 'p1', displayName: 'Ana Ruiz', since: '2026-10-25T08:00:00.000Z', forgotten: false }, { id: 'p2', displayName: 'Leo Pérez', since: '2026-10-23T08:00:00.000Z', forgotten: true }],
    cash: { state: 'closed', openedAt: '2026-10-25T08:00:00.000Z', closedAt: '2026-10-25T16:00:00.000Z', differenceCents: -450, localDate: '2026-10-25' },
    collections: { pendingCents: 12500, chargeCount: 3, overdueCount: 1 },
    clients: { overdue: 2, blocked: 1 }, waitlist: { entries: 4, sessions: 2 },
    teamAlerts: { forgottenShifts: 1, activeAbsences: 1, unassignedSessions: 2 }, reviews: { transfers: 1, forms: 2, bunkerLinks: 3 },
  },
  week: {
    dueSoon: { assignments: 5, windowDays: 7 },
    sessions: { lowOccupancy: [{ id: 'l1', startsAt: '2026-10-26T09:00:00.000Z', serviceName: 'Yoga', capacity: 8, occupied: 1, waiting: 0 }], fullWithWaitlist: [{ id: 'f1', startsAt: '2026-10-27T18:00:00.000Z', serviceName: 'Fuerza', capacity: 8, occupied: 8, waiting: 3 }], thresholds: { lowOccupancyPercent: 25, lowOccupancyHoursAhead: 24 } },
    lowStock: { threshold: 3, items: [{ productName: 'Proteína', variantLabel: 'Bote 1 kg', stock: 2 }] },
    storeSales: { count: 4, collectedCents: 8000, pendingCents: 1990 },
  },
  month: {
    newClients: { thisMonth: 7, previousMonth: 5 },
    revenue: { plans: { thisMonthCents: 120000, previousMonthCents: 100000 }, store: { thisMonthCents: 30000, previousMonthCents: 0 }, byMethod: { cash: { thisMonthCents: 50000, previousMonthCents: 40000 }, card: { thisMonthCents: 100000, previousMonthCents: 60000 }, transfer: { thisMonthCents: 0, previousMonthCents: 0 } } },
    occupancyBySlot: [{ serviceName: 'Pilates', hour: 9, sessions: 8, occupancyPercent: 72 }],
    bunkerLinkedClients: 11,
  },
};
const serve = ({ panel = () => response(panelData), settings = () => response({ dueDay: 10, timezone: 'Atlantic/Canary', debtBlocksNewReservations: false, fiscalLegalGateOpen: false, documentRetentionMonths: 60 }) } = {}) => {
  const urls = [];
  globalThis.fetch = async (url) => {
    const path = String(url); urls.push(path);
    if (path.includes('/api/admin/owner-panel')) return panel();
    if (path.includes('/api/economics/settings')) return settings();
    if (path.includes('/api/admin/news')) return response({ items: [] });
    if (path.includes('/api/dashboard/command-center')) return response(model);
    if (path.includes('/api/session/capabilities')) return response(capabilities);
    return response({ groups: [] });
  };
  return urls;
};
const mount = () => render(React.createElement(AppShell, null, React.createElement(MyGymPage)));

test('Mi gimnasio opens on the Panel with HOY, ESTA SEMANA and ESTE MES, and the four tabs in order', async () => {
  serve(); window.location.hash = '#my-gym'; mount();
  assert.ok(await screen.findByRole('heading', { level: 1, name: 'Mi gimnasio' }));
  const group = screen.getByRole('group', { name: 'Secciones de Mi gimnasio' });
  assert.deepEqual(within(group).getAllByRole('button').map((button) => button.textContent), ['Panel', 'Datos del negocio', 'Novedades', 'Consentimientos']);
  assert.equal(within(group).getByRole('button', { name: 'Panel' }).getAttribute('aria-pressed'), 'true');
  for (const name of ['Hoy', 'Esta semana', 'Este mes']) assert.ok(await screen.findByRole('heading', { level: 2, name }));
});

test('the Panel shows today indicators, the cash difference (owner only), week lists and month comparisons', async () => {
  serve(); window.location.hash = '#my-gym'; mount();
  const today = await screen.findByRole('list', { name: 'Indicadores de hoy' });
  assert.match(within(today).getByText('Clases de hoy').closest('li').textContent, /9\/16/);
  assert.match(within(today).getByText('Fichados ahora').closest('li').textContent, /Ana Ruiz/);
  assert.match(within(today).getByText('Caja').closest('li').textContent, /Cerrada/);
  assert.match(within(today).getByText('Caja').closest('li').textContent, /Diferencia −4,50/);
  assert.match(within(today).getByText('Pendiente de cobro').closest('li').textContent, /125,00/);
  assert.match(within(today).getByText('Cuota vencida o bloqueada').closest('li').textContent, /1 bloqueado/);
  assert.match(within(today).getByText('Pendiente de revisar').closest('li').textContent, /1 transferencias · 2 formularios · 3 vinculaciones de Búnker/);
  const week = screen.getByRole('list', { name: 'Indicadores de la semana' });
  assert.match(within(week).getByText('Cuotas que vencen').closest('li').textContent, /5/);
  assert.ok(screen.getByRole('region', { name: 'Clases con pocas reservas' }));
  assert.match(screen.getByRole('region', { name: 'Clases llenas con lista de espera' }).textContent, /3 en espera/);
  assert.match(screen.getByRole('region', { name: 'Productos con stock bajo' }).textContent, /Proteína/);
  const month = screen.getByRole('list', { name: 'Indicadores del mes' });
  assert.match(within(month).getByText('Altas del mes').closest('li').textContent, /Mes anterior: 5/);
  assert.match(within(month).getByText('Cobrado en cuotas').closest('li').textContent, /\+20 %/);
  const methods = within(screen.getByRole('region', { name: 'Cobrado por método de pago' })).getAllByRole('row');
  assert.equal(methods.length, 3, 'header + the two methods with movement (transfer without money is hidden)');
  assert.match(screen.getByRole('region', { name: 'Ocupación media por servicio y franja' }).textContent, /09:00.*72 %/);
});

test('without the owner permission the Panel explains it and shows no numbers; a failing feed offers retry', async () => {
  serve({ panel: () => response({ error: 'permission_denied' }, 403) }); window.location.hash = '#my-gym'; mount();
  assert.ok(await screen.findByText('El panel del propietario es solo para el propietario'));
  assert.equal(screen.queryByRole('list', { name: 'Indicadores de hoy' }), null);
  cleanup();
  serve({ panel: () => response({ error: 'x' }, 500) }); mount();
  assert.ok(await screen.findByText('No se pudo cargar el panel'));
  assert.ok(screen.getByRole('button', { name: 'Reintentar' }));
});

test('Datos del negocio shows what Platform stores and says plainly what is not connected', async () => {
  const urls = serve(); window.location.hash = '#my-gym'; mount();
  await screen.findByRole('heading', { level: 2, name: 'Hoy' });
  fireEvent.click(screen.getByRole('button', { name: 'Datos del negocio' }));
  assert.ok(await screen.findByText('Día 10 · el bloqueo empieza a las 00:00 del día siguiente'));
  assert.ok(screen.getByText('Cerrada hasta la validación fiscal (D106)'));
  assert.ok(screen.getByText('60 meses'));
  cleanup();
  serve({ settings: () => response({ dueDay: 10, timezone: 'Atlantic/Canary', debtBlocksNewReservations: true, fiscalLegalGateOpen: false, documentRetentionMonths: null }) }); mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Datos del negocio' }));
  assert.ok(await screen.findByText('Sin definir'), 'a null retention is not printed as "null meses"');
  assert.equal(document.body.textContent.includes('null'), false);
  assert.match(screen.getByRole('note').textContent, /No conectado/);
  assert.equal(document.querySelectorAll('input, textarea').length, 0, 'no editable field that would not save');
  assert.ok(urls.some((path) => path.includes('/api/economics/settings')));
});

test('Novedades embeds the existing news screen with a single page heading, and Consentimientos points to the client file without health content', async () => {
  serve(); window.location.hash = '#my-gym'; mount();
  await screen.findByRole('heading', { level: 2, name: 'Hoy' });
  fireEvent.click(screen.getByRole('button', { name: 'Novedades' }));
  assert.ok(await screen.findByRole('heading', { level: 2, name: 'Noticias' }));
  assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1, 'no second h1');
  assert.equal(document.querySelectorAll('main').length, 1, 'no nested main');
  fireEvent.click(screen.getByRole('button', { name: 'Consentimientos' }));
  assert.ok(await screen.findByText('Se gestionan desde la ficha de cada cliente'));
  assert.equal(screen.getByRole('link', { name: 'Ir a Clientes' }).getAttribute('href'), '#clients');
});

test('the navigation lists Mi gimnasio inside Gestión', async () => {
  serve(); window.location.hash = '#my-gym'; mount();
  await screen.findByRole('heading', { level: 1, name: 'Mi gimnasio' });
  const nav = within(document.querySelector('.app-navigation'));
  assert.equal(nav.getByRole('link', { name: 'Mi gimnasio' }).getAttribute('aria-current'), 'page');
});
