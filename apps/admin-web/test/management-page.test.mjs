import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#management' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, render, screen, within } = await import('@testing-library/react');
const { ManagementPage } = await import('../src/management-page.tsx');
const { getProfessionalNavigation, getProfessionalPageContext } = await import('../src/app-shell.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; });
after(() => dom.window.close());
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const panel = (extra = {}) => ({
  timezone: 'Atlantic/Canary', windows: { shiftDays: 14, differenceDays: 30 },
  openRegisters: [{ id: 'o-1', registerName: 'Sala', localDate: '2026-10-29', openedAt: '2026-10-29T08:00:00Z', custodian: 'Pedro Guerra', forgotten: false }, { id: 'o-2', registerName: 'Búnker', localDate: '2026-10-27', openedAt: '2026-10-27T08:00:00Z', custodian: null, forgotten: true }],
  closedShifts: [{ id: 'c-1', registerName: 'Sala', localDate: '2026-10-28', openedAt: '2026-10-28T08:00:00Z', closedAt: '2026-10-28T20:00:00Z', status: 'closed', countedCents: 15000, expectedCents: 15250, differenceCents: -250 }, { id: 'c-2', registerName: 'Búnker', localDate: '2026-10-27', openedAt: '2026-10-27T08:00:00Z', closedAt: '2026-10-27T21:00:00Z', status: 'late_close', countedCents: 5000, expectedCents: 5000, differenceCents: 0 }],
  accumulatedDifference: { differenceCents: -250, shiftsWithDifference: 1, shifts: 2 },
  teamClockings: [{ id: 'k-1', displayName: 'Ana Coach', eventType: 'clock_in', occurredAt: '2026-10-29T08:05:00Z', origin: 'web' }],
  ...extra,
});

test('Panel de gestión shows open registers (flagging a previous day), closed shifts with their difference, the accumulated difference and clockings without hour totals', async () => {
  globalThis.fetch = async () => response(panel());
  render(React.createElement(ManagementPage));
  assert.ok(await screen.findByRole('heading', { level: 1, name: 'Panel de gestión' }));
  const tiles = await screen.findByRole('list', { name: 'Resumen de gestión' });
  assert.match(tiles.textContent, /Cajas abiertas ahora2/);
  assert.match(tiles.textContent, /1 de días anteriores/);
  assert.match(tiles.textContent, /−2,50/);
  assert.match(tiles.textContent, /1 de 2 turnos con diferencia · 30 días/);
  const open = screen.getByRole('list', { name: 'Cajas abiertas' });
  assert.match(open.textContent, /A cargo de Pedro Guerra/); assert.match(open.textContent, /Sin responsable asignado/); assert.match(open.textContent, /Día anterior/);
  const table = screen.getByRole('table', { name: 'Turnos de caja cerrados' });
  const rows = within(table).getAllByRole('row').slice(1);
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /−2,50/); assert.match(rows[1].textContent, /Cierre tardío/); assert.match(rows[1].textContent, /Cuadra/);
  assert.match(screen.getByRole('list', { name: 'Fichajes de hoy' }).textContent, /Ana Coach.*Entrada/s);
  assert.equal(/horas/i.test(document.body.textContent.replace('Sin totales de horas.', '')), false, 'D121: no hour totals');
});

test('anyone without the owner grant only sees an explanation, never cash figures; empty and failed loads say so', async () => {
  globalThis.fetch = async () => response({ error: 'permission_denied' }, 403);
  render(React.createElement(ManagementPage));
  assert.ok(await screen.findByText('Este panel es solo para el propietario'));
  assert.equal(document.querySelector('table'), null);
  cleanup();
  globalThis.fetch = async () => response(panel({ openRegisters: [], closedShifts: [], teamClockings: [], accumulatedDifference: { differenceCents: 0, shiftsWithDifference: 0, shifts: 0 } }));
  render(React.createElement(ManagementPage));
  assert.ok(await screen.findByText('No hay ninguna caja abierta'));
  assert.ok(screen.getByText('Sin turnos cerrados en este periodo'));
  assert.ok(screen.getByText('Nadie ha fichado hoy'));
  cleanup();
  globalThis.fetch = async () => response({}, 500);
  render(React.createElement(ManagementPage));
  assert.ok(await screen.findByText('No se pudo cargar el panel'));
});

test('Panel de gestión sits under Administración and only appears with the owner panel capability', () => {
  const base = { calendar: true, clients: true, communications: true, billing: true, staff: true };
  const group = (caps) => getProfessionalNavigation(caps).find((section) => section.id === 'administration');
  assert.equal(group(base), undefined);
  assert.deepEqual(group({ ...base, ownerPanel: true }).children.map((route) => route.label), ['Panel de gestión']);
  assert.equal(getProfessionalPageContext('management').section, 'Administración');
});
