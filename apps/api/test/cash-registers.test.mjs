import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: cash register PostgreSQL tests cannot be skipped.');
const sourceUrl=new URL(process.env.DATABASE_URL),databaseName=`cash_registers_${randomUUID().replaceAll('-','')}`;
const adminUrl=new URL(sourceUrl);adminUrl.pathname='/postgres';const admin=postgres(adminUrl.toString(),{max:2,connect_timeout:5});
await admin.unsafe(`CREATE DATABASE "${databaseName}"`);sourceUrl.pathname=`/${databaseName}`;
const databaseUrl=sourceUrl.toString(),sql=postgres(databaseUrl,{max:12,connect_timeout:5});await migrateDatabase(sql);
const actor=(actorId,role='trainer',extra={})=>buildServer(databaseUrl,{authorizationResolver:async()=>({actorId,role,...extra}),...(actorId==='cash-owner'?{ownerActorId:actorId}:{})});
const trainerA=actor('cash-trainer-a'),trainerB=actor('cash-trainer-b'),owner=actor('cash-owner','admin'),plainAdmin=actor('cash-plain-admin','admin');
const cashManagerWithOutflow=actor('cash-trainer-b','trainer',{explicitPermissions:['billing.cash.adjust']});
const denominationKeys=['coin_0_01','coin_0_02','coin_0_05','coin_0_10','coin_0_20','coin_0_50','coin_1','coin_2','bill_5','bill_10','bill_20','bill_50','bill_100','bill_200','bill_500'];
const count=(cents)=>Object.fromEntries(denominationKeys.map((key,index)=>[key,index===0?cents:0]));
let personA,personB,sessionBunker,sessionSala;

after(async()=>{await Promise.all([trainerA.close(),trainerB.close(),owner.close(),plainAdmin.close(),cashManagerWithOutflow.close()]);await sql.end();await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);await admin.end();});

test('two physical registers have isolated custodians, blind counts, handover and owner-only daily totals',async()=>{
  [personA]=await sql`INSERT INTO staff_professionals(first_name,last_name,display_name,base_role,auth_actor_id,created_by) VALUES ('Caja','A','Caja A','trainer','cash-trainer-a','test') RETURNING id`;
  [personB]=await sql`INSERT INTO staff_professionals(first_name,last_name,display_name,base_role,auth_actor_id,created_by) VALUES ('Caja','B','Caja B','trainer','cash-trainer-b','test') RETURNING id`;
  for(const app of [trainerA,trainerB]){const response=await app.inject({method:'POST',url:'/api/timeclock/clock-in',payload:{origin:'web'}});assert.equal(response.statusCode,201,response.body);}
  const openingA=count(5000),openingB=count(3000);
  const openA=await trainerA.inject({method:'POST',url:'/api/economics/cash/open',payload:{registerCode:'bunker',openingDenominations:openingA}});
  assert.equal(openA.statusCode,201,openA.body);sessionBunker=openA.json().id;
  for(const key of ['expectedCents','countedCents','differenceCents','previousCloseCents'])assert.equal(Object.hasOwn(openA.json(),key),false,`open API must not expose ${key}`);
  const openB=await trainerB.inject({method:'POST',url:'/api/economics/cash/open',payload:{registerCode:'sala',openingDenominations:openingB}});
  assert.equal(openB.statusCode,201,openB.body);sessionSala=openB.json().id;
  const actorARegisters=await trainerA.inject({method:'GET',url:'/api/economics/cash/registers'});
  assert.equal(actorARegisters.statusCode,200);assert.equal(actorARegisters.json().items.filter(row=>row.ownCustody).length,1);
  assert.equal(actorARegisters.json().items.find(row=>row.code==='sala').sessionId,null,'another custodian session id is not exposed');
  const trainerDay=await trainerA.inject({method:'GET',url:'/api/economics/cash/today'});
  assert.equal(trainerDay.statusCode,200);assert.equal(trainerDay.json().items.length,1);
  for(const key of ['openingCents','expectedCents','countedCents','differenceCents','openingDenominations'])assert.equal(Object.hasOwn(trainerDay.json().items[0],key),false,`trainer endpoint must hide ${key}`);
  assert.equal((await trainerA.inject({method:'GET',url:'/api/economics/cash/day'})).statusCode,403,'global daily view is owner-only');
  const blockedHandover=await trainerA.inject({method:'POST',url:`/api/economics/cash/${sessionBunker}/handover`,payload:{incomingProfessionalId:personB.id,outgoingDenominations:count(5000)}});
  assert.equal(blockedHandover.statusCode,409);assert.equal(blockedHandover.json().error,'handover_recipient_holds_register','one person cannot hold two registers simultaneously');
  const outgoingMovementId=randomUUID();
  await sql`INSERT INTO economic_cash_outflows(id,cash_session_id,movement_type,amount_cents,reason,actor_id,status,approved_by,approved_at) VALUES (${outgoingMovementId},${sessionBunker},'expense',100,'Compra antes del traspaso','cash-trainer-a','approved','cash-trainer-a',now())`;

  const blindClose=await trainerB.inject({method:'POST',url:`/api/economics/cash/${sessionSala}/close`,payload:{countedDenominations:count(3000)}});
  assert.equal(blindClose.statusCode,200,blindClose.body);for(const key of ['expectedCents','differenceCents','openingCents'])assert.equal(Object.hasOwn(blindClose.json(),key),false,`cashier close must keep ${key} blind`);
  const clockOutB=await trainerB.inject({method:'POST',url:'/api/timeclock/clock-out',payload:{origin:'web'}});assert.equal(clockOutB.statusCode,201,clockOutB.body);
  const recipientNotClocked=await trainerA.inject({method:'POST',url:`/api/economics/cash/${sessionBunker}/handover`,payload:{incomingProfessionalId:personB.id,outgoingDenominations:count(5000)}});
  assert.equal(recipientNotClocked.statusCode,409);assert.equal(recipientNotClocked.json().error,'handover_recipient_not_clocked_in');
  assert.equal((await trainerB.inject({method:'POST',url:'/api/timeclock/clock-in',payload:{origin:'web'}})).statusCode,201);
  const handover=await trainerA.inject({method:'POST',url:`/api/economics/cash/${sessionBunker}/handover`,payload:{incomingProfessionalId:personB.id,outgoingDenominations:count(5000)}});
  assert.equal(handover.statusCode,201,handover.body);
  const pendingHandover=await trainerB.inject({method:'GET',url:'/api/economics/cash/handovers/pending'});assert.equal(pendingHandover.statusCode,200,pendingHandover.body);
  assert.equal(pendingHandover.json().items[0].id,handover.json().id);assert.equal(Object.hasOwn(pendingHandover.json().items[0],'outgoingDenominations'),false,'the receiver must not see the outgoing blind count');
  const received=await trainerB.inject({method:'POST',url:`/api/economics/cash/handovers/${handover.json().id}/confirm`,payload:{incomingDenominations:count(4900)}});
  assert.equal(received.statusCode,200,received.body);assert.equal('mismatch' in received.json(),false,'cashier response must not disclose owner-only mismatch');
  const incomingMovementId=randomUUID();
  await sql`INSERT INTO economic_cash_outflows(id,cash_session_id,movement_type,amount_cents,reason,actor_id,status,approved_by,approved_at) VALUES (${incomingMovementId},${sessionBunker},'withdrawal',200,'Retirada después del traspaso','cash-trainer-b','approved','cash-trainer-b',now())`;
  const outgoingToday=await trainerA.inject({method:'GET',url:'/api/economics/cash/today'});
  assert.equal(outgoingToday.statusCode,200,outgoingToday.body);
  assert.ok(outgoingToday.json().session.movements.some(item=>item.id===outgoingMovementId),'outgoing custodian keeps their own movements');
  assert.ok(!outgoingToday.json().session.movements.some(item=>item.id===incomingMovementId),'outgoing custodian cannot see movements after handover');
  const incomingToday=await trainerB.inject({method:'GET',url:'/api/economics/cash/today'});
  assert.equal(incomingToday.statusCode,200,incomingToday.body);
  assert.ok(incomingToday.json().session.movements.some(item=>item.id===incomingMovementId),'incoming custodian sees movements from their custody interval');
  assert.ok(!incomingToday.json().session.movements.some(item=>item.id===outgoingMovementId),'incoming custodian cannot see outgoing movements');
  const clockOutA=await trainerA.inject({method:'POST',url:'/api/timeclock/clock-out',payload:{origin:'web'}});
  assert.equal(clockOutA.statusCode,201,clockOutA.body,'outgoing trainer may clock out after handover');
  const clockOutBBlocked=await trainerB.inject({method:'POST',url:'/api/timeclock/clock-out',payload:{origin:'web'}});
  assert.equal(clockOutBBlocked.statusCode,409);assert.equal(clockOutBBlocked.json().error,'cash_register_must_be_closed_or_handed_over');

  const ownerDay=await owner.inject({method:'GET',url:'/api/economics/cash/day'});
  assert.equal(ownerDay.statusCode,200,ownerDay.body);assert.equal(ownerDay.json().registers.length,2);
  assert.equal(ownerDay.json().registers.find(row=>row.registerCode==='bunker').handovers[0].mismatch,true);
  assert.equal(Number(ownerDay.json().registers.find(row=>row.registerCode==='sala').openingCents),3000);
  const commandCenter=await owner.inject({method:'GET',url:'/api/dashboard/command-center'});
  assert.equal(commandCenter.statusCode,200,commandCenter.body);assert.equal(commandCenter.json().economics.cashSession.registers.length,2);
  const nonOwnerDashboard=await plainAdmin.inject({method:'GET',url:'/api/dashboard/command-center'});
  assert.equal(nonOwnerDashboard.statusCode,200,nonOwnerDashboard.body);assert.equal(nonOwnerDashboard.json().economics.cashSession,null,'another actor gets no global cash snapshot');
  const finalClose=await trainerB.inject({method:'POST',url:`/api/economics/cash/${sessionBunker}/close`,payload:{countedDenominations:count(4900)}});
  assert.equal(finalClose.statusCode,200,finalClose.body);for(const key of ['expectedCents','differenceCents','openingCents','previousCloseCents'])assert.equal(Object.hasOwn(finalClose.json(),key),false);
  const [register]=await sql`SELECT register_id AS id,local_date AS date FROM economic_cash_sessions WHERE id=${sessionBunker}`;
  await assert.rejects(sql`INSERT INTO economic_cash_sessions(register_id,local_date,opening_cents,opening_denominations,opened_by) VALUES (${register.id},${register.date},2000,${sql.json(count(2000))},'cash-trainer-b')`,error=>error.code==='23505'&&error.message.includes('economic_cash_one_session_per_register_day'));
  assert.equal((await trainerB.inject({method:'POST',url:'/api/timeclock/clock-out',payload:{origin:'web'}})).statusCode,201);
  assert.equal((await trainerB.inject({method:'POST',url:'/api/timeclock/clock-in',payload:{origin:'web'}})).statusCode,201);
  const duplicateDayOpen=await trainerB.inject({method:'POST',url:'/api/economics/cash/open',payload:{registerCode:'bunker',openingDenominations:count(2000)}});
  assert.equal(duplicateDayOpen.statusCode,409);assert.equal(duplicateDayOpen.json().error,'cash_register_already_used_today');
  const nonOwnerReopen=await plainAdmin.inject({method:'POST',url:`/api/economics/cash/${sessionBunker}/owner-reopen`,payload:{custodianActorId:'cash-trainer-b',openingDenominations:count(2000)}});
  assert.equal(nonOwnerReopen.statusCode,403,'reopening an already closed register must be owner-only');
  const ownerReopen=await owner.inject({method:'POST',url:`/api/economics/cash/${sessionBunker}/owner-reopen`,payload:{custodianActorId:'cash-trainer-b',openingDenominations:count(2000)}});
  assert.equal(ownerReopen.statusCode,200,ownerReopen.body);assert.equal(ownerReopen.json().id,sessionBunker);assert.equal(ownerReopen.json().status,'open');
  for(const key of ['expectedCents','differenceCents','previousCloseCents'])assert.equal(Object.hasOwn(ownerReopen.json(),key),false,`owner reopening must not expose cash expectations in the operational response`);
  assert.equal((await trainerB.inject({method:'POST',url:'/api/timeclock/clock-out',payload:{origin:'web'}})).statusCode,409);
  const [reopenAudit]=await sql`SELECT actor_id,details FROM economic_audit_events WHERE resource_id=${sessionBunker} AND action='cash.reopened' ORDER BY occurred_at DESC LIMIT 1`;
  assert.equal(reopenAudit.actor_id,'cash-owner');assert.equal(reopenAudit.details.custodianActorId,'cash-trainer-b');
});

test('migration 0055 attaches the current-register guards to payments, paid store sales and store annulments',async()=>{
  const [paymentTrigger]=await sql`SELECT t.tgname AS name,p.proname AS function FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='economic_transactions'::regclass AND t.tgname='economic_transactions_cash_session_guard' AND NOT t.tgisinternal`;
  assert.equal(paymentTrigger?.function,'economic_transaction_cash_session_guard');
  const [saleTrigger]=await sql`SELECT t.tgname AS name,p.proname AS function FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='store_sales'::regclass AND t.tgname='store_sale_payment_cash_session_guard' AND NOT t.tgisinternal`;
  assert.equal(saleTrigger?.function,'store_sale_payment_requires_cash_session');
  const [saleUpdateTrigger]=await sql`SELECT t.tgname AS name,p.proname AS function FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='store_sales'::regclass AND t.tgname='store_sale_payment_cash_session_update_guard' AND NOT t.tgisinternal`;
  assert.equal(saleUpdateTrigger?.function,'store_sale_payment_requires_cash_session','D113 guard also runs when a sale transitions into a paid state');
  const [movementTrigger]=await sql`SELECT t.tgname AS name,p.proname AS function FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='store_sale_cash_movements'::regclass AND t.tgname='store_sale_cash_movement_current_session' AND NOT t.tgisinternal`;
  assert.equal(movementTrigger?.function,'store_sale_cash_movement_guard');
  const [sessionDayIndex]=await sql`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='economic_cash_sessions' AND indexname='economic_cash_one_session_per_register_day'`;
  assert.match(sessionDayIndex?.indexdef??'',/UNIQUE.*\(register_id, local_date\)/i);
  const [transferFk]=await sql`SELECT condeferrable FROM pg_constraint WHERE conrelid='economic_transfer_proofs'::regclass AND conname='economic_transfer_proofs_transaction_id_fkey'`;
  assert.equal(transferFk?.condeferrable,true,'proof can bind to the transaction before that transaction is inserted within the same atomic review');
});

test('expenses require their dedicated permission, accept no receipt, and owner limit routes an over-limit movement to approval',async()=>{
  const denied=await trainerA.inject({method:'POST',url:'/api/economics/cash/outflows',payload:{movementType:'expense',amountCents:100,reason:'Compra de prueba'}});
  assert.equal(denied.statusCode,403);
  const free=await cashManagerWithOutflow.inject({method:'POST',url:'/api/economics/cash/outflows',payload:{movementType:'expense',amountCents:100,reason:'Compra de prueba'}});
  assert.equal(free.statusCode,201,free.body);assert.equal(free.json().status,'approved');assert.equal(free.json().hasReceipt,false);
  const cashierView=await cashManagerWithOutflow.inject({method:'GET',url:'/api/economics/cash/today'});assert.equal(cashierView.statusCode,200,cashierView.body);
  assert.equal(cashierView.json().items.length,1);assert.equal(cashierView.json().items[0].registerCode,'bunker');
  assert.ok(cashierView.json().items[0].movements.some(item=>item.id===free.json().id&&Number(item.amountCents)===100));
  for(const key of ['openingCents','expectedCents','countedCents','differenceCents','openingDenominations'])assert.equal(Object.hasOwn(cashierView.json().items[0],key),false,`cashier register view must hide ${key}`);
  const limitResponse=await owner.inject({method:'PUT',url:'/api/economics/cash/settings/outflow-limit',payload:{limitCents:50}});
  assert.equal(limitResponse.statusCode,200,limitResponse.body);
  const pending=await cashManagerWithOutflow.inject({method:'POST',url:'/api/economics/cash/outflows',payload:{movementType:'withdrawal',amountCents:100,reason:'Retirada de cambio'}});
  assert.equal(pending.statusCode,201,pending.body);assert.equal(pending.json().status,'pending_owner_approval');
  const closeBlocked=await trainerB.inject({method:'POST',url:`/api/economics/cash/${sessionBunker}/close`,payload:{countedDenominations:count(4900)}});
  assert.equal(closeBlocked.statusCode,409);assert.equal(closeBlocked.json().error,'cash_outflow_approval_pending');
  const decision=await owner.inject({method:'POST',url:`/api/economics/cash/outflows/${pending.json().id}/decision`,payload:{decision:'approved',reason:'Aprobado por el propietario'}});
  assert.equal(decision.statusCode,200,decision.body);assert.equal(decision.json().status,'approved');
  const ownerDay=await owner.inject({method:'GET',url:'/api/economics/cash/day'});
  assert.equal(ownerDay.statusCode,200,ownerDay.body);
  const bunker=ownerDay.json().registers.find(row=>row.registerCode==='bunker');
  assert.equal(Number(bunker.openingCents),2000,'owner reopening starts a new audited custody count without creating a second daily session');
  assert.equal(Number(bunker.expectedCents),1800,'the reopened custody baseline includes only movements after the owner count');
});

test('legacy open sessions without a register fail closed until owner resolution and do not alter timeclock history',async()=>{
  const legacyOpening=count(1000);
  await sql`ALTER TABLE economic_cash_sessions DISABLE TRIGGER economic_cash_session_register_insert_guard`;
  let legacy;
  try{[legacy]=await sql`INSERT INTO economic_cash_sessions(register_id,local_date,opening_cents,opening_denominations,opened_by) VALUES (NULL,(now() AT TIME ZONE 'Atlantic/Canary')::date,1000,${sql.json(legacyOpening)},'legacy-former-cashier') RETURNING id`;}
  finally{await sql`ALTER TABLE economic_cash_sessions ENABLE TRIGGER economic_cash_session_register_insert_guard`;}
  const [before]=await sql`SELECT count(*)::int AS count FROM staff_timeclock_events`;
  const opening=await trainerA.inject({method:'POST',url:'/api/economics/cash/open',payload:{registerCode:'sala',openingDenominations:count(500)}});
  assert.equal(opening.statusCode,409);assert.equal(opening.json().error,'cash_legacy_session_requires_owner_resolution');
  const resolved=await owner.inject({method:'POST',url:`/api/economics/cash/legacy/${legacy.id}/resolve`,payload:{countedDenominations:count(900),reason:'Cierre histórico de control'}});
  assert.equal(resolved.statusCode,200,resolved.body);assert.equal(resolved.json().status,'closed');assert.equal(resolved.json().differenceCents,-100);
  const [after]=await sql`SELECT count(*)::int AS count FROM staff_timeclock_events`;
  assert.equal(after.count,before.count,'resolving a legacy register must not invent or alter clock events');
  const [auditRow]=await sql`SELECT details FROM economic_audit_events WHERE resource_id=${legacy.id} AND action='cash.legacy_resolved'`;
  assert.equal(auditRow.details.timeclockChanged,false);
});

test('owner resolves forgotten previous-day register custody with audit and notification without changing clock records',async()=>{
  const current=await owner.inject({method:'GET',url:'/api/economics/cash/today'});assert.equal(current.statusCode,200,current.body);
  const open=current.json().items.find(item=>item.registerCode==='bunker'&&item.status==='open');assert.ok(open);
  const closed=await trainerB.inject({method:'POST',url:`/api/economics/cash/${open.id}/close`,payload:{countedDenominations:count(Number(open.expectedCents))}});
  assert.equal(closed.statusCode,200,closed.body);
  const clockOut=await trainerB.inject({method:'POST',url:'/api/timeclock/clock-out',payload:{origin:'web'}});assert.equal(clockOut.statusCode,201,clockOut.body);
  const [register]=await sql`SELECT id FROM economic_cash_registers WHERE code='bunker'`;
  const staleOpening=count(1200);
  const [stale]=await sql`INSERT INTO economic_cash_sessions(register_id,local_date,opening_cents,opening_denominations,opened_by) VALUES (${register.id},(now() AT TIME ZONE 'Atlantic/Canary')::date-1,1200,${sql.json(staleOpening)},'cash-trainer-b') RETURNING id`;
  await sql`INSERT INTO economic_cash_custodies(cash_session_id,professional_id,actor_id) VALUES (${stale.id},${personB.id},'cash-trainer-b')`;
  const [beforeClock]=await sql`SELECT count(*)::int AS count FROM staff_timeclock_events`;
  const resolved=await owner.inject({method:'POST',url:`/api/economics/cash/${stale.id}/owner-resolve`,payload:{countedDenominations:count(1100),reason:'El entrenador olvidó cerrar el registro'}});
  assert.equal(resolved.statusCode,200,resolved.body);assert.equal(resolved.json().status,'late_close');assert.equal(resolved.json().differenceCents,-100);assert.equal(resolved.json().timeclockChanged,false);
  const [afterClock]=await sql`SELECT count(*)::int AS count FROM staff_timeclock_events`;assert.equal(afterClock.count,beforeClock.count);
  const [custody]=await sql`SELECT ended_reason,ended_by FROM economic_cash_custodies WHERE cash_session_id=${stale.id}`;assert.equal(custody.ended_reason,'owner_resolution');assert.equal(custody.ended_by,'cash-owner');
  const [auditRow]=await sql`SELECT details FROM economic_audit_events WHERE resource_id=${stale.id} AND action='cash.forgotten_session_resolved'`;assert.equal(auditRow.details.reason,'El entrenador olvidó cerrar el registro');assert.equal(auditRow.details.timeclockChanged,false);
  const [notice]=await sql`SELECT event_type FROM domain_events_outbox WHERE aggregate_id=${stale.id} AND recipient_staff_actor_id='cash-trainer-b'`;assert.equal(notice.event_type,'staff.cash_legacy_resolved');
});
