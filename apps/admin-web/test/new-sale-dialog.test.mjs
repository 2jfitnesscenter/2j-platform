import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#clients', pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { NewSaleDialog } = await import('../src/new-sale-dialog.tsx');
const { RegisterPaymentDialog, firstPendingCharge } = await import('../src/client-actions.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; dom.window.localStorage.clear(); });
after(() => dom.window.close());

const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLAN = { id: '11111111-1111-4111-8111-111111111111', name: 'Mensual ilimitada', basePriceCents: 5900 };
const PLAN_NO_PRICE = { id: '22222222-2222-4222-8222-222222222222', name: 'Cuota sin precio', basePriceCents: null };
const TEE = { id: '33333333-3333-4333-8333-333333333333', label: 'Talla M', priceCents: 1800, active: true, stockTracked: true, stock: 5 };
const SOLD_OUT = { id: '44444444-4444-4444-8444-444444444444', label: 'Talla S', priceCents: 1800, active: true, stockTracked: true, stock: 0 };
const PROTEIN = { id: '55555555-5555-4555-8555-555555555555', label: 'Chocolate · 900 g', priceCents: 3290, active: true, stockTracked: true, stock: 12 };
const STORE = { products: [{ id: 'p-tee', name: 'Camiseta 2J', category: 'merchandising', active: true, variants: [TEE, SOLD_OUT] }, { id: 'p-pro', name: 'Proteína 2J', category: 'nutrition', active: true, variants: [PROTEIN] }] };
const adminCapabilities = { assignPlans: true, collectPayments: true, manageCatalogPrice: true };

/** Servidor simulado: registra cada petición y deja a cada test decidir las respuestas de escritura. */
function serve({ plans = [PLAN, PLAN_NO_PRICE], store = STORE, shift = { open: true }, onPlan, onSale, onInvoice, onPayment } = {}) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(String(url)).pathname; const method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method, body, key: options.headers?.['idempotency-key'] });
    if (path === '/api/plans/assignable') return response(plans);
    if (path === '/api/admin/store') return store ? response(store) : response({}, 403);
    if (path === '/api/economics/invoice-settings') return response({ defaultIgicBasisPoints: 300 });
    if (path === '/api/timeclock/self') return shift ? response({ openShift: shift.open ? { id: 's' } : null }) : response({}, 404);
    if (path === '/api/timeclock/clock-in') { shift.open = true; return response({ id: 'e' }, 201); }
    if (path === `/api/clients/${CLIENT}/plans` && method === 'POST') return (onPlan ?? (() => response({ id: 'asg-1', chargeId: 'charge-1', paymentId: 'pay-1' }, 201)))(body, calls);
    if (path === '/api/admin/store/sales' && method === 'POST') return (onSale ?? (() => response({ id: 'sale-1' }, 201)))(body, calls);
    if (/^\/api\/economics\/charges\/[^/]+\/invoice$/.test(path)) return (onInvoice ?? (() => response({ id: 'doc-1' }, 201)))(body, calls);
    if (path === '/api/economics/payments') return (onPayment ?? (() => response({ id: 'txn' }, 201)))(body, calls);
    throw new Error(`Unexpected request ${method} ${path}`);
  };
  return calls;
}
const open = async (capabilities = adminCapabilities, props = {}) => {
  render(React.createElement(NewSaleDialog, { clientId: CLIENT, clientName: 'Marta Santos', capabilities, onClose: () => {}, onDone: () => {}, ...props }));
  return screen.findByRole('dialog', { name: 'Nueva venta' });
};
const writes = (calls) => calls.filter((call) => call.method === 'POST');

test('a typical plan sale takes three clicks after opening: pick the plan, Cobrar, confirm; it charges the plan price and issues a ticket by default', async () => {
  const calls = serve(); let refreshed = 0;
  const dialog = await open(adminCapabilities, { onDone: () => { refreshed += 1; } });
  fireEvent.click(await within(dialog).findByRole('button', { name: /Mensual ilimitada/ }));        // 1. elegir
  fireEvent.click(within(dialog).getByRole('button', { name: /^Cobrar/ }));                           // 2. Cobrar
  assert.ok(within(dialog).getByText(/3 % de IGIC incluido/), 'the configured IGIC is shown, not invented');
  fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar cobro de/ }));               // 3. confirmar
  await within(dialog).findByText('Venta registrada');
  const [plan] = writes(calls).filter((call) => call.path.endsWith('/plans'));
  assert.equal(plan.body.planId, PLAN.id); assert.equal(plan.body.amountCents, 5900);
  assert.equal(plan.body.paymentAmountCents, 5900); assert.equal(plan.body.paymentMethod, 'cash');
  assert.equal(plan.body.adjustmentReason, null, 'the plan price needs no reason');
  assert.match(plan.key, /^[0-9a-f-]{36}$/);
  const [invoice] = writes(calls).filter((call) => call.path.includes('/invoice'));
  assert.equal(invoice.path, '/api/economics/charges/charge-1/invoice'); assert.equal(invoice.body.documentType, 'simplified_ticket', 'ticket by default (A64)');
  assert.match(dialog.textContent, /Documento emitido \(ticket\)/);
  assert.equal(refreshed, 0, 'the profile is not reloaded under the result screen');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
  assert.equal(refreshed, 1, 'closing after a registered sale reloads the profile (Compras, Pagos, stock)');
});

test('the method (Efectivo, Bizum, Transferencia), the invoice checkbox and "pendiente de pago" change what is sent', async () => {
  let calls = serve();
  let dialog = await open();
  fireEvent.click(await within(dialog).findByRole('button', { name: /Mensual ilimitada/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /^Cobrar/ }));
  assert.deepEqual([...within(dialog).getByLabelText('Método').options].map((option) => option.textContent), ['Efectivo', 'Bizum', 'Transferencia']);
  fireEvent.change(within(dialog).getByLabelText('Método'), { target: { value: 'transfer' } });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /Emitir factura/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar cobro de/ }));
  await within(dialog).findByText('Venta registrada');
  assert.equal(writes(calls).find((call) => call.path.endsWith('/plans')).body.paymentMethod, 'transfer');
  assert.equal(writes(calls).find((call) => call.path.includes('/invoice')).body.documentType, 'full_invoice');
  cleanup();

  calls = serve();
  dialog = await open();
  fireEvent.click(await within(dialog).findByRole('button', { name: /Mensual ilimitada/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /^Cobrar/ }));
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /Dejar pendiente de pago/ }));
  assert.equal(within(dialog).queryByLabelText('Método'), null, 'no method when nothing is collected');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Registrar venta pendiente' }));
  await within(dialog).findByText('Venta registrada');
  const sale = writes(calls).find((call) => call.path.endsWith('/plans'));
  assert.equal(sale.body.paymentAmountCents, null); assert.equal(sale.body.paymentMethod, null);
  assert.equal(writes(calls).filter((call) => call.path.includes('/invoice')).length, 0, 'nothing is invoiced until it is paid');
  assert.match(dialog.textContent, /Queda pendiente de pago/);
});

test('products come with variants and stock: sold-out variants cannot be added, quantity never exceeds stock, and the sale decrements stock through the store endpoint', async () => {
  const calls = serve();
  const dialog = await open();
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Productos' }));
  const soldOut = await within(dialog).findByRole('button', { name: /Talla S/ });
  assert.equal(soldOut.disabled, true); assert.match(soldOut.textContent, /Agotado/);
  assert.ok(within(dialog).getByText(/Talla M · 5 en stock/));
  fireEvent.click(within(dialog).getByRole('button', { name: /Talla M/ }));
  fireEvent.change(within(dialog).getByLabelText('Cantidad de Camiseta 2J · Talla M'), { target: { value: '99' } });
  assert.equal(within(dialog).getByLabelText('Cantidad de Camiseta 2J · Talla M').value, '5', 'capped at the stock on hand');
  fireEvent.change(within(dialog).getByLabelText('Cantidad de Camiseta 2J · Talla M'), { target: { value: '2' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /Chocolate/ }));
  assert.match(within(dialog).getByText(/^Total/).textContent, /68,90\s*€/, '2 × 18,00 + 32,90');
  fireEvent.click(within(dialog).getByRole('button', { name: /^Cobrar/ }));
  fireEvent.change(within(dialog).getByLabelText('Método'), { target: { value: 'other' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar cobro de/ }));
  await within(dialog).findByText('Venta registrada');
  const sale = writes(calls).find((call) => call.path === '/api/admin/store/sales');
  assert.deepEqual(sale.body, { clientId: CLIENT, lines: [{ variantId: TEE.id, quantity: 2 }, { variantId: PROTEIN.id, quantity: 1 }], paymentState: 'paid', paymentMethod: 'other', note: '' });
  assert.equal(writes(calls).filter((call) => call.path.includes('/invoice')).length, 0, 'product sales have no charge to invoice');
});

test('recents come first, and the search filters both catalogues', async () => {
  window.localStorage.setItem('2j-new-sale-recents', JSON.stringify([PLAN_NO_PRICE.id]));
  serve({ plans: [PLAN, PLAN_NO_PRICE] });
  const dialog = await open({ ...adminCapabilities, manageCatalogPrice: true });
  const list = await within(dialog).findByRole('list', { name: 'Cuotas disponibles' });
  assert.deepEqual([...list.querySelectorAll('button span')].map((span) => span.textContent), ['Cuota sin precio', 'Mensual ilimitada'], 'the recent plan leads');
  fireEvent.change(within(dialog).getByLabelText('Buscar'), { target: { value: 'ilimit' } });
  assert.deepEqual([...list.querySelectorAll('button span')].map((span) => span.textContent), ['Mensual ilimitada']);
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Productos' }));
  fireEvent.change(within(dialog).getByLabelText('Buscar'), { target: { value: 'prote' } });
  assert.ok(await within(dialog).findByRole('button', { name: /Chocolate/ })); assert.equal(within(dialog).queryByRole('button', { name: /Talla M/ }), null);
});

test('a price change needs a reason (D257) and is only allowed with the catalogue-price permission; without it the price is read-only', async () => {
  const calls = serve();
  let dialog = await open();
  fireEvent.click(await within(dialog).findByRole('button', { name: /Mensual ilimitada/ }));
  fireEvent.change(within(dialog).getByLabelText('Precio de Mensual ilimitada'), { target: { value: '50' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /^Cobrar/ }));
  assert.match((await within(dialog).findByRole('alert')).textContent, /Explica el descuento/);
  fireEvent.change(within(dialog).getByLabelText('Motivo del descuento de Mensual ilimitada'), { target: { value: 'Amigo de la casa' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /^Cobrar/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar cobro de/ }));
  await within(dialog).findByText('Venta registrada');
  const plan = writes(calls).find((call) => call.path.endsWith('/plans'));
  assert.equal(plan.body.amountCents, 5000); assert.equal(plan.body.adjustmentReason, 'Amigo de la casa');
  cleanup();

  serve();
  dialog = await open({ assignPlans: true, collectPayments: true });
  fireEvent.click(await within(dialog).findByRole('button', { name: /Mensual ilimitada/ }));
  assert.equal(within(dialog).getByLabelText('Precio de Mensual ilimitada').disabled, true);
  fireEvent.click(within(dialog).getByRole('button', { name: /Cuota sin precio/ }));
  assert.match((await within(dialog).findByRole('alert')).textContent, /necesita un precio base/);
});

test('permissions decide the catalogue: no plan permission hides Cuotas, no store permission hides products, and a profile that cannot collect must leave it pending', async () => {
  serve({ plans: [] });
  let dialog = await open({ collectPayments: true });
  assert.equal(within(dialog).queryByRole('tab', { name: 'Cuotas' }), null);
  assert.ok(await within(dialog).findByRole('tab', { name: 'Productos' }));
  cleanup();
  serve({ store: null });
  dialog = await open();
  fireEvent.click(await within(dialog).findByRole('tab', { name: 'Productos' }));
  assert.ok(await within(dialog).findByText(/no puede vender productos/));
  cleanup();
  const calls = serve();
  dialog = await open({ assignPlans: true, collectPayments: false });
  fireEvent.click(await within(dialog).findByRole('button', { name: /Mensual ilimitada/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /^Cobrar/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar cobro de/ }));
  assert.match((await within(dialog).findByRole('alert')).textContent, /no puede registrar cobros/);
  assert.equal(writes(calls).length, 0, 'nothing reaches the API');
});

test('D113: without a shift the guided notice appears when collecting, fichar keeps the cart, and the retry reuses the same idempotency key', async () => {
  const shift = { open: false }; let attempts = 0;
  const calls = serve({ shift, onPlan: () => { attempts += 1; return attempts === 1 ? response({ error: 'cash_session_required' }, 409) : response({ id: 'asg-1', chargeId: 'charge-1' }, 201); } });
  const dialog = await open();
  fireEvent.click(await within(dialog).findByRole('button', { name: /Mensual ilimitada/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /^Cobrar/ }));
  assert.ok(await within(dialog).findByText('Para cobrar primero tienes que fichar la entrada'), 'visible before any error');
  fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar cobro de/ }));
  await waitFor(() => assert.equal(attempts, 1));
  assert.equal(within(dialog).queryByText(/No se pudo registrar/), null, 'no generic error');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Fichar entrada ahora' }));
  await waitFor(() => assert.ok(!within(dialog).queryByText('Para cobrar primero tienes que fichar la entrada')));
  assert.ok(within(dialog).getByLabelText('Precio de Mensual ilimitada'), 'the cart is kept');
  fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar cobro de/ }));
  await within(dialog).findByText('Venta registrada');
  const plans = writes(calls).filter((call) => call.path.endsWith('/plans'));
  assert.equal(plans.length, 2); assert.equal(plans[0].key, plans[1].key, 'same key: a retry can never duplicate');
});

test('a partial failure keeps what was registered, says what failed, and the retry only sends what is missing', async () => {
  let stockFails = true;
  const calls = serve({ onSale: () => stockFails ? response({ error: 'insufficient_stock' }, 409) : response({ id: 'sale-1' }, 201) });
  const dialog = await open();
  fireEvent.click(await within(dialog).findByRole('button', { name: /Mensual ilimitada/ }));
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Productos' }));
  fireEvent.click(await within(dialog).findByRole('button', { name: /Talla M/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /^Cobrar/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar cobro de/ }));
  assert.ok(await within(dialog).findByText('No hay stock suficiente de alguno de los productos.'));
  assert.ok(within(dialog).getAllByText(/ · registrado/).length >= 1, 'the plan line shows as registered');
  assert.equal(writes(calls).filter((call) => call.path.endsWith('/plans')).length, 1);
  stockFails = false;
  fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar cobro de/ }));
  await within(dialog).findByText('Venta registrada');
  assert.equal(writes(calls).filter((call) => call.path.endsWith('/plans')).length, 1, 'the plan is not charged twice');
  assert.equal(writes(calls).filter((call) => call.path === '/api/admin/store/sales').length, 2);
});

test('an invoice that cannot be issued never undoes the sale: it is explained and left for Pagos', async () => {
  serve({ onInvoice: () => response({ error: 'issuer_incomplete', missing: ['NIF'] }, 409) });
  const dialog = await open();
  fireEvent.click(await within(dialog).findByRole('button', { name: /Mensual ilimitada/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /^Cobrar/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar cobro de/ }));
  await within(dialog).findByText('Venta registrada');
  assert.match(dialog.textContent, /La venta está registrada\. Falta configurar los datos de facturación \(NIF\)/);
});

test('Registrar pago pre-fills the pending balance, sends one split with the chosen method, and guides the missing shift', async () => {
  const charges = [{ id: 'c-late', concept: 'Cuota mensual', balanceCents: 4900, dueOn: '2026-10-27', status: 'unpaid' }, { id: 'c-paid', concept: 'Pagada', balanceCents: 0, dueOn: '2026-10-01', status: 'paid' }, { id: 'c-next', concept: 'Siguiente', balanceCents: 4900, dueOn: '2026-11-10', status: 'pending' }];
  assert.equal(firstPendingCharge(charges).id, 'c-late', 'the oldest pending charge'); assert.equal(firstPendingCharge([charges[1]]), null);
  const voided = { id: 'c-void', concept: 'Anulada', balanceCents: 3000, dueOn: '2026-01-05', status: 'void' };
  assert.equal(firstPendingCharge([voided, { ...voided, id: 'c-exempt', status: 'exempt' }, { ...voided, id: 'c-refunded', status: 'refunded' }]), null, 'void, exempt and refunded charges carry a balance but cannot be paid');
  assert.equal(firstPendingCharge([voided, ...charges]).id, 'c-late', 'an old void charge never hides the real pending one');
  const shift = { open: false }; let attempts = 0; let done = 0;
  const calls = serve({ shift, onPayment: () => { attempts += 1; return attempts === 1 ? response({ error: 'cash_session_required' }, 409) : response({ id: 'txn' }, 201); } });
  render(React.createElement(RegisterPaymentDialog, { charge: charges[0], onClose: () => {}, onDone: () => { done += 1; } }));
  const dialog = await screen.findByRole('dialog', { name: 'Registrar pago' });
  assert.equal(within(dialog).getByLabelText('Importe (€)').value, '49.00');
  assert.ok(await within(dialog).findByText('Para cobrar primero tienes que fichar la entrada'));
  fireEvent.change(within(dialog).getByLabelText('Método'), { target: { value: 'other' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar pago' }));
  await waitFor(() => assert.equal(attempts, 1));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Fichar entrada ahora' }));
  await waitFor(() => assert.ok(!within(dialog).queryByText('Para cobrar primero tienes que fichar la entrada')));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar pago' }));
  await waitFor(() => assert.equal(done, 1));
  const payments = writes(calls).filter((call) => call.path === '/api/economics/payments');
  assert.deepEqual(payments[1].body, { chargeId: 'c-late', splits: [{ method: 'other', amountCents: 4900 }] });
  assert.equal(payments[0].key, payments[1].key);
  fireEvent.change(within(dialog).getByLabelText('Importe (€)'), { target: { value: '60' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar pago' }));
  assert.match((await within(dialog).findByRole('alert')).textContent, /supera el saldo pendiente/);
});

test('a lost response never lets a changed cart register twice: after the first attempt the cart and terms are locked, the retry reuses the same keys, and closing reloads the profile', async () => {
  const PLAN_B = { id: '66666666-6666-4666-8666-666666666666', name: 'Cuota trimestral', basePriceCents: 14900 };
  let failSecond = true; let refreshed = 0;
  const calls = serve({ plans: [PLAN, PLAN_B], onPlan: (body) => { if (body.planId === PLAN_B.id && failSecond) { failSecond = false; throw new Error('network down'); } return response({ id: 'asg-' + body.planId.slice(0, 2), chargeId: 'charge-' + body.planId.slice(0, 2) }, 201); } });
  const dialog = await open(adminCapabilities, { onDone: () => { refreshed += 1; } });
  fireEvent.click(await within(dialog).findByRole('button', { name: /Mensual ilimitada/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /Cuota trimestral/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /^Cobrar/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar cobro de/ }));
  assert.match((await within(dialog).findByRole('alert')).textContent, /no se duplicará/);
  // The terms that feed the idempotency fingerprint can no longer change.
  assert.equal(within(dialog).getByLabelText('Método').disabled, true);
  assert.equal(within(dialog).getByRole('checkbox', { name: /Dejar pendiente de pago/ }).disabled, true);
  assert.equal(within(dialog).getByLabelText('Precio de Mensual ilimitada').disabled, true);
  assert.equal(within(dialog).getByLabelText('Inicio de Mensual ilimitada').disabled, true);
  assert.equal(within(dialog).getByRole('button', { name: 'Quitar Mensual ilimitada' }).disabled, true);
  assert.equal(within(dialog).queryByRole('button', { name: 'Volver' }), null, 'no way back into the cart');
  fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar cobro de/ }));
  await within(dialog).findByText('Venta registrada');
  const plans = writes(calls).filter((call) => call.path.endsWith('/plans'));
  assert.equal(plans.length, 3, 'line 1 once, line 2 twice (its first response was lost)');
  assert.equal(plans.filter((call) => call.body.planId === PLAN.id).length, 1, 'the registered line is never sent again');
  const second = plans.filter((call) => call.body.planId === PLAN_B.id);
  assert.equal(second[0].key, second[1].key, 'the unknown-outcome request is retried with the same key');
  assert.equal(refreshed, 0);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
  assert.equal(refreshed, 1, 'the profile reloads even though one request threw');
});

test('closing after a failed first attempt still reloads the profile when something was registered', async () => {
  let refreshed = 0;
  serve({ onSale: () => { throw new Error('network down'); } });
  const dialog = await open(adminCapabilities, { onDone: () => { refreshed += 1; } });
  fireEvent.click(await within(dialog).findByRole('button', { name: /Mensual ilimitada/ }));
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Productos' }));
  fireEvent.click(await within(dialog).findByRole('button', { name: /Talla M/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /^Cobrar/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar cobro de/ }));
  await within(dialog).findByRole('alert');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
  assert.equal(refreshed, 1, 'the plan line was registered before the product sale threw');
});

test('D113: an account that does not clock in is told to open the register (not offered a clock-in that cannot work), and the fiscal-data refusal has its own message', async () => {
  serve({ shift: undefined, onPlan: () => response({ error: 'cash_session_required' }, 409) });
  let dialog = await open();
  fireEvent.click(await within(dialog).findByRole('button', { name: /Mensual ilimitada/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /^Cobrar/ }));
  assert.equal(within(dialog).queryByRole('button', { name: 'Fichar entrada ahora' }), null);
  fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar cobro de/ }));
  assert.ok((await within(dialog).findAllByText('Abre la caja antes de cobrar (menú Caja).')).length >= 1);
  assert.equal(within(dialog).queryByRole('button', { name: 'Fichar entrada ahora' }), null, 'no clock-in offer for an account that cannot clock in');
  cleanup();

  serve({ onInvoice: () => response({ error: 'client_fiscal_data_missing' }, 409) });
  dialog = await open();
  fireEvent.click(await within(dialog).findByRole('button', { name: /Mensual ilimitada/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /^Cobrar/ }));
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /Emitir factura/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar cobro de/ }));
  await within(dialog).findByText('Venta registrada');
  assert.match(dialog.textContent, /Faltan datos fiscales del cliente/);
});

test('the discount reason locks with the rest after an unknown outcome, and a definite rejection with nothing registered leaves the cart editable', async () => {
  let lose = true;
  const calls = serve({ onPlan: () => { if (lose) { lose = false; throw new Error('network down'); } return response({ id: 'asg-1', chargeId: 'charge-1' }, 201); } });
  let dialog = await open();
  fireEvent.click(await within(dialog).findByRole('button', { name: /Mensual ilimitada/ }));
  fireEvent.change(within(dialog).getByLabelText('Precio de Mensual ilimitada'), { target: { value: '50' } });
  fireEvent.change(within(dialog).getByLabelText('Motivo del descuento de Mensual ilimitada'), { target: { value: 'Amigo de la casa' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /^Cobrar/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar cobro de/ }));
  await within(dialog).findByRole('alert');
  assert.equal(within(dialog).getByLabelText('Motivo del descuento de Mensual ilimitada').disabled, true, 'the reason is part of the payload, so it is frozen');
  fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar cobro de/ }));
  await within(dialog).findByText('Venta registrada');
  const plans = writes(calls).filter((call) => call.path.endsWith('/plans'));
  assert.equal(plans.length, 2); assert.equal(plans[0].key, plans[1].key); assert.equal(plans[1].body.adjustmentReason, 'Amigo de la casa');
  cleanup();

  let outOfStock = true;
  const sales = serve({ onSale: () => outOfStock ? response({ error: 'insufficient_stock' }, 409) : response({ id: 'sale-1' }, 201) });
  dialog = await open();
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Productos' }));
  fireEvent.click(await within(dialog).findByRole('button', { name: /Talla M/ }));
  fireEvent.change(within(dialog).getByLabelText('Cantidad de Camiseta 2J · Talla M'), { target: { value: '3' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /^Cobrar/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar cobro de/ }));
  assert.ok(await within(dialog).findAllByText('No hay stock suficiente de alguno de los productos.'));
  assert.equal(within(dialog).getByRole('button', { name: 'Volver' }).disabled, false, 'nothing was registered: the user can go back and fix the cart');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Volver' }));
  fireEvent.change(within(dialog).getByLabelText('Cantidad de Camiseta 2J · Talla M'), { target: { value: '1' } });
  outOfStock = false;
  fireEvent.click(within(dialog).getByRole('button', { name: /^Cobrar/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar cobro de/ }));
  await within(dialog).findByText('Venta registrada');
  const attempts = writes(sales).filter((call) => call.path === '/api/admin/store/sales');
  assert.equal(attempts.length, 2); assert.equal(attempts[1].body.lines[0].quantity, 1);
});
