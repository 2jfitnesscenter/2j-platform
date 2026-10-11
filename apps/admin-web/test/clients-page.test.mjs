import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5173/#clients' });
dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(callback, 0);
dom.window.cancelAnimationFrame = (handle) => dom.window.clearTimeout(handle);
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { ClientsPage } = await import('../src/clients-page.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; window.location.hash='#clients'; });
after(() => dom.window.close());

const client = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', firstName: 'Marta', lastName: 'Santos', email: 'marta@example.test', phone: '+34 600 000 000', status: 'active', createdAt: '2026-10-01T10:00:00Z' };
const sections = [
  ['summary', 'Resumen', 'Datos del perfil', 'available', 'ready'], ['reservations', 'Reservas', 'Calendario', 'available', 'not_connected'], ['payments', 'Pagos', 'Pagos', 'available', 'not_connected'],
  ['training', 'Entrenamiento', 'Entrenamiento en 2J Fitness App', 'available', 'not_connected'], ['progress', 'Progreso', 'Progreso en 2J Fitness App', 'available', 'not_connected'], ['health', 'Salud', 'Salud en 2J Fitness App', 'available', 'not_connected'],
  ['documents', 'Documentos/Formularios', 'Documentos y formularios', 'available', 'ready'], ['messages', 'Mensajes', 'Comunicación', 'available', 'not_connected'], ['followup','Seguimiento','Seguimiento','available','ready'], ['history', 'Historial', 'Historial del perfil', 'available', 'ready'],
].map(([id, label, sourceLabel, access, dataState]) => ({ id, label, sourceLabel, access, dataState }));
const summary = Object.fromEntries(['profile', 'plans', 'reservations', 'payments', 'training', 'progress', 'health', 'documents', 'messages'].map((id) => [id, { access: id === 'payments' ? 'forbidden' : 'available', dataState: id === 'profile' ? 'ready' : 'not_connected', data: null }]));
const profile = { client, capabilities: { manage: true }, summary, sections, history: [{ id: 'event-1', eventType: 'client.created', actorLabel: 'Administración', occurredAt: client.createdAt }] };
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const listResponse = (items = [client], overrides = {}) => ({ items, capabilities: { manage: true }, hasMore: false, nextCursor: null, ...overrides });

test('shows real clients, searches the server, and opens a 360 profile with clearly unconnected sections', async () => {
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).includes('/api/clients?')) return response(listResponse());
    if (String(url).endsWith(`/api/clients/${client.id}`)) return response(profile);
    throw new Error(`Unexpected request ${url}`);
  };
  render(React.createElement(ClientsPage));
  await screen.findByRole('button', { name: /Marta Santos/ });
  fireEvent.change(screen.getByLabelText('Buscar cliente'), { target: { value: 'marta' } });
  await waitFor(() => assert.ok(requests.some((url) => url.includes('q=marta'))), { timeout: 1500 });
  fireEvent.click(screen.getByRole('button', { name: /Marta Santos/ }));
  await screen.findByRole('heading', { name: 'Marta Santos' });
  for (const label of ['Resumen', 'Reservas', 'Pagos', 'Entrenamiento', 'Progreso', 'Salud', 'Documentos/Formularios', 'Mensajes', 'Historial']) assert.ok(screen.getByRole('tab', { name: new RegExp(label) }));
  assert.equal(screen.getAllByText('marta@example.test').length, 2);
  fireEvent.click(screen.getByRole('tab', { name: /Entrenamiento/ }));
  assert.ok(screen.getByText(/El entrenamiento mantiene su fuente de verdad en 2J Fitness App y El Búnker/));
  assert.equal(screen.queryByText(/rutina asignada/), null);
});

test('creates a client only when the server grants manage capability and refreshes its profile', async () => {
  const created = { ...client, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', firstName: 'Ada', lastName: 'Lovelace' };
  let list = [];
  let submitted;
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.endsWith('/api/clients') && options.method === 'POST') { submitted = JSON.parse(options.body); assert.match(options.headers['idempotency-key'], /^[0-9a-f-]{36}$/i); list = [created]; return response(created, 201); }
    if (path.includes('/api/clients?')) return response(listResponse(list));
    if (path.endsWith(`/api/clients/${created.id}`)) return response({ ...profile, client: created });
    throw new Error(`Unexpected request ${options.method ?? 'GET'} ${path}`);
  };
  render(React.createElement(ClientsPage));
  await screen.findByText('Aún no hay clientes');
  fireEvent.click(screen.getByRole('button', { name: /crear primer cliente/i }));
  const dialog = await screen.findByRole('dialog', { name: 'Nuevo cliente' });
  fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Ada' } });
  fireEvent.change(within(dialog).getByLabelText('Apellidos'), { target: { value: 'Lovelace' } });
  fireEvent.change(within(dialog).getByLabelText('Email (opcional)'), { target: { value: 'ada@example.test' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
  await screen.findByRole('heading', { name: 'Ada Lovelace' });
  assert.deepEqual(submitted, { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', phone: '', birthDate:null });
});

test('Admin client edit saves optional birth date through the protected profile endpoint', async () => {
  let saved;
  const profileWithDob={...profile,client:{...client,birthDate:'1990-04-06'}};
  globalThis.fetch=async(url,options={})=>{const path=String(url);if(path.includes('/api/clients?'))return response(listResponse());if(path.endsWith(`/api/clients/${client.id}`)&&options.method==='PATCH'){saved=JSON.parse(options.body);return response({...profileWithDob.client,...saved});}if(path.endsWith(`/api/clients/${client.id}`))return response(profileWithDob);throw new Error(`Unexpected ${options.method??'GET'} ${path}`);};
  render(React.createElement(ClientsPage));fireEvent.click(await screen.findByRole('button',{name:/Marta Santos/}));await screen.findByRole('heading',{name:'Marta Santos'});fireEvent.click(screen.getByRole('button',{name:'Editar datos'}));const dialog=await screen.findByRole('dialog',{name:'Editar datos del cliente'});assert.equal(within(dialog).getByLabelText('Fecha de nacimiento (opcional)').value,'1990-04-06');fireEvent.change(within(dialog).getByLabelText('Nombre'),{target:{value:'Marta'}});fireEvent.click(within(dialog).getByRole('button',{name:'Guardar cambios'}));await waitFor(()=>assert.ok(saved));assert.equal(saved.birthDate,'1990-04-06');
});

test('fails closed when the server has no authorized session', async () => {
  globalThis.fetch = async () => response({ error: 'authentication_required' }, 401);
  render(React.createElement(ClientsPage));
  await screen.findByText('Tu sesión no permite consultar los datos de clientes.');
  assert.equal(screen.queryByText(client.email), null);
  assert.equal(screen.queryByRole('button', { name: /nuevo cliente/i }), null);
});

test('Client 360 pauses an entitlement with reason and idempotency key, then refreshes its effective status', async () => {
  const assignment={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',planId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',planName:'Funcional 2 días',kind:'recurring',startsOn:'2026-10-01',endsOn:'2026-10-31',derivedStatus:'active',concept:'Funcional · Cuota',amountCents:4500,salePriceCents:4500,dueOn:'2026-10-01',rights:[{id:'right-1',rightType:'period_quota',serviceName:'La Sala',quantity:2,period:'week',quotaScope:'per_service'}],modules:[{module:'training',accessLevel:'limited',capabilities:['training.routines.read']}]};
  const taskProfile={...profile,capabilities:{manage:true,readEntitlements:true,pauseEntitlements:true,cancelEntitlements:true,adjustEntitlements:true,renewEntitlements:true,assignPlans:true,collectPayments:true},sections:[...sections,{id:'plans',label:'Cuotas',sourceLabel:'Planes asignados',access:'available',dataState:'ready'}],summary:{...summary,plans:{access:'available',dataState:'ready',data:[assignment]}}};
  let posted;
  globalThis.fetch=async(url,options={})=>{const path=String(url);if(path.includes('/api/clients?'))return response(listResponse());if(path.endsWith(`/api/clients/${client.id}`))return response(taskProfile);if(path.endsWith(`/api/clients/${client.id}/plans/${assignment.id}/pause`)&&options.method==='POST'){posted={body:JSON.parse(options.body),key:options.headers['idempotency-key']};return response({status:'paused'},201);}throw new Error(`Unexpected ${options.method??'GET'} ${path}`);};
  render(React.createElement(ClientsPage));fireEvent.click(await screen.findByRole('button',{name:/Marta Santos/}));await screen.findByRole('heading',{name:'Marta Santos'});fireEvent.click(screen.getByRole('tab',{name:'Cuotas'}));assert.ok(screen.getByRole('heading',{name:'Activas'}));assert.ok(screen.getByText('Entrenamiento: Limitado'));fireEvent.click(await screen.findByRole('button',{name:'Pausar'}));
  const dialog=await screen.findByRole('dialog',{name:'Pausar cuota'});fireEvent.change(within(dialog).getByLabelText('Motivo obligatorio'),{target:{value:'Pausa solicitada por cliente'}});fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar pausa'}));await screen.findByText('Cuota pausada.');assert.equal(posted.body.reason,'Pausa solicitada por cliente');assert.match(posted.key,/^[0-9a-f-]{36}$/i);
});

test('Reception can open a base-price sale while Trainer remains read-only', async () => {
  const plan = { id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',name:'Plan Sala',kind:'recurring',basePriceCents:3200,services:[{name:'La Sala'}],rights:[{rightType:'service_access',serviceName:'La Sala'}] };
  const receptionProfile={...profile,capabilities:{manage:false,readEntitlements:true,assignPlans:true,manageCatalogPrice:false,collectPayments:false,pauseEntitlements:true,cancelEntitlements:true,renewEntitlements:true,adjustEntitlements:false},sections:[...sections,{id:'plans',label:'Cuotas',sourceLabel:'Planes asignados',access:'available',dataState:'ready'}],summary:{...summary,plans:{access:'available',dataState:'ready',data:[]}}};
  globalThis.fetch=async(url)=>{const path=String(url);if(path.includes('/api/clients?'))return response(listResponse([client],{capabilities:{manage:false,assignPlans:true}}));if(path.endsWith(`/api/clients/${client.id}`))return response(receptionProfile);if(path.endsWith('/api/plans/assignable'))return response([plan]);throw new Error(`Unexpected request ${path}`);};
  render(React.createElement(ClientsPage));
  fireEvent.click(await screen.findByRole('button',{name:/Marta Santos/}));
  await screen.findByRole('heading',{name:'Marta Santos'});
  fireEvent.click(screen.getAllByRole('button',{name:'Añadir cuota'})[0]);
  const dialog=await screen.findByRole('dialog',{name:'Añadir cuota'});
  await screen.findByRole('option',{name:/Plan Sala/});
  const price=within(dialog).getByLabelText('Precio de venta (€)');
  assert.equal(price.readOnly,true);
  assert.equal(price.value,'32.00');
  assert.equal(within(dialog).queryByLabelText('Cobrar ahora el importe completo'),null,'the payment action is hidden without billing permission');
  cleanup();

  const trainerProfile={...receptionProfile,capabilities:{manage:false,readEntitlements:true,assignPlans:false,manageCatalogPrice:false,collectPayments:false,pauseEntitlements:false,cancelEntitlements:false,renewEntitlements:false,adjustEntitlements:false}};
  globalThis.fetch=async(url)=>String(url).includes('/api/clients?')?response(listResponse([client],{capabilities:{manage:false,assignPlans:false}})):String(url).endsWith(`/api/clients/${client.id}`)?response(trainerProfile):Promise.reject(new Error(`Unexpected request ${url}`));
  render(React.createElement(ClientsPage));
  fireEvent.click(await screen.findByRole('button',{name:/Marta Santos/}));
  await screen.findByRole('heading',{name:'Marta Santos'});
  assert.equal(screen.queryByRole('button',{name:'Añadir cuota'}),null);
});

test('client list exposes distinct loading, error and empty states with retry', async () => {
  const pending = [];
  globalThis.fetch = () => new Promise((resolve) => pending.push(resolve));
  render(React.createElement(ClientsPage));
  await screen.findByText('Cargando clientes…');
  pending[0](response({ error: 'internal_error' }, 500));
  await screen.findByText('No se pudo cargar la lista');
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await waitFor(() => assert.equal(pending.length, 2));
  pending[1](response(listResponse([])));
  await screen.findByText('Aún no hay clientes');
});

test('Documents shows real forms and consent, authorized PAR-Q review and assisted acceptance',async()=>{
  let reviewPayload,consentPayload;
  globalThis.fetch=async(url,options={})=>{const path=String(url);if(path.includes('/api/clients?'))return response(listResponse());if(path.endsWith(`/api/clients/${client.id}`))return response(profile);if(path.endsWith(`/api/clients/${client.id}/forms`))return response([{id:'assignment-1',formId:'form-1',name:'PAR-Q',category:'par_q',status:'review_required',version:1,assignedAt:client.createdAt,dueAt:null,answers:{question:'yes'},canReview:true,sensitiveReadable:true,reviews:[]}]);if(path.endsWith(`/api/clients/${client.id}/consents`))return response([{consentId:'consent-1',versionId:'version-1',name:'Actividad física',version:2,title:'Consentimiento',body:'Texto vigente',accepted:false,canAcceptAssisted:true}]);if(path.endsWith('/forms/form-1/review')){reviewPayload=JSON.parse(options.body);return response({status:'approved'});}if(path.endsWith('/consents/version-1/accept-assisted')){consentPayload=JSON.parse(options.body);return response({acceptedAt:client.createdAt});}throw new Error(`Unexpected ${options.method??'GET'} ${path}`);};
  render(React.createElement(ClientsPage));fireEvent.click(await screen.findByRole('button',{name:/Marta Santos/}));await screen.findByRole('heading',{name:'Marta Santos'});fireEvent.click(screen.getByRole('tab',{name:/Documentos/}));
  await screen.findByText('PAR-Q');assert.ok(screen.getByText('Ver respuestas'));fireEvent.change(screen.getByLabelText('Nota de revisión'),{target:{value:'Revisión administrativa'}});fireEvent.click(screen.getByRole('button',{name:'Aprobar revisión'}));await waitFor(()=>assert.equal(reviewPayload.decision,'approved'));
  fireEvent.click(screen.getByRole('button',{name:'Registrar consentimiento asistido'}));fireEvent.click(screen.getByLabelText(/Confirmo que el cliente/));fireEvent.click(screen.getByRole('button',{name:'Registrar aceptación'}));await waitFor(()=>assert.equal(consentPayload.accepted,true));assert.equal(consentPayload.typedName,'Marta Santos');
});

test('Follow-up displays assigned check-ins and actual status',async()=>{
  globalThis.fetch=async(url)=>{const path=String(url);if(path.includes('/api/clients?'))return response(listResponse());if(path.endsWith(`/api/clients/${client.id}`))return response(profile);if(path.endsWith(`/api/clients/${client.id}/followup`))return response([{id:'checkin-1',name:'Check-in semanal',status:'assigned',version:3,assignedAt:client.createdAt,dueAt:'2026-10-03T10:00:00Z',answers:null,submittedAt:null}]);throw new Error(`Unexpected ${path}`);};
  render(React.createElement(ClientsPage));fireEvent.click(await screen.findByRole('button',{name:/Marta Santos/}));await screen.findByRole('heading',{name:'Marta Santos'});fireEvent.click(screen.getByRole('tab',{name:/Seguimiento/}));await screen.findByText('Check-in semanal');assert.ok(screen.getByText(/Vencido/));
});

test('create dialog focuses its first field, traps keyboard focus, and restores its opener', async () => {
  globalThis.fetch = async () => response(listResponse([]));
  render(React.createElement(ClientsPage));
  await screen.findByText('Aún no hay clientes');
  const opener = screen.getByRole('button', { name: /crear primer cliente/i });
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByRole('dialog', { name: 'Nuevo cliente' });
  const firstName = within(dialog).getByLabelText('Nombre');
  assert.equal(document.activeElement, firstName);
  const close = within(dialog).getByRole('button', { name: 'Cerrar diálogo' });
  close.focus();
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  assert.equal(document.activeElement, within(dialog).getByRole('button', { name: 'Guardar' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  assert.equal(document.activeElement, opener);
});

test('Guardar y añadir cuota creates the client, assigns the active plan and records an immediate charge payment',async()=>{
  const assigned={id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',planName:'Fuerza 3 días',kind:'recurring',startsOn:'2026-10-09',endsOn:null,derivedStatus:'active',concept:'Fuerza 3 días · Cuota',amountCents:5900,dueOn:'2026-10-09',rights:[{rightType:'sessions_quota',serviceName:'Fuerza',quantity:12,period:null,quotaScope:'shared'}]};
  const plan={id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',name:'Fuerza 3 días',kind:'recurring',renewalCadence:'monthly',periodDays:null,basePriceCents:5900,services:[{id:'service-1',name:'Fuerza',area:'Sala'}],rights:[{rightType:'sessions_quota',serviceName:'Fuerza',quantity:12,period:null,quotaScope:'shared'}]};
  const created={...client,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',firstName:'Ada',lastName:'Lovelace'};
  const saleProfile={...profile,client:created,capabilities:{manage:true,assignPlans:true,manageCatalogPrice:true,collectPayments:true},sections:[...sections,{id:'plans',label:'Cuotas',sourceLabel:'Planes asignados',access:'available',dataState:'ready'}],summary:{...summary,plans:{access:'available',dataState:'ready',data:[]}}};
  const requests=[];let assignmentPayload;let assignmentKey;
  globalThis.fetch=async(url,options={})=>{
    const path=String(url);requests.push({path,method:options.method??'GET'});
    if(path.endsWith('/api/clients')&&options.method==='POST')return response(created,201);
    if(path.includes('/api/clients?'))return response(listResponse([], {capabilities:{manage:true,assignPlans:true}}));
    if(path.endsWith(`/api/clients/${created.id}`))return response({...saleProfile,summary:{...saleProfile.summary,plans:{access:'available',dataState:'ready',data:requests.some(item=>item.path.endsWith('/plans')&&item.method==='POST')?[assigned]:[]}}});
    if(path.endsWith('/api/plans/assignable'))return response([plan]);
    if(path.endsWith(`/api/clients/${created.id}/plans`)&&options.method==='POST'){assignmentPayload=JSON.parse(options.body);assignmentKey=options.headers['idempotency-key'];return response({id:assigned.id,chargeId:'charge-1',paymentId:'payment-1'},201);}
    throw new Error(`Unexpected ${options.method??'GET'} ${path}`);
  };
  render(React.createElement(ClientsPage));await screen.findByText('Aún no hay clientes');fireEvent.click(screen.getByRole('button',{name:/crear primer cliente/i}));
  const createDialog=await screen.findByRole('dialog',{name:'Nuevo cliente'});fireEvent.change(within(createDialog).getByLabelText('Nombre'),{target:{value:'Ada'}});fireEvent.change(within(createDialog).getByLabelText('Apellidos'),{target:{value:'Lovelace'}});fireEvent.click(within(createDialog).getByRole('button',{name:'Guardar y añadir cuota'}));
  const planDialog=await screen.findByRole('dialog',{name:'Añadir cuota'});await waitFor(()=>assert.ok(planDialog.querySelector('select')));
  fireEvent.change(within(planDialog).getByLabelText('Producto o plan'),{target:{value:plan.id}});fireEvent.change(within(planDialog).getByLabelText('Precio de venta (€)'),{target:{value:'59,00'}});fireEvent.click(within(planDialog).getByLabelText('Cobrar ahora el importe completo'));
  fireEvent.click(within(planDialog).getByRole('button',{name:'Asignar y cobrar'}));
  await screen.findByText('Cuota asignada y cobro registrado.');
  assert.equal(assignmentPayload.amountCents,5900);assert.equal(assignmentPayload.paymentAmountCents,5900);assert.equal(assignmentPayload.paymentMethod,'card');assert.equal(assignmentPayload.planId,plan.id);
  assert.match(assignmentKey,/^[0-9a-f-]{36}$/i);
  assert.ok(requests.some(item=>item.path.endsWith('/api/clients')&&item.method==='POST'));
  await screen.findByText('Fuerza 3 días');
  await waitFor(()=>assert.equal(screen.getByRole('tab',{name:'Cuotas'}).getAttribute('aria-selected'),'true'));
});

test('plan sale retries reuse one key after a lost response, while success and cancel start fresh operations',async()=>{
  const plan={id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',name:'Fuerza 3 días',kind:'recurring',renewalCadence:'monthly',periodDays:null,services:[],rights:[]};
  const saleProfile={...profile,capabilities:{manage:true,assignPlans:true,manageCatalogPrice:true,collectPayments:true},sections:[...sections,{id:'plans',label:'Cuotas',sourceLabel:'Planes asignados',access:'available',dataState:'ready'}]};
  const saleRequests=[];let loseFirstResponse=true;
  globalThis.fetch=async(url,options={})=>{
    const path=String(url);
    if(path.includes('/api/clients?'))return response(listResponse());
    if(path.endsWith(`/api/clients/${client.id}`))return response(saleProfile);
    if(path.endsWith('/api/plans/assignable'))return response([plan]);
    if(path.endsWith(`/api/clients/${client.id}/plans`)&&options.method==='POST'){
      saleRequests.push({key:options.headers['idempotency-key'],payload:options.body});
      if(loseFirstResponse){loseFirstResponse=false;throw new Error('connection reset after server commit');}
      return response({id:`assignment-${saleRequests.length}`,chargeId:`charge-${saleRequests.length}`,paymentId:null},201);
    }
    throw new Error(`Unexpected ${options.method??'GET'} ${path}`);
  };
  render(React.createElement(ClientsPage));
  fireEvent.click(await screen.findByRole('button',{name:/Marta Santos/}));
  await screen.findByRole('heading',{name:'Marta Santos'});
  fireEvent.click((await screen.findAllByRole('button',{name:'Añadir cuota'}))[0]);
  let dialog=await screen.findByRole('dialog',{name:'Añadir cuota'});
  await waitFor(()=>assert.ok(within(dialog).getByLabelText('Producto o plan')));
  fireEvent.change(within(dialog).getByLabelText('Producto o plan'),{target:{value:plan.id}});
  fireEvent.change(within(dialog).getByLabelText('Precio de venta (€)'),{target:{value:'59,00'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Asignar y dejar pendiente'}));
  await screen.findByRole('alert');
  fireEvent.click(within(dialog).getByRole('button',{name:'Asignar y dejar pendiente'}));
  await screen.findByText('Cuota asignada; el cargo queda pendiente.');
  assert.equal(saleRequests.length,2);
  assert.equal(saleRequests[0].key,saleRequests[1].key,'a retry after a lost response must reuse the operation key');
  assert.equal(saleRequests[0].payload,saleRequests[1].payload);

  await screen.findByRole('tab',{name:'Cuotas'});
  fireEvent.click((await screen.findAllByRole('button',{name:'Añadir cuota'}))[0]);
  dialog=await screen.findByRole('dialog',{name:'Añadir cuota'});
  await waitFor(()=>assert.ok(within(dialog).getByLabelText('Producto o plan')));
  fireEvent.change(within(dialog).getByLabelText('Producto o plan'),{target:{value:plan.id}});
  fireEvent.change(within(dialog).getByLabelText('Precio de venta (€)'),{target:{value:'59,00'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Asignar y dejar pendiente'}));
  await screen.findByText('Cuota asignada; el cargo queda pendiente.');
  assert.notEqual(saleRequests[2].key,saleRequests[1].key,'the next sale after success must have a fresh key');

  await screen.findByRole('tab',{name:'Cuotas'});
  fireEvent.click((await screen.findAllByRole('button',{name:'Añadir cuota'}))[0]);
  dialog=await screen.findByRole('dialog',{name:'Añadir cuota'});
  fireEvent.click(within(dialog).getByRole('button',{name:'Cancelar'}));
  fireEvent.click((await screen.findAllByRole('button',{name:'Añadir cuota'}))[0]);
  dialog=await screen.findByRole('dialog',{name:'Añadir cuota'});
  await waitFor(()=>assert.ok(within(dialog).getByLabelText('Producto o plan')));
  fireEvent.change(within(dialog).getByLabelText('Producto o plan'),{target:{value:plan.id}});
  fireEvent.change(within(dialog).getByLabelText('Precio de venta (€)'),{target:{value:'59,00'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Asignar y dejar pendiente'}));
  await screen.findByText('Cuota asignada; el cargo queda pendiente.');
  assert.notEqual(saleRequests[3].key,saleRequests[2].key,'cancel/reset must discard the prior key');
});

test('changing a failed sale payload rotates its idempotency key',async()=>{
  const plan={id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',name:'Fuerza 3 días',kind:'recurring',renewalCadence:'monthly',periodDays:null,services:[],rights:[]};
  const saleProfile={...profile,capabilities:{manage:true,assignPlans:true,manageCatalogPrice:true,collectPayments:true}};
  const saleRequests=[];let first=true;
  globalThis.fetch=async(url,options={})=>{
    const path=String(url);
    if(path.includes('/api/clients?'))return response(listResponse());
    if(path.endsWith(`/api/clients/${client.id}`))return response(saleProfile);
    if(path.endsWith('/api/plans/assignable'))return response([plan]);
    if(path.endsWith(`/api/clients/${client.id}/plans`)&&options.method==='POST'){
      saleRequests.push({key:options.headers['idempotency-key'],payload:JSON.parse(options.body)});
      if(first){first=false;return response({error:'temporary_failure'},503);}
      return response({id:'assignment-1',chargeId:'charge-1',paymentId:null},201);
    }
    throw new Error(`Unexpected ${options.method??'GET'} ${path}`);
  };
  render(React.createElement(ClientsPage));
  fireEvent.click(await screen.findByRole('button',{name:/Marta Santos/}));
  await screen.findByRole('heading',{name:'Marta Santos'});
  fireEvent.click(screen.getAllByRole('button',{name:'Añadir cuota'})[0]);
  const dialog=await screen.findByRole('dialog',{name:'Añadir cuota'});
  await waitFor(()=>assert.ok(within(dialog).getByLabelText('Producto o plan')));
  fireEvent.change(within(dialog).getByLabelText('Producto o plan'),{target:{value:plan.id}});
  fireEvent.change(within(dialog).getByLabelText('Precio de venta (€)'),{target:{value:'59,00'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Asignar y dejar pendiente'}));
  await screen.findByRole('alert');
  fireEvent.change(within(dialog).getByLabelText('Precio de venta (€)'),{target:{value:'69,00'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Asignar y dejar pendiente'}));
  await screen.findByText('Cuota asignada; el cargo queda pendiente.');
  assert.notEqual(saleRequests[0].key,saleRequests[1].key,'material payload edits are a new logical operation');
  assert.equal(saleRequests[1].payload.amountCents,6900);
});

test('search waits for typing to pause before querying and keeps current results during debounce', async () => {
  const requests = [];
  globalThis.fetch = async (url) => { requests.push(String(url)); return response(listResponse()); };
  render(React.createElement(ClientsPage));
  await screen.findByRole('button', { name: /Marta Santos/ });
  fireEvent.change(screen.getByLabelText('Buscar cliente'), { target: { value: 'm' } });
  fireEvent.change(screen.getByLabelText('Buscar cliente'), { target: { value: 'ma' } });
  fireEvent.change(screen.getByLabelText('Buscar cliente'), { target: { value: 'mar' } });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(requests.filter((url) => url.includes('q=')).length, 0);
  assert.ok(screen.getByRole('button', { name: /Marta Santos/ }));
  await waitFor(() => assert.equal(requests.filter((url) => url.includes('q=')).length, 1), { timeout: 1200 });
  assert.ok(requests.at(-1).includes('q=mar'));
});

test('loads additional client pages and announces when more results remain', async () => {
  const firstPage = Array.from({ length: 50 }, (_, index) => ({ ...client, id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`, firstName: `Cliente ${index}` }));
  const lastPage = { ...client, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', firstName: 'Cliente 51' };
  let page = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/clients?')) return page++ === 0 ? response(listResponse(firstPage, { hasMore: true, nextCursor: 'next-page' })) : response(listResponse([lastPage]));
    if (String(url).endsWith(`/api/clients/${lastPage.id}`)) return response({ ...profile, client: lastPage });
    throw new Error(`Unexpected request ${url}`);
  };
  render(React.createElement(ClientsPage));
  await screen.findByRole('button', { name: /Cliente 0/ });
  assert.ok(screen.getByText(/Hay más resultados disponibles/));
  fireEvent.click(screen.getByRole('button', { name: 'Cargar más clientes' }));
  await screen.findByRole('button', { name: /Cliente 51/ });
  assert.equal(screen.getAllByRole('listitem').length, 51);
});

test('selecting a client scrolls and focuses its detail on tablet layouts', async () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 768 });
  let scrolled = false;
  HTMLElement.prototype.scrollIntoView = function scrollIntoView() { scrolled = true; };
  globalThis.fetch = async (url) => String(url).includes('/api/clients?') ? response(listResponse()) : response(profile);
  render(React.createElement(ClientsPage));
  fireEvent.click(await screen.findByRole('button', { name: /Marta Santos/ }));
  const heading = await screen.findByRole('heading', { name: 'Marta Santos' });
  await waitFor(() => assert.equal(scrolled, true));
  assert.equal(document.activeElement, heading);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

test('profile tabs support arrow keys, Home/End, roving focus, and explain denied sections', async () => {
  const restrictedSections = sections.map((section) => section.id === 'payments' ? { ...section, access: 'forbidden' } : section);
  globalThis.fetch = async (url) => String(url).includes('/api/clients?') ? response(listResponse()) : response({ ...profile, sections: restrictedSections });
  render(React.createElement(ClientsPage));
  fireEvent.click(await screen.findByRole('button', { name: /Marta Santos/ }));
  await screen.findByRole('heading', { name: 'Marta Santos' });
  const selected = screen.getByRole('tab', { name: 'Resumen' });
  selected.focus();
  fireEvent.keyDown(selected, { key: 'End' });
  const history = screen.getByRole('tab', { name: 'Historial' });
  assert.equal(document.activeElement, history);
  assert.equal(history.tabIndex, 0);
  fireEvent.keyDown(history, { key: 'Home' });
  assert.equal(document.activeElement, selected);
  fireEvent.click(screen.getByRole('tab', { name: /Pagos/ }));
  assert.ok(screen.getByText('Esta sección requiere otro permiso'));
  assert.equal(screen.queryByText(/billing\.read-basic|source:/i), null);
});

test('archive requires confirmation, prevents duplicate submits, reports success and preserves the profile', async () => {
  let finishArchive;
  let listStatus = 'active';
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes('/api/clients?')) { listStatus = new URL(path).searchParams.get('status'); return response(listResponse([{ ...client, status: listStatus }])); }
    if (path.endsWith(`/api/clients/${client.id}/archive`)) return new Promise((resolve) => { finishArchive = () => resolve(response({ ...client, status: 'archived' })); });
    if (path.endsWith(`/api/clients/${client.id}`)) return response(profile);
    throw new Error(`Unexpected request ${path}`);
  };
  render(React.createElement(ClientsPage));
  fireEvent.click(await screen.findByRole('button', { name: /Marta Santos/ }));
  await screen.findByRole('heading', { name: 'Marta Santos' });
  fireEvent.click(screen.getByRole('button', { name: 'Archivar' }));
  const dialog = await screen.findByRole('alertdialog', { name: '¿Archivar este cliente?' });
  assert.ok(within(dialog).getByText(/perfil y su historial se conservarán/i));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Archivar cliente' }));
  assert.equal(within(dialog).getByRole('button', { name: 'Archivando…' }).disabled, true);
  finishArchive();
  await screen.findByText('Perfil archivado. Se conservarán sus datos y su historial.');
  await waitFor(() => assert.equal(listStatus, 'archived'));
  assert.ok(screen.getAllByText('Archivado').length >= 1);
});

test('profile detail errors can be retried', async () => {
  let attempts = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/clients?')) return response(listResponse());
    attempts += 1;
    return attempts === 1 ? response({ error: 'internal_error' }, 500) : response(profile);
  };
  render(React.createElement(ClientsPage));
  fireEvent.click(await screen.findByRole('button', { name: /Marta Santos/ }));
  await screen.findByRole('button', { name: 'Reintentar ficha' });
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar ficha' }));
  await screen.findByRole('heading', { name: 'Marta Santos' });
  assert.equal(attempts, 2);
});
