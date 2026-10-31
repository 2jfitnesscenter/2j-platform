import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { cancelUncoveredPeriodBookings } from '../src/membership-period-enforcement.ts';
import { enqueueMembershipPaymentDueNotices, dispatchNotificationBatch } from '../src/notifications.ts';
import { materializeAutomaticRenewals } from '../src/auto-renewal.ts';
import { evaluateBookingEligibility } from '../src/booking-eligibility.ts';
import { canaryLocalMidnightUtc } from '@2j/domain';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: A71 integration tests need disposable PostgreSQL.');
const sourceUrl = new URL(process.env.DATABASE_URL);
const databaseName = `a71_${randomUUID().replaceAll('-', '')}`;
const adminUrl = new URL(sourceUrl); adminUrl.pathname = '/postgres';
const root = postgres(adminUrl.toString(), { max: 1, connect_timeout: 5 });
await root.unsafe(`CREATE DATABASE "${databaseName}"`);
const databaseUrl = new URL(sourceUrl); databaseUrl.pathname = `/${databaseName}`;
const sql = postgres(databaseUrl.toString(), { max: 12, connect_timeout: 5 });
await migrateDatabase(sql);
const app = buildServer(databaseUrl.toString(), { authorizationResolver: async () => ({ actorId: 'a71-admin', role: 'admin' }) });
const trainerWithRenewal = buildServer(databaseUrl.toString(), { authorizationResolver: async () => ({ actorId: 'a71-renewer', role: 'trainer', explicitPermissions: ['entitlements.renew'] }) });
const trainerWithoutRenewal = buildServer(databaseUrl.toString(), { authorizationResolver: async () => ({ actorId: 'a71-trainer', role: 'trainer' }) });
const [area] = await sql`SELECT id FROM areas WHERE normalized_name='la sala'`;
if (!area) throw new Error('Synthetic fixture area La Sala is missing.');
const localDate = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = type => parts.find(part => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
};
const addDays = (value, amount) => {
  const date = new Date(`${value}T12:00:00.000Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10);
};
const monthWindow = () => {
  const [year, month] = localDate().split('-').map(Number);
  // Use the next Canary-local calendar month so all session fixtures remain future-dated.
  const first = new Date(Date.UTC(year, month, 1));
  const startsOn = first.toISOString().slice(0, 10);
  const endsOn = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return { startsOn, endsOn, dueOn: `${startsOn.slice(0, 7)}-10` };
};
const window = monthWindow();

after(async () => {
  await Promise.all([app.close(), trainerWithRenewal.close(), trainerWithoutRenewal.close()]);
  await sql.end();
  await root.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await root.end();
});

async function makeMonthlyAssignment({ termKind = 'natural_month' } = {}) {
  const serviceResponse = await app.inject({ method: 'POST', url: '/api/services', payload: { name: `A71 ${randomUUID()}`, areaId: area.id, status: 'active' } });
  assert.equal(serviceResponse.statusCode, 201, serviceResponse.body);
  const service = serviceResponse.json();
  const planPayload = {
    name: `A71 mensual ${randomUUID()}`, serviceIds: [service.id], kind: 'recurring', renewalCadence: 'monthly', basePriceCents: 4500,
    ...(termKind == null ? {} : { termKind, paymentBlock:'enforce' }), ...(termKind === 'rolling_months' ? { termMonths: 3, paymentRule: 'grace_from_assignment_v1' } : termKind ? { paymentRule: 'monthly_day10_v1' } : {}),
    rights: termKind==null ? [
      { rightType:'service_access',serviceId:service.id },
      { rightType:'sessions_quota',serviceId:service.id,quotaScope:'per_service',quantity:12 },
    ] : [
      { rightType: 'service_access', serviceId: service.id },
      { rightType: 'sessions_quota', serviceId: service.id, quotaScope: 'per_service', weeklyFrequency: 2, quantityRule: 'weekday_ratio_v1' },
    ],
  };
  const planResponse = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': randomUUID() }, payload: planPayload });
  assert.equal(planResponse.statusCode, 201, planResponse.body);
  const plan = planResponse.json();
  assert.equal((await app.inject({ method: 'POST', url: `/api/plans/${plan.id}/activate` })).statusCode, 200);
  const clientResponse = await app.inject({ method: 'POST', url: '/api/clients', headers: { 'idempotency-key': randomUUID() }, payload: { firstName: 'A71', lastName: `Synthetic ${randomUUID()}` } });
  assert.equal(clientResponse.statusCode, 201, clientResponse.body);
  const client = clientResponse.json();
  const saleResponse = await app.inject({ method: 'POST', url: `/api/clients/${client.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: {
    planId: plan.id, startsOn: window.startsOn, endsOn: window.endsOn, dueOn: window.dueOn, amountCents: 4500,
  } });
  assert.equal(saleResponse.statusCode, 201, saleResponse.body);
  const assignment = saleResponse.json();
  const [right] = await sql`SELECT id FROM plan_rights WHERE plan_id=${plan.id} AND plan_version=1 AND right_type='sessions_quota'`;
  assert.ok(right);
  const [period] = termKind == null ? [null] : await sql`SELECT id FROM assignment_entitlement_periods WHERE assignment_id=${assignment.id} AND right_id=${right.id} AND period_start=${window.startsOn}::date`;
  if(termKind!=null)assert.ok(period, 'contract assignment materializes its synthetic entitlement period');
  return { service, plan, client, assignment, rightId: right.id, period };
}

test('Programada permits reservations while unpaid through day 10, then day-11 worker cancels and restores the ledger once', async () => {
  const fixture = await makeMonthlyAssignment();
  const sessionResponse = await app.inject({ method: 'POST', url: '/api/calendar/sessions', payload: {
    serviceId: fixture.service.id, areaId: area.id, startsAt: `${window.startsOn.slice(0, 7)}-15T12:00:00.000Z`, durationMinutes: 60, capacity: 4,
  } });
  assert.equal(sessionResponse.statusCode, 201, sessionResponse.body);
  const session = sessionResponse.json();
  const beforeDue = await app.inject({ method: 'POST', url: `/api/calendar/sessions/${session.id}/reservations`, headers: { 'idempotency-key': randomUUID() }, payload: { clientId: fixture.client.id } });
  assert.equal(beforeDue.statusCode, 201, beforeDue.body);
  const reservationId = beforeDue.json().id;
  const beforeBalance = await sql`SELECT COALESCE(sum(quantity),0)::int AS balance FROM client_entitlement_ledger WHERE entitlement_period_id=${fixture.period.id} AND right_key=${fixture.rightId}::text`;
  const [consumed] = await sql`SELECT count(*)::int AS count FROM client_entitlement_ledger WHERE entitlement_period_id=${fixture.period.id} AND right_key=${fixture.rightId}::text AND entry_type='consume'`;
  assert.equal(consumed.count, 1, 'provisional booking is recorded in the immutable ledger');
  const cutoff=canaryLocalMidnightUtc(`${window.startsOn.slice(0,7)}-11`);
  const beforeCutoff=await cancelUncoveredPeriodBookings(sql,new Date(cutoff.getTime()-1));
  assert.equal(beforeCutoff.cancelled,0,'the reservation remains through the final instant of day 10 in Atlantic/Canary');
  const result = await cancelUncoveredPeriodBookings(sql, cutoff);
  assert.equal(result.cancelled, 1);
  assert.equal(result.localDate, `${window.startsOn.slice(0, 7)}-11`);
  const [reservation] = await sql`SELECT status FROM calendar_reservations WHERE id=${reservationId}`;
  assert.equal(reservation.status, 'cancelled_by_membership');
  const afterBalance = await sql`SELECT COALESCE(sum(quantity),0)::int AS balance FROM client_entitlement_ledger WHERE entitlement_period_id=${fixture.period.id} AND right_key=${fixture.rightId}::text`;
  assert.equal(afterBalance[0].balance, beforeBalance[0].balance + 1, 'restores the consumed provisional session');
  const repeated = await cancelUncoveredPeriodBookings(sql, new Date(`${window.startsOn.slice(0, 7)}-11T12:00:00.000Z`));
  assert.equal(repeated.cancelled, 0, 'second worker pass is idempotent');
  const blocked = await sql.begin(tx => evaluateBookingEligibility({
    tx, clientId: fixture.client.id, serviceId: fixture.service.id, startsAt: session.startsAt,
    now: new Date(`${window.startsOn.slice(0, 7)}-11T12:00:00.000Z`),
  }));
  assert.equal(blocked.eligible, false);
  assert.ok(blocked.blockingReasons?.includes('debt_restriction'));
  const [audit] = await sql`SELECT count(*)::int AS count FROM calendar_audit_events WHERE resource_id=${reservationId} AND action='reservation.cancelled_by_membership'`;
  assert.equal(audit.count, 1);
});

test('payment before the day-10 deadline keeps the period reservation and prevents membership cancellation', async () => {
  const fixture = await makeMonthlyAssignment();
  const sessionResponse = await app.inject({ method:'POST', url:'/api/calendar/sessions', payload:{
    serviceId:fixture.service.id, areaId:area.id, startsAt:`${window.startsOn.slice(0,7)}-16T12:00:00.000Z`, durationMinutes:60, capacity:4,
  }});
  assert.equal(sessionResponse.statusCode,201,sessionResponse.body);
  const session=sessionResponse.json();
  const booking=await app.inject({method:'POST',url:`/api/calendar/sessions/${session.id}/reservations`,headers:{'idempotency-key':randomUUID()},payload:{clientId:fixture.client.id}});
  assert.equal(booking.statusCode,201,booking.body);
  const proof=await app.inject({method:'POST',url:'/api/economics/transfer-proofs',payload:{chargeId:fixture.assignment.chargeId,amountCents:4500,contentType:'application/pdf',fileName:'a71-payment.pdf',base64:Buffer.from('%PDF-1.7\nA71 synthetic').toString('base64')}});
  assert.equal(proof.statusCode,201,proof.body);
  const payment=await trainerWithRenewal.inject({method:'POST',url:`/api/economics/transfer-proofs/${proof.json().id}/review`,payload:{decision:'validated',note:'Pago sintético antes del vencimiento'}});
  assert.equal(payment.statusCode,200,payment.body);
  const result=await cancelUncoveredPeriodBookings(sql,new Date(`${window.startsOn.slice(0,7)}-11T12:00:00.000Z`));
  assert.equal(result.cancelled,0,'a validated payment before the deadline prevents expiration');
  const [reservation]=await sql`SELECT status FROM calendar_reservations WHERE id=${booking.json().id}`;
  assert.equal(reservation.status,'reserved');
});

test('day-8 reminder also covers legacy monthly assignments without a contract-terms row', async () => {
  const fixture=await makeMonthlyAssignment({termKind:null});
  assert.equal((await sql`SELECT count(*)::int AS count FROM assignment_contract_terms WHERE assignment_id=${fixture.assignment.id}`)[0].count,0);
  const selected=await enqueueMembershipPaymentDueNotices(sql,new Date(`${window.startsOn.slice(0,7)}-08T12:00:00.000Z`));
  assert.ok(selected>=1);
  await dispatchNotificationBatch(sql,50,new Date(`${window.startsOn.slice(0,7)}-08T12:00:00.000Z`));
  assert.ok((await sql`SELECT count(*)::int AS count FROM notifications WHERE recipient_kind='client' AND recipient_id=${fixture.client.id} AND type='entitlement_payment_due'`)[0].count>=1);
});

test('day-8 payment notice is in-app, deduplicated, and only created for an unpaid linked charge', async () => {
  const fixture = await makeMonthlyAssignment();
  const now = new Date(`${window.startsOn.slice(0, 7)}-08T12:00:00.000Z`);
  const selected = await enqueueMembershipPaymentDueNotices(sql, now);
  assert.ok(selected >= 1, 'the unpaid assignment receives its day-8 notice');
  assert.equal(await enqueueMembershipPaymentDueNotices(sql, now), selected, 'repeat runs select the same due charges; outbox dedupe prevents duplicate events');
  const dispatched = await dispatchNotificationBatch(sql, 50, now);
  assert.ok(dispatched.delivered >= 1);
  const [notice] = await sql`SELECT type,title,body FROM notifications WHERE recipient_kind='client' AND recipient_id=${fixture.client.id} AND type='entitlement_payment_due'`;
  assert.equal(notice.title, 'Cuota pendiente');
  assert.match(notice.body, /antes del día 10/);
  assert.equal((await enqueueMembershipPaymentDueNotices(sql, new Date(`${window.startsOn.slice(0, 7)}-09T12:00:00.000Z`))), 0);
});

test('monthly auto-renewal permission is audited and materializes one pending next period at current price', async () => {
  const fixture = await makeMonthlyAssignment();
  const path = `/api/clients/${fixture.client.id}/plans/${fixture.assignment.id}/auto-renewal`;
  const denied = await trainerWithoutRenewal.inject({ method: 'PATCH', url: path, headers: { 'idempotency-key': randomUUID() }, payload: { enabled: true, reason: 'Renovación sintética' } });
  assert.equal(denied.statusCode, 403);
  const key = randomUUID();
  const enabled = await trainerWithRenewal.inject({ method: 'PATCH', url: path, headers: { 'idempotency-key': key }, payload: { enabled: true, reason: 'Renovación sintética' } });
  assert.equal(enabled.statusCode, 201, enabled.body);
  const replay = await trainerWithRenewal.inject({ method: 'PATCH', url: path, headers: { 'idempotency-key': key }, payload: { enabled: true, reason: 'Renovación sintética' } });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().id, enabled.json().id);
  const [audit] = await sql`SELECT count(*)::int AS count FROM economic_audit_events WHERE resource_id=${fixture.assignment.id} AND action='assignment.auto_renewal_changed'`;
  assert.equal(audit.count, 1);
  const workerDate = addDays(window.endsOn, -6);
  const result = await materializeAutomaticRenewals(sql, new Date(`${workerDate}T12:00:00.000Z`));
  assert.equal(result.created, 1);
  assert.equal((await materializeAutomaticRenewals(sql, new Date(`${workerDate}T12:00:00.000Z`))).created, 0);
  const nextStart = addDays(window.endsOn, 1);
  const nextEnd = new Date(Date.UTC(Number(nextStart.slice(0, 4)), Number(nextStart.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const nextDue = `${nextStart.slice(0, 7)}-10`;
  const [charge] = await sql`SELECT c.amount_cents AS amount,c.due_on::text AS due,c.state,p.period_start::text AS "start",p.period_end::text AS "end",p.sessions_snapshot AS sessions
    FROM economic_charges c JOIN assignment_entitlement_period_events e ON e.charge_id=c.id AND e.event_type='charge_linked'
    JOIN assignment_entitlement_periods p ON p.id=e.period_id WHERE p.assignment_id=${fixture.assignment.id} AND p.period_start=${nextStart}::date`;
  assert.equal(Number(charge.amount), 4500);
  assert.equal(charge.due, nextDue);
  assert.equal(charge.state, 'pending');
  assert.equal(charge.start, nextStart);
  assert.equal(charge.end, nextEnd);
  assert.ok(charge.sessions > 0);
  assert.equal((await sql`SELECT count(*)::int AS count FROM economic_transactions WHERE charge_id=(SELECT id FROM economic_charges WHERE due_on=${nextDue} AND client_id=${fixture.client.id})`)[0].count, 0, 'renewal never marks a payment');
  const sessionResponse=await app.inject({method:'POST',url:'/api/calendar/sessions',payload:{serviceId:fixture.service.id,areaId:area.id,startsAt:`${nextStart.slice(0,7)}-15T12:00:00.000Z`,durationMinutes:60,capacity:4}});
  assert.equal(sessionResponse.statusCode,201,sessionResponse.body);
  const session=sessionResponse.json();
  const booked=await app.inject({method:'POST',url:`/api/calendar/sessions/${session.id}/reservations`,headers:{'idempotency-key':randomUUID()},payload:{clientId:fixture.client.id}});
  assert.equal(booked.statusCode,201,booked.body,'the generated period is provisionally bookable before its day-10 deadline');
  const noticeNow=new Date(`${nextDue}T12:00:00.000Z`);noticeNow.setUTCDate(noticeNow.getUTCDate()-2);
  assert.ok(await enqueueMembershipPaymentDueNotices(sql,noticeNow)>=1,'the renewal charge receives its day-8 reminder');
  await dispatchNotificationBatch(sql,50,noticeNow);
  assert.ok((await sql`SELECT count(*)::int AS count FROM notifications WHERE recipient_kind='client' AND recipient_id=${fixture.client.id} AND type='entitlement_payment_due'`)[0].count>=1);
  const afterDeadline=new Date(`${nextDue}T12:00:00.000Z`);afterDeadline.setUTCDate(afterDeadline.getUTCDate()+1);
  const expired=await cancelUncoveredPeriodBookings(sql,afterDeadline);
  assert.equal(expired.cancelled,1,'day 11 cancels an unpaid renewed-period booking');
  const [reservation]=await sql`SELECT status FROM calendar_reservations WHERE id=${booked.json().id}`;
  assert.equal(reservation.status,'cancelled_by_membership');
  const blocked=await sql.begin(tx=>evaluateBookingEligibility({tx,clientId:fixture.client.id,serviceId:fixture.service.id,startsAt:session.startsAt,sessionId:session.id,now:afterDeadline}));
  assert.equal(blocked.eligible,false);
  assert.equal(blocked.reason,'debt_restriction');
});

test('term-enabled multi-month assignments cannot enable monthly auto-renewal', async () => {
  const fixture = await makeMonthlyAssignment({ termKind: 'rolling_months' });
  const response = await app.inject({ method: 'PATCH', url: `/api/clients/${fixture.client.id}/plans/${fixture.assignment.id}/auto-renewal`, headers: { 'idempotency-key': randomUUID() }, payload: { enabled: true, reason: 'No debe renovar trimestralmente' } });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error, 'monthly_recurring_assignment_required');
  const result = await materializeAutomaticRenewals(sql, new Date(`${addDays(window.endsOn, -6)}T12:00:00.000Z`));
  assert.equal(result.created, 0);
});

test('monthly renewal is off by default; disabling it is audited and prevents materialization', async () => {
  const fixture=await makeMonthlyAssignment();
  const path=`/api/clients/${fixture.client.id}/plans/${fixture.assignment.id}/auto-renewal`;
  const initial=await app.inject({method:'GET',url:path});
  assert.equal(initial.statusCode,200);assert.equal(initial.json().enabled,false);
  const enable=await trainerWithRenewal.inject({method:'PATCH',url:path,headers:{'idempotency-key':randomUUID()},payload:{enabled:true,reason:'Prueba sintética de activación'}});
  assert.equal(enable.statusCode,201,enable.body);
  const disable=await trainerWithRenewal.inject({method:'PATCH',url:path,headers:{'idempotency-key':randomUUID()},payload:{enabled:false,reason:'Prueba sintética de desactivación'}});
  assert.equal(disable.statusCode,201,disable.body);
  assert.equal((await app.inject({method:'GET',url:path})).json().enabled,false);
  const result=await materializeAutomaticRenewals(sql,new Date(`${addDays(window.endsOn,-6)}T12:00:00.000Z`));
  assert.equal(result.created,0);
  const [audit]=await sql`SELECT count(*)::int AS count FROM economic_audit_events WHERE resource_id=${fixture.assignment.id} AND action='assignment.auto_renewal_changed'`;
  assert.equal(audit.count,2);
});
