import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { coordinateContractAssignment } from '../src/contract-assignment-coordinator.ts';
import { evaluateBookingEligibility } from '../src/booking-eligibility.ts';

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
async function createContractPlan(service,{paymentBlock='enforce',unlimited=false}={}) {
  const result=await app.inject({method:'POST',url:'/api/plans',headers:{'idempotency-key':randomUUID()},payload:{
    name:`F1C2 ${randomUUID()}`,serviceIds:[service.id],kind:'recurring',renewalCadence:'monthly',basePriceCents:5000,
    termKind:'rolling_months',termMonths:3,paymentBlock,
    rights:[{rightType:'service_access',serviceId:service.id},unlimited
      ?{rightType:'sessions_quota',quotaScope:'shared',quantityRule:'unlimited'}
      :{rightType:'sessions_quota',quotaScope:'shared',weeklyFrequency:3,quantityRule:'weekday_ratio_v1'}],
  }});
  assert.equal(result.statusCode,201,result.body);
  assert.equal((await app.inject({method:'POST',url:`/api/plans/${result.json().id}/activate`})).statusCode,200);
  return result.json();
}
async function assign(client,plan,assigned='2026-10-15') {
  return coordinateContractAssignment(sql,{clientId:client.id,planId:plan.id,idempotencyKey:randomUUID(),contractStart:assigned,amountCents:5000},actor,new Date(`${assigned}T12:00:00Z`));
}
async function createSession(service,{capacity=3,startsAt='2026-10-23T12:00:00.000Z'}={}) {
  const result=await app.inject({method:'POST',url:'/api/calendar/sessions',payload:{serviceId:service.id,areaId:service.areaId,startsAt,durationMinutes:60,capacity}});
  assert.equal(result.statusCode,201,result.body);return result.json();
}
async function evaluate(clientId,serviceId,now=new Date('2026-10-22T12:00:00Z'),startsAt='2026-10-23T12:00:00.000Z') {
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
  const client=await createClient(),service=await createService(),plan=await createContractPlan(service),assignment=await assign(client,plan);
  assert.equal(assignment.dueOn,'2026-10-20');
  assert.equal((await evaluate(client.id,service.id,new Date('2026-10-20T22:59:59Z'))).eligible,true,'inclusive due date remains usable');
  assert.equal((await evaluate(client.id,service.id,new Date('2026-10-20T23:00:00Z'))).reason,'debt_restriction');
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
  const secondSession=await createSession(service,{startsAt:'2026-10-23T15:00:00.000Z'});
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
  const client=await createClient(),service=await createService(),plan=await createContractPlan(service,{paymentBlock:'off'}),assignment=await assign(client,plan);
  const [right]=await sql`SELECT id FROM plan_rights WHERE plan_id=${plan.id} AND right_type='sessions_quota'`;
  const october=await evaluate(client.id,service.id,new Date('2026-10-22T12:00:00Z'),'2026-10-23T12:00:00Z');
  const november=await evaluate(client.id,service.id,new Date('2026-10-22T12:00:00Z'),'2026-11-10T12:00:00Z');
  const december=await evaluate(client.id,service.id,new Date('2026-10-22T12:00:00Z'),'2026-12-10T12:00:00Z');
  assert.equal(october.eligible,true);assert.equal(november.eligible,true);assert.equal(december.eligible,true);
  const [octPeriod]=await sql`SELECT id FROM assignment_entitlement_periods WHERE assignment_id=${assignment.assignmentId} AND right_id=${right.id} AND period_start='2026-10-15'`;
  const [novPeriod]=await sql`SELECT id,sessions_granted AS granted FROM assignment_entitlement_periods WHERE assignment_id=${assignment.assignmentId} AND right_id=${right.id} AND period_start='2026-11-01'`;
  const [decPeriod]=await sql`SELECT id FROM assignment_entitlement_periods WHERE assignment_id=${assignment.assignmentId} AND right_id=${right.id} AND period_start='2026-12-01'`;
  assert.equal(october.selectedEntitlement.entitlementPeriodIdsByRightId[right.id],octPeriod.id);
  assert.equal(november.selectedEntitlement.entitlementPeriodIdsByRightId[right.id],novPeriod.id);
  assert.equal(december.selectedEntitlement.entitlementPeriodIdsByRightId[right.id],decPeriod.id);
  await sql`INSERT INTO client_entitlement_ledger(client_id,assignment_id,right_key,entry_type,quantity,reason,actor_id,idempotency_key,request_hash,entitlement_period_id)
    VALUES (${client.id},${assignment.assignmentId},${right.id}::text,'adjustment',${-Number(novPeriod.granted)},'Test de bolsa agotada','f1c2-test-admin',${randomUUID()},${'b'.repeat(64)},${novPeriod.id})`;
  const exhaustedNovember=await evaluate(client.id,service.id,new Date('2026-10-22T12:00:00Z'),'2026-11-10T12:00:00Z');
  assert.equal(exhaustedNovember.eligible,false);assert.equal(exhaustedNovember.reason,'entitlement_exhausted');
  assert.equal((await evaluate(client.id,service.id,new Date('2026-10-22T12:00:00Z'),'2026-12-10T12:00:00Z')).eligible,true,'December remains independently usable');
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
  const client=await createClient(),service=await createService(),plan=await createContractPlan(service),assignment=await assign(client,plan);
  let lockedResolve,releaseResolve;
  const locked=new Promise(resolve=>{lockedResolve=resolve;});const release=new Promise(resolve=>{releaseResolve=resolve;});
  const booking=sql.begin(async tx=>{const outcome=await evaluateBookingEligibility({tx,clientId:client.id,serviceId:service.id,startsAt:'2026-10-23T12:00:00Z',now:new Date('2026-10-20T20:00:00Z')});lockedResolve(outcome);await release;return outcome;});
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
