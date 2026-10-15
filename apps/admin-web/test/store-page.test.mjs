import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1:5174/#store'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,MutationObserver:dom.window.MutationObserver,getComputedStyle:dom.window.getComputedStyle,IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});
const {cleanup,fireEvent,render,screen,waitFor}=await import('@testing-library/react');const {StorePage}=await import('../src/store-page.tsx');
afterEach(()=>{cleanup();globalThis.fetch=undefined;});after(()=>dom.window.close());
const data={products:[{id:'p1',category:'nutrition',name:'Proteína',description:'900 g',active:true,variants:[{id:'v1',sku:'PROT',label:'Chocolate',size:'900 g',flavor:'Chocolate',priceCents:'2500',active:true,stockTracked:true,stock:4}]}],movements:[],sales:[]};
test('Admin Store opens catalog first and keeps creation, stock and sale workflows collapsed until requested',async()=>{
  const requests=[];globalThis.fetch=async(url,init={})=>{requests.push([String(url),init]);if(String(url).endsWith('/api/admin/store'))return new Response(JSON.stringify(data));if(String(url).includes('/api/clients?'))return new Response(JSON.stringify({items:[{id:'c1',firstName:'Eva',lastName:'Demo',email:null,status:'active'}]}));if(String(url).endsWith('/api/admin/store/sales'))return new Response(JSON.stringify({id:'s1'}),{status:201});return new Response(JSON.stringify({error:'not_found'}),{status:404});};
  render(React.createElement(StorePage));await screen.findByRole('heading',{name:'Proteína'});assert.ok(screen.getByRole('heading',{name:'Tienda'}));assert.equal(document.querySelectorAll('.store-workflow[open]').length,0);assert.equal(screen.getAllByText(/25,00\s*€/).length,2);
  fireEvent.click(screen.getByText('＋ Nueva venta en el centro'));assert.ok(screen.getByRole('heading',{name:'Proteína'}));assert.ok(screen.getByLabelText('Buscar Member'));assert.ok(screen.getByText(/No se procesa ningún pago online/));
});

test('POS retries keep the same idempotency key and a completed sale starts with a fresh key',async()=>{
  const keys=[];let saleCalls=0;globalThis.fetch=async(url,init={})=>{const target=String(url);if(target.endsWith('/api/admin/store'))return new Response(JSON.stringify(data));if(target.includes('/api/clients?'))return new Response(JSON.stringify({items:[{id:'c1',firstName:'Eva',lastName:'Demo',email:null,status:'active'}]}));if(target.endsWith('/api/admin/store/sales')){keys.push(new Headers(init.headers).get('idempotency-key'));saleCalls++;return saleCalls===1?new Response(JSON.stringify({error:'internal_error'}),{status:500}):new Response(JSON.stringify({id:`s${saleCalls}`}),{status:201});}return new Response(JSON.stringify({error:'not_found'}),{status:404});};
  render(React.createElement(StorePage));await screen.findByRole('heading',{name:'Proteína'});
  fireEvent.click(screen.getByText('＋ Nueva venta en el centro'));
  const start=async()=>{fireEvent.change(screen.getByLabelText('Buscar Member'),{target:{value:'Eva'}});fireEvent.click(await screen.findByRole('option',{name:'Eva Demo'}));fireEvent.change(screen.getAllByLabelText('Variante')[1],{target:{value:'v1'}});fireEvent.click(screen.getByRole('button',{name:'Añadir línea'}));};
  await start();fireEvent.click(screen.getByRole('button',{name:'Confirmar venta'}));await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Confirmar venta'}));await waitFor(()=>assert.equal(saleCalls,2));assert.equal(keys[0],keys[1]);
  await start();fireEvent.click(screen.getByRole('button',{name:'Confirmar venta'}));await waitFor(()=>assert.equal(saleCalls,3));assert.notEqual(keys[1],keys[2]);
});
