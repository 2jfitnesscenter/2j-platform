import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#home' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { AppShell } = await import('../src/app-shell.tsx');
const { SettingsPage } = await import('../src/settings-page.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; delete dom.window.matchMedia; dom.window.localStorage.clear(); });
after(() => dom.window.close());
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const permissions = { calendar: true, clients: true, communications: true, documents: true, sensitiveReview: false, followup: true, billing: true, cash: false, transfers: false, staff: true, absences: true, timeclock: true };
const model = {
  timezone: 'Atlantic/Canary', permissions,
  today: { sessionCount: 0, upcomingCount: 0, capacity: 0, occupied: 0, waitlistCount: 0, unassignedCount: 0, sessions: [], nextSession: null },
  clients: { active: 12, recentSignups: 2 }, attention: [], economics: null, team: null, unread: 0, quickActions: [],
};
const overview = {
  timezone: 'Atlantic/Canary',
  payments: { dueDay: 10, graceDays: 5, timezone: 'Atlantic/Canary', debtBlocksNewReservations: true, fiscalLegalGateOpen: false, documentRetentionMonths: null, methods: ['cash', 'card', 'transfer', 'direct_debit', 'other'] },
  profiles: [
    { id: 'admin', label: 'Administración', wildcard: true, permissionCount: null, groups: [] },
    { id: 'accountant', label: 'Contabilidad', wildcard: false, permissionCount: 3, groups: [{ id: 'billing', label: 'Economía', permissions: ['billing.export', 'billing.read-basic', 'billing.read-tax'] }] },
  ],
  integrations: { trainingSso: true, trainingServiceCalls: false, trainingLinking: false, trainingSignals: false, trainingProvisioning: false, push: true, passkeys: false, memberAuthPilot: false, memberBookingPilot: false },
};
const serve = (handler) => {
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes('/api/settings/overview')) return handler(path);
    if (path.includes('/api/dashboard/command-center')) return response(model);
    if (path.includes('/api/session/capabilities')) return response({ calendar: true, clients: true, communications: true, billing: true, staff: true, notificationSettings: true });
    return response({ groups: [] });
  };
};
const mount = () => { window.location.hash = '#settings'; return render(React.createElement(AppShell, null, React.createElement(SettingsPage))); };
const openTab = async (name) => { fireEvent.click(await screen.findByRole('tab', { name })); return screen.findByRole('tabpanel'); };

test('Configuración offers the seven Base44 tabs and the unconnected ones say so visibly, with disabled fields and no save button', async () => {
  serve(() => response(overview)); mount();
  assert.ok(await screen.findByRole('heading', { name: 'Configuración' }));
  const tabs = await screen.findAllByRole('tab');
  assert.deepEqual(tabs.map((tab) => tab.textContent), ['Centro', 'Apariencia', 'Reservas', 'Pagos', 'Tienda', 'Permisos', 'Integraciones']);
  for (const name of ['Centro', 'Apariencia', 'Reservas', 'Tienda']) {
    const panel = await openTab(name);
    assert.match(panel.textContent, /No conectado: estos ajustes todavía no se guardan/, name);
    const inputs = panel.querySelectorAll('input');
    assert.ok(inputs.length > 0 && [...inputs].every((input) => input.disabled), `${name}: every field disabled`);
  }
  assert.equal(screen.queryByRole('button', { name: /guardar/i }), null, 'no misleading save button');
});

test('Pagos shows the real economic rules read-only, Centro shows the fixed Canary timezone, and nothing fiscal is offered', async () => {
  serve(() => response(overview)); mount();
  const payments = await openTab('Pagos');
  assert.match(payments.textContent, /Día 10 de cada mes/); assert.match(payments.textContent, /Días de gracia5/);
  assert.match(payments.textContent, /00:00 del día siguiente/); assert.match(payments.textContent, /Puerta fiscalCerrada/);
  assert.match(payments.textContent, /Domiciliación/); assert.doesNotMatch(payments.textContent, /No conectado: estos ajustes/);
  assert.equal(payments.querySelectorAll('input').length, 0);
  const center = await openTab('Centro');
  assert.match(center.textContent, /Atlantic\/Canary/);
  assert.deepEqual([...center.querySelectorAll("label")].filter((label) => /CIF|NIF|Razón social|factura/i.test(label.textContent)), [], "no fiscal fields");
});

test('Permisos lists profiles with their grouped permissions, never users; Integraciones shows only enabled or disabled', async () => {
  serve(() => response(overview)); mount();
  const permissionsPanel = await openTab('Permisos');
  const accountant = within(permissionsPanel).getByRole('region', { name: 'Perfil Contabilidad' });
  assert.match(accountant.textContent, /3 permisos/); assert.match(accountant.textContent, /Economía/);
  assert.match(within(permissionsPanel).getByRole('region', { name: 'Perfil Administración' }).textContent, /Acceso completo/);
  const integrations = await openTab('Integraciones');
  const sso = within(integrations).getByText('Acceso único con Búnker (SSO)').closest('li');
  assert.match(sso.textContent, /Activada/);
  assert.match(within(integrations).getByText('Acceso con llaves de acceso (passkeys)').closest('li').textContent, /Desactivada/);
  assert.doesNotMatch(integrations.textContent, /https?:\/\//);
  assert.equal(within(integrations).getByRole('link', { name: 'Ajustes de avisos' }).getAttribute('href'), '#notification-settings');
});

test('a profile without settings.manage is told so, a failing load offers retry, and the navigation lists Configuración', async () => {
  serve(() => response({ error: 'permission_denied' }, 403)); mount();
  assert.ok(await screen.findByText('Tu perfil no puede consultar la configuración'));
  cleanup();
  let fail = true;
  serve(() => fail ? response({ error: 'x' }, 500) : response(overview)); mount();
  assert.ok(await screen.findByText('No se pudo cargar la configuración'));
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  assert.ok(await screen.findByRole('tab', { name: 'Pagos' }));
  const nav = within(document.querySelector('.app-navigation'));
  assert.equal(nav.getByRole('link', { name: 'Configuración' }).getAttribute('aria-current'), 'page');
});
