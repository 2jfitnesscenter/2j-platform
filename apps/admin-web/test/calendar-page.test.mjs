import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5173/#calendar' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { CalendarPage } = await import('../src/calendar-page.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; });
after(() => dom.window.close());

const area = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'La Sala' };
const service = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Fuerza 2J', areaId: area.id };
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const now = new Date(); const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate()); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
const key = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const baseData = { weekStart: key(monday), sessions: [], areas: [area], services: [service], templates: [], capabilities: { manage: true, attendance: true, overrideCapacity: false, overrideAvailability: true, overrideDocuments: false } };

test('renders weekly loading and empty states, then allows stepping weeks', async () => {
  const requested = [];
  globalThis.fetch = async (url) => { requested.push(String(url)); await new Promise((resolve) => setTimeout(resolve, 10)); return response(baseData); };
  render(React.createElement(CalendarPage));
  assert.ok(screen.getByRole('status'));
  await screen.findByText('Esta semana aún no tiene sesiones');
  fireEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));
  await waitFor(() => assert.ok(requested.length >= 2));
  assert.equal((await screen.findAllByText('Sin sesiones')).length, 7);
});

test('creates a real staff session using the selected 2J service and capacity', async () => {
  let session = null; let posted = null;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/api/calendar/week')) return response({ ...baseData, sessions: session ? [{ ...session, occupiedCount: 0, waitlistCount: 0 }] : [] });
    if (String(url).endsWith('/api/calendar/sessions') && options.method === 'POST') { posted = JSON.parse(options.body); session = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', serviceId: service.id, serviceName: service.name, areaId: area.id, areaName: area.name, templateId: null, source: 'manual', startsAt: posted.startsAt, durationMinutes: posted.durationMinutes, capacity: posted.capacity, status: 'scheduled', isIndividual: false }; return response(session, 201); }
    throw new Error(`Unexpected request: ${options.method ?? 'GET'} ${url}`);
  };
  render(React.createElement(CalendarPage));
  await screen.findByText('Esta semana aún no tiene sesiones');
  fireEvent.click(screen.getByRole('button', { name: 'Nueva sesión' }));
  const dialog = await screen.findByRole('dialog', { name: 'Nueva sesión' });
  fireEvent.change(within(dialog).getByLabelText('Servicio'), { target: { value: service.id } });
  fireEvent.change(within(dialog).getByLabelText('Capacidad'), { target: { value: '8' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear sesión' }));
  await screen.findByRole('button', { name: /Fuerza 2J/ });
  assert.equal(posted.serviceId, service.id);
  assert.equal(posted.areaId, area.id);
  assert.equal(posted.capacity, 8);
  assert.equal(session.source, 'manual');
});

test('recurring template automatically appears as a concrete session and no manual generation control is offered', async () => {
  let templateSaved = false;
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes('/api/calendar/week')) return response({ ...baseData, templates: templateSaved ? [{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', serviceId: service.id, serviceName: service.name, areaId: area.id, areaName: area.name, weekday: 1, localStartTime: '09:30', durationMinutes: 45, capacity: 8, startsOn: baseData.weekStart, endsOn: null, professionalId: null, professionalName: null }] : [], sessions: templateSaved ? [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', serviceId: service.id, serviceName: service.name, areaId: area.id, areaName: area.name, templateId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', source: 'template', startsAt: `${baseData.weekStart}T09:30:00Z`, durationMinutes: 45, capacity: 8, status: 'scheduled', isIndividual: false, occupiedCount: 0, waitlistCount: 0 }] : [] });
    if (path.endsWith('/api/calendar/templates') && options.method === 'POST') { templateSaved = true; return response({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', status: 'active', materializedCount: 12 }, 201); }
    throw new Error(`Unexpected request: ${options.method ?? 'GET'} ${url}`);
  };
  render(React.createElement(CalendarPage));
  await screen.findByText('Esta semana aún no tiene sesiones');
  fireEvent.click(screen.getByRole('button', { name: 'Nueva plantilla' }));
  const dialog = await screen.findByRole('dialog', { name: 'Nueva plantilla recurrente' });
  fireEvent.change(within(dialog).getByLabelText('Servicio'), { target: { value: service.id } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar plantilla' }));
  assert.equal(templateSaved, true);
  await screen.findByText(/Plantilla guardada/);
  assert.equal(screen.queryByRole('button', { name: /Generar fecha/ }), null);
  await screen.findByRole('button', { name: /Fuerza 2J/ });
  assert.ok(screen.getByText(/Sesiones concretas generadas automáticamente/));
});

test('bulk schedule previews and submits a three-day by three-block matrix once', async () => {
  let posted = null;
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes('/api/calendar/week')) return response(baseData);
    if (path.endsWith('/api/calendar/templates/batch') && options.method === 'POST') { posted = JSON.parse(options.body); return response({ templates: Array.from({ length: 9 }, (_, index) => ({ id: `template-${index}`, status: 'active' })) }, 201); }
    throw new Error(`Unexpected request: ${options.method ?? 'GET'} ${path}`);
  };
  render(React.createElement(CalendarPage));
  await screen.findByText('Esta semana aún no tiene sesiones');
  fireEvent.click(screen.getByRole('button', { name: 'Configurar horarios' }));
  const dialog = await screen.findByRole('dialog', { name: 'Configurar horarios' });
  fireEvent.change(within(dialog).getByLabelText('Servicio'), { target: { value: service.id } });
  assert.match(within(dialog).getByText('Se crearán 9 plantillas').textContent, /9/);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear horarios' }));
  await screen.findByText(/9 horarios creados/);
  assert.deepEqual(posted.weekdays.sort(), [1, 3, 5]);
  assert.deepEqual(posted.blocks.map((block) => block.localStartTime), ['07:00', '08:00', '09:00']);
  assert.equal(posted.serviceId, service.id);
});

test('recurring occurrence editor clearly limits changes to one date and submits its override', async () => {
  let patchPayload = null;
  const session = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', serviceId: service.id, serviceName: service.name, areaId: area.id, areaName: area.name, templateId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', source: 'template', startsAt: `${baseData.weekStart}T09:30:00Z`, durationMinutes: 45, capacity: 8, status: 'scheduled', isIndividual: false, occupiedCount: 1, waitlistCount: 0, overbookCount: 0, professionalId: null, professionalName: null };
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes('/api/calendar/week')) return response({ ...baseData, sessions: [session] });
    if (path.endsWith(`/api/calendar/sessions/${session.id}/attendees`)) return response({ reservations: [], waitlist: [] });
    if (path.endsWith(`/api/calendar/sessions/${session.id}`) && options.method === 'PATCH') { patchPayload = JSON.parse(options.body); return response({ ...session, ...patchPayload, occurrenceOverridden: true }); }
    throw new Error(`Unexpected request: ${options.method ?? 'GET'} ${path}`);
  };
  render(React.createElement(CalendarPage));
  const card = await screen.findByRole('button', { name: /Fuerza 2J/ }); fireEvent.click(card);
  const detail = await screen.findByRole('dialog', { name: service.name });
  fireEvent.click(within(detail).getByRole('button', { name: 'Editar esta sesión' }));
  assert.match(within(detail).getByText(/Solo cambia esta fecha/).textContent, /plantilla y las demás/);
  fireEvent.change(within(detail).getByLabelText('Capacidad'), { target: { value: '9' } });
  fireEvent.click(within(detail).getByRole('button', { name: 'Guardar solo esta sesión' }));
  await screen.findByText(/La plantilla y las demás fechas no han cambiado/);
  assert.equal(patchPayload.capacity, 9);
  assert.equal(session.capacity, 8);
});

test('occurrence edit requires explicit availability confirmation and reason after warning', async () => {
  let patchPayload = null; let patchCount = 0;
  const session = { id: 'abababab-abab-4bab-8bab-abababababab', serviceId: service.id, serviceName: service.name, areaId: area.id, areaName: area.name, templateId: 'acacacac-acac-4cac-8cac-acacacacacac', source: 'template', startsAt: `${baseData.weekStart}T09:30:00Z`, durationMinutes: 45, capacity: 8, status: 'scheduled', isIndividual: false, occupiedCount: 1, waitlistCount: 0, overbookCount: 0, professionalId: 'adadadad-adad-4dad-8dad-adadadadadad', professionalName: 'Alex Rivera' };
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes('/api/calendar/week')) return response({ ...baseData, sessions: [session] });
    if (path.endsWith(`/api/calendar/sessions/${session.id}/attendees`)) return response({ reservations: [], waitlist: [] });
    if (path.endsWith(`/api/calendar/sessions/${session.id}`) && options.method === 'PATCH') {
      patchCount += 1; patchPayload = JSON.parse(options.body);
      return patchCount === 1 ? response({ error: 'professional_availability_confirmation_required', warnings: ['outside_working_hours'] }, 409) : response({ ...session, ...patchPayload, occurrenceOverridden: true });
    }
    throw new Error(`Unexpected request: ${options.method ?? 'GET'} ${path}`);
  };
  render(React.createElement(CalendarPage));
  fireEvent.click(await screen.findByRole('button', { name: /Fuerza 2J/ }));
  const detail = await screen.findByRole('dialog', { name: service.name });
  fireEvent.click(within(detail).getByRole('button', { name: 'Editar esta sesión' }));
  fireEvent.click(within(detail).getByRole('button', { name: 'Guardar solo esta sesión' }));
  await within(detail).findByText('Este cambio queda fuera del horario habitual del profesional.');
  assert.equal(within(detail).getByRole('button', { name: 'Guardar solo esta sesión' }).disabled, true);
  fireEvent.click(within(detail).getByRole('checkbox', { name: 'Confirmar excepción para esta sesión' }));
  fireEvent.change(within(detail).getByLabelText('Motivo obligatorio'), { target: { value: 'Cambio solicitado por el centro' } });
  fireEvent.click(within(detail).getByRole('button', { name: 'Guardar solo esta sesión' }));
  await screen.findByText(/La plantilla y las demás fechas no han cambiado/);
  assert.equal(patchCount, 2);
  assert.equal(patchPayload.overrideAvailability, true);
  assert.equal(patchPayload.availabilityReason, 'Cambio solicitado por el centro');
});

test('individual session requires a selected client and hides group capacity', async () => {
  let posted = null;
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes('/api/calendar/week')) return response(baseData);
    if (path.includes('/api/clients?')) return response({ items: [{ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', firstName: 'Lucía', lastName: 'Martín' }] });
    if (path.endsWith('/api/calendar/sessions') && options.method === 'POST') { posted = JSON.parse(options.body); return response({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, 201); }
    throw new Error(`Unexpected request: ${options.method ?? 'GET'} ${url}`);
  };
  render(React.createElement(CalendarPage));
  await screen.findByText('Esta semana aún no tiene sesiones');
  fireEvent.click(screen.getByRole('button', { name: 'Nueva sesión' }));
  const dialog = await screen.findByRole('dialog', { name: 'Nueva sesión' });
  fireEvent.change(within(dialog).getByLabelText('Servicio'), { target: { value: service.id } });
  const search = within(dialog).getByRole('combobox', { name: 'Cliente individual (opcional)' });
  fireEvent.change(search, { target: { value: 'Lucía' } });
  await within(dialog).findByRole('option', { name: 'Lucía Martín' });
  assert.equal(within(dialog).queryByLabelText('Capacidad'), null);
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.keyDown(search, { key: 'Enter' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear sesión' }));
  await waitFor(() => assert.ok(posted));
  assert.equal(posted.capacity, 1);
  assert.equal(posted.individualClientId, 'ffffffff-ffff-4fff-8fff-ffffffffffff');
});

test('weekly individual marker labels card and detail without returning client PII', async () => {
  const session = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', serviceId: service.id, serviceName: service.name, areaId: area.id, areaName: area.name, templateId: null, source: 'manual', startsAt: `${key(monday)}T18:00:00.000Z`, durationMinutes: 60, capacity: 1, status: 'scheduled', isIndividual: true, occupiedCount: 1, overbookCount: 0, waitlistCount: 0 };
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes('/api/calendar/week')) return response({ ...baseData, sessions: [session] });
    if (path.endsWith(`/api/calendar/sessions/${session.id}/attendees`)) return response({ reservations: [], waitlist: [] });
    throw new Error(`Unexpected request: ${path}`);
  };
  render(React.createElement(CalendarPage));
  const card = await screen.findByRole('button', { name: /cita individual/i });
  assert.equal(within(card).getByText('Cita individual').textContent, 'Cita individual');
  fireEvent.click(card);
  assert.equal((await screen.findByText('CITA INDIVIDUAL · Sesión puntual')).textContent, 'CITA INDIVIDUAL · Sesión puntual');
});

test('reopen reservation is only offered after attendance or no-show', async () => {
  const session = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', serviceId: service.id, serviceName: service.name, areaId: area.id, areaName: area.name, templateId: null, source: 'manual', startsAt: `${key(monday)}T18:00:00.000Z`, durationMinutes: 60, capacity: 1, status: 'scheduled', isIndividual: false, occupiedCount: 1, overbookCount: 0, waitlistCount: 0 };
  const roster = { reservations: [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', clientId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', firstName: 'Lucía', lastName: 'Martín', status: 'reserved' }], waitlist: [] };
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes('/api/calendar/week')) return response({ ...baseData, sessions: [session] });
    if (path.endsWith(`/api/calendar/sessions/${session.id}/attendees`)) return response(roster);
    if (path.endsWith(`/api/calendar/reservations/${roster.reservations[0].id}/attendance`)) { roster.reservations[0].status = JSON.parse(options.body).status; return response({ status: roster.reservations[0].status }); }
    throw new Error(`Unexpected request: ${options.method ?? 'GET'} ${path}`);
  };
  render(React.createElement(CalendarPage));
  fireEvent.click(await screen.findByRole('button', { name: /Fuerza 2J/ }));
  await screen.findByText('Lucía Martín');
  assert.equal(screen.queryByRole('button', { name: 'Reabrir reserva' }), null);
  fireEvent.click(screen.getByRole('button', { name: 'Asistió' }));
  assert.ok(await screen.findByRole('button', { name: 'Reabrir reserva' }));
});

test('session cancellation uses an in-app confirmation dialog', async () => {
  const session = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', serviceId: service.id, serviceName: service.name, areaId: area.id, areaName: area.name, templateId: null, source: 'manual', startsAt: `${key(monday)}T18:00:00.000Z`, durationMinutes: 60, capacity: 2, status: 'scheduled', isIndividual: false, occupiedCount: 0, overbookCount: 0, waitlistCount: 0 };
  let cancelled = false;
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes('/api/calendar/week')) return response({ ...baseData, sessions: [session] });
    if (path.endsWith(`/api/calendar/sessions/${session.id}/attendees`)) return response({ reservations: [], waitlist: [] });
    if (path.endsWith(`/api/calendar/sessions/${session.id}/cancel`) && options.method === 'PATCH') { cancelled = true; return response({ id: session.id }, 200); }
    throw new Error(`Unexpected request: ${options.method ?? 'GET'} ${url}`);
  };
  render(React.createElement(CalendarPage));
  fireEvent.click(await screen.findByRole('button', { name: /Fuerza 2J/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Cancelar sesión' }));
  const confirm = await screen.findByRole('alertdialog', { name: 'Cancelar sesión' });
  assert.equal(cancelled, false);
  fireEvent.click(within(confirm).getByRole('button', { name: 'Cancelar sesión' }));
  await waitFor(() => assert.equal(cancelled, true));
});

test('booking cancellation and capacity override require in-app 2J confirmations', async () => {
  const session = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', serviceId: service.id, serviceName: service.name, areaId: area.id, areaName: area.name, templateId: null, source: 'manual', startsAt: `${key(monday)}T18:00:00.000Z`, durationMinutes: 60, capacity: 1, status: 'scheduled', isIndividual: false, occupiedCount: 1, overbookCount: 0, waitlistCount: 0 };
  let cancelled = false; let overbooked = false;
  const roster = { reservations: [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', clientId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', firstName: 'Lucía', lastName: 'Martín', status: 'reserved' }], waitlist: [] };
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes('/api/calendar/week')) return response({ ...baseData, sessions: [session], capabilities: { manage: true, attendance: true, overrideCapacity: true } });
    if (path.endsWith(`/api/calendar/sessions/${session.id}/attendees`)) return response(roster);
    if (path.includes(`/api/calendar/sessions/${session.id}/booking-eligibility`)) return response({allowed:false,decision:'waitlist_only',blockingReasons:['session_full'],selectedEntitlement:{assignmentId:'11111111-1111-4111-8111-111111111111',planId:'22222222-2222-4222-8222-222222222222',planName:'Bono',availableBalance:2,periodUsage:[],validUntil:null},availableAlternatives:[{assignmentId:'11111111-1111-4111-8111-111111111111',planId:'22222222-2222-4222-8222-222222222222',planName:'Bono',availableBalance:2,periodUsage:[],validUntil:null}],capacity:{occupied:1,limit:1,available:0},waitlistAllowed:true,overridePossible:{debt:false,documents:false,capacity:true},requiredDocuments:[]});
    if (path.includes('/api/clients?q=')) return response({ items: [{ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', firstName: 'Ana', lastName: 'Vega' }] });
    if (path.endsWith(`/api/calendar/reservations/${roster.reservations[0].id}/cancel`)) { cancelled = true; roster.reservations[0].status = 'cancelled'; return response({ id: roster.reservations[0].id }); }
    if (path.endsWith(`/api/calendar/sessions/${session.id}/reservations`) && options.method === 'POST') { overbooked = true; return response({ id: '99999999-9999-4999-8999-999999999999', overbooked: true }, 201); }
    throw new Error(`Unexpected request: ${options.method ?? 'GET'} ${url}`);
  };
  render(React.createElement(CalendarPage));
  fireEvent.click(await screen.findByRole('button', { name: /Fuerza 2J/ }));
  await screen.findByText('Lucía Martín');
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  let confirm = await screen.findByRole('alertdialog', { name: 'Cancelar reserva' });
  assert.equal(cancelled, false);
  fireEvent.click(within(confirm).getByRole('button', { name: 'Volver' }));
  assert.equal(cancelled, false);
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  confirm = await screen.findByRole('alertdialog', { name: 'Cancelar reserva' });
  fireEvent.click(within(confirm).getByRole('button', { name: 'Cancelar reserva' }));
  await waitFor(() => assert.equal(cancelled, true));
  const search = screen.getByRole('combobox', { name: 'Buscar cliente' });
  fireEvent.change(search, { target: { value: 'Lucía' } });
  await screen.findByRole('option', { name: 'Ana Vega' });
  fireEvent.click(screen.getByRole('option', { name: 'Ana Vega' }));
  await screen.findByText('Puede entrar en lista de espera');
  fireEvent.click(screen.getByRole('button', { name: 'Autorizar sobrecupo' }));
  confirm = await screen.findByRole('alertdialog', { name: 'Autorizar sobrecupo' });
  assert.equal(overbooked, false);
  fireEvent.click(within(confirm).getByRole('button', { name: 'Autorizar sobrecupo' }));
  await waitFor(() => assert.equal(overbooked, true));
});

test('eligibility preview shows the exact missing document and authorized override requires reason',async()=>{
  const session={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',serviceId:service.id,serviceName:service.name,areaId:area.id,areaName:area.name,templateId:null,source:'manual',startsAt:`${key(monday)}T18:00:00.000Z`,durationMinutes:60,capacity:2,status:'scheduled',isIndividual:false,occupiedCount:0,overbookCount:0,waitlistCount:0};let attempts=[];
  globalThis.fetch=async(url,options={})=>{const path=String(url);if(path.includes('/api/calendar/week'))return response({...baseData,sessions:[session],capabilities:{...baseData.capabilities,overrideDocuments:true}});if(path.endsWith(`/api/calendar/sessions/${session.id}/attendees`))return response({reservations:[],waitlist:[]});if(path.includes(`/api/calendar/sessions/${session.id}/booking-eligibility`))return response({allowed:false,decision:'blocked',blockingReasons:['required_document_missing'],selectedEntitlement:{assignmentId:'11111111-1111-4111-8111-111111111111',planId:'22222222-2222-4222-8222-222222222222',planName:'Bono',availableBalance:2,periodUsage:[],validUntil:null},availableAlternatives:[{assignmentId:'11111111-1111-4111-8111-111111111111',planId:'22222222-2222-4222-8222-222222222222',planName:'Bono',availableBalance:2,periodUsage:[],validUntil:null}],capacity:{occupied:0,limit:2,available:2},waitlistAllowed:true,overridePossible:{debt:false,documents:true,capacity:false},requiredDocuments:[{requirementId:'req-1',requirementType:'form',label:'PAR-Q'}]});if(path.includes('/api/clients?'))return response({items:[{id:'ffffffff-ffff-4fff-8fff-ffffffffffff',firstName:'Lucía',lastName:'Martín'}]});if(path.endsWith(`/api/calendar/sessions/${session.id}/reservations`)){attempts.push(JSON.parse(options.body));return response({id:'new-reservation'},201);}throw new Error(`Unexpected ${options.method??'GET'} ${path}`);};
  render(React.createElement(CalendarPage));fireEvent.click(await screen.findByRole('button',{name:/Fuerza 2J/}));await screen.findByText('Aún no hay reservas.');const picker=screen.getByRole('combobox',{name:'Buscar cliente'});fireEvent.change(picker,{target:{value:'Lucía'}});await screen.findByRole('option',{name:'Lucía Martín'});fireEvent.keyDown(picker,{key:'ArrowDown'});fireEvent.keyDown(picker,{key:'Enter'});await screen.findByText('PAR-Q');assert.ok(screen.getByText('Faltan documentos para completar la reserva:'));assert.ok(screen.getByRole('checkbox',{name:'Continuar con excepción'}));assert.equal(screen.getByRole('button',{name:'Reservar plaza'}).disabled,true);fireEvent.click(screen.getByRole('checkbox',{name:'Continuar con excepción'}));fireEvent.change(screen.getByLabelText('Motivo obligatorio'),{target:{value:'Comprobado presencialmente'}});fireEvent.click(screen.getByRole('button',{name:'Reservar plaza'}));await waitFor(()=>assert.equal(attempts.length,1));assert.deepEqual(attempts[0],{clientId:'ffffffff-ffff-4fff-8fff-ffffffffffff',entitlementAssignmentId:'11111111-1111-4111-8111-111111111111',overrideDocuments:true,documentOverrideReason:'Comprobado presencialmente'});
});
