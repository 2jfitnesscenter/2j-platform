import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TransactionSql } from 'postgres';
import { can, type AuthorizationContext } from '@2j/permissions';
import { canaryBusinessDate, sessionsForPeriod, weekdaysInRange } from '@2j/domain';
import type { createDatabase } from './db.js';

type DB=ReturnType<typeof createDatabase>['client'];
type Tx=TransactionSql<Record<string,unknown>>;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid=(value:string)=>{const b=createHash('sha256').update(value).digest().subarray(0,16);b[6]=(b[6]!&15)|64;b[8]=(b[8]!&63)|128;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const monthEnd=(value:string)=>new Date(Date.UTC(Number(value.slice(0,4)),Number(value.slice(5,7)),0)).toISOString().slice(0,10);
const addDays=(value:string,days:number)=>{const d=new Date(`${value}T00:00:00.000Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};

export function registerAutomaticRenewalRoutes(app:FastifyInstance,db:DB,resolve:(request:FastifyRequest)=>Promise<AuthorizationContext|null>){
  app.get('/api/clients/:clientId/plans/:assignmentId/auto-renewal',async(request,reply)=>{
    reply.header('Cache-Control','no-store');const actor=await resolve(request);if(!actor)return reply.code(401).send({error:'authentication_required'});
    if(!can(actor,'clients.read')||!can(actor,'entitlements.read'))return reply.code(403).send({error:'permission_denied'});
    const params=request.params as {clientId:string;assignmentId:string};
    const [assignment]=await db`SELECT a.id,a.plan_id AS "planId",a.plan_version AS "planVersion",v.kind,v.renewal_cadence AS cadence,v.term_kind AS "termKind" FROM client_plan_assignments a JOIN plan_versions v ON v.plan_id=a.plan_id AND v.version=a.plan_version WHERE a.id=${params.assignmentId} AND a.client_id=${params.clientId} AND a.status='active'`;
    if(!assignment)return reply.code(404).send({error:'assignment_not_found'});
    if(assignment.kind!=='recurring'||assignment.cadence!=='monthly'||(assignment.termKind!=null&&assignment.termKind!=='natural_month'))return reply.code(409).send({error:'monthly_recurring_assignment_required'});
    const [quotaShape]=await db`SELECT count(*) FILTER(WHERE right_type='sessions_quota')::int AS total,
      count(*) FILTER(WHERE right_type='sessions_quota' AND (quantity_rule IS NULL OR quantity_rule='weekday_ratio_v1') AND weekly_frequency BETWEEN 1 AND 5)::int AS supported
      FROM plan_rights WHERE plan_id=${assignment.planId} AND plan_version=${assignment.planVersion}`;
    if(Number(quotaShape?.total)===0||Number(quotaShape?.total)!==Number(quotaShape?.supported))return reply.code(409).send({error:'automatic_renewal_requires_monthly_session_bags'});
    const [current]=await db`SELECT enabled,effective_on::text AS "effectiveOn",reason FROM assignment_auto_renewal_events WHERE assignment_id=${assignment.id} AND effective_on<=(now() AT TIME ZONE 'Atlantic/Canary')::date ORDER BY effective_on DESC,created_at DESC,id DESC LIMIT 1`;
    return {enabled:Boolean(current?.enabled),effectiveOn:current?.effectiveOn??null};
  });
  app.patch('/api/clients/:clientId/plans/:assignmentId/auto-renewal',async(request,reply)=>{
    reply.header('Cache-Control','no-store');const actor=await resolve(request);if(!actor)return reply.code(401).send({error:'authentication_required'});
    if(!can(actor,'clients.read')||!can(actor,'entitlements.renew'))return reply.code(403).send({error:'permission_denied'});
    const params=request.params as {clientId:string;assignmentId:string};const body=request.body as Record<string,unknown>;const key=String(request.headers['idempotency-key']??'');
    const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if(!uuidPattern.test(params.clientId)||!uuidPattern.test(params.assignmentId)||!uuidPattern.test(key)||typeof body?.enabled!=='boolean'||typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.length>240)return reply.code(400).send({error:'validation_error'});
    const enabled=body.enabled;const reason=body.reason.trim();const today=canaryBusinessDate(new Date());const requestHash=hash({actorId:actor.actorId,clientId:params.clientId.toLowerCase(),assignmentId:params.assignmentId.toLowerCase(),enabled,reason});const eventId=uuid(`a71-auto-renewal:${key}`);
    try{const result=await db.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
      const [prior]=await tx`SELECT id,request_hash AS "requestHash" FROM assignment_auto_renewal_events WHERE idempotency_key=${eventId}`;
      if(prior)return prior.requestHash.trim()===requestHash?{id:prior.id,replay:true as const}:{error:'idempotency_conflict' as const};
      const [assignment]=await tx`SELECT a.id,a.client_id AS "clientId",a.plan_id AS "planId",a.plan_version AS "planVersion",v.kind,v.renewal_cadence AS cadence,v.term_kind AS "termKind" FROM client_plan_assignments a JOIN plan_versions v ON v.plan_id=a.plan_id AND v.version=a.plan_version WHERE a.id=${params.assignmentId.toLowerCase()} AND a.client_id=${params.clientId.toLowerCase()} AND a.status='active' FOR UPDATE OF a`;
      if(!assignment)return{error:'assignment_not_found' as const};
      if(assignment.kind!=='recurring'||assignment.cadence!=='monthly'||(assignment.termKind!=null&&assignment.termKind!=='natural_month'))return{error:'monthly_recurring_assignment_required' as const};
      const [quotaShape]=await tx`SELECT count(*) FILTER(WHERE right_type='sessions_quota')::int AS total,
        count(*) FILTER(WHERE right_type='sessions_quota' AND (quantity_rule IS NULL OR quantity_rule='weekday_ratio_v1') AND weekly_frequency BETWEEN 1 AND 5)::int AS supported
        FROM plan_rights WHERE plan_id=${assignment.planId} AND plan_version=${assignment.planVersion}`;
      if(Number(quotaShape?.total)===0||Number(quotaShape?.total)!==Number(quotaShape?.supported))return{error:'automatic_renewal_requires_monthly_session_bags' as const};
      const [current]=await tx`SELECT enabled FROM assignment_auto_renewal_events WHERE assignment_id=${assignment.id} AND effective_on<=${today}::date ORDER BY effective_on DESC,created_at DESC,id DESC LIMIT 1`;
      if(Boolean(current?.enabled)===enabled)return{error:'renewal_state_unchanged' as const};
      const [event]=await tx`INSERT INTO assignment_auto_renewal_events(assignment_id,enabled,actor_id,effective_on,reason,idempotency_key,request_hash) VALUES (${assignment.id},${enabled},${actor.actorId},${today},${reason},${eventId},${requestHash}) RETURNING id`;
      await tx`INSERT INTO economic_audit_events(actor_id,action,resource_type,resource_id,client_id,details) VALUES (${actor.actorId},'assignment.auto_renewal_changed','client_plan_assignment',${assignment.id},${assignment.clientId},${JSON.stringify({enabled,effectiveOn:today,reason,eventId:event!.id})}::text::jsonb)`;
      return{id:event!.id,replay:false as const};
    });if('error'in result)return reply.code(result.error==='assignment_not_found'?404:409).send({error:result.error});return reply.code(result.replay?200:201).send(result);
    }catch(error){app.log.error({errorClass:error instanceof Error?error.name:'unknown'},'automatic renewal update failed');return reply.code(409).send({error:'automatic_renewal_conflict'});}
  });
}

/** A71 commercial renewal is intentionally separate from the legacy 098E bag materializer. */
export async function materializeAutomaticRenewals(db:DB,now=new Date()){
  const today=canaryBusinessDate(now);const eligible=await db`SELECT DISTINCT a.id AS "assignmentId",a.client_id AS "clientId" FROM client_plan_assignments a
    JOIN plan_versions v ON v.plan_id=a.plan_id AND v.version=a.plan_version
    JOIN assignment_auto_renewal_events e ON e.assignment_id=a.id
    JOIN assignment_entitlement_periods p ON p.assignment_id=a.id
    JOIN clients cl ON cl.id=a.client_id AND cl.status='active'
    WHERE a.status='active' AND v.kind='recurring' AND v.renewal_cadence='monthly'
      AND (v.term_kind IS NULL OR v.term_kind='natural_month')
      AND EXISTS(SELECT 1 FROM plan_rights r WHERE r.plan_id=a.plan_id AND r.plan_version=a.plan_version AND r.right_type='sessions_quota')
      AND NOT EXISTS(SELECT 1 FROM plan_rights r WHERE r.plan_id=a.plan_id AND r.plan_version=a.plan_version AND r.right_type='sessions_quota'
        AND (r.quantity_rule NOT IN ('weekday_ratio_v1') AND r.quantity_rule IS NOT NULL OR r.weekly_frequency NOT BETWEEN 1 AND 5 OR r.weekly_frequency IS NULL))
      AND e.enabled IS TRUE AND e.effective_on<=${today}::date
      AND p.period_end BETWEEN ${today}::date AND (${today}::date+7)
      AND NOT EXISTS(SELECT 1 FROM assignment_entitlement_periods newer WHERE newer.assignment_id=p.assignment_id AND newer.right_id=p.right_id AND newer.period_start>p.period_start)
      AND e.id=(SELECT e2.id FROM assignment_auto_renewal_events e2 WHERE e2.assignment_id=a.id AND e2.effective_on<=${today}::date ORDER BY e2.effective_on DESC,e2.created_at DESC,e2.id DESC LIMIT 1)
    ORDER BY a.id`;
  let created=0;
  for(const item of eligible){const count=await db.begin(async tx=>{
    const [activeClient]=await tx`SELECT id FROM clients WHERE id=${item.clientId} AND status='active' FOR UPDATE`;
    if(!activeClient)return 0;
    await tx`SELECT id FROM client_plan_assignments WHERE id=${item.assignmentId} FOR UPDATE`;
    const [setting]=await tx`SELECT enabled FROM assignment_auto_renewal_events WHERE assignment_id=${item.assignmentId} AND effective_on<=${today}::date ORDER BY effective_on DESC,created_at DESC,id DESC LIMIT 1`;
    if(!setting?.enabled)return 0;
    const [contract]=await tx`SELECT payment_rule AS "paymentRule",payment_block AS "paymentBlock" FROM assignment_contract_terms WHERE assignment_id=${item.assignmentId}`;
    const periods=await tx`SELECT p.id,p.right_id AS "rightId",p.period_start::text AS "periodStart",p.period_end::text AS "periodEnd",p.weekly_frequency AS "weeklyFrequency"
      FROM assignment_entitlement_periods p WHERE p.assignment_id=${item.assignmentId}
      AND NOT EXISTS(SELECT 1 FROM assignment_entitlement_periods newer WHERE newer.assignment_id=p.assignment_id AND newer.right_id=p.right_id AND newer.period_start>p.period_start)
      ORDER BY p.right_id FOR UPDATE`;
    if(!periods.length||periods.some(p=>String(p.periodStart).slice(-2)!=='01'||String(p.periodEnd)!==monthEnd(String(p.periodStart))||!Number.isInteger(Number(p.weeklyFrequency))||Number(p.weeklyFrequency)<1||Number(p.weeklyFrequency)>5))return 0;
    const ends=new Set(periods.map(p=>String(p.periodEnd)));if(ends.size!==1)return 0;
    const currentEnd=String(periods[0]!.periodEnd);if(currentEnd<today||currentEnd>addDays(today,7))return 0;
    const startsOn=addDays(currentEnd,1);const endsOn=monthEnd(startsOn);if(startsOn.slice(-2)!=='01')return 0;
    const [price]=await tx`SELECT a.plan_id AS "planId",p.current_version AS version,v.base_price_cents AS "priceCents",p.name FROM client_plan_assignments a JOIN plans p ON p.id=a.plan_id JOIN plan_versions v ON v.plan_id=p.id AND v.version=p.current_version WHERE a.id=${item.assignmentId} AND p.status='active' FOR SHARE OF p,v`;
    if(!price||price.priceCents==null||Number(price.priceCents)<=0)return 0;
    const dueOn=`${startsOn.slice(0,7)}-10`;const block=contract?.paymentBlock==='off'?'off':'enforce';
    const paymentDeadline={rule:'monthly_day10_v1',dueOn,assignedLocalDate:startsOn,accessBlockEffectiveOn:addDays(dueOn,1),paymentBlockEffectiveOn:block==='enforce'?addDays(dueOn,1):null};
    const chargeKey=uuid(`a71-monthly-charge:${item.assignmentId}:${startsOn}`);const chargeHash=hash({assignmentId:item.assignmentId,clientId:item.clientId,planId:price.planId,startsOn,endsOn,amountCents:Number(price.priceCents),dueOn});
    let [charge]=await tx`INSERT INTO economic_charges(client_id,plan_id,concept,amount_cents,due_on,state,created_by,idempotency_key,request_hash)
      VALUES (${item.clientId},${price.planId},${String(price.name).slice(0,130)} || ' · Renovación mensual',${Number(price.priceCents)},${dueOn},'pending','system:a71-auto-renewal',${chargeKey},${chargeHash}) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`;
    if(!charge){[charge]=await tx`SELECT id,request_hash AS "requestHash" FROM economic_charges WHERE idempotency_key=${chargeKey}`;if(!charge||charge.requestHash?.trim()!==chargeHash)throw new Error('renewal_charge_idempotency_conflict');}
    let insertedPeriods=0;
    for(const p of periods){const frequency=Number(p.weeklyFrequency);const bag=sessionsForPeriod(weekdaysInRange(startsOn,endsOn),frequency);const pHash=hash({assignmentId:item.assignmentId,clientId:item.clientId,rightId:p.rightId,startsOn,endsOn,frequency,chargeId:charge.id});const pKey=uuid(`a71-monthly-period:${item.assignmentId}:${String(p.rightId)}:${startsOn}`);
      let [period]=await tx`INSERT INTO assignment_entitlement_periods(assignment_id,client_id,right_id,period_start,period_end,weekly_frequency,sessions_snapshot,snapshot,idempotency_key,request_hash)
        VALUES (${item.assignmentId},${item.clientId},${p.rightId},${startsOn},${endsOn},${frequency},${bag},${JSON.stringify({quantityRule:'weekday_ratio_v1',automaticRenewal:true,payment:'manual',sessionsSnapshot:bag,weeklyFrequency:frequency,paymentRule:'monthly_day10_v1',paymentBlock:block,assignedLocalDate:startsOn,deadlineComputation:paymentDeadline})}::text::jsonb,${pKey},${pHash}) ON CONFLICT(assignment_id,right_id,period_start) DO NOTHING RETURNING id,request_hash AS "requestHash"`;
      if(!period){[period]=await tx`SELECT id,request_hash AS "requestHash" FROM assignment_entitlement_periods WHERE assignment_id=${item.assignmentId} AND right_id=${p.rightId} AND period_start=${startsOn}::date`;}
      if(!period||period.requestHash?.trim()!==pHash)throw new Error('renewal_period_idempotency_conflict');
      const linkKey=uuid(`a71-monthly-period-charge:${period.id}:${charge.id}`);const linkHash=hash({periodId:period.id,chargeId:charge.id});
      const [link]=await tx`INSERT INTO assignment_entitlement_period_events(period_id,assignment_id,client_id,right_id,event_type,charge_id,actor_id,reason,idempotency_key,request_hash)
        VALUES (${period.id},${item.assignmentId},${item.clientId},${p.rightId},'charge_linked',${charge.id},'system:a71-auto-renewal','Cargo pendiente de renovación mensual',${linkKey},${linkHash}) ON CONFLICT DO NOTHING RETURNING id`;
      if(!link){
        const [existingLink]=await tx`SELECT period_id AS "periodId",assignment_id AS "assignmentId",client_id AS "clientId",right_id AS "rightId",charge_id AS "chargeId",request_hash AS "requestHash"
          FROM assignment_entitlement_period_events WHERE period_id=${period.id} AND event_type='charge_linked'`;
        if(!existingLink||existingLink.periodId!==period.id||existingLink.assignmentId!==item.assignmentId||existingLink.clientId!==item.clientId||existingLink.rightId!==p.rightId||existingLink.chargeId!==charge.id||existingLink.requestHash?.trim()!==linkHash)throw new Error('renewal_charge_link_idempotency_conflict');
      }
      if(insertedPeriods===0)insertedPeriods=1;
    }
    if(insertedPeriods)await tx`INSERT INTO economic_audit_events(actor_id,action,resource_type,resource_id,client_id,details)
      VALUES ('system:a71-auto-renewal','assignment.monthly_renewal_materialized','client_plan_assignment',${item.assignmentId},${item.clientId},${JSON.stringify({chargeId:charge.id,startsOn,endsOn,dueOn,amountCents:Number(price.priceCents),periodCount:periods.length})}::text::jsonb)`;
    return insertedPeriods;
  });created+=count;}
  return{created,checked:eligible.length,timezone:'Atlantic/Canary' as const};
}
