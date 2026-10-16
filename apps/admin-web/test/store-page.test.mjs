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
  assert.ok(within(dialog).getByLabelText('Buscar cliente'));
  assert.ok(within(dialog).getByText(/No se procesa ningún pago online/));
});

test('POS retries keep the same idempotency key and a completed sale starts with a fresh key',async()=>{
  const keys=[];let saleCalls=0;
  serve({onRequest:(target,init)=>{if(target.endsWith('/api/admin/store/sales')){keys.push(new Headers(init.headers).get('idempotency-key'));saleCalls++;return saleCalls===1?json({error:'internal_error'},500):json({id:`s${saleCalls}`},201);}return null;}});
  render(React.createElement(StorePage));await screen.findByRole('heading',{name:'Proteína'});
  fireEvent.click(screen.getByRole('tab',{name:'Ventas'}));
  const start=async()=>{fireEvent.click(screen.getAllByRole('button',{name:'Nueva venta en el centro'})[0]);const dialog=await screen.findByRole('dialog');fireEvent.change(within(dialog).getByLabelText('Buscar cliente'),{target:{value:'Eva'}});fireEvent.click(await within(dialog).findByRole('option',{name:'Eva Demo'}));fireEvent.change(within(dialog).getByLabelText('Variante'),{target:{value:'v1'}});fireEvent.click(within(dialog).getByRole('button',{name:'Añadir al pedido'}));return dialog;};
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
const pickClient=async(dialog)=>{fireEvent.change(within(dialog).getByLabelText('Buscar cliente'),{target:{value:'Eva'}});fireEvent.click(await within(dialog).findByRole('option',{name:'Eva Demo'}));};

test('new sale: an explicit empty Pedido and a visible reason why Confirmar venta is disabled',async()=>{
  const dialog=await openSale();
  const order=within(dialog).getByRole('heading',{name:'Pedido'}).closest('section');
  assert.ok(within(order).getByText('Aún no has añadido productos.'));
  const confirm=within(dialog).getByRole('button',{name:'Confirmar venta'});
  assert.equal(confirm.disabled,true);
  assert.ok(within(dialog).getByText('Elige un cliente.'));
  assert.ok(within(dialog).getByText('Añade al menos un producto al pedido.'));
  assert.equal(confirm.getAttribute('aria-describedby'),'store-sale-help');
  assert.ok(document.getElementById('store-sale-help'),'the description target exists');
});

test('client + variant + units but nothing in the order: the dialog says to press Añadir al pedido, and doing so enables the sale',async()=>{
  const dialog=await openSale();await pickClient(dialog);
  fireEvent.change(within(dialog).getByLabelText('Variante'),{target:{value:'v1'}});
  const confirm=within(dialog).getByRole('button',{name:'Confirmar venta'});
  assert.equal(confirm.disabled,true);
  assert.equal(within(dialog).getByText(/Pulsa “Añadir al pedido” para incluir la variante seleccionada/).textContent,'Pulsa “Añadir al pedido” para incluir la variante seleccionada (Proteína · Chocolate).');
  assert.ok(within(dialog).queryByText('Elige un cliente.')===null,'the client is selected');
  fireEvent.click(within(dialog).getByRole('button',{name:'Añadir al pedido'}));
  const order=within(dialog).getByRole('heading',{name:'Pedido'}).closest('section');
  assert.match(order.querySelector('.store-order-line').textContent,/Proteína.*Chocolate.*× 1.*25,00/);
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
  assert.match(within(dialog).getByRole('heading',{name:'Pedido'}).closest('section').textContent,/Proteína.*Chocolate.*× 3/);
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
  assert.match(within(dialog).getByRole('heading',{name:'Pedido'}).closest('section').textContent,/× 50/);
});

const twoVariants={products:[{...protein,variants:[{...protein.variants[0],stock:10},{id:'v9',sku:null,label:'Vainilla',size:null,flavor:'Vainilla',priceCents:'2700',active:true,stockTracked:true,stock:10}]}],movements:[],sales:[]};
const orderOf=(dialog)=>within(dialog).getByRole('heading',{name:'Pedido'}).closest('section');

test('F/G: two lines add up in the total, and removing one updates it',async()=>{
  await open(twoVariants);fireEvent.click(screen.getByRole('tab',{name:'Ventas'}));fireEvent.click(screen.getAllByRole('button',{name:'Nueva venta en el centro'})[0]);
  const dialog=await screen.findByRole('dialog',{name:'Nueva venta en el centro'});
  fireEvent.change(within(dialog).getByLabelText('Variante'),{target:{value:'v1'}});fireEvent.change(within(dialog).getByLabelText('Unidades'),{target:{value:'2'}});fireEvent.click(within(dialog).getByRole('button',{name:'Añadir al pedido'}));
  fireEvent.change(within(dialog).getByLabelText('Variante'),{target:{value:'v9'}});fireEvent.click(within(dialog).getByRole('button',{name:'Añadir al pedido'}));
  const rows=[...orderOf(dialog).querySelectorAll('.store-order-line')];
  assert.equal(rows.length,2);
  assert.match(rows[0].textContent,/Proteína.*Chocolate.*× 2.*50,00/);
  assert.match(rows[1].textContent,/Proteína.*Vainilla.*× 1.*27,00/);
  assert.match(orderOf(dialog).querySelector('.store-sale-total').textContent,/Total\s*77,00\s*€/,'2 × 25 + 1 × 27');
  fireEvent.click(within(dialog).getByRole('button',{name:'Quitar Proteína Chocolate'}));
  assert.equal(orderOf(dialog).querySelectorAll('.store-order-line').length,1);
  assert.match(orderOf(dialog).querySelector('.store-sale-total').textContent,/Total\s*27,00\s*€/);
  fireEvent.click(within(dialog).getByRole('button',{name:'Quitar Proteína Vainilla'}));
  assert.ok(within(dialog).getByText('Aún no has añadido productos.'),'removing the last line brings the empty help back');
  assert.equal(within(dialog).getByRole('button',{name:'Confirmar venta'}).disabled,true);
});

test('adding the same variant twice merges into one line',async()=>{
  const dialog=await openSale();
  for(const units of ['1','2']){fireEvent.change(within(dialog).getByLabelText('Variante'),{target:{value:'v1'}});fireEvent.change(within(dialog).getByLabelText('Unidades'),{target:{value:units}});fireEvent.click(within(dialog).getByRole('button',{name:'Añadir al pedido'}));}
  const rows=orderOf(dialog).querySelectorAll('.store-order-line');assert.equal(rows.length,1);assert.match(rows[0].textContent,/× 3/);
});

test('C/D: Confirmar venta needs a client and at least one line, and each missing piece is named',async()=>{
  const dialog=await openSale();
  const confirm=within(dialog).getByRole('button',{name:'Confirmar venta'});
  fireEvent.change(within(dialog).getByLabelText('Variante'),{target:{value:'v1'}});fireEvent.click(within(dialog).getByRole('button',{name:'Añadir al pedido'}));
  assert.equal(confirm.disabled,true,'a line without a client is not enough');
  assert.equal(within(dialog).getByText('Elige un cliente.').tagName,'LI');
  assert.ok(within(dialog).queryByText(/Añade al menos un producto/)===null);
  await pickClient(dialog);
  assert.equal(confirm.disabled,false);
  assert.equal(within(dialog).queryByText('Elige un cliente.'),null);
});

test('H: a successful sale posts exact lines, method and state, clears the order and the client, and refreshes the history',async()=>{
  let sold=false;const posts=[];
  const afterSale={...twoVariants,sales:[{id:'s1',clientId:'c1',firstName:'Eva',lastName:'Demo',status:'completed',paymentState:'pending',paymentMethod:'transfer',totalCents:'2500',createdAt:'2026-10-16T10:00:00Z',lines:[{productName:'Proteína',variantLabel:'Chocolate',quantity:1,lineTotalCents:2500}]}]};
  serve({onRequest:(target,init)=>{if(target.endsWith('/api/admin/store/sales')&&init.method==='POST'){sold=true;posts.push(JSON.parse(init.body));return json({id:'s1'},201);}if(target.endsWith('/api/admin/store'))return json(sold?afterSale:twoVariants);return null;}});
  render(React.createElement(StorePage));await screen.findByRole('heading',{name:'Proteína'});
  fireEvent.click(screen.getByRole('tab',{name:'Ventas'}));fireEvent.click(screen.getAllByRole('button',{name:'Nueva venta en el centro'})[0]);
  let dialog=await screen.findByRole('dialog',{name:'Nueva venta en el centro'});await pickClient(dialog);
  fireEvent.change(within(dialog).getByLabelText('Variante'),{target:{value:'v1'}});fireEvent.click(within(dialog).getByRole('button',{name:'Añadir al pedido'}));
  fireEvent.change(within(dialog).getByLabelText('Estado de pago'),{target:{value:'pending'}});fireEvent.change(within(dialog).getByLabelText('Método'),{target:{value:'transfer'}});
  assert.deepEqual([...within(dialog).getByLabelText('Método').options].map(option=>option.textContent),['Efectivo','Tarjeta (registro interno)','Transferencia','Otro'],'only supported methods, card is an internal note');
  assert.deepEqual([...within(dialog).getByLabelText('Estado de pago').options].map(option=>option.textContent),['Pagado en el centro','Pendiente'],'no Planificado, no online payment');
  fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar venta'}));
  await screen.findByText('Venta registrada y stock actualizado.');
  assert.deepEqual(posts,[{clientId:'c1',lines:[{variantId:'v1',quantity:1}],paymentState:'pending',paymentMethod:'transfer',note:''}]);
  assert.ok(await screen.findByText(/Eva Demo/),'the sale is in the history');
  fireEvent.click(screen.getAllByRole('button',{name:'Nueva venta en el centro'})[0]);
  dialog=await screen.findByRole('dialog',{name:'Nueva venta en el centro'});
  assert.ok(within(dialog).getByText('Aún no has añadido productos.'),'the next sale starts with an empty order');
  assert.equal(within(dialog).getByLabelText('Buscar cliente').value,'','and no client');
});

test('14: a double click on Confirmar venta sends the same idempotency key, so the sale cannot be duplicated',async()=>{
  const keys=[];
  serve({onRequest:(target,init)=>{if(target.endsWith('/api/admin/store/sales')&&init.method==='POST'){keys.push(new Headers(init.headers).get('idempotency-key'));return new Promise(resolve=>setTimeout(()=>resolve(json({id:'s1'},201)),30));}return null;}});
  render(React.createElement(StorePage));await screen.findByRole('heading',{name:'Proteína'});
  fireEvent.click(screen.getByRole('tab',{name:'Ventas'}));fireEvent.click(screen.getAllByRole('button',{name:'Nueva venta en el centro'})[0]);
  const dialog=await screen.findByRole('dialog',{name:'Nueva venta en el centro'});await pickClient(dialog);
  fireEvent.change(within(dialog).getByLabelText('Variante'),{target:{value:'v1'}});fireEvent.click(within(dialog).getByRole('button',{name:'Añadir al pedido'}));
  const confirm=within(dialog).getByRole('button',{name:'Confirmar venta'});
  fireEvent.click(confirm);fireEvent.click(confirm);
  await screen.findByText('Venta registrada y stock actualizado.');
  assert.ok(keys.length>=1);assert.equal(new Set(keys).size,1,'every attempt carries the same key');
});

test('inventory: variants without stock control say so instead of showing 0; tracked ones show units and Agotado',async()=>{
  await open({products:[{...protein,variants:[{...protein.variants[0],stock:0},{id:'v7',sku:'CAM-M',label:'Talla M',size:'M',flavor:null,priceCents:'1800',active:true,stockTracked:false,stock:0}]}],movements:[],sales:[]});
  fireEvent.click(screen.getByRole('tab',{name:'Inventario'}));
  const table=screen.getByRole('table');
  assert.deepEqual([...table.querySelectorAll('th')].map(node=>node.textContent),['Producto','Variante','Código','Precio','Stock','Estado']);
  const rows=[...table.querySelectorAll('tbody tr')];
  assert.match(rows[0].textContent,/0 uds\.\s*Agotado/);
  assert.match(rows[1].textContent,/CAM-M/);assert.match(rows[1].textContent,/Sin control de unidades/);assert.doesNotMatch(rows[1].textContent,/\b0 uds/,'untracked is never shown as zero');
  assert.ok([...table.querySelectorAll('td')].every(cell=>cell.hasAttribute('data-label')),'every cell has its label for the stacked mobile layout');
});

test('catalogue cards show media fallback, name, category, price, stock and status; the table is not the main view',async()=>{
  await open();
  const card=within(screen.getByRole('list',{name:'Productos'})).getByRole('article',{name:'Proteína'});
  assert.ok(card.querySelector('.product-media svg')&&card.querySelector('img')===null);
  for(const text of ['Proteína','Nutrición','25,00','4 uds.','Activo'])assert.ok(card.textContent.includes(text),text);
  assert.equal(document.querySelector('table'),null,'the catalogue is cards, not a table');
});

test('J: the sale dialog speaks Spanish: Cliente, not Member, and no online-payment wording',async()=>{
  const dialog=await openSale();
  assert.doesNotMatch(dialog.textContent,/Member|Planificado|checkout|online payment/i);
  assert.ok(within(dialog).getByText(/No se procesa ningún pago online/));
  fireEvent.change(within(dialog).getByLabelText('Método'),{target:{value:'card'}});
  assert.ok(within(dialog).getByText('Solo se anota el método; el cobro no se hace desde esta pantalla.'));
});

test('cancelling a sale and opening a new one starts from an empty order: no stale client, lines or payment choices',async()=>{
  const dialog=await openSale();await pickClient(dialog);
  fireEvent.change(within(dialog).getByLabelText('Variante'),{target:{value:'v1'}});fireEvent.click(within(dialog).getByRole('button',{name:'Añadir al pedido'}));
  fireEvent.change(within(dialog).getByLabelText('Método'),{target:{value:'transfer'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Cancelar'}));
  await waitFor(()=>assert.equal(screen.queryByRole('dialog'),null));
  fireEvent.click(screen.getAllByRole('button',{name:'Nueva venta en el centro'})[0]);
  const again=await screen.findByRole('dialog',{name:'Nueva venta en el centro'});
  assert.ok(within(again).getByText('Aún no has añadido productos.'));
  assert.equal(within(again).getByLabelText('Buscar cliente').value,'');
  assert.equal(within(again).getByLabelText('Método').value,'cash');
  assert.equal(within(again).getByLabelText('Estado de pago').value,'paid');
});
