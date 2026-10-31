import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#clients', pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, within } = await import('@testing-library/react');
const { BalanceCards, MonthCalendar, balanceCounters, monthGrid } = await import('../src/client-overview.tsx');
afterEach(() => cleanup());
after(() => dom.window.close());

const periods = [
  { id: 'p1', startsOn: '2026-09-01', endsOn: '2026-09-30', sessionsGranted: 12, balance: 0 },
  { id: 'p2', startsOn: '2026-10-01', endsOn: '2026-10-31', sessionsGranted: 12, balance: 7 },
];
const assignments = [
  { id: 'a1', planName: 'Cuota 3 días', endsOn: '2026-10-31', derivedStatus: 'active', rights: [{ rightType: 'sessions_quota', serviceName: 'Entrenamiento', quantity: null, periods }, { rightType: 'service_access', serviceName: 'Sala', quantity: null }] },
  { id: 'a2', planName: 'Bono 10', endsOn: '2026-12-31', derivedStatus: 'active', rights: [{ rightType: 'sessions_quota', serviceName: 'Pilates', quantity: 10, balance: 4 }] },
  { id: 'a3', planName: 'Libre', endsOn: null, derivedStatus: 'active', rights: [{ rightType: 'sessions_quota', serviceName: null, quantity: null, quantityRule: 'unlimited' }] },
  { id: 'a4', planName: 'Caducada', endsOn: '2026-01-31', derivedStatus: 'expired', rights: [{ rightType: 'sessions_quota', serviceName: 'Antigua', quantity: 5, balance: 5 }] },
  { id: 'a5', planName: 'Sin vigente', endsOn: '2026-12-31', derivedStatus: 'active', rights: [{ rightType: 'sessions_quota', serviceName: 'Futuro', quantity: null, periods: [{ id: 'p9', startsOn: '2026-11-01', endsOn: '2026-11-30', sessionsGranted: 8, balance: 8 }] }] },
];

test('balanceCounters shows the balance of the current period or right, unlimited rights, and invents nothing for expired plans or periods that are not current', () => {
  const counters = balanceCounters(assignments, '2026-10-31');
  assert.deepEqual(counters.map((counter) => [counter.label, counter.unlimited, counter.available, counter.granted, counter.until]), [
    ['Entrenamiento', false, 7, 12, '2026-10-31'],
    ['Pilates', false, 4, 10, '2026-12-31'],
    ['Sesiones', true, 0, null, null],
  ], 'no card for the expired plan, for the access right, or for a bag that starts next month');
});

test('Saldo de cuota renders one card per counter with an accessible progress bar', () => {
  render(React.createElement(BalanceCards, { assignments: assignments.slice(0, 3) }));
  const section = screen.getByRole('region', { name: 'Saldo de cuota' });
  assert.match(section.textContent, /7 sesiones disponibles de 12/);
  assert.match(section.textContent, /4 sesiones disponibles de 10/);
  assert.match(section.textContent, /Sin límite/);
  const bar = within(section).getByRole('progressbar', { name: 'Saldo de Entrenamiento' });
  assert.equal(bar.getAttribute('aria-valuenow'), '7'); assert.equal(bar.getAttribute('aria-valuemax'), '12');
  assert.equal(within(section).queryAllByRole('progressbar').length, 2, 'the unlimited card has no bar');
  cleanup();
  render(React.createElement(BalanceCards, { assignments: [] }));
  assert.ok(screen.getByText('Sin cuota con sesiones activa.'));
});

test('monthGrid starts on Monday and fills the last week', () => {
  const october = monthGrid(2026, 9); // 1 oct 2026 is a Thursday
  assert.equal(october.length % 7, 0);
  assert.deepEqual(october.slice(0, 4).map((cell) => cell?.day ?? null), [null, null, null, 1]);
  assert.equal(october.filter(Boolean).length, 31);
  assert.equal(monthGrid(2026, 1).filter(Boolean).length, 28);
});

const reservation = (id, startsAt, extra = {}) => ({ id, status: 'reserved', startsAt, sessionStatus: 'scheduled', serviceName: 'Entrenamiento', areaName: 'Sala', ...extra });

test('the month calendar marks days with the client\'s bookings (Canary time), lists a day on click, skips cancelled ones, and moves between months', () => {
  const reservations = [
    reservation('r1', '2026-10-12T08:00:00.000Z'),
    reservation('r2', '2026-10-12T17:30:00.000Z', { serviceName: 'Pilates', status: 'attended' }),
    reservation('r3', '2026-10-20T09:00:00.000Z', { status: 'cancelled' }),
    reservation('r4', '2026-10-21T09:00:00.000Z', { sessionStatus: 'cancelled' }),
    reservation('r5', '2026-11-03T09:00:00.000Z'),
    reservation('r7', '2026-10-12T23:30:00.000Z'), // 00:30 del 13 en Canarias (UTC+1 hasta el 25 de octubre): el día es el local, no el UTC
  ];
  render(React.createElement(MonthCalendar, { reservations, now: new Date('2026-10-15T10:00:00.000Z') }));
  const calendar = screen.getByRole('region', { name: 'Calendario del mes' });
  assert.equal(within(calendar).getByRole('status').textContent, 'octubre de 2026');
  const day12 = within(calendar).getByRole('button', { name: '12 de octubre: 2 reservas' });
  assert.equal(day12.disabled, false);
  assert.ok(within(calendar).getByRole('button', { name: '13 de octubre: 1 reserva' }), 'a booking after 23:00 UTC lands on the next local day');
  assert.equal(within(calendar).getByRole('button', { name: '20 de octubre' }).disabled, true, 'a cancelled booking does not mark the day');
  assert.equal(within(calendar).getByRole('button', { name: '21 de octubre' }).disabled, true, 'nor does a cancelled session');
  assert.equal(within(calendar).queryByRole('list', { name: 'Reservas del día' }), null);
  fireEvent.click(day12);
  const list = within(calendar).getByRole('list', { name: 'Reservas del día' });
  assert.equal(within(list).getAllByRole('listitem').length, 2, 'the 23:30 UTC booking is not in the 12th');
  assert.match(list.textContent, /Pilates/); assert.match(list.textContent, /Asistió/);
  fireEvent.click(day12);
  assert.equal(within(calendar).queryByRole('list', { name: 'Reservas del día' }), null, 'the same day toggles off');
  fireEvent.click(within(calendar).getByRole('button', { name: 'Mes siguiente' }));
  assert.equal(within(calendar).getByRole('status').textContent, 'noviembre de 2026');
  assert.ok(within(calendar).getByRole('button', { name: /3 de noviembre: 1 reserva$/ }));
  fireEvent.click(within(calendar).getByRole('button', { name: 'Mes anterior' }));
  fireEvent.click(within(calendar).getByRole('button', { name: 'Mes anterior' }));
  assert.equal(within(calendar).getByRole('status').textContent, 'septiembre de 2026');
  assert.ok(screen.getByText('Sin reservas este mes.'));
});

test('a negative balance never shows as negative sessions', () => {
  render(React.createElement(BalanceCards, { assignments: [{ id: 'n', planName: 'Bono', endsOn: null, derivedStatus: 'active', rights: [{ rightType: 'sessions_quota', serviceName: 'Fuerza', quantity: 10, balance: -1 }] }] }));
  assert.match(screen.getByRole('region', { name: 'Saldo de cuota' }).textContent, /0 sesiones disponibles de 10/);
});
