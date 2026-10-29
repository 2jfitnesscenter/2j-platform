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
function mockFetch({ onPayment = () => response({ id: 'txn' }, 201), onCharge = () => response({ id: 'charge' }, 201), onCash = () => response({ id: 'cash' }, 201), cashSession = null, ownerPanelRead = false } = {}) {
  const pageOverview = { ...overview, capabilities: { ...overview.capabilities, ownerPanelRead } };
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.endsWith('/api/economics/overview')) return response(pageOverview);
    if (path.endsWith('/api/economics/charges') && options.method === 'POST') return onCharge(url, options);
    if (path.includes('/api/economics/charges')) return response({ items: [charge], total: 1 });
    if (path.endsWith('/api/economics/cash/today')) return response({ items: cashSession ? [{ ...cashSession, registerId: 'register-bunker', registerCode: 'bunker', registerName: 'Búnker', ownCustody: true, movements: [] }] : [], session: cashSession });
    if (path.endsWith('/api/economics/cash/registers')) return response({ items: [{ id: 'register-bunker', code: 'bunker', name: 'Búnker', available: !cashSession || cashSession.status !== 'open', ownCustody: cashSession?.status === 'open', sessionId: cashSession?.status === 'open' ? cashSession.id : null }, { id: 'register-sala', code: 'sala', name: 'Sala', available: true, ownCustody: false, sessionId: null }] });
    if (path.endsWith('/api/economics/cash/handover-recipients')) return response({ items: [{ id: 'professional-b', displayName: 'Eva Recepción' }] });
    if (path.endsWith('/api/economics/cash/handovers/pending')) return response({ items: [] });
    if (path.endsWith('/api/economics/cash/day')) {
      const register = cashSession ? { id: cashSession.id, registerId: 'register-bunker', registerCode: 'bunker', registerName: 'Búnker', localDate: cashSession.localDate, status: cashSession.status, openingCents: cashSession.openingCents ?? 1000, openingDenominations: null, expectedCents: cashSession.expectedCents ?? 1000, countedCents: cashSession.countedCents ?? null, countedDenominations: null, differenceCents: cashSession.differenceCents ?? null, balanced: cashSession.differenceCents == null ? null : cashSession.differenceCents === 0, movements: [], handovers: [] } : null;
      return response({ date: '2026-10-27', registers: register ? [register] : [], total: { expectedCents: register?.expectedCents ?? 0, countedCents: register?.countedCents ?? 0, differenceCents: register?.differenceCents ?? 0, balanced: register?.balanced ?? true } });
    }
    if (path.endsWith('/api/economics/cash/settings/outflow-limit')) return response({ limitCents: null });
    if (path.endsWith('/api/economics/cash/open') || path.includes('/api/economics/cash/cash-1/close') || path.includes('/api/economics/cash/cash-1/handover')) return onCash(url, options);
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

test('shows the cash difference only when the server grants owner.panel.read', async () => {
  const cashSession = { id: 'cash-1', localDate: '2026-10-25', status: 'closed', openingCents: 1000, cashPaymentsCents: 0, cashStoreSalesCents: 0, cashRefundsCents: 0, adjustmentsCents: 0, expectedCents: 1000, countedCents: 1200, differenceCents: 200 };
  mockFetch({ cashSession });
  const staffView = render(React.createElement(EconomicsPage));
  await screen.findByRole('heading', { name: 'Pagos y caja' });
  assert.equal(screen.queryByText('Diferencia total'), null);
  staffView.unmount();

  mockFetch({ cashSession, ownerPanelRead: true });
  render(React.createElement(EconomicsPage));
  assert.ok(await screen.findByText('Diferencia total'));
  assert.ok((await screen.findAllByText(/12,00/)).length >= 1);
});

test('cash open and close submit denomination counts and keep the expected amount hidden from non-owners', async () => {
  const cashSession={id:'cash-1',localDate:'2026-10-25',status:'open',countedCents:null,openedAt:'2026-10-25T10:00:00Z',closedAt:null};
  let payload;
  mockFetch({cashSession,onCash:(_url,options)=>{payload=JSON.parse(options.body);return response({id:'cash-1',status:'closed'},200);}});
  render(React.createElement(EconomicsPage));
  const closeButton=await screen.findByRole('button',{name:'Cerrar caja'});
  fireEvent.click(closeButton);
  const dialog=await screen.findByRole('dialog',{name:'Cerrar caja'});
  assert.ok(within(dialog).getByText(/recuento es ciego/i));
  assert.equal(within(dialog).queryByText(/esperado\s+\d+(?:[,.]\d{2})?\s*€/i),null);
  const denominationInputs=[...dialog.querySelectorAll('input[type="number"]')];assert.equal(denominationInputs.length,15);
  for(const input of denominationInputs)fireEvent.change(input,{target:{value:'0'}});
  fireEvent.change(denominationInputs[9],{target:{value:'1'}});
  fireEvent.change(within(dialog).getByRole('spinbutton',{name:'Billetes de 10 €'}),{target:{value:'1'}});
  fireEvent.click(within(dialog).getByRole('checkbox',{name:/Confirmo el recuento físico por denominación/i}));
  fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar cierre'}));
  await waitFor(()=>assert.deepEqual(payload,{countedDenominations:{coin_0_01:0,coin_0_02:0,coin_0_05:0,coin_0_10:0,coin_0_20:0,coin_0_50:0,coin_1:0,coin_2:0,bill_5:0,bill_10:1,bill_20:0,bill_50:0,bill_100:0,bill_200:0,bill_500:0}}));
});

test('cash handover is confirmed by an independent blind count', async () => {
  const cashSession={id:'cash-1',registerId:'register-bunker',registerCode:'bunker',registerName:'Búnker',localDate:'2026-10-27',status:'open',openedAt:'2026-10-27T10:00:00Z',closedAt:null};
  let request;
  mockFetch({cashSession,onCash:(url,options)=>{request={url:String(url),payload:JSON.parse(options.body)};return response({id:'handover-1',status:'awaiting_incoming_confirmation'},201);}});
  render(React.createElement(EconomicsPage));
  fireEvent.click(await screen.findByRole('button',{name:'Entregar caja'}));
  const dialog=await screen.findByRole('dialog',{name:'Entregar caja'});
  assert.ok(within(dialog).getByText(/hará su propio recuento/i));
  assert.equal(within(dialog).queryByText(/recuento esperado/i),null);
  fireEvent.change(within(dialog).getByRole('combobox',{name:'Recibe la caja'}),{target:{value:'professional-b'}});
  for(const label of ['Monedas de 1 céntimo','Monedas de 2 céntimos','Monedas de 5 céntimos','Monedas de 10 céntimos','Monedas de 20 céntimos','Monedas de 50 céntimos','Monedas de 1 €','Monedas de 2 €','Billetes de 5 €','Billetes de 10 €','Billetes de 20 €','Billetes de 50 €','Billetes de 100 €','Billetes de 200 €','Billetes de 500 €'])fireEvent.change(within(dialog).getByRole('spinbutton',{name:label}),{target:{value:'0'}});
  fireEvent.click(within(dialog).getByRole('checkbox',{name:/recuento físico de salida/i}));
  fireEvent.click(within(dialog).getByRole('button',{name:'Entregar para recuento'}));
  await waitFor(()=>assert.equal(request?.url.endsWith('/api/economics/cash/cash-1/handover'),true));
  assert.equal(request.payload.incomingProfessionalId,'professional-b');
  assert.equal(request.payload.outgoingDenominations.bill_5,0);
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
