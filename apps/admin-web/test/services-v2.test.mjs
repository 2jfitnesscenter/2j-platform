import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#services' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { ServicesPage } = await import('../src/services-page.tsx');
const { ProfessionalCapabilitiesProvider } = await import('../src/app-shell.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; });
after(() => dom.window.close());

const area = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'La Sala' };
const svc = (n, overrides = {}) => ({ id: `svc-${n}`, areaId: area.id, area: area.name, name: `Servicio ${n}`, status: 'active', planCount: 1, rightCount: 1, updatedAt: '2026-10-08T09:00:00Z', ...overrides });
const right = { id: 'r1', rightType: 'period_quota', serviceId: null, quotaScope: 'shared', quantity: 3, period: 'week', periodMode: 'calendar', timezone: null, validDays: null, validDaysStartRule: null };
const plan = (overrides = {}) => ({ id: 'plan-1', name: '3 días', status: 'draft', currentVersion: 1, kind: 'recurring', renewalCadence: 'monthly', periodDays: null, basePriceCents: '5000', services: [{ id: 'svc-1', name: 'Servicio 1', area: area.name }], rights: [right], ...overrides });
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const serve = ({ services = [svc(1)], plans = [plan()], onPost } = {}) => {
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (options.method === 'POST' || options.method === 'PATCH') return onPost ? onPost(path, options) : response({}, 201);
    if (path.endsWith('/api/areas')) return response([area]);
    if (path.endsWith('/api/services')) return response(services);
    if (/\/api\/services\/[^/]+\/plans$/.test(path)) return response(plans);
    throw new Error(`Unexpected ${path}`);
  };
};
const mount = (caps, section = 'services') => render(React.createElement(ProfessionalCapabilitiesProvider, { capabilities: caps }, React.createElement(ServicesPage, { section })));
const admin = { calendar: true, clients: true, communications: true, billing: true, staff: true, catalogPricingManage: true };
const trainer = { calendar: true, clients: true, communications: true, billing: false, staff: true, catalogPricingManage: false };

test('services list: clean rows with name, area and a status chip; incomplete setup only from real data (no linked plans)', async () => {
  serve({ services: [svc(1, { planCount: 0 }), svc(2, { status: 'draft', planCount: 0 }), svc(3)] });
  mount(admin);
  const list = await screen.findByRole('list', { name: 'Servicios' });
  const rows = within(list).getAllByRole('button');
  assert.equal(rows.length, 3);
  assert.ok(within(rows[0]).getByText('Sin planes vinculados'), 'active service without plans is flagged');
  assert.ok(within(rows[1]).queryByText('Sin planes vinculados') === null, 'draft services are not flagged');
  assert.ok(within(rows[2]).queryByText('Sin planes vinculados') === null);
  assert.ok(within(rows[1]).getByText('Borrador'));
  assert.equal(rows.filter((row) => row.getAttribute('aria-pressed') === 'true').length, 1, 'exactly one service is selected at a time');
});

test('selecting a service opens its detail; the area filter and search narrow the list', async () => {
  serve({ services: [svc(1), svc(2, { name: 'Yoga' })] });
  mount(admin);
  await screen.findByRole('list', { name: 'Servicios' });
  fireEvent.change(screen.getByLabelText('Buscar servicio'), { target: { value: 'yo' } });
  assert.equal(within(screen.getByRole('list', { name: 'Servicios' })).getAllByRole('button').length, 1);
  fireEvent.click(within(screen.getByRole('list', { name: 'Servicios' })).getByRole('button', { name: /Yoga/ }));
  assert.ok(await screen.findByRole('heading', { name: 'Yoga' }));
  fireEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
  assert.equal(within(screen.getByRole('list', { name: 'Servicios' })).getAllByRole('button').length, 2);
});

test('plans are business-language cards: Cuota actual, Vigencia, Servicios and price in integer cents, never internal vocabulary', async () => {
  serve({ plans: [plan(), plan({ id: 'plan-2', name: 'Bono 10', kind: 'session_pack', status: 'active', basePriceCents: '5900', rights: [{ ...right, id: 'r2', rightType: 'sessions_quota', quantity: 10, period: null }] })] });
  mount(admin);
  fireEvent.click((await screen.findAllByRole('button', { name: /Servicio 1/ }))[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Planes' }));
  const cards = await screen.findByRole('list', { name: 'Planes del servicio' });
  const first = within(cards).getByRole('article', { name: '3 días' });
  assert.ok(within(first).getByText(/50,00/), '"5000" (string cents from the API) renders as 50,00 €');
  assert.ok(within(first).getByText('Cuota actual'));
  assert.ok(within(first).getByText('Vigencia'));
  assert.ok(within(first).getByText('Servicios'));
  assert.ok(within(first).getByText('Borrador'));
  const second = within(cards).getByRole('article', { name: 'Bono 10' });
  assert.ok(within(second).getByText(/59,00/));
  fireEvent.click(within(first).getByRole('button', { name: 'Detalles' }));
  assert.doesNotMatch(document.body.textContent, /derecho|entitlement|ledger|grant|snapshot/i);
  assert.ok(screen.getByTestId('plan-legacy-note'), 'legacy plans never read as the final model');
  assert.match(screen.getByTestId('plan-legacy-note').textContent, /modelo anterior de cuotas/);
});

test('legacy weekly access is shown as stored, with no derived monthly session count', async () => {
  serve({ plans: [plan({ status: 'active' })] });
  mount(admin);
  fireEvent.click((await screen.findAllByRole('button', { name: /Servicio 1/ }))[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Planes' }));
  const card = await screen.findByRole('article', { name: '3 días' });
  assert.ok(within(card).getByText('3 accesos / semana'));
  assert.doesNotMatch(card.textContent, /\b13\b|sesiones del mes|ROUND/i);
});

test('a draft plan can be activated once; primary action only on drafts', async () => {
  const posts = [];
  window.confirm = () => true;
  serve({ plans: [plan(), plan({ id: 'plan-2', name: 'Activo', status: 'active' })], onPost: (path) => { posts.push(path); return response({ status: 'active' }, 200); } });
  mount(admin);
  fireEvent.click((await screen.findAllByRole('button', { name: /Servicio 1/ }))[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Planes' }));
  await screen.findByRole('list', { name: 'Planes del servicio' });
  const activate = screen.getAllByRole('button', { name: 'Activar plan' });
  assert.equal(activate.length, 1, 'only the draft offers activation');
  assert.match(activate[0].className, /ui-button--primary/);
  fireEvent.click(activate[0]);
  await waitFor(() => assert.ok(posts.some((path) => /plans\/plan-1\/activate$/.test(path))));
});

test('Trainer sees separate service and spaces screens without commercial controls', async () => {
  serve();
  mount(trainer);
  await screen.findByRole('list', { name: 'Servicios' });
  assert.ok(screen.queryByRole('button', { name: 'Planes' }) === null);
  assert.ok(screen.queryByRole('button', { name: 'Nuevo servicio' }) === null);
  assert.ok(screen.queryByText('Sin planes vinculados') === null, 'commercial hints stay hidden');
  cleanup(); serve(); mount(trainer, 'areas');
  await screen.findByRole('heading', { level: 1, name: 'Espacios' });
  assert.ok(screen.queryByRole('button', { name: 'Servicios' }) === null);
  assert.ok(screen.queryByRole('button', { name: 'Nuevo espacio' }) === null);
});

test('Admin: one primary action per view and the service dialog stays short (name, area, state)', async () => {
  serve();
  mount(admin);
  await screen.findByRole('list', { name: 'Servicios' });
  assert.equal(document.querySelectorAll('.ui-page-header .ui-button--primary').length, 1);
  fireEvent.click(screen.getByRole('button', { name: 'Nuevo servicio' }));
  const dialog = await screen.findByRole('dialog', { name: 'Nuevo servicio' });
  assert.deepEqual([...dialog.querySelectorAll('label')].map((label) => label.firstChild.textContent), ['Nombre', 'Área', 'Estado']);
  assert.match(dialog.className, /ui-modal/);
});

test('error and empty states explain themselves and offer retry', async () => {
  globalThis.fetch = async (url) => String(url).endsWith('/api/areas') ? response([area]) : response({}, 500);
  mount(admin);
  const alert = await screen.findByRole('alert');
  assert.ok(within(alert).getByRole('button', { name: 'Reintentar' }));
  cleanup();
  serve({ services: [] });
  mount(admin);
  assert.ok(await screen.findByText('Aún no hay servicios'));
});
