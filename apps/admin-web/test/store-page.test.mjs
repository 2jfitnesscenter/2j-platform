import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1:5174/#store'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,MutationObserver:dom.window.MutationObserver,getComputedStyle:dom.window.getComputedStyle,IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});
const {cleanup,fireEvent,render,screen,waitFor,within}=await import('@testing-library/react');const {StorePage}=await import('../src/store-page.tsx');
afterEach(()=>{cleanup();globalThis.fetch=undefined;delete window.prompt;delete window.confirm;});after(()=>dom.window.close());
// The real API serialises priceCents as a string; stock is a number.
const protein={id:'p1',category:'nutrition',name:'Proteína',description:'900 g',active:true,variants:[{id:'v1',sku:'PROT',label:'Chocolate',size:'900 g',flavor:'Chocolate',priceCents:'2500',active:true,stockTracked:true,stock:4}]};
const data={products:[protein],movements:[],sales:[]};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
const serve=({store=data,onRequest}={})=>{const requests=[];globalThis.fetch=async(url,init={})=>{const target=String(url);requests.push([target,init]);const custom=onRequest?.(target,init);if(custom)return custom;if(target.endsWith('/api/admin/store'))return json(store);if(target.includes('/api/clients?'))return json({items:[{id:'c1',firstName:'Eva',lastName:'Demo',email:null,status:'active'}]});if(target.endsWith('/api/admin/store/sales'))return json({id:'s1'},201);return json({id:'ok'},201);};return requests;};
const open=async(store)=>{serve({store});render(React.createElement(StorePage));await screen.findByRole('heading',{name:'Proteína'});};

test('Tienda opens on the visual catalogue; creation, stock and sale workflows are dialogs opened on demand',async()=>{
  await open();
  assert.ok(screen.getByRole('heading',{level:1,name:'Tienda'}));
  assert.equal(screen.getByRole('tab',{name:'Catálogo'}).getAttribute('aria-selected'),'true');
  assert.ok(screen.queryByRole('dialog')===null,'no workflow is open until requested');
  assert.equal(screen.getAllByText(/25,00\s*€/).length,2,'card price and variant row price');
  assert.equal(document.querySelectorAll('.ui-page-header .ui-button--primary').length,1,'one primary action: Añadir producto');
  fireEvent.click(screen.getByRole('tab',{name:'Ventas'}));
  fireEvent.click(screen.getAllByRole('button',{name:'Nueva venta en el centro'})[0]);
  const dialog=await screen.findByRole('dialog',{name:'Nueva venta en el centro'});
  assert.ok(within(dialog).getByLabelText('Buscar Member'));
  assert.ok(within(dialog).getByText(/No se procesa ningún pago online/));
});

test('POS retries keep the same idempotency key and a completed sale starts with a fresh key',async()=>{
  const keys=[];let saleCalls=0;
  serve({onRequest:(target,init)=>{if(target.endsWith('/api/admin/store/sales')){keys.push(new Headers(init.headers).get('idempotency-key'));saleCalls++;return saleCalls===1?json({error:'internal_error'},500):json({id:`s${saleCalls}`},201);}return null;}});
  render(React.createElement(StorePage));await screen.findByRole('heading',{name:'Proteína'});
  fireEvent.click(screen.getByRole('tab',{name:'Ventas'}));
  const start=async()=>{fireEvent.click(screen.getAllByRole('button',{name:'Nueva venta en el centro'})[0]);const dialog=await screen.findByRole('dialog');fireEvent.change(within(dialog).getByLabelText('Buscar Member'),{target:{value:'Eva'}});fireEvent.click(await within(dialog).findByRole('option',{name:'Eva Demo'}));fireEvent.change(within(dialog).getByLabelText('Variante'),{target:{value:'v1'}});fireEvent.click(within(dialog).getByRole('button',{name:'Añadir al pedido'}));return dialog;};
  let dialog=await start();fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar venta'}));await within(dialog).findByRole('alert');
  fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar venta'}));await waitFor(()=>assert.equal(saleCalls,2));assert.equal(keys[0],keys[1],'a retried identical sale reuses its key');
  await waitFor(()=>assert.ok(screen.queryByRole('dialog')===null),{timeout:2000});
  dialog=await start();fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar venta'}));await waitFor(()=>assert.equal(saleCalls,3));assert.notEqual(keys[1],keys[2],'a completed sale starts with a fresh key');
});

test('product card is visual with a fallback instead of an image, no invented stock thresholds, and Agotado only when every active variant is at zero',async()=>{
  await open({products:[protein,{id:'p2',category:'merchandising',name:'Camiseta 2J',description:'',active:true,variants:[{id:'v2',sku:null,label:'M',size:'M',flavor:null,priceCents:'1800',active:true,stockTracked:true,stock:0},{id:'v3',sku:null,label:'L',size:'L',flavor:null,priceCents:'2000',active:true,stockTracked:true,stock:0}]},{id:'p3',category:'merchandising',name:'Gorra',description:'',active:false,variants:[]}],movements:[],sales:[]});
  const grid=screen.getByRole('list',{name:'Productos'});
  const shirt=within(grid).getByRole('article',{name:'Camiseta 2J'});
  assert.ok(shirt.querySelector('.product-media svg'),'category icon fallback');
  assert.equal(shirt.querySelector('.product-media span').textContent,'C2','initials fallback');
  assert.ok(shirt.querySelector('img')===null,'no image is faked: media backend is not implemented');
  assert.ok(within(shirt).getByText('Agotado'));
  assert.ok(within(shirt).getByText(/desde\s*18,00\s*€/));
  assert.ok(within(within(grid).getByRole('article',{name:'Proteína'})).queryByText('Agotado')===null);
  assert.ok(within(within(grid).getByRole('article',{name:'Proteína'})).getAllByText('4 uds.').length>=1);
  assert.ok(within(grid).getByText('Inactivo'));
  assert.ok(within(grid).queryByText(/pocas unidades/i)===null,'there is no low-stock threshold in the data, so none is shown');
});

test('creating a product and a variant works through dialogs, closes them and refreshes',async()=>{
  const posts=[];
  serve({onRequest:(target,init)=>{if(init.method==='POST'){posts.push([target,JSON.parse(init.body)]);return json({id:'p9'},201);}return null;}});
  render(React.createElement(StorePage));await screen.findByRole('heading',{name:'Proteína'});
  fireEvent.click(screen.getByRole('button',{name:'Añadir producto'}));
  let dialog=await screen.findByRole('dialog',{name:'Añadir producto'});
  fireEvent.change(within(dialog).getByLabelText('Nombre'),{target:{value:'Creatina'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Crear producto'}));
  await waitFor(()=>assert.ok(posts.some(([url,body])=>url.endsWith('/api/admin/store/products')&&body.name==='Creatina')));
  await waitFor(()=>assert.ok(screen.queryByRole('dialog')===null));
  assert.ok(screen.getByRole('status'));
  fireEvent.click(screen.getAllByRole('button',{name:'Añadir variante'})[0]);
  dialog=await screen.findByRole('dialog',{name:'Añadir variante'});
  fireEvent.change(within(dialog).getByLabelText('Producto'),{target:{value:'p1'}});
  fireEvent.change(within(dialog).getByLabelText('Nombre de variante'),{target:{value:'Vainilla'}});
  fireEvent.change(within(dialog).getByLabelText('Precio final (€)'),{target:{value:'27,50'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Crear variante'}));
  await waitFor(()=>assert.ok(posts.some(([url,body])=>/variants$/.test(url)&&body.priceCents===2750)),{timeout:2000});
});

test('inventory is a table of variants with stock, status and movements; registering stock posts the existing movement',async()=>{
  const posts=[];
  serve({store:{...data,movements:[{id:'m1',quantityDelta:4,type:'opening',reason:'Alta inicial',occurredAt:'2026-10-01T10:00:00Z',productName:'Proteína',variantLabel:'Chocolate'}]},onRequest:(target,init)=>{if(init.method==='POST'){posts.push([target,JSON.parse(init.body)]);return json({ok:true},201);}return null;}});
  render(React.createElement(StorePage));await screen.findByRole('heading',{name:'Proteína'});
  fireEvent.click(screen.getByRole('tab',{name:'Inventario'}));
  const table=await screen.findByRole('table');
  for(const header of ['Producto','Variante','Código','Precio','Stock','Estado'])assert.ok(within(table).getByRole('columnheader',{name:header}));
  assert.ok(within(table).getByText('4 uds.'));
  assert.ok(screen.getByText('Alta inicial'));
  fireEvent.click(screen.getByRole('button',{name:'Registrar stock'}));
  const dialog=await screen.findByRole('dialog',{name:'Registrar stock'});
  fireEvent.change(within(dialog).getByLabelText('Variante'),{target:{value:'v1'}});
  fireEvent.change(within(dialog).getByLabelText('Unidades'),{target:{value:'6'}});
  fireEvent.change(within(dialog).getByLabelText('Motivo'),{target:{value:'Reposición proveedor'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Registrar movimiento'}));
  await waitFor(()=>assert.ok(posts.some(([url,body])=>url.endsWith('/variants/v1/movements')&&body.quantity===6&&body.type==='restock'&&body.reason==='Reposición proveedor')));
});

test('voiding a sale asks for confirmation and only then restores stock through the existing endpoint',async()=>{
  const posts=[];
  serve({store:{...data,sales:[{id:'s1',clientId:'c1',firstName:'Eva',lastName:'Demo',status:'completed',paymentState:'paid',paymentMethod:'cash',totalCents:'2500',createdAt:'2026-10-02T10:00:00Z',lines:[{productName:'Proteína',variantLabel:'Chocolate',quantity:1,lineTotalCents:2500}]},{id:'s2',clientId:'c1',firstName:'Eva',lastName:'Demo',status:'voided',paymentState:'pending',paymentMethod:null,totalCents:'1000',createdAt:'2026-10-03T10:00:00Z',lines:[]}]},onRequest:(target,init)=>{if(init.method==='POST'){posts.push(target);return json({ok:true},200);}return null;}});
  render(React.createElement(StorePage));await screen.findByRole('heading',{name:'Proteína'});
  fireEvent.click(screen.getByRole('tab',{name:'Ventas'}));
  assert.ok(await screen.findByText('Pagada en el centro'));assert.ok(screen.getByText('Anulada'));
  assert.equal(screen.getAllByRole('button',{name:'Anular y devolver stock'}).length,1,'only completed sales can be voided');
  window.confirm=()=>false;fireEvent.click(screen.getByRole('button',{name:'Anular y devolver stock'}));assert.equal(posts.length,0);
  window.confirm=()=>true;fireEvent.click(screen.getByRole('button',{name:'Anular y devolver stock'}));
  await waitFor(()=>assert.ok(posts.some(url=>url.endsWith('/sales/s1/void'))));
});

test('product edit and activation keep their existing flows from the card',async()=>{
  const patches=[];
  serve({onRequest:(target,init)=>{if(init.method==='PATCH'){patches.push([target,JSON.parse(init.body)]);return json({ok:true});}return null;}});
  render(React.createElement(StorePage));await screen.findByRole('heading',{name:'Proteína'});
  const card=screen.getByRole('article',{name:'Proteína'});
  fireEvent.click(within(card).getAllByRole('button',{name:'Desactivar'})[0]);
  await waitFor(()=>assert.ok(patches.some(([url,body])=>url.endsWith('/products/p1')&&body.active===false)));
  const answers=['Proteína whey','1 kg'];window.prompt=()=>answers.shift();
  fireEvent.click(within(card).getAllByRole('button',{name:'Editar'})[0]);
  await waitFor(()=>assert.ok(patches.some(([,body])=>body.name==='Proteína whey'&&body.description==='1 kg')));
});

test('loading error offers retry; empty catalogue invites the first product',async()=>{
  globalThis.fetch=async()=>json({error:'internal_error'},500);
  render(React.createElement(StorePage));
  assert.ok(await screen.findByRole('button',{name:'Reintentar'}));
  cleanup();
  serve({store:{products:[],movements:[],sales:[]}});
  render(React.createElement(StorePage));
  assert.ok(await screen.findByText('Aún no hay productos'));
  assert.ok(screen.getAllByRole('button',{name:'Añadir producto'}).length>=1);
});

test('the dialog traps focus, closes with Escape and returns focus to its opener',async()=>{
  await open();
  const opener=screen.getByRole('button',{name:'Añadir producto'});opener.focus();fireEvent.click(opener);
  const dialog=await screen.findByRole('dialog',{name:'Añadir producto'});
  assert.ok(dialog.contains(document.activeElement));
  fireEvent.keyDown(document,{key:'Escape'});
  await waitFor(()=>assert.ok(screen.queryByRole('dialog')===null));
  assert.ok(document.activeElement===opener);
});

const openSale=async()=>{await open();fireEvent.click(screen.getByRole('tab',{name:'Ventas'}));fireEvent.click(screen.getAllByRole('button',{name:'Nueva venta en el centro'})[0]);return screen.findByRole('dialog',{name:'Nueva venta en el centro'});};
const pickClient=async(dialog)=>{fireEvent.change(within(dialog).getByLabelText('Buscar Member'),{target:{value:'Eva'}});fireEvent.click(await within(dialog).findByRole('option',{name:'Eva Demo'}));};

test('new sale: an explicit empty Pedido and a visible reason why Confirmar venta is disabled',async()=>{
  const dialog=await openSale();
  const order=within(dialog).getByRole('heading',{name:'Pedido'}).closest('section');
  assert.ok(within(order).getByText('Aún no has añadido productos.'));
  const confirm=within(dialog).getByRole('button',{name:'Confirmar venta'});
  assert.equal(confirm.disabled,true);
  assert.ok(within(dialog).getByText('Elige un cliente de la lista para registrar la venta.'));
  assert.ok(within(dialog).getByText('Añade al menos un producto al pedido.'));
  assert.equal(confirm.getAttribute('aria-describedby'),'store-sale-help');
  assert.ok(document.getElementById('store-sale-help'),'the description target exists');
});

test('client + variant + units but nothing in the order: the dialog says to press Añadir al pedido, and doing so enables the sale',async()=>{
  const dialog=await openSale();await pickClient(dialog);
  fireEvent.change(within(dialog).getByLabelText('Variante'),{target:{value:'v1'}});
  const confirm=within(dialog).getByRole('button',{name:'Confirmar venta'});
  assert.equal(confirm.disabled,true);
  assert.match(within(dialog).getByText(/has elegido Proteína · Chocolate pero aún no está en el pedido/).textContent,/Pulsa «Añadir al pedido»/);
  assert.ok(within(dialog).queryByText('Elige un cliente de la lista para registrar la venta.')===null,'the client is selected');
  fireEvent.click(within(dialog).getByRole('button',{name:'Añadir al pedido'}));
  const order=within(dialog).getByRole('heading',{name:'Pedido'}).closest('section');
  assert.ok(within(order).getByText(/Proteína · Chocolate × 1/));
  assert.ok(within(order).getAllByText(/25,00\s*€/).length>=1);
  assert.ok(within(order).queryByText('Aún no has añadido productos.')===null);
  assert.equal(confirm.disabled,false,'client + at least one line enables the sale');
  assert.ok(within(dialog).queryByText(/Añade al menos un producto/)===null);
});

test('adding to the order validates variant, units and stock before Confirmar venta',async()=>{
  const dialog=await openSale();
  fireEvent.click(within(dialog).getByRole('button',{name:'Añadir al pedido'}));
  assert.equal((await within(dialog).findByText('Elige un producto y su variante antes de añadirlo al pedido.')).getAttribute('class'),'ui-form-error');
  fireEvent.change(within(dialog).getByLabelText('Variante'),{target:{value:'v1'}});
  assert.ok(within(dialog).queryByText('Elige un producto y su variante antes de añadirlo al pedido.')===null,'changing the variant clears the stale error');
  fireEvent.change(within(dialog).getByLabelText('Unidades'),{target:{value:'0'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Añadir al pedido'}));
  assert.ok(await within(dialog).findByText('Las unidades deben ser un número entero de 1 o más.'));
  fireEvent.change(within(dialog).getByLabelText('Unidades'),{target:{value:'5'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Añadir al pedido'}));
  assert.ok(await within(dialog).findByText('Solo quedan 4 uds. de Proteína · Chocolate.'));
  assert.ok(within(dialog).getByText('Aún no has añadido productos.'),'nothing was added');
  fireEvent.change(within(dialog).getByLabelText('Unidades'),{target:{value:'3'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Añadir al pedido'}));
  assert.ok(within(dialog).getByText(/Proteína · Chocolate × 3/));
  fireEvent.change(within(dialog).getByLabelText('Variante'),{target:{value:'v1'}});
  fireEvent.change(within(dialog).getByLabelText('Unidades'),{target:{value:'2'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Añadir al pedido'}));
  assert.ok(await within(dialog).findByText('Solo quedan 4 uds. de Proteína · Chocolate y ya has añadido 3 al pedido.'),'stock counts what is already in the order');
});

test('untracked variants are not stock-limited',async()=>{
  const untracked={...protein,variants:[{...protein.variants[0],stockTracked:false,stock:0}]};
  await open({products:[untracked],movements:[],sales:[]});
  fireEvent.click(screen.getByRole('tab',{name:'Ventas'}));fireEvent.click(screen.getAllByRole('button',{name:'Nueva venta en el centro'})[0]);
  const dialog=await screen.findByRole('dialog',{name:'Nueva venta en el centro'});
  fireEvent.change(within(dialog).getByLabelText('Variante'),{target:{value:'v1'}});fireEvent.change(within(dialog).getByLabelText('Unidades'),{target:{value:'50'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Añadir al pedido'}));
  assert.ok(within(dialog).getByText(/Proteína · Chocolate × 50/));
});
