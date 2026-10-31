import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { coordinateContractAssignment } from '../src/contract-assignment-coordinator.ts';
import { evaluateBookingEligibility } from '../src/booking-eligibility.ts';
import { ensureCashSessionForActor } from './cash-fixture.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: term payment booking integration requires PostgreSQL.');
const sourceUrl = new URL(process.env.DATABASE_URL);
const databaseName = `f1c2_booking_${randomUUID().replaceAll('-', '')}`;
const adminUrl = new URL(sourceUrl); adminUrl.pathname = '/postgres';
const admin = postgres(adminUrl.toString(), { max: 2, connect_timeout: 5 });
await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
const databaseUrl = new URL(sourceUrl); databaseUrl.pathname = `/${databaseName}`;
const dbUrl = databaseUrl.toString();
const sql = postgres(dbUrl, { max: 20, connect_timeout: 5 });
await migrateDatabase(sql);
await ensureCashSessionForActor(sql,'f1c2-test-admin');
const app = buildServer(dbUrl, { authorizationResolver: async () => ({ actorId:'f1c2-test-admin', role:'admin' }) });
const hash='a'.repeat(64);
const actor={actorId:'f1c2-test-admin',role:'admin'};
let area;

after(async()=>{await app.close();await sql.end();await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);await admin.end();});

async function createClient() {
  const result=await app.inject({method:'POST',url:'/api/clients',headers:{'idempotency-key':randomUUID()},payload:{firstName:'F1C2',lastName:randomUUID()}});
  assert.equal(result.statusCode,201,result.body);return result.json();
}
async function createService() {
  const result=await app.inject({method:'POST',url:'/api/services',payload:{name:`F1C2 ${randomUUID()}`,areaId:area.id,status:'active'}});
  assert.equal(result.statusCode,201,result.body);return result.json();
}
async function createContractPlan(service,{paymentBlock='enforce',unlimited=false,termKind='rolling_months'}={}) {
  const fixed=['pack','one_off'].includes(termKind);
  const result=await app.inject({method:'POST',url:'/api/plans',headers:{'idempotency-key':randomUUID()},payload:{
    name:`F1C2 ${randomUUID()}`,serviceIds:[service.id],kind:fixed?'session_pack':'recurring',...(fixed?{}:{renewalCadence:'monthly'}),basePriceCents:5000,
    termKind,...(termKind==='rolling_months'?{termMonths:3}:{}),paymentBlock:fixed?'off':paymentBlock,
    rights:[{rightType:'service_access',serviceId:service.id},unlimited
      ?{rightType:'sessions_quota',quotaScope:'shared',quantityRule:'unlimited'}
      :fixed?{rightType:'sessions_quota',quotaScope:'shared',quantity:termKind==='one_off'?1:8,quantityRule:'fixed_v1'}
        :{rightType:'sessions_quota',quotaScope:'shared',weeklyFrequency:3,quantityRule:'weekday_ratio_v1'}],
  }});
  assert.equal(result.statusCode,201,result.body);
  assert.equal((await app.inject({method:'POST',url:`/api/plans/${result.json().id}/activate`})).statusCode,200);
  return result.json();
}
const utcDateOffset = (offsetDays, from = new Date()) => {
  const date = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + offsetDays));
  return date.toISOString().slice(0, 10);
};
const addDays = (date, days) => utcDateOffset(days, new Date(`${date}T00:00:00Z`));
const utcMonthDateFrom = (date, monthOffset, day) => {
  const [year, month] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + monthOffset, day)).toISOString().slice(0, 10);
};
const futureSessionStart = (hoursFromNow = 24) => new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
function canaryMidnight(date) {
  const [year, month, day] = date.split('-').map(Number);
  let instant = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
    const observed = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const target = Date.UTC(year, month - 1, day);
    instant += target - observed;
  }
  return new Date(instant);
}

async function assign(client,plan,assigned=utcDateOffset(-8)) {
  return coordinateContractAssignment(sql,{clientId:client.id,planId:plan.id,idempotencyKey:randomUUID(),contractStart:assigned,amountCents:5000},actor,new Date(`${assigned}T12:00:00Z`));
}
async function assignAt(client,plan,assigned,now) {
  return coordinateContractAssignment(sql,{clientId:client.id,planId:plan.id,idempotencyKey:randomUUID(),contractStart:assigned,amountCents:5000},actor,now);
}
async function cloneAssignmentWithCharge(sourceAssignmentId,chargeId) {
  const assignmentId=randomUUID(),idempotencyKey=randomUUID(),requestHash='c'.repeat(64);
  await sql`INSERT INTO client_plan_assignments(id,client_id,plan_id,plan_version,charge_id,starts_on,ends_on,status,idempotency_key,request_hash,created_by,sale_price_cents,snapshot)
    SELECT ${assignmentId},client_id,plan_id,plan_version,${chargeId},starts_on,ends_on,status,${idempotencyKey},${requestHash},created_by,sale_price_cents,snapshot
    FROM client_plan_assignments WHERE id=${sourceAssignmentId}`;
  await sql`INSERT INTO assignment_contract_terms(assignment_id,term_kind,contract_start,contract_end,term_months,payment_rule,payment_block,deadline_computation,assigned_local_date)
    SELECT ${assignmentId},term_kind,contract_start,contract_end,term_months,payment_rule,payment_block,deadline_computation,assigned_local_date
    FROM assignment_contract_terms WHERE assignment_id=${sourceAssignmentId}`;
  await sql`INSERT INTO client_plan_assignment_events(assignment_id,event_type,effective_on,actor_id,actor_role,idempotency_key,request_hash)
    SELECT ${assignmentId},'activated',starts_on,created_by,'admin',${randomUUID()},${requestHash}
    FROM client_plan_assignments WHERE id=${assignmentId}`;
  return assignmentId;
}
async function createSession(service,{capacity=3,startsAt=futureSessionStart()}={}) {
  const result=await app.inject({method:'POST',url:'/api/calendar/sessions',payload:{serviceId:service.id,areaId:service.areaId,startsAt,durationMinutes:60,capacity}});
  assert.equal(result.statusCode,201,result.body);return result.json();
}
async function evaluate(clientId,serviceId,now=new Date(),startsAt=futureSessionStart()) {
  return sql.begin(tx=>evaluateBookingEligibility({tx,clientId,serviceId,startsAt,now}));
}
async function recordPayment(chargeId,amountCents) {
  return app.inject({method:'POST',url:'/api/economics/payments',headers:{'idempotency-key':randomUUID()},payload:{chargeId,splits:[{method:'card',amountCents}]}});
}
async function refund(transactionId,amountCents) {
  return app.inject({method:'POST',url:'/api/economics/refunds',headers:{'idempotency-key':randomUUID()},payload:{transactionId,amountCents,method:'card',note:'Reembolso de prueba F1C2'}});
}

const [standardArea]=await sql`SELECT id FROM areas WHERE normalized_name='la sala'`;
if(!standardArea)throw new Error('Expected standard La Sala area in fresh schema.');area=standardArea;

test('F1-C term payment access uses ledger truth; unpaid/partial overdue is denied and full payment reopens automatically',async()=>{
  const client=await createClient(),service=await createService(),plan=await createContractPlan(service),contractStart=utcDateOffset(-8),assignment=await assign(client,plan,contractStart);
  assert.equal(assignment.dueOn,addDays(contractStart,5));
  const blockEffectiveAt=canaryMidnight(addDays(assignment.dueOn,1));
  assert.equal((await evaluate(client.id,service.id,new Date(blockEffectiveAt.getTime()-1000))).eligible,true,'inclusive due date remains usable');
  assert.equal((await evaluate(client.id,service.id,blockEffectiveAt)).reason,'debt_restriction');
  const session=await createSession(service);
  const denied=await app.inject({method:'POST',url:`/api/calendar/sessions/${session.id}/reservations`,payload:{clientId:client.id,entitlementAssignmentId:assignment.assignmentId}});
  assert.equal(denied.statusCode,409);assert.equal(denied.json().error,'debt_restriction');
  const [noSideEffects]=await sql`SELECT (SELECT count(*)::int FROM calendar_reservations WHERE session_id=${session.id} AND client_id=${client.id}) reservations,
    (SELECT count(*)::int FROM client_entitlement_ledger WHERE assignment_id=${assignment.assignmentId} AND entry_type='consume') consumptions`;
  assert.deepEqual(noSideEffects,{reservations:0,consumptions:0});
  const partial=await recordPayment(assignment.chargeId,2500);assert.equal(partial.statusCode,201,partial.body);
  assert.equal((await evaluate(client.id,service.id)).reason,'debt_restriction');
  const rest=await recordPayment(assignment.chargeId,2500);assert.equal(rest.statusCode,201,rest.body);
  assert.equal((await evaluate(client.id,service.id)).eligible,true,'full net settlement automatically allows access');
  assert.equal((await recordPayment(assignment.chargeId,1)).json().error,'amount_exceeds_balance');
});

test('client plan assignment route coordinates a frozen natural-month contract and replays without duplicating charge or bags',async()=>{
  const client=await createClient(),service=await createService(),plan=await createContractPlan(service,{termKind:'natural_month'});
  const start=utcDateOffset(1);
  const headers={'idempotency-key':randomUUID()};
  const payload={planId:plan.id,startsOn:start,dueOn:start.slice(0,8)+'10',amountCents:5000};
  const first=await app.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers,payload});
  assert.equal(first.statusCode,201,first.body);
  const response=first.json();
  assert.equal(response.dueOn,start.slice(0,8)+'10');
  assert.equal(response.periods.length,1);
  assert.ok(response.periods[0].sessionsGranted>0);
  const replay=await app.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers,payload});
  assert.equal(replay.statusCode,200,replay.body);
  const replayBody=replay.json();
  assert.equal(replayBody.id,response.id);
  assert.equal(replayBody.chargeId,response.chargeId);
  assert.equal(replayBody.replay,true);
  assert.equal(await sql`SELECT count(*)::int AS n FROM client_plan_assignments WHERE idempotency_key=${headers['idempotency-key']}`.then(rows=>rows[0].n),1);
  assert.equal(await sql`SELECT count(*)::int AS n FROM economic_charges WHERE id=${response.chargeId}`.then(rows=>rows[0].n),1);
});

test('contract-period adjustments are audited and can be reversed exactly once without mutating the ledger',async()=>{
  const client=await createClient(),service=await createService(),plan=await createContractPlan(service,{paymentBlock:'off'});
  const assignment=await assign(client,plan);
  const [period]=await sql`SELECT id,right_id AS "rightId",sessions_granted AS granted FROM assignment_entitlement_periods WHERE assignment_id=${assignment.assignmentId} AND entitlement_mode='quota' ORDER BY period_index LIMIT 1`;
  await assert.rejects(sql`INSERT INTO client_entitlement_ledger(client_id,assignment_id,right_key,entitlement_period_id,entry_type,quantity,reason,actor_id,idempotency_key,request_hash)
    VALUES (${client.id},${assignment.assignmentId},${period.rightId},${period.id},'reversal',-1,'Unlinked reversal','f1c2-test',${randomUUID()},${'e'.repeat(64)})`,error=>error.code==='23514'&&error.constraint_name==='client_entitlement_ledger_reversal_type');
  const adjustmentKey=randomUUID();
  const adjusted=await app.inject({method:'POST',url:`/api/clients/${client.id}/plans/${assignment.assignmentId}/adjustments`,headers:{'idempotency-key':adjustmentKey},payload:{rightId:period.rightId,periodId:period.id,quantity:2,reason:'Corrección de prueba'}});
  assert.equal(adjusted.statusCode,201,adjusted.body);
  const adjustmentId=adjusted.json().id;
  const reversal=await app.inject({method:'POST',url:`/api/clients/${client.id}/plans/${assignment.assignmentId}/adjustments/${adjustmentId}/reverse`,headers:{'idempotency-key':randomUUID()},payload:{reason:'Reversión de prueba'}});
  assert.equal(reversal.statusCode,201,reversal.body);
  assert.equal(reversal.json().reversalOfId,adjustmentId);
  assert.equal(await sql`SELECT count(*)::int AS n FROM client_entitlement_ledger WHERE id=${adjustmentId} AND quantity=2 AND reversal_of_id IS NULL`.then(rows=>rows[0].n),1);
  assert.equal(await sql`SELECT count(*)::int AS n FROM client_entitlement_ledger WHERE reversal_of_id=${adjustmentId} AND quantity=-2 AND entitlement_period_id=${period.id}`.then(rows=>rows[0].n),1);
  assert.equal(await sql`SELECT count(*)::int AS n FROM economic_audit_events WHERE action='client_plan.balance_adjusted' AND resource_id=${adjustmentId}`.then(rows=>rows[0].n),1);
  assert.equal(await sql`SELECT count(*)::int AS n FROM economic_audit_events WHERE action='client_plan.entitlement_movement_reversed' AND resource_id=${reversal.json().id}`.then(rows=>rows[0].n),1);
  const duplicate=await app.inject({method:'POST',url:`/api/clients/${client.id}/plans/${assignment.assignmentId}/adjustments/${adjustmentId}/reverse`,headers:{'idempotency-key':randomUUID()},payload:{reason:'Segundo intento'}});
  assert.equal(duplicate.statusCode,409);assert.equal(duplicate.json().error,'movement_already_reversed');
  const reverseOfReverse=await app.inject({method:'POST',url:`/api/clients/${client.id}/plans/${assignment.assignmentId}/adjustments/${reversal.json().id}/reverse`,headers:{'idempotency-key':randomUUID()},payload:{reason:'No se revierte una reversión'}});
  assert.equal(reverseOfReverse.statusCode,404);assert.equal(reverseOfReverse.json().error,'movement_not_reversible');
  assert.equal(await sql`SELECT count(*)::int AS n FROM client_entitlement_ledger WHERE assignment_id=${assignment.assignmentId} AND entry_type='reversal'`.then(rows=>rows[0].n),1);
  const session=await createSession(service);
  const booking=await app.inject({method:'POST',url:`/api/calendar/sessions/${session.id}/reservations`,headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id,entitlementAssignmentId:assignment.assignmentId}});
  assert.equal(booking.statusCode,201,booking.body);
  const [consumption]=await sql`SELECT id,entitlement_period_id AS "periodId" FROM client_entitlement_ledger WHERE assignment_id=${assignment.assignmentId} AND entry_type='consume' ORDER BY occurred_at DESC LIMIT 1`;
  const reverseConsumption=await app.inject({method:'POST',url:`/api/clients/${client.id}/plans/${assignment.assignmentId}/adjustments/${consumption.id}/reverse`,headers:{'idempotency-key':randomUUID()},payload:{reason:'No se revierte una reserva activa'}});
  assert.equal(reverseConsumption.statusCode,404,reverseConsumption.body);
  assert.equal(reverseConsumption.json().error,'movement_not_reversible');
  assert.equal(await sql`SELECT count(*)::int AS n FROM client_entitlement_ledger WHERE reversal_of_id=${consumption.id}`.then(rows=>rows[0].n),0);
});

test('fixed pack contracts accept audited adjustments only against their frozen bag',async()=>{
  const client=await createClient(),service=await createService(),plan=await createContractPlan(service,{termKind:'pack'});
  const assignment=await coordinateContractAssignment(sql,{clientId:client.id,planId:plan.id,idempotencyKey:randomUUID(),contractStart:utcDateOffset(-1),dueOn:utcDateOffset(1),amountCents:5000},actor);
  const [period]=await sql`SELECT id,right_id AS "rightId" FROM assignment_entitlement_periods WHERE assignment_id=${assignment.assignmentId} AND formula_id='fixed_v1'`;
  assert.ok(period);
  const adjusted=await app.inject({method:'POST',url:`/api/clients/${client.id}/plans/${assignment.assignmentId}/adjustments`,headers:{'idempotency-key':randomUUID()},payload:{rightId:period.rightId,periodId:period.id,quantity:1,reason:'Ajuste autorizado del bono'}});
  assert.equal(adjusted.statusCode,201,adjusted.body);
  const [ledger]=await sql`SELECT entry_type AS type,quantity,entitlement_period_id AS period FROM client_entitlement_ledger WHERE id=${adjusted.json().id}`;
  assert.deepEqual(ledger,{type:'adjustment',quantity:1,period:period.id});
});

test('refund re-blocks only the affected assignment, another assignment remains bookable, and existing reservation is preserved',async()=>{
  const client=await createClient(),service=await createService();
  const enforced=await createContractPlan(service),off=await createContractPlan(service,{paymentBlock:'off'});
  const blocked=await assign(client,enforced),independent=await assign(client,off);
  const payment=await recordPayment(blocked.chargeId,5000);assert.equal(payment.statusCode,201,payment.body);
  const session=await createSession(service);
  const first=await app.inject({method:'POST',url:`/api/calendar/sessions/${session.id}/reservations`,payload:{clientId:client.id,entitlementAssignmentId:blocked.assignmentId}});
  assert.equal(first.statusCode,201,first.body);
  const returned=await refund(payment.json().id,2500);assert.equal(returned.statusCode,201,returned.body);
  const evaluation=await evaluate(client.id,service.id);
  assert.equal(evaluation.eligible,true);
  assert.equal(evaluation.availableAlternatives.some(option=>option.assignmentId===independent.assignmentId),true,'payment_block=off independent assignment remains eligible');
  const [before]=await sql`SELECT status FROM calendar_reservations WHERE id=${first.json().id}`;
  assert.equal(before.status,'reserved');
  const secondSession=await createSession(service,{startsAt:futureSessionStart(27)});
  const second=await app.inject({method:'POST',url:`/api/calendar/sessions/${secondSession.id}/reservations`,headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id,entitlementAssignmentId:independent.assignmentId}});
  assert.equal(second.statusCode,201,second.body);
  const [afterExisting]=await sql`SELECT status FROM calendar_reservations WHERE id=${first.json().id}`;
  assert.equal(afterExisting.status,'reserved','overdue payment does not mutate a confirmed reservation');
});

test('overdue term assignment does not block waitlist join, but promotion re-evaluates and keeps the entry waiting',async()=>{
  const client=await createClient(),holder=await createClient(),service=await createService(),plan=await createContractPlan(service);
  const assignment=await assign(client,plan);const holderPlan=await createContractPlan(service,{paymentBlock:'off'});const holderAssignment=await assign(holder,holderPlan);
  const session=await createSession(service,{capacity:1});
  const held=await app.inject({method:'POST',url:`/api/calendar/sessions/${session.id}/reservations`,payload:{clientId:holder.id,entitlementAssignmentId:holderAssignment.assignmentId}});
  assert.equal(held.statusCode,201,held.body);
  const joined=await app.inject({method:'POST',url:`/api/calendar/sessions/${session.id}/waitlist`,payload:{clientId:client.id,entitlementAssignmentId:assignment.assignmentId}});
  assert.equal(joined.statusCode,201,joined.body);
  const [waiting]=await sql`SELECT status FROM calendar_waitlist_entries WHERE id=${joined.json().id}`;assert.equal(waiting.status,'waiting');
  const cancelled=await app.inject({method:'PATCH',url:`/api/calendar/reservations/${held.json().id}/cancel`});assert.equal(cancelled.statusCode,200,cancelled.body);
  const [stillWaiting]=await sql`SELECT status FROM calendar_waitlist_entries WHERE id=${joined.json().id}`;assert.equal(stillWaiting.status,'waiting');
  const [skipped]=await sql`SELECT details->>'reason' AS reason FROM calendar_audit_events WHERE resource_id=${joined.json().id} AND action='waitlist.promotion_skipped' ORDER BY occurred_at DESC LIMIT 1`;
  assert.equal(skipped.reason,'debt_restriction');
});

test('term session bags are selected by session date and never borrow from a future month',async()=>{
  const client=await createClient(),service=await createService(),plan=await createContractPlan(service,{paymentBlock:'off'}),contractStart=utcDateOffset(-8),assignment=await assign(client,plan,contractStart);
  const [right]=await sql`SELECT id FROM plan_rights WHERE plan_id=${plan.id} AND right_type='sessions_quota'`;
  const firstPeriodDate=addDays(contractStart,1),secondPeriodDate=utcMonthDateFrom(contractStart,1,10),thirdPeriodDate=utcMonthDateFrom(contractStart,2,10);
  const evaluationNow=new Date(`${contractStart}T12:00:00Z`);
  const october=await evaluate(client.id,service.id,evaluationNow,`${firstPeriodDate}T12:00:00Z`);
  const november=await evaluate(client.id,service.id,evaluationNow,`${secondPeriodDate}T12:00:00Z`);
  const december=await evaluate(client.id,service.id,evaluationNow,`${thirdPeriodDate}T12:00:00Z`);
  assert.equal(october.eligible,true);assert.equal(november.eligible,true);assert.equal(december.eligible,true);
  const [octPeriod]=await sql`SELECT id FROM assignment_entitlement_periods WHERE assignment_id=${assignment.assignmentId} AND right_id=${right.id} AND period_start=${contractStart}`;
  const [novPeriod]=await sql`SELECT id,sessions_granted AS granted FROM assignment_entitlement_periods WHERE assignment_id=${assignment.assignmentId} AND right_id=${right.id} AND period_start=${utcMonthDateFrom(contractStart,1,1)}`;
  const [decPeriod]=await sql`SELECT id FROM assignment_entitlement_periods WHERE assignment_id=${assignment.assignmentId} AND right_id=${right.id} AND period_start=${utcMonthDateFrom(contractStart,2,1)}`;
  assert.equal(october.selectedEntitlement.entitlementPeriodIdsByRightId[right.id],octPeriod.id);
  assert.equal(november.selectedEntitlement.entitlementPeriodIdsByRightId[right.id],novPeriod.id);
  assert.equal(december.selectedEntitlement.entitlementPeriodIdsByRightId[right.id],decPeriod.id);
  await sql`INSERT INTO client_entitlement_ledger(client_id,assignment_id,right_key,entry_type,quantity,reason,actor_id,idempotency_key,request_hash,entitlement_period_id)
    VALUES (${client.id},${assignment.assignmentId},${right.id}::text,'adjustment',${-Number(novPeriod.granted)},'Test de bolsa agotada','f1c2-test-admin',${randomUUID()},${'b'.repeat(64)},${novPeriod.id})`;
  const exhaustedNovember=await evaluate(client.id,service.id,evaluationNow,`${secondPeriodDate}T12:00:00Z`);
  assert.equal(exhaustedNovember.eligible,false);assert.equal(exhaustedNovember.reason,'entitlement_exhausted');
  assert.equal((await evaluate(client.id,service.id,evaluationNow,`${thirdPeriodDate}T12:00:00Z`)).eligible,true,'December remains independently usable');
});

test('unlimited term assignments require no grant but remain behind enforced payment access',async()=>{
  const client=await createClient(),service=await createService(),plan=await createContractPlan(service,{unlimited:true}),assignment=await assign(client,plan);
  assert.equal((await sql`SELECT count(*)::int AS count FROM client_entitlement_ledger WHERE assignment_id=${assignment.assignmentId} AND entry_type='grant'`)[0].count,0);
  assert.equal((await evaluate(client.id,service.id)).reason,'debt_restriction');
  const paid=await recordPayment(assignment.chargeId,5000);assert.equal(paid.statusCode,201,paid.body);
  const allowed=await evaluate(client.id,service.id);assert.equal(allowed.eligible,true);
  assert.equal(allowed.selectedEntitlement.availableBalance,null);
});

test('reservation evaluation share-lock serializes with payment writer without a global lock',async()=>{
  const client=await createClient(),service=await createService(),plan=await createContractPlan(service),assignment=await assign(client,plan,utcDateOffset(-2));
  let lockedResolve,releaseResolve;
  const locked=new Promise(resolve=>{lockedResolve=resolve;});const release=new Promise(resolve=>{releaseResolve=resolve;});
  const startsAt=futureSessionStart();
  const booking=sql.begin(async tx=>{const outcome=await evaluateBookingEligibility({tx,clientId:client.id,serviceId:service.id,startsAt,now:new Date()});lockedResolve(outcome);await release;return outcome;});
  const outcome=await locked;assert.equal(outcome.eligible,true);
  const pendingPayment=recordPayment(assignment.chargeId,5000);
  let observedLock=false;
  for(let attempt=0;attempt<200;attempt++){
    const waiters=await sql`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'`;
    if(Number(waiters[0]?.count)>0){observedLock=true;break;}
    await new Promise(resolve=>setImmediate(resolve));
  }
  assert.equal(observedLock,true,'payment writer must wait on the charge row held by booking eligibility');
  releaseResolve();await booking;
  assert.equal((await pendingPayment).statusCode,201);
  assert.equal((await evaluate(client.id,service.id)).eligible,true,'next booking observes the committed full payment');
});

test('Member read contracts expose authoritative payment state and per-session waitlist eligibility without queue data',async()=>{
  const memberA=await createClient(),memberB=await createClient(),memberC=await createClient(),memberD=await createClient(),holder=await createClient(),service=await createService();
  const partialPlan=await createContractPlan(service,{paymentBlock:'off'}),partialAssignment=await assign(memberA,partialPlan);
  const partialPayment=await recordPayment(partialAssignment.chargeId,2500);assert.equal(partialPayment.statusCode,201,partialPayment.body);
  const suspendedPlan=await createContractPlan(service),suspendedAssignment=await assign(memberB,suspendedPlan);
  const refundedPlan=await createContractPlan(service,{paymentBlock:'off'}),refundedAssignment=await assign(memberC,refundedPlan);
  const refundedPayment=await recordPayment(refundedAssignment.chargeId,5000);assert.equal(refundedPayment.statusCode,201,refundedPayment.body);
  const refundedTransaction=await refund(refundedPayment.json().id,5000);assert.equal(refundedTransaction.statusCode,201,refundedTransaction.body);
  const refundLedger=await sql`SELECT kind,amount_cents AS "amountCents" FROM economic_transactions WHERE charge_id=${refundedAssignment.chargeId} ORDER BY created_at,id`;
  assert.deepEqual(Array.from(refundLedger,row=>({kind:row.kind,amountCents:row.amountCents})),[{kind:'payment',amountCents:'5000'},{kind:'refund',amountCents:'5000'}]);
  const holderPlan=await createContractPlan(service,{paymentBlock:'off'}),holderAssignment=await assign(holder,holderPlan);
  const makeSession=hours=>createSession(service,{capacity:1,startsAt:futureSessionStart(hours)});
  const bookedSession=await makeSession(24),availableSession=await makeSession(27),fullSession=await makeSession(30),waitlistedSession=await makeSession(33),suspendedSession=await makeSession(36),notAllowedSession=await makeSession(39);
  const reserve=async(client,session,assignment)=>app.inject({method:'POST',url:`/api/calendar/sessions/${session.id}/reservations`,headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id,entitlementAssignmentId:assignment.assignmentId}});
  assert.equal((await reserve(memberA,bookedSession,partialAssignment)).statusCode,201);
  for(const session of [fullSession,waitlistedSession,suspendedSession,notAllowedSession]) assert.equal((await reserve(holder,session,holderAssignment)).statusCode,201);
  const join=async(client,session,assignment)=>app.inject({method:'POST',url:`/api/calendar/sessions/${session.id}/waitlist`,headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id,entitlementAssignmentId:assignment.assignmentId}});
  const waitingA=await join(memberA,waitlistedSession,partialAssignment);assert.equal(waitingA.statusCode,201,waitingA.body);
  const waitingB=await join(memberB,suspendedSession,suspendedAssignment);assert.equal(waitingB.statusCode,201,waitingB.body);
  let activeEligibilityEvaluations=0,maxEligibilityEvaluations=0;
  const appA=buildServer(dbUrl,{clientAuthorizationResolver:async()=>({clientId:memberA.id}),bookingEligibilityResolver:async input=>{
    activeEligibilityEvaluations++;maxEligibilityEvaluations=Math.max(maxEligibilityEvaluations,activeEligibilityEvaluations);
    try { await new Promise(resolve=>setTimeout(resolve,5));return await evaluateBookingEligibility(input); }
    finally { activeEligibilityEvaluations--; }
  }});
  const memberApp=clientId=>buildServer(dbUrl,{clientAuthorizationResolver:async()=>({clientId}),bookingEligibilityResolver:async input=>evaluateBookingEligibility(input)});
  const appB=memberApp(memberB.id),appC=memberApp(memberC.id),appD=memberApp(memberD.id);
  try {
    const membership=await appA.inject({method:'GET',url:'/api/me/membership'});assert.equal(membership.statusCode,200,membership.body);
    const payment=membership.json().assignments.find(item=>item.id===partialAssignment.assignmentId).payment;
    assert.deepEqual({status:payment.status,amountCents:payment.amountCents,paidCents:payment.paidCents,pendingAmountCents:payment.pendingAmountCents,dueOn:payment.dueOn},
      {status:'unpaid',amountCents:5000,paidCents:2500,pendingAmountCents:2500,dueOn:partialAssignment.dueOn});
    assert.equal(payment.timezone,'Atlantic/Canary');assert.equal(payment.payments.length,1);assert.equal(payment.payments[0].amountCents,2500);
    assert.equal('chargeId' in payment,false);assert.equal(JSON.stringify(membership.json()).includes(memberB.id),false);
    const membershipB=await appB.inject({method:'GET',url:'/api/me/membership'});assert.equal(membershipB.statusCode,200,membershipB.body);
    const blockedPayment=membershipB.json().assignments.find(item=>item.id===suspendedAssignment.assignmentId).payment;
    assert.equal(blockedPayment.status,'unpaid');assert.equal(blockedPayment.accessStatus,'blocked_unpaid');
    const blockDate=addDays(suspendedAssignment.dueOn,1);
    const zoneOffset=new Intl.DateTimeFormat('en-GB',{timeZone:'Atlantic/Canary',timeZoneName:'longOffset'}).formatToParts(new Date(`${blockDate}T00:00:00Z`)).find(part=>part.type==='timeZoneName')?.value??'GMT';
    const offset=zoneOffset==='GMT'?'+00:00':zoneOffset.replace(/^GMT/,'');
    assert.equal(blockedPayment.effectiveBlockAt,`${blockDate}T00:00:00${offset}`);
    const from=new Intl.DateTimeFormat('en-CA',{timeZone:'Atlantic/Canary',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),to=addDays(from,7);
    const listA=await appA.inject({method:'GET',url:`/api/me/sessions?from=${from}&to=${to}`});assert.equal(listA.statusCode,200,listA.body);
    assert.equal(maxEligibilityEvaluations,2,'one Member sessions read must leave at least eight connections in the ten-connection API pool');
    const sessionsA=new Map(listA.json().sessions.map(item=>[item.id,item]));
    assert.equal(sessionsA.get(bookedSession.id).availability.status,'booked');
    assert.equal(sessionsA.get(availableSession.id).availability.status,'available');
    assert.equal(sessionsA.get(fullSession.id).availability.status,'full');assert.equal(sessionsA.get(fullSession.id).availability.canJoinWaitlist,true);
    assert.equal(sessionsA.get(waitlistedSession.id).availability.status,'waitlisted');
    assert.equal(sessionsA.get(waitlistedSession.id).availability.canJoinWaitlist,false);
    assert.equal(JSON.stringify(listA.json()).includes(waitingA.json().id),false);
    assert.equal(JSON.stringify(listA.json()).toLowerCase().includes('queueposition'),false);
    const waitlistedDetail=await appA.inject({method:'GET',url:`/api/me/sessions/${waitlistedSession.id}`});assert.equal(waitlistedDetail.statusCode,200,waitlistedDetail.body);
    assert.deepEqual(waitlistedDetail.json().session.availability,sessionsA.get(waitlistedSession.id).availability);
    assert.equal('eligibilityReason' in waitlistedDetail.json().session,false);
    assert.equal(JSON.stringify(waitlistedDetail.json()).includes(waitingA.json().id),false);
    assert.equal('myWaitlistId' in waitlistedDetail.json().session,false);
    const listB=await appB.inject({method:'GET',url:`/api/me/sessions?from=${from}&to=${to}`});
    assert.equal(listB.json().sessions.find(item=>item.id===suspendedSession.id).availability.status,'waitlist_suspended');
    assert.equal(listB.json().sessions.find(item=>item.id===suspendedSession.id).availability.reason,null);
    const suspendedDetail=await appB.inject({method:'GET',url:`/api/me/sessions/${suspendedSession.id}`});assert.equal(suspendedDetail.statusCode,200,suspendedDetail.body);
    assert.deepEqual(suspendedDetail.json().session.availability,listB.json().sessions.find(item=>item.id===suspendedSession.id).availability);
    const membershipC=await appC.inject({method:'GET',url:'/api/me/membership'});assert.equal(membershipC.statusCode,200,membershipC.body);
    const refunded=membershipC.json().assignments.find(item=>item.id===refundedAssignment.assignmentId).payment;
    assert.equal(refunded.status,'refunded');assert.equal(refunded.paidCents,0);assert.equal(refunded.pendingAmountCents,0);
    const listD=await appD.inject({method:'GET',url:`/api/me/sessions?from=${from}&to=${to}`});
    const denied=listD.json().sessions.find(item=>item.id===availableSession.id).availability;
    assert.deepEqual(denied,{status:'not_allowed_by_plan',reason:'service_not_allowed',canJoinWaitlist:false});
    const deniedDetail=await appD.inject({method:'GET',url:`/api/me/sessions/${availableSession.id}`});assert.equal(deniedDetail.statusCode,200,deniedDetail.body);
    assert.deepEqual(deniedDetail.json().session.availability,denied);
    const detailJson=JSON.stringify(deniedDetail.json());
    for(const internalReason of ['eligibilityReason','debt_restriction','session_full','entitlement_required']) assert.equal(detailJson.includes(internalReason),false);
  } finally { await Promise.all([appA.close(),appB.close(),appC.close(),appD.close()]); }
});

test('Member membership read reports Canary payment boundary and all contract payment states from a deterministic clock',async()=>{
  const service=await createService(),plan=await createContractPlan(service,{termKind:'natural_month'});
  const pendingClient=await createClient(),paidClient=await createClient(),partialClient=await createClient(),voidClient=await createClient(),exemptClient=await createClient(),mismatchClient=await createClient(),winterClient=await createClient();
  const julyNow=new Date('2026-07-01T12:00:00Z');
  const julyAssignment=client=>assignAt(client,plan,'2026-07-01',julyNow);
  const pending=await julyAssignment(pendingClient),paid=await julyAssignment(paidClient),partial=await julyAssignment(partialClient),voided=await julyAssignment(voidClient),exemptSource=await julyAssignment(exemptClient),mismatchSource=await julyAssignment(mismatchClient);
  const winter=await assignAt(winterClient,plan,'2026-11-01',new Date('2026-11-01T12:00:00Z'));
  assert.equal(pending.dueOn,'2026-07-10');assert.equal(winter.dueOn,'2026-11-10');

  assert.equal((await recordPayment(paid.chargeId,5000)).statusCode,201);
  assert.equal((await recordPayment(partial.chargeId,2000)).statusCode,201);
  assert.equal((await app.inject({method:'POST',url:`/api/economics/charges/${voided.chargeId}/void`,payload:{reason:'Anulación sintética para prueba'}})).statusCode,200);
  const exemptChargeResponse=await app.inject({method:'POST',url:'/api/economics/charges',headers:{'idempotency-key':randomUUID()},payload:{clientId:exemptClient.id,planId:plan.id,concept:'Contrato exento de prueba',amountCents:5000,dueOn:exemptSource.dueOn,exemptReason:'Exención sintética para prueba'}});
  assert.equal(exemptChargeResponse.statusCode,201,exemptChargeResponse.body);
  const exemptAssignmentId=await cloneAssignmentWithCharge(exemptSource.assignmentId,exemptChargeResponse.json().id);
  const secondPlan=await createContractPlan(service,{termKind:'natural_month'}),otherChargeAssignment=await assignAt(mismatchClient,secondPlan,'2026-07-01',julyNow);
  const mismatchedAssignmentId=await cloneAssignmentWithCharge(mismatchSource.assignmentId,otherChargeAssignment.chargeId);

  let now=new Date('2026-07-10T22:59:59Z'); // 23:59:59 Atlantic/Canary during summer time.
  const memberApp=clientId=>buildServer(dbUrl,{clientAuthorizationResolver:async()=>({clientId}),memberNowProvider:()=>now,bookingEligibilityResolver:async input=>evaluateBookingEligibility(input)});
  const apps=new Map([pendingClient,paidClient,partialClient,voidClient,exemptClient,mismatchClient,winterClient].map(client=>[client.id,memberApp(client.id)]));
  const paymentFor=async(client,assignmentId)=>{
    const response=await apps.get(client.id).inject({method:'GET',url:'/api/me/membership'});assert.equal(response.statusCode,200,response.body);
    return response.json().assignments.find(item=>item.id===assignmentId)?.payment;
  };
  try {
    const beforeBoundary=await paymentFor(pendingClient,pending.assignmentId);
    assert.equal(beforeBoundary.status,'pending');assert.equal(beforeBoundary.accessStatus,'provisional');
    assert.equal(beforeBoundary.dueOn,'2026-07-10');assert.equal(beforeBoundary.effectiveBlockAt,'2026-07-11T00:00:00+01:00');
    const partialBeforeBoundary=await paymentFor(partialClient,partial.assignmentId);
    assert.equal(partialBeforeBoundary.status,'partially_paid');assert.equal(partialBeforeBoundary.pendingAmountCents,3000);
    now=new Date('2026-07-10T23:00:00Z'); // 00:00 Atlantic/Canary on day 11.
    const atSummerBoundary=await paymentFor(pendingClient,pending.assignmentId);
    assert.equal(atSummerBoundary.status,'unpaid');assert.equal(atSummerBoundary.accessStatus,'blocked_unpaid');
    const paidState=await paymentFor(paidClient,paid.assignmentId);assert.equal(paidState.status,'paid');assert.equal(paidState.accessStatus,'active');
    const partialOverdue=await paymentFor(partialClient,partial.assignmentId);
    assert.equal(partialOverdue.status,'unpaid');assert.equal(partialOverdue.paidCents,2000);assert.equal(partialOverdue.pendingAmountCents,3000);
    const voidState=await paymentFor(voidClient,voided.assignmentId);assert.equal(voidState.status,'void');assert.equal(voidState.accessStatus,'unavailable');
    const exemptState=await paymentFor(exemptClient,exemptAssignmentId);assert.equal(exemptState.status,'exempt');assert.equal(exemptState.accessStatus,'active');
    const mismatchState=await paymentFor(mismatchClient,mismatchedAssignmentId);assert.equal(mismatchState,null,'an assignment with a charge from another plan has no coherent payment object');
    const winterState=await paymentFor(winterClient,winter.assignmentId);assert.equal(winterState.effectiveBlockAt,'2026-11-11T00:00:00+00:00');
    now=new Date('2026-11-11T00:00:00Z');
    const atWinterBoundary=await paymentFor(winterClient,winter.assignmentId);assert.equal(atWinterBoundary.status,'unpaid');assert.equal(atWinterBoundary.accessStatus,'blocked_unpaid');
  } finally { await Promise.all([...apps.values()].map(instance=>instance.close())); }
});
