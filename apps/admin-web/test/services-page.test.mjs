import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5173' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { ServicesPage } = await import('../src/services-page.tsx');
const { ProfessionalCapabilitiesProvider } = await import('../src/app-shell.tsx');
const { describePlan } = await import('../src/product-copy.ts');

afterEach(() => { cleanup(); globalThis.fetch = undefined; });
after(() => dom.window.close());

const area = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'La Sala' };
const service = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', areaId: area.id, area: area.name, name: 'Entrenamiento funcional', status: 'active', planCount: 0, rightCount: 0, updatedAt: '2026-10-08T09:00:00Z' };
const plan = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Funcional mensual', status: 'draft', currentVersion: 1, kind: 'recurring', renewalCadence: 'monthly', periodDays: null, services: [{ id: service.id, name: service.name, area: area.name }], rights: [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', rightType: 'service_access', serviceId: service.id, quotaScope: null, quantity: null, period: null, periodMode: null, timezone: null, validDays: null, validDaysStartRule: null }] };
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

function initialFetch({ plans = [], onPlanCreate = () => response(plan, 201), onServiceList = () => response([service]), onAreaList = () => response([area]), onAreaCreate = () => response({ ...area, id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: 'North room' }, 201) } = {}) {
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.endsWith('/api/areas') && options.method === 'POST') return onAreaCreate(url, options);
    if (path.endsWith('/api/areas')) return onAreaList();
    if (path.endsWith('/api/services') && options.method === 'POST') return response(service, 201);
    if (path.endsWith('/api/services')) return onServiceList();
    if (path.endsWith('/api/plans') && options.method === 'POST') return onPlanCreate(url, options);
    if (path.endsWith(`/api/services/${service.id}/plans`)) return response(plans);
    throw new Error(`Unexpected request ${options.method ?? 'GET'} ${path}`);
  };
}

const adminCapabilities = { calendar: true, clients: true, communications: true, billing: true, staff: true, catalogPricingManage: true };
function renderServices(capabilities = adminCapabilities, section = 'services') {
  return render(React.createElement(ProfessionalCapabilitiesProvider, { capabilities }, React.createElement(ServicesPage, { section })));
}
const renderSpaces = (capabilities = adminCapabilities) => renderServices(capabilities, 'areas');

async function openPlanDialog() {
  await screen.findByRole('heading', { name: service.name });
  fireEvent.click(screen.getByRole('button', { name: 'Cuotas y planes' }));
  fireEvent.click(screen.getAllByRole('button', { name: /nuevo plan/i })[0]);
  return screen.findByRole('dialog', { name: 'Nuevo plan' });
}

test('renders the catalog with understandable product terms and noninteractive future sections', async () => {
  initialFetch();
  renderServices();
  await screen.findByRole('heading', { name: service.name });
  assert.ok(screen.getByRole('button', { name: service.name }));
  assert.equal(document.querySelectorAll('.sidebar, .topbar').length, 0);
  assert.equal(screen.queryByText('session_pack'), null);
});

test('Trainer receives operational spaces and services without commercial configuration or prices', async () => {
  initialFetch({ plans: [plan] });
  const trainerCapabilities = { calendar: true, clients: true, communications: true, billing: false, staff: true, catalogPricingManage: false };
  renderServices(trainerCapabilities);
  await screen.findByRole('heading', { name: service.name });
  assert.ok(screen.getByRole('heading', { level: 1, name: 'Servicios' }));
  assert.equal(screen.queryByRole('button', { name: 'Espacios' }), null, 'spaces are their own screen now');
  assert.equal(screen.queryByRole('button', { name: 'Cuotas y planes' }), null);
  assert.equal(screen.queryByRole('button', { name: /nuevo servicio/i }), null);
  cleanup();
  renderSpaces(trainerCapabilities);
  assert.ok(await screen.findByRole('heading', { level: 1, name: 'Espacios' }));
  assert.ok(await screen.findByText(area.name));
  assert.equal(screen.queryByRole('button', { name: 'Archivar' }), null);
  assert.equal(screen.queryByText(/Precio base/), null);
});

test('spaces are data-driven for more than three areas and show associated service state', async () => {
  const spaces = ['North room', 'Studio 2', 'Yoga loft', 'Functional floor', 'Recovery room'].map((name, index) => ({ id: index === 0 ? area.id : `area-${index}`, name }));
  initialFetch({ onAreaList: () => response(spaces) });
  renderSpaces();
  for (const space of spaces) assert.ok(await screen.findByRole('heading', { name: space.name }));
  assert.ok(screen.getAllByText('Sin servicios asociados.').length >= 4);
  assert.ok(screen.getByText('Entrenamiento funcional'));
  assert.equal(document.querySelectorAll('.gym-area-card').length, 5);
});

test('Admin creates an operational area through the existing API and receives inline success feedback', async () => {
  let posted;
  initialFetch({ onAreaCreate: (_url, options) => { posted = JSON.parse(options.body); return response({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: posted.name }, 201); } });
  renderSpaces();
  fireEvent.click(await screen.findByRole('button', { name: 'Nuevo espacio' }));
  const dialog = await screen.findByRole('dialog', { name: 'Nuevo espacio' });
  fireEvent.change(within(dialog).getByLabelText('Nombre del espacio'), { target: { value: '  Yoga loft  ' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear espacio' }));
  assert.ok(await screen.findByRole('status'));
  assert.deepEqual(posted, { name: 'Yoga loft' });
});

test('draft plan can be activated from the catalog and the action disappears after refresh', async () => {
  let activationCount = 0;
  const activePlan = { ...plan, status: 'active' };
  globalThis.window.confirm = () => true;
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.endsWith('/api/areas')) return response([area]);
    if (path.endsWith('/api/services')) return response([service]);
    if (path.endsWith(`/api/services/${service.id}/plans`)) return response(activationCount ? [activePlan] : [plan]);
    if (path.endsWith(`/api/plans/${plan.id}/activate`) && options.method === 'POST') { activationCount += 1; return response({ id: plan.id, status: 'active' }); }
    throw new Error(`Unexpected request ${options.method ?? 'GET'} ${path}`);
  };
  renderServices();
  await screen.findByRole('heading', { name: service.name });
  fireEvent.click(screen.getByRole('button', { name: 'Cuotas y planes' }));
  fireEvent.click((await screen.findAllByRole('button', { name: 'Activar plan' }))[0]);
  await screen.findByText('Plan activado y disponible para asignarlo a clientes.');
  assert.equal(activationCount, 1);
  assert.equal(screen.queryByRole('button', { name: 'Activar plan' }), null);
});

test('service navigation filters a scannable plan table while details retain rights modules and version actions', async () => {
  const fuerza={...service,id:'fuerza-service',name:'Fuerza',planCount:2};
  const funcional={...service,id:'funcional-service',name:'Funcional',planCount:1};
  const quota={id:'quota-1',rightType:'period_quota',serviceId:fuerza.id,quotaScope:'per_service',quantity:3,period:'week',periodMode:'calendar',validDays:null,validDaysStartRule:null};
  const access={id:'access-1',rightType:'service_access',serviceId:fuerza.id,quotaScope:null,quantity:null,period:null,periodMode:null,validDays:null,validDaysStartRule:null};
  const featured={...plan,id:'plan-fuerza',name:'Fuerza 3 días',status:'active',currentVersion:4,kind:'recurring',renewalCadence:'monthly',basePriceCents:4000,services:[{id:fuerza.id,name:'Fuerza',area:area.name}],rights:[access,quota],modules:[{module:'reservations',accessLevel:'full',capabilities:['book']} ]};
  const draft={...featured,id:'plan-fuerza-draft',name:'Fuerza prueba',status:'draft',currentVersion:1,basePriceCents:2500};
  let draftActivated=false;
  globalThis.fetch=async(url,options={})=>{
    const path=String(url);
    if(path.endsWith('/api/areas'))return response([area]);
    if(path.endsWith('/api/services'))return response([fuerza,funcional]);
    if(path.endsWith(`/api/services/${fuerza.id}/plans`))return response([featured,{...draft,status:draftActivated?'active':'draft'}]);
    if(path.endsWith(`/api/services/${funcional.id}/plans`))return response([{...featured,id:'plan-funcional',name:'Funcional mensual',services:[{id:funcional.id,name:'Funcional',area:area.name}]}]);
    if(path.endsWith(`/api/plans/${draft.id}/activate`)&&options.method==='POST'){draftActivated=true;return response({id:draft.id,status:'active'});}
    throw new Error(`Unexpected request ${options.method??'GET'} ${path}`);
  };
  renderServices();
  await screen.findByRole('heading',{name:'Fuerza'});
  fireEvent.click(screen.getByRole('button', { name: 'Cuotas y planes' }));
  assert.ok(screen.getAllByRole('button',{name:/Funcional/}).length>=1);
  await screen.findByRole('columnheader',{name:'Sesiones / límite'});
  const table=screen.getAllByRole('table').find(item=>item.classList.contains('plan-catalog-table'));
  assert.ok(within(table).getByRole('columnheader',{name:'Sesiones / límite'}));
  assert.equal(within(table).getAllByText('Fuerza 3 días').length,1);
  assert.equal(within(table).getAllByText('3 accesos / semana').length,2);
  assert.equal(within(table).getAllByText('Recurrente · mensual').length,2);
  assert.ok(within(table).getByText(/40,00/));
  assert.ok(within(table).getByText('Activo'));
  fireEvent.click(within(table).getAllByRole('button',{name:'Detalles'})[0]);
  const details=await within(table).findByRole('region',{name:'Detalles de Fuerza 3 días'});
  assert.ok(within(details).getByText('Cuota por periodo'));
  assert.ok(within(details).getByText('Reservas'));
  assert.ok(within(details).getByText('Versión 4'));
  assert.ok(within(details).getByText('Acceso al servicio'));
  assert.ok(within(details).getByRole('button',{name:'Crear nueva versión'}));
  globalThis.window.confirm=()=>true;
  fireEvent.click((await screen.findAllByRole('button',{name:'Activar plan'}))[0]);
  await screen.findByText('Plan activado y disponible para asignarlo a clientes.');
  assert.equal(screen.queryByRole('button',{name:'Activar plan'}),null);
  globalThis.window.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  fireEvent.click(screen.getAllByRole('button',{name:/Funcional/})[0]);
  assert.ok(await screen.findByRole('heading',{name:'Funcional'}));
  await waitFor(()=>{
    const currentTable=document.querySelector('.plan-catalog-table');
    assert.ok(currentTable.textContent.includes('Funcional mensual'));
    assert.equal(currentTable.textContent.includes('Fuerza 3 días'),false);
  });
});

test('draft activation errors remain visible and the plan stays available for correction', async () => {
  globalThis.window.confirm=()=>true;
  globalThis.fetch=async url=>String(url).endsWith('/api/areas')?response([area]):String(url).endsWith('/api/services')?response([service]):String(url).endsWith(`/api/services/${service.id}/plans`)?response([plan]):String(url).endsWith(`/api/plans/${plan.id}/activate`)?response({error:'service_not_active',message:'El servicio incluido está en borrador.'},409):Promise.reject(new Error(`Unexpected ${url}`));
  renderServices();await screen.findByRole('heading',{name:service.name});fireEvent.click(screen.getByRole('button',{name:'Cuotas y planes'}));fireEvent.click((await screen.findAllByRole('button',{name:'Activar plan'}))[0]);assert.ok(await screen.findByText('El servicio incluido está en borrador.'));assert.ok(screen.getAllByRole('button',{name:'Activar plan'}).length>=1);
});

test('service and plan dialogs focus their first field, close on Escape and restore focus to the opener', async () => {
  initialFetch();
  renderServices();
  const serviceOpener = screen.getByRole('button', { name: /nuevo servicio/i });
  fireEvent.click(serviceOpener);
  const serviceDialog = await screen.findByRole('dialog', { name: 'Nuevo servicio' });
  const serviceName = within(serviceDialog).getByLabelText('Nombre');
  assert.equal(document.activeElement, serviceName);
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => assert.equal(document.activeElement, serviceOpener));

  fireEvent.click(screen.getByRole('button', { name: 'Cuotas y planes' }));
  const planOpener = (await screen.findAllByRole('button', { name: /nuevo plan/i }))[0];
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
  renderServices();
  await screen.findByRole('heading', { name: draftService.name });
  fireEvent.click(screen.getByRole('button', { name: 'Cuotas y planes' }));
  fireEvent.click((await screen.findAllByRole('button', { name: /nuevo plan/i }))[0]);
  const dialog = await screen.findByRole('dialog', { name: 'Nuevo plan' });
  assert.equal(within(dialog).getByRole('checkbox', { name: /Borrador/ }).checked, true);
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
  renderServices();
  const dialog = await openPlanDialog();
  fireEvent.change(within(dialog).getByLabelText('Nombre del plan'), { target: { value: plan.name } });
  fireEvent.change(within(dialog).getByLabelText('Tipo de producto'), { target: { value: 'recurring' } });
  fireEvent.change(within(dialog).getByLabelText('Renovación'), { target: { value: 'monthly' } });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear borrador' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null), { timeout: 2500 });
  assert.ok(await screen.findByText(plan.name, { selector: '.plan-catalog-row strong' }));
  assert.ok(screen.getAllByRole('button', { name: /Entrenamiento funcional/ }).length >= 1);
  const table = document.querySelector('.plan-catalog-table');
  fireEvent.click(within(table).getByRole('button', { name: 'Detalles' }));
  assert.ok(await within(table).findByText('Acceso al servicio'));
  assert.ok(serviceReads >= 2, 'service list should refresh after the save');
  assert.ok(planReads >= 2, 'selected plan detail should refresh after the save');
});

test('an access right without a target is described neutrally in multi-service plans', async () => {
  const second = { ...service, id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Valoración inicial' };
  const unscopedPlan = { ...plan, services: [{ id: service.id, name: service.name, area: service.area }, { id: second.id, name: second.name, area: second.area }], rights: [{ ...plan.rights[0], serviceId: null }] };
  initialFetch({ plans: [unscopedPlan] });
  renderServices();
  await screen.findByRole('heading', { name: service.name });
  fireEvent.click(screen.getByRole('button', { name: 'Cuotas y planes' }));
  await screen.findByText(unscopedPlan.name, { selector: '.plan-catalog-row strong' });
  fireEvent.click(screen.getAllByRole('button', { name: 'Detalles' })[0]);
  await screen.findByRole('region', { name: `Detalles de ${unscopedPlan.name}` });
  const table = document.querySelector('.plan-catalog-table');
  assert.ok(within(table).getByText(service.name, { selector: '.service-chip' }));
  assert.ok(within(table).getByText(second.name, { selector: '.service-chip' }));
  assert.ok(within(table).getByText('Destino sin especificar'));
  assert.equal(screen.queryByText('Todos los servicios incluidos'), null);
});

test('service access requires an included service target before plan creation', async () => {
  let submitted;
  initialFetch({ onPlanCreate: (_url, options) => { submitted = JSON.parse(options.body); return response(plan, 201); } });
  renderServices();
  await screen.findByRole('heading', { name: service.name });
  fireEvent.click(screen.getByRole('button', { name: 'Cuotas y planes' }));
  const dialog = await openPlanDialog();
  fireEvent.change(within(dialog).getByLabelText('Nombre del plan'), { target: { value: plan.name } });
  fireEvent.change(within(dialog).getByLabelText('Tipo de producto'), { target: { value: 'recurring' } });
  fireEvent.change(within(dialog).getByLabelText('Renovación'), { target: { value: 'monthly' } });
  const target = within(dialog).getByLabelText('Servicio de acceso');
  fireEvent.change(target, { target: { value: '' } });
  const create = within(dialog).getByRole('button', { name: 'Crear borrador' });
  assert.equal(create.disabled, true);
  assert.equal(submitted, undefined);
  fireEvent.change(target, { target: { value: service.id } });
  assert.equal(create.disabled, false);
  fireEvent.click(create);
  await waitFor(() => assert.ok(submitted));
  assert.equal(submitted.rights[0].serviceId, service.id);
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
  renderServices();
  const dialog = await openPlanDialog();
  fireEvent.change(within(dialog).getByLabelText('Nombre del plan'), { target: { value: secondPlan.name } });
  fireEvent.change(within(dialog).getByLabelText('Tipo de producto'), { target: { value: 'recurring' } });
  fireEvent.change(within(dialog).getByLabelText('Renovación'), { target: { value: 'monthly' } });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /Valoración inicial/ }));
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /Entrenamiento funcional/ }));
  fireEvent.change(within(dialog).getByLabelText('Servicio de acceso'), { target: { value: second.id } });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear borrador' }));
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  assert.ok(await screen.findByRole('heading', { name: second.name }));
  assert.ok(await screen.findByText(secondPlan.name, { selector: '.plan-catalog-row strong' }));
});

test('failed save is announced inside the open dialog and leaves the user input intact', async () => {
  const keys = [];
  initialFetch({ onPlanCreate: (_url, options) => { keys.push(options.headers['idempotency-key']); return response({ error: 'conflict', message: 'Ya existe un plan con ese nombre.' }, 409); } });
  renderServices();
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
  renderServices();
  await screen.findByRole('heading', { name: service.name });
  fireEvent.click(screen.getByRole('button', { name: 'Cuotas y planes' }));
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

test('Servicios and Espacios are separate screens: Admin sees Servicios + Cuotas y planes tabs there, no Espacios tab, and no tabs on Espacios', async () => {
  initialFetch({ plans: [plan] });
  const view = renderServices();
  await screen.findByRole('heading', { name: service.name });
  assert.ok(screen.getByRole('heading', { level: 1, name: 'Servicios' }));
  const tabs = screen.getByRole('navigation', { name: 'Vistas de Servicios' });
  assert.deepEqual(within(tabs).getAllByRole('button').map((button) => button.textContent), ['Servicios', 'Cuotas y planes']);
  assert.equal(document.querySelector('main').id, 'services');
  view.rerender(React.createElement(ProfessionalCapabilitiesProvider, { capabilities: adminCapabilities }, React.createElement(ServicesPage, { section: 'areas' })));
  assert.ok(await screen.findByRole('heading', { level: 1, name: 'Espacios' }));
  assert.equal(screen.queryByRole('navigation', { name: 'Vistas de Servicios' }), null);
  assert.equal(document.querySelector('main').id, 'spaces');
  assert.ok(await screen.findByRole('button', { name: 'Nuevo espacio' }));
});

const renderPlans = (capabilities = adminCapabilities) => renderServices(capabilities, 'plans');

test('Planes y cuotas lists every plan of every service as a card (deduplicated), with price, conditions, status and actions', async () => {
  const other = { ...service, id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Pilates' };
  const shared = { ...plan, id: 'ffffffff-aaaa-4aaa-8aaa-ffffffffffff', name: 'Combinado', status: 'active', basePriceCents: 5000, services: [{ id: service.id, name: service.name, area: area.name }, { id: other.id, name: other.name, area: area.name }] };
  const draft = { ...plan, name: 'Funcional mensual', status: 'draft', basePriceCents: 4000 };
  let requested = [];
  globalThis.fetch = async (url) => {
    const path = String(url); requested.push(path);
    if (path.endsWith('/api/areas')) return response([area]);
    if (path.endsWith('/api/services')) return response([service, other]);
    if (path.endsWith(`/api/services/${service.id}/plans`)) return response([shared, draft]);
    if (path.endsWith(`/api/services/${other.id}/plans`)) return response([shared]);
    throw new Error(`Unexpected request ${path}`);
  };
  renderPlans();
  assert.ok(await screen.findByRole('heading', { level: 1, name: 'Planes y cuotas' }));
  const list = await screen.findByRole('list', { name: 'Catálogo de planes' });
  const cards = within(list).getAllByRole('article');
  assert.equal(cards.length, 2, 'a plan shared by two services is shown once');
  assert.deepEqual(cards.map((card) => card.getAttribute('aria-label')), ['Combinado', 'Funcional mensual']);
  assert.match(cards[0].textContent, /50,00/);
  assert.match(cards[0].textContent, /Activo/);
  assert.match(cards[0].textContent, /Entrenamiento funcional/);
  assert.match(cards[0].textContent, /Pilates/);
  assert.equal(within(cards[0]).queryByRole('button', { name: 'Activar plan' }), null, 'only drafts can be activated');
  assert.ok(within(cards[0]).getByRole('button', { name: 'Nueva versión' }));
  assert.ok(within(cards[1]).getByRole('button', { name: 'Activar plan' }));
  assert.ok(await screen.findByRole('button', { name: 'Nuevo plan' }));
  assert.equal(screen.queryByRole('navigation', { name: 'Vistas de Servicios' }), null);
  assert.equal(document.querySelector('main').id, 'plans');
});

test('Nueva versión opens the version dialog prefilled; a profile without catalog permission gets an explanation and no plan data is requested', async () => {
  globalThis.fetch = async (url) => { const path = String(url); if (path.endsWith('/api/areas')) return response([area]); if (path.endsWith('/api/services')) return response([service]); if (path.endsWith(`/api/services/${service.id}/plans`)) return response([{ ...plan, status: 'active', basePriceCents: 4000 }]); throw new Error(path); };
  renderPlans();
  const card = await screen.findByRole('article', { name: 'Funcional mensual' });
  fireEvent.click(within(card).getByRole('button', { name: 'Nueva versión' }));
  const dialog = await screen.findByRole('dialog');
  assert.ok(within(dialog).getByDisplayValue('Funcional mensual'));
  cleanup();
  const requested = [];
  globalThis.fetch = async (url) => { const path = String(url); requested.push(path); if (path.endsWith('/api/areas')) return response([area]); if (path.endsWith('/api/services')) return response([service]); throw new Error(path); };
  renderPlans({ ...adminCapabilities, catalogPricingManage: false });
  assert.ok(await screen.findByText('Tu perfil no gestiona el catálogo de planes'));
  assert.equal(requested.some((path) => path.includes('/plans')), false);
});
