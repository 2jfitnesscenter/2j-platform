import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5173/#home' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');
const { AppShell } = await import('../src/app-shell.tsx');
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

test('unified shell shows only permitted areas and renders a calm empty Command Center', async () => {
  globalThis.fetch = async (url) => String(url).includes('/api/dashboard/command-center') ? response(model) : String(url).includes('/api/session/capabilities') ? response(capabilities) : response({groups:[]});
  render(React.createElement(AppShell, null, React.createElement(CommandCenter)));
  await screen.findByText('0 sesiones hoy');
  assert.ok(screen.getByRole('link',{name:'Agenda'}));
  assert.ok(screen.getByRole('link',{name:'Clientes'}));
  assert.equal(screen.queryByRole('link',{name:'Economía'}),null);
  assert.equal(screen.queryByText('Cobrado hoy'),null);
  assert.ok(screen.getByText('Todo en orden'));
  assert.equal(document.querySelector('.app-navigation .nav-count')?.textContent,'2');
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
