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
  await screen.findByText('0 sesiones hoy');
  const nav=within(document.querySelector('.app-navigation'));
  for(const label of ['Resumen','Actividad','Clientes','Mi gimnasio','Equipo','Negocio'])assert.ok(nav.getByRole(label==='Resumen'||label==='Clientes'||label==='Equipo'?'link':'button',{name:label}));
  for(const label of ['Agenda','Servicios y cuotas','Economía','Tienda','Noticias','Ajustes de avisos'])assert.ok(nav.getByRole('link',{name:label}));
  assert.ok(nav.getByRole('link',{name:/Comunicación/}));
  assert.equal(screen.queryByText('Cobrado hoy'),null);
  assert.ok(screen.getByText('Todo en orden'));
  assert.equal(document.querySelector('.app-navigation .nav-count')?.textContent,'2');
});

test('Trainer sees only capability-allowed professional sections and no business routes by default',async()=>{
  const trainerCapabilities={calendar:true,clients:true,communications:true,billing:false,staff:true,notificationSettings:false,news:false,store:false};
  globalThis.fetch=async url=>String(url).includes('/api/session/capabilities')?response(trainerCapabilities):String(url).includes('/api/dashboard/command-center')?response(model):response({groups:[]});
  window.location.hash='#home';render(React.createElement(AppShell,null,React.createElement(CommandCenter)));
  await screen.findByText('0 sesiones hoy');const nav=within(document.querySelector('.app-navigation'));
  for(const label of ['Resumen','Actividad','Clientes','Mi gimnasio','Equipo'])assert.ok(nav.getByRole(label==='Resumen'||label==='Clientes'||label==='Equipo'?'link':'button',{name:label}));
  assert.equal(nav.queryByRole('button',{name:'Negocio'}),null);
  for(const label of ['Economía','Tienda','Noticias','Ajustes de avisos'])assert.equal(nav.queryByRole('link',{name:label}),null);
  assert.ok(nav.getByRole('link',{name:'Servicios y cuotas'}));
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
  await screen.findByText('0 sesiones hoy');
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
  await screen.findByText('No se pudo abrir el Command Center');
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
  await screen.findByText('0 sesiones hoy');assert.equal(screen.queryByRole('link',{name:'Tienda'}),null);
});

test('permitted Communications navigation remains visible while moving between modules', async () => {
  globalThis.fetch = async (url) => String(url).includes('/api/session/capabilities')
    ? response({calendar:true,clients:true,communications:true,billing:true,staff:true})
    : String(url).includes('/api/dashboard/command-center') ? response(model) : response({groups:[]});
  render(React.createElement(AppShell, null, React.createElement(CommandCenter)));
  await screen.findByText('0 sesiones hoy');
  const nav = document.querySelector('.app-navigation');
  assert.ok(within(nav).getByRole('button', { name: 'Actividad' }));
  assert.ok(within(nav).getByRole('link', { name: /Comunicación/ }));
  for (const label of ['Servicios y cuotas', 'Agenda', 'Clientes', 'Economía', 'Equipo']) {
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
  await screen.findByText('0 sesiones hoy');
  const nav=document.querySelector('.app-navigation');
  assert.ok(within(nav).getByRole('link',{name:'Noticias'}));
  cleanup();
  globalThis.fetch=async(url)=>String(url).includes('/api/session/capabilities')?response({...capabilities,news:false}):String(url).includes('/api/dashboard/command-center')?response(model):response({groups:[]});
  render(React.createElement(AppShell,null,React.createElement(CommandCenter)));
  await screen.findByText('0 sesiones hoy');
  assert.equal(within(document.querySelector('.app-navigation')).queryByRole('link',{name:'Noticias'}),null);
});

test('authorized hash deep links retain their current subnavigation and page context',async()=>{
  const allowed={...capabilities,calendar:true,news:false};
  globalThis.fetch=async url=>String(url).includes('/api/session/capabilities')?response(allowed):String(url).includes('/api/dashboard/command-center')?response(model):response({groups:[]});
  window.location.hash='#services?serviceId=existing';render(React.createElement(AppShell,null,React.createElement('main',null,'Página existente')));
  await screen.findByText('Página existente');
  const nav=within(document.querySelector('.app-navigation'));
  assert.equal(nav.getByRole('link',{name:'Servicios y cuotas'}).getAttribute('aria-current'),'page');
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
  await screen.findByText('0 sesiones hoy');
  const frame=document.querySelector('.app-frame');assert.equal(frame.classList.contains('is-compact'),false);
  fireEvent.click(screen.getByRole('button',{name:'Compactar menú'}));
  await waitFor(()=>assert.equal(frame.classList.contains('is-compact'),true));
  const comm=screen.getByRole('button',{name:'Actividad'});assert.ok(comm);assert.equal(comm.getAttribute('title'),'Actividad');
  fireEvent.click(screen.getByRole('button',{name:'Expandir menú'}));
  await waitFor(()=>assert.equal(frame.classList.contains('is-compact'),false));
  fireEvent.click(screen.getByRole('link',{name:'Clientes'}));
  await waitFor(()=>assert.equal(screen.getByRole('link',{name:'Clientes'}).getAttribute('aria-current'),'page'));
  assert.ok(screen.getByRole('link',{name:/Comunicación/}));
});

test('Home layout controls persist actor preferences and restore the default layout',async()=>{
  dom.window.localStorage.clear();const writes=[];
  globalThis.fetch=async(url,options={})=>{
    if(String(url).includes('/api/dashboard/preferences')&&options.method==='PUT'){const layout=JSON.parse(options.body);writes.push(layout);return response(layout);}
    if(String(url).includes('/api/dashboard/preferences'))return response({order:['agenda','attention','clients','communication','economics','team','shortcuts'],hidden:[]});
    return String(url).includes('/api/session/capabilities')?response(capabilities):String(url).includes('/api/dashboard/command-center')?response(model):response({groups:[]});
  };
  window.location.hash='#home';render(React.createElement(AppShell,null,React.createElement(CommandCenter)));
  await screen.findByText('0 sesiones hoy');fireEvent.click(screen.getByRole('button',{name:'Personalizar inicio'}));
  const row=screen.getAllByText('Clientes').map(item=>item.closest('.home-layout-row')).find(Boolean);fireEvent.click(within(row).getByRole('button',{name:'Ocultar'}));
  await waitFor(()=>assert.ok(writes.at(-1).hidden.includes('clients')));
  fireEvent.click(screen.getByRole('button',{name:'Restaurar disposición por defecto'}));
  await waitFor(()=>assert.deepEqual(writes.at(-1).hidden,[]));
});
