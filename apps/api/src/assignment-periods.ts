import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TransactionSql } from 'postgres';
import { can, type AuthorizationContext } from '@2j/permissions';
import { canaryBusinessDate, nextMonthlyPeriod, proratedSessionsForPayment, sessionsForPeriod, weekdaysInRange } from '@2j/domain';
import type { createDatabase } from './db.js';

type DB = ReturnType<typeof createDatabase>['client'];
type Tx = TransactionSql<Record<string, unknown>>;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const deterministicUuid = (value: string) => {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};
const validDate = (value: string) => datePattern.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0,10) === value;
const monthEnd = (value: string) => new Date(Date.UTC(Number(value.slice(0,4)), Number(value.slice(5,7)), 0)).toISOString().slice(0,10);
const isCalendarMonth = (start: string, end: string) => start.endsWith('-01') && end === monthEnd(start);

export async function activateSettledEntitlementPeriods(tx: Tx, chargeId: string, actorId: string, now = new Date()) {
  const [charge] = await tx`SELECT id,client_id AS "clientId",amount_cents AS "amountCents",state FROM economic_charges WHERE id=${chargeId} FOR UPDATE`;
  if (!charge || charge.state !== 'pending') return 0;
  const [balance] = await tx`SELECT COALESCE(sum(amount_cents) FILTER(WHERE kind='payment'),0)::bigint AS paid,
    COALESCE(sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END),0)::bigint AS net
    FROM economic_transactions WHERE charge_id=${chargeId}`;
  if (Number(balance?.net ?? 0) < Number(charge.amountCents)) return 0;
  const linked = await tx`SELECT e.period_id AS "periodId",e.assignment_id AS "assignmentId",e.client_id AS "clientId",e.right_id AS "rightId",
      p.period_start::text AS "periodStart",p.period_end::text AS "periodEnd",p.weekly_frequency AS "weeklyFrequency",p.sessions_snapshot AS "sessionsSnapshot"
    FROM assignment_entitlement_period_events e JOIN assignment_entitlement_periods p ON p.id=e.period_id
    WHERE e.event_type='charge_linked' AND e.charge_id=${chargeId}
      AND NOT EXISTS(SELECT 1 FROM assignment_entitlement_period_events activated WHERE activated.period_id=e.period_id AND activated.event_type='payment_validated')
    ORDER BY e.period_id FOR UPDATE OF p`;
  const today = canaryBusinessDate(now);
  let activatedCount = 0;
  for (const period of linked) {
    const start = String(period.periodStart); const end = String(period.periodEnd);
    const effectiveOn = today < start ? start : today;
    const quantity = effectiveOn > end ? 0 : effectiveOn === start
      ? Number(period.sessionsSnapshot)
      : proratedSessionsForPayment(effectiveOn, end, Number(period.weeklyFrequency));
    const key = deterministicUuid(`period-payment:${period.periodId}:${chargeId}`);
    const requestHash = hash({ periodId: period.periodId, chargeId, effectiveOn, quantity });
    const [activation] = await tx`INSERT INTO assignment_entitlement_period_events(period_id,assignment_id,client_id,right_id,event_type,charge_id,effective_activation_on,sessions_granted,actor_id,reason,idempotency_key,request_hash)
      VALUES (${period.periodId},${period.assignmentId},${period.clientId},${period.rightId},'payment_validated',${chargeId},${effectiveOn},${quantity},${actorId},'Pago completo validado',${key},${requestHash})
      ON CONFLICT DO NOTHING RETURNING id`;
    if (!activation) continue;
    if (quantity > 0) {
      await tx`INSERT INTO client_entitlement_ledger(client_id,assignment_id,right_key,entitlement_period_id,entry_type,quantity,reason,actor_id,idempotency_key,request_hash)
        VALUES (${period.clientId},${period.assignmentId},${String(period.rightId)},${period.periodId},'grant',${quantity},'Bolsa congelada al validar el pago',${actorId},${deterministicUuid(`period-grant:${period.periodId}`)},${requestHash})
        ON CONFLICT DO NOTHING`;
    }
    await tx`INSERT INTO economic_audit_events(actor_id,action,resource_type,resource_id,client_id,details)
      VALUES (${actorId},'entitlement_period.payment_validated','client_plan_assignment',${period.assignmentId},${period.clientId},${JSON.stringify({periodId:period.periodId,chargeId,effectiveActivationOn:effectiveOn,sessionsGranted:quantity})}::jsonb)`;
    activatedCount += 1;
  }
  return activatedCount;
}

/** Idempotent local worker operation. It creates periods only; it never creates charges. */
export async function materializeRecurringEntitlementPeriods(db: DB, now = new Date()) {
  const today = canaryBusinessDate(now);
  const assignments = await db`SELECT DISTINCT ON (a.id,p.right_id) a.id AS "assignmentId",a.client_id AS "clientId",p.right_id AS "rightId",
      p.period_start::text AS "periodStart",p.period_end::text AS "periodEnd",p.weekly_frequency AS "weeklyFrequency",r.enabled AS recurring
    FROM assignment_entitlement_periods p JOIN client_plan_assignments a ON a.id=p.assignment_id
    JOIN LATERAL (SELECT enabled FROM assignment_recurrence_events e WHERE e.assignment_id=a.id AND e.effective_on<=${today}::date ORDER BY e.effective_on DESC,e.created_at DESC,e.id DESC LIMIT 1) r ON true
    WHERE p.period_end < ${today}::date
      AND NOT EXISTS (SELECT 1 FROM assignment_entitlement_periods newer WHERE newer.assignment_id=p.assignment_id AND newer.right_id=p.right_id AND newer.period_start>p.period_start)
    ORDER BY a.id,p.right_id,p.period_start DESC`;
  let created = 0;
  for (const row of assignments) {
    if (!row.recurring) continue;
    const result = await db.begin(async (tx) => {
      await tx`SELECT id FROM client_plan_assignments WHERE id=${row.assignmentId} FOR UPDATE`;
      const [setting] = await tx`SELECT enabled FROM assignment_recurrence_events WHERE assignment_id=${row.assignmentId} AND effective_on<=${today}::date ORDER BY effective_on DESC,created_at DESC,id DESC LIMIT 1`;
      if (!setting?.enabled) return 0;
      const [latest] = await tx`SELECT id,period_start::text AS "periodStart",period_end::text AS "periodEnd",weekly_frequency AS "weeklyFrequency",right_id AS "rightId",client_id AS "clientId"
        FROM assignment_entitlement_periods WHERE assignment_id=${row.assignmentId} AND right_id=${row.rightId} ORDER BY period_start DESC LIMIT 1`;
      if (!latest || String(latest.periodEnd) >= today) return 0;
      let next = nextMonthlyPeriod(`${row.assignmentId}:${row.rightId}`, { startsOn:String(latest.periodStart), endsOn:String(latest.periodEnd) }, true);
      if (!next) return 0;
      // Skip already elapsed months after downtime or OFF→ON; never backfill old periods.
      if (next.endsOn < today) {
        const monthStart = `${today.slice(0,7)}-01`;
        const nextMonthStart = new Date(Date.UTC(Number(monthStart.slice(0,4)),Number(monthStart.slice(5,7)),1)).toISOString().slice(0,10);
        const startDate = new Date(`${nextMonthStart}T00:00:00Z`);
        startDate.setUTCMonth(startDate.getUTCMonth()+1);
        const start = startDate.toISOString().slice(0,10);
        const end = monthEnd(start);
        next = { startsOn:start, endsOn:end, idempotencyKey:`period:${row.assignmentId}:${start}` };
      }
      const periodKey = deterministicUuid(next.idempotencyKey);
      const periodHash = hash({assignmentId:row.assignmentId,rightId:row.rightId,startsOn:next.startsOn,endsOn:next.endsOn,weeklyFrequency:row.weeklyFrequency});
      const bag = sessionsForPeriod(weekdaysInRange(next.startsOn,next.endsOn),Number(row.weeklyFrequency));
      const inserted = await tx`INSERT INTO assignment_entitlement_periods(assignment_id,client_id,right_id,period_start,period_end,weekly_frequency,sessions_snapshot,snapshot,idempotency_key,request_hash)
        VALUES (${row.assignmentId},${row.clientId},${row.rightId},${next.startsOn},${next.endsOn},${row.weeklyFrequency},${bag},jsonb_build_object('quantityRule','weekday_ratio_v1','recurrence',true,'payment','manual','sessionsSnapshot',${bag}::integer),${periodKey},${periodHash})
        ON CONFLICT(assignment_id,right_id,period_start) DO NOTHING RETURNING id`;
      if (inserted.length) await tx`INSERT INTO economic_audit_events(actor_id,action,resource_type,resource_id,client_id,details)
        VALUES ('system:entitlement-period-worker','entitlement_period.materialized','client_plan_assignment',${row.assignmentId},${row.clientId},jsonb_build_object('periodId',${inserted[0]!.id}::text,'rightId',${row.rightId}::text,'startsOn',${next.startsOn}::text,'endsOn',${next.endsOn}::text,'sessionsSnapshot',${bag}::integer))`;
      return inserted.length ? 1 : 0;
    });
    created += result;
  }
  return { created, checked: assignments.length, timezone:'Atlantic/Canary' as const };
}

export function registerAssignmentPeriodRoutes(app: FastifyInstance<any,any,any,any,any>, db: DB, resolve: (request: FastifyRequest) => Promise<AuthorizationContext|null>) {
  async function auth(request: FastifyRequest, reply: any, permission: string) {
    const context = await resolve(request);
    if (!context) { reply.code(401).send({error:'authentication_required'}); return null; }
    if (!can(context,permission) || !can(context,'clients.read')) { reply.code(403).send({error:'permission_denied'}); return null; }
    return context;
  }

  app.post('/api/clients/:clientId/plans/:assignmentId/entitlement-periods', async (request,reply) => {
    reply.header('Cache-Control','no-store');
    const context=await auth(request,reply,'entitlements.manage'); if(!context)return;
    const params=request.params as {clientId:string;assignmentId:string};
    const key=String(request.headers['idempotency-key']??'');
    const data=request.body as Record<string,unknown>;
    const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if(!uuidPattern.test(key) || !uuidPattern.test(params.clientId) || !uuidPattern.test(params.assignmentId)
      || typeof data!=='object' || data===null || typeof data.rightId!=='string' || !uuidPattern.test(data.rightId)
      || typeof data.startsOn!=='string' || !validDate(data.startsOn) || typeof data.endsOn!=='string' || !validDate(data.endsOn)
      || typeof data.recurrenceEnabled!=='boolean' || typeof data.reason!=='string' || data.reason.trim().length<3 || data.reason.length>240) {
      return reply.code(400).send({error:'validation_error'});
    }
    const body={rightId:data.rightId.toLowerCase(),startsOn:data.startsOn,endsOn:data.endsOn,recurrenceEnabled:data.recurrenceEnabled,reason:data.reason.trim()};
    if(!isCalendarMonth(body.startsOn,body.endsOn))return reply.code(422).send({error:'period_must_be_calendar_month'});
    const requestHash=hash({clientId:params.clientId.toLowerCase(),assignmentId:params.assignmentId.toLowerCase(),...body});
    try {
      const result=await db.begin(async tx=>{
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
        const [prior]=await tx`SELECT id,request_hash AS "requestHash" FROM assignment_entitlement_periods WHERE idempotency_key=${deterministicUuid(`initial-period:${key}`)}`;
        if(prior)return prior.requestHash.trim()===requestHash?{id:prior.id,replay:true as const}:{error:'idempotency_conflict' as const};
        const [assignment]=await tx`SELECT a.id,a.client_id AS "clientId",a.plan_id AS "planId",a.plan_version AS "planVersion",a.charge_id AS "chargeId",a.starts_on AS "startsOn",a.ends_on AS "endsOn",v.kind,v.renewal_cadence AS cadence
          FROM client_plan_assignments a JOIN plan_versions v ON v.plan_id=a.plan_id AND v.version=a.plan_version
          WHERE a.id=${params.assignmentId.toLowerCase()} AND a.client_id=${params.clientId.toLowerCase()} AND a.status='active' FOR UPDATE OF a`;
        if(!assignment)return{error:'assignment_not_found' as const};
        if(assignment.kind!=='recurring'||assignment.cadence!=='monthly')return{error:'monthly_recurring_assignment_required' as const};
        if(body.startsOn<String(assignment.startsOn)||(assignment.endsOn&&body.endsOn>String(assignment.endsOn)))return{error:'period_outside_assignment' as const};
        const [right]=await tx`SELECT id,weekly_frequency AS "weeklyFrequency" FROM plan_rights WHERE id=${body.rightId} AND plan_id=${assignment.planId} AND plan_version=${assignment.planVersion} AND right_type='sessions_quota'`;
        if(!right)return{error:'monthly_session_quota_required' as const};
        if(!right.weeklyFrequency)return{error:'weekly_frequency_required' as const};
        const weeklyFrequency=Number(right.weeklyFrequency);
        const bag=sessionsForPeriod(weekdaysInRange(body.startsOn,body.endsOn),weeklyFrequency);
        const periodKey=deterministicUuid(`initial-period:${key}`);
        const [period]=await tx`INSERT INTO assignment_entitlement_periods(assignment_id,client_id,right_id,period_start,period_end,weekly_frequency,sessions_snapshot,snapshot,idempotency_key,request_hash)
          VALUES (${assignment.id},${assignment.clientId},${body.rightId},${body.startsOn},${body.endsOn},${weeklyFrequency},${bag},${JSON.stringify({quantityRule:'weekday_ratio_v1',recurrence:body.recurrenceEnabled,payment:'manual',sessionsSnapshot:bag,weeklyFrequency})}::jsonb,${periodKey},${requestHash}) RETURNING id`;
        const recurrenceKey=deterministicUuid(`recurrence-initial:${key}`);
        await tx`INSERT INTO assignment_recurrence_events(assignment_id,enabled,actor_id,effective_on,reason,idempotency_key,request_hash)
          VALUES (${assignment.id},${body.recurrenceEnabled},${context.actorId},${body.startsOn},${body.reason},${recurrenceKey},${requestHash})`;
        const chargeEventKey=deterministicUuid(`period-charge-link:${key}`);
        await tx`INSERT INTO assignment_entitlement_period_events(period_id,assignment_id,client_id,right_id,event_type,charge_id,actor_id,reason,idempotency_key,request_hash)
          VALUES (${period!.id},${assignment.id},${assignment.clientId},${body.rightId},'charge_linked',${assignment.chargeId},${context.actorId},'Cargo inicial de la asignación',${chargeEventKey},${requestHash})`;
        await tx`INSERT INTO economic_audit_events(actor_id,action,resource_type,resource_id,client_id,details)
          VALUES (${context.actorId},'entitlement_period.created','client_plan_assignment',${assignment.id},${assignment.clientId},${JSON.stringify({periodId:period!.id,rightId:body.rightId,startsOn:body.startsOn,endsOn:body.endsOn,sessionsSnapshot:bag,weeklyFrequency,recurrenceEnabled:body.recurrenceEnabled})}::jsonb)`;
        await activateSettledEntitlementPeriods(tx,assignment.chargeId,context.actorId);
        return{id:period!.id,sessionsSnapshot:bag,replay:false as const};
      });
      if('error'in result)return reply.code(result.error==='assignment_not_found'?404:409).send({error:result.error});
      return reply.code(result.replay?200:201).send(result);
    } catch(error){app.log.error({errorClass:error instanceof Error?error.name:'unknown',route:'POST /api/clients/:clientId/plans/:assignmentId/entitlement-periods'},'entitlement period create failed');return reply.code(409).send({error:'entitlement_period_conflict'});}
  });

  app.patch('/api/clients/:clientId/plans/:assignmentId/recurrence',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    const context=await auth(request,reply,'entitlements.recurrence.manage'); if(!context)return;
    const params=request.params as {clientId:string;assignmentId:string}; const data=request.body as Record<string,unknown>; const key=String(request.headers['idempotency-key']??'');
    const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if(!uuidPattern.test(key)||!uuidPattern.test(params.clientId)||!uuidPattern.test(params.assignmentId)||!/^\d{4}-\d{2}-\d{2}$/.test(String(data?.effectiveOn??''))||typeof data.enabled!=='boolean'||typeof data.reason!=='string'||data.reason.trim().length<3||data.reason.length>240)return reply.code(400).send({error:'validation_error'});
    if(!validDate(String(data.effectiveOn)))return reply.code(400).send({error:'validation_error'});
    const effectiveOn=String(data.effectiveOn);const reason=String(data.reason).trim();const enabled=Boolean(data.enabled);const today=canaryBusinessDate(new Date());
    if(effectiveOn<today)return reply.code(422).send({error:'recurrence_change_cannot_be_retroactive'});
    const requestHash=hash({assignmentId:params.assignmentId,clientId:params.clientId,enabled,effectiveOn,reason});
    try{
      const result=await db.begin(async tx=>{
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
        const keyId=deterministicUuid(`recurrence-change:${key}`);
        const [prior]=await tx`SELECT id,request_hash AS "requestHash" FROM assignment_recurrence_events WHERE idempotency_key=${keyId}`;
        if(prior)return prior.requestHash.trim()===requestHash?{id:prior.id,replay:true as const}:{error:'idempotency_conflict' as const};
        const [assignment]=await tx`SELECT a.id,v.kind,v.renewal_cadence AS cadence FROM client_plan_assignments a JOIN plan_versions v ON v.plan_id=a.plan_id AND v.version=a.plan_version
          WHERE a.id=${params.assignmentId} AND a.client_id=${params.clientId} AND a.status='active' FOR UPDATE OF a`;
        if(!assignment)return{error:'assignment_not_found' as const};
        if(assignment.kind!=='recurring'||assignment.cadence!=='monthly')return{error:'monthly_recurring_assignment_required' as const};
        const [period]=await tx`SELECT id FROM assignment_entitlement_periods WHERE assignment_id=${assignment.id} LIMIT 1`;
        if(!period)return{error:'entitlement_period_not_initialized' as const};
        const [current]=await tx`SELECT enabled FROM assignment_recurrence_events WHERE assignment_id=${assignment.id} AND effective_on<=${today}::date ORDER BY effective_on DESC,created_at DESC,id DESC LIMIT 1`;
        if(current?.enabled===enabled)return{error:'recurrence_state_unchanged' as const};
        const [event]=await tx`INSERT INTO assignment_recurrence_events(assignment_id,enabled,actor_id,effective_on,reason,idempotency_key,request_hash)
          VALUES (${assignment.id},${enabled},${context.actorId},${effectiveOn},${reason},${keyId},${requestHash}) RETURNING id`;
        await tx`INSERT INTO economic_audit_events(actor_id,action,resource_type,resource_id,client_id,details)
          SELECT ${context.actorId},'entitlement.recurrence_changed','client_plan_assignment',${assignment.id},a.client_id,${JSON.stringify({enabled,effectiveOn,reason,eventId:event!.id})}::jsonb FROM client_plan_assignments a WHERE a.id=${assignment.id}`;
        return{id:event!.id,replay:false as const};
      });
      if('error'in result)return reply.code(result.error==='assignment_not_found'?404:409).send({error:result.error});
      return reply.code(result.replay?200:201).send(result);
    }catch(error){app.log.error({errorClass:error instanceof Error?error.name:'unknown',route:'PATCH /api/clients/:clientId/plans/:assignmentId/recurrence'},'recurrence change failed');return reply.code(409).send({error:'recurrence_change_conflict'});}
  });

  app.post('/api/clients/:clientId/plans/:assignmentId/entitlement-periods/:periodId/charge',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    const context=await auth(request,reply,'billing.payments.manage'); if(!context)return;
    const params=request.params as {clientId:string;assignmentId:string;periodId:string};const data=request.body as Record<string,unknown>;const key=String(request.headers['idempotency-key']??'');
    const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if(!uuidPattern.test(key)||!uuidPattern.test(params.clientId)||!uuidPattern.test(params.assignmentId)||!uuidPattern.test(params.periodId)||typeof data?.chargeId!=='string'||!uuidPattern.test(data.chargeId)||typeof data.reason!=='string'||data.reason.trim().length<3||data.reason.length>240)return reply.code(400).send({error:'validation_error'});
    const chargeId=data.chargeId.toLowerCase();const reason=data.reason.trim();const requestHash=hash({clientId:params.clientId,assignmentId:params.assignmentId,periodId:params.periodId,chargeId,reason});
    try{
      const result=await db.begin(async tx=>{
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
        const keyId=deterministicUuid(`period-charge-link:${key}`);
        const [prior]=await tx`SELECT id,request_hash AS "requestHash" FROM assignment_entitlement_period_events WHERE idempotency_key=${keyId}`;
        if(prior)return prior.requestHash.trim()===requestHash?{id:prior.id,replay:true as const}:{error:'idempotency_conflict' as const};
        const [period]=await tx`SELECT p.id,p.assignment_id AS "assignmentId",p.client_id AS "clientId",p.right_id AS "rightId",p.period_start::text AS "periodStart",p.period_end::text AS "periodEnd"
          FROM assignment_entitlement_periods p WHERE p.id=${params.periodId} AND p.assignment_id=${params.assignmentId} AND p.client_id=${params.clientId} FOR UPDATE`;
        if(!period)return{error:'period_not_found' as const};
        const [charge]=await tx`SELECT id,state FROM economic_charges WHERE id=${chargeId} AND client_id=${period.clientId} FOR UPDATE`;
        if(!charge)return{error:'charge_not_found' as const};
        if(charge.state!=='pending')return{error:'charge_not_payable' as const};
        const [linkedWindow]=await tx`SELECT e.assignment_id AS "assignmentId",p.period_start::text AS "periodStart",p.period_end::text AS "periodEnd"
          FROM assignment_entitlement_period_events e JOIN assignment_entitlement_periods p ON p.id=e.period_id
          WHERE e.charge_id=${chargeId} AND e.event_type='charge_linked' LIMIT 1`;
        if(linkedWindow&&(linkedWindow.assignmentId!==period.assignmentId||linkedWindow.periodStart!==period.periodStart||linkedWindow.periodEnd!==period.periodEnd))return{error:'charge_period_conflict' as const};
        const [linked]=await tx`SELECT id FROM assignment_entitlement_period_events WHERE period_id=${period.id} AND event_type='charge_linked'`;
        if(linked)return{error:'period_charge_already_linked' as const};
        const [event]=await tx`INSERT INTO assignment_entitlement_period_events(period_id,assignment_id,client_id,right_id,event_type,charge_id,actor_id,reason,idempotency_key,request_hash)
          VALUES (${period.id},${period.assignmentId},${period.clientId},${period.rightId},'charge_linked',${chargeId},${context.actorId},${reason},${keyId},${requestHash}) RETURNING id`;
        await tx`INSERT INTO economic_audit_events(actor_id,action,resource_type,resource_id,client_id,details)
          VALUES (${context.actorId},'entitlement_period.charge_linked','client_plan_assignment',${period.assignmentId},${period.clientId},${JSON.stringify({periodId:period.id,chargeId,reason,eventId:event!.id})}::jsonb)`;
        await activateSettledEntitlementPeriods(tx,chargeId,context.actorId);
        return{id:event!.id,replay:false as const};
      });
      if('error'in result)return reply.code(result.error==='period_not_found'||result.error==='charge_not_found'?404:409).send({error:result.error});
      return reply.code(result.replay?200:201).send(result);
    }catch(error){app.log.error({errorClass:error instanceof Error?error.name:'unknown',route:'POST /api/clients/:clientId/plans/:assignmentId/entitlement-periods/:periodId/charge'},'period charge link failed');return reply.code(409).send({error:'period_charge_link_conflict'});}
  });
}
