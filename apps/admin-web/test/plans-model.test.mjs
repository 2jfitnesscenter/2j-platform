import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#services' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { ServicesPage } = await import('../src/services-page.tsx');
const { ProfessionalCapabilitiesProvider } = await import('../src/app-shell.tsx');
const copy = await import('../src/product-copy.ts');
afterEach(() => { cleanup(); globalThis.fetch = undefined; });
after(() => dom.window.close());

const bunker = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'El Búnker' };
const sala = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', name: 'La Sala' };
const fuerza = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', areaId: bunker.id, area: bunker.name, name: 'Fuerza funcional', status: 'active', planCount: 0, rightCount: 0, updatedAt: '2026-10-08T09:00:00Z' };
const pilates = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc', areaId: sala.id, area: sala.name, name: 'Pilates', status: 'active', planCount: 0, rightCount: 0, updatedAt: '2026-10-08T09:00:00Z' };
const yoga = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbd', areaId: sala.id, area: sala.name, name: 'Yoga', status: 'active', planCount: 0, rightCount: 0, updatedAt: '2026-10-08T09:00:00Z' };
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const admin = { calendar: true, clients: true, communications: true, billing: true, staff: true, catalogPricingManage: true };
const trainer = { ...admin, billing: false, catalogPricingManage: false };
const rightRow = (overrides) => ({ id: `r-${Math.random()}`, rightType: 'service_access', serviceId: fuerza.id, quotaScope: null, quantity: null, period: null, periodMode: null, timezone: null, validDays: null, validDaysStartRule: null, ...overrides });
const legacyPlan = (overrides = {}) => ({ id: 'plan-legacy', name: 'Fuerza 3 días (anterior)', status: 'active', currentVersion: 2, kind: 'recurring', renewalCadence: 'monthly', periodDays: null, basePriceCents: 4000, services: [{ id: fuerza.id, name: fuerza.name, area: bunker.name }], modules: [], rights: [rightRow({}), rightRow({ id: 'q', rightType: 'period_quota', quotaScope: 'per_service', quantity: 3, period: 'week', periodMode: 'calendar', timezone: 'Atlantic/Canary' })], ...overrides });
const bonoPlan = (overrides = {}) => ({ id: 'plan-bono', name: 'Bono 10', status: 'draft', currentVersion: 1, kind: 'session_pack', renewalCadence: null, periodDays: null, basePriceCents: 6000, services: [{ id: fuerza.id, name: fuerza.name, area: bunker.name }], modules: [{ module: 'training', accessLevel: 'full', capabilities: [] }], rights: [rightRow({}), rightRow({ id: 'b', rightType: 'sessions_quota', serviceId: null, quotaScope: 'shared', quantity: 10, validDays: 90, validDaysStartRule: 'first_use' })], ...overrides });

function serve({ plans = [], onPlanPost } = {}) {
  const posts = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.endsWith('/api/areas')) return response([bunker, sala]);
    if (path.endsWith('/api/services') && !options.method) return response([fuerza, pilates, yoga]);
    if (/\/api\/plans(\/[^/]+\/versions)?$/.test(path) && options.method === 'POST') { const body = JSON.parse(options.body); posts.push({ path, body }); return onPlanPost ? onPlanPost(body) : response({ id: 'new', status: 'draft', services: [{ id: fuerza.id, name: fuerza.name, area: bunker.name }] }, 201); }
    if (path.endsWith(`/api/services/${fuerza.id}/plans`)) return response(plans);
    if (path.includes('/plans')) return response([]);
    throw new Error(`Unexpected request ${options.method ?? 'GET'} ${path}`);
  };
  return posts;
}
const mount = (capabilities = admin) => render(React.createElement(ProfessionalCapabilitiesProvider, { capabilities }, React.createElement(ServicesPage)));
async function openNewPlan() {
  await screen.findByRole('heading', { name: fuerza.name });
  fireEvent.click(screen.getByRole('button', { name: 'Planes' }));
  fireEvent.click((await screen.findAllByRole('button', { name: /nuevo plan/i }))[0]);
  return screen.findByRole('dialog', { name: 'Nuevo plan' });
}
const names = (root) => [...root.querySelectorAll('legend')].map((node) => node.textContent);

test('A: the normal flow never shows the technical quota vocabulary', async () => {
  serve();
  mount();
  const dialog = await openNewPlan();
  const forbidden = /Límite de sesiones|Cuota por periodo|Derecho\b|Derechos incluidos|Alcance de la cuota|Periodo móvil|Periodo de renovación del plan|Servicio de acceso|Acceso a un servicio|quota|entitlement|ledger|periodMode|quotaScope/i;
  assert.doesNotMatch(dialog.textContent, forbidden, 'empty form');
  for (const kind of ['recurring', 'session_pack']) {
    fireEvent.change(within(dialog).getByLabelText('Tipo de plan'), { target: { value: kind } });
    assert.doesNotMatch(dialog.textContent, forbidden, kind);
  }
  assert.deepEqual(names(dialog), ['Datos del plan', 'Servicios incluidos', 'Sesiones', 'Accesos', 'Vigencia']);
  assert.ok(within(dialog).getByText('Resumen del plan'));
  assert.ok(within(dialog).queryByText(/Se guardan como derechos del producto/) === null);
});

test('the dialog is organised in the five blocks, with the final labels', async () => {
  serve();
  mount();
  const dialog = await openNewPlan();
  fireEvent.change(within(dialog).getByLabelText('Tipo de plan'), { target: { value: 'recurring' } });
  assert.deepEqual(names(dialog), ['Datos del plan', 'Servicios incluidos', 'Frecuencia', 'Accesos', 'Vigencia']);
  for (const label of ['Nombre', 'Precio (€), opcional', 'Tipo de plan', 'Frecuencia', 'Tipo de vigencia']) assert.ok(within(dialog).getByLabelText(label), label);
  assert.deepEqual([...within(dialog).getByLabelText('Tipo de plan').options].map((node) => node.textContent), ['Selecciona el tipo', 'Plan recurrente', 'Bono de sesiones']);
  assert.deepEqual([...within(dialog).getByLabelText('Tipo de vigencia').options].map((node) => node.textContent), ['Mensual natural', 'Semanal', 'Periodo personalizado']);
  assert.equal(within(dialog).getByLabelText('Tipo de vigencia').value, 'monthly');
});

test('B: a recurring plan offers Frecuencia 1-5 días / semana and Sin límite, with the period helper', async () => {
  serve();
  mount();
  const dialog = await openNewPlan();
  fireEvent.change(within(dialog).getByLabelText('Tipo de plan'), { target: { value: 'recurring' } });
  const frequency = within(dialog).getByLabelText('Frecuencia');
  assert.deepEqual([...frequency.options].map((node) => node.textContent), ['Selecciona la frecuencia', '1 día / semana', '2 días / semana', '3 días / semana', '4 días / semana', '5 días / semana', 'Sin límite']);
  assert.deepEqual([...frequency.options].map((node) => node.value), ['', '1', '2', '3', '4', '5', 'unlimited']);
  assert.ok(within(dialog).getByText('La cantidad de sesiones del periodo se calculará según la duración real del periodo.'));
  assert.equal(within(dialog).queryByLabelText('Número de sesiones'), null, 'a recurring plan has no pack size');
  assert.match(within(dialog).getByText(/todavía no está implementada/).textContent, /bolsas de sesiones/, 'the pending engine is stated, not hidden');
  assert.doesNotMatch(dialog.textContent, /\b13\b|sesiones del mes|ROUND/i, 'nothing is computed in the frontend');
});

test('C: a session pack asks for the number of sessions, the validity and when it starts', async () => {
  serve();
  mount();
  const dialog = await openNewPlan();
  fireEvent.change(within(dialog).getByLabelText('Tipo de plan'), { target: { value: 'session_pack' } });
  assert.ok(within(dialog).getByLabelText('Número de sesiones'));
  assert.equal(within(dialog).queryByLabelText('Frecuencia'), null);
  assert.equal(within(dialog).queryByLabelText('Inicio de vigencia'), null, 'the start rule only matters once there is a validity');
  fireEvent.change(within(dialog).getByLabelText(/Vigencia del bono/), { target: { value: '90' } });
  const start = within(dialog).getByLabelText('Inicio de vigencia');
  assert.deepEqual([...start.options].map((node) => node.textContent), ['En la compra', 'En el primer uso']);
});

test('C: a pack is saved with the exact semantics: automatic service access, one shared quota, validity', async () => {
  const posts = serve();
  mount();
  const dialog = await openNewPlan();
  fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Bono 10 funcional' } });
  fireEvent.change(within(dialog).getByLabelText('Precio (€), opcional'), { target: { value: '60,00' } });
  fireEvent.change(within(dialog).getByLabelText('Tipo de plan'), { target: { value: 'session_pack' } });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /Pilates/ }));
  fireEvent.change(within(dialog).getByLabelText('Número de sesiones'), { target: { value: '10' } });
  fireEvent.change(within(dialog).getByLabelText(/Vigencia del bono/), { target: { value: '90' } });
  fireEvent.change(within(dialog).getByLabelText('Inicio de vigencia'), { target: { value: 'first_use' } });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /Búnker \/ Training/ }));
  fireEvent.change(within(dialog).getByLabelText('Acceso a Búnker'), { target: { value: 'full' } });
  assert.equal(within(dialog).getByText('Resumen del plan').nextSibling.textContent, 'Bono · 10 sesiones · Fuerza funcional, Pilates · 60 €');
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Crear borrador' })); await new Promise((resolve) => setTimeout(resolve, 40)); });
  await waitFor(() => assert.equal(posts.length, 1));
  const body = posts[0].body;
  assert.equal(body.kind, 'session_pack'); assert.equal(body.basePriceCents, 6000); assert.equal(body.renewalCadence, undefined);
  assert.deepEqual(body.serviceIds, [fuerza.id, pilates.id]);
  assert.deepEqual(body.rights, [
    { rightType: 'service_access', serviceId: fuerza.id },
    { rightType: 'service_access', serviceId: pilates.id },
    { rightType: 'sessions_quota', serviceId: null, quotaScope: 'shared', quantity: 10, validDays: 90, validDaysStartRule: 'first_use' },
  ]);
  assert.deepEqual(body.modules, [{ module: 'training', accessLevel: 'full', capabilities: [] }]);
});

test('D: selecting services is enough: access is generated per service and unselecting one removes it', async () => {
  const posts = serve();
  mount();
  const dialog = await openNewPlan();
  fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Combo' } });
  fireEvent.change(within(dialog).getByLabelText('Tipo de plan'), { target: { value: 'session_pack' } });
  fireEvent.change(within(dialog).getByLabelText('Número de sesiones'), { target: { value: '8' } });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /Pilates/ }));
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /Yoga/ }));
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /Pilates/ }));
  assert.equal(within(dialog).queryByText(/Servicio de acceso|Acceso a un servicio/), null);
  assert.match(within(dialog).getByRole('checkbox', { name: /Pilates/ }).closest('label').textContent, /Área · La Sala/, 'services keep their area as supporting text');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear borrador' }));
  await waitFor(() => assert.equal(posts.length, 1));
  assert.deepEqual(posts[0].body.rights.filter((right) => right.rightType === 'service_access').map((right) => right.serviceId), [fuerza.id, yoga.id]);
  assert.equal(posts[0].body.rights.filter((right) => right.rightType === 'sessions_quota').length, 1);
});

test('F: a new recurring plan cannot be saved or activated until 2J-098E, and nothing is sent', async () => {
  const posts = serve();
  mount();
  const dialog = await openNewPlan();
  fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Mensual 3 días' } });
  fireEvent.change(within(dialog).getByLabelText('Precio (€), opcional'), { target: { value: '50' } });
  fireEvent.change(within(dialog).getByLabelText('Tipo de plan'), { target: { value: 'recurring' } });
  fireEvent.change(within(dialog).getByLabelText('Frecuencia'), { target: { value: '3' } });
  assert.equal(within(dialog).getByText('Resumen del plan').nextSibling.textContent, 'Mensual · 3 días/semana · Fuerza funcional · 50 €');
  const save = within(dialog).getByRole('button', { name: 'Crear borrador' });
  assert.equal(save.disabled, true);
  assert.match(dialog.textContent, /El nuevo modelo de cuotas recurrentes se habilitará con 2J-098E\./);
  assert.equal(save.getAttribute('aria-describedby'), 'plan-blocked-note', 'the reason is attached to the button');
  fireEvent.submit(dialog.querySelector('form'));
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(posts.length, 0, 'even a forced submit sends nothing');
  fireEvent.change(within(dialog).getByLabelText('Frecuencia'), { target: { value: 'unlimited' } });
  assert.equal(within(dialog).getByText('Resumen del plan').nextSibling.textContent, 'Mensual · Sin límite · Fuerza funcional · 50 €');
  assert.equal(save.disabled, true);
});

test('the frequency is never converted into a weekly quota: the recurring summary says days per week, not a limit', () => {
  assert.equal(copy.frequencyShortLabel('3'), '3 días/semana');
  assert.equal(copy.frequencyShortLabel('1'), '1 día/semana');
  assert.equal(copy.frequencyShortLabel('unlimited'), 'Sin límite');
  assert.deepEqual(copy.frequencyOptions.map((option) => option.label), ['1 día / semana', '2 días / semana', '3 días / semana', '4 días / semana', '5 días / semana', 'Sin límite']);
  assert.equal(copy.cadenceShortLabel('monthly', null), 'Mensual');
  assert.equal(copy.cadenceShortLabel('custom_period', 28), 'Cada 28 días');
  assert.equal(copy.euroLabel(50), '50 €'); assert.equal(copy.euroLabel(50.5), '50,50 €');
});

test('E: legacy plans still render, in human language, with the previous-model note and without internal names', async () => {
  serve({ plans: [legacyPlan(), bonoPlan({ status: 'active' })] });
  mount();
  await screen.findByRole('heading', { name: fuerza.name });
  fireEvent.click(screen.getByRole('button', { name: 'Planes' }));
  const cards = await screen.findByRole('list', { name: 'Planes del servicio' });
  const legacy = within(cards).getByRole('article', { name: 'Fuerza 3 días (anterior)' });
  assert.ok(within(legacy).getByText('3 accesos / semana'));
  assert.ok(within(legacy).getByText('Cuota actual'));
  fireEvent.click(within(legacy).getByRole('button', { name: 'Detalles' }));
  assert.equal(screen.getByTestId('plan-legacy-note').textContent.startsWith('Este plan usa el modelo anterior de cuotas.'), true);
  assert.doesNotMatch(legacy.textContent, /period_quota|sessions_quota|service_access|quotaScope|ledger|entitlement|derecho/i);
  const pack = within(cards).getByRole('article', { name: 'Bono 10' });
  assert.ok(within(pack).getByText('10 sesiones'), 'a pack reads naturally');
  assert.ok(within(pack).getByText('Sesiones'));
  fireEvent.click(within(pack).getByRole('button', { name: 'Detalles' }));
  assert.equal(document.querySelectorAll('[data-testid="plan-legacy-note"]').length, 0, 'a pack does not carry the legacy note');
  assert.ok(within(pack).getByText('Búnker / Training'));
});

test('E: a new version of a legacy recurring plan keeps its stored quotas read-only and never shows the old editor', async () => {
  const posts = serve({ plans: [legacyPlan()] });
  mount();
  await screen.findByRole('heading', { name: fuerza.name });
  fireEvent.click(screen.getByRole('button', { name: 'Planes' }));
  const card = await screen.findByRole('article', { name: 'Fuerza 3 días (anterior)' });
  fireEvent.click(within(card).getByRole('button', { name: 'Detalles' }));
  fireEvent.click(within(card).getByRole('button', { name: 'Crear nueva versión' }));
  const dialog = await screen.findByRole('dialog', { name: 'Nueva versión de plan' });
  assert.ok(within(dialog).getByText(/Este plan usa el modelo anterior de cuotas\. Se conserva tal como está\./));
  assert.ok(within(dialog).getByText('3 accesos / semana · calendario · Fuerza funcional'));
  assert.equal(within(dialog).queryByLabelText('Frecuencia'), null, 'the new frequency selector is not mixed into an old plan');
  assert.doesNotMatch(dialog.textContent, /Límite de sesiones|Cuota por periodo|Alcance de la cuota|Derecho 1/);
  assert.equal(within(dialog).getByLabelText('Tipo de plan').disabled, true);
  assert.equal(within(dialog).queryByText(/habilitará con 2J-098E/), null, 'saving a version of an existing plan is not blocked');
  fireEvent.change(within(dialog).getByLabelText('Precio (€), opcional'), { target: { value: '42' } });
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar nueva versión' })); await new Promise((resolve) => setTimeout(resolve, 40)); });
  await waitFor(() => assert.equal(posts.length, 1));
  assert.match(posts[0].path, /\/api\/plans\/plan-legacy\/versions$/);
  assert.equal(posts[0].body.basePriceCents, 4200);
  assert.deepEqual(posts[0].body.rights, [
    { rightType: 'service_access', serviceId: fuerza.id },
    { rightType: 'period_quota', serviceId: fuerza.id, quotaScope: 'per_service', quantity: 3, period: 'week', periodMode: 'calendar', timezone: 'Atlantic/Canary' },
  ], 'the stored quota is passed through unchanged; it is never reinterpreted as a frequency');
});

test('a new version of a plain session pack opens in the pack form with its values', async () => {
  const posts = serve({ plans: [bonoPlan()] });
  mount();
  await screen.findByRole('heading', { name: fuerza.name });
  fireEvent.click(screen.getByRole('button', { name: 'Planes' }));
  const card = await screen.findByRole('article', { name: 'Bono 10' });
  fireEvent.click(within(card).getByRole('button', { name: 'Detalles' }));
  fireEvent.click(within(card).getByRole('button', { name: 'Crear nueva versión' }));
  const dialog = await screen.findByRole('dialog', { name: 'Nueva versión de plan' });
  assert.equal(within(dialog).getByLabelText('Número de sesiones').value, '10');
  assert.equal(within(dialog).getByLabelText(/Vigencia del bono/).value, '90');
  assert.equal(within(dialog).getByLabelText('Inicio de vigencia').value, 'first_use');
  assert.equal(within(dialog).getByLabelText('Precio (€), opcional').value, '60.00');
  assert.equal(within(dialog).getByLabelText('Acceso a Búnker').value, 'full');
  fireEvent.change(within(dialog).getByLabelText('Número de sesiones'), { target: { value: '12' } });
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar nueva versión' })); await new Promise((resolve) => setTimeout(resolve, 40)); });
  await waitFor(() => assert.equal(posts.length, 1));
  assert.equal(posts[0].body.rights.find((right) => right.rightType === 'sessions_quota').quantity, 12);
});

test('G: "Espacios" is not used as the main copy: header, tabs, area headings and navigation use Servicios / Áreas', async () => {
  serve();
  mount();
  await screen.findByRole('heading', { name: fuerza.name });
  assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Servicios y planes');
  const tabs = within(screen.getByRole('group', { name: 'Vistas de Mi gimnasio' }));
  assert.deepEqual(tabs.getAllByRole('button').map((node) => node.textContent), ['Servicios', 'Áreas', 'Planes']);
  assert.doesNotMatch(document.body.textContent, /Espacios?\b|espacios?\b/);
  fireEvent.click(tabs.getByRole('button', { name: 'Áreas' }));
  assert.ok(await screen.findByRole('heading', { name: 'Áreas' }));
  assert.doesNotMatch(document.body.textContent, /Espacios?\b|espacios?\b/);
  fireEvent.click(screen.getByRole('button', { name: 'Nueva área' }));
  const dialog = await screen.findByRole('dialog', { name: 'Nueva área' });
  assert.doesNotMatch(dialog.textContent, /espacio/i);
});

test('H: areas still exist where they belong: the Áreas tab, the area on each service, the area filter and the service dialog', async () => {
  serve();
  mount();
  await screen.findByRole('heading', { name: fuerza.name });
  assert.ok(screen.getByLabelText('Filtrar por área'));
  assert.equal(screen.getByText('Área', { selector: 'dt' }).nextSibling.textContent, 'El Búnker', 'detail: Servicio ≠ Área');
  fireEvent.click(screen.getByRole('button', { name: 'Áreas' }));
  assert.ok(await screen.findByRole('heading', { name: 'El Búnker' })); assert.ok(screen.getByRole('heading', { name: 'La Sala' }));
  assert.equal(screen.getAllByText('ÁREA ACTIVA').length, 2);
  assert.equal(document.querySelectorAll('.gym-area-card').length, 2);
  fireEvent.click(screen.getByRole('button', { name: 'Servicios' }));
  fireEvent.click(screen.getByRole('button', { name: 'Nuevo servicio' }));
  const dialog = await screen.findByRole('dialog', { name: 'Nuevo servicio' });
  assert.deepEqual([...within(dialog).getByLabelText('Área').options].map((node) => node.textContent), ['El Búnker', 'La Sala']);
});

test('Trainer sees Servicios y áreas, no plans and no plan form', async () => {
  serve();
  mount(trainer);
  await screen.findByRole('heading', { name: fuerza.name });
  assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Servicios y áreas');
  assert.equal(screen.queryByRole('button', { name: 'Planes' }), null);
  assert.equal(screen.queryByRole('button', { name: /nuevo plan/i }), null);
});
