import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#contracts' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { ContractsPage } = await import('../src/contracts-page.tsx');
const { getProfessionalNavigation } = await import('../src/app-shell.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; });
after(() => dom.window.close());
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const item = (n, overrides = {}) => ({ id: `k-${n}`, clientId: `c-${n}`, clientName: `Cliente ${n}`, planName: `Bono ${n}`, kind: 'recurring', startsOn: '2026-10-01', endsOn: '2026-11-01', status: 'active', paymentState: 'paid', dueOn: '2026-10-01', amountCents: 4500, balanceCents: 0, expiringSoon: false, ...overrides });
const contracts = (items, extra = {}) => ({ items, summary: { activeCount: 2, expiringSoonCount: 1, pendingCents: 4500 }, capabilities: { money: true, assignPlans: true }, ...extra });
const serve = (handler) => { const urls = []; globalThis.fetch = async (url) => { urls.push(String(url)); return handler(String(url)); }; return urls; };

test('Contratos lists each cuota with client, plan, dates, status and payment, and shows the three summary tiles', async () => {
  serve(() => response(contracts([item(1), item(2, { status: 'active', paymentState: 'unpaid', balanceCents: 4500, expiringSoon: true, endsOn: '2026-10-31' }), item(3, { status: 'scheduled', paymentState: 'pending', endsOn: null })])));
  render(React.createElement(ContractsPage));
  assert.ok(await screen.findByRole('heading', { level: 1, name: 'Contratos' }));
  await screen.findByRole('table', { name: 'Contratos' });
  const tiles = screen.getByRole('list', { name: 'Resumen de contratos' });
  assert.match(tiles.textContent, /Cuotas vigentes/); assert.match(tiles.textContent, /Vencen en 7 días/); assert.match(tiles.textContent, /Importe pendiente/);
  const table = screen.getByRole('table', { name: 'Contratos' });
  assert.deepEqual(within(table).getAllByRole('columnheader').map((cell) => cell.textContent), ['Cliente', 'Cuota', 'Inicio', 'Fin', 'Estado', 'Pago', 'Pendiente']);
  const rows = within(table).getAllByRole('row').slice(1);
  assert.equal(rows.length, 3);
  assert.match(rows[0].textContent, /Vigente/); assert.match(rows[0].textContent, /Al día/);
  assert.match(rows[1].textContent, /Vence pronto/); assert.match(rows[1].textContent, /Vencido/);
  assert.match(rows[2].textContent, /Programada/); assert.match(rows[2].textContent, /Sin caducidad/);
  assert.equal(within(rows[0]).getByRole('link', { name: 'Cliente 1' }).getAttribute('href'), '#clients?clientId=c-1');
  assert.ok(screen.getByText(/usa «Asignar cuota»/));
});

test('changing the filters asks the API again with that status, payment, expiring flag and client text', async () => {
  const urls = serve(() => response(contracts([item(1)])));
  render(React.createElement(ContractsPage));
  await screen.findByRole('table', { name: 'Contratos' });
  fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'expired' } });
  fireEvent.change(screen.getByLabelText('Pago'), { target: { value: 'unpaid' } });
  fireEvent.click(screen.getByLabelText('Solo los que vencen en 7 días'));
  fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'Marta' } });
  await waitFor(() => assert.ok(urls.some((url) => /status=expired/.test(url) && /payment=unpaid/.test(url) && /expiring=1/.test(url) && /q=Marta/.test(url))));
});

test('without billing permission the money columns and the payment filter are not shown', async () => {
  serve(() => response(contracts([item(1, { paymentState: null, amountCents: null, balanceCents: null })], { summary: { activeCount: 2, expiringSoonCount: 0, pendingCents: null }, capabilities: { money: false, assignPlans: false } })));
  render(React.createElement(ContractsPage));
  const table = await screen.findByRole('table', { name: 'Contratos' });
  assert.deepEqual(within(table).getAllByRole('columnheader').map((cell) => cell.textContent), ['Cliente', 'Cuota', 'Inicio', 'Fin', 'Estado']);
  assert.equal(screen.queryByLabelText('Pago'), null);
  assert.equal(screen.queryByText('Importe pendiente'), null);
  assert.equal(screen.queryByText(/usa «Asignar cuota»/), null);
});

test('forbidden, empty and failed loads each say what happened', async () => {
  serve(() => response({}, 403));
  render(React.createElement(ContractsPage));
  assert.ok(await screen.findByText('Tu perfil no puede consultar los contratos'));
  cleanup();
  serve(() => response(contracts([])));
  render(React.createElement(ContractsPage));
  assert.ok(await screen.findByText('Sin contratos con estos filtros'));
  cleanup();
  serve(() => response({}, 500));
  render(React.createElement(ContractsPage));
  assert.ok(await screen.findByText('No se pudieron cargar los contratos'));
});

test('Contratos is listed in the navigation for profiles with economic access', () => {
  const nav = getProfessionalNavigation({ calendar: false, clients: false, communications: false, billing: true, staff: false });
  const labels = nav.flatMap((section) => section.children ?? [section.route]).filter(Boolean).map((route) => route.label);
  assert.ok(labels.includes('Contratos'));
  const none = getProfessionalNavigation({ calendar: false, clients: false, communications: false, billing: false, staff: false });
  assert.equal(none.flatMap((section) => section.children ?? [section.route]).filter(Boolean).some((route) => route.label === 'Contratos'), false);
});
