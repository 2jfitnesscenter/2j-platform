import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { ensureCashSessionForActor } from './cash-fixture.mjs';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: Store integration tests cannot be skipped.');
const sql=postgres(process.env.DATABASE_URL,{max:12,connect_timeout:5});await migrateDatabase(sql);
const admin=buildServer(process.env.DATABASE_URL,{authorizationResolver:async()=>({actorId:'store-test-admin',role:'admin'}),ownerActorId:'store-test-admin'});
const trainer=buildServer(process.env.DATABASE_URL,{authorizationResolver:async()=>({actorId:'store-test-trainer',role:'trainer'})});
const accountant=buildServer(process.env.DATABASE_URL,{authorizationResolver:async()=>({actorId:'store-test-accountant',role:'accountant'})});
const memberIds={};
const member=(name)=>buildServer(process.env.DATABASE_URL,{clientAuthorizationResolver:async()=>({clientId:memberIds[name]})});
for(const [name,firstName] of [['a','Tienda A'],['b','Tienda B']]){const created=await admin.inject({method:'POST',url:'/api/clients',headers:{'idempotency-key':randomUUID()},payload:{firstName,lastName:`Store ${randomUUID().slice(0,8)}`}});assert.equal(created.statusCode,201,created.body);memberIds[name]=created.json().id;}
const memberA=member('a');const memberB=member('b');
after(async()=>{await Promise.all([admin.close(),trainer.close(),accountant.close(),memberA.close(),memberB.close()]);await sql.end();});
const post=(url,payload,extra={})=>admin.inject({method:'POST',url,headers:extra,payload});
const cashDenominationKeys=['coin_0_01','coin_0_02','coin_0_05','coin_0_10','coin_0_20','coin_0_50','coin_1','coin_2','bill_5','bill_10','bill_20','bill_50','bill_100','bill_200','bill_500'];
const cashCount=(cents)=>Object.fromEntries(cashDenominationKeys.map((key,index)=>[key,index===0?cents:0]));
async function product({category='nutrition',name=`Producto ${randomUUID()}`,active=true}={}){const response=await post('/api/admin/store/products',{category,name,description:'Producto de prueba'});assert.equal(response.statusCode,201,response.body);return response.json();}
async function variant(productId,{label='Formato 300 g',priceCents=1250,stockTracked=true,active=true,sku=null}={}){const response=await post(`/api/admin/store/products/${productId}/variants`,{label,priceCents,stockTracked,active,sku});assert.equal(response.statusCode,201,response.body);return response.json();}
async function stock(variantId,quantity=3){const response=await post(`/api/admin/store/variants/${variantId}/movements`,{type:'opening',quantity,reason:'Apertura sintética'});assert.equal(response.statusCode,201,response.body);}
async function ensureOpenCash(){return ensureCashSessionForActor(sql,'store-test-admin');}
async function sale(clientId,variantId,quantity,key=randomUUID(),payloadExtra={}){await ensureOpenCash();return post('/api/admin/store/sales',{clientId,lines:[{variantId,quantity}],paymentState:'paid',paymentMethod:'cash',...payloadExtra},{'idempotency-key':key});}

test('store management and POS are denied to roles without explicit grants',async()=>{
  assert.equal((await trainer.inject({method:'GET',url:'/api/admin/store'})).statusCode,403);
  assert.equal((await trainer.inject({method:'POST',url:'/api/admin/store/products',payload:{category:'nutrition',name:'No',description:''}})).statusCode,403);
  assert.equal((await accountant.inject({method:'GET',url:'/api/admin/store/sales'})).statusCode,403);
  assert.equal((await trainer.inject({method:'POST',url:'/api/admin/store/sales',payload:{}})).statusCode,403);
});

test('product, variant, price and stock edits append audit and movement records; stock cannot turn negative',async()=>{
  const item=await product();const v=await variant(item.id,{label:'Formato inicial'});
  assert.equal((await post(`/api/admin/store/variants/${v.id}/movements`,{type:'opening',quantity:5,reason:'Stock de apertura'})).statusCode,201);
  assert.equal((await post(`/api/admin/store/variants/${v.id}/movements`,{type:'opening',quantity:1,reason:'Segundo inicio'})).statusCode,409);
  assert.equal((await post(`/api/admin/store/variants/${v.id}/movements`,{type:'restock',quantity:4,reason:'Reposición'})).statusCode,201);
  assert.equal((await post(`/api/admin/store/variants/${v.id}/movements`,{type:'adjustment_out',quantity:2,reason:'Recuento físico'})).statusCode,201);
  const tooMuch=await post(`/api/admin/store/variants/${v.id}/movements`,{type:'adjustment_out',quantity:99,reason:'No debe dejar saldo negativo'});assert.equal(tooMuch.statusCode,409);assert.equal(tooMuch.json().error,'insufficient_stock');
  const updatedProduct=await admin.inject({method:'PATCH',url:`/api/admin/store/products/${item.id}`,payload:{name:'Producto actualizado',description:'Descripción actualizada'}});assert.equal(updatedProduct.statusCode,200);assert.equal(updatedProduct.json().name,'Producto actualizado');
  const updatedVariant=await admin.inject({method:'PATCH',url:`/api/admin/store/variants/${v.id}`,payload:{label:'Formato editado',priceCents:3000}});assert.equal(updatedVariant.statusCode,200);assert.equal(Number(updatedVariant.json().priceCents),3000);
  const [balance]=await sql`SELECT sum(quantity_delta)::int AS stock FROM store_inventory_movements WHERE variant_id=${v.id}`;assert.equal(balance.stock,7);
  const [movementAudits]=await sql`SELECT count(*)::int AS count FROM store_audit_events WHERE resource_id=${v.id} AND action IN ('inventory.opening','inventory.restocked','inventory.adjusted')`;assert.equal(movementAudits.count,3);
  const [productAudit]=await sql`SELECT count(*)::int AS count FROM store_audit_events WHERE resource_id=${item.id} AND action='product.updated'`;assert.equal(productAudit.count,1);
  const [variantAudit]=await sql`SELECT count(*)::int AS count FROM store_audit_events WHERE resource_id=${v.id} AND action='variant.price_changed'`;assert.equal(variantAudit.count,1);
});

test('catalog filters inactive products and variants and exposes only coarse stock to Members without an active fee',async()=>{
  const item=await product();const live=await variant(item.id,{label:'Sabor neutro'});const off=await variant(item.id,{label:'Sabor archivado',active:false});await stock(live.id,2);await stock(off.id,8);
  const hidden=await product({name:`Oculto ${randomUUID()}`});await variant(hidden.id,{label:'Inactivo'});await admin.inject({method:'PATCH',url:`/api/admin/store/products/${hidden.id}`,payload:{active:false}});
  const response=await memberA.inject({method:'GET',url:'/api/me/store/catalog'});assert.equal(response.statusCode,200,response.body);const found=response.json().items.find(row=>row.id===item.id);assert.ok(found);assert.deepEqual(found.variants.map(row=>row.id),[live.id]);assert.equal(found.variants[0].availability,'pocas_unidades');assert.equal(JSON.stringify(response.json()).includes('stock'),false);assert.equal(JSON.stringify(response.json()).includes('movement'),false);
  assert.equal((await memberA.inject({method:'GET',url:`/api/me/store/catalog?clientId=${memberIds.b}`})).json().items.some(row=>row.id===hidden.id),false);
});

test('D113 blocks paid POS sales without an open shift and links cash sales into the shift total',async()=>{
  const sourceUrl=new URL(process.env.DATABASE_URL),databaseName=`store_d113_${randomUUID().replaceAll('-','')}`;
  const adminUrl=new URL(sourceUrl);adminUrl.pathname='/postgres';const root=postgres(adminUrl.toString(),{max:1,connect_timeout:5});
  let isolated,localSql,localAdmin;
  try{
    await root.unsafe(`CREATE DATABASE "${databaseName}"`);sourceUrl.pathname=`/${databaseName}`;const databaseUrl=sourceUrl.toString();
    localSql=postgres(databaseUrl,{max:8,connect_timeout:5});await migrateDatabase(localSql);
    localAdmin=buildServer(databaseUrl,{authorizationResolver:async()=>({actorId:'store-d113-owner',role:'admin'}),ownerActorId:'store-d113-owner'});
    const created=await localAdmin.inject({method:'POST',url:'/api/clients',headers:{'idempotency-key':randomUUID()},payload:{firstName:'POS',lastName:'D113 QA'}});assert.equal(created.statusCode,201,created.body);
    const itemResponse=await localAdmin.inject({method:'POST',url:'/api/admin/store/products',payload:{category:'nutrition',name:`Venta de caja ${randomUUID()}`,description:'D113'} });assert.equal(itemResponse.statusCode,201,itemResponse.body);
    const vResponse=await localAdmin.inject({method:'POST',url:`/api/admin/store/products/${itemResponse.json().id}/variants`,payload:{label:'Unidad',priceCents:1299,stockTracked:true,active:true,sku:null}});assert.equal(vResponse.statusCode,201,vResponse.body);
    const v=vResponse.json();assert.equal((await localAdmin.inject({method:'POST',url:`/api/admin/store/variants/${v.id}/movements`,payload:{type:'opening',quantity:3,reason:'Stock sintético'}})).statusCode,201);
    const key=randomUUID();const salePayload={clientId:created.json().id,lines:[{variantId:v.id,quantity:1}],paymentState:'paid',paymentMethod:'card'};
    const denied=await localAdmin.inject({method:'POST',url:'/api/admin/store/sales',headers:{'idempotency-key':key},payload:salePayload});
    assert.equal(denied.statusCode,409,denied.body);assert.equal(denied.json().error,'cash_session_required');
    const [noSale]=await localSql`SELECT count(*)::int AS count FROM store_sales WHERE idempotency_key=${key}::uuid`;assert.equal(noSale.count,0);
    await assert.rejects(localSql`INSERT INTO store_sales(center_key,client_id,payment_state,payment_method,subtotal_cents,total_cents,note,idempotency_key,request_hash,created_by) VALUES ('2j',${created.json().id},'paid','card',100,100,'',${randomUUID()},${'a'.repeat(64)},'qa')`,{code:'23514'});
    const [professional]=await localSql`INSERT INTO staff_professionals(first_name,last_name,display_name,base_role,auth_actor_id,created_by) VALUES ('Caja','QA','Caja D113','admin','store-d113-owner','test') RETURNING id`;
    const clockIn=await localAdmin.inject({method:'POST',url:'/api/timeclock/clock-in',payload:{origin:'web'}});assert.equal(clockIn.statusCode,201,clockIn.body);
    const zero=cashCount(0);const opened=await localAdmin.inject({method:'POST',url:'/api/economics/cash/open',payload:{registerCode:'bunker',openingDenominations:zero}});assert.equal(opened.statusCode,201,opened.body);
    const cashSale=await localAdmin.inject({method:'POST',url:'/api/admin/store/sales',headers:{'idempotency-key':randomUUID()},payload:{...salePayload,paymentMethod:'cash'}});assert.equal(cashSale.statusCode,201,cashSale.body);
    const cardSale=await localAdmin.inject({method:'POST',url:'/api/admin/store/sales',headers:{'idempotency-key':randomUUID()},payload:salePayload});assert.equal(cardSale.statusCode,201,cardSale.body);assert.equal(cardSale.json().cashSessionId,opened.json().id,'todos los métodos de cobro POS quedan vinculados al registro abierto');
    const snapshot=await localAdmin.inject({method:'GET',url:'/api/economics/cash/today'});assert.equal(Number(snapshot.json().session.cashStoreSalesCents),1299);assert.equal(Number(snapshot.json().session.expectedCents),1299);
    const voided=await localAdmin.inject({method:'POST',url:`/api/admin/store/sales/${cashSale.json().id}/void`,payload:{reason:'Anulación de prueba D113'}});assert.equal(voided.statusCode,200,voided.body);
    const afterVoid=await localAdmin.inject({method:'GET',url:'/api/economics/cash/today'});assert.equal(Number(afterVoid.json().session.cashStoreSalesCents),1299);assert.equal(Number(afterVoid.json().session.cashStoreRefundsCents),1299);assert.equal(Number(afterVoid.json().session.storeSaleAnnulmentsCents),1299);assert.equal(Number(afterVoid.json().session.expectedCents),0);
    const [voidMovement]=await localSql`SELECT cash_session_id,payment_method,amount_cents FROM store_sale_cash_movements WHERE sale_id=${cashSale.json().id}`;
    assert.equal(voidMovement.cash_session_id,opened.json().id);assert.equal(voidMovement.payment_method,'cash');assert.equal(Number(voidMovement.amount_cents),1299);assert.ok(professional.id);
  }finally{await localAdmin?.close();await localSql?.end();await root.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);await root.end();}
});

test('sale calculates authoritative price, snapshots labels, decrements stock, and idempotent retry creates one sale and movement',async()=>{
  const item=await product();const v=await variant(item.id,{label:'Sabor cacao',priceCents:1299,sku:`S-${randomUUID()}`});await stock(v.id,5);const idem=randomUUID();
  const created=await sale(memberIds.a,v.id,2,idem);assert.equal(created.statusCode,201,created.body);assert.equal(created.json().totalCents,2598);assert.equal(created.json().lines[0].productName,item.name);assert.equal(created.json().lines[0].unitPriceCents,1299);
  await admin.inject({method:'PATCH',url:`/api/admin/store/variants/${v.id}`,payload:{priceCents:2200,label:'Formato revisado'}});
  const replay=await sale(memberIds.a,v.id,2,idem);assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().id,created.json().id);assert.equal(replay.json().lines[0].variantLabel,'Sabor cacao');
  const conflict=await sale(memberIds.a,v.id,2,idem,{note:'payload distinto'});assert.equal(conflict.statusCode,409);assert.equal(conflict.json().error,'idempotency_conflict');
  const [remaining]=await sql`SELECT sum(quantity_delta)::int AS stock FROM store_inventory_movements WHERE variant_id=${v.id}`;assert.equal(remaining.stock,3);
  const [sales]=await sql`SELECT count(*)::int AS count FROM store_sales WHERE idempotency_key=${idem}::uuid`;assert.equal(sales.count,1);
  const [movements]=await sql`SELECT count(*)::int AS count FROM store_inventory_movements WHERE variant_id=${v.id} AND movement_type='sale'`;assert.equal(movements.count,1);
  const [audits]=await sql`SELECT count(*)::int AS count FROM store_audit_events WHERE resource_id=${created.json().id} AND action='sale.created'`;assert.equal(audits.count,1);
});

test('concurrent retries with the same idempotency key replay one sale and one stock movement',async()=>{
  const item=await product();const v=await variant(item.id,{label:'Retry simultáneo'});await stock(v.id,1);const idem=randomUUID();
  const results=await Promise.all([sale(memberIds.a,v.id,1,idem),sale(memberIds.a,v.id,1,idem)]);
  assert.deepEqual(results.map(result=>result.statusCode).sort(),[200,201]);
  assert.equal(results[0].json().id,results[1].json().id);
  const [sales]=await sql`SELECT count(*)::int AS count FROM store_sales WHERE idempotency_key=${idem}::uuid`;assert.equal(sales.count,1);
  const [movements]=await sql`SELECT count(*)::int AS count FROM store_inventory_movements WHERE variant_id=${v.id} AND movement_type='sale'`;assert.equal(movements.count,1);
  const [balance]=await sql`SELECT sum(quantity_delta)::int AS stock FROM store_inventory_movements WHERE variant_id=${v.id}`;assert.equal(balance.stock,0);
});

test('failed insufficient-stock sale rolls back; concurrent last-unit attempts allow exactly one sale',async()=>{
  const item=await product();const v=await variant(item.id,{label:'Unidad única'});await stock(v.id,1);
  const [salesBefore]=await sql`SELECT count(*)::int AS count FROM store_sales`;
  const [movementsBefore]=await sql`SELECT count(*)::int AS count FROM store_inventory_movements WHERE variant_id=${v.id}`;
  const failed=await sale(memberIds.a,v.id,2);assert.equal(failed.statusCode,409);assert.equal(failed.json().error,'insufficient_stock');
  const [salesAfter]=await sql`SELECT count(*)::int AS count FROM store_sales`;const [movementsAfter]=await sql`SELECT count(*)::int AS count FROM store_inventory_movements WHERE variant_id=${v.id}`;
  assert.equal(salesAfter.count,salesBefore.count);assert.equal(movementsAfter.count,movementsBefore.count);
  const results=await Promise.all([sale(memberIds.a,v.id,1),sale(memberIds.b,v.id,1)]);assert.deepEqual(results.map(result=>result.statusCode).sort(),[201,409]);
  const [balance]=await sql`SELECT sum(quantity_delta)::int AS stock FROM store_inventory_movements WHERE variant_id=${v.id}`;assert.equal(balance.stock,0);
});

test('void restores tracked stock once and preserves sale, lines, movement ledger and audit history',async()=>{
  const item=await product();const v=await variant(item.id,{label:'Pack',priceCents:2500});await stock(v.id,4);const created=await sale(memberIds.a,v.id,3);assert.equal(created.statusCode,201,created.body);
  const voided=await admin.inject({method:'POST',url:`/api/admin/store/sales/${created.json().id}/void`,payload:{}});assert.equal(voided.statusCode,200,voided.body);assert.equal(voided.json().status,'voided');
  const duplicate=await admin.inject({method:'POST',url:`/api/admin/store/sales/${created.json().id}/void`,payload:{}});assert.equal(duplicate.statusCode,409);assert.equal(duplicate.json().error,'sale_already_voided');
  const [balance]=await sql`SELECT sum(quantity_delta)::int AS stock FROM store_inventory_movements WHERE variant_id=${v.id}`;assert.equal(balance.stock,4);
  const [saleCount]=await sql`SELECT count(*)::int AS count FROM store_sales WHERE id=${created.json().id}`;const [lineCount]=await sql`SELECT count(*)::int AS count FROM store_sale_lines WHERE sale_id=${created.json().id}`;const [movementCount]=await sql`SELECT count(*)::int AS count FROM store_inventory_movements WHERE sale_id=${created.json().id}`;const [auditCount]=await sql`SELECT count(*)::int AS count FROM store_audit_events WHERE resource_id=${created.json().id} AND action IN ('sale.created','sale.voided')`;
  assert.equal(saleCount.count,1);assert.equal(lineCount.count,1);assert.equal(movementCount.count,2);assert.equal(auditCount.count,2);
});

test('store sale annulment is refused without a shift and appears as a linked movement in the next close',async()=>{
  const item=await product();const v=await variant(item.id,{label:'Anulación con turno'});await stock(v.id,2);
  const created=await sale(memberIds.a,v.id,1);assert.equal(created.statusCode,201,created.body);
  const current=await admin.inject({method:'GET',url:'/api/economics/cash/today'});
  const [saleSession]=await sql`SELECT cash_session_id AS "cashSessionId" FROM store_sales WHERE id=${created.json().id}`;
  const saleCash=current.json().items.find(item=>item.id===saleSession.cashSessionId);assert.ok(saleCash,'the sale must remain linked to its exact session');
  const closed=await admin.inject({method:'POST',url:`/api/economics/cash/${saleCash.id}/close`,payload:{countedDenominations:cashCount(saleCash.expectedCents)}});assert.equal(closed.statusCode,200,closed.body);
  const rejected=await admin.inject({method:'POST',url:`/api/admin/store/sales/${created.json().id}/void`,payload:{reason:'Sin turno de caja'}});
  assert.equal(rejected.statusCode,409,rejected.body);assert.equal(rejected.json().error,'cash_session_required');
  await assert.rejects(sql`UPDATE store_sales SET status='voided',voided_at=now(),voided_by='qa-bypass' WHERE id=${created.json().id}`,{code:'23514'});
  const [unchanged]=await sql`SELECT status FROM store_sales WHERE id=${created.json().id}`;assert.equal(unchanged.status,'completed');
  const [none]=await sql`SELECT count(*)::int AS count FROM store_sale_cash_movements WHERE sale_id=${created.json().id}`;assert.equal(none.count,0);
  const opened=await admin.inject({method:'POST',url:'/api/economics/cash/open',payload:{registerCode:'bunker',openingDenominations:cashCount(2000)}});assert.equal(opened.statusCode,201,opened.body);
  const voided=await admin.inject({method:'POST',url:`/api/admin/store/sales/${created.json().id}/void`,payload:{reason:'Anulación con turno'}});assert.equal(voided.statusCode,200,voided.body);
  const [movement]=await sql`SELECT cash_session_id,payment_method,amount_cents FROM store_sale_cash_movements WHERE sale_id=${created.json().id}`;
  assert.equal(movement.cash_session_id,opened.json().id);assert.equal(movement.payment_method,'cash');assert.equal(Number(movement.amount_cents),Number(created.json().totalCents));
  const live=await admin.inject({method:'GET',url:'/api/economics/cash/today'});
  const liveSession=live.json().items.find(item=>item.id===opened.json().id);assert.ok(liveSession);
  assert.equal(Number(liveSession.cashStoreRefundsCents),Number(created.json().totalCents));
  const expectedAfterRefund=Number(opened.json().openingCents)-Number(created.json().totalCents);
  assert.equal(Number(liveSession.expectedCents),expectedAfterRefund);
  const close=await admin.inject({method:'POST',url:`/api/economics/cash/${opened.json().id}/close`,payload:{countedDenominations:cashCount(expectedAfterRefund)}});assert.equal(close.statusCode,200,close.body);
  assert.equal(Number(close.json().cashStoreRefundsCents),Number(created.json().totalCents));
});

test('Member history is self-scoped, includes own sale snapshots, and does not require booking entitlement',async()=>{
  const item=await product();const v=await variant(item.id,{label:'Member item'});await stock(v.id,3);const created=await sale(memberIds.a,v.id,1);assert.equal(created.statusCode,201);
  const own=await memberA.inject({method:'GET',url:`/api/me/store/purchases?clientId=${memberIds.b}`});assert.equal(own.statusCode,200,own.body);assert.ok(own.json().items.some(row=>row.id===created.json().id));assert.equal(JSON.stringify(own.json()).includes(memberIds.b),false);
  const other=await memberB.inject({method:'GET',url:'/api/me/store/purchases'});assert.equal(other.statusCode,200);assert.equal(other.json().items.some(row=>row.id===created.json().id),false);
  assert.equal((await admin.inject({method:'GET',url:`/api/clients/${memberIds.a}`})).statusCode,200);
});
