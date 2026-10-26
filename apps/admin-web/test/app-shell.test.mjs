import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5173/#home' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { AppShell, getProfessionalNavigation, getProfessionalPageContext } = await import('../src/app-shell.tsx');
const { CommandCenter } = await import('../src/command-center.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; });
after(() => dom.window.close());
const response = (body, status=200) => Promise.resolve({ ok:status>=200&&status<300, status, json:async()=>body });
const model = {
  timezone:'Atlantic/Canary',
  permissions:{calendar:true,clients:true,communications:true,documents:true,sensitiveReview:false,followup:true,billing:false,cash:false,transfers:false,staff:true,absences:true,timeclock:true},
  today:{sessionCount:0,upcomingCount:0,capacity:0,occupied:0,waitlistCount:0,unassignedCount:0,nextSession:null},
  clients:{active:12,recentSignups:2},attention:[],economics:null,team:{active:3,workingNow:1,activeAbsences:0,substitutions:0},unread:2,
  quickActions:[{id:'clients',label:'Ver clientes',href:'#clients'}],
};
const capabilities = {calendar:true,clients:true,communications:true,billing:false,staff:true};

test('Admin sees the six professional sections and only their existing authorized routes', async () => {
  const adminCapabilities={calendar:true,clients:true,communications:true,billing:true,staff:true,notificationSettings:true,news:true,store:true};
  globalThis.fetch = async (url) => String(url).includes('/api/dashboard/command-center') ? response(model) : String(url).includes('/api/session/capabilities') ? response(adminCapabilities) : response({groups:[]});
  window.location.hash='#home';render(React.createElement(AppShell, null, React.createElement(CommandCenter)));
  await screen.findByRole('heading',{name:'Próximas sesiones'});
  const nav=within(document.querySelector('.app-navigation'));
  for(const label of ['Resumen','Actividad','Clientes','Mi gimnasio','Equipo','Negocio'])assert.ok(nav.getByRole(label==='Resumen'||label==='Clientes'||label==='Equipo'?'link':'button',{name:label}));
  for(const label of ['Agenda','Servicios','Economía','Tienda','Noticias','Ajustes de avisos'])assert.ok(nav.getByRole('link',{name:label}));
  assert.ok(nav.getByRole('link',{name:/Comunicación/}));
  assert.equal(screen.queryByText('Cobrado hoy'),null);
  assert.ok(screen.getByText('2 mensajes sin leer'));
  assert.ok(screen.getByText('No hay sesiones programadas hoy'));
  assert.equal(document.querySelector('.app-navigation .nav-count')?.textContent,'2');
});

test('Trainer sees only capability-allowed professional sections and no business routes by default',async()=>{
  const trainerCapabilities={calendar:true,clients:true,communications:true,billing:false,staff:true,notificationSettings:false,news:false,store:false};
  globalThis.fetch=async url=>String(url).includes('/api/session/capabilities')?response(trainerCapabilities):String(url).includes('/api/dashboard/command-center')?response(model):response({groups:[]});
  window.location.hash='#home';render(React.createElement(AppShell,null,React.createElement(CommandCenter)));
  await screen.findByRole('heading',{name:'Próximas sesiones'});const nav=within(document.querySelector('.app-navigation'));
  for(const label of ['Resumen','Actividad','Clientes','Mi gimnasio','Equipo'])assert.ok(nav.getByRole(label==='Resumen'||label==='Clientes'||label==='Equipo'?'link':'button',{name:label}));
  assert.equal(nav.queryByRole('button',{name:'Negocio'}),null);
  for(const label of ['Economía','Tienda','Noticias','Ajustes de avisos'])assert.equal(nav.queryByRole('link',{name:label}),null);
  assert.ok(nav.getByRole('link',{name:'Servicios'}));
  assert.equal(screen.queryByText('Cobrado hoy'),null);
});

test('groups disappear when no child is allowed and partial grants expose only their matching subnavigation',()=>{
  const none={calendar:false,clients:false,communications:false,billing:false,staff:false,notificationSettings:false,news:false,store:false};
  assert.deepEqual(getProfessionalNavigation(none).map(item=>item.label),['Resumen']);
  const partial={...none,clients:true,notificationSettings:true};
  const nav=getProfessionalNavigation(partial);
  assert.deepEqual(nav.map(item=>item.label),['Resumen','Clientes','Negocio']);
  assert.deepEqual(nav.find(item=>item.id==='business').children.map(item=>item.label),['Ajustes de avisos']);
});

test('global search opens with Ctrl+K, groups permitted results and closes with Escape', async () => {
  const requests=[];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return String(url).includes('/api/search')
      ? response({groups:[{type:'clients',label:'Clientes',items:[{id:'c-1',label:'María González'}]},{type:'team',label:'Equipo',items:[{id:'p-1',label:'María Pérez'}]}]})
      : String(url).includes('/api/session/capabilities') ? response(capabilities) : response(model);
  };
  render(React.createElement(AppShell, null, React.createElement(CommandCenter)));
  await screen.findByRole('heading',{name:'Próximas sesiones'});
  fireEvent.keyDown(window,{key:'k',ctrlKey:true});
  const input=await screen.findByRole('textbox',{name:'Buscar en 2J'});
  fireEvent.change(input,{target:{value:'María'}});
  await screen.findByRole('link',{name:'María González'});
  assert.ok(screen.getByRole('link',{name:'María Pérez'}));
  await waitFor(()=>assert.ok(requests.some(url=>url.includes('/api/search?q='))));
  fireEvent.keyDown(window,{key:'Escape'});
  await waitFor(()=>assert.equal(screen.queryByRole('dialog',{name:'Búsqueda global'}),null));
});

test('navigation stays available from independent capabilities when Command Center content fails', async () => {
  globalThis.fetch = async (url) => String(url).includes('/api/session/capabilities')
    ? response({calendar:true,clients:true,communications:false,billing:false,staff:false})
    : response({error:'internal_error'},500);
  render(React.createElement(AppShell, null, React.createElement(CommandCenter)));
  await screen.findByText('No se pudo cargar el resumen');
  assert.ok(screen.getByRole('link',{name:'Agenda'}));
  assert.ok(screen.getByRole('link',{name:'Clientes'}));
  assert.equal(screen.queryByRole('link',{name:'Economía'}),null);
  assert.equal(screen.queryByRole('link',{name:'Equipo'}),null);
});

test('Store navigation is exposed only when the server grants store capability',async()=>{
  globalThis.fetch=async(url)=>String(url).includes('/api/session/capabilities')?response({...capabilities,store:true}):String(url).includes('/api/dashboard/command-center')?response(model):response({groups:[]});
  const {unmount}=render(React.createElement(AppShell,null,React.createElement(CommandCenter)));
  assert.ok(await screen.findByRole('link',{name:'Tienda'}));unmount();
  globalThis.fetch=async(url)=>String(url).includes('/api/session/capabilities')?response({...capabilities,store:false}):String(url).includes('/api/dashboard/command-center')?response(model):response({groups:[]});
  render(React.createElement(AppShell,null,React.createElement(CommandCenter)));
  await screen.findByRole('heading',{name:'Próximas sesiones'});assert.equal(screen.queryByRole('link',{name:'Tienda'}),null);
});

test('permitted Communications navigation remains visible while moving between modules', async () => {
  globalThis.fetch = async (url) => String(url).includes('/api/session/capabilities')
    ? response({calendar:true,clients:true,communications:true,billing:true,staff:true})
    : String(url).includes('/api/dashboard/command-center') ? response(model) : response({groups:[]});
  render(React.createElement(AppShell, null, React.createElement(CommandCenter)));
  await screen.findByRole('heading',{name:'Próximas sesiones'});
  const nav = document.querySelector('.app-navigation');
  assert.ok(within(nav).getByRole('button', { name: 'Actividad' }));
  assert.ok(within(nav).getByRole('link', { name: /Comunicación/ }));
  for (const label of ['Servicios', 'Agenda', 'Clientes', 'Economía', 'Equipo']) {
    const link = within(nav).getByRole('link', { name: new RegExp(label) });
    fireEvent.click(link);
    await waitFor(() => assert.equal(within(nav).getByRole('link', { name: new RegExp(label) }).getAttribute('aria-current'), 'page'));
    assert.ok(within(nav).getByRole('link', { name: /Comunicación/ }));
  }
  assert.ok(within(nav).getByRole('link', { name: /Comunicación/ }));
  fireEvent.click(within(nav).getByRole('link', { name: /Comunicación/ }));
  await waitFor(() => assert.equal(within(nav).getByRole('link', { name: /Comunicación/ }).getAttribute('aria-current'), 'page'));
  assert.ok(within(nav).getByRole('button',{name:'Actividad'}).closest('.app-nav-group').classList.contains('is-active'));
});

test('News management navigation is visible only when the server grants its capability', async()=>{
  globalThis.fetch=async(url)=>String(url).includes('/api/session/capabilities')?response({...capabilities,news:true}):String(url).includes('/api/dashboard/command-center')?response(model):response({groups:[]});
  window.location.hash='#home';render(React.createElement(AppShell,null,React.createElement(CommandCenter)));
  await screen.findByRole('heading',{name:'Próximas sesiones'});
  const nav=document.querySelector('.app-navigation');
  assert.ok(within(nav).getByRole('link',{name:'Noticias'}));
  cleanup();
  globalThis.fetch=async(url)=>String(url).includes('/api/session/capabilities')?response({...capabilities,news:false}):String(url).includes('/api/dashboard/command-center')?response(model):response({groups:[]});
  render(React.createElement(AppShell,null,React.createElement(CommandCenter)));
  await screen.findByRole('heading',{name:'Próximas sesiones'});
  assert.equal(within(document.querySelector('.app-navigation')).queryByRole('link',{name:'Noticias'}),null);
});

test('authorized hash deep links retain their current subnavigation and page context',async()=>{
  const allowed={...capabilities,calendar:true,news:false};
  globalThis.fetch=async url=>String(url).includes('/api/session/capabilities')?response(allowed):String(url).includes('/api/dashboard/command-center')?response(model):response({groups:[]});
  window.location.hash='#services?serviceId=existing';render(React.createElement(AppShell,null,React.createElement('main',null,'Página existente')));
  await screen.findByText('Página existente');
  const nav=within(document.querySelector('.app-navigation'));
  assert.equal(nav.getByRole('link',{name:'Servicios'}).getAttribute('aria-current'),'page');
  assert.ok(nav.getByRole('button',{name:'Mi gimnasio'}).closest('.app-nav-group').classList.contains('is-active'));
  assert.equal(getProfessionalPageContext('services').section,'Mi gimnasio');
  assert.equal(getProfessionalPageContext('notification-settings').page,'Ajustes de avisos');
});

test('navigation introduces no Programación, Arena, or Athlete View destination',()=>{
  const nav=getProfessionalNavigation({...capabilities,billing:true,news:true,store:true,notificationSettings:true});
  assert.deepEqual(nav.map(item=>item.label),['Resumen','Actividad','Clientes','Mi gimnasio','Equipo','Negocio']);
  assert.equal(JSON.stringify(nav).match(/Programación|Arena|Athlete View|Entrenamientos/g),null);
});

test('expanded navigation is the default and compact sidebar can expand without losing the active section',async()=>{
  dom.window.localStorage.clear();
  globalThis.fetch=async(url)=>String(url).includes('/api/session/capabilities')?response(capabilities):String(url).includes('/api/dashboard/command-center')?response(model):String(url).includes('/api/dashboard/preferences')?response({order:['agenda','attention','clients','communication','economics','team','shortcuts'],hidden:[]}):response({groups:[]});
  window.location.hash='#home';
  render(React.createElement(AppShell,null,React.createElement(CommandCenter)));
  await screen.findByRole('heading',{name:'Próximas sesiones'});
  const frame=document.querySelector('.app-frame');assert.equal(frame.classList.contains('is-rail'),false);
  fireEvent.click(screen.getByRole('button',{name:'Compactar menú'}));
  await waitFor(()=>assert.equal(frame.classList.contains('is-rail'),true));
  const comm=screen.getByRole('button',{name:'Actividad'});assert.ok(comm);assert.equal(comm.getAttribute('title'),'Actividad');
  fireEvent.click(screen.getByRole('button',{name:'Expandir menú'}));
  await waitFor(()=>assert.equal(frame.classList.contains('is-rail'),false));
  fireEvent.click(screen.getByRole('link',{name:'Clientes'}));
  await waitFor(()=>assert.equal(screen.getByRole('link',{name:'Clientes'}).getAttribute('aria-current'),'page'));
  assert.ok(screen.getByRole('link',{name:/Comunicación/}));
});

test('Admin summary prioritizes real agenda, attention and pending work, with finance only when the API grants it',async()=>{
  const adminSummary={...model,
    permissions:{...model.permissions,billing:true,cash:true,transfers:true},
    today:{...model.today,sessionCount:2,capacity:10,occupied:6,waitlistCount:1,sessions:[{id:'s-1',serviceName:'Fuerza funcional',professionalName:'Alex Rivera',startsAt:'2026-07-15T07:00:00Z',occupied:6,capacity:10,free:4,waitlistCount:1,isNow:false,state:'upcoming'}]},
    attention:[
      {id:'waitlist-s1',kind:'waitlist',title:'Lista de espera por resolver',summary:'1 persona · Fuerza funcional',href:'#calendar',ageAt:'2026-01-15T08:00:00Z'},
      {id:'unassigned-s2',kind:'unassigned_session',title:'Sesión sin profesional',summary:'Fuerza funcional',href:'#calendar',ageAt:'2026-07-15T07:00:00Z'},
      {id:'form-a1',kind:'document_pending',title:'Documento pendiente',summary:'Lucía Demo · Alta deportiva',href:'#clients?clientId=client-1&tab=documents',ageAt:'2026-01-14T10:00:00Z'},
      {id:'pending-transfers',kind:'pending_transfers',title:'1 transferencia por validar',summary:'Revisar justificantes recibidos',href:'#economics',ageAt:null},
      {id:'overdue-payments',kind:'overdue_payments',title:'1 cargo vencido',summary:'Revisar saldos pendientes',href:'#economics',ageAt:null},
    ],
    economics:{pendingCents:12500,overdueCount:1,collectedTodayCents:0,cashSession:{status:'open',openingCents:10000,expectedCents:10000,countedCents:null,differenceCents:null}},
    team:{active:3,workingNow:1,activeAbsences:1,substitutions:0},unread:2,
  };
  const requested=[];
  globalThis.fetch=async(url)=>{requested.push(String(url));return String(url).includes('/api/dashboard/command-center')?response(adminSummary):String(url).includes('/api/session/capabilities')?response({...capabilities,billing:true}):response({groups:[]});};
  window.location.hash='#home';render(React.createElement(AppShell,null,React.createElement(CommandCenter)));
  const main=await screen.findByRole('main');
  assert.deepEqual([...main.querySelectorAll('h2')].map(item=>item.textContent),['Requiere atención','Próximas sesiones','Equipo ahora']);
  assert.equal(main.querySelector('.summary-session-capacity')?.textContent,'6/10');
  assert.equal(main.querySelector('.summary-session-free'),null);
  assert.ok(within(main).getByText('1 en espera'));
  assert.ok(within(main).getByText('2 mensajes sin leer'));
  assert.ok(within(main).getByText('Documento pendiente'));
  assert.ok(within(main).getByText('1 transferencia por validar'));
  assert.ok(within(main).getByText('Lista de espera por resolver'));
  assert.ok(within(main).getByText('Sesión sin profesional'));
  assert.ok(within(main).getByText('15 jul, 08:00'));
  assert.ok(within(main).getByText('Pendiente de cobro'));
  assert.ok(within(main).getByText('Ausencias activas'));
  assert.equal(within(main).getAllByRole('link',{name:/Fuerza funcional/})[0].getAttribute('href'),'#calendar');
  assert.equal(within(main).getByRole('link',{name:/Lucía Demo/}).getAttribute('href'),'#clients?clientId=client-1&tab=documents');
  assert.equal(within(main).getByRole('link',{name:/mensajes sin leer/}).getAttribute('href'),'#communications');
  assert.equal(within(main).queryByText('Training'),null);
  assert.equal(within(main).queryByText('Salud'),null);
  assert.ok(within(main).getByText('Clientes activos'));
  assert.equal(within(main).queryByRole('button',{name:'Personalizar inicio'}),null);
  assert.equal(requested.some(url=>url.includes('/api/dashboard/preferences')),false);
});

test('Trainer summary uses operational data and never renders finance without its server grant',async()=>{
  const trainerSummary={...model,permissions:{...model.permissions,billing:false,cash:false},economics:null,unread:0};
  globalThis.fetch=async(url)=>String(url).includes('/api/dashboard/command-center')?response(trainerSummary):String(url).includes('/api/session/capabilities')?response(capabilities):response({groups:[]});
  window.location.hash='#home';render(React.createElement(AppShell,null,React.createElement(CommandCenter)));
  const main=await screen.findByRole('main');
  assert.ok(within(main).getByRole('heading',{name:'Próximas sesiones'}));
  assert.ok(within(main).getByRole('heading',{name:'Requiere atención'}));
  assert.ok(within(main).getByRole('heading',{name:'Equipo ahora'}));
  assert.equal(within(main).queryByText(/Economía|Pendiente de cobro|Cargos vencidos|Caja de hoy/),null);
  assert.ok(within(main).getByText('Nada requiere tu atención.'));
});

test('limited professional sees only server-permitted summary blocks without finance or team placeholders',async()=>{
  const limited={...model,permissions:{calendar:true,clients:false,communications:false,documents:false,sensitiveReview:false,followup:false,billing:false,cash:false,transfers:false,staff:false,absences:false,timeclock:false},clients:null,team:null,economics:null,attention:[],unread:0,quickActions:[]};
  globalThis.fetch=async(url)=>String(url).includes('/api/dashboard/command-center')?response(limited):String(url).includes('/api/session/capabilities')?response({calendar:true,clients:false,communications:false,billing:false,staff:false}):response({groups:[]});
  window.location.hash='#home';render(React.createElement(AppShell,null,React.createElement(CommandCenter)));
  const main=await screen.findByRole('main');
  assert.deepEqual([...main.querySelectorAll('h2')].map(item=>item.textContent),['Requiere atención','Próximas sesiones']);
  assert.equal(within(main).queryByText('No tienes trabajo pendiente en tus bandejas'),null);
  assert.equal(within(main).queryByText('Clientes activos'),null);
  assert.equal(within(main).queryByText(/Caja|cobro|Economía/),null);
});

test('dashboard refuses unsafe server-provided deep links and keeps supported local links actionable',async()=>{
  const data={...model,attention:[{id:'safe',kind:'waitlist',title:'Lista de espera por resolver',summary:'1 persona · Funcional',href:'#calendar',ageAt:null},{id:'unsafe',kind:'unassigned_session',title:'Sesión sin profesional',summary:'Fuerza',href:'https://example.invalid',ageAt:null}]};
  globalThis.fetch=async(url)=>String(url).includes('/api/dashboard/command-center')?response(data):String(url).includes('/api/session/capabilities')?response(capabilities):response({groups:[]});
  window.location.hash='#home';render(React.createElement(AppShell,null,React.createElement(CommandCenter)));
  const main=await screen.findByRole('main');
  assert.equal(within(main).getByRole('link',{name:/Lista de espera por resolver/}).getAttribute('href'),'#calendar');
  assert.equal(within(main).queryByRole('link',{name:/Sesión sin profesional/}),null);
  assert.ok(within(main).getByText('Sesión sin profesional'));
});

test('today summary shows the current and next five sessions without duplicate free-seat or empty-waitlist rows',async()=>{
  const sessions=Array.from({length:7},(_,index)=>({id:`today-${index}`,serviceName:`Servicio ${index+1}`,professionalName:`Profesional ${index+1}`,startsAt:new Date(Date.now()+(index+1)*60*60_000).toISOString(),occupied:index,capacity:8,free:8-index,waitlistCount:index===0?2:0,isNow:false,state:'upcoming'}));
  const data={...model,today:{...model.today,sessionCount:7,occupied:21,capacity:56,waitlistCount:2,sessions}};
  globalThis.fetch=async(url)=>String(url).includes('/api/dashboard/command-center')?response(data):String(url).includes('/api/session/capabilities')?response(capabilities):response({groups:[]});
  window.location.hash='#home';render(React.createElement(AppShell,null,React.createElement(CommandCenter)));
  const list=await screen.findByRole('list',{name:'Próximas sesiones de hoy'});
  assert.equal(within(list).getAllByRole('link').length,5);
  assert.ok(within(list).getByText('2 en espera'));
  assert.equal(within(list).queryByText('Sin espera'),null);
  assert.equal(within(list).queryByText('7', {selector:'.summary-session-free'}),null);
  assert.match(document.querySelector('.summary-more-sessions').textContent,/^\+2 sesiones hoy/);
  assert.ok(screen.getByRole('link',{name:'Ver todas en la agenda'}));
});

test('loading and error states are distinct and error can be retried accessibly',async()=>{
  let resolveDashboard;
  globalThis.fetch=(url)=>String(url).includes('/api/dashboard/command-center')?new Promise(resolve=>{resolveDashboard=resolve;}):String(url).includes('/api/session/capabilities')?response(capabilities):response({groups:[]});
  window.location.hash='#home';render(React.createElement(AppShell,null,React.createElement(CommandCenter)));
  assert.ok(screen.getByRole('status'));
  resolveDashboard(response({error:'internal_error'},500));
  assert.ok(await screen.findByRole('alert'));
  assert.ok(screen.getByRole('button',{name:'Reintentar'}));
});
