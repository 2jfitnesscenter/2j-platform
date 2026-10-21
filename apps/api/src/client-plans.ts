import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';

type DB = ReturnType<typeof createDatabase>['client'];
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value);
const methods = ['cash','card','transfer','direct_debit','other'] as const;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const code = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';

const assignmentInput = z.object({
  planId: uuid, startsOn: date, endsOn: date.nullable().optional(), dueOn: date, amountCents: z.number().int().min(1).max(100_000_000_000),
  adjustmentReason: z.string().trim().min(3).max(240).nullable().optional(),
  sourceAssignmentId:uuid.nullable().optional(),operationKind:z.enum(['renewal','change']).nullable().optional(),operationReason:z.string().trim().min(3).max(240).nullable().optional(),
  paymentAmountCents: z.number().int().min(1).max(100_000_000_000).nullable().optional(), paymentMethod: z.enum(methods).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.endsOn && value.endsOn < value.startsOn) context.addIssue({ code: 'custom', path: ['endsOn'], message: 'La fecha de fin debe ser igual o posterior al inicio.' });
  if (value.paymentAmountCents != null && value.paymentAmountCents > value.amountCents) context.addIssue({ code: 'custom', path: ['paymentAmountCents'], message: 'El cobro no puede superar el precio.' });
  if ((value.paymentAmountCents == null) !== (value.paymentMethod == null)) context.addIssue({ code: 'custom', path: ['paymentMethod'], message: 'Indica importe y método para cobrar ahora.' });
  if((value.sourceAssignmentId==null)!==(value.operationKind==null))context.addIssue({code:'custom',path:['operationKind'],message:'La renovación o cambio debe identificar la asignación de origen.'});
  if(value.operationKind==='change'&&value.operationReason!=null&&value.operationReason.length<3)context.addIssue({code:'custom',path:['operationReason'],message:'El motivo debe tener al menos 3 caracteres.'});
});

export function registerClientPlanRoutes(app: FastifyInstance<any,any,any,any,any>, db: DB, resolve: (request: FastifyRequest) => Promise<AuthorizationContext|null>) {
  async function auth(request: FastifyRequest, reply: any, permission: string) {
    const context = await resolve(request);
    if (!context) { reply.code(401).send({ error: 'authentication_required' }); return null; }
    if (!can(context, permission)) { reply.code(403).send({ error: 'permission_denied' }); return null; }
    return context;
  }

  app.get('/api/plans/assignable', async (request, reply) => {
    reply.header('Cache-Control','no-store');
    if (!await auth(request, reply, 'entitlements.read')) return;
    return db`SELECT p.id,p.name,p.current_version AS "currentVersion",v.kind,v.renewal_cadence AS "renewalCadence",v.period_days AS "periodDays",v.base_price_cents AS "basePriceCents",
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'area',a.name) ORDER BY lower(s.name),s.id),'[]'::jsonb) FROM plan_services ps JOIN services s ON s.id=ps.service_id JOIN areas a ON a.id=s.area_id WHERE ps.plan_id=p.id AND ps.plan_version=p.current_version) AS services,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('rightType',r.right_type,'serviceId',r.service_id,'serviceName',s.name,'quantity',r.quantity,'period',r.period,'quotaScope',r.quota_scope) ORDER BY r.right_type,r.service_id NULLS FIRST,r.id),'[]'::jsonb) FROM plan_rights r LEFT JOIN services s ON s.id=r.service_id WHERE r.plan_id=p.id AND r.plan_version=p.current_version) AS rights
      ,(SELECT COALESCE(jsonb_agg(jsonb_build_object('module',m.module,'accessLevel',m.access_level,'capabilities',COALESCE((SELECT jsonb_agg(c.capability ORDER BY c.capability) FROM plan_module_capabilities c WHERE c.plan_id=m.plan_id AND c.plan_version=m.plan_version AND c.module=m.module),'[]'::jsonb)) ORDER BY m.module),'[]'::jsonb) FROM plan_module_accesses m WHERE m.plan_id=p.id AND m.plan_version=p.current_version) AS modules
      FROM plans p JOIN plan_versions v ON v.plan_id=p.id AND v.version=p.current_version WHERE p.status='active' AND v.frozen_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM plan_rights r WHERE r.plan_id=p.id AND r.plan_version=p.current_version AND r.right_type='service_access' AND r.service_id IS NULL)
        AND NOT EXISTS (SELECT 1 FROM plan_services ps JOIN services s ON s.id=ps.service_id JOIN areas a ON a.id=s.area_id WHERE ps.plan_id=p.id AND ps.plan_version=p.current_version AND (s.status<>'active' OR a.status<>'active'))
      ORDER BY lower(p.name),p.id`;
  });

  app.get('/api/clients/:clientId/plans', async (request, reply) => {
    reply.header('Cache-Control','no-store');
    const context = await auth(request, reply, 'entitlements.read');
    if (!context) return;
    if (!can(context, 'clients.read')) return reply.code(403).send({ error: 'permission_denied' });
    const params = z.object({ clientId: uuid }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_client_id' });
    const [client] = await db`SELECT id FROM clients WHERE id=${params.data.clientId}`;
    if (!client) return reply.code(404).send({ error: 'client_not_found' });
    return db`SELECT x.id,x.plan_id AS "planId",x.plan_version AS "planVersion",p.name AS "planName",v.kind,x.starts_on AS "startsOn",x.ends_on AS "endsOn",x.status,x.snapshot,x.sale_price_cents AS "salePriceCents",
      CASE WHEN COALESCE((SELECT e.event_type FROM client_plan_assignment_events e WHERE e.assignment_id=x.id AND e.effective_on<=(now() AT TIME ZONE 'Atlantic/Canary')::date ORDER BY e.effective_on DESC,e.created_at DESC,e.id DESC LIMIT 1),'activated') IN ('cancelled','changed') THEN 'cancelled' WHEN COALESCE((SELECT e.event_type FROM client_plan_assignment_events e WHERE e.assignment_id=x.id AND e.effective_on<=(now() AT TIME ZONE 'Atlantic/Canary')::date ORDER BY e.effective_on DESC,e.created_at DESC,e.id DESC LIMIT 1),'activated')='paused' THEN 'paused' WHEN x.starts_on>(now() AT TIME ZONE 'Atlantic/Canary')::date THEN 'scheduled' WHEN x.ends_on<(now() AT TIME ZONE 'Atlantic/Canary')::date THEN 'expired' ELSE 'active' END AS "derivedStatus",
      x.charge_id AS "chargeId",c.concept,c.amount_cents AS "amountCents",c.due_on AS "dueOn",
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('rightType',r.right_type,'id',r.id,'serviceId',r.service_id,'serviceName',s.name,'quantity',r.quantity,'period',r.period,'quotaScope',r.quota_scope,'balance',(SELECT COALESCE(sum(l.quantity),0)::int FROM client_entitlement_ledger l WHERE l.assignment_id=x.id AND l.right_key=r.id::text)) ORDER BY r.right_type,r.service_id NULLS FIRST,r.id),'[]'::jsonb) FROM plan_rights r LEFT JOIN services s ON s.id=r.service_id WHERE r.plan_id=x.plan_id AND r.plan_version=x.plan_version) AS rights,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('module',m.module,'accessLevel',m.access_level,'capabilities',COALESCE((SELECT jsonb_agg(c.capability ORDER BY c.capability) FROM plan_module_capabilities c WHERE c.plan_id=m.plan_id AND c.plan_version=m.plan_version AND c.module=m.module),'[]'::jsonb)) ORDER BY m.module),'[]'::jsonb) FROM plan_module_accesses m WHERE m.plan_id=x.plan_id AND m.plan_version=x.plan_version) AS modules
      FROM client_plan_assignments x JOIN plans p ON p.id=x.plan_id JOIN plan_versions v ON v.plan_id=x.plan_id AND v.version=x.plan_version JOIN economic_charges c ON c.id=x.charge_id WHERE x.client_id=${params.data.clientId} ORDER BY x.starts_on DESC,x.created_at DESC,x.id DESC LIMIT 100`;
  });

  app.post('/api/clients/:clientId/plans', async (request, reply) => {
    reply.header('Cache-Control','no-store');
    const context = await auth(request, reply, 'entitlements.manage');
    if (!context) return;
    const params = z.object({ clientId: uuid }).safeParse(request.params);
    const key = uuid.safeParse(request.headers['idempotency-key']);
    const body = assignmentInput.safeParse(request.body);
    if (!params.success) return reply.code(400).send({ error: 'invalid_client_id' });
    if (!key.success) return reply.code(400).send({ error: 'idempotency_key_required' });
    if (!body.success) return reply.code(400).send({ error: 'validation_error', details: body.error.flatten() });
    if (!can(context, 'clients.read')) return reply.code(403).send({ error: 'permission_denied' });
    if (body.data.paymentAmountCents != null && !can(context, 'billing.payments.manage')) return reply.code(403).send({ error: 'permission_denied' });
    if(body.data.operationKind==='renewal'&&!can(context,'entitlements.renew'))return reply.code(403).send({error:'permission_denied'});
    if(body.data.operationKind==='change'&&!can(context,'entitlements.manage'))return reply.code(403).send({error:'permission_denied'});
    const data = body.data;
    const requestHash = hash({ clientId: params.data.clientId, ...data });
    const assignmentId = randomUUID();
    const chargeId = randomUUID();
    const chargeKey = randomUUID();
    const paymentId = data.paymentAmountCents ? randomUUID() : null;
    const paymentKey = randomUUID();
    try {
      const result = await db.begin(async tx => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key.data},0))`;
        const [prior] = await tx`SELECT id,request_hash AS "requestHash",charge_id AS "chargeId" FROM client_plan_assignments WHERE idempotency_key=${key.data}`;
        if (prior) return prior.requestHash.trim() === requestHash ? { id: prior.id, chargeId: prior.chargeId, paymentId: null, replay: true as const } : { error: 'idempotency_conflict' as const };
        const [client] = await tx`SELECT id,status FROM clients WHERE id=${params.data.clientId} FOR UPDATE`;
        if (!client || client.status !== 'active') return { error: 'client_unavailable' as const };
        let sourceAssignment:Record<string,any>|null=null;
        if(data.sourceAssignmentId&&data.operationKind){
          const [source]=await tx`SELECT id,plan_id AS "planId",starts_on AS "startsOn",ends_on AS "endsOn",status FROM client_plan_assignments WHERE id=${data.sourceAssignmentId} AND client_id=${client.id} FOR UPDATE`;
          if(!source)return {error:'source_assignment_not_found' as const};sourceAssignment=source;
          const [sourceEvent]=await tx`SELECT event_type AS type FROM client_plan_assignment_events WHERE assignment_id=${source.id} AND effective_on<=${data.startsOn}::date ORDER BY effective_on DESC,created_at DESC,id DESC LIMIT 1`;
          if(sourceEvent?.type==='cancelled'||sourceEvent?.type==='changed'||sourceEvent?.type==='renewed')return {error:'source_assignment_unavailable' as const};
          if(data.operationKind==='renewal'&&(!source.endsOn||data.startsOn<=String(source.endsOn)))return {error:'renewal_must_follow_current_term' as const};
          if(data.operationKind==='change'&&data.startsOn<=String(source.startsOn))return {error:'change_must_be_effective_after_start' as const};
        }
        const [plan] = await tx`SELECT p.id,p.name,p.status,p.current_version AS "currentVersion",v.kind,v.base_price_cents AS "basePriceCents",v.renewal_cadence AS "renewalCadence",v.period_days AS "periodDays",v.timezone FROM plans p JOIN plan_versions v ON v.plan_id=p.id AND v.version=p.current_version WHERE p.id=${data.planId} AND p.status='active' AND v.frozen_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM plan_rights r WHERE r.plan_id=p.id AND r.plan_version=p.current_version AND r.right_type='service_access' AND r.service_id IS NULL)
          AND NOT EXISTS (SELECT 1 FROM plan_services ps JOIN services s ON s.id=ps.service_id JOIN areas a ON a.id=s.area_id WHERE ps.plan_id=p.id AND ps.plan_version=p.current_version AND (s.status<>'active' OR a.status<>'active')) FOR SHARE OF p,v`;
        if (!plan) return { error: 'plan_unavailable' as const };
        const [cash] = data.paymentMethod === 'cash' ? await tx`SELECT id FROM economic_cash_sessions WHERE status='open' ORDER BY opened_at LIMIT 1 FOR UPDATE` : [];
        if (data.paymentMethod === 'cash' && !cash) return { error: 'cash_session_required' as const };
        const concept = `${plan.name} · Cuota`;
        const [commercial]=await tx`SELECT
          COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'area',a.name) ORDER BY s.id) FROM plan_services ps JOIN services s ON s.id=ps.service_id JOIN areas a ON a.id=s.area_id WHERE ps.plan_id=${plan.id} AND ps.plan_version=${plan.currentVersion}),'[]'::jsonb) AS services,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'rightType',r.right_type,'serviceId',r.service_id,'quotaScope',r.quota_scope,'quantity',r.quantity,'weeklyFrequency',r.weekly_frequency,'period',r.period,'periodMode',r.period_mode,'timezone',r.timezone,'validDays',r.valid_days,'validDaysStartRule',r.valid_days_start_rule) ORDER BY r.id) FROM plan_rights r WHERE r.plan_id=${plan.id} AND r.plan_version=${plan.currentVersion}),'[]'::jsonb) AS rights,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('module',m.module,'accessLevel',m.access_level,'capabilities',COALESCE((SELECT jsonb_agg(c.capability ORDER BY c.capability) FROM plan_module_capabilities c WHERE c.plan_id=m.plan_id AND c.plan_version=m.plan_version AND c.module=m.module),'[]'::jsonb)) ORDER BY m.module) FROM plan_module_accesses m WHERE m.plan_id=${plan.id} AND m.plan_version=${plan.currentVersion}),'[]'::jsonb) AS modules`;
        const listPrice=plan.basePriceCents==null?null:Number(plan.basePriceCents);
        if(listPrice===null&&!can(context,'catalog.pricing.manage'))return {error:'catalog_price_required' as const};
        if(listPrice!==null&&listPrice!==data.amountCents&&!can(context,'catalog.pricing.manage'))return {error:'price_override_forbidden' as const};
        if(listPrice!==null&&listPrice!==data.amountCents&&!data.adjustmentReason)return {error:'adjustment_reason_required' as const};
        const snapshot={planId:plan.id,planVersion:plan.currentVersion,name:plan.name,kind:plan.kind,listPriceCents:listPrice,salePriceCents:data.amountCents,priceAdjustmentCents:listPrice===null?0:data.amountCents-listPrice,priceAdjustmentReason:data.adjustmentReason??null,currency:'EUR',soldBy:context.actorId,services:commercial!.services,rights:commercial!.rights,modules:commercial!.modules,startsOn:data.startsOn,endsOn:data.endsOn??null,terms:{renewalCadence:plan.renewalCadence,periodDays:plan.periodDays,timezone:plan.timezone}};
        await tx`INSERT INTO economic_charges(id,client_id,plan_id,concept,amount_cents,due_on,state,created_by,idempotency_key,request_hash) VALUES (${chargeId},${client.id},${plan.id},${concept},${data.amountCents},${data.dueOn},'pending',${context.actorId},${chargeKey},${requestHash})`;
        await tx`INSERT INTO client_plan_assignments(id,client_id,plan_id,plan_version,charge_id,starts_on,ends_on,idempotency_key,request_hash,created_by,sale_price_cents,snapshot) VALUES (${assignmentId},${client.id},${plan.id},${plan.currentVersion},${chargeId},${data.startsOn},${data.endsOn ?? null},${key.data},${requestHash},${context.actorId},${data.amountCents},${JSON.stringify(snapshot)}::jsonb)`;
        await tx`INSERT INTO client_plan_assignment_events(assignment_id,event_type,effective_on,actor_id,actor_role,idempotency_key,request_hash) VALUES (${assignmentId},'activated',${data.startsOn},${context.actorId},${context.role},${randomUUID()},${requestHash})`;
        if(sourceAssignment&&data.operationKind){
          const sourceEventType=data.operationKind==='renewal'?'renewed':'changed';
          await tx`INSERT INTO client_plan_assignment_events(assignment_id,event_type,effective_on,reason,actor_id,actor_role,idempotency_key,request_hash) VALUES (${sourceAssignment.id},${sourceEventType},${data.startsOn},${data.operationReason??null},${context.actorId},${context.role},${key.data},${requestHash})`;
          await tx`INSERT INTO economic_audit_events(actor_id,action,resource_type,resource_id,client_id,details) VALUES (${context.actorId},${`client_plan.${sourceEventType}`},'client_plan_assignment',${sourceAssignment.id},${client.id},${JSON.stringify({replacementAssignmentId:assignmentId,newPlanId:plan.id,effectiveOn:data.startsOn,reason:data.operationReason??null})}::jsonb)`;
          await tx`INSERT INTO client_events(client_id,event_type,actor_id,actor_role) VALUES (${client.id},${`client.plan_${sourceEventType}`},${context.actorId},${context.role})`;
        }
        if(plan.kind==='session_pack')for(const right of commercial!.rights as Array<{id:string;rightType:string;quantity:number|null}>){if(right.rightType==='sessions_quota'&&right.quantity)await tx`INSERT INTO client_entitlement_ledger(client_id,assignment_id,right_key,entry_type,quantity,reason,actor_id,idempotency_key,request_hash) VALUES (${client.id},${assignmentId},${right.id},'grant',${right.quantity},'Saldo inicial del bono',${context.actorId},${randomUUID()},${requestHash})`;}
        await tx`INSERT INTO client_events(client_id,event_type,actor_id,actor_role) VALUES (${client.id},'client.plan_assigned',${context.actorId},${context.role})`;
        await tx`INSERT INTO economic_audit_events(actor_id,action,resource_type,resource_id,client_id,details) VALUES (${context.actorId},'client_plan.assigned','client_plan_assignment',${assignmentId},${client.id},${JSON.stringify({ planId: plan.id, planVersion: plan.currentVersion, chargeId, amountCents: data.amountCents })}::jsonb)`;
        await tx`INSERT INTO economic_audit_events(actor_id,action,resource_type,resource_id,client_id,details) VALUES (${context.actorId},'charge.created','charge',${chargeId},${client.id},${JSON.stringify({ amountCents: data.amountCents, planId: plan.id, assignmentId })}::jsonb)`;
        if (data.paymentAmountCents && data.paymentMethod && paymentId) {
          await tx`INSERT INTO economic_transactions(id,charge_id,client_id,kind,amount_cents,actor_id,idempotency_key,request_hash,cash_session_id) VALUES (${paymentId},${chargeId},${client.id},'payment',${data.paymentAmountCents},${context.actorId},${paymentKey},${requestHash},${data.paymentMethod === 'cash' ? cash!.id : null})`;
          await tx`INSERT INTO economic_payment_splits(transaction_id,method,amount_cents) VALUES (${paymentId},${data.paymentMethod},${data.paymentAmountCents})`;
          await tx`INSERT INTO economic_audit_events(actor_id,action,resource_type,resource_id,client_id,details) VALUES (${context.actorId},'payment.recorded','transaction',${paymentId},${client.id},${JSON.stringify({ amountCents: data.paymentAmountCents, method: data.paymentMethod, assignmentId })}::jsonb)`;
        }
        return { id: assignmentId, chargeId, paymentId, replay: false as const };
      });
      if ('error' in result) return reply.code(result.error==='price_override_forbidden'?403:409).send({ error: result.error });
      return reply.code(result.replay ? 200 : 201).send(result);
    } catch (error) {
      const dbCode = code(error);
      app.log.error({ databaseCode: dbCode, route: 'POST /api/clients/:clientId/plans' }, 'client plan assignment failed');
      if (['23503','23514','23505','55000'].includes(dbCode)) return reply.code(409).send({ error: 'plan_assignment_conflict' });
      return reply.code(500).send({ error: 'internal_error' });
    }
  });
}
