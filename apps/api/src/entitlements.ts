import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import { derivePeriodAccess } from '@2j/domain';
import type { createDatabase } from './db.js';

type DB = ReturnType<typeof createDatabase>['client'];
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const todayInCanary = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Atlantic/Canary',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const modules = ['reservations','training','nutrition','health'] as const;

export interface EffectiveEntitlementAssignment {
  readonly id: string;
  readonly status: 'scheduled'|'active'|'paused'|'expired'|'cancelled'|'exhausted';
  readonly startsOn: string;
  readonly endsOn: string|null;
  readonly snapshot: Record<string, unknown>;
  readonly rights: readonly Record<string, unknown>[];
  readonly modules: readonly {module:string;accessLevel:'limited'|'full';capabilities:readonly string[]}[];
  readonly operationalAccess?: 'active'|'provisional'|'blocked_unpaid'|'ended';
}

/** Canonical date/status filtering used by the API and future booking eligibility wiring. */
export function getEffectiveEntitlements(assignments: readonly EffectiveEntitlementAssignment[], localDate: string) {
  const statusOf = (assignment:EffectiveEntitlementAssignment):EffectiveEntitlementAssignment['status'] => {
    if(assignment.status!=='active')return assignment.status;
    if(assignment.operationalAccess==='provisional')return 'active';
    const trackedQuotas=assignment.rights.filter(right=>right.rightType==='sessions_quota'&&typeof right.balance==='number');
    return trackedQuotas.length>0&&trackedQuotas.every(right=>Number(right.balance)<=0)?'exhausted':'active';
  };
  const effective = assignments.flatMap((assignment) => {
    const status = statusOf(assignment);
    const inDateRange = assignment.startsOn <= localDate && (!assignment.endsOn || assignment.endsOn >= localDate);
    if (status !== 'active' || !inDateRange || (assignment.operationalAccess && !['active','provisional'].includes(assignment.operationalAccess))) return [];
    const snapshotModules = assignment.modules.map((entry) => ({ ...entry, capabilities: [...entry.capabilities] }));
    const missingServiceTarget = assignment.rights.some(right => right.rightType === 'service_access' && right.serviceId == null);
    const safeRights = assignment.rights.filter(right => right.rightType !== 'service_access' || right.serviceId != null);
    return [{ ...assignment, usable: true as const, services: (assignment.snapshot.services as unknown[] | undefined) ?? [], areas: (assignment.snapshot.areas as unknown[] | undefined) ?? [], rights: safeRights, modules: snapshotModules, blockingReasons: missingServiceTarget ? ['service_access_target_missing'] : [] as string[] }];
  });
  return {
    asOf: localDate,
    assignments: assignments.map((assignment) => {const status=statusOf(assignment);const reasons=status!=='active'?[status]:assignment.startsOn>localDate?['not_started']:assignment.endsOn&&assignment.endsOn<localDate?['expired']:[];const missingServiceTarget=assignment.rights.some(right=>right.rightType==='service_access'&&right.serviceId==null);if(status==='active'&&missingServiceTarget)reasons.push('service_access_target_missing');return {...assignment,status,usable:effective.some((item)=>item.id===assignment.id)&&!missingServiceTarget,rights:assignment.rights.filter(right=>right.rightType!=='service_access'||right.serviceId!=null),blockingReasons:reasons};}),
    services: uniqueObjects(effective.flatMap(item => item.snapshot.services as Array<Record<string,unknown>> ?? []), 'id'),
    areas: uniqueObjects(effective.flatMap(item => item.snapshot.areas as Array<Record<string,unknown>> ?? []), 'id'),
    rights: effective.flatMap(item => item.rights.map(right => ({...right, assignmentId:item.id, status:statusOf(item)}))),
    modules: mergeModuleAccess(effective.flatMap(item => item.modules.map(module => ({...module,assignmentId:item.id})))),
  };
}

function uniqueObjects(items: Array<Record<string,unknown>>, key: string) {
  return [...new Map(items.map(item => [String(item[key]),item])).values()];
}

function mergeModuleAccess(items: Array<{module:string;accessLevel:'limited'|'full';capabilities:readonly string[];assignmentId:string}>) {
  const byModule = new Map<string,{module:string;accessLevel:'limited'|'full';capabilities:Set<string>;assignmentIds:Set<string>}>();
  for (const item of items) {
    const current = byModule.get(item.module) ?? {module:item.module,accessLevel:item.accessLevel,capabilities:new Set<string>(),assignmentIds:new Set<string>()};
    if (item.accessLevel === 'full') current.accessLevel = 'full';
    item.capabilities.forEach(value => current.capabilities.add(value)); current.assignmentIds.add(item.assignmentId); byModule.set(item.module,current);
  }
  return [...byModule.values()].sort((a,b)=>a.module.localeCompare(b.module)).map(item=>({...item,capabilities:[...item.capabilities].sort(),assignmentIds:[...item.assignmentIds]}));
}

export function registerEntitlementRoutes(app: FastifyInstance<any,any,any,any,any>, db: DB, resolve: (request: FastifyRequest) => Promise<AuthorizationContext|null>) {
  async function auth(request: FastifyRequest, reply: any, permission: string) {
    const context = await resolve(request);
    if (!context) { reply.code(401).send({error:'authentication_required'}); return null; }
    if (!can(context,permission) || !can(context,'clients.read')) { reply.code(403).send({error:'permission_denied'}); return null; }
    return context;
  }
  const paramsSchema = z.object({clientId:uuid,assignmentId:uuid}).strict();
  const operationSchema = z.object({effectiveOn:date.optional(),reason:z.string().trim().min(3).max(240).optional(),expectedResumeOn:date.nullable().optional()}).strict();

  app.get('/api/clients/:clientId/entitlements/effective', async (request,reply) => {
    reply.header('Cache-Control','no-store');
    if (!await auth(request,reply,'entitlements.read')) return;
    const params=z.object({clientId:uuid}).safeParse(request.params);
    const query=z.object({date:date.optional()}).safeParse(request.query);
    if(!params.success||!query.success)return reply.code(400).send({error:'invalid_entitlement_query'});
    const [client]=await db`SELECT id FROM clients WHERE id=${params.data.clientId}`;
    if(!client)return reply.code(404).send({error:'client_not_found'});
    const localDate=query.data.date??todayInCanary();
    const rows=await db`SELECT a.id,a.plan_id AS "planId",a.plan_version AS "planVersion",a.starts_on::text AS "startsOn",a.ends_on::text AS "endsOn",a.snapshot,
      COALESCE((SELECT e.event_type FROM client_plan_assignment_events e WHERE e.assignment_id=a.id AND e.effective_on<=${localDate}::date ORDER BY e.effective_on DESC,e.created_at DESC,e.id DESC LIMIT 1),'activated') AS "lastEvent",
      (SELECT jsonb_agg(jsonb_build_object('id',r.id,'rightType',r.right_type,'serviceId',r.service_id,'quotaScope',r.quota_scope,'quantity',r.quantity,'weeklyFrequency',r.weekly_frequency,'period',r.period,'periodMode',r.period_mode,'timezone',r.timezone,'validDays',r.valid_days,'validDaysStartRule',r.valid_days_start_rule) ORDER BY r.id) FROM plan_rights r WHERE r.plan_id=a.plan_id AND r.plan_version=a.plan_version) AS rights,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('module',m.module,'accessLevel',m.access_level,'capabilities',COALESCE((SELECT jsonb_agg(c.capability ORDER BY c.capability) FROM plan_module_capabilities c WHERE c.plan_id=m.plan_id AND c.plan_version=m.plan_version AND c.module=m.module),'[]'::jsonb)) ORDER BY m.module),'[]'::jsonb) FROM plan_module_accesses m WHERE m.plan_id=a.plan_id AND m.plan_version=a.plan_version) AS modules,
      (SELECT COALESCE(jsonb_object_agg(l.right_key,l.balance),'{}'::jsonb) FROM (SELECT right_key,sum(quantity)::int balance FROM client_entitlement_ledger WHERE assignment_id=a.id GROUP BY right_key) l) AS balances
      FROM client_plan_assignments a WHERE a.client_id=${params.data.clientId} ORDER BY a.starts_on DESC,a.created_at DESC,a.id DESC`;
    type PeriodRow={id:string;assignmentId:string;rightId:string;startsOn:string;endsOn:string;weeklyFrequency:number;sessionsSnapshot:number;balance:number;paymentValidated:boolean;recurring:boolean};
    const periodRows=await db<PeriodRow[]>`SELECT p.id,p.assignment_id AS "assignmentId",p.right_id AS "rightId",p.period_start::text AS "startsOn",p.period_end::text AS "endsOn",p.weekly_frequency AS "weeklyFrequency",p.sessions_snapshot AS "sessionsSnapshot",
      COALESCE((SELECT sum(l.quantity)::int FROM client_entitlement_ledger l WHERE l.entitlement_period_id=p.id AND l.right_key=p.right_id::text),0)::int AS balance,
      EXISTS(SELECT 1 FROM assignment_entitlement_period_events e WHERE e.period_id=p.id AND e.event_type='payment_validated') AS "paymentValidated",
      COALESCE((SELECT e.enabled FROM assignment_recurrence_events e WHERE e.assignment_id=p.assignment_id AND e.effective_on<=${localDate}::date ORDER BY e.effective_on DESC,e.created_at DESC,e.id DESC LIMIT 1),false) AS recurring
      FROM assignment_entitlement_periods p WHERE p.assignment_id=ANY(${rows.map(row=>row.id)}::uuid[])
      ORDER BY p.assignment_id,p.right_id,p.period_start`;
    const periodsByAssignment=new Map<string,PeriodRow[]>();
    for(const period of periodRows){const list=periodsByAssignment.get(period.assignmentId)??[];list.push(period);periodsByAssignment.set(period.assignmentId,list);}
    const localNoon=new Date(`${localDate}T12:00:00.000Z`);
    const assignments:EffectiveEntitlementAssignment[]=rows.map(row=>{
      const rights:Array<Record<string,unknown>>=(row.rights??[]).map((right:Record<string,unknown>)=>({...right,balance:(row.balances as Record<string,number>)?.[String(right.id)]??null}));
      const tracked=rights.filter(right=>right.rightType==='sessions_quota'&&right.weeklyFrequency!=null);
      if(!tracked.length)return{id:row.id,startsOn:row.startsOn,endsOn:row.endsOn,status:['cancelled','changed'].includes(row.lastEvent)?'cancelled':row.lastEvent==='paused'?'paused':row.startsOn>localDate?'scheduled':row.endsOn&&row.endsOn<localDate?'expired':'active',snapshot:row.snapshot,rights,modules:row.modules??[]};
      const periods=periodsByAssignment.get(row.id)??[];
      const states=tracked.map(right=>{
        const candidates=periods.filter(period=>period.rightId===right.id);
        const chosen=candidates.find(period=>period.startsOn<=localDate&&period.endsOn>=localDate)
          ??candidates.filter(period=>period.startsOn>localDate).sort((a,b)=>String(a.startsOn).localeCompare(String(b.startsOn)))[0]
          ??candidates.sort((a,b)=>String(b.startsOn).localeCompare(String(a.startsOn)))[0];
        if(!chosen)return{state:'blocked_unpaid' as const,period:null};
        return{state:derivePeriodAccess({startsOn:String(chosen.startsOn),endsOn:String(chosen.endsOn),now:localNoon,recurring:Boolean(chosen.recurring),paymentValidated:Boolean(chosen.paymentValidated)}),period:chosen};
      });
      const rank:Record<'active'|'provisional'|'ended'|'blocked_unpaid',number>={active:0,provisional:1,ended:2,blocked_unpaid:3};
      const operationalAccess=states.map(state=>state.state).sort((a,b)=>rank[b]-rank[a])[0]??'blocked_unpaid';
      const selectedPeriods=Object.fromEntries(states.filter(state=>state.period).map(state=>[String(state.period!.rightId),{id:state.period!.id,startsOn:state.period!.startsOn,endsOn:state.period!.endsOn,sessionsSnapshot:state.period!.sessionsSnapshot,balance:state.period!.balance}]));
      const enrichedRights=rights.map(right=>right.rightType==='sessions_quota'&&selectedPeriods[String(right.id)]?{...right,balance:(selectedPeriods[String(right.id)] as Record<string,unknown>).balance,period:selectedPeriods[String(right.id)]}:right);
      return{id:row.id,startsOn:row.startsOn,endsOn:row.endsOn,status:['cancelled','changed'].includes(row.lastEvent)?'cancelled':row.lastEvent==='paused'?'paused':row.startsOn>localDate?'scheduled':row.endsOn&&row.endsOn<localDate?'expired':'active',snapshot:row.snapshot,rights:enrichedRights,modules:row.modules??[],operationalAccess};
    });
    const effectiveResult=getEffectiveEntitlements(assignments,localDate);
    return {clientId:params.data.clientId,...effectiveResult,assignments:effectiveResult.assignments.map((assignment)=>{
      if(assignment.operationalAccess==='blocked_unpaid')return{...assignment,usable:false,blockingReasons:[...assignment.blockingReasons,'payment_pending']};
      if(assignment.operationalAccess==='ended')return{...assignment,usable:false,blockingReasons:[...assignment.blockingReasons,'entitlement_expired']};
      return assignment;
    })};
  });

  app.get('/api/clients/:clientId/plans/:assignmentId/movements',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    const context=await auth(request,reply,'entitlements.read'); if(!context)return;
    const parsed=paramsSchema.safeParse(request.params); if(!parsed.success)return reply.code(400).send({error:'invalid_assignment'});
    const exists=await db`SELECT id FROM client_plan_assignments WHERE id=${parsed.data.assignmentId} AND client_id=${parsed.data.clientId}`;
    if(!exists.length)return reply.code(404).send({error:'assignment_not_found'});
    const movements=await db`SELECT id,right_key AS "rightKey",entry_type AS "entryType",quantity,reason,external_reference AS "externalReference",actor_id AS "actorId",occurred_at AS "occurredAt" FROM client_entitlement_ledger WHERE assignment_id=${parsed.data.assignmentId} ORDER BY occurred_at DESC,id DESC LIMIT 200`;
    const events=await db`SELECT id,event_type AS "eventType",effective_on AS "effectiveOn",expected_resume_on AS "expectedResumeOn",reason,actor_id AS "actorId",actor_role AS "actorRole",created_at AS "createdAt" FROM client_plan_assignment_events WHERE assignment_id=${parsed.data.assignmentId} ORDER BY effective_on DESC,created_at DESC,id DESC LIMIT 100`;
    return {movements,events};
  });

  for (const action of ['pause','resume','cancel'] as const) app.post(`/api/clients/:clientId/plans/:assignmentId/${action}`,async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    const permission=action==='pause'||action==='resume'?'entitlements.pause':action==='cancel'?'entitlements.cancel':'entitlements.manage';
    const context=await auth(request,reply,permission);if(!context)return;
    const params=paramsSchema.safeParse(request.params);const key=uuid.safeParse(request.headers['idempotency-key']);const body=operationSchema.safeParse(request.body??{});
    if(!params.success)return reply.code(400).send({error:'invalid_assignment'});if(!key.success)return reply.code(400).send({error:'idempotency_key_required'});if(!body.success)return reply.code(400).send({error:'validation_error',details:body.error.flatten()});
    if((action==='pause'||action==='cancel')&&!body.data.reason)return reply.code(400).send({error:'reason_required'});
    if(body.data.expectedResumeOn&&body.data.effectiveOn&&body.data.expectedResumeOn<body.data.effectiveOn)return reply.code(400).send({error:'invalid_pause_range'});
    const effectiveOn=body.data.effectiveOn??todayInCanary();const requestHash=digest({action,...body.data,effectiveOn});
    try{
      const result=await db.begin(async tx=>{
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key.data},0))`;
        const [prior]=await tx`SELECT id,request_hash AS "requestHash" FROM client_plan_assignment_events WHERE idempotency_key=${key.data}`;
        if(prior)return prior.requestHash.trim()===requestHash?{replay:true}:{error:'idempotency_conflict'};
        const [assignment]=await tx`SELECT id,status,starts_on AS "startsOn",ends_on AS "endsOn" FROM client_plan_assignments WHERE id=${params.data.assignmentId} AND client_id=${params.data.clientId} FOR UPDATE`;
        if(!assignment)return {error:'assignment_not_found'};
        const [state]=await tx`SELECT event_type AS type FROM client_plan_assignment_events WHERE assignment_id=${assignment.id} AND effective_on<=${effectiveOn}::date ORDER BY effective_on DESC,created_at DESC,id DESC LIMIT 1`;
        const current=state?.type==='cancelled'?'cancelled':state?.type==='paused'?'paused':assignment.endsOn&&assignment.endsOn<effectiveOn?'expired':assignment.startsOn>effectiveOn?'scheduled':'active';
        if(action==='pause'&&current!=='active')return {error:'assignment_not_active'};
        if(action==='resume'&&current!=='paused')return {error:'assignment_not_paused'};
        if(action==='cancel'&&!['active','paused','scheduled'].includes(current))return {error:'assignment_not_cancellable'};
        const eventType=action==='pause'?'paused':action==='resume'?'resumed':'cancelled';
        const [event]=await tx`INSERT INTO client_plan_assignment_events(assignment_id,event_type,effective_on,expected_resume_on,reason,actor_id,actor_role,idempotency_key,request_hash) VALUES (${assignment.id},${eventType},${effectiveOn},${action==='pause'?(body.data.expectedResumeOn??null):null},${body.data.reason??null},${context.actorId},${context.role},${key.data},${requestHash}) RETURNING id`;
        await tx`INSERT INTO economic_audit_events(actor_id,action,resource_type,resource_id,client_id,details) VALUES (${context.actorId},${`client_plan.${eventType}`},'client_plan_assignment',${assignment.id},${params.data.clientId},${JSON.stringify({eventId:event!.id,effectiveOn,reason:body.data.reason??null})}::jsonb)`;
        await tx`INSERT INTO client_events(client_id,event_type,actor_id,actor_role) VALUES (${params.data.clientId},${`client.plan_${eventType}`},${context.actorId},${context.role})`;
        return {replay:false,eventId:event!.id,status:eventType};
      });
      if('error'in result)return reply.code(result.error==='assignment_not_found'?404:409).send({error:result.error});
      return reply.code(result.replay?200:201).send(result);
    }catch(error){app.log.error({route:`POST assignment ${action}`,databaseCode:dbCode(error)},'entitlement lifecycle failed');return reply.code(500).send({error:'internal_error'});}
  });

  app.post('/api/clients/:clientId/plans/:assignmentId/adjustments',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    const context=await auth(request,reply,'entitlements.adjust');if(!context)return;
    const params=paramsSchema.safeParse(request.params);const key=uuid.safeParse(request.headers['idempotency-key']);const body=z.object({rightId:uuid,quantity:z.number().int().min(-100000).max(100000).refine(v=>v!==0),reason:z.string().trim().min(3).max(240),externalReference:z.string().trim().max(160).nullable().optional()}).strict().safeParse(request.body);
    if(!params.success)return reply.code(400).send({error:'invalid_assignment'});if(!key.success)return reply.code(400).send({error:'idempotency_key_required'});if(!body.success)return reply.code(400).send({error:'validation_error',details:body.error.flatten()});
    const requestHash=digest({assignmentId:params.data.assignmentId,...body.data});
    try{
      const result=await db.begin(async tx=>{
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key.data},0))`;
        const [prior]=await tx`SELECT id,request_hash AS "requestHash" FROM client_entitlement_ledger WHERE idempotency_key=${key.data}`;
        if(prior)return prior.requestHash.trim()===requestHash?{replay:true,id:prior.id}:{error:'idempotency_conflict'};
        const [assignment]=await tx`SELECT id,client_id AS "clientId",plan_id AS "planId",plan_version AS "planVersion",status FROM client_plan_assignments WHERE id=${params.data.assignmentId} AND client_id=${params.data.clientId} FOR UPDATE`;
        if(!assignment)return {error:'assignment_not_found'};
        const [product]=await tx`SELECT kind FROM plan_versions WHERE plan_id=${assignment.planId} AND version=${assignment.planVersion}`;
        if(product?.kind!=='session_pack')return {error:'balance_adjustment_only_for_bonuses'};
        const [right]=await tx`SELECT id,quantity FROM plan_rights WHERE id=${body.data.rightId} AND plan_id=${assignment.planId} AND plan_version=${assignment.planVersion} AND right_type='sessions_quota'`;
        if(!right)return {error:'bonus_right_not_found'};
        const [balance]=await tx`SELECT COALESCE(sum(quantity),0)::int AS quantity FROM client_entitlement_ledger WHERE assignment_id=${assignment.id} AND right_key=${right.id}`;
        if(balance!.quantity+body.data.quantity<0)return {error:'balance_cannot_be_negative'};
        const [row]=await tx`INSERT INTO client_entitlement_ledger(client_id,assignment_id,right_key,entry_type,quantity,reason,external_reference,actor_id,idempotency_key,request_hash) VALUES (${assignment.clientId},${assignment.id},${right.id},'adjustment',${body.data.quantity},${body.data.reason},${body.data.externalReference??null},${context.actorId},${key.data},${requestHash}) RETURNING id`;
        await tx`INSERT INTO economic_audit_events(actor_id,action,resource_type,resource_id,client_id,details) VALUES (${context.actorId},'client_plan.balance_adjusted','client_entitlement_ledger',${row!.id},${assignment.clientId},${JSON.stringify({assignmentId:assignment.id,rightId:right.id,quantity:body.data.quantity,reason:body.data.reason})}::jsonb)`;
        return {replay:false,id:row!.id};
      });
      if('error'in result)return reply.code(result.error==='assignment_not_found'||result.error==='bonus_right_not_found'?404:409).send({error:result.error});
      return reply.code(result.replay?200:201).send(result);
    }catch(error){app.log.error({route:'POST entitlement adjustments',databaseCode:dbCode(error)},'entitlement adjustment failed');return reply.code(500).send({error:'internal_error'});}
  });
}

function dbCode(error:unknown){return typeof error==='object'&&error!==null&&'code'in error?String(error.code):'';}
