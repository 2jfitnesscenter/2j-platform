import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import React from 'react';

test('Home visual identity keeps the Expo graphite and lime glass theme scoped to the client PWA', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const visualUnification = css.slice(css.lastIndexOf('/* Home visual unification:'));
  assert.doesNotMatch(css, /#10B981/i);
  assert.match(visualUnification, /--2j-color-brand:#A4D65E/);
  assert.match(visualUnification, /--2j-color-canvas:#151719/);
  assert.match(visualUnification, /\.client-app\.hub-theme\.hub-theme-light \{[\s\S]*?--2j-color-brand:#A4D65E/);
  assert.match(visualUnification, /--hub-glass-border:rgb\(255 255 255 \/ 15%\)/);
  assert.match(visualUnification, /backdrop-filter:blur\(24px\) saturate\(145%\)/);
  assert.match(visualUnification, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(visualUnification, /\.hub-theme \.button\.primary[\s\S]*?background:linear-gradient\(145deg,#B9E37C,#A4D65E 70%\)/);
  assert.match(visualUnification, /@media \(max-width:430px\)[\s\S]*?\.hub-theme \.preview-pill \{ min-height:26px; padding:0 7px; font-size:9px/);
  assert.doesNotMatch(visualUnification, /\.admin-web|\.staff-app/);
});

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
  let loggedIn = false; const requests = []; let memberPreferences = { appearance: 'dark', language: 'es' };
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (url === '/api/pilot/member/login') { assert.deepEqual(JSON.parse(init.body), { code: '2j-member-a-local' }); loggedIn = true; return new Response(JSON.stringify({ expiresAt: new Date(Date.now() + 3_600_000).toISOString() }), { headers: { 'content-type': 'application/json' } }); }
    if (url === '/api/pilot/member/logout') { loggedIn = false; return new Response(null, { status: 204 }); }
    if (url === '/api/me/preferences' && init.method === 'PATCH') { memberPreferences = { ...memberPreferences, ...JSON.parse(init.body) }; return new Response(JSON.stringify({ preferences: memberPreferences }), { headers: { 'content-type': 'application/json' } }); }
    if (url === '/api/me/preferences') return new Response(JSON.stringify({ preferences: memberPreferences }), { headers: { 'content-type': 'application/json' } });
    if (url === '/api/me' && loggedIn) return new Response(JSON.stringify({ profile: { id: 'd0700000-0000-4000-8000-000000000001', firstName: 'María', lastName: 'González', email: null, status: 'active' } }), { headers: { 'content-type': 'application/json' } });
    if (url === '/api/me' && !loggedIn) return new Response(JSON.stringify({ error: 'client_authentication_required' }), { status: 401, headers: { 'content-type': 'application/json' } });
    if (url === '/api/me/membership') return new Response(JSON.stringify({ assignments: [], active: [], asOf: '2026-10-23', timezone: 'Atlantic/Canary', trainingCapabilities: { contract: '2J-CAPABILITIES-V2.1', revision: 1, version: 2, capabilityLevel: 'baseline', accessState: 'baseline', reasonCode: 'FREE_BASELINE', expiresAt: new Date(Date.now() + 30_000).toISOString(), trainingSubject: { linkStatus: 'not_linked' }, capabilities: { autonomousTraining: true, routineCreation: false, personalRoutineCreation: true, personalRoutineManagement: true, workoutRecording: true, workoutHistory: true, guidedTraining: true, premiumPrograms: true, aiCoach: false, professionalFollowUp: false } } }));
    if (url === '/api/me/booking-access') return new Response(JSON.stringify({ enabled: false }));
    if (url === '/api/me/bookings') return new Response(JSON.stringify({ reservations: [], waitlist: [] }));
    if (String(url).startsWith('/api/me/sessions?')) return new Response(JSON.stringify({ sessions: [] }));
    if (url === '/api/client-portal/form-assignments' || url === '/api/client-portal/consents') return new Response(JSON.stringify([]));
    if (url === '/api/me/notifications/unread-count') return new Response(JSON.stringify({ count: 0 }));
    if (url === '/api/me/notifications') return new Response(JSON.stringify({ items: [] }));
    if (url === '/api/me/training-summary') return new Response(JSON.stringify({ status: 'linked', summaryStatus: 'available', summary: { trainingStatus: 'active', asOf: '2026-10-13T12:00:00.000Z', currentProgram: { name: 'Fuerza base' }, recentActivity: { lastTrainingAt: '2026-10-12', sessionsLast30Days: 4 } } }));
    return new Response('{}');
  };
  const { render, cleanup, fireEvent, within, ClientApp } = await uiHarness();
  const ui = render(React.createElement(ClientApp, { pilotLoginEnabledOverride: true }));
  const code = await ui.findByLabelText('Código de acceso');
  fireEvent.change(code, { target: { value: '2j-member-a-local' } });
  fireEvent.click(ui.getByRole('button', { name: 'Iniciar sesión' }));
  assert.ok(await ui.findByRole('heading', { name: 'Hola, María' }));
  const loginRequest = requests.find(item => item.url === '/api/pilot/member/login');
  assert.equal(loginRequest.init.credentials, 'include');
  assert.equal(JSON.stringify(loginRequest.init.body).includes('clientId'), false);
  fireEvent.click(ui.getByRole('button', { name: 'Perfil', exact: true }));
  assert.ok(await ui.findByRole('heading', { name: 'Perfil' }));
  assert.ok(ui.getByText('No tienes ninguna cuota activa.'));
  assert.ok(ui.getByText('Tu perfil y tu acceso al centro siguen disponibles aunque no tengas una cuota activa.'));
  assert.ok(ui.getByRole('heading', { name: 'Contratos y certificados' }));
  assert.ok(ui.getByText('No tienes documentos pendientes.'));
  fireEvent.click(ui.getByRole('button', { name: 'Búnker', exact: true }));
  assert.ok(await ui.findByText('Acceso básico'));
  assert.ok(ui.getByText('Entrena con 2J'));
  assert.ok(ui.getByText('Programas Premium'));
  assert.equal(ui.queryByText('IA de entrenamiento'), null);
  assert.equal(ui.queryByText('Seguimiento profesional'), null);
  assert.ok(requests.filter(item => item.url === '/api/me/membership').length >= 2, 'Búnker refreshes session-authenticated membership capabilities on entry');
  assert.equal(requests.some(item => String(item.url).includes('/api/internal/platform/')), false, 'Home never calls the internal HMAC endpoint');
  assert.ok(await ui.findByText('Búnker conectado'));
  assert.ok(ui.getByText('Programa actual: Fuerza base'));
  assert.ok(ui.getByText(/4 entrenos en los últimos 30 días/));
  fireEvent.click(ui.getByRole('button', { name: 'Perfil', exact: true }));
  fireEvent.click(ui.getByRole('button', { name: /Abrir buzón/ }));
  assert.ok(await ui.findByRole('heading', { name: 'Notificaciones' }));
  assert.equal(ui.getByRole('navigation', { name: 'Navegación principal' }).querySelector('[aria-current="page"]')?.textContent.trim(), 'Perfil');
  fireEvent.click(within(ui.getByRole('navigation', { name: 'Navegación principal' })).getByRole('button', { name: 'Ajustes' }));
  assert.ok(await ui.findByRole('heading', { name: 'Apariencia' }));
  assert.equal(ui.getByRole('radio', { name: /Oscuro/ }).checked, true, 'persisted server preference is loaded');
  assert.equal(ui.container.querySelector('.client-app')?.classList.contains('hub-theme-light'), false);
  fireEvent.click(ui.getByRole('radio', { name: /Claro/ }));
  assert.ok(await ui.findByText('Preferencia guardada.'));
  assert.equal(ui.container.querySelector('.client-app')?.classList.contains('hub-theme-light'), true);
  assert.equal(memberPreferences.appearance, 'light');
  assert.ok(requests.some(item => item.url === '/api/me/preferences' && item.init.method === 'PATCH' && JSON.parse(item.init.body).appearance === 'light'));
  fireEvent.click(ui.getAllByRole('button', { name: 'Cerrar sesión' }).at(-1));
  assert.ok(await ui.findByRole('heading', { name: 'Tu espacio, a tu manera' }));
  assert.equal(requests.some(item => item.url === '/api/pilot/member/logout' && item.init.credentials === 'include'), true);
  cleanup(); dom.window.close();
});

test('preference save failure keeps the immediate appearance and offers a working retry', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  Object.defineProperties(globalThis, { window:{configurable:true,value:dom.window}, document:{configurable:true,value:dom.window.document}, navigator:{configurable:true,value:dom.window.navigator}, HTMLElement:{configurable:true,value:dom.window.HTMLElement}, sessionStorage:{configurable:true,value:dom.window.sessionStorage} });
  let patchAttempts=0; let savedAppearance='dark';
  globalThis.fetch=async (input,init={})=>{const url=String(input);if(url==='/api/me/preferences'&&init.method==='PATCH'){patchAttempts++;if(patchAttempts===1)return new Response(JSON.stringify({error:'temporary_failure'}),{status:503});savedAppearance=JSON.parse(init.body).appearance;return new Response(JSON.stringify({preferences:{appearance:savedAppearance,language:'es'}}));}if(url==='/api/me/preferences')return new Response(JSON.stringify({preferences:{appearance:savedAppearance,language:'es'}}));if(url==='/api/me')return new Response(JSON.stringify({profile:{id:'a',firstName:'Eva',lastName:'Piloto',email:null,status:'active'}}));if(url==='/api/me/membership')return new Response(JSON.stringify({assignments:[],active:[],asOf:'2026-10-23',timezone:'Atlantic/Canary'}));if(url==='/api/me/bookings')return new Response(JSON.stringify({reservations:[],waitlist:[]}));if(url.startsWith('/api/me/sessions?'))return new Response(JSON.stringify({sessions:[]}));if(url==='/api/client-portal/form-assignments'||url==='/api/client-portal/consents')return new Response('[]');if(url==='/api/me/booking-access')return new Response(JSON.stringify({enabled:false}));if(url==='/api/me/news')return new Response(JSON.stringify({items:[],featured:null}));if(url==='/api/me/store/catalog'||url==='/api/me/store/purchases')return new Response(JSON.stringify({items:[]}));if(url==='/api/me/notifications/unread-count')return new Response(JSON.stringify({count:0}));return new Response('{}');};
  const {render,cleanup,fireEvent,ClientApp}=await uiHarness();const ui=render(React.createElement(ClientApp));
  assert.ok(await ui.findByRole('heading',{name:'Hola, Eva'}));fireEvent.click(ui.getByRole('button',{name:'Ajustes'}));assert.ok(await ui.findByRole('heading',{name:'Apariencia'}));assert.ok(ui.getByRole('heading',{name:'Cuenta y seguridad'}));assert.ok(ui.getByRole('heading',{name:'Privacidad'}));assert.ok(ui.getByRole('heading',{name:'Notificaciones push'}));assert.ok(ui.getByText(/recuperación de cuenta y los métodos de acceso avanzados aún no están disponibles/i));assert.equal(ui.queryByRole('button',{name:/Cambiar contraseña|Añadir passkey|Recuperar cuenta/i}),null);fireEvent.click(ui.getByRole('radio',{name:/Claro/}));assert.ok(await ui.findByRole('alert'));assert.ok(ui.container.querySelector('.client-app')?.classList.contains('hub-theme-light'));assert.ok(ui.getByRole('button',{name:'Reintentar'}));fireEvent.click(ui.getByRole('button',{name:'Reintentar'}));assert.ok(await ui.findByText('Preferencia guardada.'));assert.equal(savedAppearance,'light');assert.equal(patchAttempts,2);
  cleanup();dom.window.close();
});

test('dates and times are formatted in Atlantic/Canary', () => {
  return import('../src/client-app.tsx').then(({ clientAppTestHelpers }) => {
  assert.equal(clientAppTestHelpers.timeLabel('2026-10-10T09:00:00.000Z'), '10:00');
  assert.equal(clientAppTestHelpers.weekRangeDays().length, 7);
  assert.deepEqual(clientAppTestHelpers.weekRange('2026-10-10'), { from: '2026-10-05', to: '2026-10-11' });
  assert.deepEqual(clientAppTestHelpers.monthRange('2026-10-14'), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(clientAppTestHelpers.monthRange('2026-02-14'), { from: '2026-02-01', to: '2026-02-28' });
  assert.equal(clientAppTestHelpers.shiftMonthKey('2026-12-01', 1), '2027-01-01');
  assert.equal(clientAppTestHelpers.monthGridDays('2026-10-14').filter(Boolean).length, 31);
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
  let failRead=true;globalThis.fetch=async(input,init={})=>{const url=String(input);if(url==='/api/me')return new Response(JSON.stringify({profile:{id:'11111111-1111-4111-8111-111111111111',firstName:'María',lastName:'González',email:null,status:'active'}}),{status:200});if(url==='/api/me/membership')return new Response(JSON.stringify({assignments:[{id:'12111111-1111-4111-8111-111111111111',planName:'Plan 2J',kind:'monthly',status:'active',startsOn:'2026-10-01',endsOn:null,lastEvent:'activated',rights:[],modules:[]}],active:[{id:'12111111-1111-4111-8111-111111111111',planName:'Plan 2J',kind:'monthly',status:'active',startsOn:'2026-10-01',endsOn:null,lastEvent:'activated',rights:[],modules:[]}],asOf:'2026-10-23',timezone:'Atlantic/Canary'}));if(url==='/api/me/bookings')return new Response(JSON.stringify({reservations:[],waitlist:[]}));if(url.startsWith('/api/me/sessions?'))return new Response(JSON.stringify({sessions:[]}));if(url==='/api/client-portal/form-assignments'||url==='/api/client-portal/consents')return new Response(JSON.stringify([]));if(url==='/api/me/notifications/unread-count')return new Response(JSON.stringify({count:item.readAt?0:1}));if(url==='/api/me/notifications')return new Response(JSON.stringify({items:[item],nextBefore:null,nextBeforeId:null}));if(url.endsWith('/read')&&init.method==='PATCH'){if(failRead)return new Response(JSON.stringify({error:'temporary_failure'}),{status:503});item.readAt=new Date().toISOString();return new Response(JSON.stringify({id:item.id,readAt:item.readAt}));}return new Response('{}');};
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
  globalThis.fetch=async(input,init={})=>{const url=String(input);if(url==='/api/me')return new Response(JSON.stringify({profile:{id:'11111111-1111-4111-8111-111111111111',firstName:'María',lastName:'González',email:null,status:'active'}}));if(url==='/api/me/membership')return new Response(JSON.stringify({assignments:[],active:[],asOf:'2026-10-23',timezone:'Atlantic/Canary'}));if(url==='/api/me/bookings')return new Response(JSON.stringify({reservations:[],waitlist:[]}));if(url.startsWith('/api/me/sessions?'))return new Response(JSON.stringify({sessions:[]}));if(url==='/api/client-portal/form-assignments'||url==='/api/client-portal/consents')return new Response(JSON.stringify([]));if(url==='/api/me/notifications/unread-count')return new Response(JSON.stringify({count:item.readAt?0:1}));if(url==='/api/me/notifications')return new Response(JSON.stringify({items:[item],nextBefore:null,nextBeforeId:null}));if(url.endsWith('/read')&&init.method==='PATCH'){item.readAt=new Date().toISOString();return new Response(JSON.stringify({id:item.id,readAt:item.readAt}));}return new Response('{}');};
  const {render,cleanup,fireEvent,ClientApp}=await uiHarness();const ui=render(React.createElement(ClientApp));fireEvent.click(await ui.findByRole('button',{name:/Notificaciones/}));await ui.findByRole('heading',{name:'Notificaciones'});fireEvent.click(ui.getByRole('button',{name:'Abrir aviso: Nuevo mensaje del centro'}));await ui.findByText('Este aviso es informativo; los mensajes del centro todavía no están disponibles aquí.');assert.equal(item.readAt!==null,true);assert.equal(ui.queryByRole('heading',{name:'Mensajes'}),null);item.deeplink='https://evil.test';item.readAt=null;fireEvent.click(ui.getByRole('button',{name:'Notificaciones'}));await ui.findByRole('heading',{name:'Notificaciones'});fireEvent.click(ui.getByRole('button',{name:'Abrir aviso: Nuevo mensaje del centro'}));assert.ok(await ui.findByText('Este aviso no tiene un destino disponible.'));assert.ok(ui.getByRole('heading',{name:'Notificaciones'}));cleanup();dom.window.close();
});

test('Member books one session after server eligibility and retries a lost response with the same key', async () => {
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
    if (url === '/api/me/membership') { const assignment = { id: detail.availableAlternatives[0].assignmentId, planName: 'Bono 10', kind: 'session_pack', status: 'active', startsOn: days[0].date, endsOn: null, lastEvent: 'activated', rights: [{ rightType: 'sessions_quota', quantity: 10, balance: 4 }], modules: [] }; return new Response(JSON.stringify({ assignments: [assignment], active: [assignment], asOf: days[0].date, timezone: 'Atlantic/Canary' }), { status: 200 }); }
    if (url === '/api/me/booking-access') return new Response(JSON.stringify({ enabled: true }), { status: 200 });
    if (url === '/api/me/bookings') return new Response(JSON.stringify({ reservations: [], waitlist: [] }), { status: 200 });
    if (url === '/api/me/booking-services') return new Response(JSON.stringify({ services: [{ id: session.serviceId, name: session.serviceName }] }), { status: 200 });
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
  fireEvent.click(await ui.findByRole('button', { name: /Fuerza funcional/ }));
  const sessionDay = clientAppTestHelpers.dateKey(new Date(session.startsAt));
  fireEvent.click(ui.getByRole('button', { name: `${Number(sessionDay.slice(-2))}, hay sesiones` }));
  assert.ok(await ui.findByRole('button', { name: new RegExp(`${clientAppTestHelpers.timeLabel(session.startsAt)} · Disponible`) }));
  fireEvent.click(ui.container.querySelector('.session-card-detail'));
  assert.ok(await ui.findByRole('dialog'));
  fireEvent.click(ui.getByRole('button', { name: 'Reservar' }));
  assert.ok(await ui.findByText('No se ha podido completar esta operación. Puedes volver a intentarlo.'));
  fireEvent.click(ui.getByRole('button', { name: 'Reservar' }));
  assert.ok(await ui.findByText('Reserva realizada correctamente.'));
  assert.equal(ui.queryByRole('dialog'), null);
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
    if (url === '/api/me/membership') { const assignment = { id: 'eeeeeee1-eeee-4eee-8eee-eeeeeeeeeeee', planName: 'Plan funcional', kind: 'monthly', status: 'active', startsOn: '2026-10-01', endsOn: null, lastEvent: 'activated', rights: [], modules: [{ module: 'training', accessLevel: 'read', capabilities: ['training.autonomous'] }] }; return new Response(JSON.stringify({ assignments: [assignment], active: [assignment], asOf: '2026-10-23', timezone: 'Atlantic/Canary' })); }
    if (url === '/api/me/booking-access') return new Response(JSON.stringify({ enabled: false }));
    if (url === '/api/me/bookings') return new Response(JSON.stringify({ reservations: [], waitlist: [] }));
    if (url === '/api/me/booking-services') return new Response(JSON.stringify({ services: [{ id: session.serviceId, name: session.serviceName }] }));
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
  fireEvent.click(await ui.findByRole('button', { name: /Fuerza/ }));
  fireEvent.click(ui.container.querySelector('.session-card-detail'));
  assert.ok(within(await ui.findByRole('dialog')).getByText('Las reservas desde la app todavía no están activadas para esta cuenta.'));
  assert.equal(ui.getByRole('button', { name: 'Reservar' }).disabled, true);
  assert.equal(mutationAttempted, false);
  cleanup(); dom.window.close();
});

test('Member sees compact class cards, confirms waitlist, and finds both in Próximas/Historial', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-10T10:00:00.000Z') });
  t.after(() => t.mock.timers.reset());
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document }, navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    sessionStorage: { configurable: true, value: dom.window.sessionStorage }, crypto: { configurable: true, value: { randomUUID: (() => { let id = 0; return () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++id).padStart(12, '0')}`; })() } },
  });
  const { render, cleanup, fireEvent, ClientApp, clientAppTestHelpers } = await uiHarness();
  const service = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Funcional' };
  const date = '2026-10-13';
  const base = { serviceId: service.id, serviceName: service.name, areaName: 'La Sala', professionalName: 'Alex Rivera', durationMinutes: 45, capacity: 8, waitlistCount: 0, isIndividual: false, status: 'scheduled', myReservationStatus: null, myWaitlistStatus: null };
  const free = { ...base, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', startsAt: '2026-10-13T17:00:00.000Z', occupiedCount: 3 };
  const full = { ...base, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', startsAt: '2026-10-13T19:00:00.000Z', occupiedCount: 8, waitlistCount: 1 };
  const details = { [free.id]: { ...free, eligible: true, canJoinWaitlist: false, availableAlternatives: [] }, [full.id]: { ...full, eligible: false, eligibilityReason: 'session_full', canJoinWaitlist: true, availableAlternatives: [] } };
  const mutations = []; let booked = false; let joinedWaitlist = false; let cancelled = false;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === '/api/me') return new Response(JSON.stringify({ profile: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', firstName: 'Lucía', lastName: 'Piloto', email: null, status: 'active' } }));
    if (url === '/api/me/membership') { const assignment = { id: 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa', planName: 'Plan activo', kind: 'monthly', status: 'active', startsOn: '2026-10-01', endsOn: null, lastEvent: 'activated', rights: [], modules: [] }; return new Response(JSON.stringify({ assignments: [assignment], active: [assignment], asOf: '2026-10-23', timezone: 'Atlantic/Canary' })); }
    if (url === '/api/me/booking-access') return new Response(JSON.stringify({ enabled: true }));
    if (url === '/api/me/bookings') return new Response(JSON.stringify(booked ? { reservations: [cancelled ? { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', status: 'cancelled', sessionId: free.id, startsAt: free.startsAt, durationMinutes: 45, serviceName: service.name, areaName: 'La Sala', sessionStatus: 'scheduled', isIndividual: false } : { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', status: 'reserved', sessionId: free.id, startsAt: free.startsAt, durationMinutes: 45, serviceName: service.name, areaName: 'La Sala', sessionStatus: 'scheduled', isIndividual: false }], waitlist: joinedWaitlist ? [{ id: 'abababab-abab-4bab-8bab-abababababab', status: 'waiting', sessionId: full.id, startsAt: full.startsAt, durationMinutes: 45, serviceName: service.name, areaName: 'La Sala', sessionStatus: 'scheduled', isIndividual: false }] : [] } : { reservations: [], waitlist: [] }));
    if (url === '/api/me/booking-services') return new Response(JSON.stringify({ services: [service] }));
    if (url.startsWith('/api/me/sessions?')) return new Response(JSON.stringify({ sessions: [free, full] }));
    if (url === '/api/client-portal/form-assignments' || url === '/api/client-portal/consents') return new Response('[]');
    if (url === '/api/me/news') return new Response(JSON.stringify({ items: [], featured: null }));
    if (url === '/api/me/store/catalog' || url === '/api/me/store/purchases') return new Response(JSON.stringify({ items: [] }));
    if (url === '/api/me/preferences') return new Response(JSON.stringify({ preferences: { appearance: 'dark', language: 'es' } }));
    if (url === '/api/me/notifications/unread-count') return new Response(JSON.stringify({ count: 0 }));
    if (url === `/api/me/sessions/${free.id}` || url === `/api/me/sessions/${full.id}`) { const sessionId = url.split('/').at(-1); return new Response(JSON.stringify({ session: details[sessionId] })); }
    if (url.endsWith('/cancellation-preview')) return new Response(JSON.stringify({ canCancel: true, cancellation: { summary: 'Si cancelas ahora, recuperarás la sesión.' } }));
    if (init.method === 'POST' && (url.endsWith('/reservations') || url.endsWith('/waitlist'))) { mutations.push({ url, key: new Headers(init.headers).get('idempotency-key') }); if(url.endsWith('/waitlist')) joinedWaitlist=true; else booked = true; return new Response(JSON.stringify({ status: url.endsWith('/waitlist') ? 'waiting' : 'reserved' }), { status: 201 }); }
    if (init.method === 'PATCH' && url.endsWith('/cancel')) { cancelled = true; return new Response(JSON.stringify({ status: 'cancelled' })); }
    throw new Error(`Unexpected request ${init.method ?? 'GET'} ${url}`);
  };
  const ui = render(React.createElement(ClientApp));
  await ui.findByRole('heading', { name: 'Hola, Lucía' });
  fireEvent.click(ui.getByRole('button', { name: /Ver horarios y reservar/ }));
  fireEvent.click(await ui.findByRole('button', { name: /Funcional/ }));
  fireEvent.click(ui.getByRole('button', { name: `${Number(date.slice(-2))}, hay sesiones` }));
  assert.equal(ui.container.querySelectorAll('.session-card').length, 2);
  assert.doesNotMatch(ui.container.textContent, /Repetir cada semana|Todos los lunes|Reserva recurrente/i);
  assert.equal(ui.container.querySelectorAll('.session-card-detail').length, 2);
  assert.equal(ui.container.querySelectorAll('.session-waitlist-button').length, 1);
  assert.equal(ui.container.querySelectorAll('.session-card')[1].textContent.includes(clientAppTestHelpers.timeLabel(full.startsAt)), true);
  assert.equal(ui.container.querySelectorAll('.session-card')[1].textContent.includes('en espera'), false);
  fireEvent.click(ui.container.querySelectorAll('.session-card-detail')[0]);
  assert.ok(await ui.findByRole('dialog'));
  fireEvent.click(await ui.findByRole('button', { name: 'Reservar' }));
  assert.ok(await ui.findByText('Reserva realizada correctamente.'));
  fireEvent.click(await ui.findByRole('button', { name: 'Lista de espera' }));
  assert.ok(await ui.findByRole('dialog', { name: /¿Quieres apuntarte/ }));
  assert.ok(ui.getByText(/no garantiza una plaza/i));
  fireEvent.click(ui.getByRole('button', { name: 'Confirmar solicitud' }));
  assert.ok(await ui.findByText('Solicitud enviada. La lista de espera no garantiza una plaza.'));
  assert.equal(joinedWaitlist,true);
  assert.equal(mutations.length, 2);
  assert.equal(new Set(mutations.map(item => item.key)).size, 2);
  assert.ok(mutations.some(item => item.url.endsWith('/reservations')));
  assert.ok(mutations.some(item => item.url.endsWith('/waitlist')));
  fireEvent.click(ui.getByRole('button', { name: 'Inicio' }));
  assert.ok(await ui.findByRole('heading', { name: 'Próxima reserva' }));
  assert.ok(ui.getByText('Confirmada'));
  assert.equal(ui.container.querySelector('.home-next-booking')?.textContent.includes('Lista de espera'), false);
  fireEvent.click(ui.getByRole('button', { name: 'Cancelar' }));
  assert.ok(await ui.findByRole('dialog', { name: '¿Cancelar esta reserva?' }));
  assert.ok(ui.getByText('Si cancelas ahora, recuperarás la sesión.'));
  fireEvent.click(ui.getByRole('button', { name: 'Cancelar reserva' }));
  await ui.findByText('La reserva se ha cancelado.');
  assert.equal(ui.container.querySelector('.home-next-booking'), null);
  fireEvent.click(ui.getByRole('button', { name: 'Perfil' }));
  fireEvent.click(ui.getByRole('button', { name: /Próximas e historial/ }));
  await ui.findByRole('heading', { name: 'Mis reservas' });
  assert.equal(ui.getByRole('tab', { name: 'Próximas' }).getAttribute('aria-selected'), 'true');
  assert.ok(ui.getByText('En lista de espera'));
  assert.equal(ui.container.querySelectorAll('[role="tab"]').length,2);
  assert.equal(ui.container.textContent.includes('posición'),false);
  fireEvent.keyDown(ui.getByRole('tab', { name: 'Próximas' }), { key: 'ArrowRight' });
  assert.equal(ui.getByRole('tab', { name: 'Historial' }).getAttribute('aria-selected'), 'true');
  fireEvent.keyDown(ui.getByRole('tab', { name: 'Historial' }), { key: 'ArrowLeft' });
  assert.equal(ui.getByRole('tab', { name: 'Próximas' }).getAttribute('aria-selected'), 'true');
  fireEvent.click(ui.getByRole('tab', { name: 'Historial' }));
  assert.ok(await ui.findByText('Cancelada'));
  cleanup(); dom.window.close();
});

test('D31 keeps Home, Profile, Store and Búnker entry available without a fee and does not load booking operations', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document }, navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    sessionStorage: { configurable: true, value: dom.window.sessionStorage },
  });
  const requests = [];
  const notice = { id: '19111111-1111-4111-8111-111111111111', type: 'booking_confirmed', title: 'Aviso de agenda', body: 'Acceso al calendario.', deeplink: '/sessions/22222222-2222-4222-8222-222222222222', createdAt: '2026-10-22T10:00:00.000Z', readAt: null };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input); requests.push(url);
    if (url === '/api/me') return new Response(JSON.stringify({ profile: { id: '18111111-1111-4111-8111-111111111111', firstName: 'Noa', lastName: 'Sin Cuota', email: null, status: 'active' } }));
    if (url === '/api/me/membership') return new Response(JSON.stringify({ assignments: [], active: [], asOf: '2026-10-23', timezone: 'Atlantic/Canary' }));
    if (url === '/api/client-portal/form-assignments' || url === '/api/client-portal/consents') return new Response('[]');
    if (url === '/api/me/preferences') return new Response(JSON.stringify({ preferences: { appearance: 'dark', language: 'es' } }));
    if (url === '/api/me/news') return new Response(JSON.stringify({ items: [], featured: null }));
    if (url === '/api/me/store/catalog' || url === '/api/me/store/purchases') return new Response(JSON.stringify({ items: [] }));
    if (url === '/api/me/notifications/unread-count') return new Response(JSON.stringify({ count: notice.readAt ? 0 : 1 }));
    if (url === '/api/me/notifications') return new Response(JSON.stringify({ items: [notice], nextBefore: null, nextBeforeId: null }));
    if (url.endsWith('/read') && init.method === 'PATCH') { notice.readAt = new Date().toISOString(); return new Response(JSON.stringify({ id: notice.id, readAt: notice.readAt })); }
    if (url === '/api/me/training-summary') return new Response(JSON.stringify({ status: 'not_linked' }));
    throw new Error(`Unexpected request ${url}`);
  };
  const { render, cleanup, fireEvent, within, ClientApp } = await uiHarness();
  const ui = render(React.createElement(ClientApp));
  assert.ok(await ui.findByRole('heading', { name: 'Hola, Noa' }));
  assert.equal(ui.container.querySelector('.home-book-cta'), null);
  assert.equal(ui.container.querySelector('.home-next-booking'), null);
  const navigation = ui.getByRole('navigation', { name: 'Navegación principal' });
  assert.equal(navigation.querySelectorAll('button').length, 5);
  fireEvent.click(within(navigation).getByRole('button', { name: 'Perfil' }));
  assert.ok(await ui.findByRole('heading', { name: 'Perfil' }));
  assert.ok(ui.getByText('No tienes ninguna cuota activa.'));
  assert.equal(ui.queryByRole('heading', { name: 'Mis reservas' }), null);
  assert.ok(ui.getByRole('heading', { name: 'Contratos y certificados' }));
  assert.ok(ui.getByRole('heading', { name: 'Mensajes y avisos' }));
  fireEvent.click(within(navigation).getByRole('button', { name: 'Tienda' }));
  assert.ok(await ui.findByRole('heading', { name: 'Tienda' }));
  fireEvent.click(within(navigation).getByRole('button', { name: 'Búnker' }));
  assert.ok(await ui.findByRole('heading', { name: 'Búnker' }));
  assert.ok(ui.getByRole('link', { name: /Abrir Búnker/ }));
  fireEvent.click(ui.getByRole('button', { name: /Notificaciones/ }));
  await ui.findByRole('heading', { name: 'Notificaciones' });
  fireEvent.click(ui.getByRole('button', { name: 'Abrir aviso: Aviso de agenda' }));
  assert.ok(await ui.findByRole('heading', { name: 'Reservas no disponibles' }));
  notice.deeplink = '/bookings';
  fireEvent.click(ui.getByRole('button', { name: /Notificaciones/ }));
  await ui.findByRole('heading', { name: 'Notificaciones' });
  fireEvent.click(ui.getByRole('button', { name: 'Abrir aviso: Aviso de agenda' }));
  assert.ok(await ui.findByRole('heading', { name: 'Mis reservas' }));
  assert.ok(ui.getByText(/El acceso a reservas requiere una cuota vigente/));
  assert.equal(requests.some(url => url === '/api/me/bookings' || url === '/api/me/booking-access' || url.startsWith('/api/me/sessions?') || url === '/api/me/booking-services'), false);
  cleanup(); dom.window.close();
});

test('push settings require a gesture, register the session-owned device and withdraw account consent', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document }, navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    sessionStorage: { configurable: true, value: dom.window.sessionStorage },
    Notification: { configurable: true, value: { permission: 'default', requestPermission: async () => { globalThis.Notification.permission = 'granted'; return 'granted'; } } },
  });
  Object.defineProperty(window, 'PushManager', { configurable: true, value: class PushManager {} });
  const calls = [];
  let consent = 'unset'; let subscribed = false;
  const subscription = { endpoint: 'https://push.example.test/device', toJSON: () => ({ endpoint: 'https://push.example.test/device', keys: { p256dh: 'p'.repeat(40), auth: 'a'.repeat(16) } }), unsubscribe: async () => { subscribed = false; return true; } };
  const pushManager = { getSubscription: async () => subscribed ? subscription : null, subscribe: async () => { subscribed = true; return subscription; } };
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve({ pushManager }) } });
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input); calls.push({ url, init });
    if (url === '/api/me') return new Response(JSON.stringify({ profile: { id: '18111111-1111-4111-8111-111111111112', firstName: 'Iria', lastName: 'Avisos', email: null, status: 'active' } }));
    if (url === '/api/me/membership') return new Response(JSON.stringify({ assignments: [], active: [], asOf: '2026-10-23', timezone: 'Atlantic/Canary' }));
    if (url === '/api/client-portal/form-assignments' || url === '/api/client-portal/consents') return new Response('[]');
    if (url === '/api/me/preferences') return new Response(JSON.stringify({ preferences: { appearance: 'dark', language: 'es' } }));
    if (url === '/api/me/news') return new Response(JSON.stringify({ items: [], featured: null }));
    if (url === '/api/me/store/catalog' || url === '/api/me/store/purchases') return new Response(JSON.stringify({ items: [] }));
    if (url === '/api/me/notifications/unread-count') return new Response(JSON.stringify({ count: 0 }));
    if (url === '/api/me/push/config') return new Response(JSON.stringify({ enabled: true, vapidPublicKey: Buffer.alloc(65, 4).toString('base64url'), consent, activeDevices: subscribed ? 1 : 0 }));
    if (url === '/api/me/push/consent' && init.method === 'PUT') { assert.equal(init.credentials, 'include'); consent = JSON.parse(init.body).granted ? 'granted' : 'revoked'; return new Response(JSON.stringify({ consent })); }
    if (url === '/api/me/push/subscriptions' && init.method === 'POST') { assert.equal(init.credentials, 'include'); return new Response(JSON.stringify({ id: 'push-device-1' }), { status: 201 }); }
    if (url === '/api/me/training-summary') return new Response(JSON.stringify({ status: 'not_linked' }));
    throw new Error(`Unexpected request ${url}`);
  };
  const { render, cleanup, fireEvent, ClientApp } = await uiHarness();
  const ui = render(React.createElement(ClientApp));
  await ui.findByRole('heading', { name: 'Hola, Iria' });
  fireEvent.click(ui.getByRole('button', { name: 'Ajustes' }));
  const enable = await ui.findByRole('button', { name: 'Activar en este dispositivo' });
  assert.equal(calls.some(call => call.url === '/api/me/push/consent'), false, 'no consent before the member presses the button');
  fireEvent.click(enable);
  await ui.findByRole('button', { name: 'Desactivar en todos los dispositivos' });
  assert.equal(consent, 'granted');
  assert.equal(subscribed, true);
  const subscribe = calls.find(call => call.url === '/api/me/push/subscriptions');
  assert.ok(subscribe);
  assert.equal(JSON.parse(subscribe.init.body).endpoint, subscription.endpoint);
  fireEvent.click(ui.getByRole('button', { name: 'Desactivar en todos los dispositivos' }));
  await ui.findByRole('button', { name: 'Activar en este dispositivo' });
  assert.equal(consent, 'revoked');
  assert.equal(subscribed, false);
  assert.equal(calls.filter(call => call.url === '/api/me/push/consent').length, 2);
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
  const activePlan = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', planName: 'Plan mensual', kind: 'monthly', status: 'active', startsOn: '2026-10-01', endsOn: null, lastEvent: 'activated', rights: [{ rightType: 'sessions_quota', serviceId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', serviceName: 'Pilates', serviceStatus: 'active', quantity: 8, balance: 3 }] };
  let acceptedPayload; let formSubmitted = false;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === '/api/me') return new Response(JSON.stringify({ profile: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', firstName: 'Lucía', lastName: 'Díaz', email: null, status: 'active' } }), { status: 200 });
    if (url === '/api/me/membership') return new Response(JSON.stringify({ assignments: [activePlan], active: [activePlan], asOf: '2026-10-23', timezone: 'Atlantic/Canary' }), { status: 200 });
    if (url === '/api/me/booking-access') return new Response(JSON.stringify({ enabled: false }), { status: 200 });
    if (url === '/api/me/bookings') return new Response(JSON.stringify({ reservations: [], waitlist: [] }), { status: 200 });
    if (url.startsWith('/api/me/sessions?')) return new Response(JSON.stringify({ timezone: 'Atlantic/Canary', sessions: [] }), { status: 200 });
    if (url === '/api/client-portal/form-assignments') return new Response(JSON.stringify(formSubmitted ? [{ ...assignment, status: 'submitted' }] : [assignment]), { status: 200 });
    if (url === '/api/client-portal/consents') return new Response(JSON.stringify([{ ...consent, accepted: Boolean(acceptedPayload) }]), { status: 200 });
    if (url === '/api/me/notifications') return new Response(JSON.stringify({ items: [], nextBefore: null, nextBeforeId: null }), { status: 200 });
    if (url === '/api/me/notifications/unread-count') return new Response(JSON.stringify({ count: 2 }), { status: 200 });
    if (url === `/api/client-portal/form-assignments/${assignment.id}`) return new Response(JSON.stringify({ ...assignment, description: 'Datos básicos.', sensitivity: 'operational', fields: [{ id: 'goal', label: 'Objetivo principal', type: 'short_text', required: true }] }), { status: 200 });
    if (url.endsWith('/respond') && init.method === 'POST') { formSubmitted = true; return new Response(JSON.stringify({ status: 'submitted' }), { status: 201 }); }
    if (url === `/api/client-portal/consents/${consent.versionId}/accept` && init.method === 'POST') { acceptedPayload = JSON.parse(init.body); return new Response(JSON.stringify({ id: 'acceptance', acceptedAt: new Date().toISOString() }), { status: 201 }); }
    throw new Error(`Unexpected request ${init.method ?? 'GET'} ${url}`);
  };
  const { render, cleanup, fireEvent, ClientApp } = await uiHarness();
  const ui = render(React.createElement(ClientApp));
  assert.ok(await ui.findByRole('heading', { name: 'Hola, Lucía' }));
  fireEvent.click(ui.getByRole('button', { name: 'Perfil', exact: true }));
  assert.ok(await ui.findByRole('heading', { name: 'Perfil' }));
  for (const section of ['Tus cuotas', 'Servicios asociados', 'Tus compras', 'Mensajes y avisos', 'Contratos y certificados']) assert.ok(ui.getByRole('heading', { name: section }));
  assert.ok(ui.getByText('Plan mensual'));
  assert.ok(ui.getByText('Pilates'));
  assert.ok(ui.getAllByText(/3 disponibles/).length >= 2);
  assert.ok(ui.getByText('Tus compras y tickets del centro aparecerán aquí.'));
  assert.ok(ui.getByText('2 avisos sin leer'));
  assert.ok(ui.getByText('Pendiente de completar'));
  assert.ok(ui.getAllByText('Requerido').length >= 2);
  assert.equal(ui.getByRole('navigation', { name: 'Navegación principal' }).querySelector('[aria-current="page"]')?.textContent.trim(), 'Perfil');
  fireEvent.click(ui.getByRole('button', { name: /Abrir buzón/ }));
  assert.ok(await ui.findByRole('heading', { name: 'Notificaciones' }));
  assert.equal(ui.getByRole('navigation', { name: 'Navegación principal' }).querySelector('[aria-current="page"]')?.textContent.trim(), 'Perfil');
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
  assert.ok(await ui.findByText('Cuestionario de bienvenida'));
  assert.ok(ui.getByText('Enviado · pendiente de revisión'));
  assert.equal(ui.queryByText('Todavía no hay documentos completados o enviados.'), null);
  fireEvent.click(ui.getByRole('button', { name: 'Consultar' }));
  assert.ok(await ui.findByRole('dialog', { name: 'Normas del centro' }));
  fireEvent.click(ui.getByLabelText('He leído y acepto este consentimiento.'));
  fireEvent.change(ui.getByLabelText('Nombre completo'), { target: { value: 'Lucía Díaz' } });
  fireEvent.click(ui.getByRole('button', { name: 'Confirmar aceptación' }));
  assert.ok(await ui.findByText('Tu aceptación se ha guardado.'));
  assert.deepEqual(acceptedPayload, { typedName: 'Lucía Díaz', accepted: true });
  assert.ok(ui.getByText('Aceptado'));
  cleanup(); dom.window.close();
});

test('D31 lets a client without a fee read assigned documents and submit an assigned form and consent', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    HTMLInputElement: { configurable: true, value: dom.window.HTMLInputElement }, sessionStorage: { configurable: true, value: dom.window.sessionStorage },
    crypto: { configurable: true, value: { randomUUID: () => 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' } },
  });
  const assignment = { id: '11111111-1111-4111-8111-111111111111', name: 'Ficha de bienvenida', status: 'assigned', required: true, dueAt: null, category: 'onboarding', version: 1 };
  const consent = { consentId: '22222222-2222-4222-8222-222222222222', versionId: '33333333-3333-4333-8333-333333333333', title: 'Normas del centro', body: 'Texto aprobado.', version: 1, required: true, accepted: false };
  let formSent = false; let accepted = false; let consentPayload;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input); requests.push({ url, method: init.method ?? 'GET' });
    if (url === '/api/me') return new Response(JSON.stringify({ profile: { id: '44444444-4444-4444-8444-444444444444', firstName: 'Lola', lastName: 'Sin cuota', email: null, status: 'active' } }));
    if (url === '/api/me/membership') return new Response(JSON.stringify({ assignments: [], active: [], asOf: '2026-10-23', timezone: 'Atlantic/Canary' }));
    if (url === '/api/me/preferences') return new Response(JSON.stringify({ preferences: { appearance: 'dark', language: 'es' } }));
    if (url === '/api/me/news') return new Response(JSON.stringify({ items: [], featured: null }));
    if (url === '/api/me/store/catalog' || url === '/api/me/store/purchases') return new Response(JSON.stringify({ items: [] }));
    if (url === '/api/client-portal/form-assignments') return new Response(JSON.stringify([{ ...assignment, status: formSent ? 'submitted' : 'assigned' }]));
    if (url === '/api/client-portal/consents') return new Response(JSON.stringify([{ ...consent, accepted }]));
    if (url === `/api/client-portal/form-assignments/${assignment.id}`) return new Response(JSON.stringify({ ...assignment, description: 'Datos de bienvenida.', sensitivity: 'operational', fields: [{ id: 'goal', label: 'Objetivo principal', type: 'short_text', required: true }] }));
    if (url.endsWith('/respond') && init.method === 'POST') { formSent = true; return new Response(JSON.stringify({ status: 'submitted' }), { status: 201 }); }
    if (url === `/api/client-portal/consents/${consent.versionId}/accept` && init.method === 'POST') { consentPayload = JSON.parse(init.body); accepted = true; return new Response(JSON.stringify({ id: 'acceptance', acceptedAt: '2026-10-23T12:00:00.000Z' }), { status: 201 }); }
    if (url === '/api/me/notifications/unread-count') return new Response(JSON.stringify({ count: 0 }));
    throw new Error(`Unexpected request ${init.method ?? 'GET'} ${url}`);
  };
  const { render, cleanup, fireEvent, ClientApp } = await uiHarness();
  const ui = render(React.createElement(ClientApp));
  assert.ok(await ui.findByRole('heading', { name: 'Hola, Lola' }));
  fireEvent.click(ui.getByRole('button', { name: 'Perfil', exact: true }));
  fireEvent.click(ui.getByRole('button', { name: 'Completar' }));
  assert.ok(await ui.findByRole('dialog', { name: 'Ficha de bienvenida' }));
  const answer = await ui.findByLabelText(/Objetivo principal/);
  const setInputValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  setInputValue.call(answer, 'Mejorar movilidad');
  answer.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  answer.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  fireEvent.click(ui.getByRole('button', { name: 'Enviar documento' }));
  assert.ok(await ui.findByText('Enviado · pendiente de revisión'));
  fireEvent.click(ui.getByRole('button', { name: 'Consultar' }));
  fireEvent.click(ui.getByLabelText('He leído y acepto este consentimiento.'));
  fireEvent.change(ui.getByLabelText('Nombre completo'), { target: { value: 'Lola Sin cuota' } });
  fireEvent.click(ui.getByRole('button', { name: 'Confirmar aceptación' }));
  assert.ok(await ui.findByText('Aceptado'));
  assert.deepEqual(consentPayload, { typedName: 'Lola Sin cuota', accepted: true });
  assert.equal(requests.some(request => request.url === '/api/me/booking-access' || request.url === '/api/me/bookings'), false);
  cleanup(); dom.window.close();
});

test('2J Hub preview is build-gated, presents five destinations and never calls the API', async (t) => {
  const { isHubPreviewEnabled, isHubDemoBuild, HUB_TRAINING_URL } = await import('../src/client-app.tsx').then(({clientAppTestHelpers}) => clientAppTestHelpers);
  assert.equal(isHubDemoBuild(true), true);
  assert.equal(isHubDemoBuild('true'), true);
  assert.equal(isHubDemoBuild(false), false);
  assert.equal(isHubDemoBuild('false'), false);
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
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    HTMLInputElement: { configurable: true, value: dom.window.HTMLInputElement }, HTMLTextAreaElement: { configurable: true, value: dom.window.HTMLTextAreaElement }, HTMLSelectElement: { configurable: true, value: dom.window.HTMLSelectElement }, Event: { configurable: true, value: dom.window.Event },
    sessionStorage: { configurable: true, value: dom.window.sessionStorage }, crypto: { configurable: true, value: { randomUUID: () => '11111111-1111-4111-8111-111111111111' } },
  });
  const requests = [];
  globalThis.fetch = async (input, init = {}) => { requests.push({ url: String(input), method: init.method ?? 'GET' }); throw new Error('Preview must not reach fetch.'); };
  const { render, cleanup, fireEvent, within, ClientApp } = await uiHarness();
  const ui = render(React.createElement(ClientApp, { previewModeOverride: true }));
  assert.ok(await ui.findByRole('heading', { name: 'Hola, Juan' }));
  assert.ok(ui.getByText('DEMO · DATOS FICTICIOS', { selector: '.preview-pill' }));
  assert.ok(ui.getByRole('heading', { name: 'Próxima reserva' }));
  assert.ok(ui.getByText('Bienvenido a tu espacio 2J'));
  assert.ok(ui.getByText('Funcional'));
  assert.ok(ui.getByText('Confirmada'));

  const navigation = ui.getByRole('navigation', { name: 'Navegación principal' });
  assert.deepEqual(within(navigation).getAllByRole('button').map(button => button.textContent.trim()), ['Inicio', 'Búnker', 'Tienda', 'Perfil', 'Ajustes']);
  assert.equal(within(navigation).getByRole('button', { name: 'Inicio', exact: true }).getAttribute('aria-current'), 'page');
  fireEvent.click(within(navigation).getByRole('button', { name: 'Perfil' }));
  assert.ok(await ui.findByText('Plan 2J'));
  assert.ok(ui.getByText('Funcional'));
  assert.ok(ui.getAllByText(/8 disponibles/).length >= 2);
  assert.ok(ui.getByText('juan.demo@example.test'));
  assert.ok(ui.getByRole('button', { name: /Abrir buzón/ }));
  assert.equal(within(navigation).getByRole('button', { name: 'Perfil' }).getAttribute('aria-current'), 'page');
  fireEvent.click(within(navigation).getByRole('button', { name: 'Inicio' }));
  for (const oldLabel of ['Reservar', 'Entrenar', 'Centro']) assert.equal(within(navigation).queryByRole('button', { name: oldLabel, exact: true }), null);
  assert.equal(ui.container.querySelectorAll('.home-news,.home-book-cta,.home-next-booking').length, 3);
  assert.equal(ui.getByText('Selecciona actividad, día y hora.' ) != null, true);
  assert.equal(within(navigation).queryByRole('button', { name: /notificaciones/i }), null);

  fireEvent.click(within(navigation).getByRole('button', { name: 'Búnker' }));
  assert.ok(await ui.findByRole('heading', { name: 'Búnker' }));
  assert.ok(ui.getByText('La conexión con Búnker no está activa en esta demo sintética.'));
  assert.equal(ui.queryByRole('link', { name: /Abrir Búnker/ }), null, 'demo must not navigate to the real Búnker app');
  assert.equal(ui.getByRole('button', { name: 'Abrir Búnker' }).disabled, true);
  assert.ok(ui.getByText('La demo no abre aplicaciones ni servicios externos.'));

  fireEvent.click(within(navigation).getByRole('button', { name: 'Tienda' }));
  assert.ok(await ui.findByRole('heading', { name: 'Tienda' }));
  assert.ok(ui.getByRole('button', { name: 'Nutrición' }));
  assert.ok(ui.getByRole('button', { name: 'Merchandising' }));
  assert.ok(ui.getByRole('heading', { name: 'Proteína 2J' }));
  assert.ok(ui.getByText('Consulta los productos disponibles. Las compras se gestionan directamente en el centro.'));
  fireEvent.click(within(navigation).getByRole('button', { name: 'Ajustes' }));
  assert.ok(await ui.findByRole('heading', { name: 'Ajustes' }));
  assert.ok(ui.getByRole('heading', { name: 'Notificaciones' }));
  assert.ok(ui.getByText('Las opciones que afectan únicamente a tus entrenamientos se gestionan dentro de Búnker.'));
  assert.equal(ui.getByRole('radio', { name: /Sistema/ }).checked, true);
  fireEvent.click(ui.getByRole('radio', { name: /Claro/ }));
  assert.ok(ui.container.querySelector('.client-app')?.classList.contains('hub-theme-light'));
  assert.ok(ui.getByText('Vista previa: el cambio solo se aplica aquí.'));
  fireEvent.click(ui.getByRole('radio', { name: /Oscuro/ }));
  assert.equal(ui.container.querySelector('.client-app')?.classList.contains('hub-theme-light'), false);
  assert.equal(dom.window.localStorage.getItem('2j.member.appearance.v1'), null, 'preview does not persist appearance hints');
  assert.equal(ui.queryByRole('heading', { name: 'Herramientas del piloto' }), null, 'public demo must not expose staff/admin pilot tools');
  assert.equal(ui.queryByRole('link', { name: /Abrir área de entrenador|Abrir administración/ }), null);
  assert.equal(ui.queryByRole('button', { name: 'Copiar información de diagnóstico' }), null);
  assert.equal(ui.queryByText(/Vista piloto/), null);
  assert.deepEqual(requests, [], 'preview appearance changes stay local and preview makes zero API calls');

  fireEvent.click(within(navigation).getByRole('button', { name: 'Inicio' }));
  fireEvent.click(ui.getByRole('button', { name: /Ver horarios y reservar/ }));
  assert.ok(await ui.findByRole('heading', { name: 'Reservar' }));
  fireEvent.click(ui.getByRole('button', { name: /Funcional/ }));
  fireEvent.click(ui.container.querySelectorAll('.session-card-detail')[0]);
  assert.ok(await ui.findByRole('dialog'));
  assert.ok(ui.getByText('Ya tienes una reserva asociada a esta sesión.'));
  fireEvent.click(ui.getByRole('button', { name: 'Cerrar detalle' }));
  fireEvent.click(ui.container.querySelectorAll('.month-day.has-sessions')[1]);
  fireEvent.click(ui.container.querySelectorAll('.session-card-detail')[0]);
  assert.ok(await ui.findByRole('dialog'));
  assert.ok(ui.getByText('Vista previa: las acciones no se envían.'));
  assert.equal(ui.getByRole('button', { name: 'Reservar' }).disabled, true);

  fireEvent.click(within(navigation).getByRole('button', { name: 'Perfil' }));
  assert.ok(await ui.findByRole('heading', { name: 'Perfil' }));
  assert.ok(ui.getByText('Plan 2J'));
  assert.ok(ui.getByRole('heading', { name: 'Tus cuotas' }));
  assert.ok(ui.getByRole('heading', { name: 'Contratos y certificados' }));
  assert.ok(ui.getByRole('heading', { name: 'Mensajes y avisos' }));
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

test('Inicio hides the upcoming booking card when empty and Perfil keeps access to Mis reservas', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    sessionStorage: { configurable: true, value: dom.window.sessionStorage }, crypto: { configurable: true, value: { randomUUID: () => 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' } },
  });
  globalThis.fetch = async input => {
    const url = String(input);
    if (url === '/api/me') return new Response(JSON.stringify({ profile: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', firstName: 'Eva', lastName: 'Piloto', email: null, status: 'active' } }));
    if (url === '/api/me/membership') { const assignment = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', planName: 'Plan 2J', kind: 'monthly', status: 'active', startsOn: '2026-10-01', endsOn: null, lastEvent: 'activated', rights: [], modules: [] }; return new Response(JSON.stringify({ assignments: [assignment], active: [assignment], asOf: '2026-10-23', timezone: 'Atlantic/Canary' })); }
    if (url === '/api/me/booking-access') return new Response(JSON.stringify({ enabled: false }));
    if (url === '/api/me/bookings') return new Response(JSON.stringify({ reservations: [], waitlist: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'waiting', sessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 45, serviceName: 'Funcional', areaName: 'La Sala', sessionStatus: 'scheduled', isIndividual: false }] }));
    if (url.startsWith('/api/me/sessions?')) return new Response(JSON.stringify({ sessions: [] }));
    if (url === '/api/client-portal/form-assignments' || url === '/api/client-portal/consents') return new Response(JSON.stringify([]));
    if (url === '/api/me/notifications/unread-count') return new Response(JSON.stringify({ count: 0 }));
    if (url === '/api/me/news') return new Response(JSON.stringify({ items: [], featured: null }));
    if (url.startsWith('/api/me/notifications')) return new Response(JSON.stringify({ items: [] }));
    throw new Error(`Unexpected request ${url}`);
  };
  const { render, cleanup, fireEvent, ClientApp } = await uiHarness();
  const ui = render(React.createElement(ClientApp));
  assert.ok(await ui.findByRole('heading', { name: 'Hola, Eva' }));
  assert.equal(ui.container.querySelector('.home-next-booking'), null);
  assert.ok(ui.getByText('Ahora mismo no hay noticias publicadas.'));
  assert.equal(ui.container.querySelectorAll('.home-news,.home-book-cta,.home-next-booking').length, 2);
  fireEvent.click(ui.getByRole('button', { name: 'Perfil' }));
  assert.ok(await ui.findByRole('heading', { name: 'Mis reservas' }));
  fireEvent.click(ui.getByRole('button', { name: /Próximas e historial/ }));
  assert.ok(await ui.findByRole('heading', { name: 'Mis reservas' }));
  assert.equal(ui.getByRole('navigation', { name: 'Navegación principal' }).querySelectorAll('button').length, 5);
  cleanup(); dom.window.close();
});

test('Inicio reads Center News independently from notifications and opens a newest-first list and detail under Inicio', async()=>{
  const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost/'});
  Object.defineProperties(globalThis,{window:{configurable:true,value:dom.window},document:{configurable:true,value:dom.window.document},navigator:{configurable:true,value:dom.window.navigator},HTMLElement:{configurable:true,value:dom.window.HTMLElement},sessionStorage:{configurable:true,value:dom.window.sessionStorage}});
  const olderFeatured={id:'11111111-1111-4111-8111-111111111111',title:'Aviso importante del centro',body:'Este contenido viene del dominio de noticias.',featured:true,publishedAt:'2026-10-01T10:00:00Z'};
  const newer={id:'22222222-2222-4222-8222-222222222222',title:'Novedad más reciente',body:'Otra noticia publicada.',featured:false,publishedAt:'2026-10-02T10:00:00Z'};
  let newsRequests=0;let notificationListRequests=0;
  globalThis.fetch=async input=>{
    const url=String(input);
    if(url==='/api/me')return new Response(JSON.stringify({profile:{id:'33333333-3333-4333-8333-333333333333',firstName:'Eva',lastName:'News',email:null,status:'active'}}));
    if(url==='/api/me/membership')return new Response(JSON.stringify({assignments:[],active:[],asOf:'2026-10-23',timezone:'Atlantic/Canary'}));
    if(url==='/api/me/bookings')return new Response(JSON.stringify({reservations:[],waitlist:[]}));
    if(url==='/api/me/booking-access')return new Response(JSON.stringify({enabled:false}));
    if(url.startsWith('/api/me/sessions?'))return new Response(JSON.stringify({sessions:[]}));
    if(url==='/api/client-portal/form-assignments'||url==='/api/client-portal/consents')return new Response(JSON.stringify([]));
    if(url==='/api/me/notifications/unread-count')return new Response(JSON.stringify({count:0}));
    if(url==='/api/me/news'){newsRequests++;return new Response(JSON.stringify({items:[newer,olderFeatured],featured:olderFeatured}));}
    if(url.startsWith('/api/me/notifications')){notificationListRequests++;return new Response(JSON.stringify({items:[{id:'44444444-4444-4444-8444-444444444444',type:'center_notice',title:'No debe aparecer en Noticias',body:'Aviso de sistema.',createdAt:'2026-10-03T10:00:00Z',readAt:null,deeplink:null}]}));}
    throw new Error(`Unexpected request ${url}`);
  };
  const {render,cleanup,fireEvent,within,ClientApp}=await uiHarness();const ui=render(React.createElement(ClientApp));
  assert.ok(await ui.findByRole('heading',{name:'Hola, Eva'}));
  assert.ok(ui.getByRole('heading',{name:olderFeatured.title}));
  assert.equal(ui.queryByText('No debe aparecer en Noticias'),null);
  assert.equal(newsRequests,1);assert.equal(notificationListRequests,0);
  const navigation=ui.getByRole('navigation',{name:'Navegación principal'});
  fireEvent.click(ui.getByRole('button',{name:'Ver noticias'}));
  assert.ok(await ui.findByRole('heading',{name:newer.title}));
  assert.equal(within(navigation).getByRole('button',{name:'Inicio',exact:true}).getAttribute('aria-current'),'page');
  fireEvent.click(ui.getAllByRole('button',{name:'Leer noticia'})[0]);
  assert.ok(await ui.findByRole('heading',{name:newer.title,level:1}));
  assert.equal(within(navigation).getByRole('button',{name:'Inicio',exact:true}).getAttribute('aria-current'),'page');
  fireEvent.click(ui.getByRole('button',{name:/Volver a noticias/}));
  assert.ok(await ui.findByRole('heading',{name:newer.title,level:2}));
  cleanup();dom.window.close();
});

test('Noticias remains available without a fee and recovers from a temporary Platform read failure', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    sessionStorage: { configurable: true, value: dom.window.sessionStorage },
  });
  let newsRequests = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === '/api/me') return new Response(JSON.stringify({ profile: { id: '11111111-1111-4111-8111-111111111111', firstName: 'Eva', lastName: 'Sin cuota', email: null, status: 'active' } }));
    if (url === '/api/me/membership') return new Response(JSON.stringify({ assignments: [], active: [], asOf: '2026-10-23', timezone: 'Atlantic/Canary' }));
    if (url === '/api/me/preferences') return new Response(JSON.stringify({ preferences: { appearance: 'dark', language: 'es' } }));
    if (url === '/api/me/news') { newsRequests++; const featured = { id: '22222222-2222-4222-8222-222222222222', title: 'Horario de apertura', body: 'El sábado abrimos a las nueve.', featured: true, publishedAt: '2026-10-22T09:00:00.000Z' }; return newsRequests === 1 ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ items: [featured], featured })); }
    if (url === '/api/me/store/catalog' || url === '/api/me/store/purchases') return new Response(JSON.stringify({ items: [] }));
    if (url === '/api/client-portal/form-assignments' || url === '/api/client-portal/consents') return new Response('[]');
    if (url === '/api/me/notifications/unread-count') return new Response(JSON.stringify({ count: 0 }));
    throw new Error(`Unexpected request ${url}`);
  };
  const { render, cleanup, fireEvent, ClientApp } = await uiHarness();
  const ui = render(React.createElement(ClientApp));
  assert.ok(await ui.findByRole('heading', { name: 'Hola, Eva' }));
  fireEvent.click(ui.getByRole('button', { name: 'Intentar de nuevo' }));
  assert.ok(await ui.findByRole('heading', { name: 'Horario de apertura' }));
  fireEvent.click(ui.getByRole('button', { name: 'Leer noticia' }));
  assert.ok(await ui.findByRole('heading', { name: 'Horario de apertura', level: 1 }));
  assert.equal(newsRequests, 2);
  assert.equal(ui.container.textContent.includes('urgente'), false, 'Home does not invent the priority absent from the endpoint contract');
  cleanup(); dom.window.close();
});

test('preview Store uses fictional nutrition and merchandising fixtures without API calls; Profile shows fictional purchase',async()=>{
  const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost/?preview=1'});
  Object.defineProperties(globalThis,{window:{configurable:true,value:dom.window},document:{configurable:true,value:dom.window.document},navigator:{configurable:true,value:dom.window.navigator},HTMLElement:{configurable:true,value:dom.window.HTMLElement},sessionStorage:{configurable:true,value:dom.window.sessionStorage}});
  let fetchCount=0;globalThis.fetch=async()=>{fetchCount++;throw new Error('preview must not call the API');};
  const {render,cleanup,fireEvent,ClientApp}=await uiHarness();const ui=render(React.createElement(ClientApp,{previewModeOverride:true}));
  fireEvent.click(ui.getByRole('button',{name:/Tienda/}));assert.ok(ui.getByRole('heading',{name:'Tienda'}));assert.ok(ui.getByRole('heading',{name:'Proteína 2J'}));assert.ok(ui.getByText('Creatina'));assert.equal(ui.queryByRole('button',{name:/Comprar|Carrito|Pagar/}),null);
  fireEvent.click(ui.getByRole('button',{name:'Merchandising'}));assert.ok(ui.getByRole('heading',{name:'Camiseta 2J'}));assert.ok(ui.getByText('Sudadera 2J'));
  fireEvent.click(ui.getByRole('button',{name:'Perfil'}));assert.ok(ui.getByText('Proteína 2J · Chocolate · 900 g × 1'));assert.equal(fetchCount,0);
  cleanup();dom.window.close();
});

test('live Store reads Platform catalog and purchase history, including D31 access without a fee', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    sessionStorage: { configurable: true, value: dom.window.sessionStorage },
  });
  const product = { id: '11111111-1111-4111-8111-111111111111', category: 'nutrition', name: 'Proteína 2J', description: 'Sabor vainilla', variants: [{ id: '22222222-2222-4222-8222-222222222222', label: 'Vainilla · 900 g', size: '900 g', flavor: 'Vainilla', priceCents: 3290, availability: 'pocas_unidades' }] };
  const purchase = { id: '33333333-3333-4333-8333-333333333333', status: 'completed', paymentState: 'paid', totalCents: 3290, createdAt: '2026-10-20T12:00:00.000Z', lines: [{ productName: 'Proteína 2J', variantLabel: 'Vainilla · 900 g', quantity: 1, unitPriceCents: 3290, lineTotalCents: 3290 }] };
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input); requests.push({ url, method: init.method ?? 'GET' });
    if (url === '/api/me') return new Response(JSON.stringify({ profile: { id: '44444444-4444-4444-8444-444444444444', firstName: 'Eva', lastName: 'Piloto', email: null, status: 'active' } }));
    if (url === '/api/me/membership') return new Response(JSON.stringify({ assignments: [], active: [], asOf: '2026-10-23', timezone: 'Atlantic/Canary' }));
    if (url === '/api/me/preferences') return new Response(JSON.stringify({ preferences: { appearance: 'dark', language: 'es' } }));
    if (url === '/api/me/news') return new Response(JSON.stringify({ items: [], featured: null }));
    if (url === '/api/me/store/catalog') return new Response(JSON.stringify({ items: [product] }));
    if (url === '/api/me/store/purchases') return new Response(JSON.stringify({ items: [purchase] }));
    if (url === '/api/client-portal/form-assignments' || url === '/api/client-portal/consents') return new Response('[]');
    if (url === '/api/me/notifications/unread-count') return new Response(JSON.stringify({ count: 0 }));
    throw new Error(`Unexpected request ${init.method ?? 'GET'} ${url}`);
  };
  const { render, cleanup, fireEvent, ClientApp } = await uiHarness();
  const ui = render(React.createElement(ClientApp));
  assert.ok(await ui.findByRole('heading', { name: 'Hola, Eva' }));
  fireEvent.click(ui.getByRole('button', { name: 'Tienda', exact: true }));
  assert.ok(await ui.findByRole('heading', { name: 'Proteína 2J' }));
  assert.ok(ui.getByText('Pocas unidades'));
  fireEvent.click(ui.getByRole('button', { name: 'Merchandising' }));
  assert.ok(ui.getByText('Aún no hay productos en esta categoría.'));
  fireEvent.click(ui.getByRole('button', { name: 'Perfil', exact: true }));
  assert.ok(await ui.findByText('Pagada en el centro'));
  assert.ok(ui.getByText('Proteína 2J · Vainilla · 900 g × 1'));
  assert.equal(requests.some(request => request.url === '/api/me/store/catalog'), true);
  assert.equal(requests.some(request => request.url === '/api/me/store/purchases'), true);
  assert.equal(requests.some(request => request.method !== 'GET'), false);
  cleanup(); dom.window.close();
});
