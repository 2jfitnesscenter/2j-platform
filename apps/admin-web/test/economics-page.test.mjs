import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5173' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { EconomicsPage } = await import('../src/economics-page.tsx');
const client = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', firstName: 'Ada', lastName: 'Lovelace' };
const charge = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', clientId: client.id, firstName: client.firstName, lastName: client.lastName, concept: 'Cuota mensual', amountCents: 10000, paidCents: 2500, balanceCents: 7500, dueOn: '2099-12-10', status: 'pending' };
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const overview = { overdueCount: 0, overdueCents: 0, chargeCount: 1, cashSession: null, capabilities: { payments: true, cash: true, invoices: true } };
function mockFetch({ onPayment = () => response({ id: 'txn' }, 201), onCharge = () => response({ id: 'charge' }, 201) } = {}) {
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.endsWith('/api/economics/overview')) return response(overview);
    if (path.endsWith('/api/economics/charges') && options.method === 'POST') return onCharge(url, options);
    if (path.includes('/api/economics/charges')) return response({ items: [charge], total: 1 });
    if (path.endsWith('/api/economics/cash/today')) return response({ session: null });
    if (path.startsWith('http://127.0.0.1:3100/api/clients?')) return response({ items: [client] });
    if (path.endsWith('/api/economics/payments')) return onPayment(url, options);
    throw new Error(`Unexpected request ${options.method ?? 'GET'} ${path}`);
  };
}

afterEach(() => { cleanup(); globalThis.fetch = undefined; });
after(() => dom.window.close());

test('renders cash, overdue and client charge summaries without horizontal table use on mobile', async () => {
  mockFetch(); render(React.createElement(EconomicsPage));
  await screen.findByRole('heading', { name: 'Pagos y caja' });
  assert.ok((await screen.findAllByText('Ada Lovelace')).length >= 1);
  assert.ok(screen.getByRole('button', { name: 'Abrir caja' }));
  assert.equal(screen.getAllByText('Cuota mensual').length, 2, 'table and mobile card stay available for responsive CSS');
  assert.ok(screen.getAllByText(/75,00\s*€/).length >= 1);
});

test('creates a charge with integer cents and records a partial payment idempotently', async () => {
  let createdCharge;
  let paymentRequest;
  mockFetch({
    onCharge: (_url, options) => { createdCharge = JSON.parse(options.body); assert.match(options.headers['idempotency-key'], /^[0-9a-f-]{36}$/i); return response({ id: 'new-charge' }, 201); },
    onPayment: (_url, options) => { paymentRequest = { body: JSON.parse(options.body), key: options.headers['idempotency-key'] }; return response({ id: 'txn-new' }, 201); },
  });
  render(React.createElement(EconomicsPage));
  const newCharge = await screen.findByRole('button', { name: 'Nuevo cargo' });
  fireEvent.click(newCharge);
  const chargeDialog = await screen.findByRole('dialog', { name: 'Nuevo cargo' });
  fireEvent.change(within(chargeDialog).getByRole('combobox', { name: 'Buscar cliente' }), { target: { value: 'Ada' } });
  fireEvent.click(await within(chargeDialog).findByRole('option', { name: 'Ada Lovelace' }));
  fireEvent.change(within(chargeDialog).getByLabelText('Concepto'), { target: { value: 'Alta de prueba' } });
  fireEvent.change(within(chargeDialog).getByLabelText('Importe (€)'), { target: { value: '42.35' } });
  fireEvent.click(within(chargeDialog).getByRole('button', { name: 'Registrar cargo' }));
  await waitFor(() => assert.equal(createdCharge?.amountCents, 4235));
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));

  const record = (await screen.findAllByRole('button', { name: 'Registrar pago' }))[0];
  fireEvent.click(record);
  const paymentDialog = await screen.findByRole('dialog', { name: 'Registrar pago' });
  fireEvent.change(within(paymentDialog).getByLabelText('Importe (€)'), { target: { value: '20.00' } });
  fireEvent.change(within(paymentDialog).getByLabelText('Método'), { target: { value: 'cash' } });
  fireEvent.click(within(paymentDialog).getByRole('button', { name: 'Añadir método' }));
  const methods = within(paymentDialog).getAllByLabelText('Método');
  fireEvent.change(methods[1], { target: { value: 'card' } });
  const amounts = within(paymentDialog).getAllByLabelText('Importe (€)');
  fireEvent.change(amounts[1], { target: { value: '22.35' } });
  fireEvent.click(within(paymentDialog).getByRole('button', { name: 'Confirmar pago' }));
  await waitFor(() => assert.equal(paymentRequest?.body.splits[0].amountCents, 2000));
  assert.equal(paymentRequest?.body.splits[0].method, 'cash');
  assert.deepEqual(paymentRequest?.body.splits, [{ method:'cash',amountCents:2000 },{ method:'card',amountCents:2235 }]);
  assert.match(paymentRequest?.key ?? '', /^[0-9a-f-]{36}$/i);
  assert.ok(await screen.findByRole('status'));
});
