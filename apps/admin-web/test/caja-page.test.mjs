import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#caja' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { CajaPage } = await import('../src/caja-page.tsx');
const { getProfessionalNavigation } = await import('../src/app-shell.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; });
after(() => dom.window.close());
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Atlantic/Canary' });

const registers = (overrides = {}) => ({ items: [
  { id: 'r1', code: 'bunker', name: 'Búnker', active: true, available: true, ownCustody: false, sessionId: null, ...overrides.bunker },
  { id: 'r2', code: 'sala', name: 'Sala', active: true, available: true, ownCustody: false, sessionId: null, ...overrides.sala },
] });
const ownerSession = { id: 's1', registerCode: 'bunker', registerName: 'Búnker', localDate: todayIso, status: 'closed', openedAt: '2026-10-28T08:00:00Z', closedAt: '2026-10-28T20:00:00Z', openedByName: 'Ana', closedByName: 'Ana', openingCents: 5000, expectedCents: 5000, countedCents: 4900, differenceCents: -100, balanced: false };
const blindSession = { id: 's1', registerCode: 'bunker', registerName: 'Búnker', localDate: todayIso, status: 'closed', openedAt: '2026-10-28T08:00:00Z', closedAt: '2026-10-28T20:00:00Z', openedByName: 'Ana', closedByName: 'Ana' };
const ownerDay = { date: todayIso, total: { expectedCents: 5000, countedCents: 4900, differenceCents: -100, balanced: false }, registers: [{ id: 's1', registerCode: 'bunker', registerName: 'Búnker', localDate: todayIso, status: 'closed', openingDenominations: { bill_5: 10 }, countedDenominations: { bill_5: 9, coin_2: 2 }, movements: [{ id: 'expense-1', kind: 'expense', amountCents: 100, reason: 'Compra de material', status: 'approved', hasReceipt: true, occurredAt: '2026-10-28T19:30:00Z' }], handovers: [{ id: 'handover-1', outgoingDenominations: { bill_5: 10 }, incomingDenominations: { bill_5: 9, coin_2: 2 }, completedAt: '2026-10-28T14:00:00Z', mismatch: true, createdAt: '2026-10-28T13:55:00Z' }] }] };
const staffDay = { items: [], session: { id: 'own-session', registerCode: 'bunker', registerName: 'Búnker', localDate: todayIso, status: 'open', movements: [{ id: 'own-payment', kind: 'payment', amountCents: 1200, method: 'cash', occurredAt: '2026-10-28T12:15:00Z' }] } };
const serve = ({ owner = false, regs = registers(), onPost = () => response({ id: 'x' }, 201) } = {}) => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    calls.push({ path, options });
    if (options.method === 'POST') return onPost(path, options);
    if (path.endsWith('/api/session/capabilities')) return response({ ownerPanel: owner, cash: true });
    if (path.endsWith('/api/economics/cash/registers')) return response(regs);
    if (path.endsWith('/api/economics/cash/today')) return response({ items: owner ? [ownerSession] : [], session: owner ? null : staffDay.session });
    if (path.endsWith('/api/economics/cash/day')) return response(ownerDay);
    if (path.includes('/api/economics/cash/sessions')) return response(owner
      ? { from: todayIso, to: todayIso, items: [ownerSession], days: [{ date: todayIso, sessions: 1, openCount: 0, closed: true, expectedCents: 5000, countedCents: 4900, differenceCents: -100, balanced: false }], truncated: false }
      : { from: todayIso, to: todayIso, items: [blindSession], days: [{ date: todayIso, sessions: 1, openCount: 0, closed: true }], truncated: false });
    return response({}, 404);
  };
  return calls;
};

test('el propietario ve esperado, contado y diferencia; el cajero no ve ninguno (D111/A38)', async () => {
  serve({ owner: true });
  render(React.createElement(CajaPage));
  await screen.findByRole('heading', { name: 'Informe diario' });
  const sessions = within(screen.getByRole('region', { name: 'Sesiones por caja' }));
  for (const header of ['Esperado', 'Contado', 'Diferencia']) assert.ok(sessions.getByRole('columnheader', { name: header }));
  assert.ok(sessions.getAllByText(/-1,00/).length >= 1);
  cleanup();

  serve({ owner: false });
  render(React.createElement(CajaPage));
  await screen.findByRole('heading', { name: 'Informe diario' });
  const blind = within(screen.getByRole('region', { name: 'Sesiones por caja' }));
  for (const header of ['Esperado', 'Contado', 'Diferencia', 'Fondo']) assert.equal(blind.queryByRole('columnheader', { name: header }), null);
  assert.equal(document.body.textContent.includes('-1,00'), false);
  assert.ok(screen.getByText('Cobro'));
  assert.equal(screen.queryByText(/No conectado/), null);
});

test('la actividad conecta movimientos, recuentos por denominación y traspasos del API existente', async () => {
  serve({ owner: true });
  render(React.createElement(CajaPage));
  const detail = await screen.findByRole('region', { name: 'Movimientos y recuentos de hoy' });
  assert.ok(within(detail).getByText(/Compra de material/));
  assert.ok(within(detail).getByText(/Justificante adjunto/));
  assert.ok(within(detail).getByText('Traspaso completado'));
  assert.ok(within(detail).getByText('Incidencia: recuentos distintos'));
  assert.ok(within(detail).getAllByText('Billetes de 5 €: 10').length >= 2);
  assert.ok(within(detail).getAllByText('Monedas de 2 €: 2').length >= 2);

  serve({ owner: false });
  cleanup();
  render(React.createElement(CajaPage));
  const staffDetail = await screen.findByRole('region', { name: 'Movimientos y recuentos de hoy' });
  assert.ok(within(staffDetail).getByText('Cobro'));
  assert.equal(within(staffDetail).queryByText(/Compra de material/), null);
  assert.equal(within(staffDetail).queryByText('Traspaso completado'), null);
  assert.equal(within(staffDetail).queryByText(/Esperado|Diferencia/), null);
});

test('abrir caja exige las 15 denominaciones y envía el recuento a la API', async () => {
  const calls = serve({ owner: false });
  render(React.createElement(CajaPage));
  const buttons = await screen.findAllByRole('button', { name: 'Abrir caja' });
  fireEvent.click(buttons[0]);
  const form = await screen.findByRole('form', { name: 'Abrir Sala' });
  const inputs = within(form).getAllByRole('textbox');
  assert.equal(inputs.length, 15);
  const submit = within(form).getByRole('button', { name: 'Abrir caja' });
  assert.equal(submit.disabled, true);
  inputs.forEach((input, index) => fireEvent.change(input, { target: { value: index === 8 ? '4' : '0' } }));
  assert.equal(submit.disabled, false);
  fireEvent.submit(form);
  await waitFor(() => assert.ok(calls.some(call => call.path.endsWith('/api/economics/cash/open'))));
  const post = calls.find(call => call.path.endsWith('/api/economics/cash/open'));
  const body = JSON.parse(post.options.body);
  assert.equal(body.registerCode, 'sala');
  assert.equal(Object.keys(body.openingDenominations).length, 15);
  assert.equal(body.openingDenominations.bill_5, 4);
});

test('cerrar caja es a ciegas: sin importe esperado y con el mensaje del servidor si falla', async () => {
  const regs = registers({ bunker: { available: false, ownCustody: true, sessionId: 'sess-1' } });
  const calls = serve({ regs, onPost: () => response({ error: 'cash_outflow_approval_pending' }, 409) });
  render(React.createElement(CajaPage));
  fireEvent.click(await screen.findByRole('button', { name: 'Cerrar caja' }));
  const form = await screen.findByRole('form', { name: 'Cerrar Búnker' });
  assert.match(form.textContent, /a ciegas/);
  assert.equal(/Esperado|Diferencia/.test(form.textContent), false);
  within(form).getAllByRole('textbox').forEach(input => fireEvent.change(input, { target: { value: '0' } }));
  fireEvent.submit(form);
  await screen.findByText(/pendiente de aprobación del propietario/);
  assert.ok(calls.some(call => call.path.endsWith('/api/economics/cash/sess-1/close')));
});

test('Caja aparece en el menú solo con el permiso de caja del perfil', () => {
  const flat = capabilities => getProfessionalNavigation(capabilities, 'home').flatMap(section => section.children ?? [section.route]).map(route => route.id);
  assert.ok(flat({ calendar: true, clients: true, communications: true, billing: false, staff: true, cash: true }).includes('caja'));
  assert.equal(flat({ calendar: true, clients: true, communications: true, billing: true, staff: true, cash: false }).includes('caja'), false);
  assert.equal(flat(null).includes('caja'), false);
});
