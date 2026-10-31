import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#home', pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { NewSaleLauncher } = await import('../src/new-sale-launcher.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; dom.window.localStorage.clear(); });
after(() => dom.window.close());

const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const MARTA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LUIS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLAN = { id: '11111111-1111-4111-8111-111111111111', name: 'Mensual ilimitada', basePriceCents: 5900 };

/** Servidor simulado: búsqueda de clientes, ficha con permisos y las escrituras de la venta. */
function serve({ profiles = {}, sale } = {}) {
  const calls = [];
  const list = [{ id: MARTA, firstName: 'Marta', lastName: 'Santos' }, { id: LUIS, firstName: 'Luis', lastName: 'Marta' }];
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(String(url)); const path = parsed.pathname; const method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method, body, search: parsed.search });
    if (path === '/api/clients') return response({ items: list.filter((item) => `${item.firstName} ${item.lastName}`.toLowerCase().includes((parsed.searchParams.get('q') ?? '').toLowerCase())) });
    const profile = Object.entries(profiles).find(([id]) => path === `/api/clients/${id}`);
    if (profile) return profile[1] === 'error' ? response({}, 500) : response(profile[1]);
    if (path === '/api/plans/assignable') return response([PLAN]);
    if (path === '/api/admin/store') return response({ products: [] });
    if (path === '/api/economics/invoice-settings') return response({ defaultIgicBasisPoints: 300 });
    if (path === '/api/timeclock/self') return response({ openShift: { id: 's' } });
    if (path === `/api/clients/${MARTA}/plans` && method === 'POST') return (sale ?? (() => response({ id: 'asg-1', chargeId: 'charge-1' }, 201)))(body);
    if (/^\/api\/economics\/charges\/[^/]+\/invoice$/.test(path)) return response({ id: 'doc-1' }, 201);
    throw new Error(`Unexpected request ${method} ${path}`);
  };
  return calls;
}
const profileOf = (id, first, last, { status = 'active', capabilities = { assignPlans: true, collectPayments: true, manageCatalogPrice: false } } = {}) => ({ client: { id, firstName: first, lastName: last, status }, capabilities });
const search = async (text) => {
  fireEvent.click(screen.getByRole('button', { name: 'Nueva venta' }));
  const picker = await screen.findByRole('dialog', { name: 'Nueva venta' });
  fireEvent.change(within(picker).getByLabelText('Buscar cliente'), { target: { value: text } });
  return picker;
};

test('from the Resumen: search a client, pick it and the same unified sale opens for them; a Bizum payment is sent as bizum; closing reloads the Resumen', async () => {
  const calls = serve({ profiles: { [MARTA]: profileOf(MARTA, 'Marta', 'Santos') } }); let reloads = 0;
  render(React.createElement(NewSaleLauncher, { onDone: () => { reloads += 1; } }));
  const picker = await search('mar');
  assert.ok(await within(picker).findByRole('button', { name: /Marta Santos/ }));
  assert.ok(within(picker).getByRole('button', { name: /Luis Marta/ }));
  assert.ok(calls.some((call) => call.path === '/api/clients' && call.search.includes('status=active')), 'only active clients are offered');
  fireEvent.click(within(picker).getByRole('button', { name: /Marta Santos/ }));
  const dialog = await screen.findByText('Venta para Marta Santos.').then(() => screen.getByRole('dialog', { name: 'Nueva venta' }));
  fireEvent.click(await within(dialog).findByRole('button', { name: /Mensual ilimitada/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /^Cobrar/ }));
  fireEvent.change(within(dialog).getByLabelText('Método'), { target: { value: 'bizum' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar cobro de/ }));
  await within(dialog).findByText('Venta registrada');
  const plan = calls.find((call) => call.method === 'POST' && call.path === `/api/clients/${MARTA}/plans`);
  assert.equal(plan.body.paymentMethod, 'bizum'); assert.equal(plan.body.planId, PLAN.id);
  assert.equal(reloads, 0);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
  assert.equal(reloads, 1, 'the Resumen figures are refreshed after a registered sale');
  assert.equal(screen.queryByRole('dialog'), null);
});

test('it refuses archived clients, profiles without sale permissions and failed lookups, with a reason, and never opens the sale', async () => {
  serve({ profiles: { [MARTA]: profileOf(MARTA, 'Marta', 'Santos', { status: 'archived' }), [LUIS]: profileOf(LUIS, 'Luis', 'Marta', { capabilities: { assignPlans: false, collectPayments: false } }) } });
  render(React.createElement(NewSaleLauncher, { onDone: () => {} }));
  const picker = await search('mar');
  fireEvent.click(await within(picker).findByRole('button', { name: /Marta Santos/ }));
  assert.match((await within(picker).findByRole('alert')).textContent, /archivado/);
  fireEvent.click(within(picker).getByRole('button', { name: /Luis Marta/ }));
  await waitFor(() => assert.match(within(picker).getByRole('alert').textContent, /no puede registrar ventas/));
  assert.ok(!screen.queryByText(/Venta para/), 'the sale dialog never opened');
  cleanup();

  serve({ profiles: { [MARTA]: 'error' } });
  render(React.createElement(NewSaleLauncher, { onDone: () => {} }));
  const again = await search('mar');
  fireEvent.click(await within(again).findByRole('button', { name: /Marta Santos/ }));
  assert.match((await within(again).findByRole('alert')).textContent, /No se pudo abrir la ficha/);
});

test('the search waits for two letters and says so when nothing matches; closing returns to a clean button', async () => {
  const calls = serve();
  render(React.createElement(NewSaleLauncher, { onDone: () => {} }));
  const picker = await search('m');
  assert.ok(within(picker).getByText('Escribe al menos dos letras.'));
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(calls.filter((call) => call.path === '/api/clients').length, 0, 'no request below two letters');
  fireEvent.change(within(picker).getByLabelText('Buscar cliente'), { target: { value: 'zzz' } });
  assert.ok(await within(picker).findByText('Sin resultados entre los clientes activos.'));
  fireEvent.keyDown(document, { key: 'Escape' });
  assert.equal(screen.queryByRole('dialog'), null);
  assert.ok(screen.getByRole('button', { name: 'Nueva venta' }));
});
