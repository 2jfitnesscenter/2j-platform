import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#monitoring' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, render, screen, within } = await import('@testing-library/react');
const { MonitoringPage } = await import('../src/monitoring-page.tsx');
const { getProfessionalNavigation, getProfessionalPageContext } = await import('../src/app-shell.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; });
after(() => dom.window.close());
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const report = (extra = {}) => ({
  timezone: 'Atlantic/Canary', checkedAt: '2026-10-29T10:00:00Z', uptimeSeconds: 93784, healthy: true,
  checks: [{ id: 'database', label: 'Base de datos', ok: true, detail: 'Responde en 3 ms' }, { id: 'migrations', label: 'Migraciones aplicadas', ok: true, detail: '57 de 57' }, { id: 'api', label: 'Servidor de la API', ok: true, detail: 'Atiende peticiones' }],
  counts: { activeClients: 120, activePlanAssignments: 98, openCashRegisters: 1, scheduledSessionsNext7Days: 64 },
  ...extra,
});

test('Monitorización shows pass/fail checks, uptime and counters, and nothing that looks like a secret or setting', async () => {
  globalThis.fetch = async () => response(report());
  render(React.createElement(MonitoringPage));
  assert.ok(await screen.findByRole('heading', { level: 1, name: 'Monitorización' }));
  const checks = await screen.findByRole('list', { name: 'Resultado de las comprobaciones' });
  assert.equal(within(checks).getAllByRole('listitem').length, 3);
  assert.match(checks.textContent, /Responde en 3 ms/); assert.match(checks.textContent, /57 de 57/);
  assert.ok(screen.getByText('Todo en orden'));
  assert.match(document.body.textContent, /desde hace 1 d 2 h/);
  const counts = screen.getByRole('list', { name: 'Contadores del centro' });
  assert.match(counts.textContent, /Clientes activos120/); assert.match(counts.textContent, /Sesiones próximas64/);
  assert.equal(document.querySelectorAll('input, textarea, select, form').length, 0, 'read-only: no inputs');
  assert.equal(/clave|secret|token|contraseña|DATABASE/i.test(document.body.textContent.replace('aquí no hay claves ni configuración', '').replace('nunca', '')), false);
});

test('a failing check turns the report red, and denied, unreachable or missing counters say so', async () => {
  globalThis.fetch = async () => response(report({ healthy: false, checks: [{ id: 'migrations', label: 'Migraciones aplicadas', ok: false, detail: 'Faltan 2 (55 de 57)' }], counts: { activeClients: null, activePlanAssignments: null, openCashRegisters: null, scheduledSessionsNext7Days: null } }));
  render(React.createElement(MonitoringPage));
  assert.ok(await screen.findByText('Hay problemas'));
  assert.ok(screen.getByText('Falla'));
  assert.match(screen.getByRole('list', { name: 'Contadores del centro' }).textContent, /Clientes activos—/);
  cleanup();
  globalThis.fetch = async () => response({}, 403);
  render(React.createElement(MonitoringPage));
  assert.ok(await screen.findByText('Esta sección es solo para el propietario'));
  cleanup();
  globalThis.fetch = async () => { throw new Error('offline'); };
  render(React.createElement(MonitoringPage));
  assert.ok(await screen.findByText('No se pudo consultar el estado'));
});

test('Monitorización sits under Administración and only appears with the owner panel capability', () => {
  const base = { calendar: true, clients: true, communications: true, billing: true, staff: true };
  const group = (caps) => getProfessionalNavigation(caps).find((section) => section.id === 'administration');
  assert.equal(group(base), undefined);
  assert.deepEqual(group({ ...base, ownerPanel: true }).children.map((route) => route.label), ['Monitorización']);
  assert.equal(getProfessionalPageContext('monitoring').section, 'Administración');
});
