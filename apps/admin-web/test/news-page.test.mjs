import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://127.0.0.1:5174'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,MutationObserver:dom.window.MutationObserver,getComputedStyle:dom.window.getComputedStyle,IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});
const {cleanup,fireEvent,render,screen}=await import('@testing-library/react');
const {NewsPage}=await import('../src/news-page.tsx');
afterEach(()=>{cleanup();globalThis.fetch=undefined;});
after(()=>dom.window.close());

test('Admin creates, edits, publishes, features, withdraws and inspects Center News history',async()=>{
  const items=[];const audit=[];let sequence=0;
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
  globalThis.window.confirm=()=>true;
  globalThis.fetch=async(input,init={})=>{
    const url=String(input);const method=init.method??'GET';
    if(url.endsWith('/api/admin/news')&&method==='GET')return json({items});
    if(url.endsWith('/api/admin/news')&&method==='POST'){const body=JSON.parse(init.body);const item={id:`news-${++sequence}`,title:body.title,body:body.body,status:'draft',featured:false,publishedAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};items.unshift(item);audit.unshift({id:`event-${sequence}`,action:'news.created',actorId:'admin-demo',occurredAt:new Date().toISOString(),details:{status:'draft'}});return json(item,201);}
    const match=url.match(/\/api\/admin\/news\/([^/]+)(?:\/(publish|withdraw|feature|unfeature|audit))?$/);
    if(match){const item=items.find(row=>row.id===match[1]);const action=match[2];if(action==='audit')return json({events:audit});if(method==='PATCH'){const body=JSON.parse(init.body);Object.assign(item,body);audit.unshift({id:`event-edit`,action:'news.updated',actorId:'admin-demo',occurredAt:new Date().toISOString(),details:{fields:Object.keys(body)}});return json(item);}if(action==='publish'){item.status='published';item.publishedAt=new Date().toISOString();audit.unshift({id:'event-publish',action:'news.published',actorId:'admin-demo',occurredAt:new Date().toISOString(),details:{status:'published'}});return json(item);}if(action==='feature'){item.featured=true;audit.unshift({id:'event-feature',action:'news.featured',actorId:'admin-demo',occurredAt:new Date().toISOString(),details:{featured:true}});return json(item);}if(action==='unfeature'){item.featured=false;return json(item);}if(action==='withdraw'){item.status='withdrawn';item.featured=false;audit.unshift({id:'event-withdraw',action:'news.withdrawn',actorId:'admin-demo',occurredAt:new Date().toISOString(),details:{status:'withdrawn'}});return json(item);}}
    throw new Error(`Unexpected ${method} ${url}`);
  };
  const ui=render(React.createElement(NewsPage));
  assert.ok(await screen.findByRole('heading',{name:'Noticias'}));
  fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Horario especial'}});
  fireEvent.change(screen.getByLabelText('Texto'),{target:{value:'El sábado abrimos una hora antes.'}});
  fireEvent.click(screen.getByRole('button',{name:'Guardar borrador'}));
  assert.ok(await screen.findByText('Borrador creado.'));
  const article=ui.container.querySelector('.center-news-item');assert.ok(article);
  fireEvent.click(withinArticle(article,'Editar'));
  fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Horario especial de verano'}});
  fireEvent.click(screen.getByRole('button',{name:'Guardar cambios'}));
  assert.ok(await screen.findByText('Cambios guardados.'));
  const current=ui.container.querySelector('.center-news-item');
  fireEvent.click(withinArticle(current,'Publicar'));
  await screen.findByText('Noticia publicada.');
  const published=ui.container.querySelector('.center-news-item');
  fireEvent.click(withinArticle(published,'Destacar'));
  await screen.findByText('Noticia destacada.');
  const featured=ui.container.querySelector('.center-news-item');
  assert.ok(featured.textContent.includes('Destacada'));
  fireEvent.click(withinArticle(featured,'Retirar'));
  await screen.findByText('Noticia retirada.');
  const withdrawn=ui.container.querySelector('.center-news-item');
  assert.ok(withdrawn.textContent.includes('Retirada'));
  fireEvent.click(withinArticle(withdrawn,'Historial'));
  assert.ok(await screen.findByText('Editada'));
  assert.match(ui.container.querySelector('.center-news-audit').textContent,/admin-demo/);
  assert.deepEqual(items.map(item=>item.status),['withdrawn']);
});

function withinArticle(article,label){return [...article.querySelectorAll('button')].find(button=>button.textContent.trim()===label);}
