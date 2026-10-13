import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

async function uiHarness() {
  const testing = await import('@testing-library/react');
  const app = await import('../src/client-app.tsx');
  return { ...testing, ...app };
}

test('client app fails closed without a client session and offers retry', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    sessionStorage: { configurable: true, value: dom.window.sessionStorage },
    crypto: { configurable: true, value: { randomUUID: () => '00000000-0000-4000-8000-000000000001' } },
  });
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'client_authentication_required' }), { status: 401, headers: { 'content-type': 'application/json' } });
  const { render, cleanup, ClientApp } = await uiHarness();
  const ui = render(React.createElement(ClientApp));
  assert.ok(await ui.findByRole('heading', { name: 'Tu espacio no está disponible ahora' }));
  assert.ok(ui.getByText('Inicia sesión con tu cuenta para consultar tus reservas y derechos.'));
  assert.ok(ui.getByRole('button', { name: 'Intentar de nuevo' }));
  assert.equal(ui.queryByRole('navigation', { name: 'Navegación principal' }), null);
  cleanup(); dom.window.close();
});

test('pilot member login uses an opaque server session and logout returns to sign-in', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:5173/' });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    sessionStorage: { configurable: true, value: dom.window.sessionStorage }, crypto: { configurable: true, value: { randomUUID: () => '00000000-0000-4000-8000-000000000001' } },
  });
  let loggedIn = false; const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (url === '/api/pilot/member/login') { assert.deepEqual(JSON.parse(init.body), { code: '2j-member-a-local' }); loggedIn = true; return new Response(JSON.stringify({ expiresAt: new Date(Date.now() + 3_600_000).toISOString() }), { headers: { 'content-type': 'application/json' } }); }
    if (url === '/api/pilot/member/logout') { loggedIn = false; return new Response(null, { status: 204 }); }
    if (url === '/api/me' && loggedIn) return new Response(JSON.stringify({ profile: { id: 'd0700000-0000-4000-8000-000000000001', firstName: 'María', lastName: 'González', email: null, status: 'active' } }), { headers: { 'content-type': 'application/json' } });
    if (url === '/api/me' && !loggedIn) return new Response(JSON.stringify({ error: 'client_authentication_required' }), { status: 401, headers: { 'content-type': 'application/json' } });
    if (url === '/api/me/membership') return new Response(JSON.stringify({ assignments: [] }));
    if (url === '/api/me/booking-access') return new Response(JSON.stringify({ enabled: false }));
    if (url === '/api/me/bookings') return new Response(JSON.stringify({ reservations: [], waitlist: [] }));
    if (String(url).startsWith('/api/me/sessions?')) return new Response(JSON.stringify({ sessions: [] }));
    if (url === '/api/client-portal/form-assignments' || url === '/api/client-portal/consents') return new Response(JSON.stringify([]));
    if (url === '/api/me/notifications/unread-count') return new Response(JSON.stringify({ count: 0 }));
    if (url === '/api/me/notifications') return new Response(JSON.stringify({ items: [] }));
    return new Response('{}');
  };
  const { render, cleanup, fireEvent, ClientApp } = await uiHarness();
  const ui = render(React.createElement(ClientApp, { pilotLoginEnabledOverride: true }));
  const code = await ui.findByLabelText('Código de acceso');
  fireEvent.change(code, { target: { value: '2j-member-a-local' } });
  fireEvent.click(ui.getByRole('button', { name: 'Iniciar sesión' }));
  assert.ok(await ui.findByRole('heading', { name: 'Hola, María' }));
  const loginRequest = requests.find(item => item.url === '/api/pilot/member/login');
  assert.equal(loginRequest.init.credentials, 'include');
  assert.equal(JSON.stringify(loginRequest.init.body).includes('clientId'), false);
  fireEvent.click(ui.getByRole('button', { name: 'Cerrar sesión' }));
  assert.ok(await ui.findByRole('heading', { name: 'Tu espacio, a tu manera' }));
  assert.equal(requests.some(item => item.url === '/api/pilot/member/logout' && item.init.credentials === 'include'), true);
  cleanup(); dom.window.close();
});

test('dates and times are formatted in Atlantic/Canary', () => {
  return import('../src/client-app.tsx').then(({ clientAppTestHelpers }) => {
  assert.equal(clientAppTestHelpers.timeLabel('2026-10-10T09:00:00.000Z'), '10:00');
  assert.equal(clientAppTestHelpers.weekRangeDays().length, 7);
  assert.deepEqual(clientAppTestHelpers.weekRange('2026-10-10'), { from: '2026-10-05', to: '2026-10-11' });
  assert.equal(clientAppTestHelpers.shiftDateKey('2026-03-28', 1), '2026-03-29');
  assert.equal(clientAppTestHelpers.dateKey(new Date('2026-10-10T23:30:00.000Z')), '2026-10-11');
  assert.deepEqual(clientAppTestHelpers.resolveClientNotificationTarget('/bookings'), {view:'bookings'});
  assert.deepEqual(clientAppTestHelpers.resolveClientNotificationTarget('/bookings/11111111-1111-4111-8111-111111111111'), {view:'bookings'});
  assert.deepEqual(clientAppTestHelpers.resolveClientNotificationTarget('/profile'), {view:'profile'});
  assert.deepEqual(clientAppTestHelpers.resolveClientNotificationTarget('/profile/documents'), {view:'profile'});
  assert.deepEqual(clientAppTestHelpers.resolveClientNotificationTarget('/membership'), {view:'profile'});
  assert.deepEqual(clientAppTestHelpers.resolveClientNotificationTarget('/sessions/22222222-2222-4222-8222-222222222222'), {view:'book'});
  const now = Date.parse('2026-10-10T10:00:00.000Z');
  const booking = (id, status, startsAt, sessionStatus = 'scheduled') => ({ id, status, startsAt, sessionStatus });
  assert.equal(clientAppTestHelpers.selectNextConfirmedBooking([
    booking('waiting', 'waiting', '2026-10-10T11:00:00.000Z'),
    booking('cancelled', 'cancelled_by_center', '2026-10-10T12:00:00.000Z'),
    booking('past', 'reserved', '2026-10-10T09:00:00.000Z'),
    booking('cancelled-session', 'reserved', '2026-10-10T12:30:00.000Z', 'cancelled_by_center'),
    booking('later', 'reserved', '2026-10-10T13:00:00.000Z'),
    booking('nearest', 'reserved', '2026-10-10T12:00:00.000Z'),
  ], now)?.id, 'nearest');
  assert.equal(clientAppTestHelpers.selectNextConfirmedBooking([booking('wait', 'waiting', '2026-10-10T11:00:00.000Z')], now), null);
  assert.equal(clientAppTestHelpers.resolveClientNotificationTarget('/unknown'), null);
  assert.equal(clientAppTestHelpers.resolveClientNotificationTarget('https://example.test/'), null);
  assert.equal(clientAppTestHelpers.resolveClientNotificationTarget('javascript:alert(1)'), null);
  });
});

test('client notification bell opens a self-scoped inbox and marks notices read', async () => {
  const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost/'});
  Object.defineProperties(globalThis,{window:{configurable:true,value:dom.window},document:{configurable:true,value:dom.window.document},navigator:{configurable:true,value:dom.window.navigator},HTMLElement:{configurable:true,value:dom.window.HTMLElement},sessionStorage:{configurable:true,value:dom.window.sessionStorage},crypto:{configurable:true,value:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'}}});
  const item={id:'99999999-9999-4999-8999-999999999999',type:'booking_confirmed',title:'Reserva confirmada',body:'Tu plaza está confirmada.',deeplink:'/bookings',createdAt:'2026-10-10T10:00:00.000Z',readAt:null};
  let failRead=true;globalThis.fetch=async(input,init={})=>{const url=String(input);if(url==='/api/me')return new Response(JSON.stringify({profile:{id:'11111111-1111-4111-8111-111111111111',firstName:'María',lastName:'González',email:null,status:'active'}}),{status:200});if(url==='/api/me/membership')return new Response(JSON.stringify({assignments:[]}));if(url==='/api/me/bookings')return new Response(JSON.stringify({reservations:[],waitlist:[]}));if(url.startsWith('/api/me/sessions?'))return new Response(JSON.stringify({sessions:[]}));if(url==='/api/client-portal/form-assignments'||url==='/api/client-portal/consents')return new Response(JSON.stringify([]));if(url==='/api/me/notifications/unread-count')return new Response(JSON.stringify({count:item.readAt?0:1}));if(url==='/api/me/notifications')return new Response(JSON.stringify({items:[item],nextBefore:null,nextBeforeId:null}));if(url.endsWith('/read')&&init.method==='PATCH'){if(failRead)return new Response(JSON.stringify({error:'temporary_failure'}),{status:503});item.readAt=new Date().toISOString();return new Response(JSON.stringify({id:item.id,readAt:item.readAt}));}return new Response('{}');};
  const {render,cleanup,fireEvent,ClientApp}=await uiHarness();const ui=render(React.createElement(ClientApp));
  const bell=await ui.findByRole('button',{name:/Notificaciones, 1 sin leer/});fireEvent.click(bell);await ui.findByRole('heading',{name:'Notificaciones'});assert.ok(ui.getByText('Tu plaza está confirmada.'));fireEvent.click(ui.getByRole('button',{name:'Abrir aviso: Reserva confirmada'}));await ui.findByRole('heading',{name:'Mis reservas'});assert.ok(await ui.findByText('No se ha podido marcar como leída. Puedes volver a intentarlo.'));assert.ok(await ui.findByRole('button',{name:/Notificaciones, 1 sin leer/}));assert.equal(item.readAt,null);
  failRead=false;fireEvent.click(ui.getByRole('button',{name:/Notificaciones, 1 sin leer/}));await ui.findByRole('heading',{name:'Notificaciones'});fireEvent.click(ui.getByRole('button',{name:'Abrir aviso: Reserva confirmada'}));await ui.findByRole('heading',{name:'Mis reservas'});await ui.findByRole('button',{name:'Notificaciones'});assert.equal(item.readAt!==null,true);
  item.deeplink='/profile';fireEvent.click(ui.getByRole('button',{name:'Notificaciones'}));await ui.findByRole('heading',{name:'Notificaciones'});fireEvent.click(ui.getByRole('button',{name:'Abrir aviso: Reserva confirmada'}));await ui.findByRole('heading',{name:'Perfil'});
  item.deeplink='/sessions/22222222-2222-4222-8222-222222222222';fireEvent.click(ui.getByRole('button',{name:'Notificaciones'}));await ui.findByRole('heading',{name:'Notificaciones'});fireEvent.click(ui.getByRole('button',{name:'Abrir aviso: Reserva confirmada'}));await ui.findByRole('heading',{name:'Reservar'});
  cleanup();dom.window.close();
});

test('informational client messages are marked read without opening a nonexistent chat', async () => {
  const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost/'});
  Object.defineProperties(globalThis,{window:{configurable:true,value:dom.window},document:{configurable:true,value:dom.window.document},navigator:{configurable:true,value:dom.window.navigator},HTMLElement:{configurable:true,value:dom.window.HTMLElement},sessionStorage:{configurable:true,value:dom.window.sessionStorage},crypto:{configurable:true,value:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'}}});
  const item={id:'99999999-9999-4999-8999-999999999998',type:'message_received',title:'Nuevo mensaje del centro',body:'El centro te ha enviado un mensaje.',deeplink:null,createdAt:'2026-10-10T10:00:00.000Z',readAt:null};
  globalThis.fetch=async(input,init={})=>{const url=String(input);if(url==='/api/me')return new Response(JSON.stringify({profile:{id:'11111111-1111-4111-8111-111111111111',firstName:'María',lastName:'González',email:null,status:'active'}}));if(url==='/api/me/membership')return new Response(JSON.stringify({assignments:[]}));if(url==='/api/me/bookings')return new Response(JSON.stringify({reservations:[],waitlist:[]}));if(url.startsWith('/api/me/sessions?'))return new Response(JSON.stringify({sessions:[]}));if(url==='/api/client-portal/form-assignments'||url==='/api/client-portal/consents')return new Response(JSON.stringify([]));if(url==='/api/me/notifications/unread-count')return new Response(JSON.stringify({count:item.readAt?0:1}));if(url==='/api/me/notifications')return new Response(JSON.stringify({items:[item],nextBefore:null,nextBeforeId:null}));if(url.endsWith('/read')&&init.method==='PATCH'){item.readAt=new Date().toISOString();return new Response(JSON.stringify({id:item.id,readAt:item.readAt}));}return new Response('{}');};
  const {render,cleanup,fireEvent,ClientApp}=await uiHarness();const ui=render(React.createElement(ClientApp));fireEvent.click(await ui.findByRole('button',{name:/Notificaciones/}));await ui.findByRole('heading',{name:'Notificaciones'});fireEvent.click(ui.getByRole('button',{name:'Abrir aviso: Nuevo mensaje del centro'}));await ui.findByText('Este aviso es informativo; los mensajes del centro todavía no están disponibles aquí.');assert.equal(item.readAt!==null,true);assert.equal(ui.queryByRole('heading',{name:'Mensajes'}),null);item.deeplink='https://evil.test';item.readAt=null;fireEvent.click(ui.getByRole('button',{name:'Notificaciones'}));await ui.findByRole('heading',{name:'Notificaciones'});fireEvent.click(ui.getByRole('button',{name:'Abrir aviso: Nuevo mensaje del centro'}));assert.ok(await ui.findByText('Este aviso no tiene un destino disponible.'));assert.ok(ui.getByRole('heading',{name:'Notificaciones'}));cleanup();dom.window.close();
});

test('client can choose a center-local day, review a session, and retry a lost reservation with the same key', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    HTMLInputElement: { configurable: true, value: dom.window.HTMLInputElement }, HTMLTextAreaElement: { configurable: true, value: dom.window.HTMLTextAreaElement }, HTMLSelectElement: { configurable: true, value: dom.window.HTMLSelectElement }, Event: { configurable: true, value: dom.window.Event },
    sessionStorage: { configurable: true, value: dom.window.sessionStorage }, crypto: { configurable: true, value: { randomUUID: () => '11111111-1111-4111-8111-111111111111' } },
  });
  const { render, cleanup, fireEvent, within, ClientApp, clientAppTestHelpers } = await uiHarness();
  const days = clientAppTestHelpers.weekRangeDays();
  const dateAt = (date, hour = 18) => { const [year, month, day] = date.split('-').map(Number); return new Date(Date.UTC(year, month - 1, day, hour + 1)).toISOString(); };
  const session = {
    id: '22222222-2222-4222-8222-222222222222', serviceId: '33333333-3333-4333-8333-333333333333', serviceName: 'Fuerza funcional', areaName: 'La Sala',
    professionalName: 'Alex Rivera', startsAt: dateAt(days[1].date), durationMinutes: 45, capacity: 8, occupiedCount: 3, waitlistCount: 0,
    isIndividual: false, status: 'scheduled', myReservationStatus: null, myWaitlistStatus: null,
  };
  const detail = { ...session, eligible: true, eligibilityReason: null, canJoinWaitlist: false, availableAlternatives: [{ assignmentId: '44444444-4444-4444-8444-444444444444', planName: 'Bono 10' }] };
  let lostResponse = true; const reservationKeys = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === '/api/me') return new Response(JSON.stringify({ profile: { id: '55555555-5555-4555-8555-555555555555', firstName: 'María', lastName: 'González', email: 'maria@example.test', status: 'active' } }), { status: 200 });
    if (url === '/api/me/membership') return new Response(JSON.stringify({ assignments: [{ id: detail.availableAlternatives[0].assignmentId, planName: 'Bono 10', kind: 'session_pack', status: 'active', startsOn: days[0].date, endsOn: null, lastEvent: 'activated', rights: [{ rightType: 'sessions_quota', quantity: 10, balance: 4 }], modules: [] }] }), { status: 200 });
    if (url === '/api/me/booking-access') return new Response(JSON.stringify({ enabled: true }), { status: 200 });
    if (url === '/api/me/bookings') return new Response(JSON.stringify({ reservations: [], waitlist: [] }), { status: 200 });
    if (url.startsWith('/api/me/sessions?')) return new Response(JSON.stringify({ timezone: 'Atlantic/Canary', sessions: [session] }), { status: 200 });
    if (url === '/api/client-portal/form-assignments' || url === '/api/client-portal/consents') return new Response(JSON.stringify([]), { status: 200 });
    if (url === `/api/me/sessions/${session.id}`) return new Response(JSON.stringify({ session: detail }), { status: 200 });
    if (url.endsWith('/reservations') && init.method === 'POST') {
      reservationKeys.push(new Headers(init.headers).get('idempotency-key'));
      if (lostResponse) { lostResponse = false; throw new Error('network disconnected after request'); }
      return new Response(JSON.stringify({ id: '66666666-6666-4666-8666-666666666666', status: 'reserved' }), { status: 201 });
    }
    throw new Error(`Unexpected request ${init.method ?? 'GET'} ${url}`);
  };
  const ui = render(React.createElement(ClientApp));
  assert.ok(await ui.findByRole('heading', { name: 'Hola, María' }));
  fireEvent.click(ui.getByRole('button', { name: /Ver horarios y reservar/ }));
  assert.ok(await ui.findByRole('heading', { name: 'Reservar' }));
  fireEvent.click(ui.container.querySelectorAll('.day-chip')[1]);
  assert.ok(await ui.findByRole('button', { name: /Fuerza funcional.*Alex Rivera/ }));
  fireEvent.click(ui.getByRole('button', { name: /Fuerza funcional.*Alex Rivera/ }));
  assert.ok(await ui.findByRole('dialog'));
  const reserveButton = ui.getByRole('button', { name: 'Confirmar reserva' });
  fireEvent.click(reserveButton);
  assert.ok(await ui.findByText('No se ha podido completar la reserva. Puedes volver a intentarlo.'));
  fireEvent.click(ui.getByRole('button', { name: 'Confirmar reserva' }));
  assert.ok(await ui.findByText('Tu plaza está reservada.'));
  assert.equal(reservationKeys.length, 2);
  assert.equal(reservationKeys[0], reservationKeys[1]);
  cleanup(); dom.window.close();
});

test('Member outside the booking cohort can browse sessions but sees a clear disabled-action state', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document }, navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    sessionStorage: { configurable: true, value: dom.window.sessionStorage }, crypto: { configurable: true, value: { randomUUID: () => '12111111-1111-4111-8111-111111111111' } },
  });
  const { render, cleanup, fireEvent, within, ClientApp, clientAppTestHelpers } = await uiHarness();
  const days = clientAppTestHelpers.weekRangeDays();
  const startsAt = new Date(`${days[1].date}T19:00:00+01:00`).toISOString();
  const session = { id: '13111111-1111-4111-8111-111111111111', serviceId: '14111111-1111-4111-8111-111111111111', serviceName: 'Fuerza', areaName: 'La Sala', professionalName: null, startsAt, durationMinutes: 45, capacity: 8, occupiedCount: 2, waitlistCount: 0, isIndividual: false, status: 'scheduled', myReservationStatus: null, myWaitlistStatus: null };
  let mutationAttempted = false;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === '/api/me') return new Response(JSON.stringify({ profile: { id: '15111111-1111-4111-8111-111111111111', firstName: 'Bea', lastName: 'Cliente', email: null, status: 'active' } }));
    if (url === '/api/me/membership') return new Response(JSON.stringify({ assignments: [] }));
    if (url === '/api/me/booking-access') return new Response(JSON.stringify({ enabled: false }));
    if (url === '/api/me/bookings') return new Response(JSON.stringify({ reservations: [], waitlist: [] }));
    if (url.startsWith('/api/me/sessions?')) return new Response(JSON.stringify({ sessions: [session] }));
    if (url === '/api/client-portal/form-assignments' || url === '/api/client-portal/consents') return new Response(JSON.stringify([]));
    if (url === '/api/me/notifications/unread-count') return new Response(JSON.stringify({ count: 0 }));
    if (url === '/api/me/notifications') return new Response(JSON.stringify({ items: [] }));
    if (url === `/api/me/sessions/${session.id}`) return new Response(JSON.stringify({ session: { ...session, eligible: true, canJoinWaitlist: false, availableAlternatives: [] } }));
    if (init.method === 'POST' || init.method === 'PATCH') mutationAttempted = true;
    throw new Error(`Unexpected request ${init.method ?? 'GET'} ${url}`);
  };
  const ui = render(React.createElement(ClientApp));
  assert.ok(await ui.findByRole('heading', { name: 'Hola, Bea' }));
  fireEvent.click(ui.getByRole('button', { name: /Ver horarios y reservar/ }));
  fireEvent.click(ui.container.querySelectorAll('.day-chip')[1]);
  assert.ok(await ui.findByRole('button', { name: /Fuerza/ }));
  fireEvent.click(ui.getByRole('button', { name: /Fuerza/ }));
  assert.ok(within(await ui.findByRole('dialog')).getByText('Las reservas desde la app todavía no están activadas para tu cuenta.'));
  assert.equal(ui.getByRole('button', { name: 'Confirmar reserva' }).disabled, true);
  assert.equal(mutationAttempted, false);
  cleanup(); dom.window.close();
});

test('profile completes only the signed-in client’s form and records an explicit consent acceptance', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    HTMLInputElement: { configurable: true, value: dom.window.HTMLInputElement }, HTMLTextAreaElement: { configurable: true, value: dom.window.HTMLTextAreaElement }, HTMLSelectElement: { configurable: true, value: dom.window.HTMLSelectElement }, Event: { configurable: true, value: dom.window.Event },
    sessionStorage: { configurable: true, value: dom.window.sessionStorage }, crypto: { configurable: true, value: { randomUUID: () => '77777777-7777-4777-8777-777777777777' } },
  });
  const assignment = { id: '88888888-8888-4888-8888-888888888888', name: 'Cuestionario de bienvenida', status: 'assigned', required: true, dueAt: null, category: 'onboarding', version: 1 };
  const consent = { consentId: '99999999-9999-4999-8999-999999999999', versionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Normas del centro', body: 'Texto de las normas.', version: 1, required: true, accepted: false };
  let acceptedPayload; let formSubmitted = false;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === '/api/me') return new Response(JSON.stringify({ profile: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', firstName: 'Lucía', lastName: 'Díaz', email: null, status: 'active' } }), { status: 200 });
    if (url === '/api/me/membership') return new Response(JSON.stringify({ assignments: [] }), { status: 200 });
    if (url === '/api/me/booking-access') return new Response(JSON.stringify({ enabled: false }), { status: 200 });
    if (url === '/api/me/bookings') return new Response(JSON.stringify({ reservations: [], waitlist: [] }), { status: 200 });
    if (url.startsWith('/api/me/sessions?')) return new Response(JSON.stringify({ timezone: 'Atlantic/Canary', sessions: [] }), { status: 200 });
    if (url === '/api/client-portal/form-assignments') return new Response(JSON.stringify(formSubmitted ? [] : [assignment]), { status: 200 });
    if (url === '/api/client-portal/consents') return new Response(JSON.stringify([consent]), { status: 200 });
    if (url === `/api/client-portal/form-assignments/${assignment.id}`) return new Response(JSON.stringify({ ...assignment, description: 'Datos básicos.', sensitivity: 'operational', fields: [{ id: 'goal', label: 'Objetivo principal', type: 'short_text', required: true }] }), { status: 200 });
    if (url.endsWith('/respond') && init.method === 'POST') { formSubmitted = true; return new Response(JSON.stringify({ status: 'submitted' }), { status: 201 }); }
    if (url === `/api/client-portal/consents/${consent.versionId}/accept` && init.method === 'POST') { acceptedPayload = JSON.parse(init.body); return new Response(JSON.stringify({ id: 'acceptance', acceptedAt: new Date().toISOString() }), { status: 201 }); }
    throw new Error(`Unexpected request ${init.method ?? 'GET'} ${url}`);
  };
  const { render, cleanup, fireEvent, ClientApp } = await uiHarness();
  const ui = render(React.createElement(ClientApp));
  assert.ok(await ui.findByRole('heading', { name: 'Hola, Lucía' }));
  fireEvent.click(ui.getByRole('button', { name: 'Perfil', exact: true }));
  fireEvent.click(ui.getByRole('button', { name: 'Completar' }));
  assert.ok(await ui.findByRole('dialog', { name: 'Cuestionario de bienvenida' }));
  const goal = ui.getByLabelText(/Objetivo principal/);
  const setInputValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  setInputValue.call(goal, 'Mejorar fuerza');
  goal.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  goal.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(goal.value, 'Mejorar fuerza');
  fireEvent.click(ui.getByRole('button', { name: 'Enviar documento' }));
  assert.ok(await ui.findByText('No tienes formularios pendientes.'));
  fireEvent.click(ui.getByRole('button', { name: 'Consultar' }));
  assert.ok(await ui.findByRole('dialog', { name: 'Normas del centro' }));
  fireEvent.click(ui.getByLabelText('He leído y acepto este consentimiento.'));
  fireEvent.change(ui.getByLabelText('Nombre completo'), { target: { value: 'Lucía Díaz' } });
  fireEvent.click(ui.getByRole('button', { name: 'Confirmar aceptación' }));
  assert.ok(await ui.findByText('Tu aceptación se ha guardado.'));
  assert.deepEqual(acceptedPayload, { typedName: 'Lucía Díaz', accepted: true });
  cleanup(); dom.window.close();
});

test('2J Hub preview is build-gated, presents five destinations and never calls the API', async (t) => {
  const { isHubPreviewEnabled, HUB_TRAINING_URL } = await import('../src/client-app.tsx').then(({clientAppTestHelpers}) => clientAppTestHelpers);
  assert.equal(isHubPreviewEnabled(false, '?preview=1'), false);
  assert.equal(isHubPreviewEnabled('false', '?preview=1'), false);
  assert.equal(isHubPreviewEnabled(true, '?preview=1'), true);
  assert.equal(isHubPreviewEnabled('true', ''), false);
  assert.equal(isHubPreviewEnabled('true', '?view=home'), false);
  assert.equal(isHubPreviewEnabled('true', '?preview=1&view=home'), true);
  assert.equal(isHubPreviewEnabled('true', '?preview=0'), false);
  assert.equal(isHubPreviewEnabled('true', '?preview=1&preview=1'), false);
  assert.equal(isHubPreviewEnabled('true', '?preview=1&preview=0'), false);
  assert.equal(HUB_TRAINING_URL, 'https://app.2jfitnesscenter.com');

  // 21:00 in Atlantic/Canary: the fixture correctly places the 18:00 visit tomorrow.
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-10T20:00:00.000Z') });
  t.after(() => t.mock.timers.reset());

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/?preview=1' });
  const clipboard = [];
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    HTMLInputElement: { configurable: true, value: dom.window.HTMLInputElement }, HTMLTextAreaElement: { configurable: true, value: dom.window.HTMLTextAreaElement }, HTMLSelectElement: { configurable: true, value: dom.window.HTMLSelectElement }, Event: { configurable: true, value: dom.window.Event },
    sessionStorage: { configurable: true, value: dom.window.sessionStorage }, crypto: { configurable: true, value: { randomUUID: () => '11111111-1111-4111-8111-111111111111' } },
  });
  Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true, value: { writeText: async value => clipboard.push(value) } });
  const requests = [];
  globalThis.fetch = async (input, init = {}) => { requests.push({ url: String(input), method: init.method ?? 'GET' }); throw new Error('Preview must not reach fetch.'); };
  const { render, cleanup, fireEvent, within, ClientApp } = await uiHarness();
  const ui = render(React.createElement(ClientApp, { previewModeOverride: true }));
  assert.ok(await ui.findByRole('heading', { name: 'Hola, Juan' }));
  assert.ok(ui.getByText('Vista previa', { selector: '.preview-pill' }));
  assert.ok(ui.getByRole('heading', { name: 'Próxima reserva' }));
  assert.ok(ui.getByText('Nuevo horario del sábado'));
  assert.ok(ui.getByText('Funcional'));
  assert.ok(ui.getByText('Confirmada'));

  const navigation = ui.getByRole('navigation', { name: 'Navegación principal' });
  assert.deepEqual(within(navigation).getAllByRole('button').map(button => button.textContent.trim()), ['Inicio', 'Búnker', 'Tienda', 'Perfil', 'Ajustes']);
  assert.equal(within(navigation).getByRole('button', { name: 'Inicio', exact: true }).getAttribute('aria-current'), 'page');
  for (const oldLabel of ['Reservar', 'Entrenar', 'Centro']) assert.equal(within(navigation).queryByRole('button', { name: oldLabel, exact: true }), null);
  assert.equal(ui.container.querySelectorAll('.home-news,.home-book-cta,.home-next-booking').length, 3);
  assert.equal(ui.getByText('Selecciona actividad, día y hora.' ) != null, true);
  assert.equal(within(navigation).queryByRole('button', { name: /notificaciones/i }), null);

  fireEvent.click(within(navigation).getByRole('button', { name: 'Búnker' }));
  assert.ok(await ui.findByRole('heading', { name: 'Búnker' }));
  const trainingLink = ui.getByRole('link', { name: /Abrir Búnker/ });
  assert.equal(trainingLink.getAttribute('href'), 'https://app.2jfitnesscenter.com');
  assert.equal(trainingLink.getAttribute('target'), '_blank');
  assert.match(trainingLink.getAttribute('rel'), /noopener/);

  fireEvent.click(within(navigation).getByRole('button', { name: 'Tienda' }));
  assert.ok(await ui.findByRole('heading', { name: 'Tienda' }));
  assert.ok(ui.getByRole('heading', { name: 'Nutrición' }));
  assert.ok(ui.getByRole('heading', { name: 'Merchandising' }));
  assert.ok(ui.getByText('Catálogo informativo. Las compras se gestionan directamente en el centro.'));
  fireEvent.click(within(navigation).getByRole('button', { name: 'Ajustes' }));
  assert.ok(await ui.findByRole('heading', { name: 'Ajustes' }));
  assert.ok(ui.getByRole('heading', { name: 'Herramientas del piloto' }));
  fireEvent.click(ui.getByRole('button', { name: 'Copiar información de diagnóstico' }));
  await ui.findByText('Información de diagnóstico copiada.');
  assert.match(clipboard[0], /mode=fixture-preview/);
  assert.match(clipboard[0], /viewport=\d+x\d+/);
  assert.doesNotMatch(clipboard[0], /Juan|Demo|token|cookie|secret/i);

  fireEvent.click(within(navigation).getByRole('button', { name: 'Inicio' }));
  fireEvent.click(ui.getByRole('button', { name: /Ver horarios y reservar/ }));
  assert.ok(await ui.findByRole('heading', { name: 'Reservar' }));
  fireEvent.click(ui.getByRole('button', { name: /Funcional.*La Sala/ }));
  assert.ok(await ui.findByRole('dialog'));
  assert.ok(ui.getByText('Tu plaza ya está reservada.'));
  fireEvent.click(ui.getByRole('button', { name: 'Cerrar detalle' }));

  fireEvent.click(within(navigation).getByRole('button', { name: 'Perfil' }));
  assert.ok(await ui.findByRole('heading', { name: 'Perfil' }));
  assert.ok(ui.getByText('Plan 2J'));
  assert.ok(ui.getByRole('heading', { name: 'Cuotas y saldo' }));
  assert.ok(ui.getByRole('heading', { name: 'Contratos y certificados' }));
  assert.ok(ui.getByRole('heading', { name: 'Buzón' }));
  fireEvent.click(ui.getByRole('button', { name: 'Completar' }));
  assert.ok(await ui.findByRole('dialog', { name: 'Ficha de bienvenida' }));
  assert.equal(ui.getByRole('button', { name: 'Enviar documento' }).disabled, true);
  fireEvent.click(ui.getByRole('button', { name: 'Cerrar formulario' }));
  fireEvent.click(ui.getByRole('button', { name: 'Consultar' }));
  assert.ok(await ui.findByRole('dialog', { name: 'Normas del centro' }));
  assert.equal(ui.getByRole('button', { name: 'Confirmar aceptación' }).disabled, true);
  assert.deepEqual(requests, []);
  cleanup(); dom.window.close();
});

test('Inicio V2 shows the no-upcoming-reservation state and neutral news empty state', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    sessionStorage: { configurable: true, value: dom.window.sessionStorage }, crypto: { configurable: true, value: { randomUUID: () => 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' } },
  });
  globalThis.fetch = async input => {
    const url = String(input);
    if (url === '/api/me') return new Response(JSON.stringify({ profile: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', firstName: 'Eva', lastName: 'Piloto', email: null, status: 'active' } }));
    if (url === '/api/me/membership') return new Response(JSON.stringify({ assignments: [] }));
    if (url === '/api/me/booking-access') return new Response(JSON.stringify({ enabled: false }));
    if (url === '/api/me/bookings') return new Response(JSON.stringify({ reservations: [], waitlist: [{ status: 'waiting', startsAt: new Date(Date.now() + 86_400_000).toISOString() }] }));
    if (url.startsWith('/api/me/sessions?')) return new Response(JSON.stringify({ sessions: [] }));
    if (url === '/api/client-portal/form-assignments' || url === '/api/client-portal/consents') return new Response(JSON.stringify([]));
    if (url === '/api/me/notifications/unread-count') return new Response(JSON.stringify({ count: 0 }));
    if (url.startsWith('/api/me/notifications')) return new Response(JSON.stringify({ items: [] }));
    throw new Error(`Unexpected request ${url}`);
  };
  const { render, cleanup, ClientApp } = await uiHarness();
  const ui = render(React.createElement(ClientApp));
  assert.ok(await ui.findByRole('heading', { name: 'Hola, Eva' }));
  assert.ok(ui.getByText('No tienes ninguna reserva próxima.'));
  assert.ok(ui.getByText('Aquí aparecerán las noticias y avisos destacados del centro.'));
  assert.equal(ui.container.querySelectorAll('.home-news,.home-book-cta,.home-next-booking').length, 3);
  cleanup(); dom.window.close();
});
