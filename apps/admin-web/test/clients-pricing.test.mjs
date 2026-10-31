import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#clients' });
dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(callback, 0);
dom.window.cancelAnimationFrame = (handle) => dom.window.clearTimeout(handle);
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { ClientsPage } = await import('../src/clients-page.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; window.location.hash = '#clients'; });
after(() => dom.window.close());

const client = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', firstName: 'Lucía', lastName: 'Díaz', status: 'active', createdAt: '2026-10-01T10:00:00Z' };
const sections = ['summary', 'reservations', 'plans', 'payments', 'documents', 'messages', 'followup', 'history'].map((id) => ({ id, label: id, sourceLabel: id, access: 'available', dataState: 'ready' }));
const slot = (data = null) => ({ access: 'available', dataState: 'ready', data });
const profileOf = (plans = [], capabilities = { manage: true, assignPlans: true, manageCatalogPrice: true, collectPayments: false }) => ({
  client, capabilities, sections, reservations: [], waitlistEntries: [], history: [],
  summary: { profile: slot(), plans: slot(plans), reservations: slot(), payments: slot({ balanceCents: 0, overdueCount: 0, charges: [], movements: [] }), documents: slot(), messages: slot({ unreadCount: 0 }), followup: slot() },
});
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const clickClientAction = async (name) => fireEvent.click(await screen.findByRole('button', { name }));
const localDateKey = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Atlantic/Canary', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
  const part = (type) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};
const nextMonthStart = () => {
  const [year, month] = localDateKey().split('-').map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
};

/** The real API serialises the PostgreSQL bigint basePriceCents as a STRING ("5000"). Tests use that shape on purpose. */
const plan3Days = (basePriceCents) => ({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: '3 días', kind: 'recurring', renewalCadence: 'monthly', periodDays: null, basePriceCents, services: [{ id: 's1', name: 'Fuerza funcional', area: 'Sala' }], rights: [{ rightType: 'service_access', serviceName: 'Fuerza funcional', quantity: null, period: null, quotaScope: null }] });

const openSale = async ({ basePriceCents, capabilities, onPost, assignablePlan=plan3Days(basePriceCents) }) => {
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes('/api/clients?')) return response({ items: [client], capabilities: { manage: true, assignPlans: true }, hasMore: false, nextCursor: null });
    if (path.endsWith(`/api/clients/${client.id}`)) return response(profileOf([], capabilities));
    if (path.endsWith('/api/plans/assignable')) return response([assignablePlan]);
    if (path.endsWith(`/api/clients/${client.id}/plans`) && options.method === 'POST') { onPost?.(JSON.parse(options.body)); return response({ id: 'new' }, 201); }
    throw new Error(`Unexpected ${options.method ?? 'GET'} ${path}`);
  };
  render(React.createElement(ClientsPage));
  fireEvent.click(await screen.findByRole('link', { name: /Lucía Díaz/ }));
  await screen.findByRole('heading', { level: 1, name: 'Lucía Díaz' });
  await clickClientAction('Añadir cuota');
  const dialog = await screen.findByRole('dialog', { name: 'Añadir cuota' });
  await waitFor(() => assert.ok(dialog.querySelector('select')));
  fireEvent.change(within(dialog).getByLabelText('Producto o plan'), { target: { value: plan3Days().id } });
  return dialog;
};

for (const [label, base] of [['string "5000" (real API shape)', '5000'], ['number 5000', 5000]]) {
  test(`unchanged price (${label}) shows no adjustment field and saves without a reason`, async () => {
    let payload;
    const dialog = await openSale({ basePriceCents: base, capabilities: { manage: true, assignPlans: true, manageCatalogPrice: true }, onPost: (body) => { payload = body; } });
    const price = within(dialog).getByLabelText('Precio de venta (€)');
    assert.equal(price.value, '50.00');
    assert.ok(within(dialog).queryByLabelText('Motivo del ajuste de precio') === null, 'no adjustment field when sale price equals the catalogue price');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Asignar y dejar pendiente' }));
    await screen.findByText('Cuota asignada; el cargo queda pendiente.');
    assert.equal(payload.amountCents, 5000);
    assert.equal(payload.adjustmentReason, null);
  });
}

test('a changed price (50 € catalogue, 45 € sale) shows a required adjustment reason and sends it', async () => {
  let payload;
  const dialog = await openSale({ basePriceCents: '5000', capabilities: { manage: true, assignPlans: true, manageCatalogPrice: true }, onPost: (body) => { payload = body; } });
  fireEvent.change(within(dialog).getByLabelText('Precio de venta (€)'), { target: { value: '45.00' } });
  const reason = within(dialog).getByLabelText('Motivo del ajuste de precio');
  assert.equal(reason.required, true);
  fireEvent.change(reason, { target: { value: 'Promoción de octubre' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Asignar y dejar pendiente' }));
  await screen.findByText('Cuota asignada; el cargo queda pendiente.');
  assert.equal(payload.amountCents, 4500);
  assert.equal(payload.adjustmentReason, 'Promoción de octubre');
});

test('returning the price to the catalogue value removes the adjustment field again (integer cents, no float drift)', async () => {
  const dialog = await openSale({ basePriceCents: '5000', capabilities: { manage: true, assignPlans: true, manageCatalogPrice: true } });
  const price = within(dialog).getByLabelText('Precio de venta (€)');
  fireEvent.change(price, { target: { value: '49,99' } });
  assert.ok(within(dialog).queryByLabelText('Motivo del ajuste de precio') !== null);
  fireEvent.change(price, { target: { value: '50,00' } });
  assert.ok(within(dialog).queryByLabelText('Motivo del ajuste de precio') === null);
});

test('without price permission the catalogue price is read-only and never asks for a reason', async () => {
  const dialog = await openSale({ basePriceCents: '5000', capabilities: { manage: false, assignPlans: true, manageCatalogPrice: false } });
  const price = within(dialog).getByLabelText('Precio de venta (€)');
  assert.equal(price.readOnly, true);
  assert.ok(within(dialog).queryByLabelText('Motivo del ajuste de precio') === null);
});

test('monthly assignment auto-fills the natural month end, day-10 due date, and catalogue price', async () => {
  const dialog = await openSale({ basePriceCents:'5000', capabilities:{ manage:true, assignPlans:true, manageCatalogPrice:true, adjustEntitlements:true } });
  const startsOn = `${nextMonthStart().slice(0, 7)}-12`;
  fireEvent.change(within(dialog).getByLabelText('Inicio'), { target:{ value:startsOn } });
  assert.equal(within(dialog).getByLabelText('Fin (opcional)').value, `${startsOn.slice(0, 7)}-${new Date(Date.UTC(Number(startsOn.slice(0,4)), Number(startsOn.slice(5,7)), 0)).getUTCDate()}`);
  assert.equal(within(dialog).getByLabelText('Vencimiento del cargo').value, `${startsOn.slice(0, 7)}-10`);
  assert.equal(within(dialog).getByLabelText('Precio de venta (€)').value, '50.00');
  assert.equal(within(dialog).getByLabelText('Fin (opcional)').readOnly, false);
  assert.equal(within(dialog).getByLabelText('Vencimiento del cargo').readOnly, false);
});

test('assignment end and due date are read-only without entitlement adjustment permission', async () => {
  const dialog = await openSale({ basePriceCents:'5000', capabilities:{ manage:true, assignPlans:true, manageCatalogPrice:true, adjustEntitlements:false } });
  assert.equal(within(dialog).getByLabelText('Fin (opcional)').readOnly, true);
  assert.equal(within(dialog).getByLabelText('Vencimiento del cargo').readOnly, true);
});

test('contract range defaults show the configured period end and assignment-based due date', async () => {
  const plan={...plan3Days('5000'),termKind:'custom_range',maxSpanDays:20,assignedLocalDate:'2026-10-15',graceDays:5};
  const dialog=await openSale({basePriceCents:'5000',capabilities:{manage:true,assignPlans:true,manageCatalogPrice:true,adjustEntitlements:false},assignablePlan:plan});
  fireEvent.change(within(dialog).getByLabelText('Inicio'),{target:{value:'2026-10-15'}});
  assert.equal(within(dialog).getByLabelText('Fin del periodo').value,'2026-11-03');
  assert.equal(within(dialog).getByLabelText('Fin del periodo').readOnly,true);
  assert.equal(within(dialog).getByLabelText('Vencimiento del cargo').value,'2026-10-20');
  assert.equal(within(dialog).getByLabelText('Vencimiento del cargo').readOnly,true);
});

test('monthly automatic renewal control loads, enables and disables the audited permission-gated state', async () => {
  const capabilities={manage:true,assignPlans:true,manageCatalogPrice:true,renewEntitlements:true};
  const assignment={id:'ffffffff-ffff-4fff-8fff-ffffffffffff',planId:plan3Days().id,planName:'Mensual',kind:'recurring',renewalCadence:'monthly',termKind:'natural_month',startsOn:'2026-11-01',endsOn:'2026-11-30',derivedStatus:'scheduled',rights:[]};
  const submitted=[];
  globalThis.fetch=async(url,options={})=>{
    const path=String(url);
    if(path.includes('/api/clients?'))return response({items:[client],capabilities:{manage:true,assignPlans:true},hasMore:false,nextCursor:null});
    if(path.endsWith(`/api/clients/${client.id}`))return response(profileOf([assignment],capabilities));
    if(path.endsWith(`/api/clients/${client.id}/plans/${assignment.id}/auto-renewal`)&&options.method==='PATCH'){submitted.push(JSON.parse(options.body));return response({id:'renewal-event',replay:false},201);}
    if(path.endsWith(`/api/clients/${client.id}/plans/${assignment.id}/auto-renewal`))return response({enabled:false,effectiveOn:null});
    throw new Error(`Unexpected ${options.method??'GET'} ${path}`);
  };
  render(React.createElement(ClientsPage));
  fireEvent.click(await screen.findByRole('link',{name:/Lucía Díaz/}));
  fireEvent.click(await screen.findByRole('tab',{name:'Plan y sesiones'}));
  const enable=await screen.findByRole('button',{name:'Activar renovación automática'});
  fireEvent.click(enable);
  fireEvent.click(await screen.findByRole('button',{name:'Desactivar renovación automática'}));
  await screen.findByRole('button',{name:'Activar renovación automática'});
  assert.deepEqual(submitted,[{enabled:true,reason:'Activación desde la ficha del cliente'},{enabled:false,reason:'Desactivación desde la ficha del cliente'}]);
});

test('legacy recurring plans explain that their stored historical terms remain unchanged', async () => {
  const dialog = await openSale({ basePriceCents: '5000', capabilities: { manage: true, assignPlans: true, manageCatalogPrice: true } });
  assert.match(within(dialog).getByTestId('legacy-duration-note').textContent, /condiciones históricas/);
});

test('sessions are shown only from a real quota balance: balance=null shows nothing invented', async () => {
  const noBalance = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', planId: 'p', planName: 'Bono 13', kind: 'session_pack', startsOn: '2026-10-01', endsOn: null, derivedStatus: 'active', rights: [{ id: 'r1', rightType: 'sessions_quota', serviceName: 'Fuerza', quantity: 13, period: null, quotaScope: 'per_service', balance: null }] };
  const accessOnly = { ...noBalance, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', planName: '3 días', kind: 'recurring', rights: [{ id: 'r2', rightType: 'service_access', serviceName: 'Fuerza funcional', quantity: null, period: null, quotaScope: null, balance: 0 }] };
  for (const plans of [[noBalance], [accessOnly]]) {
    globalThis.fetch = async (url) => String(url).includes('/api/clients?') ? response({ items: [client], capabilities: { manage: true }, hasMore: false, nextCursor: null }) : response(profileOf(plans));
    render(React.createElement(ClientsPage));
    fireEvent.click(await screen.findByRole('link', { name: /Lucía Díaz/ }));
    await screen.findByRole('heading', { level: 1, name: 'Lucía Díaz' });
    assert.ok(screen.queryByText('Sesiones disponibles') === null, 'no available-sessions fact without a balance');
    assert.ok(screen.queryByText(/sesiones disponibles/i) === null);
    fireEvent.click(screen.getByRole('tab', { name: 'Plan y sesiones' }));
    await screen.findByRole('heading', { name: plans[0].planName });
    assert.doesNotMatch(document.body.textContent, /restantes/, 'no remaining count is derived');
    cleanup(); window.location.hash = '#clients';
  }
});

test('a real quota balance is shown as the available sessions fact', async () => {
  const withBalance = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', planId: 'p', planName: 'Bono 12', kind: 'session_pack', startsOn: '2026-10-01', endsOn: null, derivedStatus: 'active', rights: [{ id: 'r1', rightType: 'sessions_quota', serviceName: 'Fuerza', quantity: 12, period: null, quotaScope: 'per_service', balance: 9 }] };
  globalThis.fetch = async (url) => String(url).includes('/api/clients?') ? response({ items: [client], capabilities: { manage: true }, hasMore: false, nextCursor: null }) : response(profileOf([withBalance]));
  render(React.createElement(ClientsPage));
  fireEvent.click(await screen.findByRole('link', { name: /Lucía Díaz/ }));
  await screen.findByRole('heading', { level: 1, name: 'Lucía Díaz' });
  const facts = screen.getByRole('list', { name: 'Resumen del cliente' });
  assert.ok(within(facts).getByText('Sesiones disponibles'));
  assert.ok(within(facts).getByText('9'));
});
