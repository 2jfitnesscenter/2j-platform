import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { buildServer, mapDatabaseError, planInput, serviceInput } from '../src/server.ts';
import { createClientInput } from '../src/clients.ts';
import { migrateDatabase } from '../src/migrate.ts';
import * as schema from '../src/schema.ts';
import { getEffectiveEntitlements } from '../src/entitlements.ts';
import { getTableConfig } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { buildTrainingServiceAuthHeaders, canonicalizeTrainingServiceRequest, createRemoteTrainingLinkVerifier, createRemoteTrainingReceiptReconciler, createTrainingAdapter, platformSubjectSchema, linkProposalSchema, accessGrantSchema, trainingSummarySchema } from '../src/training-integration.ts';
import { createTrainingLinkTransactions, TRAINING_LINK_TTL_MS } from '../src/training-link-protocol.ts';
import { createTrainingCanonicalLinkLifecycle } from '../src/training-link-lifecycle.ts';
import { activateSettledEntitlementPeriods, materializeRecurringEntitlementPeriods } from '../src/assignment-periods.ts';
import { signedRequestSignature } from '../src/internal-service-auth.ts';
import { canaryBusinessDate, proratedSessionsForPayment } from '@2j/domain';
import { ensureCashSessionForActor } from './cash-fixture.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: PostgreSQL integration tests cannot be skipped.');

const sql = postgres(process.env.DATABASE_URL, { max: 10, connect_timeout: 5 });
await migrateDatabase(sql);
const app = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'qa-admin', role: 'admin' }) });
const anonymousApp = buildServer(process.env.DATABASE_URL);
const clientsAdminApp = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'qa-admin', role: 'admin' }) });
const clientsTrainerApp = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'qa-trainer', role: 'trainer' }) });
const clientsReceptionApp = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'qa-reception', role: 'reception-management' }) });
const clientsAccountantApp = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'qa-accountant', role: 'accountant' }) });
const ownerPanelApp = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'qa-owner', role: 'admin', explicitPermissions: ['owner.panel.read'] }) });
const configuredOwnerPanelApp = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'qa-configured-owner', role: 'admin' }), ownerActorId: 'qa-configured-owner' });
const nonOwnerPanelApp = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'qa-not-owner', role: 'admin' }), ownerActorId: 'qa-configured-owner' });
const trainingLinkingAdminApp = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'qa-admin', role: 'admin' }), trainingLinkingEnabled: true });
const trainingLinkingTrainerApp = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'qa-trainer', role: 'trainer' }), trainingLinkingEnabled: true });
const trainingLinkingReceptionApp = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'qa-reception', role: 'reception-management' }), trainingLinkingEnabled: true });
const trainingLinkingAccountantApp = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'qa-accountant', role: 'accountant' }), trainingLinkingEnabled: true });
let resolvedTrainingAuth = null;
const trainingVerifiedLinkingApp = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'qa-admin', role: 'admin' }), trainingVerifiedLinkingEnabled: true, resolvePersonAuth: async () => resolvedTrainingAuth });
const trainingServiceCallsOnlyApp = buildServer(process.env.DATABASE_URL, { trainingServiceCallsEnabled: true, resolvePersonAuth: async () => resolvedTrainingAuth });
const capabilityKeyId = 'qa-home-v1';
const capabilitySecret = Buffer.alloc(32, 37).toString('base64url');
const trainingCapabilitiesApp = buildServer(process.env.DATABASE_URL, { trainingCapabilitiesKeys: { [capabilityKeyId]: { caller:'home', secret:capabilitySecret } } });
const [defaultArea] = await sql`SELECT id,name FROM areas WHERE normalized_name='la sala'`;
const cashDenominationKeys=['coin_0_01','coin_0_02','coin_0_05','coin_0_10','coin_0_20','coin_0_50','coin_1','coin_2','bill_5','bill_10','bill_20','bill_50','bill_100','bill_200','bill_500'];
function cashCount(cents){return Object.fromEntries(cashDenominationKeys.map((key,index)=>[key,index===0?cents:0]));}
async function expectedCashCents(database,sessionId){const [row]=await database`SELECT COALESCE(reopen.details->>'openingCents',s.opening_cents::text)::bigint
  +COALESCE((SELECT sum(CASE WHEN t.kind='payment' THEN p.amount_cents ELSE -p.amount_cents END) FROM economic_transactions t JOIN economic_payment_splits p ON p.transaction_id=t.id WHERE t.cash_session_id=s.id AND p.method='cash' AND (reopen.occurred_at IS NULL OR t.created_at>=reopen.occurred_at)),0)
  +COALESCE((SELECT sum(x.total_cents) FROM store_sales x WHERE x.cash_session_id=s.id AND x.payment_state='paid' AND x.payment_method='cash' AND (reopen.occurred_at IS NULL OR x.created_at>=reopen.occurred_at)),0)
  -COALESCE((SELECT sum(m.amount_cents) FROM store_sale_cash_movements m WHERE m.cash_session_id=s.id AND m.payment_method='cash' AND (reopen.occurred_at IS NULL OR m.occurred_at>=reopen.occurred_at)),0)
  +COALESCE((SELECT sum(a.amount_cents) FROM economic_cash_adjustments a WHERE a.cash_session_id=s.id AND (reopen.occurred_at IS NULL OR a.created_at>=reopen.occurred_at)),0)
  -COALESCE((SELECT sum(o.amount_cents) FROM economic_cash_outflows o WHERE o.cash_session_id=s.id AND o.status='approved' AND (reopen.occurred_at IS NULL OR o.created_at>=reopen.occurred_at)),0) AS total
  FROM economic_cash_sessions s LEFT JOIN LATERAL(SELECT occurred_at,details FROM economic_audit_events WHERE resource_type='cash_session' AND resource_id=s.id AND action='cash.reopened' ORDER BY occurred_at DESC,id DESC LIMIT 1) reopen ON true WHERE s.id=${sessionId}`;return Number(row.total);}
beforeEach(async () => { await ensureCashSessionForActor(sql,'qa-admin'); });
after(async () => { await Promise.all([app.close(), anonymousApp.close(), clientsAdminApp.close(), clientsTrainerApp.close(), clientsReceptionApp.close(), clientsAccountantApp.close(), ownerPanelApp.close(), configuredOwnerPanelApp.close(), nonOwnerPanelApp.close(), trainingLinkingAdminApp.close(), trainingLinkingTrainerApp.close(), trainingLinkingReceptionApp.close(), trainingLinkingAccountantApp.close(), trainingVerifiedLinkingApp.close(), trainingServiceCallsOnlyApp.close(), trainingCapabilitiesApp.close()]); await sql.end(); });

function capabilityHeaders(personId, requestId = randomUUID(), overrides = {}) {
  const timestamp = overrides.timestamp ?? new Date().toISOString();
  const keyId = overrides.keyId ?? capabilityKeyId;
  return {
    'x-2j-key-id': keyId,
    'x-2j-timestamp': timestamp,
    'x-2j-request-id': requestId,
    'x-2j-signature': overrides.signature ?? signedRequestSignature(capabilitySecret, { keyId, timestamp, requestId, method:'GET', path:`/api/internal/platform/v2/persons/${personId}/training-capabilities` }),
  };
}

test('versioned Training access rights require effective payment without a tracked quota and the internal endpoint consumes service requests', async () => {
  const service = await createService(`Training access ${randomUUID()}`);
  const createSubject = async (level, additionalRights = []) => {
    const plan = await createPlan([service.id], { basePriceCents:4500, rights:[
      {rightType:'service_access',serviceId:service.id},
      {rightType:'training_access',trainingAccessLevel:level},
      ...additionalRights,
    ] });
    assert.equal(plan.response.statusCode,201,plan.response.body);
    assert.equal(plan.response.json().rights.find(item=>item.rightType==='training_access').trainingAccessLevel,level);
    assert.equal((await app.inject({method:'POST',url:`/api/plans/${plan.response.json().id}/activate`})).statusCode,200);
    const client = (await createClientRequest(clientsAdminApp,{firstName:'Capability',lastName:`${level} ${randomUUID()}`})).json();
    const sale = await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':randomUUID()},payload:{planId:plan.response.json().id,startsOn:'2026-10-01',endsOn:'2026-10-31',dueOn:'2026-10-01',amountCents:4500}});
    assert.equal(sale.statusCode,201,sale.body);
    const person = await clientsAdminApp.inject({method:'POST',url:'/api/platform/v1/persons',payload:{clientId:client.id}});
    assert.equal(person.statusCode,201,person.body);
    const personId=person.json().personId;
    await sql`INSERT INTO training_account_links(request_id,person_id,training_user_id,method,created_by,updated_by) VALUES (${randomUUID()},${personId},${`training-${level}-${randomUUID()}`},'explicit_admin','capability-test','capability-test')`;
    return {personId,planId:plan.response.json().id,chargeId:sale.json().chargeId};
  };
  assert.equal(planInput.safeParse(planPayload([service.id],{rights:[{rightType:'service_access',serviceId:service.id},{rightType:'training_access',trainingAccessLevel:'full'}]})).success,true);
  assert.equal(planInput.safeParse(planPayload([service.id],{rights:[{rightType:'service_access',serviceId:service.id},{rightType:'training_access'}]})).success,false);
  const {personId,planId,chargeId}=await createSubject('full');
  const [storedRight]=await sql`SELECT id FROM plan_rights WHERE plan_id=${planId} AND right_type='training_access'`;
  await assert.rejects(sql`UPDATE plan_rights SET training_access_level='autonomous' WHERE id=${storedRight.id}`,{code:'55000'},'activated historical plan-version access remains immutable');
  const path=`/api/internal/platform/v2/persons/${personId}/training-capabilities`;
  const unpaidFull=await trainingCapabilitiesApp.inject({method:'GET',url:path,headers:capabilityHeaders(personId)});
  assert.equal(unpaidFull.statusCode,200,unpaidFull.body);
  assert.equal(unpaidFull.json().capabilityLevel,'baseline','an unpaid commercial assignment cannot grant elevation but does not erase free baseline');
  assert.equal(unpaidFull.json().accessState,'baseline');
  assert.equal(unpaidFull.json().capabilities.aiCoach,false);
  assert.equal((await anonymousApp.inject({method:'GET',url:path})).statusCode,503,'no service keys means the internal endpoint stays disabled');
  assert.equal((await trainingCapabilitiesApp.inject({method:'GET',url:path})).statusCode,401,'Member/session auth is not accepted in place of service auth');
  const invalidId=randomUUID();
  assert.equal((await trainingCapabilitiesApp.inject({method:'GET',url:path,headers:capabilityHeaders(personId,invalidId,{signature:'A'.repeat(43)})})).statusCode,401);
  const expiredId=randomUUID();
  const expiredHeaders=capabilityHeaders(personId,expiredId,{timestamp:new Date(Date.now()-31_000).toISOString()});
  assert.equal((await trainingCapabilitiesApp.inject({method:'GET',url:path,headers:expiredHeaders})).statusCode,401);
  assert.equal((await trainingCapabilitiesApp.inject({method:'GET',url:path,headers:capabilityHeaders(personId,randomUUID(),{keyId:'unknown-key'})})).statusCode,401);
  const validId=randomUUID(), validHeaders=capabilityHeaders(personId,validId);
  assert.equal((await trainingCapabilitiesApp.inject({method:'GET',url:`${path}?extra=1`,headers:capabilityHeaders(personId)})).statusCode,401,'the signed path must match exactly and cannot carry a query');
  const fullPayment=await clientsAdminApp.inject({method:'POST',url:'/api/economics/payments',headers:{'idempotency-key':randomUUID()},payload:{chargeId,splits:[{method:'card',amountCents:4500}]}});
  assert.equal(fullPayment.statusCode,201,fullPayment.body);
  const valid=await trainingCapabilitiesApp.inject({method:'GET',url:path,headers:validHeaders});
  assert.equal(valid.statusCode,200,valid.body);
  assert.equal(valid.headers['cache-control'],'no-store');
  assert.equal(valid.json().capabilityLevel,'full');
  assert.deepEqual(valid.json().capabilities,{autonomousTraining:true,routineCreation:true,personalRoutineCreation:true,personalRoutineManagement:true,workoutRecording:true,workoutHistory:true,guidedTraining:true,premiumPrograms:true,aiCoach:true,professionalFollowUp:true});
  assert.equal((await trainingCapabilitiesApp.inject({method:'GET',url:path,headers:validHeaders})).statusCode,401,'a valid request ID is accepted only once');
  const raceId=randomUUID(),raceHeaders=capabilityHeaders(personId,raceId);
  const race=await Promise.all([trainingCapabilitiesApp.inject({method:'GET',url:path,headers:raceHeaders}),trainingCapabilitiesApp.inject({method:'GET',url:path,headers:raceHeaders})]);
  assert.deepEqual(race.map(item=>item.statusCode).sort(),[200,401],'concurrent replay attempts have exactly one winner');
  const {personId:autonomousId,chargeId:autonomousChargeId}=await createSubject('autonomous');
  const autonomousPath=`/api/internal/platform/v2/persons/${autonomousId}/training-capabilities`;
  const unpaidAutonomous=await trainingCapabilitiesApp.inject({method:'GET',url:autonomousPath,headers:capabilityHeaders(autonomousId)});
  assert.equal(unpaidAutonomous.statusCode,200,unpaidAutonomous.body);
  assert.equal(unpaidAutonomous.json().capabilityLevel,'baseline','an unpaid commercial assignment cannot grant commercial extras');
  assert.equal(unpaidAutonomous.json().accessState,'baseline');
  assert.equal(unpaidAutonomous.json().capabilities.guidedTraining,false);
  const autonomousPayment=await clientsAdminApp.inject({method:'POST',url:'/api/economics/payments',headers:{'idempotency-key':randomUUID()},payload:{chargeId:autonomousChargeId,splits:[{method:'card',amountCents:4500}]}});
  assert.equal(autonomousPayment.statusCode,201,autonomousPayment.body);
  const autonomous=await trainingCapabilitiesApp.inject({method:'GET',url:autonomousPath,headers:capabilityHeaders(autonomousId)});
  assert.equal(autonomous.statusCode,200,autonomous.body);
  assert.equal(autonomous.json().capabilityLevel,'autonomous');
  assert.equal(autonomous.json().capabilities.aiCoach,false);
  assert.equal(autonomous.json().capabilities.professionalFollowUp,false);

  const {personId:periodQuotaId,chargeId:periodQuotaChargeId}=await createSubject('full',[{rightType:'period_quota',quotaScope:'shared',quantity:8,period:'month',periodMode:'calendar',timezone:'Atlantic/Canary'}]);
  const periodQuotaPath=`/api/internal/platform/v2/persons/${periodQuotaId}/training-capabilities`;
  const unpaidPeriodQuota=await trainingCapabilitiesApp.inject({method:'GET',url:periodQuotaPath,headers:capabilityHeaders(periodQuotaId)});
  assert.equal(unpaidPeriodQuota.statusCode,200,unpaidPeriodQuota.body);
  assert.equal(unpaidPeriodQuota.json().capabilityLevel,'baseline','period_quota without payment cannot grant commercial elevation');
  const periodQuotaPayment=await clientsAdminApp.inject({method:'POST',url:'/api/economics/payments',headers:{'idempotency-key':randomUUID()},payload:{chargeId:periodQuotaChargeId,splits:[{method:'card',amountCents:4500}]}});
  assert.equal(periodQuotaPayment.statusCode,201,periodQuotaPayment.body);
  const paidPeriodQuota=await trainingCapabilitiesApp.inject({method:'GET',url:periodQuotaPath,headers:capabilityHeaders(periodQuotaId)});
  assert.equal(paidPeriodQuota.statusCode,200,paidPeriodQuota.body);
  assert.equal(paidPeriodQuota.json().capabilityLevel,'full','settled period_quota assignment with explicit full right is operational');
});

function createClientRequest(server, payload, key = randomUUID()) {
  return server.inject({ method: 'POST', url: '/api/clients', headers: { 'idempotency-key': key }, payload });
}

async function createService(name = `Servicio ${randomUUID()}`, status = 'active') {
  const response = await app.inject({ method: 'POST', url: '/api/services', payload: { name, areaId: defaultArea.id, status } });
  assert.equal(response.statusCode, 201, response.body);
  return response.json();
}

function planPayload(serviceIds, overrides = {}) {
  return {
    name: `Plan ${randomUUID()}`, serviceIds, kind: 'recurring', renewalCadence: 'monthly',
    rights: [{ rightType: 'service_access', serviceId: serviceIds[0] }], ...overrides,
  };
}

async function createPlan(serviceIds, overrides = {}, idempotencyKey = randomUUID()) {
  const body = planPayload(serviceIds, overrides);
  const response = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': idempotencyKey }, payload: body });
  return { body, response };
}

test('linked person without a client facet receives only free baseline; invitation proof remains outside this API', async () => {
  const personId=randomUUID(),trainingUserId=`external-${randomUUID()}`;
  await sql`INSERT INTO platform_persons(id,created_by) VALUES (${personId},'capability-test')`;
  await sql`INSERT INTO training_account_links(request_id,person_id,training_user_id,method,created_by,updated_by) VALUES (${randomUUID()},${personId},${trainingUserId},'explicit_admin','capability-test','capability-test')`;
  const response=await trainingCapabilitiesApp.inject({method:'GET',url:`/api/internal/platform/v2/persons/${personId}/training-capabilities`,headers:capabilityHeaders(personId)});
  assert.equal(response.statusCode,200,response.body);
  assert.equal(response.json().capabilityLevel,'baseline');
  assert.deepEqual(response.json().capabilities,{autonomousTraining:true,routineCreation:false,personalRoutineCreation:true,personalRoutineManagement:true,workoutRecording:true,workoutHistory:true,guidedTraining:false,premiumPrograms:false,aiCoach:false,professionalFollowUp:false});
});

test('Training suspension is audited, idempotent, independent from commercial rights, and reversible', async () => {
  const client=(await createClientRequest(clientsAdminApp,{firstName:'Suspension',lastName:`Fixture ${randomUUID()}`})).json();
  const person=(await clientsAdminApp.inject({method:'POST',url:'/api/platform/v1/persons',payload:{clientId:client.id}})).json();
  const personId=person.personId,trainingUserId=`suspension-${randomUUID()}`;
  await sql`INSERT INTO training_account_links(request_id,person_id,training_user_id,method,created_by,updated_by) VALUES (${randomUUID()},${personId},${trainingUserId},'explicit_admin','capability-test','capability-test')`;
  const path=`/api/platform/v1/persons/${personId}/training-suspension`;
  const denied=await clientsTrainerApp.inject({method:'POST',url:`${path}/suspend`,headers:{'idempotency-key':randomUUID()},payload:{reason:'Incumplimiento de normas'}});
  assert.equal(denied.statusCode,403);
  const suspendKey=randomUUID(),body={reason:'Incumplimiento de normas internas'};
  const suspended=await clientsAdminApp.inject({method:'POST',url:`${path}/suspend`,headers:{'idempotency-key':suspendKey},payload:body});
  assert.equal(suspended.statusCode,201,suspended.body); assert.equal(suspended.json().status,'suspended');
  const replay=await clientsAdminApp.inject({method:'POST',url:`${path}/suspend`,headers:{'idempotency-key':suspendKey},payload:body});
  assert.equal(replay.statusCode,200); assert.equal(replay.json().replayed,true);
  const state=await clientsAdminApp.inject({method:'GET',url:path}); assert.equal(state.json().status,'suspended');
  const caps=await trainingCapabilitiesApp.inject({method:'GET',url:`/api/internal/platform/v2/persons/${personId}/training-capabilities`,headers:capabilityHeaders(personId)});
  assert.equal(caps.json().capabilityLevel,'blocked'); assert.equal(caps.json().reasonCode,'ADMIN_SUSPENDED');
  assert.equal(caps.json().trainingSubject.trainingUserId,trainingUserId);
  const lift=await clientsAdminApp.inject({method:'POST',url:`${path}/lift`,headers:{'idempotency-key':randomUUID()},payload:{reason:'Revisión completada y acceso restituido'}});
  assert.equal(lift.statusCode,201,lift.body);
  const restored=await trainingCapabilitiesApp.inject({method:'GET',url:`/api/internal/platform/v2/persons/${personId}/training-capabilities`,headers:capabilityHeaders(personId)});
  assert.equal(restored.json().capabilityLevel,'baseline'); assert.equal(restored.json().suspensionStatus,'lifted');
  const [audit]=await sql`SELECT count(*)::int AS count FROM platform_identity_audit_events WHERE person_id=${personId} AND action IN ('training.suspended','training.suspension_lifted')`;
  const [events]=await sql`SELECT count(*)::int AS count FROM platform_training_access_events WHERE person_id=${personId}`;
  assert.equal(audit.count,2); assert.equal(events.count,2);
  const [personRow]=await sql`SELECT status FROM platform_persons WHERE id=${personId}`;
  const [link]=await sql`SELECT status,training_user_id AS "trainingUserId" FROM training_account_links WHERE person_id=${personId}`;
  assert.equal(personRow.status,'active'); assert.equal(link.status,'active'); assert.equal(link.trainingUserId,trainingUserId);
});

async function createTrainingReceiptFixture(ttlMs = TRAINING_LINK_TTL_MS) {
  const client = (await createClientRequest(clientsAdminApp, { firstName: 'Receipt', lastName: `Fixture ${randomUUID()}` })).json();
  const person = await clientsAdminApp.inject({ method: 'POST', url: '/api/platform/v1/persons', payload: { clientId: client.id } });
  assert.equal(person.statusCode, 201, person.body);
  const auth = { personId: person.json().personId, provider: 'fixture-central-auth', providerVersion: 1, authSubject: `receipt-${randomUUID()}` };
  const binding = await clientsAdminApp.inject({ method: 'POST', url: `/api/platform/v1/persons/${auth.personId}/auth-subjects`, payload: { provider: auth.provider, providerVersion: auth.providerVersion, authSubject: auth.authSubject } });
  assert.equal(binding.statusCode, 201, binding.body);
  const protocol = createTrainingLinkTransactions(sql, { enabled: true, serviceCallsEnabled: true, ttlMs });
  const transaction = await protocol.create({ ...auth, requestId: randomUUID() });
  assert.equal(transaction.status, 'created');
  const [stored] = await sql`SELECT created_at,expires_at,nonce_hash FROM training_link_transactions WHERE transaction_id=${transaction.transaction.transactionId}`;
  const receipt = {
    v: 1, status: 'verified', receiptId: randomUUID(), receiptVersion: 1,
    transactionId: transaction.transaction.transactionId, personId: auth.personId,
    trainingUserId: `training-${randomUUID()}`, audience: '2j-training-account-link', purpose: 'training-account-link',
    challengeDigest: stored.nonce_hash.trim(), verifiedAt: new Date(new Date(stored.created_at).getTime() + 10).toISOString(),
  };
  return { client, person: person.json(), auth, binding: binding.json(), transaction, protocol, stored, receipt };
}

async function createTrainingReceiptForAuth(auth, trainingUserId) {
  const protocol = createTrainingLinkTransactions(sql, { enabled: true, serviceCallsEnabled: true });
  const transaction = await protocol.create({ ...auth, requestId: randomUUID() });
  assert.equal(transaction.status, 'created');
  const [stored] = await sql`SELECT created_at,expires_at,nonce_hash FROM training_link_transactions WHERE transaction_id=${transaction.transaction.transactionId}`;
  return { protocol, transaction, stored, receipt: { v: 1, status: 'verified', receiptId: randomUUID(), receiptVersion: 1, transactionId: transaction.transaction.transactionId, personId: auth.personId, trainingUserId, audience: '2j-training-account-link', purpose: 'training-account-link', challengeDigest: stored.nonce_hash.trim(), verifiedAt: new Date(new Date(stored.created_at).getTime() + 10).toISOString() } };
}

test('domain input separates product kind from renewal and defines quota periods explicitly', () => {
      const valid = planPayload([randomUUID()], { rights: [{ rightType: 'period_quota', serviceId: null, quotaScope: 'shared', quantity: 8, period: 'month', periodMode: 'calendar', timezone: 'Atlantic/Canary' }] });
  assert.equal(planInput.safeParse(valid).success, true);
  assert.equal(planInput.safeParse({ ...valid, kind: 'session_pack', renewalCadence: 'monthly' }).success, false);
  assert.equal(planInput.safeParse({ ...valid, kind: 'session_pack', renewalCadence: null, rights: [{ rightType: 'service_access' }] }).success, false);
  assert.equal(planInput.safeParse({ ...valid, kind: 'session_pack', renewalCadence: null, rights: [{ rightType: 'period_quota', quantity: 8, quotaScope: 'shared', period: 'month', periodMode: 'calendar' }] }).success, false);
  assert.equal(planInput.safeParse({ ...valid, rights: [{ rightType: 'period_quota', quantity: 8, quotaScope: 'shared', period: 'month' }] }).success, false);
  assert.equal(planInput.safeParse({ ...valid, serviceIds: [valid.serviceIds[0], valid.serviceIds[0]] }).success, false);
  assert.equal(planInput.safeParse({ ...valid, rights: [{ rightType: 'service_access', serviceId: randomUUID() }] }).success, false);
  assert.equal(planInput.safeParse({ ...valid, rights: [{ rightType: 'service_access', serviceId: valid.serviceIds[0] }] }).success, true, 'a direct service grant requires and accepts a listed target');
  assert.equal(planInput.safeParse({ ...valid, rights: [{ rightType: 'service_access' }] }).success, false, 'a direct grant without target is invalid');
  assert.equal(planInput.safeParse({ ...valid, rights: [{ rightType: 'service_access', serviceId: null }] }).success, false, 'null cannot mean wildcard access');
  assert.equal(planInput.safeParse({ ...valid, rights: [
    { rightType: 'sessions_quota', serviceId: null, quotaScope: 'shared', quantity: 10 },
    { rightType: 'sessions_quota', serviceId: randomUUID(), quotaScope: 'per_service', quantity: 4 },
  ] }).success, false, 'global and targeted quotas of the same type cannot overlap');
  assert.equal(planInput.safeParse({ ...valid, rights: [
    { rightType: 'sessions_quota', quotaScope: 'shared', quantity: 10 },
    { rightType: 'sessions_quota', serviceId: randomUUID(), quotaScope: 'per_service', quantity: 4, period: null },
  ] }).success, false, 'omitted and null periods have the same database meaning');
  assert.equal(planInput.safeParse({ ...valid, rights: [{ rightType: 'sessions_quota', serviceId: randomUUID(), quotaScope: 'shared', quantity: 4 }] }).success, false, 'shared quotas are global');
  assert.equal(serviceInput.safeParse({ name: ' Sala ', areaId: randomUUID(), status: 'draft' }).success, true);
  assert.equal(serviceInput.safeParse({ name: 'Sala', area: 'Sala', status: 'draft' }).success, false);
});

test('client input keeps its personal-data surface intentionally small and validates email/contact lengths', () => {
  const normalized = createClientInput.safeParse({ firstName: ' Ada ', lastName: ' Lovelace ', email: ' ADA@example.test ', phone: '+34 600 000 000' });
  assert.equal(normalized.success, true);
  assert.deepEqual(normalized.data, { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', phone: '+34 600 000 000' });
  assert.equal(createClientInput.safeParse({ firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: '1990-01-01' }).success, false);
  assert.equal(createClientInput.safeParse({ firstName: 'Ada', lastName: 'Lovelace', email: 'not-an-email' }).success, false);
  assert.equal(createClientInput.safeParse({ firstName: 'Ada', lastName: 'Lovelace', phone: 'x'.repeat(41) }).success, false);
  assert.equal(createClientInput.safeParse({ firstName: '\ufb01'.repeat(41), lastName: 'Test' }).success, false, 'post-NFKC length must be validated');
  assert.equal(createClientInput.safeParse({ firstName: 'Ada', lastName: 'Test', email: null, phone: '' }).success, true);
});

test('DB migration is checksummed, repeatable and unchanged on re-application', async () => {
  const directory = new URL('../migrations/', import.meta.url);
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  const first = await migrateDatabase(sql);
  const second = await migrateDatabase(sql);
  assert.deepEqual(second.map((item) => [item.name, item.checksum.trim()]), first.map((item) => [item.name, item.checksum.trim()]));
  assert.deepEqual(first.map((item) => item.name), names);
  for (const name of names) {
    const contents = await readFile(new URL(name, directory), 'utf8');
    assert.equal(first.find((item) => item.name === name)?.checksum.trim(), createHash('sha256').update(contents.replace(/\r\n/g, '\n')).digest('hex'), 'new rows store the checksum of the LF form, whatever the checkout line endings');
  }
  const migration = names[0];
  const originalChecksum = first.find((item) => item.name === migration).checksum.trim();
  await sql`UPDATE schema_migrations SET checksum=${'0'.repeat(64)} WHERE name=${migration}`;
  await assert.rejects(migrateDatabase(sql), /Migration checksum mismatch/);
  await sql`UPDATE schema_migrations SET checksum=${originalChecksum} WHERE name=${migration}`;
});

test('0037 upgrades the checksummed current-main schema once and preserves legacy rows', async () => {
  const sourceUrl=new URL(process.env.DATABASE_URL);
  const databaseName=`capability_upgrade_${randomUUID().replaceAll('-','')}`;
  const adminUrl=new URL(sourceUrl);adminUrl.pathname='/postgres';
  const admin=postgres(adminUrl.toString(),{max:1,connect_timeout:5});
  let upgradeDb;
  try{
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    sourceUrl.pathname=`/${databaseName}`;
    upgradeDb=postgres(sourceUrl.toString(),{max:2,connect_timeout:5});
    const directory=new URL('../migrations/',import.meta.url);
    const names=(await readdir(directory)).filter(name=>name.endsWith('.sql')).sort();
    const contract='0037_contract_entitlement_periods_v1.sql';
    assert.ok(names.includes(contract));
    assert.ok(names.includes('0038_economic_grace_days.sql'));
    const prior=names.filter(name=>name<contract);
    await upgradeDb`CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum char(64) NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`;
    for(const name of prior){
      const contents=await readFile(new URL(name,directory),'utf8');
      const checksum=createHash('sha256').update(contents).digest('hex');
      await upgradeDb.begin(async tx=>{await tx.unsafe(contents);await tx`INSERT INTO schema_migrations(name,checksum) VALUES (${name},${checksum})`});
    }
    const legacyPlanId=randomUUID(),legacyClientId=randomUUID(),legacyChargeId=randomUUID(),legacyPendingChargeId=randomUUID(),legacyAssignmentId=randomUUID(),legacyRightId=randomUUID(),legacyPeriodId=randomUUID(),legacyPendingPeriodId=randomUUID();
    const today=canaryBusinessDate(new Date());
    const currentPeriodStart=`${today.slice(0,7)}-01`;
    const currentPeriodEnd=new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7)),0)).toISOString().slice(0,10);
    const priorMonthEnd=new Date(`${currentPeriodStart}T00:00:00.000Z`);priorMonthEnd.setUTCDate(priorMonthEnd.getUTCDate()-1);
    const priorPeriodEnd=priorMonthEnd.toISOString().slice(0,10);
    const priorPeriodStart=`${priorPeriodEnd.slice(0,7)}-01`;
    const [legacyArea]=await upgradeDb`SELECT id FROM areas WHERE normalized_name='la sala'`;
    const [legacyService]=await upgradeDb`INSERT INTO services(area_id,name,status) VALUES (${legacyArea.id},${`Legacy upgrade ${randomUUID()}`},'active') RETURNING id`;
    await upgradeDb.begin(async tx=>{
      // Schema-36 has no supported way to create historical state except fixture SQL.
      // Seed the exact result of catalog activation: active plan + immutable version.
      await tx`INSERT INTO plans(id,name,status,current_version,idempotency_key,request_hash) VALUES (${legacyPlanId},'Legacy upgrade fixture','draft',1,${randomUUID()},${'b'.repeat(64)})`;
      await tx`INSERT INTO plan_versions(plan_id,version,kind,renewal_cadence,timezone) VALUES (${legacyPlanId},1,'recurring','monthly','Atlantic/Canary')`;
      await tx`INSERT INTO plan_services(plan_id,plan_version,service_id) VALUES (${legacyPlanId},1,${legacyService.id})`;
      await tx`INSERT INTO plan_rights(plan_id,plan_version,right_type,service_id) VALUES (${legacyPlanId},1,'service_access',${legacyService.id})`;
      await tx`INSERT INTO plan_rights(id,plan_id,plan_version,right_type,quota_scope,quantity,weekly_frequency) VALUES (${legacyRightId},${legacyPlanId},1,'sessions_quota','shared',8,3)`;
      await tx`UPDATE plan_versions SET frozen_at=now() WHERE plan_id=${legacyPlanId} AND version=1`;
      await tx`UPDATE plans SET status='active' WHERE id=${legacyPlanId}`;
      await tx`INSERT INTO clients(id,first_name,last_name) VALUES (${legacyClientId},'Legacy F1-B','Fixture')`;
      await tx`INSERT INTO economic_charges(id,client_id,plan_id,concept,amount_cents,due_on,created_by,idempotency_key,request_hash)
        VALUES (${legacyChargeId},${legacyClientId},${legacyPlanId},'Legacy paid contract',8000,${priorPeriodStart},'migration-fixture',${randomUUID()},${'c'.repeat(64)})`;
      await tx`INSERT INTO economic_charges(id,client_id,plan_id,concept,amount_cents,due_on,created_by,idempotency_key,request_hash)
        VALUES (${legacyPendingChargeId},${legacyClientId},${legacyPlanId},'Legacy pending period',8000,${currentPeriodStart},'migration-fixture',${randomUUID()},${'a'.repeat(64)})`;
      await tx`INSERT INTO client_plan_assignments(id,client_id,plan_id,plan_version,charge_id,starts_on,ends_on,idempotency_key,request_hash,created_by)
        VALUES (${legacyAssignmentId},${legacyClientId},${legacyPlanId},1,${legacyChargeId},${priorPeriodStart},NULL,${randomUUID()},${'d'.repeat(64)},'migration-fixture')`;
      await tx`INSERT INTO assignment_entitlement_periods(id,assignment_id,client_id,right_id,period_start,period_end,weekly_frequency,sessions_snapshot,snapshot,idempotency_key,request_hash)
        VALUES (${legacyPeriodId},${legacyAssignmentId},${legacyClientId},${legacyRightId},${priorPeriodStart},${priorPeriodEnd},3,entitlement_sessions_v1(entitlement_weekdays(${priorPeriodStart},${priorPeriodEnd}),3),
          ${tx.json({version:1,source:'098E migration fixture'})},${randomUUID()},${'e'.repeat(64)})`;
      await tx`INSERT INTO assignment_entitlement_periods(id,assignment_id,client_id,right_id,period_start,period_end,weekly_frequency,sessions_snapshot,snapshot,idempotency_key,request_hash)
        VALUES (${legacyPendingPeriodId},${legacyAssignmentId},${legacyClientId},${legacyRightId},${currentPeriodStart},${currentPeriodEnd},3,entitlement_sessions_v1(entitlement_weekdays(${currentPeriodStart},${currentPeriodEnd}),3),
          ${tx.json({version:1,source:'098E pending-payment fixture'})},${randomUUID()},${'9'.repeat(64)})`;
      const [legacySessions]=await tx`SELECT sessions_snapshot FROM assignment_entitlement_periods WHERE id=${legacyPeriodId}`;
      await tx`INSERT INTO assignment_recurrence_events(assignment_id,enabled,actor_id,effective_on,reason,idempotency_key,request_hash)
        VALUES (${legacyAssignmentId},true,'migration-fixture',${priorPeriodStart},'Legacy recurrence enabled',${randomUUID()},${'f'.repeat(64)})`;
      await tx`INSERT INTO assignment_entitlement_period_events(period_id,assignment_id,client_id,right_id,event_type,charge_id,actor_id,reason,idempotency_key,request_hash)
        VALUES (${legacyPeriodId},${legacyAssignmentId},${legacyClientId},${legacyRightId},'charge_linked',${legacyChargeId},'migration-fixture','Legacy charge linked',${randomUUID()},${'1'.repeat(64)})`;
      await tx`INSERT INTO assignment_entitlement_period_events(period_id,assignment_id,client_id,right_id,event_type,charge_id,actor_id,reason,idempotency_key,request_hash)
        VALUES (${legacyPendingPeriodId},${legacyAssignmentId},${legacyClientId},${legacyRightId},'charge_linked',${legacyPendingChargeId},'migration-fixture','Legacy pending charge linked',${randomUUID()},${'8'.repeat(64)})`;
      await tx`INSERT INTO economic_transactions(id,charge_id,client_id,kind,amount_cents,actor_id,idempotency_key,request_hash)
        VALUES (${randomUUID()},${legacyChargeId},${legacyClientId},'payment',8000,'migration-fixture',${randomUUID()},${'2'.repeat(64)})`;
      const [payment]=await tx`SELECT id FROM economic_transactions WHERE charge_id=${legacyChargeId}`;
      await tx`INSERT INTO economic_payment_splits(transaction_id,method,amount_cents) VALUES (${payment.id},'cash',8000)`;
      await tx`INSERT INTO assignment_entitlement_period_events(period_id,assignment_id,client_id,right_id,event_type,charge_id,effective_activation_on,sessions_granted,actor_id,reason,idempotency_key,request_hash)
        VALUES (${legacyPeriodId},${legacyAssignmentId},${legacyClientId},${legacyRightId},'payment_validated',${legacyChargeId},${priorPeriodStart},${legacySessions.sessions_snapshot},'migration-fixture','Legacy payment validated',${randomUUID()},${'3'.repeat(64)})`;
      await tx`INSERT INTO client_entitlement_ledger(client_id,assignment_id,right_key,entry_type,quantity,reason,actor_id,idempotency_key,request_hash,entitlement_period_id)
        VALUES (${legacyClientId},${legacyAssignmentId},${legacyRightId},'grant',${legacySessions.sessions_snapshot},'Legacy period grant','migration-fixture',${randomUUID()},${'4'.repeat(64)},${legacyPeriodId})`;
    });
    // LEGACY_FIXTURE_VALID_BEFORE_0037: these checks prove the seed is a valid
    // schema-36 operational state, not merely rows accepted by loose SQL.
    assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM plans p JOIN plan_versions v ON v.plan_id=p.id AND v.version=p.current_version
      WHERE p.id=${legacyPlanId} AND p.status='active' AND v.frozen_at IS NOT NULL AND v.term_kind IS NULL`)[0].count,1,'LEGACY_FIXTURE_VALID_BEFORE_0037: active plan and frozen legacy version');
    assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM client_plan_assignments a JOIN clients c ON c.id=a.client_id JOIN plans p ON p.id=a.plan_id
      JOIN plan_versions v ON v.plan_id=a.plan_id AND v.version=a.plan_version JOIN economic_charges ch ON ch.id=a.charge_id
      WHERE a.id=${legacyAssignmentId} AND a.client_id=${legacyClientId} AND a.plan_id=${legacyPlanId} AND a.plan_version=1 AND a.status='active'
        AND c.status='active' AND p.status='active' AND v.frozen_at IS NOT NULL AND a.starts_on=${priorPeriodStart} AND a.ends_on IS NULL
        AND ch.client_id=a.client_id AND ch.plan_id=a.plan_id`)[0].count,1,'LEGACY_FIXTURE_VALID_BEFORE_0037: active assignment matches active client, frozen plan version, and valid charge');
    assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM plan_rights r JOIN plan_services ps ON ps.plan_id=r.plan_id AND ps.plan_version=r.plan_version
      JOIN services s ON s.id=ps.service_id AND s.status='active' JOIN areas ar ON ar.id=s.area_id AND ar.status='active'
      WHERE r.id=${legacyRightId} AND r.plan_id=${legacyPlanId} AND r.plan_version=1 AND r.right_type='sessions_quota' AND r.quantity=8 AND r.weekly_frequency=3`)[0].count,1,'LEGACY_FIXTURE_VALID_BEFORE_0037: legacy quota right is valid');
    assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM assignment_entitlement_periods p JOIN assignment_entitlement_period_events e ON e.period_id=p.id
      JOIN client_entitlement_ledger l ON l.entitlement_period_id=p.id AND l.assignment_id=p.assignment_id AND l.client_id=p.client_id AND l.right_key=p.right_id::text
      WHERE p.id=${legacyPeriodId} AND p.assignment_id=${legacyAssignmentId} AND p.client_id=${legacyClientId} AND p.right_id=${legacyRightId}
        AND p.period_start=${priorPeriodStart} AND p.period_end=${priorPeriodEnd} AND p.sessions_snapshot>0
        AND e.event_type='payment_validated' AND e.sessions_granted=p.sessions_snapshot AND l.entry_type='grant' AND l.quantity=p.sessions_snapshot`)[0].count,1,'LEGACY_FIXTURE_VALID_BEFORE_0037: historical period, validation event, and grant agree');
    assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM assignment_recurrence_events WHERE assignment_id=${legacyAssignmentId} AND enabled=true AND effective_on=${priorPeriodStart}`)[0].count,1,'LEGACY_FIXTURE_VALID_BEFORE_0037: recurrence history is valid');
    assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema='public' AND table_name='plan_rights' AND column_name='quantity_rule'`)[0].count,0,'LEGACY_FIXTURE_VALID_BEFORE_0037: quantity_rule does not yet exist');
    assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema='public' AND table_name='assignment_entitlement_periods' AND column_name IN ('period_index','entitlement_mode','formula_id','weekdays_in_period','sessions_granted')`)[0].count,0,'LEGACY_FIXTURE_VALID_BEFORE_0037: no F1-B period facts exist yet');
    assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM assignment_entitlement_periods p JOIN assignment_entitlement_period_events e ON e.period_id=p.id
      JOIN economic_charges ch ON ch.id=e.charge_id WHERE p.id=${legacyPendingPeriodId} AND e.event_type='charge_linked'
        AND ch.state='pending' AND NOT EXISTS(SELECT 1 FROM assignment_entitlement_period_events v WHERE v.period_id=p.id AND v.event_type='payment_validated')`)[0].count,1,'LEGACY_FIXTURE_VALID_BEFORE_0037: current period legitimately awaits payment activation');
    const legacyBefore={
      periods:await upgradeDb`SELECT id,assignment_id,client_id,right_id,period_start::text,period_end::text,weekly_frequency,sessions_snapshot,snapshot,idempotency_key,request_hash FROM assignment_entitlement_periods WHERE assignment_id=${legacyAssignmentId} ORDER BY period_start`,
      events:await upgradeDb`SELECT period_id,assignment_id,client_id,right_id,event_type,charge_id,effective_activation_on::text,sessions_granted,actor_id,reason,idempotency_key,request_hash FROM assignment_entitlement_period_events WHERE period_id=${legacyPeriodId} ORDER BY event_type`,
      pendingEvents:await upgradeDb`SELECT period_id,assignment_id,client_id,right_id,event_type,charge_id,effective_activation_on::text,sessions_granted,actor_id,reason,idempotency_key,request_hash FROM assignment_entitlement_period_events WHERE period_id=${legacyPendingPeriodId} ORDER BY event_type`,
      grants:await upgradeDb`SELECT id,client_id,assignment_id,right_key,entry_type,quantity,entitlement_period_id,request_hash FROM client_entitlement_ledger WHERE entitlement_period_id=${legacyPeriodId}`,
      recurrence:await upgradeDb`SELECT assignment_id,enabled,actor_id,effective_on::text,reason,idempotency_key,request_hash FROM assignment_recurrence_events WHERE assignment_id=${legacyAssignmentId}`,
      balance:await upgradeDb`SELECT COALESCE(sum(quantity),0)::int AS amount FROM client_entitlement_ledger WHERE entitlement_period_id=${legacyPeriodId} AND right_key=${legacyRightId}`,
    };
    assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM schema_migrations`)[0].count,36);
    const upgraded=await migrateDatabase(upgradeDb);
    assert.equal(upgraded.length,names.length);
    assert.deepEqual(upgraded.slice(35,38).map(row=>row.name),['0036_contract_terms_dates.sql',contract,'0038_economic_grace_days.sql'],'later migrations are appended after 0038');
    assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM schema_migrations WHERE name=${contract}`)[0].count,1);
    assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM information_schema.columns WHERE table_name='plan_rights' AND column_name='quantity_rule'`)[0].count,1);
    assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM information_schema.columns WHERE table_name='assignment_entitlement_periods' AND column_name IN ('period_index','entitlement_mode','formula_id','weekdays_in_period','sessions_granted')`)[0].count,5);
    assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM information_schema.columns WHERE table_name='plan_rights' AND column_name='training_access_level'`)[0].count,1);
    assert.equal((await upgradeDb`SELECT to_regclass('public.platform_service_request_replays') IS NOT NULL AS exists`)[0].exists,true);
    assert.equal((await upgradeDb`SELECT to_regclass('public.platform_training_access_events') IS NOT NULL AS exists`)[0].exists,true);
    assert.equal((await migrateDatabase(upgradeDb)).length,names.length,'re-running migration verification applies no duplicate migration');
    assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM plan_versions WHERE term_kind IS NOT NULL`)[0].count,0,'migration must not rewrite legacy plan versions');
    assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM plan_versions WHERE plan_id=${legacyPlanId} AND version=1 AND term_kind IS NULL AND term_months IS NULL AND max_span_days IS NULL AND payment_rule IS NULL AND payment_block IS NULL`)[0].count,1);
    assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM assignment_contract_terms`)[0].count,0,'migration must not fabricate terms for legacy assignments');
    const legacyAfter=await upgradeDb`SELECT id,assignment_id,client_id,right_id,period_start::text,period_end::text,weekly_frequency,sessions_snapshot,snapshot,idempotency_key,request_hash,
      entitlement_mode,period_index,formula_id,weekdays_in_period,sessions_granted FROM assignment_entitlement_periods WHERE assignment_id=${legacyAssignmentId} ORDER BY period_start`;
    assert.deepEqual(legacyAfter.map(({entitlement_mode,period_index,formula_id,weekdays_in_period,sessions_granted,...row})=>row),Array.from(legacyBefore.periods),'0037 must preserve every legacy period fact byte-for-byte');
    for(const row of legacyAfter){assert.equal(row.entitlement_mode,null);assert.equal(row.period_index,null);assert.equal(row.formula_id,null);assert.equal(row.weekdays_in_period,null);assert.equal(row.sessions_granted,null);}
    assert.deepEqual(await upgradeDb`SELECT period_id,assignment_id,client_id,right_id,event_type,charge_id,effective_activation_on::text,sessions_granted,actor_id,reason,idempotency_key,request_hash FROM assignment_entitlement_period_events WHERE period_id=${legacyPeriodId} ORDER BY event_type`,legacyBefore.events);
    assert.deepEqual(await upgradeDb`SELECT period_id,assignment_id,client_id,right_id,event_type,charge_id,effective_activation_on::text,sessions_granted,actor_id,reason,idempotency_key,request_hash FROM assignment_entitlement_period_events WHERE period_id=${legacyPendingPeriodId} ORDER BY event_type`,legacyBefore.pendingEvents);
    assert.deepEqual(await upgradeDb`SELECT id,client_id,assignment_id,right_key,entry_type,quantity,entitlement_period_id,request_hash FROM client_entitlement_ledger WHERE entitlement_period_id=${legacyPeriodId}`,legacyBefore.grants);
    assert.deepEqual(await upgradeDb`SELECT assignment_id,enabled,actor_id,effective_on::text,reason,idempotency_key,request_hash FROM assignment_recurrence_events WHERE assignment_id=${legacyAssignmentId}`,legacyBefore.recurrence);
    assert.deepEqual(await upgradeDb`SELECT COALESCE(sum(quantity),0)::int AS amount FROM client_entitlement_ledger WHERE entitlement_period_id=${legacyPeriodId} AND right_key=${legacyRightId}`,legacyBefore.balance);
    assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM client_entitlement_ledger WHERE entitlement_period_id=${legacyPeriodId} AND right_key=${legacyRightId} AND entry_type='grant'`)[0].count,1,'legacy period replay/grant remains single under new unique index');
    assert.ok((await upgradeDb`SELECT 1 FROM pg_indexes WHERE indexname='client_entitlement_ledger_period_grant_unique'`).length,'legacy grant unique index is installed with representative history');
    // Exercise the real 098E payment route after 0037: it records payment,
    // calls activateSettledEntitlementPeriods, creates one legacy grant, and
    // preserves idempotent retry behavior under the new grant index.
    const upgradedApp=buildServer(sourceUrl.toString(),{authorizationResolver:async()=>({actorId:'migration-flow-test',role:'admin'})});
    try{
      await upgradedApp.ready();
      const [cashProfessional]=await upgradeDb`INSERT INTO staff_professionals(first_name,last_name,display_name,base_role,auth_actor_id,created_by) VALUES ('Migración','Caja','migration-flow-test','admin','migration-flow-test','test-fixture') RETURNING id`;
      const [cashRegister]=await upgradeDb`SELECT id FROM economic_cash_registers WHERE code='bunker'`;
      const zeroDenominations={coin_0_01:0,coin_0_02:0,coin_0_05:0,coin_0_10:0,coin_0_20:0,coin_0_50:0,coin_1:0,coin_2:0,bill_5:0,bill_10:0,bill_20:0,bill_50:0,bill_100:0,bill_200:0,bill_500:0};
      const [cashSession]=await upgradeDb`INSERT INTO economic_cash_sessions(register_id,local_date,opening_cents,opening_denominations,opened_by) VALUES (${cashRegister.id},(now() AT TIME ZONE 'Atlantic/Canary')::date,0,${upgradeDb.json(zeroDenominations)},'migration-flow-test') RETURNING id`;
      await upgradeDb`INSERT INTO economic_cash_custodies(cash_session_id,professional_id,actor_id) VALUES (${cashSession.id},${cashProfessional.id},'migration-flow-test')`;
      const paymentKey=randomUUID();
      const paymentResponse=await upgradedApp.inject({method:'POST',url:'/api/economics/payments',headers:{'idempotency-key':paymentKey},payload:{chargeId:legacyPendingChargeId,splits:[{method:'card',amountCents:8000}]}});
      assert.equal(paymentResponse.statusCode,201,paymentResponse.body);
      const [newActivation]=await upgradeDb`SELECT event_type,effective_activation_on::text AS effective_on,sessions_granted FROM assignment_entitlement_period_events WHERE period_id=${legacyPendingPeriodId} AND event_type='payment_validated'`;
      assert.ok(newActivation,'real payment flow must validate the legacy period');
      assert.equal(newActivation.effective_on,today);
      const [activatedPeriod]=await upgradeDb`SELECT sessions_snapshot FROM assignment_entitlement_periods WHERE id=${legacyPendingPeriodId}`;
      const [newGrant]=await upgradeDb`SELECT quantity,right_key,entitlement_period_id FROM client_entitlement_ledger WHERE entitlement_period_id=${legacyPendingPeriodId} AND entry_type='grant'`;
      assert.equal(newGrant.quantity,newActivation.sessions_granted,'legacy grant quantity matches real payment activation');
      assert.equal(newGrant.right_key,legacyRightId);assert.equal(newGrant.entitlement_period_id,legacyPendingPeriodId);
      assert.ok(newActivation.sessions_granted>0);
      const [paymentCountBeforeRetry]=await upgradeDb`SELECT count(*)::int AS count FROM economic_transactions WHERE charge_id=${legacyPendingChargeId}`;
      const retry=await upgradedApp.inject({method:'POST',url:'/api/economics/payments',headers:{'idempotency-key':paymentKey},payload:{chargeId:legacyPendingChargeId,splits:[{method:'card',amountCents:8000}]}});
      assert.equal(retry.statusCode,200,retry.body);
      const directActivationRetry=await upgradeDb.begin(tx=>activateSettledEntitlementPeriods(tx,legacyPendingChargeId,'migration-flow-test'));
      assert.equal(directActivationRetry,0,'already validated legacy activation is an exact no-op on retry');
      assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM economic_transactions WHERE charge_id=${legacyPendingChargeId}`)[0].count,paymentCountBeforeRetry.count);
      assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM assignment_entitlement_period_events WHERE period_id=${legacyPendingPeriodId} AND event_type='payment_validated'`)[0].count,1);
      assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM client_entitlement_ledger WHERE entitlement_period_id=${legacyPendingPeriodId} AND entry_type='grant'`)[0].count,1,'legacy grant unique index allows the real activation and prevents duplicates');
      assert.equal((await upgradeDb`SELECT COALESCE(sum(quantity),0)::int AS amount FROM client_entitlement_ledger WHERE entitlement_period_id=${legacyPendingPeriodId} AND right_key=${legacyRightId}`)[0].amount,newActivation.sessions_granted);
      assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM economic_audit_events WHERE action='entitlement_period.payment_validated' AND details->>'periodId'=${legacyPendingPeriodId}`)[0].count,1);
      assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM assignment_entitlement_periods WHERE id=${legacyPendingPeriodId} AND sessions_snapshot=${activatedPeriod.sessions_snapshot} AND entitlement_mode IS NULL AND period_index IS NULL AND formula_id IS NULL AND weekdays_in_period IS NULL AND sessions_granted IS NULL`)[0].count,1,'payment activation retains the legacy period shape and does not fabricate F1-B facts');

      const recurrenceUrl=`/api/clients/${legacyClientId}/plans/${legacyAssignmentId}/recurrence`;
      const disabled=await upgradedApp.inject({method:'PATCH',url:recurrenceUrl,headers:{'idempotency-key':randomUUID()},payload:{enabled:false,effectiveOn:today,reason:'Pausa legacy tras 0037'}});
      assert.equal(disabled.statusCode,201,disabled.body);
      assert.equal((await upgradeDb`SELECT enabled FROM assignment_recurrence_events WHERE assignment_id=${legacyAssignmentId} AND effective_on<=${today}::date ORDER BY effective_on DESC,created_at DESC,id DESC LIMIT 1`)[0].enabled,false);
      const afterCurrentPeriod=new Date(`${currentPeriodEnd}T00:00:00.000Z`);afterCurrentPeriod.setUTCDate(afterCurrentPeriod.getUTCDate()+1);
      const offMaterialization=await materializeRecurringEntitlementPeriods(upgradeDb,new Date(`${afterCurrentPeriod.toISOString().slice(0,10)}T12:00:00.000Z`));
      assert.equal(offMaterialization.created,0,'effective OFF state prevents materialization after the current period ends');
      const futureDay=new Date(`${afterCurrentPeriod.toISOString().slice(0,10)}T00:00:00.000Z`);futureDay.setUTCDate(futureDay.getUTCDate()+1);
      const recurrenceResumeDate=futureDay.toISOString().slice(0,10);
      const enabled=await upgradedApp.inject({method:'PATCH',url:recurrenceUrl,headers:{'idempotency-key':randomUUID()},payload:{enabled:true,effectiveOn:recurrenceResumeDate,reason:'Reanudación legacy tras 0037'}});
      assert.equal(enabled.statusCode,201,enabled.body);
      const recurrenceBefore=await upgradeDb`SELECT assignment_id,enabled,actor_id,effective_on::text,reason,idempotency_key,request_hash FROM assignment_recurrence_events WHERE assignment_id=${legacyAssignmentId} ORDER BY effective_on,created_at,id`;
      assert.equal(recurrenceBefore.at(-1).enabled,true);
      assert.equal(recurrenceBefore.at(-1).effective_on,recurrenceResumeDate);

      const materializeAt=new Date(`${recurrenceResumeDate}T12:00:00.000Z`);
      const materialized=await materializeRecurringEntitlementPeriods(upgradeDb,materializeAt);
      assert.equal(materialized.created,1,JSON.stringify(materialized));
      const materializedRetry=await materializeRecurringEntitlementPeriods(upgradeDb,materializeAt);
      assert.equal(materializedRetry.created,0,'legacy next-period materialization is idempotent');
      const nextPeriods=await upgradeDb`SELECT id,period_start::text AS starts_on,period_end::text AS ends_on,weekly_frequency,sessions_snapshot,snapshot,entitlement_mode,period_index,formula_id,weekdays_in_period,sessions_granted
        FROM assignment_entitlement_periods WHERE assignment_id=${legacyAssignmentId} AND right_id=${legacyRightId} ORDER BY period_start`;
      assert.equal(nextPeriods.length,3);
      const nextPeriod=nextPeriods.at(-1);
      assert.equal(nextPeriod.entitlement_mode,null);assert.equal(nextPeriod.period_index,null);assert.equal(nextPeriod.formula_id,null);assert.equal(nextPeriod.weekdays_in_period,null);assert.equal(nextPeriod.sessions_granted,null);
      assert.ok(nextPeriod.sessions_snapshot>0);
      assert.equal(nextPeriod.snapshot.quantityRule,'weekday_ratio_v1');
      assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM client_entitlement_ledger WHERE entitlement_period_id=${nextPeriod.id} AND entry_type='grant'`)[0].count,0,'098E recurrence materializes a period only; it does not create a grant before payment');
      assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM plan_rights WHERE id=${legacyRightId} AND quantity_rule IS NULL`)[0].count,1,'legacy right stays valid without an F1-B quantity rule');
      assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM client_entitlement_ledger WHERE entitlement_period_id=${legacyPeriodId} AND entry_type='grant'`)[0].count,1);
      assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM client_entitlement_ledger WHERE entitlement_period_id=${legacyPendingPeriodId} AND entry_type='grant'`)[0].count,1);
      assert.equal((await upgradeDb`SELECT COALESCE(sum(quantity),0)::int AS amount FROM client_entitlement_ledger WHERE assignment_id=${legacyAssignmentId} AND right_key=${legacyRightId}`)[0].amount,Number(legacyBefore.balance[0].amount)+newActivation.sessions_granted,'existing and newly activated balances are preserved');
      assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM economic_audit_events WHERE actor_id='migration-flow-test' AND resource_id=${legacyAssignmentId}`)[0].count,3,'payment and both recurrence actions retain their audit trail');
    }finally{await upgradedApp.close();}
  }finally{
    if(upgradeDb)await upgradeDb.end();
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }
});

test('0024 upgrades representative legacy active and revoked explicit-admin links without rewriting history', async () => {
  const databaseUrl = new URL(process.env.DATABASE_URL);
  const temporaryDatabase = `legacy_${randomUUID().replaceAll('-', '')}`;
  const adminUrl = new URL(databaseUrl); adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1, connect_timeout: 5 });
  let legacy;
  try {
    await admin.unsafe(`CREATE DATABASE "${temporaryDatabase}"`);
    databaseUrl.pathname = `/${temporaryDatabase}`;
    legacy = postgres(databaseUrl.toString(), { max: 2, connect_timeout: 5 });
    const directory = new URL('../migrations/', import.meta.url);
    const migrations = (await readdir(directory)).filter((name) => name.endsWith('.sql') && name < '0024_training_canonical_link_lifecycle.sql').sort();
    for (const name of migrations) {
      const contents = await readFile(new URL(name, directory), 'utf8');
      await legacy.begin(async (tx) => tx.unsafe(contents));
    }
    const activePersonId = randomUUID(), revokedPersonId = randomUUID(), activeLinkId = randomUUID(), revokedLinkId = randomUUID();
    await legacy.begin(async (tx) => {
      await tx`INSERT INTO platform_persons(id,created_by) VALUES (${activePersonId},'legacy-upgrade-test'),(${revokedPersonId},'legacy-upgrade-test')`;
      await tx`INSERT INTO training_account_links(link_id,request_id,person_id,training_user_id,method,created_by,updated_by) VALUES
        (${activeLinkId},${randomUUID()},${activePersonId},'legacy-active-training-id','explicit_admin','legacy-upgrade-test','legacy-upgrade-test'),
        (${revokedLinkId},${randomUUID()},${revokedPersonId},'legacy-revoked-training-id','explicit_admin','legacy-upgrade-test','legacy-upgrade-test')`;
      await tx`UPDATE training_account_links SET status='revoked',revoked_at=now() WHERE link_id=${revokedLinkId}`;
    });
    const before = await legacy`SELECT link_id,request_id,person_id,training_user_id,status,method,link_version,created_by,updated_by,created_at,updated_at,revoked_at FROM training_account_links ORDER BY link_id`;
    const migration = await readFile(new URL('0024_training_canonical_link_lifecycle.sql', directory), 'utf8');
    await legacy.begin(async (tx) => tx.unsafe(migration));
    const afterRows = await legacy`SELECT link_id,request_id,person_id,training_user_id,status,method,link_version,created_by,updated_by,created_at,updated_at,revoked_at FROM training_account_links ORDER BY link_id`;
    assert.deepEqual(afterRows, before, '0024 preserves all legacy link identity, state, actor, version, and timestamps');
    assert.deepEqual(afterRows.map((row) => row.status).sort(), ['active','revoked']);
    assert.ok((await legacy`SELECT 1 FROM pg_indexes WHERE indexname='training_account_links_one_nonterminal_person'`).length);
  } finally {
    if (legacy) await legacy.end({ timeout: 5 });
    await admin.unsafe(`DROP DATABASE IF EXISTS "${temporaryDatabase}" WITH (FORCE)`);
    await admin.end({ timeout: 5 });
  }
});

test('Drizzle table columns, checks and indexes match the SQL baseline', async () => {
  const tables = [schema.areas, schema.services, schema.plans, schema.planServices, schema.planVersions, schema.planRights, schema.planModuleAccesses, schema.planModuleCapabilities, schema.planVersionChanges, schema.clients, schema.clientEvents, schema.clientCreationIdempotency, schema.clientPlanAssignments, schema.assignmentContractTerms, schema.clientPlanAssignmentEvents, schema.assignmentRecurrenceEvents, schema.assignmentEntitlementPeriods, schema.assignmentEntitlementPeriodEvents, schema.clientEntitlementLedger, schema.dashboardPreferences, schema.recurringSessionTemplates, schema.calendarSessions, schema.calendarReservations, schema.calendarWaitlistEntries, schema.calendarReservationRights, schema.calendarBookingOperations, schema.calendarAuditEvents, schema.staffProfessionals, schema.staffScheduleSlots, schema.staffExceptions, schema.staffSubstitutions, schema.staffTimeclockEvents, schema.staffTimeclockCorrections, schema.staffAuditEvents, schema.platformPersons, schema.platformPersonClients, schema.platformPersonStaff, schema.trainingAccountLinks, schema.platformServiceRequestReplays, schema.platformIdentityAuditEvents, schema.platformPersonAuthSubjects, schema.trainingLinkTransactions];
  const databaseTables = await sql`SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name IN ${sql(tables.map((table) => getTableConfig(table).name))} ORDER BY table_name,column_name`;
  const dbColumns = Map.groupBy(databaseTables, (row) => row.table_name);
  const checks = new Set((await sql`SELECT conname FROM pg_constraint WHERE contype='c'`).map((row) => row.conname));
  const indexes = new Set((await sql`SELECT indexname FROM pg_indexes WHERE schemaname='public'`).map((row) => row.indexname));
  for (const table of tables) {
    const config = getTableConfig(table);
    assert.deepEqual((dbColumns.get(config.name) ?? []).map((row) => row.column_name).sort(), config.columns.map((column) => column.name).sort(), `${config.name} columns drifted`);
    for (const column of config.columns) {
      const databaseColumn = dbColumns.get(config.name).find((row) => row.column_name === column.name);
      assert.equal(databaseColumn.is_nullable === 'YES', !column.notNull, `${config.name}.${column.name} nullability drifted`);
      const rawType = column.getSQLType();
      const expectedType = rawType.replace(/^char\(/, 'character(').replace(/^time$/, 'time without time zone');
      assert.ok(databaseColumn.data_type === expectedType || (expectedType.startsWith('character(') && databaseColumn.data_type === 'character'), `${config.name}.${column.name} type drifted: ${databaseColumn.data_type} != ${expectedType}`);
      assert.equal(databaseColumn.column_default != null, column.hasDefault, `${config.name}.${column.name} default presence drifted`);
    }
    for (const check of config.checks) assert.ok(checks.has(check.name), `missing SQL check ${check.name}`);
    for (const index of config.indexes) assert.ok(indexes.has(index.config.name), `missing SQL index ${index.config.name}`);
  }
  const configuredForeignKeys = tables.flatMap((table) => getTableConfig(table).foreignKeys.map((foreignKey) => foreignKey.getName()));
  const databaseForeignKeys = await sql`SELECT conname,confdeltype FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace`;
  const foreignKeyAliases = (name) => [name, name.slice(0, 63), name.replace(/_(?:staff_professionals|staff_timeclock_events)_id_fk$/, '_fkey')];
  for (const name of configuredForeignKeys) assert.ok(databaseForeignKeys.some((key) => foreignKeyAliases(name).includes(key.conname)), `missing SQL foreign key ${name}`);
  for (const key of databaseForeignKeys.filter((item) => configuredForeignKeys.some((name) => foreignKeyAliases(name).includes(item.conname)))) assert.equal(key.confdeltype, 'r', `${key.conname} must restrict historical deletes`);
  assert.ok((await sql`SELECT 1 FROM pg_constraint WHERE conname='plans_current_version_fk'`).length, 'SQL must retain the deferred active-version foreign key');
  const planIndexes = await sql`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('plans','services')`;
  assert.match(planIndexes.find((row) => row.indexname === 'plans_active_name_unique').indexdef, /lower\(name\)/);
  assert.match(planIndexes.find((row) => row.indexname === 'services_updated_idx').indexdef, /updated_at DESC/);
  const rightIndexes = await sql`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND indexname IN ('plan_rights_global_unique','plan_rights_service_unique')`;
  assert.equal(rightIndexes.length, 2);
  for (const index of rightIndexes) assert.match(index.indexdef, /COALESCE\(period, ''(?:::text)?\)/, `${index.indexname} must distinguish quota periods`);
});

test('0037/0038 migrate a fresh database from zero and verify the upgrade from current main exactly once', async () => {
  const sourceUrl=new URL(process.env.DATABASE_URL),databaseName=`f1a_fresh_${randomUUID().replaceAll('-','')}`;
  const adminUrl=new URL(sourceUrl);adminUrl.pathname='/postgres';
  const admin=postgres(adminUrl.toString(),{max:1,connect_timeout:5});let fresh;
  try{
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    sourceUrl.pathname=`/${databaseName}`;fresh=postgres(sourceUrl.toString(),{max:2,connect_timeout:5});
    assert.equal((await fresh`SELECT to_regclass('public.plan_versions') AS table`)[0].table,null,'fresh database starts empty');
    const first=await migrateDatabase(fresh);
    const listing=(await readdir(new URL('../migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort();
    assert.deepEqual(first.map(row=>row.name),listing,'every migration file is applied exactly once, in order, and nothing else is recorded');
    assert.equal(first[36].name,'0037_contract_entitlement_periods_v1.sql','released history keeps its position');
    assert.equal(first[37].name,'0038_economic_grace_days.sql','released history keeps its position');
    const second=await migrateDatabase(fresh);
    assert.deepEqual(second.map(row=>[row.name,row.checksum.trim()]),first.map(row=>[row.name,row.checksum.trim()]));
    assert.equal((await fresh`SELECT count(*)::int AS count FROM schema_migrations WHERE name='0037_contract_entitlement_periods_v1.sql'`)[0].count,1);
    assert.equal((await fresh`SELECT count(*)::int AS count FROM schema_migrations WHERE name='0038_economic_grace_days.sql'`)[0].count,1);
    assert.equal((await fresh`SELECT grace_days FROM economic_settings WHERE singleton=true`)[0].grace_days,5);
    assert.equal((await fresh`SELECT to_regprocedure('contract_end_v1(date,integer)') IS NOT NULL AS exists`)[0].exists,true);
    assert.equal((await fresh`SELECT to_regclass('public.assignment_contract_terms') IS NOT NULL AS exists`)[0].exists,true);
    assert.equal((await fresh`SELECT to_regprocedure('entitlement_weekdays(date,date)') IS NOT NULL AS exists`)[0].exists,true);
  }finally{
    if(fresh)await fresh.end();
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);await admin.end();
  }
});

test('the latest migration upgrades the previous schema once and remains checksum-stable on rerun', async () => {
  const sourceUrl=new URL(process.env.DATABASE_URL),databaseName=`f1c_main_upgrade_${randomUUID().replaceAll('-','')}`;
  const adminUrl=new URL(sourceUrl);adminUrl.pathname='/postgres';
  const admin=postgres(adminUrl.toString(),{max:1,connect_timeout:5});let upgradeDb;
  try{
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    sourceUrl.pathname=`/${databaseName}`;upgradeDb=postgres(sourceUrl.toString(),{max:2,connect_timeout:5});
    const directory=new URL('../migrations/',import.meta.url);
    const names=(await readdir(directory)).filter(name=>name.endsWith('.sql')).sort();
    assert.ok(names.length>=39);assert.equal(names[36],'0037_contract_entitlement_periods_v1.sql');
    assert.equal(names[37],'0038_economic_grace_days.sql');
    const latest=names.at(-1);
    await upgradeDb`CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum char(64) NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`;
    for(const name of names.slice(0,-1)){
      const contents=await readFile(new URL(name,directory),'utf8');
      const checksum=createHash('sha256').update(contents).digest('hex');
      await upgradeDb.begin(async tx=>{await tx.unsafe(contents);await tx`INSERT INTO schema_migrations(name,checksum) VALUES (${name},${checksum})`});
    }
    assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM schema_migrations`)[0].count,names.length-1);
    const upgraded=await migrateDatabase(upgradeDb);
    assert.equal(upgraded.length,names.length);assert.equal(upgraded.at(-1).name,latest);
    assert.equal((await upgradeDb`SELECT count(*)::int AS count FROM schema_migrations WHERE name=${latest}`)[0].count,1,'the new migration is applied exactly once');
    assert.equal((await upgradeDb`SELECT grace_days FROM economic_settings WHERE singleton=true`)[0].grace_days,5);
    const repeated=await migrateDatabase(upgradeDb);
    assert.deepEqual(repeated.map(row=>[row.name,row.checksum.trim()]),upgraded.map(row=>[row.name,row.checksum.trim()]));
  }finally{
    if(upgradeDb)await upgradeDb.end();
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);await admin.end();
  }
});

test('2J-078B identity stays person-scoped and 2J-089 summary contract is strict and disabled by default', async () => {
  const personId = randomUUID();
  assert.equal(platformSubjectSchema.safeParse({ v: 1, personId, clientId: randomUUID(), capabilities: ['client'], status: 'active' }).success, true);
  assert.equal(platformSubjectSchema.safeParse({ v: 1, personId, clientId: randomUUID(), staffId: randomUUID(), capabilities: ['client','staff'], status: 'active', centralClientId: randomUUID() }).success, false);
  assert.equal(linkProposalSchema.safeParse({ v: 1, personId, candidate: { trainingUserId: 'opaque-user-7' }, method: 'explicit_admin', requestId: randomUUID() }).success, true);
  assert.equal(linkProposalSchema.safeParse({ v: 1, personId, candidate: { trainingUserId: 'opaque-user-7' }, method: 'user_confirmed', requestId: randomUUID() }).success, false);
  assert.equal(linkProposalSchema.safeParse({ v: 1, personId, candidate: { trainingUserId: 'opaque-user-7' }, method: 'migration', requestId: randomUUID() }).success, false);
  assert.equal(linkProposalSchema.safeParse({ v: 1, personId, candidate: { trainingUserId: 'opaque-user-7', centralClientId: randomUUID() }, method: 'explicit_admin', requestId: randomUUID() }).success, false);
  assert.equal(accessGrantSchema.safeParse({ v: 1, personId, trainingAccess: 'blocked' }).success, true);
  const trainingUserId = 'training-user-7';
  const contractFixture = JSON.parse(await readFile(new URL('../../../contracts/2J-089-training-summary-v1.json', import.meta.url), 'utf8'));
  assert.equal(trainingSummarySchema.safeParse(contractFixture).success, true);
  const summary = { ...contractFixture, trainingUserId };
  assert.equal(trainingSummarySchema.safeParse(summary).success, true);
  assert.equal(trainingSummarySchema.safeParse({ ...summary, currentProgram: { ...summary.currentProgram, privateNotes: 'secret' } }).success, false);
  assert.equal(trainingSummarySchema.safeParse({ ...summary, recentActivity: { ...summary.recentActivity, lastTrainingAt: '2026-02-30' } }).success, false);
  let calls = 0;
  assert.deepEqual(await createTrainingAdapter({ fetcher: async () => { calls += 1; throw new Error('must not call'); } }).getSummary(trainingUserId), { status: 'disabled' });
  assert.equal(calls, 0);
  const adapter = createTrainingAdapter({ enabled: true, baseUrl: 'https://training.example.test', allowedOrigins: ['https://training.example.test'], keyId: 'test-v1', fetcher: async (url, init) => { calls += 1; assert.equal(String(url), 'https://training.example.test/api/platform/v1/training-summary'); assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); assert.deepEqual(JSON.parse(init.body), { v: 1, trainingUserId }); return new Response(JSON.stringify(summary), { status: 200, headers: { 'content-type': 'application/json' } }); }, signRequest: async (canonical, signal) => { assert.match(canonical, /2J-SERVICE-AUTH-V1/); assert.equal(signal.aborted, false); return 'A'.repeat(43); } });
  assert.equal((await adapter.getSummary(trainingUserId)).status, 'available');
  assert.equal(calls, 1);
  const failSoft = createTrainingAdapter({ enabled: true, baseUrl: 'https://training.example.test', allowedOrigins: ['https://training.example.test'], keyId: 'test-v1', fetcher: async () => new Response('bad', { status: 503 }), signRequest: async () => 'A'.repeat(43) });
  assert.deepEqual(await failSoft.getSummary(trainingUserId), { status: 'unavailable' });
});

test('Training service auth canonicalization signs request identity, method, path and raw body digest', async () => {
  const request = { keyId: 'test-k1', timestamp: '2026-10-10T12:00:00.000Z', requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', method: 'POST', path: '/api/platform/v1/persons/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/link', body: Buffer.from('{"v":1}') };
  const canonical = canonicalizeTrainingServiceRequest(request);
  assert.equal(canonical.split('\n').length, 7);
  assert.match(canonical, /test-k1/); assert.match(canonical, /POST/); assert.match(canonical, /\/link/);
  assert.throws(() => canonicalizeTrainingServiceRequest({ ...request, path: '/api/../secret' }), /path traversal|canonical request target/);
  assert.throws(() => canonicalizeTrainingServiceRequest({ ...request, timestamp: '2026-10-10T12:00:00Z' }), /canonical UTC/);
  assert.throws(() => canonicalizeTrainingServiceRequest({ ...request, path: '/api/%2e%2e/secret' }), /path traversal|canonical request target/);
  assert.throws(() => canonicalizeTrainingServiceRequest({ ...request, path: '/api/%2fsecret' }), /path traversal/);
  assert.throws(() => canonicalizeTrainingServiceRequest({ ...request, path: '/api/\nsecret' }), /invalid request target/);
  const headers = await buildTrainingServiceAuthHeaders(request, async (value, signal) => { assert.equal(value, canonical); assert.equal(signal.aborted, false); return 'S'.repeat(43); }, new AbortController().signal);
  assert.deepEqual(Object.keys(headers).sort(), ['x-2j-key-id','x-2j-request-id','x-2j-signature','x-2j-timestamp'].sort());
});

test('Training adapter fails closed for invalid targets, redirects, bad content, size, timeout, malformed and non-strict responses', async () => {
  const trainingUserId = 'opaque-training-user', valid = { v: 1, trainingUserId, trainingStatus: 'active', asOf: new Date().toISOString() };
  const base = { enabled: true, baseUrl: 'https://training.example.test', allowedOrigins: ['https://training.example.test'], keyId: 'test-v1', signRequest: async () => 'A'.repeat(43) };
  let calls = 0;
  const spy = createTrainingAdapter({ ...base, fetcher: async () => { calls += 1; return new Response(JSON.stringify(valid), { headers: { 'content-type': 'application/json' } }); } });
  assert.deepEqual(await spy.getSummary('bad\u0000id'), { status: 'unavailable' });
  assert.equal(calls, 0, 'reject malformed Training ID before fetch');
  const notAllowed = createTrainingAdapter({ ...base, baseUrl: 'https://other.example.test', fetcher: async () => { calls += 1; throw new Error('must not fetch'); } });
  assert.deepEqual(await notAllowed.getSummary(trainingUserId), { status: 'unavailable' }); assert.equal(calls, 0);
  const noTls = createTrainingAdapter({ ...base, baseUrl: 'http://training.example.test', allowedOrigins: ['http://training.example.test'], fetcher: async () => { calls += 1; throw new Error('must not fetch'); } });
  assert.deepEqual(await noTls.getSummary(trainingUserId), { status: 'unavailable' }); assert.equal(calls, 0);
  const cases = [
    ['redirect', async (_url, init) => { assert.equal(init.redirect, 'error'); return new Response('', { status: 302, headers: { location: 'https://attacker.example' } }); }],
    ['wrong content type', async () => new Response(JSON.stringify(valid), { headers: { 'content-type': 'text/plain' } })],
    ['oversized body', async () => new Response('x'.repeat(4000), { headers: { 'content-type': 'application/json', 'content-length': '4000' } })],
    ['streamed oversized body', async () => new Response('x'.repeat(4000), { headers: { 'content-type': 'application/json' } })],
    ['malformed JSON', async () => new Response('{', { headers: { 'content-type': 'application/json' } })],
    ['wrong Training identity', async () => new Response(JSON.stringify({ ...valid, trainingUserId: 'different-user' }), { headers: { 'content-type': 'application/json' } })],
    ['extra fields', async () => new Response(JSON.stringify({ ...valid, trainingUserId: 'must-not-leak' }), { headers: { 'content-type': 'application/json' } })],
  ];
  for (const [name, fetcher] of cases) assert.deepEqual(await createTrainingAdapter({ ...base, maxResponseBytes: 2048, fetcher }).getSummary(trainingUserId), { status: 'unavailable' }, name);
  const oversized = createTrainingAdapter({ ...base, maxResponseBytes: 32, fetcher: cases[2][1] });
  assert.deepEqual(await oversized.getSummary(trainingUserId), { status: 'unavailable' }, 'oversized response is bounded before parsing');
  const streamOversized = createTrainingAdapter({ ...base, maxResponseBytes: 32, fetcher: cases[3][1] });
  assert.deepEqual(await streamOversized.getSummary(trainingUserId), { status: 'unavailable' }, 'stream size is bounded when Content-Length is absent');
  const signerFailure = createTrainingAdapter({ ...base, signRequest: async () => { throw new Error('test signer failure'); }, fetcher: async () => { calls += 1; throw new Error('must not fetch'); } });
  assert.deepEqual(await signerFailure.getSummary(trainingUserId), { status: 'unavailable' }); assert.equal(calls, 0);
  let signerSignal;
  const timed = createTrainingAdapter({ ...base, timeoutMs: 10, signRequest: async (_canonical, signal) => { signerSignal = signal; await new Promise((resolve) => setTimeout(resolve, 100)); return 'A'.repeat(43); }, fetcher: async () => { calls += 1; throw new Error('must timeout before fetch'); } });
  assert.deepEqual(await timed.getSummary(trainingUserId), { status: 'unavailable' });
  assert.equal(signerSignal.aborted, true); assert.equal(calls, 0, 'the deadline covers signer execution before fetch');
  let fetchSignal;
  const fetchTimed = createTrainingAdapter({ ...base, timeoutMs: 10, fetcher: async (_url, init) => { fetchSignal = init.signal; return new Promise((resolve) => setTimeout(() => resolve(new Response(JSON.stringify(valid), { headers: { 'content-type': 'application/json' } })), 100)); } });
  assert.deepEqual(await fetchTimed.getSummary(trainingUserId), { status: 'unavailable' }); assert.equal(fetchSignal.aborted, true, 'the deadline covers fetch execution');
});

test('identity API keeps Training linking disabled by default and gates synthetic local links independently', async () => {
  const client = await createClientRequest(clientsAdminApp, { firstName: 'Person', lastName: `Identity ${randomUUID()}` });
  assert.equal(client.statusCode, 201);
  const clientId = client.json().id;
  const created = await clientsAdminApp.inject({ method: 'POST', url: '/api/platform/v1/persons', payload: { clientId } });
  assert.equal(created.statusCode, 201, created.body);
  const person = created.json();
  assert.equal(person.v, 1); assert.equal(person.clientId, clientId); assert.deepEqual(person.capabilities, ['client']);
  assert.equal(Object.hasOwn(person, 'email'), false);
  assert.equal((await clientsAdminApp.inject({ method: 'POST', url: '/api/platform/v1/persons', payload: { clientId } })).statusCode, 409, 'a client facet cannot belong to two people');
  assert.equal((await clientsTrainerApp.inject({ method: 'GET', url: `/api/platform/v1/persons/${person.personId}` })).statusCode, 403);
  assert.equal((await anonymousApp.inject({ method: 'GET', url: `/api/platform/v1/persons/${person.personId}` })).statusCode, 401);
  assert.equal((await clientsTrainerApp.inject({ method: 'POST', url: '/api/platform/v1/persons', payload: { clientId } })).statusCode, 403);
  assert.equal((await clientsTrainerApp.inject({ method: 'POST', url: `/api/platform/v1/persons/${person.personId}/facets`, payload: { clientId } })).statusCode, 403);
  assert.equal((await clientsTrainerApp.inject({ method: 'POST', url: `/api/platform/v1/persons/${person.personId}/training-link`, payload: { requestId: randomUUID(), trainingUserId: 'opaque' } })).statusCode, 403);
  assert.equal((await clientsTrainerApp.inject({ method: 'DELETE', url: `/api/platform/v1/persons/${person.personId}/training-link` })).statusCode, 403);
  const disabledRequestId = randomUUID();
  const disabledCreate = await clientsAdminApp.inject({ method: 'POST', url: `/api/platform/v1/persons/${person.personId}/training-link`, payload: { requestId: disabledRequestId, trainingUserId: 'disabled-create' } });
  const disabledRevoke = await clientsAdminApp.inject({ method: 'DELETE', url: `/api/platform/v1/persons/${person.personId}/training-link` });
  assert.equal(disabledCreate.statusCode, 423); assert.equal(disabledCreate.json().error, 'training_linking_disabled');
  assert.equal(disabledRevoke.statusCode, 423); assert.equal(disabledRevoke.json().error, 'training_linking_disabled');
  assert.equal((await sql`SELECT count(*)::int AS count FROM training_account_links WHERE request_id=${disabledRequestId}`).at(0).count, 0, 'disabled synthetic creation writes no link');
  const deniedActors = [trainingLinkingTrainerApp, trainingLinkingReceptionApp, trainingLinkingAccountantApp];
  for (const deniedApp of deniedActors) {
    const post = await deniedApp.inject({ method: 'POST', url: `/api/platform/v1/persons/${person.personId}/training-link`, payload: { requestId: randomUUID(), trainingUserId: `denied-${randomUUID()}` } });
    const del = await deniedApp.inject({ method: 'DELETE', url: `/api/platform/v1/persons/${person.personId}/training-link` });
    assert.equal(post.statusCode, 403); assert.equal(del.statusCode, 403);
  }
  const loaded = await clientsAdminApp.inject({ method: 'GET', url: `/api/platform/v1/persons/${person.personId}` });
  assert.equal(loaded.statusCode, 200); assert.equal(loaded.json().personId, person.personId);
  const requestId = randomUUID(); const trainingUserId = `training-${randomUUID()}`;
  const linkPayload = { requestId, trainingUserId };
  const concurrentLinks = await Promise.all([1, 2].map(() => trainingLinkingAdminApp.inject({ method: 'POST', url: `/api/platform/v1/persons/${person.personId}/training-link`, payload: linkPayload })));
  assert.deepEqual(concurrentLinks.map((response) => response.statusCode).sort(), [200, 201]);
  const link = concurrentLinks.find((response) => response.statusCode === 201); const replay = concurrentLinks.find((response) => response.statusCode === 200);
  assert.ok(link); assert.ok(replay); assert.equal(replay.json().linkId, link.json().linkId);
  const conflict = await trainingLinkingAdminApp.inject({ method: 'POST', url: `/api/platform/v1/persons/${person.personId}/training-link`, payload: { ...linkPayload, trainingUserId: `different-${randomUUID()}` } });
  assert.equal(conflict.statusCode, 409); assert.equal(conflict.json().error, 'idempotency_conflict');
  const otherClient = await createClientRequest(clientsAdminApp, { firstName: 'Another', lastName: `Person ${randomUUID()}` });
  const otherPerson = await clientsAdminApp.inject({ method: 'POST', url: '/api/platform/v1/persons', payload: { clientId: otherClient.json().id } });
  assert.equal(otherPerson.statusCode, 201);
  for (const method of ['user_confirmed', 'migration']) {
    await assert.rejects(sql`INSERT INTO training_account_links(request_id,person_id,training_user_id,method,created_by,updated_by) VALUES (${randomUUID()},${otherPerson.json().personId},${`future-${method}-${randomUUID()}`},${method},'qa-admin','qa-admin')`, { code: '23514' }, `database must reject unproven method ${method}`);
  }
  await assert.rejects(sql`INSERT INTO training_account_links(request_id,person_id,training_user_id,method,created_by,updated_by) VALUES (${randomUUID()},${otherPerson.json().personId},${`user-${randomUUID()} `},'explicit_admin','qa-admin','qa-admin')`, { code: '23514' }, 'database must reject non-canonical trailing-space Training identifiers');
  const reusedTrainingUser = await trainingLinkingAdminApp.inject({ method: 'POST', url: `/api/platform/v1/persons/${otherPerson.json().personId}/training-link`, payload: { requestId: randomUUID(), trainingUserId } });
  assert.equal(reusedTrainingUser.statusCode, 409, 'a Training account cannot be active for two people');
  const caseVariantLink = await trainingLinkingAdminApp.inject({ method: 'POST', url: `/api/platform/v1/persons/${otherPerson.json().personId}/training-link`, payload: { requestId: randomUUID(), trainingUserId: trainingUserId.toUpperCase() } });
  assert.equal(caseVariantLink.statusCode, 201, 'Training user identifiers retain case-sensitive semantics');
  await assert.rejects(sql`UPDATE training_account_links SET training_user_id=${`changed-${randomUUID()}`} WHERE link_id=${link.json().linkId}`, { code: '55000' });
  await assert.rejects(sql`UPDATE training_account_links SET link_version=9 WHERE link_id=${link.json().linkId}`, { code: '55000' });
  await assert.rejects(sql`UPDATE training_account_links SET method='migration' WHERE link_id=${link.json().linkId}`, { code: '55000' }, 'method must remain immutable after insert');
  await assert.rejects(sql`UPDATE training_account_links SET status='revoked',revoked_at='2000-01-01T00:00:00Z',method='migration' WHERE link_id=${link.json().linkId}`, { code: '55000' }, 'method cannot be rewritten during revocation');
  const revocationProbeStartedAt = Date.now();
  let effectiveRevokedAt;
  await assert.rejects(sql.begin(async (tx) => {
    const rows = await tx`UPDATE training_account_links SET status='revoked',revoked_at='2000-01-01T00:00:00Z' WHERE link_id=${link.json().linkId} RETURNING revoked_at`;
    effectiveRevokedAt = new Date(rows[0].revoked_at).getTime();
    throw new Error('rollback timestamp probe');
  }), /rollback timestamp probe/);
  assert.ok(effectiveRevokedAt >= revocationProbeStartedAt - 10_000 && effectiveRevokedAt <= Date.now() + 10_000, 'the DB trigger must replace caller timestamp with transaction time');
  const revoked = await trainingLinkingAdminApp.inject({ method: 'DELETE', url: `/api/platform/v1/persons/${person.personId}/training-link` });
  assert.equal(revoked.statusCode, 200, revoked.body); assert.equal(revoked.json().status, 'revoked');
  assert.equal((await clientsAdminApp.inject({ method: 'GET', url: `/api/platform/v1/persons/${person.personId}` })).json().status, 'active', 'unlink revokes the Training link, not the stable person identity');
  const [revokedLink] = await sql`SELECT status,revoked_at FROM training_account_links WHERE person_id=${person.personId}`;
  assert.equal(revokedLink.status, 'revoked');
  const apiRevokedAt = new Date(revokedLink.revoked_at).getTime();
  assert.ok(apiRevokedAt >= Date.now() - 15_000 && apiRevokedAt <= Date.now() + 10_000, 'API revocation must persist a current database timestamp');
  assert.equal((await sql`SELECT method FROM training_account_links WHERE person_id=${person.personId}`).at(0).method, 'explicit_admin', 'the admin endpoint cannot assert a user confirmation it did not collect');
  assert.equal((await sql`SELECT count(*)::int AS count FROM platform_identity_audit_events WHERE person_id=${person.personId}`).at(0).count, 3);
  let providerCalls = 0;
  assert.deepEqual(await createTrainingAdapter({ fetcher: async () => { providerCalls += 1; throw new Error('provider must remain disabled'); } }).getSummary(person.personId), { status: 'disabled' });
  assert.equal(providerCalls, 0, 'enabling the local synthetic-link gate does not enable the independent Training adapter');
  await assert.rejects(sql`UPDATE platform_persons SET id=${randomUUID()} WHERE id=${person.personId}`, { code: '55000' });
  await assert.rejects(sql`DELETE FROM platform_identity_audit_events WHERE person_id=${person.personId}`, { code: '55000' });
});

test('auth subject bindings are explicit, Admin-only, opaque, unique and revocable without role or facet inference', async () => {
  async function person(label) {
    const client = await createClientRequest(clientsAdminApp, { firstName: 'Subject', lastName: `${label} ${randomUUID()}` });
    const created = await clientsAdminApp.inject({ method: 'POST', url: '/api/platform/v1/persons', payload: { clientId: client.json().id } });
    assert.equal(created.statusCode, 201, created.body); return created.json();
  }
  const first = await person('First'), second = await person('Second');
  const provider = 'fixture-central-auth', authSubject = `opaque-subject-${randomUUID()}`;
  const created = await clientsAdminApp.inject({ method: 'POST', url: `/api/platform/v1/persons/${first.personId}/auth-subjects`, payload: { provider, authSubject, providerVersion: 1 } });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().personId, first.personId); assert.equal(created.json().status, 'active');
  assert.equal(Object.hasOwn(created.json(), 'authSubject'), false, 'the management API does not echo the opaque subject');
  const linkId = created.json().id;
  assert.deepEqual((await clientsAdminApp.inject({ method: 'GET', url: `/api/platform/v1/persons/${first.personId}` })).json().capabilities, ['client'], 'auth binding does not derive roles or change Platform facets');
  assert.ok(Math.abs(Date.now() - new Date(created.json().verifiedAt).getTime()) < 15_000, 'verification timestamp is generated by Platform');
  assert.equal((await sql`SELECT action FROM platform_identity_audit_events WHERE resource_id=${linkId}`).at(0).action, 'person.auth_subject_linked');
  await assert.rejects(sql`UPDATE platform_person_auth_subjects SET auth_subject=${`changed-${randomUUID()}`} WHERE id=${linkId}`, { code: '55000' }, 'auth subject binding identity is immutable');
  assert.equal((await clientsAdminApp.inject({ method: 'POST', url: `/api/platform/v1/persons/${second.personId}/auth-subjects`, payload: { provider, authSubject, providerVersion: 1 } })).statusCode, 409, 'one provider subject cannot be assigned to another person');
  assert.equal((await clientsAdminApp.inject({ method: 'POST', url: `/api/platform/v1/persons/${first.personId}/auth-subjects`, payload: { provider, authSubject: `user-${randomUUID()}@example.test`, providerVersion: 1 } })).statusCode, 400, 'email-shaped identifiers are not inferred as stable auth subjects');
  for (const deniedApp of [anonymousApp, clientsTrainerApp, clientsReceptionApp, clientsAccountantApp]) {
    const response = await deniedApp.inject({ method: 'POST', url: `/api/platform/v1/persons/${second.personId}/auth-subjects`, headers: { 'x-2j-role': 'admin' }, payload: { provider, authSubject: `denied-${randomUUID()}` } });
    assert.ok([401,403].includes(response.statusCode), `auth subject mapping denied: ${response.statusCode}`);
  }
  const revoked = await clientsAdminApp.inject({ method: 'DELETE', url: `/api/platform/v1/persons/${first.personId}/auth-subjects/${linkId}` });
  assert.equal(revoked.statusCode, 200, revoked.body); assert.equal(revoked.json().status, 'revoked');
  assert.ok(Math.abs(Date.now() - new Date(revoked.json().revokedAt).getTime()) < 15_000, 'revocation time is database generated');
  assert.equal((await sql`SELECT action FROM platform_identity_audit_events WHERE resource_id=${linkId} ORDER BY occurred_at DESC`).at(0).action, 'person.auth_subject_revoked');
  await assert.rejects(sql`DELETE FROM platform_person_auth_subjects WHERE id=${linkId}`, { code: '55000' });
  const afterRevocation = await clientsAdminApp.inject({ method: 'POST', url: `/api/platform/v1/persons/${second.personId}/auth-subjects`, payload: { provider, authSubject, providerVersion: 1 } });
  assert.equal(afterRevocation.statusCode, 409, 'revoked subject history cannot be reassigned');
  assert.equal((await clientsAdminApp.inject({ method: 'POST', url: `/api/platform/v1/persons/${second.personId}/auth-subjects`, payload: { provider: 'UPPERCASE', authSubject: `opaque-${randomUUID()}` } })).statusCode, 400);
});

test('link challenge is one-time, person-resolved, short-lived, replay-safe and never persists its raw value', async () => {
  async function createBoundPerson(label) {
    const client = await createClientRequest(clientsAdminApp, { firstName: 'Ceremony', lastName: `${label} ${randomUUID()}` });
    const person = await clientsAdminApp.inject({ method: 'POST', url: '/api/platform/v1/persons', payload: { clientId: client.json().id } });
    const provider = 'fixture-central-auth', authSubject = `subject-${randomUUID()}`;
    const binding = await clientsAdminApp.inject({ method: 'POST', url: `/api/platform/v1/persons/${person.json().personId}/auth-subjects`, payload: { provider, authSubject, providerVersion: 1 } });
    assert.equal(binding.statusCode, 201, binding.body);
    return { person: person.json(), auth: { personId: person.json().personId, provider, providerVersion: 1, authSubject }, binding: binding.json() };
  }
  const one = await createBoundPerson('One'), two = await createBoundPerson('Two');
  const off = await anonymousApp.inject({ method: 'POST', url: '/api/platform/v1/training-link-transactions', payload: { requestId: randomUUID() } });
  assert.equal(off.statusCode, 423, 'verified link gate defaults OFF');
  const serviceOnly = await trainingServiceCallsOnlyApp.inject({ method: 'POST', url: '/api/platform/v1/training-link-transactions', payload: { requestId: randomUUID() } });
  assert.equal(serviceOnly.statusCode, 423, 'service call flag alone cannot enable verified linking');
  resolvedTrainingAuth = one.auth;
  const requestId = randomUUID();
  const extraPersonId = await trainingVerifiedLinkingApp.inject({ method: 'POST', url: '/api/platform/v1/training-link-transactions', payload: { requestId, personId: two.person.personId } });
  assert.equal(extraPersonId.statusCode, 400, 'caller cannot nominate an arbitrary personId');
  const created = await trainingVerifiedLinkingApp.inject({ method: 'POST', url: '/api/platform/v1/training-link-transactions', payload: { requestId } });
  assert.equal(created.statusCode, 201, created.body);
  const result = created.json();
  assert.equal(result.v, 1); assert.equal('authSubjectLinkId' in result.transaction, false); assert.equal('requestHash' in result.transaction, false);
  assert.equal(result.status, 'created'); assert.equal(result.audience, '2j-training-account-link'); assert.equal(result.purpose, 'training-account-link');
  assert.equal(Buffer.from(result.challenge, 'base64url').length, 32, 'challenge has 256 bits of entropy');
  assert.equal(TRAINING_LINK_TTL_MS, 5 * 60 * 1000);
  const stored = (await sql`SELECT * FROM training_link_transactions WHERE transaction_id=${result.transaction.transactionId}`).at(0);
  assert.notEqual(stored.nonce_hash.trim(), result.challenge); assert.equal(stored.nonce_hash.trim(), createHash('sha256').update(result.challenge).digest('hex'));
  assert.equal(stored.person_id, one.person.personId); assert.equal(stored.state, 'pending'); assert.equal(stored.verified_training_user_id, null, 'pending challenge has no Training subject');
  await assert.rejects(sql`UPDATE training_link_transactions SET state='verified',version=version+1 WHERE transaction_id=${result.transaction.transactionId}`, { code: '23514' }, 'database blocks verified state without a proven Training subject');
  assert.ok(new Date(stored.expires_at).getTime() - new Date(stored.created_at).getTime() <= TRAINING_LINK_TTL_MS + 5);
  assert.equal(JSON.stringify((await sql`SELECT details FROM platform_identity_audit_events WHERE resource_id=${result.transaction.transactionId}`)).includes(result.challenge), false);
  await assert.rejects(sql`INSERT INTO training_link_transactions(person_id,auth_subject_link_id,request_id,request_hash,nonce_hash,audience,purpose,state,verified_at,expires_at) VALUES (${one.person.personId},${one.binding.id},${randomUUID()},${createHash('sha256').update(randomUUID()).digest('hex')},${createHash('sha256').update(randomUUID()).digest('hex')},'2j-training-account-link','training-account-link','verified',now(),now()+interval '1 minute')`, { code: '23514' }, 'database permits transaction inserts only in pending state');
  const replay = await trainingVerifiedLinkingApp.inject({ method: 'POST', url: '/api/platform/v1/training-link-transactions', payload: { requestId } });
  assert.equal(replay.statusCode, 200); assert.equal(replay.json().challenge, null, 'raw challenge is returned once and never recoverable on replay');
  assert.equal((await sql`SELECT count(*)::int AS count FROM training_link_transactions WHERE request_id=${requestId}`).at(0).count, 1);
  const concurrentRequestId = randomUUID();
  const concurrentCreates = await Promise.all([1,2].map(() => trainingVerifiedLinkingApp.inject({ method: 'POST', url: '/api/platform/v1/training-link-transactions', payload: { requestId: concurrentRequestId } })));
  assert.deepEqual(concurrentCreates.map((response) => response.statusCode).sort(), [200,201]);
  assert.equal(concurrentCreates[0].json().transaction.transactionId, concurrentCreates[1].json().transaction.transactionId);
  assert.equal((await sql`SELECT count(*)::int AS count FROM training_link_transactions WHERE request_id=${concurrentRequestId}`).at(0).count, 1);
  await trainingVerifiedLinkingApp.inject({ method: 'DELETE', url: `/api/platform/v1/training-link-transactions/${concurrentCreates[0].json().transaction.transactionId}` });
  resolvedTrainingAuth = two.auth;
  const conflict = await trainingVerifiedLinkingApp.inject({ method: 'POST', url: '/api/platform/v1/training-link-transactions', payload: { requestId } });
  assert.equal(conflict.statusCode, 409, 'the same requestId cannot be rebound to a different authenticated person');
  const wrongPersonCancel = await trainingVerifiedLinkingApp.inject({ method: 'DELETE', url: `/api/platform/v1/training-link-transactions/${result.transaction.transactionId}` });
  assert.equal(wrongPersonCancel.statusCode, 404);
  resolvedTrainingAuth = one.auth;
  const cancelled = await trainingVerifiedLinkingApp.inject({ method: 'DELETE', url: `/api/platform/v1/training-link-transactions/${result.transaction.transactionId}` });
  assert.equal(cancelled.statusCode, 200); assert.equal(cancelled.json().status, 'cancelled');
  assert.equal((await sql`SELECT verified_training_user_id FROM training_link_transactions WHERE transaction_id=${result.transaction.transactionId}`).at(0).verified_training_user_id, null, 'cancelling before proof leaves the subject empty');
  const replayCancel = await trainingVerifiedLinkingApp.inject({ method: 'DELETE', url: `/api/platform/v1/training-link-transactions/${result.transaction.transactionId}` });
  assert.equal(replayCancel.statusCode, 200); assert.equal(replayCancel.json().status, 'cancelled');
  await assert.rejects(sql`UPDATE training_link_transactions SET state='verified',version=version+1 WHERE transaction_id=${result.transaction.transactionId}`, { code: '55000' }, 'cancelled is terminal and cannot transition backwards');
  assert.equal((await sql`SELECT count(*)::int AS count FROM training_account_links WHERE person_id=${one.person.personId}`).at(0).count, 0, 'a challenge never creates a canonical or active Training link');
  assert.equal((await sql`SELECT action FROM platform_identity_audit_events WHERE resource_id=${result.transaction.transactionId} ORDER BY occurred_at,id`).map((row) => row.action).join(','), 'training.link_transaction_created,training.link_transaction_cancelled');
});

test('link transaction verification and consume are single-use under races, gated, and fail closed on revoked identity', async () => {
  async function createBoundPerson(label) {
    const client = await createClientRequest(clientsAdminApp, { firstName: 'Race', lastName: `${label} ${randomUUID()}` });
    const person = await clientsAdminApp.inject({ method: 'POST', url: '/api/platform/v1/persons', payload: { clientId: client.json().id } });
    const auth = { personId: person.json().personId, provider: 'fixture-central-auth', providerVersion: 1, authSubject: `race-subject-${randomUUID()}` };
    const binding = await clientsAdminApp.inject({ method: 'POST', url: `/api/platform/v1/persons/${auth.personId}/auth-subjects`, payload: { provider: auth.provider, providerVersion: auth.providerVersion, authSubject: auth.authSubject } });
    assert.equal(binding.statusCode, 201, binding.body); return { person: person.json(), auth, binding: binding.json() };
  }
  const subject = await createBoundPerson('Consume');
  resolvedTrainingAuth = subject.auth;
  const created = await trainingVerifiedLinkingApp.inject({ method: 'POST', url: '/api/platform/v1/training-link-transactions', payload: { requestId: randomUUID() } });
  assert.equal(created.statusCode, 201, created.body);
  const record = created.json();
  let verifierCalls = 0;
  const offService = createTrainingLinkTransactions(sql, { enabled: true, serviceCallsEnabled: false });
  assert.equal((await offService.verify({ transactionId: record.transaction.transactionId, challenge: record.challenge, assertion: {} }, async () => { verifierCalls++; return true; })).status, 'disabled');
  assert.equal(verifierCalls, 0, 'verified-link flag cannot invoke Training while service calls are OFF');
  const protocol = createTrainingLinkTransactions(sql, { enabled: true, serviceCallsEnabled: true });
  const otherClient = await createClientRequest(clientsAdminApp, { firstName: 'Other', lastName: `Proof ${randomUUID()}` });
  const otherPerson = await clientsAdminApp.inject({ method: 'POST', url: '/api/platform/v1/persons', payload: { clientId: otherClient.json().id } });
  const otherAuth = { personId: otherPerson.json().personId, provider: 'fixture-central-auth', providerVersion: 1, authSubject: `other-proof-${randomUUID()}` };
  const otherBinding = await clientsAdminApp.inject({ method: 'POST', url: `/api/platform/v1/persons/${otherAuth.personId}/auth-subjects`, payload: { provider: otherAuth.provider, providerVersion: 1, authSubject: otherAuth.authSubject } });
  assert.equal(otherBinding.statusCode, 201);
  assert.equal((await protocol.verify({ transactionId: record.transaction.transactionId, challenge: record.challenge, assertion: {}, auth: otherAuth }, async () => { verifierCalls++; return 'training-user-verified'; })).status, 'wrong_person');
  assert.equal((await protocol.verify({ transactionId: record.transaction.transactionId, challenge: 'wrong-challenge', assertion: {}, auth: subject.auth }, async () => { verifierCalls++; return 'training-user-verified'; })).status, 'invalid_challenge');
  assert.equal(verifierCalls, 0, 'challenge is compared before any remote verifier call');
  assert.equal((await sql`SELECT verified_training_user_id FROM training_link_transactions WHERE transaction_id=${record.transaction.transactionId}`).at(0).verified_training_user_id, null, 'wrong challenge cannot persist a Training subject');
  assert.equal((await protocol.verify({ transactionId: record.transaction.transactionId, challenge: record.challenge, assertion: {}, auth: subject.auth }, async () => '  ')).status, 'proof_rejected');
  assert.equal((await sql`SELECT verified_training_user_id FROM training_link_transactions WHERE transaction_id=${record.transaction.transactionId}`).at(0).verified_training_user_id, null, 'rejected proof cannot persist a Training subject');
  const competingTrainingIds = [`training-proof-A-${randomUUID()}`, `training-proof-B-${randomUUID()}`];
  const verifierContexts = [];
  const proofs = await Promise.all(competingTrainingIds.map((trainingUserId, index) => protocol.verify({ transactionId: record.transaction.transactionId, challenge: record.challenge, assertion: { fixture: true }, auth: subject.auth }, async (context) => { verifierContexts.push(context); verifierCalls++; await new Promise((resolve) => setTimeout(resolve, index === 0 ? 15 : 5)); return trainingUserId; })));
  assert.ok(verifierContexts.length > 0);
  for (const context of verifierContexts) assert.deepEqual(context, {
    assertion: { fixture: true },
    transactionId: record.transaction.transactionId,
    personId: subject.person.personId,
    audience: '2j-training-account-link',
    purpose: 'training-account-link',
    challengeDigest: createHash('sha256').update(record.challenge).digest('hex'),
  }, 'verifier receives the exact transaction, person, protocol purpose and challenge digest context');
  assert.ok(verifierContexts.every((context) => !JSON.stringify(context).includes(record.challenge)), 'raw challenge is never passed to the verifier context');
  assert.equal(proofs.filter((item) => item.status === 'verified').length, 1);
  assert.ok(proofs.some((item) => ['not_pending','replayed'].includes(item.status)), 'only one verifier can advance the state');
  assert.ok(verifierCalls >= 1 && verifierCalls <= 2, 'parallel attempts may reach proof verification, but only one state transition succeeds');
  const winnerIndex = proofs.findIndex((item) => item.status === 'verified');
  const verifiedRow = (await sql`SELECT state,verified_training_user_id FROM training_link_transactions WHERE transaction_id=${record.transaction.transactionId}`).at(0);
  assert.equal(verifiedRow.state, 'verified'); assert.equal(verifiedRow.verified_training_user_id, competingTrainingIds[winnerIndex], 'the durable subject belongs exactly to the winning verifier');
  await assert.rejects(sql`UPDATE training_link_transactions SET verified_training_user_id=${`replacement-${randomUUID()}`} WHERE transaction_id=${record.transaction.transactionId}`, { code: '55000' }, 'verified subject cannot be replaced');
  await assert.rejects(sql`UPDATE training_link_transactions SET verified_training_user_id=NULL WHERE transaction_id=${record.transaction.transactionId}`, { code: '55000' }, 'verified subject cannot be cleared');
  await assert.rejects(sql`UPDATE training_link_transactions SET verified_training_user_id=' padded-subject ' WHERE transaction_id=${record.transaction.transactionId}`, { code: '23514' }, 'database rejects whitespace-padded subjects');
  const consumes = await Promise.all([protocol.consume({ transactionId: record.transaction.transactionId }), protocol.consume({ transactionId: record.transaction.transactionId })]);
  assert.deepEqual(consumes.map((item) => item.status).sort(), ['consumed','not_consumable']);
  assert.equal((await protocol.verify({ transactionId: record.transaction.transactionId, challenge: record.challenge, assertion: {}, auth: subject.auth }, async () => 'training-user-verified')).status, 'not_pending', 'consumed challenge cannot replay');
  const consumedRow = (await sql`SELECT state,version,verified_training_user_id FROM training_link_transactions WHERE transaction_id=${record.transaction.transactionId}`).at(0);
  assert.equal(consumedRow.state, 'consumed'); assert.equal(consumedRow.verified_training_user_id, verifiedRow.verified_training_user_id, 'consume preserves the proven subject');
  assert.equal((await sql`SELECT count(*)::int AS count FROM training_account_links WHERE person_id=${subject.person.personId}`).at(0).count, 0, 'consumption still does not pretend remote ACK or activate a canonical link');
  const actions = (await sql`SELECT action FROM platform_identity_audit_events WHERE resource_id=${record.transaction.transactionId}`).map((row) => row.action);
  assert.deepEqual(new Set(actions), new Set(['training.link_transaction_created','training.link_transaction_verified','training.link_transaction_consumed']));
  const auditDetails = JSON.stringify(await sql`SELECT details FROM platform_identity_audit_events WHERE resource_id=${record.transaction.transactionId}`);
  for (const trainingUserId of competingTrainingIds) assert.equal(auditDetails.includes(trainingUserId), false, 'audit details omit verified Training subjects');

  const deadlineSubject = await createBoundPerson('VerifierDeadline');
  resolvedTrainingAuth = deadlineSubject.auth;
  const deadlineChallenge = await trainingVerifiedLinkingApp.inject({ method: 'POST', url: '/api/platform/v1/training-link-transactions', payload: { requestId: randomUUID() } });
  assert.equal(deadlineChallenge.statusCode, 201, deadlineChallenge.body);
  const deadlineProtocol = createTrainingLinkTransactions(sql, { enabled: true, serviceCallsEnabled: true, verifierTimeoutMs: 25 });
  let verifierSignalAborted = false;
  const deadlineResult = await deadlineProtocol.verify({ transactionId: deadlineChallenge.json().transaction.transactionId, challenge: deadlineChallenge.json().challenge, assertion: {}, auth: deadlineSubject.auth }, (_context, signal) => new Promise((_resolve) => {
    signal.addEventListener('abort', () => { verifierSignalAborted = true; }, { once: true });
  }));
  assert.equal(deadlineResult.status, 'verifier_timeout', 'a stalled remote proof verifier is bounded by its configured deadline');
  assert.equal(verifierSignalAborted, true, 'the verifier is told to stop when its deadline expires');
  const timedOutRow = (await sql`SELECT state,verified_training_user_id FROM training_link_transactions WHERE transaction_id=${deadlineChallenge.json().transaction.transactionId}`).at(0);
  assert.deepEqual(timedOutRow, { state: 'pending', verified_training_user_id: null }, 'timed-out proof does not advance state or persist a subject');

  const cancelSubject = await createBoundPerson('VerifiedCancel'); resolvedTrainingAuth = cancelSubject.auth;
  const cancelChallenge = await trainingVerifiedLinkingApp.inject({ method: 'POST', url: '/api/platform/v1/training-link-transactions', payload: { requestId: randomUUID() } });
  const cancelId = `training-cancel-${randomUUID()}`;
  assert.equal((await protocol.verify({ transactionId: cancelChallenge.json().transaction.transactionId, challenge: cancelChallenge.json().challenge, assertion: {}, auth: cancelSubject.auth }, async () => cancelId)).status, 'verified');
  const cancelledVerified = await trainingVerifiedLinkingApp.inject({ method: 'DELETE', url: `/api/platform/v1/training-link-transactions/${cancelChallenge.json().transaction.transactionId}` });
  assert.equal(cancelledVerified.statusCode, 200); assert.equal(cancelledVerified.json().status, 'cancelled');
  assert.equal((await sql`SELECT state,verified_training_user_id FROM training_link_transactions WHERE transaction_id=${cancelChallenge.json().transaction.transactionId}`).at(0).verified_training_user_id, cancelId, 'verified subject survives cancellation');

  const revokedSubject = await createBoundPerson('Revoked');
  resolvedTrainingAuth = revokedSubject.auth;
  const pending = await trainingVerifiedLinkingApp.inject({ method: 'POST', url: '/api/platform/v1/training-link-transactions', payload: { requestId: randomUUID() } });
  assert.equal(pending.statusCode, 201);
  await clientsAdminApp.inject({ method: 'DELETE', url: `/api/platform/v1/persons/${revokedSubject.person.personId}/auth-subjects/${revokedSubject.binding.id}` });
  resolvedTrainingAuth = revokedSubject.auth;
  const cannotCreate = await trainingVerifiedLinkingApp.inject({ method: 'POST', url: '/api/platform/v1/training-link-transactions', payload: { requestId: randomUUID() } });
  assert.equal(cannotCreate.statusCode, 403, 'revoked auth subject cannot create a challenge');
  const cannotCancel = await trainingVerifiedLinkingApp.inject({ method: 'DELETE', url: `/api/platform/v1/training-link-transactions/${pending.json().transaction.transactionId}` });
  assert.equal(cannotCancel.statusCode, 403, 'revoked auth subject cannot continue its pending transaction');
  const revokedVerifier = createTrainingLinkTransactions(sql, { enabled: true, serviceCallsEnabled: true });
  assert.equal((await revokedVerifier.verify({ transactionId: pending.json().transaction.transactionId, challenge: pending.json().challenge, assertion: {}, auth: revokedSubject.auth }, async () => 'training-user')).status, 'identity_unavailable');
});

test('auth subject resolver and database reject inactive people and unbound subjects', async () => {
  const client = await createClientRequest(clientsAdminApp, { firstName: 'Inactive', lastName: `Subject ${randomUUID()}` });
  const person = await clientsAdminApp.inject({ method: 'POST', url: '/api/platform/v1/persons', payload: { clientId: client.json().id } });
  const auth = { personId: person.json().personId, provider: 'fixture-central-auth', providerVersion: 1, authSubject: `unlinked-${randomUUID()}` };
  resolvedTrainingAuth = auth;
  const unbound = await trainingVerifiedLinkingApp.inject({ method: 'POST', url: '/api/platform/v1/training-link-transactions', payload: { requestId: randomUUID() } });
  assert.equal(unbound.statusCode, 403);
  const [personRow] = await sql`UPDATE platform_persons SET status='revoked' WHERE id=${auth.personId} RETURNING id`;
  assert.equal(personRow.id, auth.personId);
  const service = createTrainingLinkTransactions(sql, { enabled: true });
  assert.equal((await service.create({ ...auth, requestId: randomUUID() })).status, 'identity_unavailable');
  await assert.rejects(sql`INSERT INTO platform_person_auth_subjects(person_id,provider,auth_subject,created_by) VALUES (${auth.personId},${auth.provider},${auth.authSubject},'qa-admin')`, { code: '23514' }, 'database rejects adding auth identities to inactive persons');
});

test('078D shared service-auth golden vector matches Platform canonical bytes and signature', () => {
  const keyId = 'platform-fixture-a', secret = Buffer.alloc(32, 0x42);
  const timestamp = '2026-10-10T12:00:00.000Z', requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const body = Buffer.from('{"v":1,"code":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","transactionId":"11111111-1111-4111-8111-111111111111","personId":"22222222-2222-4222-8222-222222222222","audience":"2j-training-account-link","purpose":"training-account-link","challengeDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}');
  const canonical = canonicalizeTrainingServiceRequest({ keyId, timestamp, requestId, method: 'POST', path: '/api/platform/v1/link-proofs/exchange', body });
  assert.equal(createHash('sha256').update(body).digest('hex'), '8473ddd28ddf57f9964b66dabac8ff0d4bda6a491e112be5f59633df088ca52a');
  assert.equal(canonical, [
    '2J-SERVICE-AUTH-V1', keyId, timestamp, requestId, 'POST', '/api/platform/v1/link-proofs/exchange',
    '8473ddd28ddf57f9964b66dabac8ff0d4bda6a491e112be5f59633df088ca52a',
  ].join('\n'));
  assert.equal(createHmac('sha256', secret).update(canonical).digest('base64url'), 'F6GYp70w6TrZtTCWb4Jcmv3T92UxMyxGpUl2A6oK9oY');
});

test('remote Training proof bridge signs exact bytes and persists only the verified subject without making a canonical link', async () => {
  const client = await createClientRequest(clientsAdminApp, { firstName: 'Bridge', lastName: `Success ${randomUUID()}` });
  const person = await clientsAdminApp.inject({ method: 'POST', url: '/api/platform/v1/persons', payload: { clientId: client.json().id } });
  const auth = { personId: person.json().personId, provider: 'fixture-central-auth', providerVersion: 1, authSubject: `bridge-${randomUUID()}` };
  const binding = await clientsAdminApp.inject({ method: 'POST', url: `/api/platform/v1/persons/${auth.personId}/auth-subjects`, payload: { provider: auth.provider, providerVersion: auth.providerVersion, authSubject: auth.authSubject } });
  assert.equal(binding.statusCode, 201, binding.body);
  resolvedTrainingAuth = auth;
  const challengeResponse = await trainingVerifiedLinkingApp.inject({ method: 'POST', url: '/api/platform/v1/training-link-transactions', payload: { requestId: randomUUID() } });
  assert.equal(challengeResponse.statusCode, 201, challengeResponse.body);
  const challenge = challengeResponse.json();
  const code = Buffer.alloc(32, 0x41).toString('base64url');
  const keyId = 'platform-fixture-a', secret = Buffer.alloc(32, 0x42);
  let captured;
  const receiver = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const raw = body.toString('utf8');
    const parsed = JSON.parse(raw);
    const signed = canonicalizeTrainingServiceRequest({ keyId: request.headers['x-2j-key-id'], timestamp: request.headers['x-2j-timestamp'], requestId: request.headers['x-2j-request-id'], method: request.method, path: request.url, body });
    const expectedSignature = createHmac('sha256', secret).update(signed).digest('base64url');
    captured = { method: request.method, path: request.url, raw, headers: request.headers, validSignature: request.headers['x-2j-signature'] === expectedSignature, parsed };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ v: 1, transactionId: parsed.transactionId, personId: parsed.personId, trainingUserId: 'training-verified-opaque-123', audience: parsed.audience, purpose: parsed.purpose, verifiedAt: new Date().toISOString() }));
  });
  await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  try {
    const address = receiver.address();
    const verifier = createRemoteTrainingLinkVerifier({
      trainingVerifiedLinkingEnabled: true, trainingServiceCallsEnabled: true,
      baseUrl: `http://127.0.0.1:${address.port}`, keyId, secret: secret.toString('base64url'),
      fetcher: globalThis.fetch, allowInsecureLoopbackForTests: true,
    });
    const protocol = createTrainingLinkTransactions(sql, { enabled: true, serviceCallsEnabled: true, verifier });
    const result = await protocol.verify({ transactionId: challenge.transaction.transactionId, challenge: challenge.challenge, assertion: { v: 1, code }, auth });
    assert.equal(result.status, 'verified');
    assert.equal(captured.method, 'POST');
    assert.equal(captured.path, '/api/platform/v1/link-proofs/exchange');
    assert.equal(captured.raw, JSON.stringify({ v: 1, code, transactionId: challenge.transaction.transactionId, personId: person.json().personId, audience: '2j-training-account-link', purpose: 'training-account-link', challengeDigest: createHash('sha256').update(challenge.challenge).digest('hex') }));
    assert.equal(captured.headers['x-2j-key-id'], keyId);
    assert.match(captured.headers['x-2j-timestamp'], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    assert.match(captured.headers['x-2j-request-id'], /^[0-9a-f-]{36}$/);
    assert.notEqual(captured.headers['x-2j-request-id'], challenge.transaction.transactionId, 'service replay ID is newly generated, not the transaction ID');
    assert.equal(captured.validSignature, true, 'the Training-compatible HMAC verifies against exact request bytes');
    assert.deepEqual(Object.keys(captured.parsed), ['v', 'code', 'transactionId', 'personId', 'audience', 'purpose', 'challengeDigest']);
    const saved = (await sql`SELECT state,verified_training_user_id FROM training_link_transactions WHERE transaction_id=${challenge.transaction.transactionId}`).at(0);
    assert.deepEqual(saved, { state: 'verified', verified_training_user_id: 'training-verified-opaque-123' });
    const audit = JSON.stringify(await sql`SELECT details FROM platform_identity_audit_events WHERE resource_id=${challenge.transaction.transactionId}`);
    assert.equal(audit.includes(code), false, 'raw proof code is absent from audit');
    assert.equal(audit.includes('training-verified-opaque-123'), false, 'verified Training ID is absent from audit details');
    assert.equal((await sql`SELECT count(*)::int AS count FROM training_account_links WHERE person_id=${person.json().personId}`).at(0).count, 0, 'remote verification does not create a canonical Training link');
  } finally { await new Promise((resolve) => receiver.close(resolve)); }
});

test('remote Training verifier rejects caller context overrides, bad responses and transport failures while the transaction stays pending', async () => {
  const client = await createClientRequest(clientsAdminApp, { firstName: 'Bridge', lastName: `Reject ${randomUUID()}` });
  const person = await clientsAdminApp.inject({ method: 'POST', url: '/api/platform/v1/persons', payload: { clientId: client.json().id } });
  const auth = { personId: person.json().personId, provider: 'fixture-central-auth', providerVersion: 1, authSubject: `bridge-reject-${randomUUID()}` };
  const binding = await clientsAdminApp.inject({ method: 'POST', url: `/api/platform/v1/persons/${auth.personId}/auth-subjects`, payload: { provider: auth.provider, providerVersion: auth.providerVersion, authSubject: auth.authSubject } });
  assert.equal(binding.statusCode, 201, binding.body);
  resolvedTrainingAuth = auth;
  const challengeResponse = await trainingVerifiedLinkingApp.inject({ method: 'POST', url: '/api/platform/v1/training-link-transactions', payload: { requestId: randomUUID() } });
  assert.equal(challengeResponse.statusCode, 201, challengeResponse.body);
  const challenge = challengeResponse.json();
  const secret = Buffer.alloc(32, 0x42), code = Buffer.alloc(32, 0x41).toString('base64url');
  let mode = 'valid', calls = 0;
  const receiver = http.createServer(async (request, response) => {
    calls++;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (mode === 'slow') return;
    if (mode === 'wrong-code' && parsed.code !== code) { response.writeHead(404, { 'content-type': 'application/json' }); return response.end('{"error":"proof_not_found"}'); }
    const errorStatuses = { disabled: 423, auth: 401, notFound: 404, expired: 410, consumed: 409, mismatch: 409 };
    if (errorStatuses[mode]) { response.writeHead(errorStatuses[mode], { 'content-type': 'application/json' }); return response.end('{"error":"rejected"}'); }
    if (mode === 'redirect') { response.writeHead(302, { location: 'http://127.0.0.1/other' }); return response.end(); }
    if (mode === 'invalid-json') { response.writeHead(200, { 'content-type': 'application/json' }); return response.end('{'); }
    if (mode === 'wrong-type') { response.writeHead(200, { 'content-type': 'text/plain' }); return response.end('{}'); }
    if (mode === 'oversized') { response.writeHead(200, { 'content-type': 'application/json', 'content-length': '17000' }); return response.end(' '.repeat(17000)); }
    const reply = { v: 1, transactionId: parsed.transactionId, personId: parsed.personId, trainingUserId: 'training-verified-opaque-123', audience: parsed.audience, purpose: parsed.purpose, verifiedAt: new Date().toISOString() };
    if (mode === 'wrong-person') reply.personId = randomUUID();
    if (mode === 'wrong-transaction') reply.transactionId = randomUUID();
    if (mode === 'wrong-audience') reply.audience = 'other';
    if (mode === 'wrong-purpose') reply.purpose = 'other';
    if (mode === 'bad-user') reply.trainingUserId = ' padded ';
    if (mode === 'extra-field') reply.email = 'must-not-be-accepted@example.test';
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(reply));
  });
  await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  try {
    const baseUrl = `http://127.0.0.1:${receiver.address().port}`;
    const context = { transactionId: challenge.transaction.transactionId, personId: person.json().personId, audience: '2j-training-account-link', purpose: 'training-account-link', challengeDigest: createHash('sha256').update(challenge.challenge).digest('hex') };
    const verifierFor = (overrides = {}) => createRemoteTrainingLinkVerifier({
      trainingVerifiedLinkingEnabled: true, trainingServiceCallsEnabled: true,
      baseUrl, keyId: 'platform-fixture-a', secret: secret.toString('base64url'), fetcher: globalThis.fetch,
      allowInsecureLoopbackForTests: true, timeoutMs: 80, ...overrides,
    });
    const originalCalls = calls;
    const offFlags = await verifierFor({ trainingVerifiedLinkingEnabled: false })(
      { assertion: { v: 1, code }, transactionId: challenge.transaction.transactionId, personId: person.json().personId, audience: '2j-training-account-link', purpose: 'training-account-link', challengeDigest: createHash('sha256').update(challenge.challenge).digest('hex') }, new AbortController().signal);
    assert.equal(offFlags, null); assert.equal(calls, originalCalls, 'flags OFF make zero service calls');
    const missingConfig = await createRemoteTrainingLinkVerifier({ trainingVerifiedLinkingEnabled: true, trainingServiceCallsEnabled: true, fetcher: async () => { calls++; throw new Error('must not call'); } })(
      { assertion: { v: 1, code }, transactionId: challenge.transaction.transactionId, personId: person.json().personId, audience: '2j-training-account-link', purpose: 'training-account-link', challengeDigest: 'a'.repeat(64) }, new AbortController().signal);
    assert.equal(missingConfig, null); assert.equal(calls, originalCalls, 'missing config makes zero service calls');
    const invalidConfigs = [
      { baseUrl: 'https://user:password@training.example.test' }, { baseUrl: 'https://training.example.test/path' },
      { baseUrl: 'https://training.example.test/?query=1' }, { baseUrl: 'https://training.example.test/#fragment' },
      { baseUrl: 'http://training.example.test' }, { keyId: 'bad key id' }, { secret: 'short' },
    ];
    for (const invalid of invalidConfigs) {
      const rejected = await createRemoteTrainingLinkVerifier({
        trainingVerifiedLinkingEnabled: true, trainingServiceCallsEnabled: true,
        baseUrl, keyId: 'platform-fixture-a', secret: secret.toString('base64url'), fetcher: async () => { calls++; throw new Error('invalid config must not call'); },
        ...invalid,
      })({ assertion: { v: 1, code }, ...context }, new AbortController().signal);
      assert.equal(rejected, null, `${JSON.stringify(invalid)} fails closed`);
    }
    assert.equal(calls, originalCalls, 'malformed target/key configuration makes zero service calls');
    const protocol = createTrainingLinkTransactions(sql, { enabled: true, serviceCallsEnabled: true });
    const hostileAssertions = [
      { personId: randomUUID() }, { transactionId: randomUUID() }, { audience: 'other' },
      { purpose: 'other' }, { challengeDigest: 'f'.repeat(64) }, { trainingUserId: 'training-B' },
    ];
    for (const fields of hostileAssertions) assert.equal(await verifierFor()({ assertion: { v: 1, code, ...fields }, ...context }, new AbortController().signal), null, 'strict assertion schema rejects caller context fields');
    assert.equal(calls, originalCalls, 'malicious assertion never reaches Training');

    const failures = [
      ['wrong-code', { v: 1, code: 'B'.repeat(43) }],
      ['notFound', { v: 1, code }], ['expired', { v: 1, code }], ['consumed', { v: 1, code }], ['disabled', { v: 1, code }], ['auth', { v: 1, code }], ['mismatch', { v: 1, code }],
      ['wrong-person', { v: 1, code }], ['wrong-transaction', { v: 1, code }], ['wrong-audience', { v: 1, code }], ['wrong-purpose', { v: 1, code }],
      ['bad-user', { v: 1, code }], ['extra-field', { v: 1, code }], ['invalid-json', { v: 1, code }], ['wrong-type', { v: 1, code }], ['oversized', { v: 1, code }], ['redirect', { v: 1, code }],
    ];
    for (const [failure, assertion] of failures) {
      mode = failure;
      const result = await protocol.verify({ ...context, challenge: challenge.challenge, assertion, auth }, verifierFor());
      assert.equal(result.status, 'proof_rejected', `${failure} fails the proof closed`);
      const saved = (await sql`SELECT state,verified_training_user_id FROM training_link_transactions WHERE transaction_id=${context.transactionId}`).at(0);
      assert.deepEqual(saved, { state: 'pending', verified_training_user_id: null }, `${failure} leaves transaction pending with no subject`);
    }
    mode = 'slow';
    const timeoutResult = await protocol.verify({ ...context, challenge: challenge.challenge, assertion: { v: 1, code }, auth }, verifierFor({ timeoutMs: 20 }));
    assert.equal(timeoutResult.status, 'proof_rejected', 'remote timeout is mapped to the internal proof-rejected outcome');
    assert.deepEqual((await sql`SELECT state,verified_training_user_id FROM training_link_transactions WHERE transaction_id=${context.transactionId}`).at(0), { state: 'pending', verified_training_user_id: null });
  } finally { receiver.closeAllConnections?.(); await new Promise((resolve) => receiver.close(resolve)); }
});

test('expired link transactions cannot verify and transition once to expired with audit', async () => {
  const client = await createClientRequest(clientsAdminApp, { firstName: 'Expired', lastName: `Challenge ${randomUUID()}` });
  const person = await clientsAdminApp.inject({ method: 'POST', url: '/api/platform/v1/persons', payload: { clientId: client.json().id } });
  const auth = { personId: person.json().personId, provider: 'fixture-central-auth', providerVersion: 1, authSubject: `expired-${randomUUID()}` };
  const binding = await clientsAdminApp.inject({ method: 'POST', url: `/api/platform/v1/persons/${auth.personId}/auth-subjects`, payload: { provider: auth.provider, providerVersion: auth.providerVersion, authSubject: auth.authSubject } });
  assert.equal(binding.statusCode, 201, binding.body);
  await assert.rejects(sql`INSERT INTO training_link_transactions(person_id,auth_subject_link_id,request_id,request_hash,nonce_hash,verified_training_user_id,audience,purpose,expires_at) VALUES (${auth.personId},${binding.json().id},${randomUUID()},${createHash('sha256').update(randomUUID()).digest('hex')},${createHash('sha256').update(randomUUID()).digest('hex')},' padded-subject ','2j-training-account-link','training-account-link',now()+interval '1 minute')`, { code: '23514' }, 'database rejects a padded subject on insert');
  const req = randomUUID();
  const protocol = createTrainingLinkTransactions(sql, { enabled: true, ttlMs: 20 });
  const created = await protocol.create({ ...auth, requestId: req });
  assert.equal(created.status, 'created');
  const expiredId = created.transaction.transactionId;
  await new Promise((resolve) => setTimeout(resolve, 30));
  resolvedTrainingAuth = auth;
  const expired = await protocol.cancel({ transactionId: expiredId, ...auth });
  assert.equal(expired.status, 'expired');
  assert.equal((await sql`SELECT state FROM training_link_transactions WHERE transaction_id=${expiredId}`).at(0).state, 'expired');
  assert.equal((await sql`SELECT verified_training_user_id FROM training_link_transactions WHERE transaction_id=${expiredId}`).at(0).verified_training_user_id, null, 'pending expiry has no Training subject');
  assert.equal((await sql`SELECT action FROM platform_identity_audit_events WHERE resource_id=${expiredId} ORDER BY occurred_at,id`).map((row) => row.action).join(','), 'training.link_transaction_created,training.link_transaction_expired');

  const verifiedExpiryProtocol = createTrainingLinkTransactions(sql, { enabled: true, serviceCallsEnabled: true, ttlMs: 250 });
  const verifiedChallenge = await verifiedExpiryProtocol.create({ ...auth, requestId: randomUUID() });
  const verifiedSubject = `training-expiry-${randomUUID()}`;
  assert.equal((await verifiedExpiryProtocol.verify({ transactionId: verifiedChallenge.transaction.transactionId, challenge: verifiedChallenge.challenge, assertion: {}, auth }, async () => verifiedSubject)).status, 'verified');
  await new Promise((resolve) => setTimeout(resolve, 270));
  assert.equal((await verifiedExpiryProtocol.cancel({ transactionId: verifiedChallenge.transaction.transactionId, ...auth })).status, 'expired');
  const expiredVerifiedRow = (await sql`SELECT state,verified_training_user_id FROM training_link_transactions WHERE transaction_id=${verifiedChallenge.transaction.transactionId}`).at(0);
  assert.equal(expiredVerifiedRow.state, 'expired'); assert.equal(expiredVerifiedRow.verified_training_user_id, verifiedSubject, 'verified subject survives expiry');
});

test('078F-B ambiguous receipt recovery creates one pending Platform link and cannot activate it', async () => {
  const f = await createTrainingReceiptFixture();
  const lifecycle = createTrainingCanonicalLinkLifecycle(sql, {
    trainingVerifiedLinkingEnabled: true, trainingServiceCallsEnabled: true, trainingCanonicalLinkingEnabled: true,
    reconcileReceipt: async () => f.receipt,
  });
  const [first, replay] = await Promise.all([
    lifecycle.reconcile({ transactionId: f.receipt.transactionId, auth: f.auth }),
    lifecycle.reconcile({ transactionId: f.receipt.transactionId, auth: f.auth }),
  ]);
  assert.equal(first.status, 'pending'); assert.equal(first.link.status, 'pending'); assert.equal(first.link.linkVersion, 1);
  assert.equal(replay.link.linkId, first.link.linkId);
  assert.equal((await sql`SELECT count(*)::int AS count FROM training_account_links WHERE source_transaction_id=${f.receipt.transactionId}`).at(0).count, 1);
  assert.deepEqual((await sql`SELECT state,verified_training_user_id,source_receipt_id FROM training_link_transactions WHERE transaction_id=${f.receipt.transactionId}`).at(0), { state: 'verified', verified_training_user_id: f.receipt.trainingUserId, source_receipt_id: f.receipt.receiptId });
  await assert.rejects(sql`UPDATE training_account_links SET status='active',link_version=2 WHERE link_id=${first.link.linkId}`, { code: '55000' });
  const details = JSON.stringify(await sql`SELECT action,details FROM platform_identity_audit_events WHERE resource_id=${first.link.linkId} OR resource_id=${f.receipt.transactionId}`);
  assert.match(details, /training\.link_reconciliation_recovered/);
  assert.match(details, /training\.link_pending_created/);
  assert.equal(details.includes(f.receipt.trainingUserId), false);
});

test('078F-B rejects receipt context/time mismatches and never recovers cancelled or disabled flows', async () => {
  const mutations = [
    (r) => ({ ...r, personId: randomUUID() }), (r) => ({ ...r, transactionId: randomUUID() }),
    (r) => ({ ...r, audience: 'other' }), (r) => ({ ...r, purpose: 'other' }),
    (r) => ({ ...r, challengeDigest: 'f'.repeat(64) }), (r) => ({ ...r, verifiedAt: 'bad-date' }),
    (r, f) => ({ ...r, verifiedAt: new Date(new Date(f.stored.created_at).getTime() - 1000).toISOString() }),
    (r, f) => ({ ...r, verifiedAt: new Date(new Date(f.stored.expires_at).getTime() + 1000).toISOString() }),
    (r) => ({ ...r, receiptVersion: 2 }), (r) => ({ ...r, receiptId: 'bad-id' }),
    (r) => ({ ...r, trainingUserId: ' padded ' }), (r) => ({ ...r, extra: true }),
  ];
  for (const mutate of mutations) {
    const f = await createTrainingReceiptFixture();
    const service = createTrainingCanonicalLinkLifecycle(sql, { trainingVerifiedLinkingEnabled: true, trainingServiceCallsEnabled: true, trainingCanonicalLinkingEnabled: true, reconcileReceipt: async () => mutate(f.receipt, f) });
    assert.equal((await service.reconcile({ transactionId: f.receipt.transactionId, auth: f.auth })).status, 'receipt_invalid');
    assert.equal((await sql`SELECT state FROM training_link_transactions WHERE transaction_id=${f.receipt.transactionId}`).at(0).state, 'pending');
  }
  const cancelled = await createTrainingReceiptFixture();
  assert.equal((await cancelled.protocol.cancel({ transactionId: cancelled.receipt.transactionId, ...cancelled.auth })).status, 'cancelled');
  let calls = 0;
  const disabled = createTrainingCanonicalLinkLifecycle(sql, { trainingVerifiedLinkingEnabled: true, trainingServiceCallsEnabled: true, reconcileReceipt: async () => { calls++; return cancelled.receipt; } });
  assert.equal((await disabled.reconcile({ transactionId: cancelled.receipt.transactionId, auth: cancelled.auth })).status, 'disabled');
  const enabled = createTrainingCanonicalLinkLifecycle(sql, { trainingVerifiedLinkingEnabled: true, trainingServiceCallsEnabled: true, trainingCanonicalLinkingEnabled: true, reconcileReceipt: async () => { calls++; return cancelled.receipt; } });
  assert.equal((await enabled.reconcile({ transactionId: cancelled.receipt.transactionId, auth: cancelled.auth })).status, 'not_recoverable');
  assert.equal(calls, 0);
});

test('078F-B receipt adapter signs the exact fixed reconciliation path and strictly binds receipt data', async () => {
  const context = { transactionId: randomUUID(), personId: randomUUID(), audience: '2j-training-account-link', purpose: 'training-account-link', challengeDigest: 'a'.repeat(64) };
  const secret = Buffer.alloc(32, 0x27), calls = [];
  const responseFor = (overrides = {}) => ({ v: 1, status: 'verified', receiptId: randomUUID(), receiptVersion: 1, transactionId: context.transactionId, personId: context.personId, trainingUserId: 'opaque-training-user', audience: context.audience, purpose: context.purpose, challengeDigest: context.challengeDigest, verifiedAt: new Date().toISOString(), ...overrides });
  const adapter = createRemoteTrainingReceiptReconciler({
    trainingVerifiedLinkingEnabled: true, trainingServiceCallsEnabled: true, trainingCanonicalLinkingEnabled: true,
    baseUrl: 'https://training.example.test', keyId: 'platform-test', secret: secret.toString('base64url'),
    fetcher: async (url, init) => {
      calls.push(1); const body = Buffer.from(init.body); const headers = init.headers;
      assert.equal(url.pathname, '/api/platform/v1/link-proofs/reconcile'); assert.equal(url.search, ''); assert.deepEqual(JSON.parse(body.toString()), { v: 1, ...context });
      const canonical = canonicalizeTrainingServiceRequest({ keyId: headers['x-2j-key-id'], timestamp: headers['x-2j-timestamp'], requestId: headers['x-2j-request-id'], method: 'POST', path: url.pathname, body });
      assert.equal(headers['x-2j-signature'], createHmac('sha256', secret).update(canonical).digest('base64url'));
      const payload = calls.length === 2 ? responseFor({ extra: true }) : calls.length === 3 ? responseFor({ challengeDigest: 'b'.repeat(64) }) : responseFor();
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const noGate = createRemoteTrainingReceiptReconciler({ trainingVerifiedLinkingEnabled: true, trainingServiceCallsEnabled: true, baseUrl: 'https://training.example.test', keyId: 'platform-test', secret: secret.toString('base64url'), fetcher: async () => { calls.push(99); throw new Error('must be disabled'); } });
  assert.equal(await noGate(context, new AbortController().signal), null);
  assert.equal((await adapter(context, new AbortController().signal)).trainingUserId, 'opaque-training-user');
  assert.equal(await adapter(context, new AbortController().signal), null);
  assert.equal(await adapter(context, new AbortController().signal), null);
  assert.deepEqual(calls, [1,1,1]);
  const transportBase = { trainingVerifiedLinkingEnabled: true, trainingServiceCallsEnabled: true, trainingCanonicalLinkingEnabled: true, baseUrl: 'https://training.example.test', keyId: 'platform-test', secret: secret.toString('base64url') };
  for (const [status, headers, body] of [
    [404, { 'content-type': 'application/json' }, '{}'], [409, { 'content-type': 'application/json' }, '{}'],
    [302, { location: 'https://other.example.test', 'content-type': 'application/json' }, '{}'],
    [200, { 'content-type': 'text/plain' }, '{}'], [200, { 'content-type': 'application/json', 'content-length': '20000' }, '{}'],
  ]) {
    const failed = createRemoteTrainingReceiptReconciler({ ...transportBase, fetcher: async (_url, init) => { assert.equal(init.redirect, 'error'); return new Response(body, { status, headers }); } });
    assert.equal(await failed(context, new AbortController().signal), null, `HTTP/response failure ${status} is fail-closed`);
  }
  const timeout = createRemoteTrainingReceiptReconciler({ ...transportBase, fetcher: async () => { throw new Error('aborted timeout'); } });
  assert.equal(await timeout(context, new AbortController().signal), null);
  let forbiddenCalls = 0;
  const invalidConfig = createRemoteTrainingReceiptReconciler({ ...transportBase, baseUrl: 'http://training.example.test', fetcher: async () => { forbiddenCalls++; throw new Error('must not call'); } });
  assert.equal(await invalidConfig(context, new AbortController().signal), null);
  assert.equal(forbiddenCalls, 0, 'invalid origin config makes zero calls');
});

test('078F-B recovers a clock-expired pending transaction only from historical in-window proof and rejects terminal expiry', async () => {
  const recoverable = await createTrainingReceiptFixture(25);
  await new Promise((resolve) => setTimeout(resolve, 40));
  const service = createTrainingCanonicalLinkLifecycle(sql, { trainingVerifiedLinkingEnabled: true, trainingServiceCallsEnabled: true, trainingCanonicalLinkingEnabled: true, reconcileReceipt: async () => recoverable.receipt });
  const recovered = await service.reconcile({ transactionId: recoverable.receipt.transactionId, auth: recoverable.auth });
  assert.equal(recovered.status, 'pending');
  assert.equal(recovered.recovered, true);

  const terminal = await createTrainingReceiptFixture(25);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal((await terminal.protocol.cancel({ transactionId: terminal.receipt.transactionId, ...terminal.auth })).status, 'expired');
  let calls = 0;
  const blocked = createTrainingCanonicalLinkLifecycle(sql, { trainingVerifiedLinkingEnabled: true, trainingServiceCallsEnabled: true, trainingCanonicalLinkingEnabled: true, reconcileReceipt: async () => { calls++; return terminal.receipt; } });
  assert.equal((await blocked.reconcile({ transactionId: terminal.receipt.transactionId, auth: terminal.auth })).status, 'not_recoverable');
  assert.equal(calls, 0);
});

test('078F-B enforces active identity binding and one nonterminal link per person and Training identity', async () => {
  const f = await createTrainingReceiptFixture();
  let calls = 0;
  const create = (receipt) => createTrainingCanonicalLinkLifecycle(sql, { trainingVerifiedLinkingEnabled: true, trainingServiceCallsEnabled: true, trainingCanonicalLinkingEnabled: true, reconcileReceipt: async () => { calls++; return receipt; } });
  assert.equal((await create(f.receipt).reconcile({ transactionId: f.receipt.transactionId, auth: { ...f.auth, personId: randomUUID() } })).status, 'wrong_person');
  await sql`UPDATE platform_person_auth_subjects SET status='revoked',revoked_at=now(),revoked_by='qa-078fb' WHERE id=${f.binding.id}`;
  assert.equal((await create(f.receipt).reconcile({ transactionId: f.receipt.transactionId, auth: f.auth })).status, 'identity_unavailable');
  assert.equal(calls, 0, 'wrong person and revoked binding make no service call');

  const inactive = await createTrainingReceiptFixture();
  await sql`UPDATE platform_persons SET status='revoked' WHERE id=${inactive.auth.personId}`;
  assert.equal((await create(inactive.receipt).reconcile({ transactionId: inactive.receipt.transactionId, auth: inactive.auth })).status, 'identity_unavailable');

  const first = await createTrainingReceiptFixture();
  const success = await create(first.receipt).reconcile({ transactionId: first.receipt.transactionId, auth: first.auth });
  assert.equal(success.status, 'pending');
  const linkedCount = (await sql`SELECT count(*)::int AS count FROM training_account_links WHERE status IN ('pending','active','revocation_pending') AND person_id=${first.auth.personId}`).at(0).count;
  const samePersonDifferentRemote = await createTrainingReceiptForAuth(first.auth, `another-${randomUUID()}`);
  const personCollision = await create(samePersonDifferentRemote.receipt).reconcile({ transactionId: samePersonDifferentRemote.receipt.transactionId, auth: first.auth });
  assert.equal(personCollision.status, 'conflict');
  const other = await createTrainingReceiptFixture();
  const userCollision = await create({ ...other.receipt, trainingUserId: first.receipt.trainingUserId }).reconcile({ transactionId: other.receipt.transactionId, auth: other.auth });
  assert.equal(userCollision.status, 'conflict');
  assert.equal((await sql`SELECT count(*)::int AS count FROM training_account_links WHERE status IN ('pending','active','revocation_pending') AND person_id=${first.auth.personId}`).at(0).count, linkedCount, 'conflicts do not create placeholder rows');
  assert.equal((await sql`SELECT status,method FROM training_account_links WHERE link_id=${success.link.linkId}`).at(0).status, 'pending');
});

test('078F-B already-verified exchange identity is write-once and a different receipt identity fails closed', async () => {
  const f = await createTrainingReceiptFixture();
  const verifiedUser = `verified-${randomUUID()}`;
  assert.equal((await f.protocol.verify({ transactionId: f.receipt.transactionId, challenge: f.transaction.challenge, assertion: {}, auth: f.auth }, async () => verifiedUser)).status, 'verified');
  const mismatch = createTrainingCanonicalLinkLifecycle(sql, { trainingVerifiedLinkingEnabled: true, trainingServiceCallsEnabled: true, trainingCanonicalLinkingEnabled: true, reconcileReceipt: async () => ({ ...f.receipt, trainingUserId: `other-${randomUUID()}` }) });
  assert.equal((await mismatch.reconcile({ transactionId: f.receipt.transactionId, auth: f.auth })).status, 'conflict');
  assert.equal((await sql`SELECT count(*)::int AS count FROM training_account_links WHERE source_transaction_id=${f.receipt.transactionId}`).at(0).count, 0);
  const matching = createTrainingCanonicalLinkLifecycle(sql, { trainingVerifiedLinkingEnabled: true, trainingServiceCallsEnabled: true, trainingCanonicalLinkingEnabled: true, reconcileReceipt: async () => ({ ...f.receipt, trainingUserId: verifiedUser }) });
  assert.equal((await matching.reconcile({ transactionId: f.receipt.transactionId, auth: f.auth })).status, 'pending');
  assert.equal((await sql`SELECT verified_training_user_id FROM training_link_transactions WHERE transaction_id=${f.receipt.transactionId}`).at(0).verified_training_user_id, verifiedUser);
});

test('client PII endpoints deny by default and ignore caller-supplied role headers', async () => {
  const denied = await anonymousApp.inject({ method: 'GET', url: '/api/clients', headers: { 'x-2j-role': 'admin' } });
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.headers['cache-control'], 'no-store');
  assert.deepEqual(denied.json(), { error: 'authentication_required' });
  const testEmail = ` ADA-${randomUUID()}@example.test `;
  const created = await createClientRequest(clientsAdminApp, { firstName: 'Ada', lastName: `Lovelace ${randomUUID()}`, email: testEmail, phone: ' 555 0100 ' });
  assert.equal(created.statusCode, 201, created.body);
  const clientId = created.json().id;
  const trainer = await clientsTrainerApp.inject({ method: 'GET', url: `/api/clients/${clientId}` });
  assert.equal(trainer.statusCode, 200, trainer.body);
  assert.equal(Object.hasOwn(trainer.json().client, 'email'), false);
  assert.equal(Object.hasOwn(trainer.json().client, 'phone'), false);
  assert.equal(Object.hasOwn(trainer.json().client, 'birthDate'), false);
  assert.equal(trainer.json().sections.some((section) => ['training', 'progress', 'health'].includes(section.id)), false);
  assert.equal(trainer.json().summary.payments.access, 'forbidden');
  assert.equal(trainer.json().summary.payments.data, null);
  assert.equal(Object.hasOwn(trainer.json().summary, 'training'), false);
  assert.equal(Object.hasOwn(trainer.json().summary, 'health'), false);
  assert.equal(trainer.json().summary.plans.access, 'available', 'Trainer has operational read access to entitlements');
  assert.equal(trainer.json().summary.documents.access, 'available');
  assert.equal(trainer.json().sections.find((section) => section.id === 'documents').canManage, false, 'read access does not imply document management');
  assert.deepEqual(trainer.json().summary.messages.data, { unreadCount: 0, lastMessageAt: null });
  assert.equal(trainer.json().sections.find((section) => section.id === 'payments').sourceLabel, 'Pagos');
  const adminProfile = await clientsAdminApp.inject({ method: 'GET', url: `/api/clients/${clientId}` });
  assert.equal(adminProfile.statusCode, 200);
  assert.equal(adminProfile.json().client.email, testEmail.trim().toLowerCase(), 'contact fields remain available to the client manager');
  assert.equal(adminProfile.json().sections.find((section) => section.id === 'documents').canManage, true, 'management capability is resolved server-side');
  assert.equal(JSON.stringify(trainer.json()).includes('qa-admin'), false);
  const forbiddenCreate = await createClientRequest(clientsTrainerApp, { firstName: 'No', lastName: 'Write' });
  assert.equal(forbiddenCreate.statusCode, 403);
  const accountant = await clientsAccountantApp.inject({ method: 'GET', url: `/api/clients/${clientId}` });
  assert.equal(accountant.statusCode, 403);
  assert.equal(accountant.json().client, undefined);
});

test('client list orders A–Z by surname ignoring accents and searches name, email and phone without accents', async () => {
  const tag = randomUUID().slice(0, 8);
  const mk = async (firstName, lastName, extra = {}) => { const r = await createClientRequest(clientsAdminApp, { firstName, lastName, ...extra }); assert.equal(r.statusCode, 201, r.body); return r.json().id; };
  const zeta = await mk('Ana', `Zeta${tag}`);
  const garcia = await mk('Lucía', `García${tag}`, { email: `lucia.${tag}@example.test`, phone: '+34 600 123 456' });
  const alvarez = await mk('Beto', `Álvarez${tag}`);
  const ids = (await clientsAdminApp.inject({ method: 'GET', url: `/api/clients?q=${tag}&limit=10` })).json().items.map((item) => item.id);
  assert.deepEqual(ids, [alvarez, garcia, zeta], 'accented surnames sort with their base letter');
  const byName = await clientsAdminApp.inject({ method: 'GET', url: `/api/clients?q=${encodeURIComponent(`garcia${tag}`)}` });
  assert.deepEqual(byName.json().items.map((item) => item.id), [garcia], '"garcia" finds "García"');
  const byEmail = await clientsAdminApp.inject({ method: 'GET', url: `/api/clients?q=${encodeURIComponent(`lucia.${tag}`)}` });
  assert.deepEqual(byEmail.json().items.map((item) => item.id), [garcia], 'a fragment of the email finds the client');
  const byPhone = await clientsAdminApp.inject({ method: 'GET', url: '/api/clients?q=600123456' });
  assert.equal(byPhone.json().items.some((item) => item.id === garcia), true, 'digits match a phone stored with spaces and prefix');
  const trainerPhone = await clientsTrainerApp.inject({ method: 'GET', url: '/api/clients?q=600123456' });
  assert.equal(trainerPhone.json().items.some((item) => item.id === garcia), false, 'roles without clients.manage cannot discover contact data');
  const firstPage = (await clientsAdminApp.inject({ method: 'GET', url: `/api/clients?q=${tag}&limit=2` })).json();
  assert.deepEqual(firstPage.items.map((item) => item.id), [alvarez, garcia]);
  const secondPage = (await clientsAdminApp.inject({ method: 'GET', url: `/api/clients?q=${tag}&limit=2&cursor=${encodeURIComponent(firstPage.nextCursor)}` })).json();
  assert.deepEqual(secondPage.items.map((item) => item.id), [zeta], 'the cursor continues in the same order');
});

test('client search minimizes contact discovery by permission and archive retains profile history', async () => {
  const created = await createClientRequest(clientsAdminApp, { firstName: '  Marta  ', lastName: `Prueba ${randomUUID()}`, email: 'marta-search@example.test' });
  assert.equal(created.statusCode, 201, created.body);
  const clientId = created.json().id;
  const search = await clientsTrainerApp.inject({ method: 'GET', url: '/api/clients?q=MARTA' });
  assert.equal(search.statusCode, 200, search.body);
  assert.equal(search.json().items.some((item) => item.id === clientId), true);
  const privateContactSearch = await clientsTrainerApp.inject({ method: 'GET', url: '/api/clients?q=MARTA-SEARCH%40EXAMPLE.TEST' });
  assert.equal(privateContactSearch.json().items.some((item) => item.id === clientId), false, 'Trainer searches must not reveal a match by guessing private contact data');
  const adminContactSearch = await clientsAdminApp.inject({ method: 'GET', url: '/api/clients?q=MARTA-SEARCH%40EXAMPLE.TEST' });
  assert.equal(adminContactSearch.json().items.some((item) => item.id === clientId), true, 'client managers retain contact lookup');
  const listed = search.json().items.find((item) => item.id === clientId);
  assert.equal(Object.hasOwn(listed, 'email'), false);
  assert.equal(Object.hasOwn(listed, 'phone'), false);
  const profile = await clientsTrainerApp.inject({ method: 'GET', url: `/api/clients/${clientId}` });
  assert.equal(profile.statusCode, 200);
  assert.deepEqual(profile.json().history.map((event) => event.eventType), ['client.created']);
  const archive = await clientsAdminApp.inject({ method: 'PATCH', url: `/api/clients/${clientId}/archive` });
  assert.equal(archive.statusCode, 200);
  assert.equal(archive.json().status, 'archived');
  const activeList = await clientsAdminApp.inject({ method: 'GET', url: `/api/clients?q=${encodeURIComponent(created.json().email)}` });
  assert.equal(activeList.json().items.some((item) => item.id === clientId), false);
  const history = await clientsAdminApp.inject({ method: 'GET', url: `/api/clients/${clientId}` });
  assert.deepEqual(history.json().history.map((event) => event.eventType), ['client.archived', 'client.created']);
  const archivedList = await clientsAdminApp.inject({ method: 'GET', url: '/api/clients?status=archived' });
  assert.equal(archivedList.json().items.some((item) => item.id === clientId), true);
  await assert.rejects(sql`DELETE FROM clients WHERE id=${clientId}`, (error) => error.code === '55000');
});

test('every client PII route fails closed without a server-resolved session', async () => {
  const routes = [
    ['GET', '/api/clients'], ['HEAD', '/api/clients'], ['POST', '/api/clients'],
    ['GET', `/api/clients/${randomUUID()}`], ['HEAD', `/api/clients/${randomUUID()}`],
    ['GET', `/api/clients/${randomUUID()}/plans`], ['POST', `/api/clients/${randomUUID()}/plans`],
    ['PATCH', `/api/clients/${randomUUID()}/archive`],
  ];
  for (const [method, url] of routes) {
    const response = await anonymousApp.inject({ method, url, headers: { 'x-2j-role': 'admin', 'idempotency-key': randomUUID() }, payload: method === 'POST' ? { firstName: 'No', lastName: 'Session', email: 'private@example.test' } : undefined });
    assert.equal(response.statusCode, 401, `${method} ${url}`);
    assert.equal(response.headers['cache-control'], 'no-store', `${method} ${url}`);
    assert.equal(response.body.includes('private@example.test'), false);
  }
  const catalog = await anonymousApp.inject({ method:'GET',url:'/api/plans/assignable',headers:{'x-2j-role':'admin'} });
  assert.equal(catalog.statusCode,401);
  assert.equal(catalog.headers['cache-control'],'no-store');
});

test('catalog price and plan lifecycle mutations fail closed for anonymous and non-catalog roles', async () => {
  const body=planPayload([defaultArea.id],{basePriceCents:4500});
  const anon=await anonymousApp.inject({method:'POST',url:'/api/plans',headers:{'idempotency-key':randomUUID()},payload:body});assert.equal(anon.statusCode,401);
  const trainer=await clientsTrainerApp.inject({method:'POST',url:'/api/plans',headers:{'idempotency-key':randomUUID()},payload:body});assert.equal(trainer.statusCode,403);
  const accountant=await clientsAccountantApp.inject({method:'POST',url:'/api/plans',headers:{'idempotency-key':randomUUID()},payload:body});assert.equal(accountant.statusCode,403);
});

test('sale price override requires catalog pricing permission and a reason', async () => {
  const service=await createService(`Precio protegido ${randomUUID()}`);const created=await createPlan([service.id],{basePriceCents:4500});const planId=created.response.json().id;assert.equal((await app.inject({method:'POST',url:`/api/plans/${planId}/activate`})).statusCode,200);
  const client=(await createClientRequest(clientsAdminApp,{firstName:'Precio',lastName:`Protegido ${randomUUID()}`})).json();const limited=buildServer(process.env.DATABASE_URL,{authorizationResolver:async()=>({actorId:'qa-admin-price-denied',role:'admin',deniedPermissions:['catalog.pricing.manage']})});
  try{const payload={planId,startsOn:'2026-10-09',dueOn:'2026-10-09',amountCents:4600};const noReason=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':randomUUID()},payload});assert.equal(noReason.statusCode,409);assert.equal(noReason.json().error,'adjustment_reason_required');const denied=await limited.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':randomUUID()},payload:{...payload,adjustmentReason:'Descuento excepcional'}});assert.equal(denied.statusCode,403);assert.equal(denied.json().error,'price_override_forbidden');}
  finally{await limited.close();}
});

test('malformed JSON returns a fixed error and never echoes or logs personal data', async () => {
  const logLines = [];
  const stream = new Writable({ write(chunk, _encoding, callback) { logLines.push(String(chunk)); callback(); } });
  const capturedApp = buildServer(process.env.DATABASE_URL, {
    authorizationResolver: async () => ({ actorId: 'qa-admin', role: 'admin' }),
    logger: { level: 'info', stream, serializers: { req(request) { return { method: request.method, url: String(request.url).split('?')[0] }; } } },
  });
  try {
    const secret = 'pii-fragment@example.test';
    const response = await capturedApp.inject({ method: 'POST', url: '/api/clients', headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() }, payload: `{"firstName":"${secret}",` });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: 'invalid_json', message: 'El cuerpo de la solicitud no es JSON válido.' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(response.body.includes(secret), false);
    assert.equal(logLines.join('').includes(secret), false);
    assert.equal(logLines.join('').includes('firstName'), false);
  } finally { await capturedApp.close(); }
});

test('client creation requires idempotency and replays safely across concurrent retries', async () => {
  const key = randomUUID();
  const payload = { firstName: 'Reintento', lastName: `Seguro ${randomUUID()}`, email: `retry-${randomUUID()}@example.test`, phone: '600 000 000' };
  const [first, retry] = await Promise.all([createClientRequest(clientsAdminApp, payload, key), createClientRequest(clientsAdminApp, payload, key)]);
  assert.deepEqual([first.statusCode, retry.statusCode].sort(), [200, 201]);
  assert.equal(first.json().id, retry.json().id);
  const mismatch = await createClientRequest(clientsAdminApp, { ...payload, firstName: 'Otro' }, key);
  assert.equal(mismatch.statusCode, 409);
  assert.equal(mismatch.json().error, 'idempotency_conflict');
  const rows = await sql`SELECT count(*)::int AS count FROM clients WHERE id=${first.json().id}`;
  assert.equal(rows[0].count, 1);
  const missingKey = await clientsAdminApp.inject({ method: 'POST', url: '/api/clients', payload });
  assert.equal(missingKey.statusCode, 400);
  assert.equal(missingKey.json().error, 'idempotency_key_required');
});

test('active normalized email is unique while phone can be shared and archived email can be reused', async () => {
  const email = `unique-${randomUUID()}@example.test`;
  const phone = 'shared-family-number';
  const original = await createClientRequest(clientsAdminApp, { firstName: 'Uno', lastName: `Email ${randomUUID()}`, email: ` ${email.toUpperCase()} `, phone });
  assert.equal(original.statusCode, 201, original.body);
  const duplicate = await createClientRequest(clientsAdminApp, { firstName: 'Dos', lastName: `Email ${randomUUID()}`, email, phone });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error, 'email_conflict');
  const samePhone = await createClientRequest(clientsAdminApp, { firstName: 'Dos', lastName: `Teléfono ${randomUUID()}`, phone });
  assert.equal(samePhone.statusCode, 201, samePhone.body);
  const archived = await clientsAdminApp.inject({ method: 'PATCH', url: `/api/clients/${original.json().id}/archive` });
  assert.equal(archived.statusCode, 200);
  const reused = await createClientRequest(clientsAdminApp, { firstName: 'Nuevo', lastName: `Titular ${randomUUID()}`, email });
  assert.equal(reused.statusCode, 201, reused.body);
});

test('concurrent client creates with the same normalized active email cannot create duplicates', async () => {
  const email = `race-${randomUUID()}@example.test`;
  const submit = (firstName) => createClientRequest(clientsAdminApp, { firstName, lastName: `Duplicado ${randomUUID()}`, email: email.toUpperCase() });
  const results = await Promise.all([submit('Uno'), submit('Dos')]);
  assert.deepEqual(results.map((response) => response.statusCode).sort(), [201, 409]);
  assert.equal(results.find((response) => response.statusCode === 409).json().error, 'email_conflict');
  assert.equal((await sql`SELECT count(*)::int AS count FROM clients WHERE lower(email)=${email}`).at(0).count, 1);
});

test('client listing paginates past 100 rows using a stable cursor', async () => {
  const marker = randomUUID();
  await sql`INSERT INTO clients(first_name,last_name) SELECT 'Page-' || lpad(n::text,3,'0'),${marker} FROM generate_series(1,125) AS n`;
  const collected = [];
  let cursor;
  let pages = 0;
  do {
    const params = new URLSearchParams({ q: marker, limit: '40' });
    if (cursor) params.set('cursor', cursor);
    const response = await clientsAdminApp.inject({ method: 'GET', url: `/api/clients?${params}` });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    collected.push(...body.items);
    cursor = body.nextCursor;
    assert.equal(body.hasMore, Boolean(cursor));
    pages += 1;
    assert.ok(pages <= 4, 'pagination must make progress');
  } while (cursor);
  assert.equal(collected.length, 125);
  assert.equal(new Set(collected.map((item) => item.id)).size, 125);
  assert.deepEqual(collected.map((item) => `${item.lastName.toLowerCase()}\u0000${item.firstName.toLowerCase()}\u0000${item.id}`), [...collected].map((item) => `${item.lastName.toLowerCase()}\u0000${item.firstName.toLowerCase()}\u0000${item.id}`).sort());
  const badCursor = await clientsAdminApp.inject({ method: 'GET', url: '/api/clients?cursor=not-a-cursor' });
  assert.equal(badCursor.statusCode, 400);
  assert.equal(badCursor.json().error, 'invalid_cursor');
});

test('concurrent and repeated archive writes one event and keeps history append-only', async () => {
  const created = await createClientRequest(clientsAdminApp, { firstName: 'Archivo', lastName: randomUUID() });
  assert.equal(created.statusCode, 201);
  const url = `/api/clients/${created.json().id}/archive`;
  const results = await Promise.all([clientsAdminApp.inject({ method: 'PATCH', url }), clientsAdminApp.inject({ method: 'PATCH', url })]);
  assert.deepEqual(results.map((response) => response.statusCode).sort(), [200, 404]);
  assert.equal((await clientsAdminApp.inject({ method: 'PATCH', url })).statusCode, 404);
  const detail = await clientsAdminApp.inject({ method: 'GET', url: `/api/clients/${created.json().id}` });
  assert.deepEqual(detail.json().history.map((event) => event.eventType).sort(), ['client.archived', 'client.created']);
  assert.ok(detail.json().history.every((event) => !('actorId' in event) && typeof event.actorLabel === 'string'));
});

test('areas can be configured and service records reference their normalized IDs', async () => {
  const label = `Área QA ${randomUUID()}`;
  const created = await app.inject({ method: 'POST', url: '/api/areas', payload: { name: `  ${label}  ` } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().name, label);
  const duplicate = await app.inject({ method: 'POST', url: '/api/areas', payload: { name: label.toLocaleUpperCase('es') } });
  assert.equal(duplicate.statusCode, 409);
  const service = await app.inject({ method: 'POST', url: '/api/services', payload: { name: `Servicio ${randomUUID()}`, areaId: created.json().id, status: 'draft' } });
  assert.equal(service.statusCode, 201);
  assert.equal(service.json().areaId, created.json().id);
});

test('areas are normalized entities and service listing is stable by area then name', async () => {
  const areas = await app.inject({ method: 'GET', url: '/api/areas' });
  assert.equal(areas.statusCode, 200);
  const seedAreas = areas.json().map((item) => item.name).filter((name) => ['El Búnker', 'El Estudio', 'Entrenamiento personal', 'La Sala'].includes(name));
  assert.deepEqual(seedAreas, ['El Búnker', 'El Estudio', 'Entrenamiento personal', 'La Sala']);
  const marker = randomUUID();
  await createService(`ZZ stable ${marker}`);
  await createService(`AA stable ${marker}`);
  const response = await app.inject({ method: 'GET', url: '/api/services' });
  assert.equal(response.statusCode, 200);
  const names = response.json().filter((item) => item.name.includes(marker)).map((item) => item.name);
  assert.deepEqual(names, [`AA stable ${marker}`, `ZZ stable ${marker}`]);
});

test('database CHECK constraints reject malformed rights when bypassing HTTP validation', async () => {
  const service = await createService();
  const created = await createPlan([service.id]);
  assert.equal(created.response.statusCode, 201, created.response.body);
  await assert.rejects(sql`INSERT INTO plan_rights(plan_id,plan_version,right_type,service_id,quantity,quota_scope) VALUES (${created.response.json().id},1,'sessions_quota',${service.id},NULL,'shared')`, (error) => error.code === '23514');
  await assert.rejects(sql`INSERT INTO plan_rights(plan_id,plan_version,right_type,service_id,quantity,quota_scope,period,period_mode,timezone) VALUES (${created.response.json().id},1,'period_quota',NULL,8,'shared','fortnight','calendar','Atlantic/Canary')`, (error) => error.code === '23514');
});

test('multi-service plans allow disjoint service quotas and distinct periods but reject global overlap', async () => {
  const [first, second] = await Promise.all([createService(), createService()]);
  const { response } = await createPlan([first.id, second.id], { rights: [
    { rightType: 'service_access', serviceId: first.id },
    { rightType: 'sessions_quota', serviceId: first.id, quotaScope: 'per_service', quantity: 4 },
    { rightType: 'sessions_quota', serviceId: second.id, quotaScope: 'per_service', quantity: 6 },
    { rightType: 'period_quota', serviceId: null, quotaScope: 'shared', quantity: 8, period: 'month', periodMode: 'calendar', timezone: 'Atlantic/Canary', validDays: 30, validDaysStartRule: 'first_use' },
    { rightType: 'period_quota', serviceId: null, quotaScope: 'shared', quantity: 3, period: 'week', periodMode: 'calendar', timezone: 'Atlantic/Canary' },
  ] });
  assert.equal(response.statusCode, 201, response.body);
  const plan = response.json();
  assert.equal(plan.services.length, 2);
  const quotas = plan.rights.filter((right) => right.rightType === 'sessions_quota').map((right) => [right.serviceId, right.quotaScope, right.quantity]);
  assert.deepEqual(quotas.sort((a, b) => a[0].localeCompare(b[0])), [[first.id, 'per_service', 4], [second.id, 'per_service', 6]].sort((a, b) => a[0].localeCompare(b[0])));
  assert.equal(plan.rights.find((right) => right.rightType === 'period_quota' && right.period === 'month').timezone, 'Atlantic/Canary');
  assert.equal(plan.rights.filter((right) => right.rightType === 'period_quota').length, 2, 'different quota periods remain independently configurable');
  assert.equal(plan.rights.find((right) => right.rightType === 'period_quota' && right.period === 'month').validDaysStartRule, 'first_use');
  const listed = await app.inject({ method: 'GET', url: `/api/services/${second.id}/plans` });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json()[0].services.map((item) => item.id).sort(), [first.id, second.id].sort());
  await assert.rejects(sql`INSERT INTO plan_rights(plan_id,plan_version,right_type,quantity,quota_scope) VALUES (${plan.id},1,'sessions_quota',10,'shared')`, (error) => error.code === '23514');
});

test('PostgreSQL rejects same-period global quota overlaps and allows distinct services and periods', async () => {
  const [first, second] = await Promise.all([createService(), createService()]);
  const firstPlan = await createPlan([first.id, second.id]);
  const planId = firstPlan.response.json().id;
  const targeted = (serviceId, period) => sql`INSERT INTO plan_rights(plan_id,plan_version,right_type,service_id,quota_scope,quantity,period,period_mode,timezone) VALUES (${planId},1,'period_quota',${serviceId},'per_service',3,${period},'calendar','Atlantic/Canary')`;
  await targeted(first.id, 'month');
  await targeted(second.id, 'month');
  await sql`INSERT INTO plan_rights(plan_id,plan_version,right_type,quota_scope,quantity,period,period_mode,timezone) VALUES (${planId},1,'period_quota','shared',8,'week','calendar','Atlantic/Canary')`;
  await assert.rejects(targeted(first.id, 'month'), (error) => error.code === '23514');

  const globalPlan = await createPlan([first.id]);
  const globalId = globalPlan.response.json().id;
  await sql`INSERT INTO plan_rights(plan_id,plan_version,right_type,quota_scope,quantity,period,period_mode,timezone) VALUES (${globalId},1,'period_quota','shared',8,'month','calendar','Atlantic/Canary')`;
  await assert.rejects(sql`INSERT INTO plan_rights(plan_id,plan_version,right_type,service_id,quota_scope,quantity,period,period_mode,timezone) VALUES (${globalId},1,'period_quota',${first.id},'per_service',3,'month','calendar','Atlantic/Canary')`, (error) => error.code === '23514');
});

test('session packs require a finite session quota and cannot use periodic quotas', async () => {
  const service = await createService();
  const { response } = await createPlan([service.id], { kind: 'session_pack', renewalCadence: null, rights: [
    { rightType: 'sessions_quota', serviceId: service.id, quotaScope: 'per_service', quantity: 8 },
  ] });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().kind, 'session_pack');
  assert.equal(response.json().renewalCadence, null);

  const planId = randomUUID();
  const key = randomUUID();
  const name = `Invalid session pack ${randomUUID()}`;
  await assert.rejects(sql.begin(async (tx) => {
    await tx`INSERT INTO plans(id,name,status,current_version,idempotency_key,request_hash) VALUES (${planId},${name},'draft',1,${key},${'0'.repeat(64)})`;
    await tx`INSERT INTO plan_versions(plan_id,version,kind,renewal_cadence,period_days) VALUES (${planId},1,'session_pack',NULL,NULL)`;
  }), (error) => error.code === '23514');
  assert.equal((await sql`SELECT count(*)::int AS count FROM plans WHERE id=${planId}`).at(0).count, 0);
});

test('invalid duplicate rights are rejected before a plan transaction persists', async () => {
  const service = await createService();
  const name = `Rollback ${randomUUID()}`;
  const payload = planPayload([service.id], { name, rights: [
    { rightType: 'service_access', serviceId: service.id },
    { rightType: 'service_access', serviceId: service.id },
  ] });
  const response = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': randomUUID() }, payload });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, 'validation_error');
  assert.equal((await sql`SELECT count(*)::int AS count FROM plans WHERE name=${name}`).at(0).count, 0);
});

test('plan creation idempotency replays identical requests and rejects changed payloads', async () => {
  const service = await createService();
  const key = randomUUID();
  const body = planPayload([service.id]);
  const first = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: body });
  const replay = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: body });
  const mismatch = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: { ...body, name: `${body.name} cambiado` } });
  assert.equal(first.statusCode, 201);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().id, first.json().id);
  assert.equal(mismatch.statusCode, 409);
  assert.equal(mismatch.json().error, 'idempotency_conflict');
});

test('service_access needs a valid service target in new plans and plan versions', async () => {
  const service = await createService();
  const planKey = randomUUID();
  const invalid = planPayload([service.id], { rights: [{ rightType: 'service_access', serviceId: null }] });
  const rejected = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': planKey }, payload: invalid });
  assert.equal(rejected.statusCode, 400, rejected.body);
  assert.equal((await sql`SELECT count(*)::int AS count FROM plans WHERE idempotency_key=${planKey}`).at(0).count, 0, 'invalid plan was not persisted');

  const valid = await createPlan([service.id]);
  assert.equal(valid.response.statusCode, 201, valid.response.body);
  const planId = valid.response.json().id;
  assert.equal((await app.inject({ method: 'POST', url: `/api/plans/${planId}/activate` })).statusCode, 200);
  const versionKey = randomUUID();
  const version = await app.inject({ method: 'POST', url: `/api/plans/${planId}/versions`, headers: { 'idempotency-key': versionKey }, payload: { ...valid.body, rights: [{ rightType: 'service_access' }] } });
  assert.equal(version.statusCode, 400, version.body);
  assert.equal((await sql`SELECT current_version AS version FROM plans WHERE id=${planId}`).at(0).version, 1, 'invalid version was not persisted or selected');
  assert.equal((await sql`SELECT count(*)::int AS count FROM plan_version_changes WHERE idempotency_key=${versionKey}`).at(0).count, 0);

  const draft = await createPlan([service.id]);
  assert.equal(draft.response.statusCode, 201, draft.response.body);
  await assert.rejects(sql`INSERT INTO plan_rights(plan_id,plan_version,right_type,service_id) VALUES (${draft.response.json().id},1,'service_access',NULL)`, error => error.code === '23514');
});

test('approved entitlement roles are enforced server-side for reads, sales, lifecycle, payment and adjustments', async () => {
  const service = await createService();
  const created = await createPlan([service.id], { basePriceCents: 3200 });
  assert.equal(created.response.statusCode, 201, created.response.body);
  const planId = created.response.json().id;
  assert.equal((await app.inject({ method: 'POST', url: `/api/plans/${planId}/activate` })).statusCode, 200);
  const client = (await createClientRequest(clientsAdminApp, { firstName: 'Mostrador', lastName: randomUUID() })).json();
  const clientList = await clientsReceptionApp.inject({ method: 'GET', url: '/api/clients?limit=1' });
  assert.equal(clientList.statusCode, 200); assert.equal(clientList.json().capabilities.assignPlans, true); assert.equal(clientList.json().capabilities.collectPayments, false);
  assert.equal((await clientsReceptionApp.inject({ method: 'GET', url: `/api/clients/${client.id}` })).statusCode, 200);
  assert.equal((await clientsReceptionApp.inject({ method: 'GET', url: '/api/plans/assignable' })).statusCode, 200);
  assert.equal((await clientsTrainerApp.inject({ method: 'GET', url: `/api/clients/${client.id}/entitlements/effective?date=2026-10-09` })).statusCode, 200);
  assert.equal((await clientsAccountantApp.inject({ method: 'GET', url: `/api/clients/${client.id}/entitlements/effective?date=2026-10-09` })).statusCode, 403);

  const salePayload = { planId, startsOn: '2026-10-09', endsOn: '2026-10-31', dueOn: '2026-10-09', amountCents: 3200 };
  const sale = await clientsReceptionApp.inject({ method: 'POST', url: `/api/clients/${client.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: salePayload });
  assert.equal(sale.statusCode, 201, sale.body);
  assert.equal((await sql`SELECT count(*)::int AS count FROM economic_transactions WHERE charge_id=${sale.json().chargeId}`).at(0).count, 0, 'an unpaid counter sale does not require payment permission');
  const deniedOverride = await clientsReceptionApp.inject({ method: 'POST', url: `/api/clients/${client.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: { ...salePayload, amountCents: 3300, adjustmentReason: 'Precio excepcional' } });
  assert.equal(deniedOverride.statusCode, 403); assert.equal(deniedOverride.json().error, 'price_override_forbidden');
  const deniedCharge = await clientsReceptionApp.inject({ method: 'POST', url: `/api/clients/${client.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: { ...salePayload, paymentAmountCents: 3200, paymentMethod: 'card' } });
  assert.equal(deniedCharge.statusCode, 403);
  const noCatalogPrice = await createPlan([service.id], { basePriceCents: null });
  assert.equal(noCatalogPrice.response.statusCode, 201, noCatalogPrice.response.body);
  assert.equal((await app.inject({ method: 'POST', url: `/api/plans/${noCatalogPrice.response.json().id}/activate` })).statusCode, 200);
  const noPriceSale = await clientsReceptionApp.inject({ method: 'POST', url: `/api/clients/${client.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: { ...salePayload, planId: noCatalogPrice.response.json().id } });
  assert.equal(noPriceSale.statusCode, 409); assert.equal(noPriceSale.json().error, 'catalog_price_required');
  const adjustUrl = `/api/clients/${client.id}/plans/${sale.json().id}/adjustments`;
  for (const actor of [clientsReceptionApp, clientsTrainerApp, clientsAccountantApp]) {
    assert.equal((await actor.inject({ method: 'POST', url: adjustUrl, headers: { 'idempotency-key': randomUUID() }, payload: { rightId: randomUUID(), quantity: 1, reason: 'Ajuste no autorizado' } })).statusCode, 403);
  }
  assert.equal((await clientsTrainerApp.inject({ method: 'POST', url: `/api/clients/${client.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: salePayload })).statusCode, 403);
  assert.equal((await clientsTrainerApp.inject({ method: 'POST', url: `/api/clients/${client.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: { ...salePayload, sourceAssignmentId: sale.json().id, operationKind: 'renewal', startsOn: '2026-11-01', endsOn: '2026-11-30' } })).statusCode, 403);
  assert.equal((await clientsAccountantApp.inject({ method: 'POST', url: `/api/clients/${client.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: salePayload })).statusCode, 403);

  assert.equal((await clientsReceptionApp.inject({ method: 'POST', url: `/api/clients/${client.id}/plans/${sale.json().id}/pause`, headers: { 'idempotency-key': randomUUID() }, payload: { reason: 'Pausa de cliente' } })).statusCode, 201);
  assert.equal((await clientsReceptionApp.inject({ method: 'POST', url: `/api/clients/${client.id}/plans/${sale.json().id}/resume`, headers: { 'idempotency-key': randomUUID() }, payload: {} })).statusCode, 201);
  assert.equal((await clientsReceptionApp.inject({ method: 'POST', url: `/api/clients/${client.id}/plans/${sale.json().id}/cancel`, headers: { 'idempotency-key': randomUUID() }, payload: { reason: 'Baja solicitada' } })).statusCode, 201);

  for (const operationKind of ['renewal','change']) {
    const operationClient = (await createClientRequest(clientsAdminApp, { firstName: 'Operación', lastName: `${operationKind} ${randomUUID()}` })).json();
    const source = await clientsAdminApp.inject({ method: 'POST', url: `/api/clients/${operationClient.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: { planId, startsOn: '2026-10-09', endsOn: '2026-10-09', dueOn: '2026-10-09', amountCents: 3200 } });
    assert.equal(source.statusCode, 201, source.body);
    const operation = await clientsReceptionApp.inject({ method: 'POST', url: `/api/clients/${operationClient.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: { planId, sourceAssignmentId: source.json().id, operationKind, startsOn: '2026-10-10', endsOn: '2026-10-31', dueOn: '2026-10-10', amountCents: 3200 } });
    assert.equal(operation.statusCode, 201, `${operationKind}: ${operation.body}`);
  }
  for (const actor of [clientsTrainerApp, clientsAccountantApp]) {
    assert.equal((await actor.inject({ method: 'POST', url: `/api/clients/${client.id}/plans/${sale.json().id}/pause`, headers: { 'idempotency-key': randomUUID() }, payload: { reason: 'No autorizado' } })).statusCode, 403);
    assert.equal((await actor.inject({ method: 'POST', url: `/api/clients/${client.id}/plans/${sale.json().id}/cancel`, headers: { 'idempotency-key': randomUUID() }, payload: { reason: 'No autorizado' } })).statusCode, 403);
  }
});

test('idempotency canonicalizes unordered service and rights lists and replays after service archival', async () => {
  const firstService = await createService();
  const secondService = await createService();
  const key = randomUUID();
  const body = planPayload([firstService.id, secondService.id], { rights: [
    { rightType: 'service_access', serviceId: firstService.id },
    { rightType: 'service_access', serviceId: secondService.id },
  ] });
  const first = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: body });
  const reordered = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: { ...body, serviceIds: [...body.serviceIds].reverse(), rights: [...body.rights].reverse() } });
  assert.equal(first.statusCode, 201);
  assert.equal(reordered.statusCode, 200);
  await app.inject({ method: 'POST', url: `/api/plans/${first.json().id}/archive` });
  await app.inject({ method: 'PATCH', url: `/api/services/${firstService.id}/archive` });
  const archivedReplay = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: body });
  assert.equal(archivedReplay.statusCode, 200);
  assert.equal(archivedReplay.json().id, first.json().id);
});

test('idempotency treats an omitted default timezone and its explicit value as the same request', async () => {
  const service = await createService();
  const key = randomUUID();
  const body = planPayload([service.id], { rights: [
    { rightType: 'service_access', serviceId: service.id },
    { rightType: 'period_quota', serviceId: null, quotaScope: 'shared', quantity: 4, period: 'month', periodMode: 'calendar' },
  ] });
  const first = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: body });
  const replay = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: { ...body, rights: body.rights.map((right) => right.rightType === 'period_quota' ? { ...right, timezone: 'Atlantic/Canary' } : right) } });
  assert.equal(first.statusCode, 201, first.body);
  assert.equal(replay.statusCode, 200, replay.body);
});

test('idempotency canonicalization is independent of omitted/null fields, array order, locale and UUID casing', async () => {
  const service = await createService();
  const key = randomUUID();
  const body = planPayload([service.id], { rights: [
    { rightType: 'period_quota', quotaScope: 'shared', quantity: 4, period: 'month', periodMode: 'calendar' },
    { rightType: 'period_quota', serviceId: null, quotaScope: 'shared', quantity: 4, period: 'week', periodMode: 'calendar' },
  ] });
  const first = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: body });
  const alternate = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: {
    ...body, serviceIds: [service.id.toUpperCase()], rights: [
      { rightType: 'period_quota', serviceId: null, quotaScope: 'shared', quantity: 4, period: 'week', periodMode: 'calendar' },
      { rightType: 'period_quota', quotaScope: 'shared', quantity: 4, period: 'month', periodMode: 'calendar' },
    ],
  } });
  assert.equal(first.statusCode, 201, first.body);
  assert.equal(alternate.statusCode, 200, alternate.body);
  assert.equal(alternate.json().id, first.json().id);
  assert.equal(planInput.safeParse({ ...body, serviceIds: [service.id, service.id.toUpperCase()] }).success, false, 'case variants of the same UUID are duplicate services');
});

test('concurrent duplicate plan names serialize to one creation and one conflict', async () => {
  const service = await createService();
  const name = `Concurrent ${randomUUID()}`;
  const submit = () => app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': randomUUID() }, payload: planPayload([service.id], { name }) });
  const responses = await Promise.all([submit(), submit()]);
  assert.deepEqual(responses.map((item) => item.statusCode).sort(), [201, 409]);
  assert.equal((await sql`SELECT count(*)::int AS count FROM plans WHERE name=${name}`).at(0).count, 1);
});

test('concurrent requests with one idempotency key create and return one plan', async () => {
  const service = await createService();
  const key = randomUUID();
  const body = planPayload([service.id]);
  const submit = () => app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: body });
  const responses = await Promise.all([submit(), submit()]);
  assert.deepEqual(responses.map((item) => item.statusCode).sort(), [200, 201]);
  assert.equal(responses[0].json().id, responses[1].json().id);
  assert.equal((await sql`SELECT count(*)::int AS count FROM plans WHERE idempotency_key=${key}`).at(0).count, 1);
});

test('concurrent global and service-specific quota inserts cannot create an overlap', async () => {
  const service = await createService();
  const { response } = await createPlan([service.id]);
  const planId = response.json().id;
  const inserts = [
    sql.begin((tx) => tx`INSERT INTO plan_rights(plan_id,plan_version,right_type,quota_scope,quantity,period) VALUES (${planId},1,'sessions_quota','shared',8,NULL)`),
    sql.begin((tx) => tx`INSERT INTO plan_rights(plan_id,plan_version,right_type,service_id,quota_scope,quantity,period) VALUES (${planId},1,'sessions_quota',${service.id},'per_service',4,NULL)`),
  ];
  const results = await Promise.allSettled(inserts);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.code === '23514').length, 1);
  assert.equal((await sql`SELECT count(*)::int AS count FROM plan_rights WHERE plan_id=${planId} AND right_type='sessions_quota'`).at(0).count, 1);
});

test('concurrent migration calls serialize safely against the existing migration ledger', async () => {
  const results = await Promise.all([migrateDatabase(sql), migrateDatabase(sql)]);
  assert.deepEqual(results[0].map((row) => [row.name, row.checksum.trim()]), results[1].map((row) => [row.name, row.checksum.trim()]));
});

test('concurrent first-run migrators safely initialize a fresh database', async () => {
  const databaseName = `migration_race_${randomUUID().replaceAll('-', '')}`;
  const admin = postgres(process.env.DATABASE_URL, { max: 2, connect_timeout: 5 });
  const databaseUrl = new URL(process.env.DATABASE_URL);
  databaseUrl.pathname = `/${databaseName}`;
  let first;
  let second;
  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    first = postgres(databaseUrl.toString(), { max: 2, connect_timeout: 5 });
    second = postgres(databaseUrl.toString(), { max: 2, connect_timeout: 5 });
    const results = await Promise.all([migrateDatabase(first), migrateDatabase(second)]);
    assert.deepEqual(results[0].map((row) => [row.name, row.checksum.trim()]), results[1].map((row) => [row.name, row.checksum.trim()]));
    assert.ok(results[0].length > 0);
  } finally {
    await Promise.all([first?.end(), second?.end()]);
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }
});

test('service archival racing plan activation preserves active-plan service integrity', async () => {
  const service = await createService();
  const { response } = await createPlan([service.id]);
  const planId = response.json().id;
  const [activated, archived] = await Promise.all([
    app.inject({ method: 'POST', url: `/api/plans/${planId}/activate` }),
    app.inject({ method: 'PATCH', url: `/api/services/${service.id}/archive` }),
  ]);
  const [planRow] = await sql`SELECT status FROM plans WHERE id=${planId}`;
  const [serviceRow] = await sql`SELECT status FROM services WHERE id=${service.id}`;
  assert.ok((planRow.status === 'active' && serviceRow.status === 'active') || (planRow.status === 'draft' && serviceRow.status === 'archived'));
  assert.equal(activated.statusCode === 200 && archived.statusCode === 200, false, 'both mutually exclusive state transitions must not succeed');
});

test('service archival racing plan creation can leave only a non-activatable draft', async () => {
  const service = await createService();
  const key = randomUUID();
  const body = planPayload([service.id]);
  const [created, archived] = await Promise.all([
    app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: body }),
    app.inject({ method: 'PATCH', url: `/api/services/${service.id}/archive` }),
  ]);
  assert.ok(created.statusCode === 201 || created.statusCode === 404 || created.statusCode === 409);
  assert.ok(archived.statusCode === 200 || archived.statusCode === 409);
  if (created.statusCode === 201) {
    const planId = created.json().id;
    const [state] = await sql`SELECT p.status AS plan_status,s.status AS service_status FROM plans p JOIN plan_services ps ON ps.plan_id=p.id AND ps.plan_version=p.current_version JOIN services s ON s.id=ps.service_id WHERE p.id=${planId}`;
    assert.ok(state.plan_status === 'draft' || (state.plan_status === 'active' && state.service_status === 'active'));
    if (state.service_status === 'archived') assert.equal((await app.inject({ method: 'POST', url: `/api/plans/${planId}/activate` })).statusCode, 409);
  }
});

test('service creation racing area archival never creates an available service in an archived area', async () => {
  const area = await app.inject({ method: 'POST', url: '/api/areas', payload: { name: `Race area ${randomUUID()}` } });
  assert.equal(area.statusCode, 201);
  const [created, archived] = await Promise.all([
    app.inject({ method: 'POST', url: '/api/services', payload: { name: `Race service ${randomUUID()}`, areaId: area.json().id, status: 'active' } }),
    app.inject({ method: 'PATCH', url: `/api/areas/${area.json().id}/archive` }),
  ]);
  const [areaRow] = await sql`SELECT status FROM areas WHERE id=${area.json().id}`;
  const available = await sql`SELECT count(*)::int AS count FROM services WHERE area_id=${area.json().id} AND status <> 'archived'`;
  assert.equal(areaRow.status === 'archived' ? available[0].count : 0, 0);
  assert.ok(created.statusCode === 201 || created.statusCode === 404);
  assert.ok(archived.statusCode === 200 || archived.statusCode === 409);
});

test('active plan version and rights are immutable while archival preserves the definition', async () => {
  const service = await createService();
  const { response } = await createPlan([service.id], { rights: [{ rightType: 'sessions_quota', serviceId: service.id, quotaScope: 'per_service', quantity: 8 }] });
  const plan = response.json();
  const activated = await app.inject({ method: 'POST', url: `/api/plans/${plan.id}/activate` });
  assert.equal(activated.statusCode, 200);
  assert.equal(activated.json().status, 'active');
  assert.ok((await sql`SELECT frozen_at FROM plan_versions WHERE plan_id=${plan.id} AND version=1`).at(0).frozen_at);
  await assert.rejects(sql`UPDATE plan_rights SET quantity=9 WHERE plan_id=${plan.id}`, (error) => error.code === '55000');
  await assert.rejects(sql`INSERT INTO plan_rights(plan_id,plan_version,right_type,service_id,quota_scope,quantity) VALUES (${plan.id},1,'sessions_quota',${service.id},'per_service',2)`, (error) => error.code === '55000');
  await assert.rejects(sql`INSERT INTO plan_services(plan_id,plan_version,service_id) VALUES (${plan.id},1,${service.id})`, (error) => error.code === '55000');
  await assert.rejects(sql`UPDATE plans SET current_version=2 WHERE id=${plan.id}`, (error) => error.code === '55000');
  await assert.rejects(sql`UPDATE plan_versions SET frozen_at=NULL WHERE plan_id=${plan.id} AND version=1`, (error) => error.code === '55000');
  await assert.rejects(sql`UPDATE plan_versions SET kind='session_pack' WHERE plan_id=${plan.id} AND version=1`, (error) => error.code === '55000');
  await assert.rejects(sql`DELETE FROM plans WHERE id=${plan.id}`, (error) => error.code === '55000');
  const blockedArchive = await app.inject({ method: 'PATCH', url: `/api/services/${service.id}/archive` });
  assert.equal(blockedArchive.statusCode, 409);
  assert.equal((await sql`SELECT status FROM services WHERE id=${service.id}`).at(0).status, 'active');
  await app.inject({ method: 'POST', url: `/api/plans/${plan.id}/archive` });
  await assert.rejects(sql`UPDATE plan_rights SET quantity=9 WHERE plan_id=${plan.id}`, (error) => error.code === '55000');
  const archived = await app.inject({ method: 'PATCH', url: `/api/services/${service.id}/archive` });
  assert.equal(archived.statusCode, 200);
  assert.equal((await sql`SELECT count(*)::int AS count FROM plan_services WHERE service_id=${service.id}`).at(0).count, 1);
});

test('IANA timezone validation rejects malformed zones and area archival preserves available services', async () => {
  const service = await createService();
  const { response: plan } = await createPlan([service.id]);
  await assert.rejects(sql`INSERT INTO plan_versions(plan_id,version,kind,renewal_cadence,timezone) VALUES (${plan.json().id},2,'recurring','monthly','Mars/Olympus')`, (error) => error.code === '23514');
  await assert.rejects(sql`INSERT INTO plan_rights(plan_id,plan_version,right_type,quantity,quota_scope,period,period_mode,timezone) VALUES (${plan.json().id},1,'period_quota',2,'shared','month','calendar','Mars/Olympus')`, (error) => error.code === '23514');
  await assert.rejects(sql`INSERT INTO plan_rights(plan_id,plan_version,right_type,quantity,quota_scope,period,period_mode,timezone) VALUES (${plan.json().id},1,'period_quota',2,'shared','month','calendar','Europe/Canary')`, (error) => error.code === '23514');
  const blocked = await app.inject({ method: 'PATCH', url: `/api/areas/${service.areaId}/archive` });
  assert.equal(blocked.statusCode, 409);
});

test('database constraints protect complete versions and catalog tables from truncate bypass', async () => {
  const service = await createService();
  const { response: plan } = await createPlan([service.id]);
  await assert.rejects(sql.begin(async (tx) => {
    await tx`INSERT INTO plan_versions(plan_id,version,kind,renewal_cadence) VALUES (${plan.json().id},2,'recurring','monthly')`;
  }), (error) => error.code === '23514');
  await assert.rejects(sql`TRUNCATE plan_rights`, (error) => ['55000','0A000'].includes(error.code), 'catalog truncate stays blocked by the catalog guard or booking-history foreign key');
  await assert.rejects(sql`TRUNCATE plan_versions CASCADE`, (error) => error.code === '55000');
  for (const table of ['areas', 'services', 'plans', 'plan_services']) {
    await assert.rejects(sql.unsafe(`TRUNCATE ${table} CASCADE`), (error) => error.code === '55000', `${table} must reject TRUNCATE CASCADE`);
  }
});

test('archiving a draft freezes its definition and preserves its current version pointer', async () => {
  const service = await createService();
  const { response: plan } = await createPlan([service.id], { rights: [{ rightType: 'sessions_quota', serviceId: service.id, quotaScope: 'per_service', quantity: 4 }] });
  const archived = await app.inject({ method: 'POST', url: `/api/plans/${plan.json().id}/archive` });
  assert.equal(archived.statusCode, 200);
  assert.ok((await sql`SELECT frozen_at FROM plan_versions WHERE plan_id=${plan.json().id} AND version=1`).at(0).frozen_at);
  await assert.rejects(sql`UPDATE plan_rights SET quantity=5 WHERE plan_id=${plan.json().id}`, (error) => error.code === '55000');
  await assert.rejects(sql`UPDATE plans SET current_version=2 WHERE id=${plan.json().id}`, (error) => error.code === '55000');
});

test('archived plans remain visible to catalog managers and can be reactivated without changing the frozen version', async () => {
  const areaResponse = await app.inject({ method: 'POST', url: '/api/areas', payload: { name: `Área plan histórico ${randomUUID()}` } });
  assert.equal(areaResponse.statusCode, 201, areaResponse.body);
  const serviceResponse = await app.inject({ method: 'POST', url: '/api/services', payload: { name: `Servicio plan histórico ${randomUUID()}`, areaId: areaResponse.json().id, status: 'active' } });
  assert.equal(serviceResponse.statusCode, 201, serviceResponse.body);
  const service = serviceResponse.json();
  const { response: plan } = await createPlan([service.id]);
  const id = plan.json().id;
  assert.equal((await app.inject({ method: 'POST', url: `/api/plans/${id}/activate` })).statusCode, 200);
  const archived = await app.inject({ method: 'POST', url: `/api/plans/${id}/archive` });
  assert.equal(archived.statusCode, 200);
  const normalList = await app.inject({ method: 'GET', url: `/api/services/${service.id}/plans` });
  const archivedList = await app.inject({ method: 'GET', url: `/api/services/${service.id}/plans?includeArchived=true` });
  const trainerArchivedList = await clientsTrainerApp.inject({ method: 'GET', url: `/api/services/${service.id}/plans?includeArchived=true` });
  assert.equal(normalList.json().some((item) => item.id === id), false);
  assert.equal(archivedList.statusCode, 200);
  const listedPlan = archivedList.json().find((item) => item.id === id);
  assert.equal(listedPlan?.status, 'archived');
  assert.equal(listedPlan?.services[0]?.areaStatus, 'active');
  assert.equal(trainerArchivedList.statusCode, 403, 'archived catalog access requires pricing-management permission');

  const before = await sql`SELECT current_version AS version,(SELECT frozen_at FROM plan_versions WHERE plan_id=${id} AND version=plans.current_version) AS frozen_at FROM plans WHERE id=${id}`;
  const reactivated = await app.inject({ method: 'POST', url: `/api/plans/${id}/activate` });
  assert.equal(reactivated.statusCode, 200, reactivated.body);
  assert.equal(reactivated.json().status, 'active');
  const after = await sql`SELECT current_version AS version,(SELECT frozen_at FROM plan_versions WHERE plan_id=${id} AND version=plans.current_version) AS frozen_at FROM plans WHERE id=${id}`;
  assert.deepEqual(after, before, 'reactivation preserves the version pointer and frozen definition');
  assert.equal((await app.inject({ method: 'GET', url: `/api/services/${service.id}/plans` })).json().some((item) => item.id === id), true);

});

test('service right counts include only global or service-targeted rights', async () => {
  const first = await createService();
  const second = await createService();
  const created = await createPlan([first.id, second.id], { rights: [
    { rightType: 'service_access', serviceId: first.id },
    { rightType: 'sessions_quota', serviceId: first.id, quotaScope: 'per_service', quantity: 3 },
    { rightType: 'service_access', serviceId: second.id },
  ] });
  assert.equal(created.response.statusCode, 201, created.response.body);
  const rows = await app.inject({ method: 'GET', url: '/api/services' });
  const byId = new Map(rows.json().map((row) => [row.id, row]));
  assert.equal(byId.get(first.id).rightCount, 2);
  assert.equal(byId.get(second.id).rightCount, 1);
});

test('plans linked to archived services remain manageable but cannot be assigned to new plans', async () => {
  const service = await createService();
  const plan = await createPlan([service.id]);
  assert.equal(plan.response.statusCode, 201, plan.response.body);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/services/${service.id}/archive` })).statusCode, 200);
  const invalidId = await app.inject({ method: 'GET', url: '/api/services/not-a-uuid/plans' });
  const missing = await app.inject({ method: 'GET', url: `/api/services/${randomUUID()}/plans` });
  const archivedRead = await app.inject({ method: 'GET', url: `/api/services/${service.id}/plans` });
  const trainerRead = await clientsTrainerApp.inject({ method: 'GET', url: `/api/services/${service.id}/plans` });
  const createArchived = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': randomUUID() }, payload: planPayload([service.id]) });
  assert.equal(invalidId.statusCode, 400);
  assert.deepEqual(invalidId.json(), { error: 'invalid_service_id' });
  assert.equal(missing.statusCode, 404);
  assert.equal(archivedRead.statusCode, 200, archivedRead.body);
  assert.equal(archivedRead.json().some((item) => item.id === plan.response.json().id), true);
  assert.equal(archivedRead.json()[0].services[0].status, 'archived');
  assert.equal(trainerRead.statusCode, 409);
  assert.equal(createArchived.statusCode, 409);
});

test('database violations map to conflict/validation and availability statuses consistently', () => {
  assert.equal(mapDatabaseError({ code: '23505' }).status, 409);
  assert.equal(mapDatabaseError({ code: '23514' }).status, 422);
  assert.equal(mapDatabaseError({ code: '23502' }).status, 422);
  assert.equal(mapDatabaseError({ code: '22023' }).status, 422);
  assert.equal(mapDatabaseError({ code: '08006' }).status, 503);
  assert.equal(mapDatabaseError({ code: 'XX000' }).status, 500);
});

test('economic charges and split payments are permissioned, idempotent, partial and auditable', async () => {
  const clientResponse = await createClientRequest(clientsAdminApp, { firstName: 'Economics', lastName: `QA ${randomUUID()}`, email: null, phone: null });
  assert.equal(clientResponse.statusCode, 201, clientResponse.body);
  const client = clientResponse.json();
  const chargeKey = randomUUID();
  const chargePayload = { clientId: client.id, concept: 'Cuota de prueba', amountCents: 10000, dueOn: '2099-12-10' };
  const chargeResponse = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/charges', headers: { 'idempotency-key': chargeKey }, payload: chargePayload });
  assert.equal(chargeResponse.statusCode, 201, chargeResponse.body);
  const replayCharge = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/charges', headers: { 'idempotency-key': chargeKey }, payload: chargePayload });
  assert.equal(replayCharge.statusCode, 200);
  assert.equal(replayCharge.json().id, chargeResponse.json().id);
  const denied = await clientsTrainerApp.inject({ method: 'POST', url: '/api/economics/payments', headers: { 'idempotency-key': randomUUID() }, payload: { chargeId: chargeResponse.json().id, splits: [{ method: 'card', amountCents: 100 }] } });
  assert.equal(denied.statusCode, 403);

  const paymentKey = randomUUID();
  const paymentPayload = { chargeId: chargeResponse.json().id, splits: [{ method: 'cash', amountCents: 2000 }, { method: 'card', amountCents: 3000 }] };
  const cashSession = await clientsAdminApp.inject({ method: 'GET', url: '/api/economics/cash/today' });
  assert.equal(cashSession.statusCode, 200, cashSession.body);
  assert.equal(cashSession.json().session.status, 'open');
  const payment = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/payments', headers: { 'idempotency-key': paymentKey }, payload: paymentPayload });
  assert.equal(payment.statusCode, 201, payment.body);
  const paymentReplay = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/payments', headers: { 'idempotency-key': paymentKey }, payload: paymentPayload });
  assert.equal(paymentReplay.statusCode, 200);
  assert.equal(paymentReplay.json().id, payment.json().id);
  const balanceAfterPartPayment = await clientsAdminApp.inject({ method: 'GET', url: `/api/economics/charges?clientId=${client.id}` });
  assert.equal(Number(balanceAfterPartPayment.json().items[0].balanceCents), 5000);
  const client360 = await clientsAdminApp.inject({ method: 'GET', url: `/api/clients/${client.id}` });
  assert.equal(client360.json().summary.payments.dataState, 'ready');
  assert.equal(Number(client360.json().summary.payments.data.balanceCents), 5000);
  const settings = await clientsAdminApp.inject({ method: 'GET', url: '/api/economics/settings' });
  assert.equal(settings.json().timezone, 'Atlantic/Canary');
  assert.equal(settings.json().debtBlocksNewReservations, false);

  const refund = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/refunds', headers: { 'idempotency-key': randomUUID() }, payload: { transactionId: payment.json().id, amountCents: 1000, method: 'card', note: 'Ajuste QA' } });
  assert.equal(refund.statusCode, 201, refund.body);
  const balanceAfterRefund = await clientsAdminApp.inject({ method: 'GET', url: `/api/economics/charges?clientId=${client.id}` });
  assert.equal(Number(balanceAfterRefund.json().items[0].balanceCents), 6000);
  const [audit] = await sql`SELECT count(*)::int AS count FROM economic_audit_events WHERE client_id=${client.id}`;
  assert.equal(audit.count, 3);
  const cashSnapshot = await clientsAdminApp.inject({ method: 'GET', url: '/api/economics/cash/today' });
  const closedCash = await clientsAdminApp.inject({ method: 'POST', url: `/api/economics/cash/${cashSession.json().session.id}/close`, payload: { countedDenominations: cashCount(await expectedCashCents(sql, cashSession.json().session.id)) } });
  assert.equal(closedCash.statusCode, 200, closedCash.body);
});

test('concurrent partial payments serialize at the charge and cannot over-collect', async () => {
  const clientResponse = await createClientRequest(clientsAdminApp, { firstName: 'Race', lastName: `QA ${randomUUID()}`, email: null, phone: null });
  const client = clientResponse.json();
  const charge = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/charges', headers: { 'idempotency-key': randomUUID() }, payload: { clientId: client.id, concept: 'Concurrency test', amountCents: 5000, dueOn: '2099-12-10' } });
  assert.equal(charge.statusCode, 201, charge.body);
  const requests = [4000, 4000].map(amountCents => clientsAdminApp.inject({ method: 'POST', url: '/api/economics/payments', headers: { 'idempotency-key': randomUUID() }, payload: { chargeId: charge.json().id, splits: [{ method: 'card', amountCents }] } }));
  const results = await Promise.all(requests);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [201, 409]);
  const balance = await clientsAdminApp.inject({ method: 'GET', url: `/api/economics/charges?clientId=${client.id}` });
  assert.equal(Number(balance.json().items[0].balanceCents), 1000);
});

test('fully refunded charges are final, excluded from debt, and retain immutable payment history', async () => {
  const eligibleAdmin = buildServer(process.env.DATABASE_URL, {
    authorizationResolver: async () => ({ actorId: 'qa-refund-booking', role: 'admin' }),
    bookingEligibilityResolver: async () => ({ eligible: true, entitlementId: 'qa-entitlement' }),
  });
  try {
    const client = (await createClientRequest(clientsAdminApp, { firstName: 'Refund', lastName: `QA ${randomUUID()}`, email: null, phone: null })).json();
    const beforeOverview = await clientsAdminApp.inject({ method: 'GET', url: '/api/economics/overview' });
    assert.equal(beforeOverview.statusCode, 200, beforeOverview.body);
    const charge = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/charges', headers: { 'idempotency-key': randomUUID() }, payload: { clientId: client.id, concept: 'Cargo devuelto', amountCents: 5000, dueOn: '2000-01-01' } });
    assert.equal(charge.statusCode, 201, charge.body);
    const payment = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/payments', headers: { 'idempotency-key': randomUUID() }, payload: { chargeId: charge.json().id, splits: [{ method: 'card', amountCents: 5000 }] } });
    assert.equal(payment.statusCode, 201, payment.body);
    const paid = await clientsAdminApp.inject({ method: 'GET', url: `/api/economics/charges?clientId=${client.id}` });
    assert.equal(paid.json().items[0].status, 'paid');

    const refunds = await Promise.all([1, 2].map(() => clientsAdminApp.inject({ method: 'POST', url: '/api/economics/refunds', headers: { 'idempotency-key': randomUUID() }, payload: { transactionId: payment.json().id, amountCents: 5000, method: 'card', note: 'Devolución total QA' } })));
    assert.deepEqual(refunds.map(response => response.statusCode).sort(), [201, 409]);

    const charges = await clientsAdminApp.inject({ method: 'GET', url: `/api/economics/charges?clientId=${client.id}` });
    assert.equal(charges.statusCode, 200);
    assert.equal(charges.json().items[0].status, 'refunded');
    assert.equal(Number(charges.json().items[0].balanceCents), 0);
    const due = await clientsAdminApp.inject({ method: 'GET', url: `/api/economics/charges?clientId=${client.id}&status=due` });
    assert.equal(due.json().total, 0);
    const clientEconomics = await clientsAdminApp.inject({ method: 'GET', url: `/api/clients/${client.id}/economics` });
    assert.equal(Number(clientEconomics.json().balanceCents), 0);
    assert.equal(Number(clientEconomics.json().overdueCount), 0);
    assert.equal(clientEconomics.json().items[0].status, 'refunded');
    assert.equal(Number(clientEconomics.json().items[0].balanceCents), 0);
    const overview = await clientsAdminApp.inject({ method: 'GET', url: '/api/economics/overview' });
    assert.equal(overview.statusCode, 200, overview.body);
    assert.equal(overview.json().overdueCount, beforeOverview.json().overdueCount);
    assert.equal(Number(overview.json().overdueCents), Number(beforeOverview.json().overdueCents));
    const exportAfterRefund = await clientsAdminApp.inject({ method: 'GET', url: '/api/economics/export' });
    const exportedRefund = exportAfterRefund.json().items.find(item => item.id === charge.json().id);
    assert.equal(exportedRefund.status, 'refunded');
    assert.equal(Number(exportedRefund.balanceCents), 0);

    const latePayment = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/payments', headers: { 'idempotency-key': randomUUID() }, payload: { chargeId: charge.json().id, splits: [{ method: 'card', amountCents: 100 }] } });
    assert.equal(latePayment.statusCode, 409);
    assert.equal(latePayment.json().error, 'charge_refunded');

    const service = await createService();
    const session = await eligibleAdmin.inject({ method: 'POST', url: '/api/calendar/sessions', payload: { serviceId: service.id, areaId: defaultArea.id, startsAt: '2099-12-10T10:00:00Z', durationMinutes: 45, capacity: 2 } });
    assert.equal(session.statusCode, 201, session.body);
    await clientsAdminApp.inject({ method: 'PATCH', url: '/api/economics/settings', payload: { dueDay: 10, debtBlocksNewReservations: true } });
    const reservation = await eligibleAdmin.inject({ method: 'POST', url: `/api/calendar/sessions/${session.json().id}/reservations`, payload: { clientId: client.id } });
    assert.equal(reservation.statusCode, 201, reservation.body);

    const partialCharge = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/charges', headers: { 'idempotency-key': randomUUID() }, payload: { clientId: client.id, concept: 'Cargo parcialmente devuelto', amountCents: 5000, dueOn: '2099-12-10' } });
    const partialPayment = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/payments', headers: { 'idempotency-key': randomUUID() }, payload: { chargeId: partialCharge.json().id, splits: [{ method: 'card', amountCents: 5000 }] } });
    const partialRefund = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/refunds', headers: { 'idempotency-key': randomUUID() }, payload: { transactionId: partialPayment.json().id, amountCents: 2000, method: 'card', note: 'Devolución parcial QA' } });
    assert.equal(partialRefund.statusCode, 201, partialRefund.body);
    const partialRead = await clientsAdminApp.inject({ method: 'GET', url: `/api/economics/charges?clientId=${client.id}` });
    const partial = partialRead.json().items.find(item => item.id === partialCharge.json().id);
    assert.equal(partial.status, 'pending');
    assert.equal(Number(partial.balanceCents), 2000);
    const exportAfterPartial = await clientsAdminApp.inject({ method: 'GET', url: '/api/economics/export' });
    const exportedPartial = exportAfterPartial.json().items.find(item => item.id === partialCharge.json().id);
    assert.equal(exportedPartial.status, 'pending');
    assert.equal(Number(exportedPartial.balanceCents), 2000);

    const [ledger] = await sql`SELECT count(*)::int AS count, sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END)::bigint AS net FROM economic_transactions WHERE charge_id=${charge.json().id}`;
    assert.equal(ledger.count, 2);
    assert.equal(Number(ledger.net), 0);
    const [audit] = await sql`SELECT count(*)::int AS count FROM economic_audit_events WHERE client_id=${client.id} AND action IN ('payment.recorded','payment.refunded')`;
    assert.equal(audit.count, 4);
  } finally {
    await clientsAdminApp.inject({ method: 'PATCH', url: '/api/economics/settings', payload: { dueDay: 10, debtBlocksNewReservations: false } });
    await eligibleAdmin.close();
  }
});

test('transfer proof cannot collect a fully refunded charge and can still be rejected with intact audit', async () => {
  const client = (await createClientRequest(clientsAdminApp, { firstName: 'Proof', lastName: `QA ${randomUUID()}`, email: null, phone: null })).json();
  const charge = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/charges', headers: { 'idempotency-key': randomUUID() }, payload: { clientId: client.id, concept: 'Cargo con justificante', amountCents: 5000, dueOn: '2099-12-10' } });
  assert.equal(charge.statusCode, 201, charge.body);
  const pdf = Buffer.from('%PDF-1.7\nJustificante QA').toString('base64');
  const proofPayload = { chargeId: charge.json().id, amountCents: 5000, contentType: 'application/pdf', fileName: 'justificante-previo.pdf', base64: pdf };
  const proof = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/transfer-proofs', payload: proofPayload });
  assert.equal(proof.statusCode, 201, proof.body);
  const payment = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/payments', headers: { 'idempotency-key': randomUUID() }, payload: { chargeId: charge.json().id, splits: [{ method: 'card', amountCents: 5000 }] } });
  assert.equal(payment.statusCode, 201, payment.body);
  const refund = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/refunds', headers: { 'idempotency-key': randomUUID() }, payload: { transactionId: payment.json().id, amountCents: 5000, method: 'card', note: 'Devolución total QA' } });
  assert.equal(refund.statusCode, 201, refund.body);

  const newProof = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/transfer-proofs', payload: { ...proofPayload, fileName: 'justificante-nuevo.pdf', base64: Buffer.from('%PDF-1.7\nJustificante posterior').toString('base64') } });
  assert.equal(newProof.statusCode, 409);
  assert.equal(newProof.json().error, 'charge_refunded');
  const validate = await clientsTrainerApp.inject({ method: 'POST', url: `/api/economics/transfer-proofs/${proof.json().id}/review`, payload: { decision: 'validated', note: 'Intento posterior a devolución' } });
  assert.equal(validate.statusCode, 409);
  assert.equal(validate.json().error, 'charge_refunded');
  const [beforeReject] = await sql`SELECT count(*)::int AS count FROM economic_transactions WHERE charge_id=${charge.json().id}`;
  assert.equal(beforeReject.count, 2);
  const [pending] = await sql`SELECT status,transaction_id AS "transactionId" FROM economic_transfer_proofs WHERE id=${proof.json().id}`;
  assert.equal(pending.status, 'pending_validation');
  assert.equal(pending.transactionId, null);

  const reject = await clientsTrainerApp.inject({ method: 'POST', url: `/api/economics/transfer-proofs/${proof.json().id}/review`, payload: { decision: 'rejected', note: 'El cargo ya fue devuelto completamente' } });
  assert.equal(reject.statusCode, 200, reject.body);
  assert.equal(reject.json().status, 'rejected');
  const [afterReject] = await sql`SELECT count(*)::int AS count, sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END)::bigint AS net FROM economic_transactions WHERE charge_id=${charge.json().id}`;
  assert.equal(afterReject.count, 2);
  assert.equal(Number(afterReject.net), 0);
  const [proofAudit] = await sql`SELECT count(*) FILTER(WHERE action='transfer_proof.submitted')::int AS submitted,count(*) FILTER(WHERE action='transfer_proof.rejected')::int AS rejected,count(*) FILTER(WHERE action='payment.transfer_validated')::int AS validated FROM economic_audit_events WHERE resource_id=${proof.json().id} OR (action IN ('payment.recorded','payment.refunded') AND client_id=${client.id})`;
  assert.equal(proofAudit.submitted, 1);
  assert.equal(proofAudit.rejected, 1);
  assert.equal(proofAudit.validated, 0);
});

test('optional debt restriction affects new reservations only when explicitly enabled', async () => {
  const eligibleAdmin = buildServer(process.env.DATABASE_URL, {
    authorizationResolver: async () => ({ actorId: 'qa-economics-admin', role: 'admin' }),
    bookingEligibilityResolver: async () => ({ eligible: true, entitlementId: 'qa-entitlement' }),
  });
  try {
    const clientResponse = await createClientRequest(clientsAdminApp, { firstName: 'Debt', lastName: `QA ${randomUUID()}`, email: null, phone: null });
    const client = clientResponse.json();
    const charge = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/charges', headers: { 'idempotency-key': randomUUID() }, payload: { clientId: client.id, concept: 'Vencido de prueba', amountCents: 1000, dueOn: '2000-01-01' } });
    assert.equal(charge.statusCode, 201);
    const service = await createService();
    const session = await eligibleAdmin.inject({ method: 'POST', url: '/api/calendar/sessions', payload: { serviceId: service.id, areaId: defaultArea.id, startsAt: '2099-12-10T10:00:00Z', durationMinutes: 45, capacity: 4 } });
    assert.equal(session.statusCode, 201, session.body);
    await clientsAdminApp.inject({ method: 'PATCH', url: '/api/economics/settings', payload: { dueDay: 10, debtBlocksNewReservations: true } });
    const blocked = await eligibleAdmin.inject({ method: 'POST', url: `/api/calendar/sessions/${session.json().id}/reservations`, payload: { clientId: client.id } });
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.json().error, 'overdue_balance_blocks_booking');
    await clientsAdminApp.inject({ method: 'PATCH', url: '/api/economics/settings', payload: { dueDay: 10, debtBlocksNewReservations: false } });
    const allowed = await eligibleAdmin.inject({ method: 'POST', url: `/api/calendar/sessions/${session.json().id}/reservations`, payload: { clientId: client.id } });
    assert.equal(allowed.statusCode, 201, allowed.body);
  } finally { await eligibleAdmin.close(); }
});

test('debt restriction permits waitlist and Trainer can make a reasoned audited booking exception', async () => {
  const eligibleTrainer=buildServer(process.env.DATABASE_URL,{authorizationResolver:async()=>({actorId:'qa-trainer-debt-override',role:'trainer'}),bookingEligibilityResolver:async()=>({eligible:true,entitlementId:'qa-entitlement'})});
  const eligibleAdmin=buildServer(process.env.DATABASE_URL,{authorizationResolver:async()=>({actorId:'qa-admin-debt-override',role:'admin'}),bookingEligibilityResolver:async()=>({eligible:true,entitlementId:'qa-entitlement'})});
  try {
    const debtClient=(await createClientRequest(clientsAdminApp,{firstName:'Debt',lastName:`QA ${randomUUID()}`,email:null,phone:null})).json();
    const first=(await createClientRequest(clientsAdminApp,{firstName:'Seat',lastName:`QA ${randomUUID()}`,email:null,phone:null})).json();
    await clientsAdminApp.inject({method:'POST',url:'/api/economics/charges',headers:{'idempotency-key':randomUUID()},payload:{clientId:debtClient.id,concept:'Deuda vencida',amountCents:1000,dueOn:'2000-01-01'}});
    const service=await createService();
    const session=await eligibleAdmin.inject({method:'POST',url:'/api/calendar/sessions',payload:{serviceId:service.id,areaId:defaultArea.id,startsAt:'2099-12-10T10:00:00Z',durationMinutes:45,capacity:1}});
    assert.equal(session.statusCode,201,session.body);
    await clientsAdminApp.inject({method:'PATCH',url:'/api/economics/settings',payload:{dueDay:10,debtBlocksNewReservations:true}});
    const firstBooking=await eligibleAdmin.inject({method:'POST',url:`/api/calendar/sessions/${session.json().id}/reservations`,payload:{clientId:first.id}});
    assert.equal(firstBooking.statusCode,201,firstBooking.body);
    const blocked=await eligibleAdmin.inject({method:'POST',url:`/api/calendar/sessions/${session.json().id}/reservations`,payload:{clientId:debtClient.id}});
    assert.equal(blocked.statusCode,409);
    assert.equal(blocked.json().error,'overdue_balance_blocks_booking');
    const waitlist=await eligibleAdmin.inject({method:'POST',url:`/api/calendar/sessions/${session.json().id}/waitlist`,payload:{clientId:debtClient.id}});
    assert.equal(waitlist.statusCode,201,waitlist.body);
    await eligibleAdmin.inject({method:'PATCH',url:`/api/calendar/waitlist/${waitlist.json().id}/cancel`,payload:{}});
    const exception=await eligibleTrainer.inject({method:'POST',url:`/api/calendar/sessions/${session.json().id}/reservations`,payload:{clientId:debtClient.id,overbook:true,overrideDebt:true,overrideReason:'Excepción aprobada por dirección'}});
    assert.equal(exception.statusCode,201,exception.body);
    const [overrideAudit]=await sql`SELECT details->>'reason' AS reason FROM calendar_audit_events WHERE action='reservation.debt_override' AND client_id=${debtClient.id} ORDER BY occurred_at DESC LIMIT 1`;
    assert.equal(overrideAudit.reason,'Excepción aprobada por dirección');
  } finally {
    await clientsAdminApp.inject({method:'PATCH',url:'/api/economics/settings',payload:{dueDay:10,debtBlocksNewReservations:false}});
    await eligibleTrainer.close();await eligibleAdmin.close();
  }
});

test('D113 gates payment collection and D102 transfer validation remains independent of cash', async () => {
  const open = await clientsAdminApp.inject({ method: 'GET', url: '/api/economics/cash/today' });
  assert.equal(open.statusCode, 200, open.body);
  const closed = await clientsAdminApp.inject({ method: 'POST', url: `/api/economics/cash/${open.json().session.id}/close`, payload: { countedDenominations: cashCount(await expectedCashCents(sql, open.json().session.id)) } });
  assert.equal(closed.statusCode, 200, closed.body);

  const client = (await createClientRequest(clientsAdminApp, { firstName: 'D113', lastName: `Gate ${randomUUID()}`, email: null, phone: null })).json();
  const charge = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/charges', headers: { 'idempotency-key': randomUUID() }, payload: { clientId: client.id, concept: 'D113 QA', amountCents: 10000, dueOn: '2099-12-10' } });
  assert.equal(charge.statusCode, 201, charge.body);
  for (const method of ['cash', 'card', 'transfer', 'direct_debit', 'other']) {
    const response = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/payments', headers: { 'idempotency-key': randomUUID() }, payload: { chargeId: charge.json().id, splits: [{ method, amountCents: 1000 }] } });
    assert.equal(response.statusCode, 409, `${method}: ${response.body}`);
    assert.equal(response.json().error, 'cash_session_required');
  }
  const [noPayment] = await sql`SELECT count(*)::int AS count FROM economic_transactions WHERE charge_id=${charge.json().id}`;
  assert.equal(noPayment.count, 0);

  const service = await createService(`D113 ${randomUUID()}`);
  const plan = await createPlan([service.id]);
  assert.equal(plan.response.statusCode, 201, plan.response.body);
  assert.equal((await app.inject({ method: 'POST', url: `/api/plans/${plan.response.json().id}/activate` })).statusCode, 200);
  const assignment = await clientsAdminApp.inject({ method: 'POST', url: `/api/clients/${client.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: { planId: plan.response.json().id, startsOn: '2026-10-25', endsOn: null, dueOn: '2026-10-25', amountCents: 5000, paymentAmountCents: 5000, paymentMethod: 'card' } });
  assert.equal(assignment.statusCode, 409, assignment.body);
  assert.equal(assignment.json().error, 'cash_session_required');
  const [noAssignment] = await sql`SELECT count(*)::int AS count FROM client_plan_assignments WHERE client_id=${client.id}`;
  assert.equal(noAssignment.count, 0);

  const proof = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/transfer-proofs', payload: { chargeId: charge.json().id, amountCents: 1000, contentType: 'application/pdf', fileName: 'd113.pdf', base64: Buffer.from('%PDF-1.7\nD113').toString('base64') } });
  assert.equal(proof.statusCode, 201, proof.body);
  const validatedWithoutShift = await clientsTrainerApp.inject({ method: 'POST', url: `/api/economics/transfer-proofs/${proof.json().id}/review`, payload: { decision: 'validated', note: 'Revisión D102 sin exigir caja' } });
  assert.equal(validatedWithoutShift.statusCode, 200, validatedWithoutShift.body);
  const [validatedProof] = await sql`SELECT status,transaction_id FROM economic_transfer_proofs WHERE id=${proof.json().id}`;
  assert.equal(validatedProof.status, 'validated');
  assert.ok(validatedProof.transaction_id);
  const [transferTransaction] = await sql`SELECT cash_session_id,kind FROM economic_transactions WHERE id=${validatedProof.transaction_id}`;
  assert.equal(transferTransaction.kind, 'payment');
  assert.equal(transferTransaction.cash_session_id, null, 'D102 transfer validation is not attributed to a cash shift');

  const reopened = await ownerPanelApp.inject({ method: 'POST', url: `/api/economics/cash/${open.json().session.id}/owner-reopen`, payload: { custodianActorId:'qa-admin', openingDenominations: cashCount(0) } });
  assert.equal(reopened.statusCode, 200, reopened.body);
  const paid = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/payments', headers: { 'idempotency-key': randomUUID() }, payload: { chargeId: charge.json().id, splits: [{ method: 'card', amountCents: 1000 }] } });
  assert.equal(paid.statusCode, 201, paid.body);
  const [linked] = await sql`SELECT cash_session_id FROM economic_transactions WHERE id=${paid.json().id}`;
  assert.equal(linked.cash_session_id, reopened.json().id);
});

test('D113 requires an open shift for every refund method and links the refund to that shift', async () => {
  const client = (await createClientRequest(clientsAdminApp, { firstName: 'Refund D113', lastName: randomUUID(), email: null, phone: null })).json();
  const charge = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/charges', headers: { 'idempotency-key': randomUUID() }, payload: { clientId: client.id, concept: 'Reembolso D113', amountCents: 10000, dueOn: '2099-12-10' } });
  const payment = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/payments', headers: { 'idempotency-key': randomUUID() }, payload: { chargeId: charge.json().id, splits: [{ method: 'card', amountCents: 5000 }] } });
  assert.equal(payment.statusCode, 201, payment.body);
  const current = await clientsAdminApp.inject({ method: 'GET', url: '/api/economics/cash/today' });
  const close = await clientsAdminApp.inject({ method: 'POST', url: `/api/economics/cash/${current.json().session.id}/close`, payload: { countedDenominations: cashCount(await expectedCashCents(sql, current.json().session.id)) } });
  assert.equal(close.statusCode, 200, close.body);

  for (const method of ['cash', 'card', 'transfer', 'direct_debit', 'other']) {
    const response = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/refunds', headers: { 'idempotency-key': randomUUID() }, payload: { transactionId: payment.json().id, amountCents: 500, method, note: `D113 ${method}` } });
    assert.equal(response.statusCode, 409, `${method}: ${response.body}`);
    assert.equal(response.json().error, 'cash_session_required');
  }
  const [noRefunds] = await sql`SELECT count(*)::int AS count FROM economic_transactions WHERE refund_of=${payment.json().id}`;
  assert.equal(noRefunds.count, 0);

  const opened = await ownerPanelApp.inject({ method: 'POST', url: `/api/economics/cash/${current.json().session.id}/owner-reopen`, payload: { custodianActorId:'qa-admin', openingDenominations: cashCount(0) } });
  assert.equal(opened.statusCode, 200, opened.body);
  const refund = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/refunds', headers: { 'idempotency-key': randomUUID() }, payload: { transactionId: payment.json().id, amountCents: 500, method: 'card', note: 'D113 tarjeta con caja abierta' } });
  assert.equal(refund.statusCode, 201, refund.body);
  const [linked] = await sql`SELECT cash_session_id FROM economic_transactions WHERE id=${refund.json().id}`;
  assert.equal(linked.cash_session_id, opened.json().id);
});

test('database guard rejects unlinked payments and refunds while D102 validated transfer remains the only NULL-shift exception', async () => {
  const client=(await createClientRequest(clientsAdminApp,{firstName:'DB guard',lastName:randomUUID(),email:null,phone:null})).json();
  const charge=await clientsAdminApp.inject({method:'POST',url:'/api/economics/charges',headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id,concept:'DB guard',amountCents:2000,dueOn:'2099-12-10'}});
  const paymentId=randomUUID(),paymentKey=randomUUID(),paymentHash='a'.repeat(64);
  await assert.rejects(sql.begin(async tx=>{
    await tx`INSERT INTO economic_transactions(id,charge_id,client_id,kind,amount_cents,actor_id,idempotency_key,request_hash,cash_session_id) VALUES (${paymentId},${charge.json().id},${client.id},'payment',500,'qa-db-guard',${paymentKey},${paymentHash},NULL)`;
    await tx`INSERT INTO economic_payment_splits(transaction_id,method,amount_cents) VALUES (${paymentId},'card',500)`;
  }),{code:'23514'});
  const paid=await clientsAdminApp.inject({method:'POST',url:'/api/economics/payments',headers:{'idempotency-key':randomUUID()},payload:{chargeId:charge.json().id,splits:[{method:'card',amountCents:500}]}});
  assert.equal(paid.statusCode,201,paid.body);
  const refundId=randomUUID(),refundKey=randomUUID(),refundHash='b'.repeat(64);
  await assert.rejects(sql.begin(async tx=>{
    await tx`INSERT INTO economic_transactions(id,charge_id,client_id,kind,amount_cents,refund_of,actor_id,idempotency_key,request_hash,cash_session_id) VALUES (${refundId},${charge.json().id},${client.id},'refund',100,${paid.json().id},'qa-db-guard',${refundKey},${refundHash},NULL)`;
    await tx`INSERT INTO economic_payment_splits(transaction_id,method,amount_cents) VALUES (${refundId},'card',100)`;
  }),{code:'23514'});
  assert.equal((await sql`SELECT count(*)::int AS count FROM economic_transactions WHERE id IN (${paymentId},${refundId})`)[0].count,0);
});

test('concurrent collection and cash close serialize with the close including exactly the accepted cash collection',async()=>{
  const client=(await createClientRequest(clientsAdminApp,{firstName:'Close race',lastName:randomUUID(),email:null,phone:null})).json();
  const charge=await clientsAdminApp.inject({method:'POST',url:'/api/economics/charges',headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id,concept:'Close race',amountCents:1000,dueOn:'2099-12-10'}});
  const current=await clientsAdminApp.inject({method:'GET',url:'/api/economics/cash/today'});assert.equal(current.statusCode,200,current.body);
  const session=current.json().session,baseline=await expectedCashCents(sql,session.id);
  const [payment,close]=await Promise.all([
    clientsAdminApp.inject({method:'POST',url:'/api/economics/payments',headers:{'idempotency-key':randomUUID()},payload:{chargeId:charge.json().id,splits:[{method:'cash',amountCents:500}]}}),
    clientsAdminApp.inject({method:'POST',url:`/api/economics/cash/${session.id}/close`,payload:{countedDenominations:cashCount(baseline)}}),
  ]);
  assert.equal(close.statusCode,200,close.body);
  assert.ok(payment.statusCode===201||(payment.statusCode===409&&payment.json().error==='cash_session_required'),payment.body);
  const count=Number((await sql`SELECT count(*)::int AS count FROM economic_transactions WHERE charge_id=${charge.json().id} AND kind='payment'`)[0].count);
  assert.equal(count,payment.statusCode===201?1:0);
  const [closed]=await sql`SELECT expected_cents FROM economic_cash_sessions WHERE id=${session.id}`;
  assert.equal(Number(closed.expected_cents),baseline+(count?500:0));
});

test('cash difference is returned only to an explicit owner.panel.read grant', async () => {
  const current = await clientsAdminApp.inject({ method: 'GET', url: '/api/economics/cash/today' });
  assert.equal(current.statusCode, 200, current.body);
  const close = await clientsAdminApp.inject({ method: 'POST', url: `/api/economics/cash/${current.json().session.id}/close`, payload: { countedDenominations: cashCount((await expectedCashCents(sql, current.json().session.id)) + 77) } });
  assert.equal(close.statusCode, 200, close.body);
  assert.equal(Object.hasOwn(close.json(), 'differenceCents'), false, 'generic admin role is not the owner permission');
  const genericCash = await clientsAdminApp.inject({ method: 'GET', url: '/api/economics/cash/today' });
  assert.equal(Object.hasOwn(genericCash.json().session, 'differenceCents'), false);
  const genericOverview = await clientsAdminApp.inject({ method: 'GET', url: '/api/economics/overview' });
  assert.equal(genericOverview.json().capabilities.ownerPanelRead, false);
  const ownerCash = await ownerPanelApp.inject({ method: 'GET', url: '/api/economics/cash/today' });
  assert.equal(Number(ownerCash.json().items.find(item=>item.id===current.json().session.id).differenceCents), 77);
  const ownerOverview = await ownerPanelApp.inject({ method: 'GET', url: '/api/economics/overview' });
  assert.equal(ownerOverview.json().capabilities.ownerPanelRead, true);
  const genericDashboard = await clientsAdminApp.inject({ method: 'GET', url: '/api/dashboard/command-center' });
  assert.equal(genericDashboard.statusCode, 200, genericDashboard.body);
  assert.equal(Object.hasOwn(genericDashboard.json().economics.cashSession, 'differenceCents'), false);
  const ownerDashboard = await ownerPanelApp.inject({ method: 'GET', url: '/api/dashboard/command-center' });
  assert.equal(ownerDashboard.statusCode, 200, ownerDashboard.body);
  assert.equal(Number(ownerDashboard.json().economics.cashSession.differenceCents), 77);
  assert.equal((await configuredOwnerPanelApp.inject({ method: 'GET', url: '/api/economics/overview' })).json().capabilities.ownerPanelRead, true);
  assert.equal((await nonOwnerPanelApp.inject({ method: 'GET', url: '/api/economics/overview' })).json().capabilities.ownerPanelRead, false);
});

test('cash close, human transfer validation, and tax-explicit invoice drafts have guarded transitions', async () => {
  const clientResponse = await createClientRequest(clientsAdminApp, { firstName: 'Fiscal', lastName: `QA ${randomUUID()}`, email: null, phone: null });
  assert.equal(clientResponse.statusCode, 201);
  const client = clientResponse.json();
  const charge = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/charges', headers: { 'idempotency-key': randomUUID() }, payload: { clientId: client.id, concept: 'Transferencia QA', amountCents: 8000, dueOn: '2099-12-10' } });
  assert.equal(charge.statusCode, 201, charge.body);
  const pdf = Buffer.from('%PDF-1.7\nQA document').toString('base64');
  const proofPayload = { chargeId: charge.json().id, amountCents: 8000, contentType: 'application/pdf', fileName: 'justificante.pdf', base64: pdf };
  const proof = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/transfer-proofs', payload: proofPayload });
  assert.equal(proof.statusCode, 201, proof.body);
  const duplicateProof = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/transfer-proofs', payload: proofPayload });
  assert.equal(duplicateProof.statusCode, 409);
  const selfReview = await clientsAdminApp.inject({ method: 'POST', url: `/api/economics/transfer-proofs/${proof.json().id}/review`, payload: { decision: 'validated', note: 'Revisado por QA' } });
  assert.equal(selfReview.statusCode, 403);
  const reviewed = await clientsTrainerApp.inject({ method: 'POST', url: `/api/economics/transfer-proofs/${proof.json().id}/review`, payload: { decision: 'validated', note: 'Revisado por otro miembro del equipo' } });
  assert.equal(reviewed.statusCode, 200, reviewed.body);
  const chargeRows = await clientsAdminApp.inject({ method: 'GET', url: `/api/economics/charges?clientId=${client.id}` });
  assert.equal(chargeRows.json().items[0].status, 'paid');

  const accountantWrite = await clientsAccountantApp.inject({ method: 'PUT', url: `/api/clients/${client.id}/fiscal-profile`, payload: { legalName: 'Cliente de prueba', countryCode: 'ES' } });
  assert.equal(accountantWrite.statusCode, 403);
  const invalidTaxId=await clientsAdminApp.inject({method:'PUT',url:`/api/clients/${client.id}/fiscal-profile`,payload:{legalName:'Cliente de prueba',taxId:'no-es-un-nif',countryCode:'ES'}});
  assert.equal(invalidTaxId.statusCode,400);
  const profile = await clientsAdminApp.inject({ method: 'PUT', url: `/api/clients/${client.id}/fiscal-profile`, payload: { legalName: 'Cliente de prueba', countryCode: 'ES' } });
  assert.equal(profile.statusCode, 200, profile.body);
  const accountantRead = await clientsAccountantApp.inject({ method: 'GET', url: `/api/clients/${client.id}/fiscal-profile` });
  assert.equal(accountantRead.statusCode, 200);
  assert.equal(accountantRead.json().legalName, 'Cliente de prueba');
  const series = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/invoice-series', payload: { name: `QA ${randomUUID()}`, prefix: 'BORR' } });
  assert.equal(series.statusCode, 201, series.body);
  const draft = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/invoice-drafts', headers: { 'idempotency-key': randomUUID() }, payload: { clientId: client.id, seriesId: series.json().id, sourceChargeId: charge.json().id, concept: 'Servicio de prueba', netCents: 8000, taxTreatment: 'taxable', taxBasisPoints: 0 } });
  assert.equal(draft.statusCode, 201, draft.body);
  assert.equal(draft.json().officiallyIssued, false);
  assert.equal(draft.json().officialNumber, null);
  const seriesAfterDraft = await sql`SELECT next_number FROM economic_invoice_series WHERE id=${series.json().id}`;
  assert.equal(Number(seriesAfterDraft[0].next_number), 1, 'drafts must not consume official numbering');
  const issueBlocked = await clientsAdminApp.inject({ method: 'POST', url: `/api/economics/invoice-drafts/${draft.json().id}/issue`, payload: {} });
  assert.equal(issueBlocked.statusCode, 423);
  const nonSubject = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/invoice-drafts', headers: { 'idempotency-key': randomUUID() }, payload: { clientId: client.id, seriesId: series.json().id, sourceChargeId: charge.json().id, concept: 'Línea no sujeta QA', netCents: 8000, taxTreatment: 'non_subject', taxDescription: 'Tratamiento pendiente de revisión legal' } });
  assert.equal(nonSubject.statusCode, 201, nonSubject.body);
  const [taxDraft] = await sql`SELECT tax_treatment,tax_rate_basis_points,tax_cents FROM economic_invoice_drafts WHERE id=${nonSubject.json().id}`;
  assert.equal(taxDraft.tax_treatment, 'non_subject');
  assert.equal(taxDraft.tax_rate_basis_points, null);
  assert.equal(Number(taxDraft.tax_cents), 0);
  const exemptDraft = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/invoice-drafts', headers: { 'idempotency-key': randomUUID() }, payload: { clientId: client.id, seriesId: series.json().id, sourceChargeId: charge.json().id, concept: 'Línea exenta QA', netCents: 8000, taxTreatment: 'exempt', taxDescription: 'Exención sin base legal determinada por el test' } });
  assert.equal(exemptDraft.statusCode, 201, exemptDraft.body);
  const [exemptTaxDraft] = await sql`SELECT tax_treatment,tax_rate_basis_points,tax_cents FROM economic_invoice_drafts WHERE id=${exemptDraft.json().id}`;
  assert.equal(exemptTaxDraft.tax_treatment, 'exempt');
  assert.equal(exemptTaxDraft.tax_rate_basis_points, null);
  assert.equal(Number(exemptTaxDraft.tax_cents), 0);
  const multiLineDraft=await clientsAdminApp.inject({method:'POST',url:'/api/economics/invoice-drafts',headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id,seriesId:series.json().id,sourceChargeId:charge.json().id,lines:[{description:'Línea 0%',netCents:2000,taxTreatment:'taxable',taxBasisPoints:0},{description:'Línea exenta',netCents:3000,taxTreatment:'exempt',taxDescription:'Revisión legal pendiente'},{description:'Línea no sujeta',netCents:3000,taxTreatment:'non_subject',taxDescription:'Revisión legal pendiente'}]}});
  assert.equal(multiLineDraft.statusCode,201,multiLineDraft.body);
  const [lineData]=await sql`SELECT tax_treatment,line_items FROM economic_invoice_drafts WHERE id=${multiLineDraft.json().id}`;
  assert.equal(lineData.tax_treatment,'mixed');
  assert.equal(lineData.line_items.length,3);

  const priorOpenCash = await clientsAdminApp.inject({ method: 'GET', url: '/api/economics/cash/today' });
  assert.equal(priorOpenCash.json().session.status, 'open');
  const priorClose = await clientsAdminApp.inject({ method: 'POST', url: `/api/economics/cash/${priorOpenCash.json().session.id}/close`, payload: { countedDenominations: cashCount(await expectedCashCents(sql, priorOpenCash.json().session.id)) } });
  assert.equal(priorClose.statusCode, 200, priorClose.body);
  const opened = await ownerPanelApp.inject({ method: 'POST', url: `/api/economics/cash/${priorOpenCash.json().session.id}/owner-reopen`, payload: { custodianActorId:'qa-admin', openingDenominations: cashCount(20000) } });
  assert.equal(opened.statusCode, 200, opened.body);
  const secondOpen = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/cash/open', payload: { registerCode:'bunker', openingDenominations: cashCount(1000) } });
  assert.equal(secondOpen.statusCode, 409);
  const cashCharge = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/charges', headers: { 'idempotency-key': randomUUID() }, payload: { clientId: client.id, concept: 'Pago en caja QA', amountCents: 8000, dueOn: '2099-12-10' } });
  const cashPayment = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/payments', headers: { 'idempotency-key': randomUUID() }, payload: { chargeId: cashCharge.json().id, splits: [{ method: 'cash', amountCents: 3000 }, { method: 'card', amountCents: 2000 }] } });
  assert.equal(cashPayment.statusCode, 201, cashPayment.body);
  const cashRefund = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/refunds', headers: { 'idempotency-key': randomUUID() }, payload: { transactionId: cashPayment.json().id, amountCents: 500, method: 'cash', note: 'Devolución parcial QA' } });
  assert.equal(cashRefund.statusCode, 201, cashRefund.body);
  const [cashLinks] = await sql`SELECT count(*)::int AS count FROM economic_transactions WHERE id IN (${cashPayment.json().id}::uuid,${cashRefund.json().id}::uuid) AND cash_session_id=${opened.json().id}`;
  assert.equal(cashLinks.count, 2);
  const adjustment = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/cash/outflows', payload: { movementType:'expense', amountCents: 300, reason: 'Gasto de apertura QA' } });
  assert.equal(adjustment.statusCode, 201, adjustment.body);
  const liveCash = await clientsAdminApp.inject({ method: 'GET', url: '/api/economics/cash/today' });
  assert.equal(await expectedCashCents(sql, opened.json().id), 22200);
  assert.equal(Object.hasOwn(liveCash.json().session,'expectedCents'),false,'cashier read must not disclose the expected amount');
  const closed = await clientsAdminApp.inject({ method: 'POST', url: `/api/economics/cash/${opened.json().id}/close`, payload: { countedDenominations: cashCount(23000) } });
  assert.equal(closed.statusCode, 200, closed.body);
  assert.equal(closed.json().status, 'closed');
  assert.equal(await expectedCashCents(sql,opened.json().id), 22200);
  assert.equal(Object.hasOwn(closed.json(), 'differenceCents'), false, 'cash difference is not returned to the generic admin role');
  const ownerClosedCash = await ownerPanelApp.inject({ method: 'GET', url: '/api/economics/cash/today' });
  assert.equal(Number(ownerClosedCash.json().session.differenceCents), 800);
  const duplicateClose = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/cash/close', payload: { countedDenominations: cashCount(27000) } });
  assert.equal(duplicateClose.statusCode, 409);
  const [immutableCash] = await sql`SELECT expected_cents,difference_cents FROM economic_cash_sessions WHERE id=${opened.json().id}`;
  await assert.rejects(sql`UPDATE economic_cash_sessions SET counted_cents=1 WHERE id=${opened.json().id}`, { code: '55000' });
  assert.equal(Number(immutableCash.expected_cents), 22200);
  assert.equal(Number(immutableCash.difference_cents), 800);
});

test('previous-day open cash blocks collection and requires owner resolution without changing clock records', async () => {
  const sourceUrl=new URL(process.env.DATABASE_URL),databaseName=`cash_stale_${randomUUID().replaceAll('-','')}`;
  const adminUrl=new URL(sourceUrl);adminUrl.pathname='/postgres';const admin=postgres(adminUrl.toString(),{max:1,connect_timeout:5});
  let testDb,testApp;
  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);sourceUrl.pathname=`/${databaseName}`;
    testDb=postgres(sourceUrl.toString(),{max:3,connect_timeout:5});await migrateDatabase(testDb);
    testApp=buildServer(sourceUrl.toString(),{authorizationResolver:async()=>({actorId:'qa-stale-cash-owner-resolution',role:'admin'})});
    const client=(await testApp.inject({method:'POST',url:'/api/clients',headers:{'idempotency-key':randomUUID()},payload:{firstName:'Caja',lastName:'Ayer',email:null,phone:null}})).json();
    const charge=await testApp.inject({method:'POST',url:'/api/economics/charges',headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id,concept:'Cobro bloqueado por caja anterior',amountCents:1000,dueOn:'2099-12-10'}});
    assert.equal(charge.statusCode,201,charge.body);
    const [bunker]=await testDb`SELECT id FROM economic_cash_registers WHERE code='bunker'`;
    const [session]=await testDb`INSERT INTO economic_cash_sessions(register_id,local_date,opening_cents,opening_denominations,opened_by) VALUES (${bunker.id},(now() AT TIME ZONE 'Atlantic/Canary')::date-1,5000,${testDb.json(cashCount(5000))},'qa-stale-shift') RETURNING id,local_date`;
    const payment=await testApp.inject({method:'POST',url:'/api/economics/payments',headers:{'idempotency-key':randomUUID()},payload:{chargeId:charge.json().id,splits:[{method:'cash',amountCents:500}]}});
    assert.equal(payment.statusCode,409,payment.body);assert.equal(payment.json().error,'cash_session_previous_day_requires_owner_resolution');
    assert.match(payment.json().message,/propietario debe resolverla/i);
    const opened=await testApp.inject({method:'POST',url:'/api/economics/cash/open',payload:{registerCode:'bunker',openingDenominations:cashCount(0)}});
    assert.equal(opened.statusCode,409,opened.body);assert.equal(opened.json().error,'cash_session_previous_day_requires_owner_resolution');
    const close=await testApp.inject({method:'POST',url:`/api/economics/cash/${session.id}/close`,payload:{countedDenominations:cashCount(5000)}});
    assert.equal(close.statusCode,409,close.body);assert.equal(close.json().error,'cash_session_previous_day_requires_owner_resolution');
    const [unchanged]=await testDb`SELECT status,closed_at,closed_by,local_date FROM economic_cash_sessions WHERE id=${session.id}`;
    assert.equal(unchanged.status,'open');assert.equal(unchanged.closed_at,null);assert.equal(unchanged.closed_by,null);
    const [clockCount]=await testDb`SELECT count(*)::int AS count FROM staff_timeclock_events`;
    assert.equal(clockCount.count,0,'stale cash resolution does not invent timeclock events');
  } finally {
    await testApp?.close();await testDb?.end();await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);await admin.end();
  }
});

test('D111 opening and closing store denomination counts while never exposing expected cash to the cashier', async () => {
  const sourceUrl=new URL(process.env.DATABASE_URL),databaseName=`cash_blind_${randomUUID().replaceAll('-','')}`;
  const adminUrl=new URL(sourceUrl);adminUrl.pathname='/postgres';const admin=postgres(adminUrl.toString(),{max:1,connect_timeout:5});
  let testDb,cashierApp,ownerApp;
  const denominations=cashCount(0);denominations.bill_10=1;denominations.coin_2=2;
  const counted={...denominations,coin_1:1};
  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);sourceUrl.pathname=`/${databaseName}`;
    testDb=postgres(sourceUrl.toString(),{max:3,connect_timeout:5});await migrateDatabase(testDb);
    cashierApp=buildServer(sourceUrl.toString(),{authorizationResolver:async()=>({actorId:'qa-cashier',role:'admin'})});
    ownerApp=buildServer(sourceUrl.toString(),{authorizationResolver:async()=>({actorId:'qa-cash-owner',role:'admin'}),ownerActorId:'qa-cash-owner'});
    const [cashierProfessional]=await testDb`INSERT INTO staff_professionals(first_name,last_name,display_name,base_role,auth_actor_id,created_by) VALUES ('QA','Cajero','QA Cajero','trainer','qa-cashier','test') RETURNING id`;
    await cashierApp.inject({method:'POST',url:'/api/timeclock/clock-in',payload:{origin:'web'}});
    const rejectedLegacyAmount=await cashierApp.inject({method:'POST',url:'/api/economics/cash/open',payload:{openingCents:1400}});
    assert.equal(rejectedLegacyAmount.statusCode,400);
    const opened=await cashierApp.inject({method:'POST',url:'/api/economics/cash/open',payload:{registerCode:'bunker',openingDenominations:denominations}});
    assert.equal(opened.statusCode,201,opened.body);assert.equal(Number(opened.json().openingCents),1400);
    assert.deepEqual(opened.json().openingDenominations,denominations);
    const cashierRead=await cashierApp.inject({method:'GET',url:'/api/economics/cash/today'});
    assert.equal(cashierRead.statusCode,200,cashierRead.body);
    for(const key of ['expectedCents','liveExpectedCents','differenceCents','cashPaymentsCents','cashRefundsCents','cashStoreSalesCents','cashStoreRefundsCents','adjustmentsCents'])assert.equal(Object.hasOwn(cashierRead.json().session,key),false,`${key} must be hidden during blind count`);
    const ownerRead=await ownerApp.inject({method:'GET',url:'/api/economics/cash/today'});
    assert.equal(Number(ownerRead.json().session.expectedCents),1400);
    const close=await cashierApp.inject({method:'POST',url:`/api/economics/cash/${opened.json().id}/close`,payload:{countedDenominations:counted}});
    assert.equal(close.statusCode,200,close.body);
    assert.equal(Object.hasOwn(close.json(),'expectedCents'),false);assert.equal(Object.hasOwn(close.json(),'differenceCents'),false);
    const [stored]=await testDb`SELECT opening_cents,counted_cents,difference_cents,opening_denominations,counted_denominations FROM economic_cash_sessions WHERE id=${opened.json().id}`;
    assert.equal(Number(stored.opening_cents),1400);assert.equal(Number(stored.counted_cents),1500);assert.equal(Number(stored.difference_cents),100);
    assert.deepEqual(stored.opening_denominations,denominations);assert.deepEqual(stored.counted_denominations,counted);
    const ownerClosedRead=await ownerApp.inject({method:'GET',url:'/api/economics/cash/today'});
    assert.equal(Number(ownerClosedRead.json().session.differenceCents),100);
    assert.deepEqual(ownerClosedRead.json().session.countedDenominations,counted);
    const [event]=await testDb`SELECT details FROM economic_audit_events WHERE action='cash.closed' AND resource_id=${opened.json().id} ORDER BY occurred_at DESC LIMIT 1`;
    assert.deepEqual(event.details.countedDenominations,counted);
  } finally {
    await cashierApp?.close();await ownerApp?.close();await testDb?.end();await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);await admin.end();
  }
});

test('pending charges can be voided once with an audited reason, while charges with money require compensation', async () => {
  const created = await createClientRequest(clientsAdminApp,{firstName:'Void',lastName:`QA ${randomUUID()}`,email:null,phone:null});
  const client=created.json();
  const charge=await clientsAdminApp.inject({method:'POST',url:'/api/economics/charges',headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id,concept:'Cargo incorrecto',amountCents:5000,dueOn:'2099-12-10'}});
  assert.equal(charge.statusCode,201,charge.body);
  const missingReason=await clientsAdminApp.inject({method:'POST',url:`/api/economics/charges/${charge.json().id}/void`,payload:{reason:'  '}});
  assert.equal(missingReason.statusCode,400);
  const voided=await clientsAdminApp.inject({method:'POST',url:`/api/economics/charges/${charge.json().id}/void`,payload:{reason:'Alta duplicada por error'}});
  assert.equal(voided.statusCode,200,voided.body);
  assert.equal(voided.json().state,'void');
  const [voidAudit]=await sql`SELECT count(*)::int count FROM economic_audit_events WHERE resource_id=${charge.json().id} AND action='charge.voided'`;
  assert.equal(voidAudit.count,1);

  const paidCharge=await clientsAdminApp.inject({method:'POST',url:'/api/economics/charges',headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id,concept:'Cargo con movimiento',amountCents:5000,dueOn:'2099-12-10'}});
  const paid=await clientsAdminApp.inject({method:'POST',url:'/api/economics/payments',headers:{'idempotency-key':randomUUID()},payload:{chargeId:paidCharge.json().id,splits:[{method:'card',amountCents:1000}]}});
  assert.equal(paid.statusCode,201,paid.body);
  const blocked=await clientsAdminApp.inject({method:'POST',url:`/api/economics/charges/${paidCharge.json().id}/void`,payload:{reason:'Intento de anular con dinero'}});
  assert.equal(blocked.statusCode,409);
  assert.equal(blocked.json().error,'refund_required');
  const history=await sql`SELECT id,kind,amount_cents FROM economic_transactions WHERE charge_id=${paidCharge.json().id}`;
  assert.equal(history.length,1);
  assert.equal(history[0].id,paid.json().id);
});

test('economic history rejects truncate and destructive row changes', async () => {
  const created=await createClientRequest(clientsAdminApp,{firstName:'Guards',lastName:`QA ${randomUUID()}`,email:null,phone:null});
  const client=created.json();
  const charge=await clientsAdminApp.inject({method:'POST',url:'/api/economics/charges',headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id,concept:'Histórico protegido',amountCents:2000,dueOn:'2099-12-10'}});
  const series=await clientsAdminApp.inject({method:'POST',url:'/api/economics/invoice-series',payload:{name:`SER-${randomUUID()}`,prefix:'QA'}});
  const session=await ensureCashSessionForActor(sql,'qa-admin');
  await sql`INSERT INTO economic_cash_adjustments(cash_session_id,amount_cents,reason,actor_id) VALUES (${session.id},100,'Movimiento de fixture','qa-admin')`;
  const [proof]=await sql`INSERT INTO economic_transfer_proofs(charge_id,amount_cents,content_type,file_name,file_bytes,sha256,submitted_by) VALUES (${charge.json().id},100,'application/pdf','fixture.pdf',${Buffer.from('%PDF-1.7')},${createHash('sha256').update('fixture').digest('hex')},'qa-uploader') RETURNING id`;
  const payment=await clientsAdminApp.inject({method:'POST',url:'/api/economics/payments',headers:{'idempotency-key':randomUUID()},payload:{chargeId:charge.json().id,splits:[{method:'card',amountCents:2000}]}});
  assert.equal(payment.statusCode,201,payment.body);
  const draft=await clientsAdminApp.inject({method:'POST',url:'/api/economics/invoice-drafts',headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id,seriesId:series.json().id,sourceChargeId:charge.json().id,concept:'Borrador guardado',netCents:2000,taxTreatment:'taxable',taxBasisPoints:0}});
  assert.equal(draft.statusCode,201,draft.body);
  const [document]=await sql`INSERT INTO economic_fiscal_documents(draft_id,document_type,status,series_id,series_name,document_number,source_charge_id,client_id,issuer_snapshot,client_snapshot,lines_snapshot,payment_methods,totals_snapshot,issued_by) VALUES (${draft.json().id},'simplified_ticket','issued',${series.json().id},'QA','QA-001',${charge.json().id},${client.id},'{}'::jsonb,'{}'::jsonb,'[]'::jsonb,'[]'::jsonb,'{}'::jsonb,'qa-issuer') RETURNING id`;
  const protectedTables=['economic_transactions','economic_payment_splits','economic_audit_events','economic_charges','economic_cash_adjustments','economic_cash_sessions','economic_transfer_proofs','economic_invoice_series','economic_invoice_drafts','economic_fiscal_documents'];
  for(const table of protectedTables) await assert.rejects(sql.unsafe(`TRUNCATE ${table} CASCADE`),{code:'55000'},`${table} must reject TRUNCATE`);
  await assert.rejects(sql`DELETE FROM economic_charges WHERE id=${charge.json().id}`,{code:'55000'});
  await assert.rejects(sql`DELETE FROM economic_invoice_series WHERE id=${series.json().id}`,{code:'55000'});
  await assert.rejects(sql`DELETE FROM economic_transfer_proofs WHERE id=${proof.id}`,{code:'55000'});
  await assert.rejects(sql`DELETE FROM economic_cash_adjustments WHERE cash_session_id=${session.id}`,{code:'55000'});
  await assert.rejects(sql`UPDATE economic_fiscal_documents SET document_number='EDITED' WHERE id=${document.id}`,{code:'55000'});
  await assert.rejects(sql`DELETE FROM economic_fiscal_documents WHERE id=${document.id}`,{code:'55000'});
});

test('accountant is economic/fiscal read-only and upload limits stay route-specific', async () => {
  const created=await createClientRequest(clientsAdminApp,{firstName:'Read',lastName:`QA ${randomUUID()}`,email:null,phone:null});
  const client=created.json();
  const charge=await clientsAdminApp.inject({method:'POST',url:'/api/economics/charges',headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id,concept:'Lectura contable',amountCents:1000,dueOn:'2099-12-10'}});
  const economicRead=await clientsAccountantApp.inject({method:'GET',url:`/api/clients/${client.id}/economics`});
  assert.equal(economicRead.statusCode,200,economicRead.body);
  assert.equal(economicRead.json().items[0].id,charge.json().id);
  assert.equal((await clientsAccountantApp.inject({method:'GET',url:'/api/economics/export'})).statusCode,200);
  assert.equal((await clientsAccountantApp.inject({method:'GET',url:'/api/economics/fiscal-export'})).statusCode,200);
  assert.equal((await clientsAccountantApp.inject({method:'POST',url:'/api/economics/payments',headers:{'idempotency-key':randomUUID()},payload:{chargeId:charge.json().id,splits:[{method:'card',amountCents:100}]}})).statusCode,403);
  assert.equal((await clientsAccountantApp.inject({method:'POST',url:'/api/economics/cash/open',payload:{openingDenominations:cashCount(100)}})).statusCode,403);
  const tooLargeNormal=await clientsAdminApp.inject({method:'POST',url:'/api/economics/cash/open',headers:{'content-type':'application/json'},payload:{registerCode:'bunker',openingDenominations:cashCount(1),padding:'x'.repeat(20000)}});
  assert.equal(tooLargeNormal.statusCode,413);
  const proofBytes=Buffer.concat([Buffer.from('%PDF-1.7\n'),Buffer.alloc(20000,65)]);
  const acceptedLargeProof=await clientsAdminApp.inject({method:'POST',url:'/api/economics/transfer-proofs',payload:{chargeId:charge.json().id,amountCents:100,contentType:'application/pdf',fileName:'large-fixture.pdf',base64:proofBytes.toString('base64')}});
  assert.equal(acceptedLargeProof.statusCode,201,acceptedLargeProof.body);
});

test('local Host handling rejects unexpected hosts while health reports database readiness', async () => {
  const allowed = await app.inject({ method: 'GET', url: '/health' });
  const rejected = await app.inject({ method: 'GET', url: '/health', headers: { host: 'unsafe.example' } });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.json().database, 'ready');
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.json().error, 'invalid_host');
});

test('GET plan database connectivity failures return a structured 503', async () => {
  const unavailable = buildServer('postgres://local:local@127.0.0.1:1/unavailable', { authorizationResolver: async () => ({ actorId: 'qa-admin', role: 'admin' }) });
  try {
    const response = await unavailable.inject({ method: 'GET', url: `/api/services/${randomUUID()}/plans` });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, 'database_unavailable');
  } finally { await unavailable.close(); }
});

test('client plan sale atomically assigns the frozen catalog version, charge and optional payment with server permissions', async () => {
  const service=await createService(`Plan venta ${randomUUID()}`);
  const createdPlan=await createPlan([service.id]);
  assert.equal(createdPlan.response.statusCode,201,createdPlan.response.body);
  const planId=createdPlan.response.json().id;
  const activated=await app.inject({method:'POST',url:`/api/plans/${planId}/activate`});
  assert.equal(activated.statusCode,200,activated.body);
  const assignable=await clientsAdminApp.inject({method:'GET',url:'/api/plans/assignable'});
  assert.ok(assignable.json().some(item=>item.id===planId));
  assert.equal((await clientsTrainerApp.inject({method:'GET',url:'/api/plans/assignable'})).statusCode,200);
  const created=await createClientRequest(clientsAdminApp,{firstName:'Venta',lastName:`Integración ${randomUUID()}`,email:null,phone:null});
  assert.equal(created.statusCode,201,created.body);
  const clientId=created.json().id;
  const key=randomUUID();
  const payload={planId,startsOn:'2026-10-09',endsOn:null,dueOn:'2026-10-09',amountCents:5900,paymentAmountCents:5900,paymentMethod:'card'};
  const response=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${clientId}/plans`,headers:{'idempotency-key':key},payload});
  assert.equal(response.statusCode,201,response.body);
  const replay=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${clientId}/plans`,headers:{'idempotency-key':key},payload});
  assert.equal(replay.statusCode,200,replay.body);
  assert.equal(replay.json().id,response.json().id);
  const conflict=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${clientId}/plans`,headers:{'idempotency-key':key},payload:{...payload,amountCents:6000}});
  assert.equal(conflict.statusCode,409,conflict.body);
  assert.equal(conflict.json().error,'idempotency_conflict');
  const [counts]=await sql`SELECT (SELECT count(*)::int FROM client_plan_assignments WHERE client_id=${clientId}) assignments,(SELECT count(*)::int FROM economic_charges WHERE client_id=${clientId} AND plan_id=${planId}) charges,(SELECT count(*)::int FROM economic_transactions WHERE client_id=${clientId} AND kind='payment') payments,(SELECT count(*)::int FROM economic_audit_events WHERE client_id=${clientId} AND action IN ('client_plan.assigned','charge.created','payment.recorded')) audit_events,(SELECT count(*)::int FROM client_events WHERE client_id=${clientId} AND event_type='client.plan_assigned') AS client_events`;
  assert.deepEqual(counts,{assignments:1,charges:1,payments:1,audit_events:3,client_events:1});
  const profile=await clientsAdminApp.inject({method:'GET',url:`/api/clients/${clientId}`});
  assert.equal(profile.statusCode,200,profile.body);
  assert.equal(profile.json().summary.plans.data[0].planName,createdPlan.body.name);
  assert.equal(profile.json().summary.plans.data[0].derivedStatus,'active');
  assert.equal(Number(profile.json().summary.plans.data[0].amountCents),5900);
  const trainerProfile=await clientsTrainerApp.inject({method:'GET',url:`/api/clients/${clientId}`});
  assert.equal(trainerProfile.statusCode,200,trainerProfile.body);
  assert.equal(trainerProfile.json().summary.plans.data[0].amountCents,undefined);
  assert.equal(trainerProfile.json().summary.plans.data[0].salePriceCents,undefined);
  assert.equal(trainerProfile.json().summary.plans.data[0].dueOn,undefined);
  assert.equal(trainerProfile.json().summary.plans.data[0].snapshot.salePriceCents,undefined);
  assert.equal(trainerProfile.json().summary.plans.data[0].snapshot.listPriceCents,undefined);
  assert.equal(trainerProfile.json().summary.payments.data,null);
  assert.equal((await clientsTrainerApp.inject({method:'GET',url:`/api/clients/${clientId}/plans`})).statusCode,200);
  const forbidden=await clientsTrainerApp.inject({method:'POST',url:`/api/clients/${clientId}/plans`,headers:{'idempotency-key':randomUUID()},payload});
  assert.equal(forbidden.statusCode,403);
});

test('client plan sale leaves only an unpaid charge when no money is collected and rolls back if cash cannot be recorded', async () => {
  const today=await clientsAdminApp.inject({method:'GET',url:'/api/economics/cash/today'});
  if(today.json().session?.status==='open'){
    const close=await clientsAdminApp.inject({method:'POST',url:`/api/economics/cash/${today.json().session.id}/close`,payload:{countedDenominations:cashCount(await expectedCashCents(sql,today.json().session.id))}});
    assert.equal(close.statusCode,200,close.body);
  }
  const service=await createService(`Plan pendiente ${randomUUID()}`);
  const createdPlan=await createPlan([service.id]);
  const planId=createdPlan.response.json().id;
  assert.equal((await app.inject({method:'POST',url:`/api/plans/${planId}/activate`})).statusCode,200);
  const create=async()=>{const response=await createClientRequest(clientsAdminApp,{firstName:'Cargo',lastName:`Pendiente ${randomUUID()}`,email:null,phone:null});assert.equal(response.statusCode,201);return response.json().id;};
  const clientId=await create();
  const key=randomUUID();
  const payload={planId,startsOn:'2026-10-09',dueOn:'2026-10-09',amountCents:2500};
  const response=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${clientId}/plans`,headers:{'idempotency-key':key},payload});
  assert.equal(response.statusCode,201,response.body);
  const [charge]=await sql`SELECT state,amount_cents::int AS "amountCents",plan_id AS "planId" FROM economic_charges WHERE client_id=${clientId}`;
  assert.deepEqual(charge,{state:'pending',amountCents:2500,planId});
  const clientId2=await create();
  const before=await sql`SELECT count(*)::int AS count FROM economic_charges WHERE client_id=${clientId2}`;
  const failed=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${clientId2}/plans`,headers:{'idempotency-key':randomUUID()},payload:{...payload,paymentAmountCents:2500,paymentMethod:'cash'}});
  assert.equal(failed.statusCode,409,failed.body);
  const after=await sql`SELECT count(*)::int AS count FROM economic_charges WHERE client_id=${clientId2}`;
  assert.equal(after[0].count,before[0].count,'cash validation happens before sale writes; no partial charge or assignment');
  const assignments=await sql`SELECT count(*)::int AS count FROM client_plan_assignments WHERE client_id=${clientId2}`;
  assert.equal(assignments[0].count,0);
});

test('2J-073 freezes catalog revisions and the purchased client snapshot remains unchanged', async () => {
  const service=await createService(`Entitlement ${randomUUID()}`);
  const created=await createPlan([service.id],{name:`Producto ${randomUUID()}`,basePriceCents:4900,modules:[{module:'training',accessLevel:'limited',capabilities:['training.routines.read']} ]});
  assert.equal(created.response.statusCode,201,created.response.body);
  const planId=created.response.json().id;
  assert.equal((await app.inject({method:'POST',url:`/api/plans/${planId}/activate`})).statusCode,200);
  const client=(await createClientRequest(clientsAdminApp,{firstName:'Derechos',lastName:`Cliente ${randomUUID()}`})).json();
  const assignment=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':randomUUID()},payload:{planId,startsOn:'2026-10-09',endsOn:'2026-10-31',dueOn:'2026-10-09',amountCents:4900}});
  assert.equal(assignment.statusCode,201,assignment.body);
  const snapshotBefore=(await sql`SELECT snapshot FROM client_plan_assignments WHERE id=${assignment.json().id}`)[0].snapshot;
  assert.equal(snapshotBefore.name,created.body.name);
  assert.equal(snapshotBefore.salePriceCents,4900);
  assert.equal(snapshotBefore.listPriceCents,4900);
  assert.equal(snapshotBefore.modules[0].accessLevel,'limited');
  assert.equal(snapshotBefore.rights.find(right=>right.rightType==='service_access').serviceId,service.id,'the sale snapshot retains the exact service target');
  const revised=await clientsAdminApp.inject({method:'POST',url:`/api/plans/${planId}/versions`,headers:{'idempotency-key':randomUUID()},payload:{...created.body,currentVersion:undefined,status:undefined,basePriceCents:5500,modules:[{module:'training',accessLevel:'full',capabilities:['training.routines.read','training.workouts.log']} ]}});
  assert.equal(revised.statusCode,201,revised.body);
  assert.equal(revised.json().currentVersion,2);
  assert.equal(Number(revised.json().basePriceCents),5500);
  const profile=await clientsAdminApp.inject({method:'GET',url:`/api/clients/${client.id}`});
  const purchased=profile.json().summary.plans.data.find(row=>row.id===assignment.json().id);
  assert.equal(purchased.planName,created.body.name);
  assert.equal(purchased.planVersion,1);
  assert.equal(purchased.snapshot.modules[0].accessLevel,'limited');
  const effective=await clientsAdminApp.inject({method:'GET',url:`/api/clients/${client.id}/entitlements/effective?date=2026-10-09`});
  assert.equal(effective.statusCode,200,effective.body);
  assert.equal(effective.json().modules[0].accessLevel,'limited');
  assert.equal((await clientsAdminApp.inject({method:'GET',url:`/api/clients/${randomUUID()}/entitlements/effective?date=2026-10-09`})).statusCode,404);
  assert.equal((await clientsTrainerApp.inject({method:'GET',url:`/api/clients/${client.id}/entitlements/effective?date=2026-10-09`})).statusCode,200);
});

test('bonus balance is an append-only idempotent ledger; pause, resume and cancel are effective and audited', async () => {
  const service=await createService(`Bono ${randomUUID()}`);
  const created=await createPlan([service.id],{kind:'session_pack',renewalCadence:null,basePriceCents:9000,rights:[{rightType:'sessions_quota',serviceId:null,quotaScope:'shared',quantity:10}],modules:[{module:'reservations',accessLevel:'full',capabilities:[]}]});
  assert.equal(created.response.statusCode,201,created.response.body);
  const planId=created.response.json().id;
  assert.equal((await app.inject({method:'POST',url:`/api/plans/${planId}/activate`})).statusCode,200);
  const client=(await createClientRequest(clientsAdminApp,{firstName:'Bono',lastName:`Cliente ${randomUUID()}`})).json();
  const sale=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':randomUUID()},payload:{planId,startsOn:'2026-10-09',endsOn:'2027-01-06',dueOn:'2026-10-09',amountCents:9000}});
  assert.equal(sale.statusCode,201,sale.body);
  const [right]=await sql`SELECT id FROM plan_rights WHERE plan_id=${planId} AND right_type='sessions_quota'`;
  const adjustKey=randomUUID();const adjustment={rightId:right.id,quantity:-3,reason:'Corrección de saldo solicitada'};
  const adjusted=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans/${sale.json().id}/adjustments`,headers:{'idempotency-key':adjustKey},payload:adjustment});
  assert.equal(adjusted.statusCode,201,adjusted.body);
  const replay=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans/${sale.json().id}/adjustments`,headers:{'idempotency-key':adjustKey},payload:adjustment});
  assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().id,adjusted.json().id);
  const negative=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans/${sale.json().id}/adjustments`,headers:{'idempotency-key':randomUUID()},payload:{...adjustment,quantity:-8}});
  assert.equal(negative.statusCode,409);assert.equal(negative.json().error,'balance_cannot_be_negative');
  const pauseKey=randomUUID();
  const paused=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans/${sale.json().id}/pause`,headers:{'idempotency-key':pauseKey},payload:{effectiveOn:'2026-10-09',expectedResumeOn:'2026-10-16',reason:'Pausa solicitada por el cliente'}});
  assert.equal(paused.statusCode,201,paused.body);
  const pausedReplay=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans/${sale.json().id}/pause`,headers:{'idempotency-key':pauseKey},payload:{effectiveOn:'2026-10-09',expectedResumeOn:'2026-10-16',reason:'Pausa solicitada por el cliente'}});
  assert.equal(pausedReplay.statusCode,200);
  const pausedEffective=await clientsAdminApp.inject({method:'GET',url:`/api/clients/${client.id}/entitlements/effective?date=2026-10-09`});
  assert.equal(pausedEffective.json().assignments[0].status,'paused');assert.equal(pausedEffective.json().assignments[0].usable,false);
  const resumed=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans/${sale.json().id}/resume`,headers:{'idempotency-key':randomUUID()},payload:{effectiveOn:'2026-10-10'}});
  assert.equal(resumed.statusCode,201,resumed.body);
  const active=await clientsAdminApp.inject({method:'GET',url:`/api/clients/${client.id}/entitlements/effective?date=2026-10-10`});
  assert.equal(active.json().assignments[0].status,'active');assert.equal(active.json().rights[0].balance,7);
  const cancelled=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans/${sale.json().id}/cancel`,headers:{'idempotency-key':randomUUID()},payload:{effectiveOn:'2026-10-11',reason:'Baja solicitada por el cliente'}});
  assert.equal(cancelled.statusCode,201,cancelled.body);
  const cancelledEffective=await clientsAdminApp.inject({method:'GET',url:`/api/clients/${client.id}/entitlements/effective?date=2026-10-11`});
  assert.equal(cancelledEffective.json().assignments[0].status,'cancelled');assert.equal(cancelledEffective.json().assignments[0].usable,false);
  const movements=await clientsAdminApp.inject({method:'GET',url:`/api/clients/${client.id}/plans/${sale.json().id}/movements`});
  assert.equal(movements.statusCode,200);assert.deepEqual(movements.json().movements.map(row=>row.entryType).sort(),['adjustment','grant']);
  assert.ok(movements.json().events.some(row=>row.eventType==='paused'));
  const [counts]=await sql`SELECT (SELECT count(*)::int FROM client_entitlement_ledger WHERE assignment_id=${sale.json().id}) AS ledger,(SELECT count(*)::int FROM economic_audit_events WHERE client_id=${client.id} AND action IN ('client_plan.assigned','client_plan.balance_adjusted','client_plan.paused','client_plan.resumed','client_plan.cancelled')) AS audit`;
  assert.deepEqual(counts,{ledger:2,audit:5});
});

test('renew and change append new assignments and preserve the former assignment history', async () => {
  const service=await createService(`Cambio ${randomUUID()}`);const created=await createPlan([service.id],{basePriceCents:2500});
  const planId=created.response.json().id;assert.equal((await app.inject({method:'POST',url:`/api/plans/${planId}/activate`})).statusCode,200);
  const client=(await createClientRequest(clientsAdminApp,{firstName:'Cambio',lastName:`Cliente ${randomUUID()}`})).json();
  const sale=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':randomUUID()},payload:{planId,startsOn:'2026-10-01',endsOn:'2026-10-31',dueOn:'2026-10-01',amountCents:2500}});assert.equal(sale.statusCode,201,sale.body);
  const renewalKey=randomUUID();const renewal={planId,startsOn:'2026-11-01',endsOn:'2026-11-30',dueOn:'2026-11-01',amountCents:2500,sourceAssignmentId:sale.json().id,operationKind:'renewal'};
  const renewed=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':renewalKey},payload:renewal});assert.equal(renewed.statusCode,201,renewed.body);
  const renewalReplay=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':renewalKey},payload:renewal});assert.equal(renewalReplay.statusCode,200);assert.equal(renewalReplay.json().id,renewed.json().id);
  const [count]=await sql`SELECT count(*)::int AS total FROM client_plan_assignments WHERE client_id=${client.id}`;assert.equal(count.total,2);
  const movements=await clientsAdminApp.inject({method:'GET',url:`/api/clients/${client.id}/plans/${sale.json().id}/movements`});assert.ok(movements.json().events.some(event=>event.eventType==='renewed'));
});

test('canonical effective resolver keeps scheduled, expired and paused rights out and merges module levels explicitly', async () => {
  const assignments=[
    {id:'a',status:'active',startsOn:'2026-01-01',endsOn:null,snapshot:{services:[{id:'s1'}],areas:[{id:'ar1'}]},rights:[{rightType:'service_access',serviceId:null}],modules:[{module:'training',accessLevel:'limited',capabilities:['training.routines.read']}]},
    {id:'b',status:'active',startsOn:'2026-01-01',endsOn:null,snapshot:{services:[{id:'s1'},{id:'s2'}],areas:[{id:'ar1'},{id:'ar2'}]},rights:[{rightType:'sessions_quota',quantity:2}],modules:[{module:'training',accessLevel:'full',capabilities:['training.workouts.log']}]},
    {id:'c',status:'scheduled',startsOn:'2026-10-10',endsOn:null,snapshot:{},rights:[],modules:[]},
    {id:'d',status:'active',startsOn:'2026-01-01',endsOn:null,snapshot:{services:[{id:'s3'}]},rights:[{rightType:'sessions_quota',quantity:1,balance:0}],modules:[{module:'nutrition',accessLevel:'full',capabilities:[]}]},
  ];
  const effective=getEffectiveEntitlements(assignments,'2026-10-09');
  assert.equal(effective.assignments.find(item=>item.id==='c').usable,false);
  assert.equal(effective.assignments.find(item=>item.id==='d').status,'exhausted');assert.equal(effective.assignments.find(item=>item.id==='d').usable,false);
  assert.equal(effective.services.length,2);assert.equal(effective.modules.find(item=>item.module==='training').accessLevel,'full');assert.equal(effective.modules.some(item=>item.module==='nutrition'),false);
  assert.deepEqual(effective.modules.find(item=>item.module==='training').capabilities,['training.routines.read','training.workouts.log']);
  assert.equal(effective.rights.some(right=>right.rightType==='service_access'&&right.serviceId==null),false,'a legacy missing destination is never returned as effective access');
  assert.ok(effective.assignments.find(item=>item.id==='a').blockingReasons.includes('service_access_target_missing'));
});

test('2J-098E keeps provisional operational access usable before its bag is activated', () => {
  const effective=getEffectiveEntitlements([{
    id:'provisional',status:'active',startsOn:'2026-11-01',endsOn:'2026-11-30',operationalAccess:'provisional',snapshot:{services:[{id:'service'}]},
    rights:[{id:'quota',rightType:'sessions_quota',balance:0}],modules:[{module:'reservations',accessLevel:'limited',capabilities:['reservations.read']}],
  }],'2026-11-05');
  assert.equal(effective.assignments[0].usable,true);
  assert.equal(effective.assignments[0].operationalAccess,'provisional');
  assert.equal(effective.modules.length,1);
});

test('2J-073 concurrent identical renewal retries create one assignment and charge', async () => {
  const service=await createService(`Renovación concurrente ${randomUUID()}`);const created=await createPlan([service.id],{basePriceCents:2500});const planId=created.response.json().id;assert.equal((await app.inject({method:'POST',url:`/api/plans/${planId}/activate`})).statusCode,200);
  const client=(await createClientRequest(clientsAdminApp,{firstName:'Retry',lastName:`Renovación ${randomUUID()}`})).json();
  const original=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':randomUUID()},payload:{planId,startsOn:'2026-10-01',endsOn:'2026-10-31',dueOn:'2026-10-01',amountCents:2500}});assert.equal(original.statusCode,201,original.body);
  const key=randomUUID();const payload={planId,startsOn:'2026-11-01',endsOn:'2026-11-30',dueOn:'2026-11-01',amountCents:2500,sourceAssignmentId:original.json().id,operationKind:'renewal'};
  const results=await Promise.all([clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':key},payload}),clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':key},payload})]);
  assert.deepEqual(results.map(row=>row.statusCode).sort(),[200,201]);assert.equal(results[0].json().id,results[1].json().id);
  const [counts]=await sql`SELECT count(*)::int AS assignments,(SELECT count(*)::int FROM economic_charges WHERE client_id=${client.id}) AS charges FROM client_plan_assignments WHERE client_id=${client.id}`;assert.deepEqual(counts,{assignments:2,charges:2});
});

test('2J-073 concurrent bonus adjustments serialize and never overspend the ledger', async () => {
  const service=await createService(`Saldo concurrente ${randomUUID()}`);const created=await createPlan([service.id],{kind:'session_pack',renewalCadence:null,rights:[{rightType:'sessions_quota',serviceId:null,quotaScope:'shared',quantity:2}]});const planId=created.response.json().id;assert.equal((await app.inject({method:'POST',url:`/api/plans/${planId}/activate`})).statusCode,200);
  const client=(await createClientRequest(clientsAdminApp,{firstName:'Saldo',lastName:`Concurrente ${randomUUID()}`})).json();const sale=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':randomUUID()},payload:{planId,startsOn:'2026-10-09',endsOn:'2027-01-06',dueOn:'2026-10-09',amountCents:3000}});assert.equal(sale.statusCode,201,sale.body);
  const [right]=await sql`SELECT id FROM plan_rights WHERE plan_id=${planId} AND right_type='sessions_quota'`;const route=`/api/clients/${client.id}/plans/${sale.json().id}/adjustments`;
  const results=await Promise.all([1,2].map(()=>clientsAdminApp.inject({method:'POST',url:route,headers:{'idempotency-key':randomUUID()},payload:{rightId:right.id,quantity:-2,reason:'Ajuste concurrente aprobado'}})));
  assert.deepEqual(results.map(row=>row.statusCode).sort(),[201,409]);const [balance]=await sql`SELECT sum(quantity)::int AS remaining FROM client_entitlement_ledger WHERE assignment_id=${sale.json().id}`;assert.equal(balance.remaining,0);
});

test('session pack reaches the derived exhausted state when its append-only ledger reaches zero', async () => {
  const service=await createService(`Bono agotado ${randomUUID()}`);const created=await createPlan([service.id],{kind:'session_pack',renewalCadence:null,rights:[{rightType:'sessions_quota',serviceId:null,quotaScope:'shared',quantity:1}]});const planId=created.response.json().id;assert.equal((await app.inject({method:'POST',url:`/api/plans/${planId}/activate`})).statusCode,200);
  const client=(await createClientRequest(clientsAdminApp,{firstName:'Agotado',lastName:`Bono ${randomUUID()}`})).json();const sale=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':randomUUID()},payload:{planId,startsOn:'2026-10-09',endsOn:'2027-01-06',dueOn:'2026-10-09',amountCents:3000}});assert.equal(sale.statusCode,201,sale.body);const [right]=await sql`SELECT id FROM plan_rights WHERE plan_id=${planId} AND right_type='sessions_quota'`;
  const adjusted=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans/${sale.json().id}/adjustments`,headers:{'idempotency-key':randomUUID()},payload:{rightId:right.id,quantity:-1,reason:'Corrección total del saldo'}});assert.equal(adjusted.statusCode,201,adjusted.body);
  const effective=await clientsAdminApp.inject({method:'GET',url:`/api/clients/${client.id}/entitlements/effective?date=2026-10-09`});assert.equal(effective.json().assignments[0].status,'exhausted');assert.equal(effective.json().assignments[0].usable,false);assert.equal(effective.json().rights.length,0);
  const profile=await clientsAdminApp.inject({method:'GET',url:`/api/clients/${client.id}`});assert.equal(profile.json().summary.plans.data[0].derivedStatus,'exhausted');assert.equal(profile.json().summary.plans.data[0].rights[0].balance,0);
});

test('catalog writes require catalog.pricing.manage while reads remain available', async () => {
  const roles = [
    ['admin', clientsAdminApp, 201],
    ['trainer', clientsTrainerApp, 403],
    ['reception', clientsReceptionApp, 403],
    ['accountant', clientsAccountantApp, 403],
  ];
  for (const [role, server, expected] of roles) {
    const targetArea = (await clientsAdminApp.inject({ method: 'POST', url: '/api/areas', payload: { name: `Área objetivo ${role} ${randomUUID()}` } })).json();
    const createdArea = await server.inject({ method: 'POST', url: '/api/areas', payload: { name: `Área ${role} ${randomUUID()}` } });
    assert.equal(createdArea.statusCode, expected, `${role} area create`);
    const createdService = await server.inject({ method: 'POST', url: '/api/services', payload: { name: `Servicio ${role} ${randomUUID()}`, areaId: defaultArea.id, status: 'active' } });
    assert.equal(createdService.statusCode, expected, `${role} service create`);
    const archivedArea = await server.inject({ method: 'PATCH', url: `/api/areas/${targetArea.id}/archive` });
    assert.equal(archivedArea.statusCode, expected === 201 ? 200 : 403, `${role} area archive`);
    assert.equal((await server.inject({ method: 'GET', url: '/api/areas' })).statusCode, 200, `${role} area read`);
    assert.equal((await server.inject({ method: 'GET', url: '/api/services' })).statusCode, 200, `${role} service read`);
  }
  const service = await createService(`Servicio archivo permisos ${randomUUID()}`);
  assert.equal((await clientsTrainerApp.inject({ method: 'PATCH', url: `/api/services/${service.id}/archive` })).statusCode, 403);
  assert.equal((await clientsAdminApp.inject({ method: 'PATCH', url: `/api/services/${service.id}/archive` })).statusCode, 200);
});

test('service plan lookup requires calendar access and hides base prices from Trainer', async () => {
  const service = await createService(`Mi gimnasio ${randomUUID()}`);
  const created = await createPlan([service.id], { basePriceCents: 4250 });
  assert.equal(created.response.statusCode, 201, created.response.body);

  const adminPlans = await clientsAdminApp.inject({ method: 'GET', url: `/api/services/${service.id}/plans` });
  assert.equal(adminPlans.statusCode, 200);
  assert.equal(adminPlans.json()[0].basePriceCents, '4250');

  const trainerPlans = await clientsTrainerApp.inject({ method: 'GET', url: `/api/services/${service.id}/plans` });
  assert.equal(trainerPlans.statusCode, 200);
  assert.equal(Object.hasOwn(trainerPlans.json()[0], 'basePriceCents'), false);
  assert.equal(JSON.stringify(trainerPlans.json()).includes('4250'), false);

  assert.equal((await anonymousApp.inject({ method: 'GET', url: `/api/services/${service.id}/plans` })).statusCode, 401);
  assert.equal((await clientsAccountantApp.inject({ method: 'GET', url: `/api/services/${service.id}/plans` })).statusCode, 403);
});

test('Admin can update basic client profile including nullable date of birth with history; Trainer cannot', async () => {
  const created=await createClientRequest(clientsAdminApp,{firstName:'Perfil',lastName:`Actualizable ${randomUUID()}`});assert.equal(created.statusCode,201,created.body);
  const id=created.json().id;const payload={firstName:'Perfil',lastName:'Actualizado',email:`perfil.${randomUUID()}@example.test`,phone:'600000111',birthDate:'1990-04-06'};
  const forbidden=await clientsTrainerApp.inject({method:'PATCH',url:`/api/clients/${id}`,payload});assert.equal(forbidden.statusCode,403);
  const updated=await clientsAdminApp.inject({method:'PATCH',url:`/api/clients/${id}`,payload});assert.equal(updated.statusCode,200,updated.body);assert.equal(updated.json().birthDate,'1990-04-06');assert.equal(updated.json().lastName,'Actualizado');
  const detail=await clientsAdminApp.inject({method:'GET',url:`/api/clients/${id}`});assert.equal(detail.json().client.birthDate,'1990-04-06');assert.ok(detail.json().history.some(event=>event.eventType==='client.profile_updated'));
  const trainerDetail=await clientsTrainerApp.inject({method:'GET',url:`/api/clients/${id}`});assert.equal(trainerDetail.json().client.birthDate,undefined,'DOB is omitted without clients.manage');
  const cleared=await clientsAdminApp.inject({method:'PATCH',url:`/api/clients/${id}`,payload:{...payload,birthDate:null}});assert.equal(cleared.json().birthDate,null);
});

test('2J-098E creates a paid period once, prorates its bag, restores reservations to that period, and materializes only the next period', async () => {
  const service=await createService(`Periodos ${randomUUID()}`);
  const otherService=await createService(`Periodos compartidos ${randomUUID()}`);
  const created=await createPlan([service.id,otherService.id],{basePriceCents:5000,rights:[
    {rightType:'service_access',serviceId:service.id},
    {rightType:'service_access',serviceId:otherService.id},
    {rightType:'sessions_quota',serviceId:service.id,quotaScope:'per_service',quantity:8,weeklyFrequency:3},
    {rightType:'sessions_quota',serviceId:otherService.id,quotaScope:'per_service',quantity:8,weeklyFrequency:2},
  ]});
  assert.equal(created.response.statusCode,201,created.response.body);
  const planId=created.response.json().id;
  assert.equal((await app.inject({method:'POST',url:`/api/plans/${planId}/activate`})).statusCode,200);
  const client=(await createClientRequest(clientsAdminApp,{firstName:'Periodo',lastName:`Cliente ${randomUUID()}`})).json();
  const today=canaryBusinessDate(new Date());
  const startsOn=`${today.slice(0,7)}-01`;
  const periodEnd=new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7)),0)).toISOString().slice(0,10);
  const sale=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':randomUUID()},payload:{planId,startsOn,endsOn:null,dueOn:today,amountCents:5000}});
  assert.equal(sale.statusCode,201,sale.body);
  const rights=await sql`SELECT id,service_id AS "serviceId",weekly_frequency AS "weeklyFrequency" FROM plan_rights WHERE plan_id=${planId} AND right_type='sessions_quota' ORDER BY service_id`;
  const right=rights.find(item=>item.serviceId===service.id);const otherRight=rights.find(item=>item.serviceId===otherService.id);
  assert.ok(right);assert.ok(otherRight);
  const periodKey=randomUUID();
  const periodPayload={rightId:right.id,startsOn,endsOn:periodEnd,recurrenceEnabled:true,reason:'Configuración mensual inicial'};
  const period=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans/${sale.json().id}/entitlement-periods`,headers:{'idempotency-key':periodKey},payload:periodPayload});
  assert.equal(period.statusCode,201,period.body);
  const otherPeriod=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans/${sale.json().id}/entitlement-periods`,headers:{'idempotency-key':randomUUID()},payload:{...periodPayload,rightId:otherRight.id}});
  assert.equal(otherPeriod.statusCode,201,otherPeriod.body,'one assignment charge may cover multiple right bags within the same period window');
  const replay=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans/${sale.json().id}/entitlement-periods`,headers:{'idempotency-key':periodKey},payload:periodPayload});
  assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().id,period.json().id);
  assert.equal((await clientsReceptionApp.inject({method:'PATCH',url:`/api/clients/${client.id}/plans/${sale.json().id}/recurrence`,headers:{'idempotency-key':randomUUID()},payload:{enabled:false,effectiveOn:today,reason:'QA'} })).statusCode,403);
  assert.equal((await clientsTrainerApp.inject({method:'PATCH',url:`/api/clients/${client.id}/plans/${sale.json().id}/recurrence`,headers:{'idempotency-key':randomUUID()},payload:{enabled:false,effectiveOn:today,reason:'Pausa de recurrencia QA'} })).statusCode,201);
  const recurrenceResumeOn=new Date(`${today}T00:00:00.000Z`);recurrenceResumeOn.setUTCDate(recurrenceResumeOn.getUTCDate()+1);
  const recurrenceResumeDate=recurrenceResumeOn.toISOString().slice(0,10);
  assert.equal((await clientsTrainerApp.inject({method:'PATCH',url:`/api/clients/${client.id}/plans/${sale.json().id}/recurrence`,headers:{'idempotency-key':randomUUID()},payload:{enabled:true,effectiveOn:recurrenceResumeDate,reason:'Reactivación futura QA'} })).statusCode,201);
  const charge=await clientsAdminApp.inject({method:'GET',url:`/api/economics/charges?clientId=${client.id}`});
  const payment=await clientsAdminApp.inject({method:'POST',url:'/api/economics/payments',headers:{'idempotency-key':randomUUID()},payload:{chargeId:charge.json().items[0].id,splits:[{method:'card',amountCents:5000}]}});
  assert.equal(payment.statusCode,201,payment.body);
  const expected=proratedSessionsForPayment(today,periodEnd,3);
  const [activation]=await sql`SELECT effective_activation_on::text AS "effectiveOn",sessions_granted AS granted FROM assignment_entitlement_period_events WHERE period_id=${period.json().id} AND event_type='payment_validated'`;
  assert.equal(String(activation.effectiveOn),today);assert.equal(activation.granted,expected);
  const [otherActivation]=await sql`SELECT sessions_granted AS granted FROM assignment_entitlement_period_events WHERE period_id=${otherPeriod.json().id} AND event_type='payment_validated'`;
  assert.equal(otherActivation.granted,proratedSessionsForPayment(today,periodEnd,2));
  const [chargeCountBefore]=await sql`SELECT count(*)::int AS count FROM economic_charges WHERE client_id=${client.id}`;
  const sessionDate=new Date(`${today}T12:00:00Z`);sessionDate.setUTCDate(sessionDate.getUTCDate()+1);
  const session=await app.inject({method:'POST',url:'/api/calendar/sessions',payload:{serviceId:service.id,areaId:service.areaId,startsAt:sessionDate.toISOString(),durationMinutes:45,capacity:3}});
  assert.equal(session.statusCode,201,session.body);
  const booking=await app.inject({method:'POST',url:`/api/calendar/sessions/${session.json().id}/reservations`,payload:{clientId:client.id}});
  assert.equal(booking.statusCode,201,booking.body);
  const [consumed]=await sql`SELECT entitlement_period_id AS "periodId",quantity FROM client_entitlement_ledger WHERE external_reference=${`calendar_reservation:${booking.json().id}`}`;
  assert.equal(consumed.periodId,period.json().id);assert.equal(consumed.quantity,-1);
  const cancelled=await app.inject({method:'PATCH',url:`/api/calendar/reservations/${booking.json().id}/cancel`,payload:{}});
  assert.ok([200,201].includes(cancelled.statusCode),cancelled.body);
  const [restored]=await sql`SELECT entitlement_period_id AS "periodId",quantity FROM client_entitlement_ledger WHERE external_reference=${`calendar_reservation_restore:${booking.json().id}:${right.id}`}`;
  assert.equal(restored.periodId,period.json().id);assert.equal(restored.quantity,1);
  const materializeAt=new Date(`${periodEnd}T12:00:00Z`);materializeAt.setUTCDate(materializeAt.getUTCDate()+1);
  const first=await materializeRecurringEntitlementPeriods(sql,materializeAt);
  const second=await materializeRecurringEntitlementPeriods(sql,materializeAt);
  assert.equal(first.created,2,`first materialization failed: ${JSON.stringify({first,second,today,periodEnd,materializeAt:materializeAt.toISOString(),recurrenceResumeDate})}`);assert.equal(second.created,0);
  const [periodCounts]=await sql`SELECT count(*)::int AS periods,(SELECT count(*)::int FROM economic_charges WHERE client_id=${client.id}) AS charges FROM assignment_entitlement_periods WHERE assignment_id=${sale.json().id}`;
  assert.equal(periodCounts.periods,4);assert.equal(periodCounts.charges,chargeCountBefore.count,'recurrence creates periods only, never charges');
  const [next]=await sql`SELECT period_start::text AS starts_on,period_end::text AS ends_on FROM assignment_entitlement_periods WHERE assignment_id=${sale.json().id} AND right_id=${right.id} AND id<>${period.json().id}`;
  const expectedNext=new Date(`${periodEnd}T00:00:00Z`);expectedNext.setUTCDate(expectedNext.getUTCDate()+1);
  assert.equal(next.starts_on,expectedNext.toISOString().slice(0,10));
  const [legacy]=await sql`SELECT count(*)::int AS count FROM client_entitlement_ledger WHERE assignment_id=${sale.json().id} AND entitlement_period_id IS NULL`;
  assert.equal(legacy.count,0,'new recurring monthly rights never fall through to the legacy assignment bag');
});
