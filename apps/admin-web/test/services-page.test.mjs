import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5173' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { ServicesPage } = await import('../src/services-page.tsx');
const { describePlan } = await import('../src/product-copy.ts');

afterEach(() => { cleanup(); globalThis.fetch = undefined; });
after(() => dom.window.close());

const area = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'La Sala' };
const service = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', areaId: area.id, area: area.name, name: 'Entrenamiento funcional', status: 'active', planCount: 0, rightCount: 0, updatedAt: '2026-10-08T09:00:00Z' };
const plan = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Funcional mensual', status: 'draft', currentVersion: 1, kind: 'recurring', renewalCadence: 'monthly', periodDays: null, services: [{ id: service.id, name: service.name, area: area.name }], rights: [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', rightType: 'service_access', serviceId: service.id, quotaScope: null, quantity: null, period: null, periodMode: null, timezone: null, validDays: null, validDaysStartRule: null }] };
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

function initialFetch({ plans = [], onPlanCreate = () => response(plan, 201), onServiceList = () => response([service]) } = {}) {
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.endsWith('/api/areas')) return response([area]);
    if (path.endsWith('/api/services') && options.method === 'POST') return response(service, 201);
    if (path.endsWith('/api/services')) return onServiceList();
    if (path.endsWith('/api/plans') && options.method === 'POST') return onPlanCreate(url, options);
    if (path.endsWith(`/api/services/${service.id}/plans`)) return response(plans);
    throw new Error(`Unexpected request ${options.method ?? 'GET'} ${path}`);
  };
}

async function openPlanDialog() {
  await screen.findByRole('heading', { name: service.name });
  fireEvent.click(screen.getByRole('button', { name: /nuevo plan/i }));
  return screen.findByRole('dialog', { name: 'Nuevo plan' });
}

test('renders the catalog with understandable product terms and noninteractive future sections', async () => {
  initialFetch();
  render(React.createElement(ServicesPage));
  await screen.findByRole('heading', { name: service.name });
  assert.ok(screen.getByRole('button', { name: service.name }));
  assert.ok(screen.getByText('Clientes', { selector: 'span' }));
  assert.equal(screen.queryByRole('link', { name: /clientes|calendario/i }), null);
  assert.equal(screen.queryByText('session_pack'), null);
});

test('service and plan dialogs focus their first field, close on Escape and restore focus to the opener', async () => {
  initialFetch();
  render(React.createElement(ServicesPage));
  const serviceOpener = screen.getByRole('button', { name: /nuevo servicio/i });
  fireEvent.click(serviceOpener);
  const serviceDialog = await screen.findByRole('dialog', { name: 'Nuevo servicio' });
  const serviceName = within(serviceDialog).getByLabelText('Nombre');
  assert.equal(document.activeElement, serviceName);
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => assert.equal(document.activeElement, serviceOpener));

  const planOpener = await screen.findByRole('button', { name: /nuevo plan/i });
  fireEvent.click(planOpener);
  const planDialog = await screen.findByRole('dialog', { name: 'Nuevo plan' });
  assert.equal(document.activeElement, within(planDialog).getByLabelText('Nombre del plan'));
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => assert.equal(document.activeElement, planOpener));
});

test('a selected draft service is visible and clearly labeled in the new plan dialog', async () => {
  const draftService = { ...service, status: 'draft' };
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/areas')) return response([area]);
    if (String(url).endsWith('/api/services')) return response([draftService]);
    if (String(url).endsWith(`/api/services/${draftService.id}/plans`)) return response([]);
    throw new Error('unexpected request');
  };
  render(React.createElement(ServicesPage));
  await screen.findByRole('heading', { name: draftService.name });
  fireEvent.click(await screen.findByRole('button', { name: /nuevo plan/i }));
  const dialog = await screen.findByRole('dialog', { name: 'Nuevo plan' });
  assert.equal(within(dialog).getByRole('checkbox').checked, true);
  assert.match(within(dialog).getByText(/Borrador/).textContent, /Borrador/);
  assert.match(within(dialog).getByText(/también seguirá en borrador/).textContent, /hasta que todos sus servicios estén activos/);
});
test('created plan refreshes the visible plan detail and service plan count without reselection', async () => {
  let listRevision = 0;
  let planRevision = 0;
  let serviceReads = 0;
  let planReads = 0;
  initialFetch({
    onPlanCreate: () => { planRevision += 1; return response(plan, 201); },
    onServiceList: () => response([{ ...service, planCount: listRevision ? 1 : 0, rightCount: listRevision ? 1 : 0 }]),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/services') && options.method !== 'POST') serviceReads += 1;
    if (String(url).endsWith(`/api/services/${service.id}/plans`)) planReads += 1;
    if (String(url).endsWith('/api/plans') && options.method === 'POST') { listRevision = 1; return originalFetch(url, options); }
    if (String(url).endsWith(`/api/services/${service.id}/plans`) && planRevision > 0) return response([plan]);
    return originalFetch(url, options);
  };
  render(React.createElement(ServicesPage));
  const dialog = await openPlanDialog();
  fireEvent.change(within(dialog).getByLabelText('Nombre del plan'), { target: { value: plan.name } });
  fireEvent.change(within(dialog).getByLabelText('Tipo de producto'), { target: { value: 'recurring' } });
  fireEvent.change(within(dialog).getByLabelText('Renovación'), { target: { value: 'monthly' } });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear borrador' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null), { timeout: 2500 });
  assert.ok(await screen.findByRole('heading', { name: plan.name }));
  assert.ok(screen.getByRole('row', { name: /Entrenamiento funcional La Sala 1 Activo/ }));
  assert.ok(screen.getByText('Acceso al servicio'));
  assert.ok(serviceReads >= 2, 'service list should refresh after the save');
  assert.ok(planReads >= 2, 'selected plan detail should refresh after the save');
});

test('an access right without a target is described neutrally in multi-service plans', async () => {
  const second = { ...service, id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Valoración inicial' };
  const unscopedPlan = { ...plan, services: [{ id: service.id, name: service.name, area: service.area }, { id: second.id, name: second.name, area: second.area }], rights: [{ ...plan.rights[0], serviceId: null }] };
  initialFetch({ plans: [unscopedPlan] });
  render(React.createElement(ServicesPage));
  await screen.findByRole('heading', { name: unscopedPlan.name });
  assert.ok(screen.getByText(service.name, { selector: '.service-chip' }));
  assert.ok(screen.getByText(second.name, { selector: '.service-chip' }));
  assert.ok(screen.getByText('Destino sin especificar'));
  assert.equal(screen.queryByText('Todos los servicios incluidos'), null);
});

test('an access right without a target remains optional and is submitted without implying its scope', async () => {
  let submitted;
  initialFetch({ onPlanCreate: (_url, options) => { submitted = JSON.parse(options.body); return response(plan, 201); } });
  render(React.createElement(ServicesPage));
  const dialog = await openPlanDialog();
  fireEvent.change(within(dialog).getByLabelText('Nombre del plan'), { target: { value: plan.name } });
  fireEvent.change(within(dialog).getByLabelText('Tipo de producto'), { target: { value: 'recurring' } });
  fireEvent.change(within(dialog).getByLabelText('Renovación'), { target: { value: 'monthly' } });
  fireEvent.change(within(dialog).getByLabelText('Destino del acceso (opcional)'), { target: { value: '' } });
  assert.ok(within(dialog).getByText('El alcance de un acceso sin destino está pendiente de decisión.'));
  const create = within(dialog).getByRole('button', { name: 'Crear borrador' });
  assert.equal(create.disabled, false);
  fireEvent.click(create);
  await waitFor(() => assert.ok(submitted));
  assert.equal(submitted.rights[0].serviceId, null);
});

test('creating a plan without the currently selected service selects a service that contains the new plan', async () => {
  const second = { ...service, id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Valoración inicial' };
  const secondPlan = { ...plan, services: [{ id: second.id, name: second.name, area: second.area }] };
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.endsWith('/api/areas')) return response([area]);
    if (path.endsWith('/api/services') && options.method === 'POST') return response(service, 201);
    if (path.endsWith('/api/services')) return response([service, second]);
    if (path.endsWith('/api/plans') && options.method === 'POST') return response(secondPlan, 201);
    if (path.endsWith(`/api/services/${service.id}/plans`)) return response([]);
    if (path.endsWith(`/api/services/${second.id}/plans`)) return response([secondPlan]);
    throw new Error(`Unexpected request ${options.method ?? 'GET'} ${path}`);
  };
  render(React.createElement(ServicesPage));
  const dialog = await openPlanDialog();
  fireEvent.change(within(dialog).getByLabelText('Nombre del plan'), { target: { value: secondPlan.name } });
  fireEvent.change(within(dialog).getByLabelText('Tipo de producto'), { target: { value: 'recurring' } });
  fireEvent.change(within(dialog).getByLabelText('Renovación'), { target: { value: 'monthly' } });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /Valoración inicial/ }));
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /Entrenamiento funcional/ }));
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear borrador' }));
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  assert.ok(await screen.findByRole('heading', { name: second.name }));
  assert.ok(await screen.findByRole('heading', { name: secondPlan.name }));
});

test('failed save is announced inside the open dialog and leaves the user input intact', async () => {
  const keys = [];
  initialFetch({ onPlanCreate: (_url, options) => { keys.push(options.headers['idempotency-key']); return response({ error: 'conflict', message: 'Ya existe un plan con ese nombre.' }, 409); } });
  render(React.createElement(ServicesPage));
  const dialog = await openPlanDialog();
  fireEvent.change(within(dialog).getByLabelText('Nombre del plan'), { target: { value: plan.name } });
  fireEvent.change(within(dialog).getByLabelText('Tipo de producto'), { target: { value: 'recurring' } });
  fireEvent.change(within(dialog).getByLabelText('Renovación'), { target: { value: 'monthly' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear borrador' }));
  const alert = await within(dialog).findByRole('alert');
  assert.equal(alert.textContent, 'Ya existe un plan con ese nombre.');
  assert.equal(within(dialog).getByLabelText('Nombre del plan').value, plan.name);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear borrador' }));
  await waitFor(() => assert.equal(keys.length, 2));
  assert.equal(keys[0], keys[1], 'retry must reuse the dialog idempotency key');
});

test('plan loading, fetch failure and valid empty response have distinct states with retry', async () => {
  let fail = true;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/areas')) return response([area]);
    if (String(url).endsWith('/api/services')) return response([service]);
    if (String(url).endsWith(`/api/services/${service.id}/plans`)) return fail ? Promise.reject(new Error('offline')) : response([]);
    throw new Error('unexpected request');
  };
  render(React.createElement(ServicesPage));
  await screen.findByRole('heading', { name: service.name });
  assert.ok(await screen.findByRole('alert'));
  assert.equal(screen.queryByText('Aún no hay planes'), null);
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  assert.ok(await screen.findByText('Aún no hay planes'));
});

test('plan summary maps domain kinds, cadence, rights and quota periods to Spanish copy', () => {
  assert.equal(describePlan({ kind: 'session_pack', renewalCadence: null, periodDays: null, rights: [{ rightType: 'sessions_quota', serviceId: null, quotaScope: 'shared', quantity: 8, period: null, periodMode: null }] }), 'Bono de sesiones: sin renovación; incluye 8 sesiones compartidas.');
  assert.equal(describePlan({ kind: 'recurring', renewalCadence: 'monthly', periodDays: null, rights: [{ rightType: 'period_quota', serviceId: null, quotaScope: 'shared', quantity: 8, period: 'month', periodMode: 'calendar' }] }), 'Plan recurrente: renovación mensual; incluye 8 accesos por mes (calendario).');
  assert.equal(describePlan({ kind: 'recurring', renewalCadence: 'monthly', periodDays: null, rights: [{ rightType: 'service_access', serviceId: null, quotaScope: null, quantity: null, period: null, periodMode: null }] }), 'Plan recurrente: renovación mensual; incluye Acceso sin destino especificado.');
});
