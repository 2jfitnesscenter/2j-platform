import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';
import { activateSettledEntitlementPeriods } from './assignment-periods.js';
import { appendNotificationEvent } from './notifications.js';
import { cashDenominationsSchema, cashDenominationsToCents, legacyCashSessionMessage, lockOpenCashSession, previousDayCashSessionMessage } from './cash-session.js';

type DB = ReturnType<typeof createDatabase>['client'];
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const taxId = z.string().trim().transform(value => value.toUpperCase().replace(/[\s-]/g, '')).nullable().optional().refine(value => !value || /^(?:\d{8}[A-Z]|[XYZ]\d{7}[A-Z]|[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J])$/.test(value), 'Formato de NIF/NIE/CIF no válido. La validación de formato no verifica la identidad.');

export function registerEconomicExtensions(app: FastifyInstance<any, any, any, any, any>, db: DB, resolve: (request: FastifyRequest) => Promise<AuthorizationContext | null>) {
  async function auth(request: FastifyRequest, reply: any, permission: string) {
    const context = await resolve(request);
    if (!context) { reply.code(401).send({ error: 'authentication_required' }); return null; }
    if (!can(context, permission)) { reply.code(403).send({ error: 'permission_denied' }); return null; }
    return context;
  }
  async function audit(tx: any, context: AuthorizationContext, action: string, type: string, id: string, clientId: string | null, details: Record<string, unknown> = {}) {
    await tx`INSERT INTO economic_audit_events(actor_id,action,resource_type,resource_id,client_id,details) VALUES (${context.actorId},${action},${type},${id},${clientId},${JSON.stringify(details)}::jsonb)`;
  }
  async function cashSnapshot(tx: any, sessionId: string) {
    const [row] = await tx`SELECT s.id,s.register_id AS "registerId",r.code AS "registerCode",r.name AS "registerName",s.local_date AS "localDate",COALESCE(reopen.details->>'openingCents',s.opening_cents::text)::bigint AS "openingCents",COALESCE(reopen.details->'openingDenominations',s.opening_denominations) AS "openingDenominations",s.status,s.opened_at AS "openedAt",s.opened_by AS "openedBy",s.closed_at AS "closedAt",s.closed_by AS "closedBy",s.expected_cents AS "frozenExpectedCents",s.counted_cents AS "countedCents",s.counted_denominations AS "countedDenominations",s.difference_cents AS "differenceCents",
      COALESCE(sum(ps.amount_cents) FILTER(WHERE et.kind='payment' AND ps.method='cash'),0)::bigint AS "cashPaymentsCents",
      COALESCE(sum(ps.amount_cents) FILTER(WHERE et.kind='refund' AND ps.method='cash'),0)::bigint AS "cashRefundsCents",
      COALESCE((SELECT sum(sale.total_cents) FROM store_sales sale WHERE sale.cash_session_id=s.id AND sale.payment_state='paid' AND sale.payment_method='cash' AND (reopen.occurred_at IS NULL OR sale.created_at>=reopen.occurred_at)),0)::bigint AS "cashStoreSalesCents",
      COALESCE((SELECT sum(m.amount_cents) FROM store_sale_cash_movements m WHERE m.cash_session_id=s.id AND m.payment_method='cash' AND (reopen.occurred_at IS NULL OR m.occurred_at>=reopen.occurred_at)),0)::bigint AS "cashStoreRefundsCents",
      COALESCE((SELECT sum(m.amount_cents) FROM store_sale_cash_movements m WHERE m.cash_session_id=s.id AND (reopen.occurred_at IS NULL OR m.occurred_at>=reopen.occurred_at)),0)::bigint AS "storeSaleAnnulmentsCents",
      COALESCE((SELECT sum(a.amount_cents) FROM economic_cash_adjustments a WHERE a.cash_session_id=s.id AND (reopen.occurred_at IS NULL OR a.created_at>=reopen.occurred_at)),0)::bigint AS "adjustmentsCents",
      COALESCE((SELECT sum(o.amount_cents) FROM economic_cash_outflows o WHERE o.cash_session_id=s.id AND o.status='approved' AND (reopen.occurred_at IS NULL OR o.created_at>=reopen.occurred_at)),0)::bigint AS "outflowsCents"
      FROM economic_cash_sessions s LEFT JOIN economic_cash_registers r ON r.id=s.register_id
      LEFT JOIN LATERAL(SELECT e.occurred_at,e.details FROM economic_audit_events e WHERE e.resource_type='cash_session' AND e.resource_id=s.id AND e.action='cash.reopened' ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1) reopen ON true
      LEFT JOIN economic_transactions et ON et.cash_session_id=s.id AND (reopen.occurred_at IS NULL OR et.created_at>=reopen.occurred_at)
      LEFT JOIN economic_payment_splits ps ON ps.transaction_id=et.id WHERE s.id=${sessionId}
      GROUP BY s.id,r.code,r.name,reopen.occurred_at,reopen.details`;
    if (!row) return null;
    const expectedCents = row.frozenExpectedCents == null
      ? Number(row.openingCents) + Number(row.cashPaymentsCents) + Number(row.cashStoreSalesCents) - Number(row.cashRefundsCents) - Number(row.cashStoreRefundsCents) + Number(row.adjustmentsCents) - Number(row.outflowsCents)
      : Number(row.frozenExpectedCents);
    return { ...row, expectedCents, liveExpectedCents: expectedCents, differenceCents: row.differenceCents == null ? null : Number(row.differenceCents) };
  }
  async function openCashForToday(tx: any, actorId: string) {
    return lockOpenCashSession(tx, actorId);
  }
  function blindCashSnapshot(snapshot: any) {
    const { openingCents: _opening, openingDenominations: _openingDenominations, expectedCents: _expected, liveExpectedCents: _liveExpected,
      cashPaymentsCents: _payments, cashRefundsCents: _refunds, cashStoreSalesCents: _storeSales, cashStoreRefundsCents: _storeRefunds,
      storeSaleAnnulmentsCents: _annulments, adjustmentsCents: _adjustments, outflowsCents: _outflows, differenceCents: _difference, ...visible } = snapshot;
    return visible;
  }
  async function closeCash(request: FastifyRequest, reply: any, sessionId: string, countedDenominations: z.infer<typeof cashDenominationsSchema>, context: AuthorizationContext) {
    const countedCents = cashDenominationsToCents(countedDenominations);
    try {
      const result = await db.begin(async tx => {
        await tx`SELECT pg_advisory_xact_lock(hashtext('2j-economic-register-operations'))`;
        const [session] = await tx`SELECT id,register_id AS "registerId",local_date,status,local_date=(now() AT TIME ZONE 'Atlantic/Canary')::date AS "isToday" FROM economic_cash_sessions WHERE id=${sessionId} FOR UPDATE`;
        if (!session) return { error: 'cash_session_not_found' as const };
        if (session.status !== 'open') return { error: 'cash_already_closed' as const };
        if (!session.isToday) return { error: 'cash_session_previous_day_requires_owner_resolution' as const };
        const [custody] = await tx`SELECT id,professional_id AS "professionalId" FROM economic_cash_custodies WHERE cash_session_id=${session.id} AND actor_id=${context.actorId} AND ended_at IS NULL FOR UPDATE`;
        if (!custody) return { error: 'cash_custodian_required' as const };
        const [clock] = await tx`SELECT e.event_type AS "eventType" FROM staff_timeclock_events e LEFT JOIN LATERAL(SELECT corrected_occurred_at FROM staff_timeclock_corrections c WHERE c.event_id=e.id ORDER BY c.revision DESC LIMIT 1)c ON true WHERE e.professional_id=${custody.professionalId} ORDER BY COALESCE(c.corrected_occurred_at,e.occurred_at) DESC,e.id DESC LIMIT 1`;
        if (clock?.eventType !== 'clock_in') return { error: 'cash_custodian_not_clocked_in' as const };
        const [pendingOutflow] = await tx`SELECT id FROM economic_cash_outflows WHERE cash_session_id=${session.id} AND status='pending_owner_approval' LIMIT 1`;
        if (pendingOutflow) return { error: 'cash_outflow_approval_pending' as const };
        const snapshot = await cashSnapshot(tx, session.id);
        if (!snapshot) return { error: 'cash_session_not_found' as const };
        const difference = countedCents - snapshot.expectedCents;
        const [closed] = await tx`UPDATE economic_cash_sessions SET status=CASE WHEN local_date<(now() AT TIME ZONE 'Atlantic/Canary')::date THEN 'late_close' ELSE 'closed' END,close_kind=CASE WHEN local_date<(now() AT TIME ZONE 'Atlantic/Canary')::date THEN 'late_close' ELSE 'closed' END,expected_cents=${snapshot.expectedCents},counted_cents=${countedCents},counted_denominations=${JSON.stringify(countedDenominations)}::jsonb,difference_cents=${difference},closed_by=${context.actorId},closed_at=now() WHERE id=${session.id} AND status='open' RETURNING id,status,local_date AS "localDate",opened_at AS "openedAt",closed_at AS "closedAt",closed_by AS "closedBy",opening_cents AS "openingCents",expected_cents AS "expectedCents",counted_cents AS "countedCents",counted_denominations AS "countedDenominations",difference_cents AS "differenceCents"`;
        if (!closed) return { error: 'cash_already_closed' as const };
        await tx`UPDATE economic_cash_custodies SET ended_at=now(),ended_reason='closed',ended_by=${context.actorId} WHERE id=${custody.id} AND ended_at IS NULL`;
        await audit(tx, context, 'cash.closed', 'cash_session', session.id, null, { registerId: session.registerId, localDate: String(session.local_date), lateClose: closed.status === 'late_close', openingCents: snapshot.openingCents, openingDenominations: snapshot.openingDenominations, cashPaymentsCents: snapshot.cashPaymentsCents, cashRefundsCents: snapshot.cashRefundsCents, adjustmentsCents: snapshot.adjustmentsCents, outflowsCents: snapshot.outflowsCents, expectedCents: snapshot.expectedCents, countedCents, countedDenominations, differenceCents: difference });
        return { closed, snapshot };
      });
      if ('error' in result) return reply.code(result.error === 'cash_session_not_found' ? 404 : 409).send({ error: result.error, ...(result.error==='cash_session_previous_day_requires_owner_resolution'?{message:previousDayCashSessionMessage}:{}) });
      const response = { ...result.closed, registerId: result.snapshot.registerId, registerCode: result.snapshot.registerCode, registerName: result.snapshot.registerName, openingDenominations: result.snapshot.openingDenominations, cashPaymentsCents: result.snapshot.cashPaymentsCents, cashRefundsCents: result.snapshot.cashRefundsCents, cashStoreSalesCents: result.snapshot.cashStoreSalesCents, cashStoreRefundsCents: result.snapshot.cashStoreRefundsCents, storeSaleAnnulmentsCents: result.snapshot.storeSaleAnnulmentsCents, adjustmentsCents: result.snapshot.adjustmentsCents, outflowsCents: result.snapshot.outflowsCents };
      return can(context, 'owner.panel.read') ? response : blindCashSnapshot(response);
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      app.log.error({ databaseCode: code, route: 'POST /api/economics/cash/close' }, 'cash close failed');
      return reply.code(code === '55000' ? 409 : 500).send({ error: code === '55000' ? 'cash_transition_invalid' : 'cash_close_failed' });
    }
  }

  app.get('/api/economics/cash/registers', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await auth(request, reply, 'billing.cash.manage'); if (!context) return;
    const items = await db`SELECT r.id,r.code,r.name,r.active,s.id AS "openSessionId",
        EXISTS(SELECT 1 FROM economic_cash_custodies own WHERE own.cash_session_id=s.id AND own.actor_id=${context.actorId} AND own.ended_at IS NULL) AS "ownCustody"
      FROM economic_cash_registers r LEFT JOIN economic_cash_sessions s ON s.register_id=r.id AND s.status='open'
      WHERE r.active ORDER BY r.code`;
    return { items: items.map(item => ({ id: item.id, code: item.code, name: item.name, active: item.active, available: !item.openSessionId, ownCustody: item.ownCustody, sessionId: item.ownCustody ? item.openSessionId : null })), timezone: 'Atlantic/Canary' };
  });
  app.get('/api/economics/cash/today', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await auth(request, reply, 'billing.cash.manage'); if (!context) return;
    if (can(context, 'owner.panel.read')) {
      const sessions = await db`SELECT id FROM economic_cash_sessions WHERE status='open' OR local_date=(now() AT TIME ZONE 'Atlantic/Canary')::date ORDER BY opened_at`;
      const items = await Promise.all(sessions.map(async session => cashSnapshot(db, session.id)));
      const visible = items.filter(Boolean);
      return { items: visible, session: visible.at(-1) ?? null, timezone: 'Atlantic/Canary' };
    }
    const [session] = await db`SELECT s.id,s.register_id AS "registerId",r.code AS "registerCode",r.name AS "registerName",s.local_date AS "localDate",s.status,s.opened_at AS "openedAt",s.closed_at AS "closedAt",c.started_at AS "custodyStartedAt",c.ended_at AS "custodyEndedAt"
      FROM economic_cash_custodies c JOIN economic_cash_sessions s ON s.id=c.cash_session_id JOIN economic_cash_registers r ON r.id=s.register_id
      WHERE c.actor_id=${context.actorId} AND c.ended_at IS NULL AND s.status='open' AND s.local_date=(now() AT TIME ZONE 'Atlantic/Canary')::date ORDER BY c.started_at DESC LIMIT 1`;
    const [lastHeld] = session ? [session] : await db`SELECT s.id,s.register_id AS "registerId",r.code AS "registerCode",r.name AS "registerName",s.local_date AS "localDate",s.status,s.opened_at AS "openedAt",s.closed_at AS "closedAt",c.started_at AS "custodyStartedAt",c.ended_at AS "custodyEndedAt"
      FROM economic_cash_custodies c JOIN economic_cash_sessions s ON s.id=c.cash_session_id JOIN economic_cash_registers r ON r.id=s.register_id
      WHERE c.actor_id=${context.actorId} AND s.local_date=(now() AT TIME ZONE 'Atlantic/Canary')::date ORDER BY c.started_at DESC LIMIT 1`;
    if(!lastHeld)return {items:[],session:null,timezone:'Atlantic/Canary'};
    const [transactions,sales,annulments,outflows]=await Promise.all([
      db`SELECT t.id,t.kind,s.method,s.amount_cents AS "amountCents",t.created_at AS "occurredAt" FROM economic_transactions t JOIN economic_payment_splits s ON s.transaction_id=t.id WHERE t.cash_session_id=${lastHeld.id} AND t.actor_id=${context.actorId} AND t.created_at>=${lastHeld.custodyStartedAt} AND t.created_at<COALESCE(${lastHeld.custodyEndedAt},'infinity'::timestamptz) ORDER BY t.created_at,t.id,s.method`,
      db`SELECT id,'store_sale'::text AS kind,payment_method AS method,total_cents AS "amountCents",created_at AS "occurredAt" FROM store_sales WHERE cash_session_id=${lastHeld.id} AND created_by=${context.actorId} AND created_at>=${lastHeld.custodyStartedAt} AND created_at<COALESCE(${lastHeld.custodyEndedAt},'infinity'::timestamptz) ORDER BY created_at,id`,
      db`SELECT id,movement_type AS kind,payment_method AS method,amount_cents AS "amountCents",occurred_at AS "occurredAt" FROM store_sale_cash_movements WHERE cash_session_id=${lastHeld.id} AND actor_id=${context.actorId} AND occurred_at>=${lastHeld.custodyStartedAt} AND occurred_at<COALESCE(${lastHeld.custodyEndedAt},'infinity'::timestamptz) ORDER BY occurred_at,id`,
      db`SELECT id,movement_type AS kind,amount_cents AS "amountCents",reason,status,receipt_bytes IS NOT NULL AS "hasReceipt",created_at AS "occurredAt" FROM economic_cash_outflows WHERE cash_session_id=${lastHeld.id} AND actor_id=${context.actorId} AND created_at>=${lastHeld.custodyStartedAt} AND created_at<COALESCE(${lastHeld.custodyEndedAt},'infinity'::timestamptz) ORDER BY created_at,id`,
    ]);
    const movements=[...transactions,...sales,...annulments,...outflows].sort((a:any,b:any)=>new Date(a.occurredAt).getTime()-new Date(b.occurredAt).getTime()||String(a.id).localeCompare(String(b.id)));
    const visibleSession=session?{...session,movements}:{...blindCashSnapshot(await cashSnapshot(db,lastHeld.id)),...lastHeld,movements};
    return { items: session?[visibleSession]:[], session:visibleSession, timezone: 'Atlantic/Canary' };
  });
  app.get('/api/economics/cash/day',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    const context=await auth(request,reply,'owner.panel.read');if(!context)return;
    try{
      const sessions=await db`SELECT id FROM economic_cash_sessions WHERE status='open' OR local_date=(now() AT TIME ZONE 'Atlantic/Canary')::date ORDER BY register_id NULLS LAST,opened_at`;
      const registers=[] as any[];
      for(const session of sessions){
        const snapshot=await cashSnapshot(db,session.id);if(!snapshot)continue;
        const [custody]=await db`SELECT c.actor_id AS "actorId",p.display_name AS "professionalName",c.started_at AS "startedAt" FROM economic_cash_custodies c JOIN staff_professionals p ON p.id=c.professional_id WHERE c.cash_session_id=${session.id} AND c.ended_at IS NULL`;
        const transactions=await db`SELECT t.id,t.kind,t.amount_cents AS "amountCents",s.method,t.actor_id AS "actorId",t.created_at AS "occurredAt",c.concept
          FROM economic_transactions t JOIN economic_payment_splits s ON s.transaction_id=t.id JOIN economic_charges c ON c.id=t.charge_id
          WHERE t.cash_session_id=${session.id} ORDER BY t.created_at,t.id,s.method`;
        const sales=await db`SELECT id,'store_sale'::text AS kind,total_cents AS "amountCents",payment_method AS method,created_by AS "actorId",created_at AS "occurredAt",status FROM store_sales WHERE cash_session_id=${session.id} ORDER BY created_at,id`;
        const annulments=await db`SELECT id,sale_id AS "saleId",movement_type AS kind,amount_cents AS "amountCents",payment_method AS method,actor_id AS "actorId",occurred_at AS "occurredAt",reason FROM store_sale_cash_movements WHERE cash_session_id=${session.id} ORDER BY occurred_at,id`;
        const adjustments=await db`SELECT id,'adjustment'::text AS kind,amount_cents AS "amountCents",actor_id AS "actorId",created_at AS "occurredAt",reason FROM economic_cash_adjustments WHERE cash_session_id=${session.id} ORDER BY created_at,id`;
        const outflows=await db`SELECT id,movement_type AS kind,amount_cents AS "amountCents",reason,actor_id AS "actorId",status,receipt_bytes IS NOT NULL AS "hasReceipt",created_at AS "occurredAt" FROM economic_cash_outflows WHERE cash_session_id=${session.id} ORDER BY created_at,id`;
        const handovers=await db`SELECT h.id,h.outgoing_actor_id AS "outgoingActorId",h.incoming_actor_id AS "incomingActorId",h.outgoing_denominations AS "outgoingDenominations",h.incoming_denominations AS "incomingDenominations",h.completed_at AS "completedAt",h.mismatch,h.created_at AS "createdAt" FROM economic_cash_handovers h WHERE h.cash_session_id=${session.id} ORDER BY h.created_at,h.id`;
        registers.push({registerId:snapshot.registerId,registerCode:snapshot.registerCode,registerName:snapshot.registerName??'Histórica sin registro',localDate:snapshot.localDate,status:snapshot.status,custody:custody??null,openingCents:snapshot.openingCents,openingDenominations:snapshot.openingDenominations,expectedCents:snapshot.expectedCents,countedCents:snapshot.countedCents,countedDenominations:snapshot.countedDenominations,differenceCents:snapshot.differenceCents,balanced:snapshot.status==='open'?null:Number(snapshot.differenceCents??0)===0,movements:[...transactions,...sales,...annulments,...adjustments,...outflows].sort((a:any,b:any)=>new Date(a.occurredAt).getTime()-new Date(b.occurredAt).getTime()||String(a.id).localeCompare(String(b.id))),handovers});
      }
      const closed=registers.length>0&&registers.every(row=>row.status!=='open');
      const [businessDate]=await db`SELECT (now() AT TIME ZONE 'Atlantic/Canary')::date::text AS date`;
      return {timezone:'Atlantic/Canary',date:businessDate?.date??null,registers,total:{expectedCents:registers.reduce((sum,row)=>sum+Number(row.expectedCents??0),0),countedCents:closed?registers.reduce((sum,row)=>sum+Number(row.countedCents??0),0):null,differenceCents:closed?registers.reduce((sum,row)=>sum+Number(row.differenceCents??0),0):null,balanced:closed?registers.every(row=>row.balanced):null}};
    }catch{return reply.code(500).send({error:'cash_day_read_failed'});}
  });
  app.get('/api/economics/cash/sessions',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    const context=await auth(request,reply,'billing.cash.manage');if(!context)return;
    const isDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>!Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
    const parsed=z.object({from:isDate.optional(),to:isDate.optional(),registerCode:z.enum(['bunker','sala']).optional()}).strict().safeParse(request.query);
    if(!parsed.success)return reply.code(400).send({error:'validation_error'});
    const [todayRow]=await db`SELECT (now() AT TIME ZONE 'Atlantic/Canary')::date::text AS today`;const today=String(todayRow?.today);
    const to=parsed.data.to??today;
    const [fromRow]=await db`SELECT (${to}::date-13)::text AS "defaultFrom"`;
    const from=parsed.data.from??String(fromRow?.defaultFrom);
    const [spanRow]=await db`SELECT (${to}::date-${from}::date) AS span`;
    const span=Number(spanRow?.span);if(span<0||span>62)return reply.code(400).send({error:'validation_error',message:'El rango admite como máximo 63 días.'});
    const ownerView=can(context,'owner.panel.read');
    const registerFilter=parsed.data.registerCode??null;
    const rows=await db`SELECT s.id,r.code AS "registerCode",r.name AS "registerName",s.local_date::text AS "localDate",s.status,s.opened_at AS "openedAt",s.closed_at AS "closedAt",
        opener.display_name AS "openedByName",closer.display_name AS "closedByName"
      FROM economic_cash_sessions s LEFT JOIN economic_cash_registers r ON r.id=s.register_id
      LEFT JOIN staff_professionals opener ON opener.auth_actor_id=s.opened_by LEFT JOIN staff_professionals closer ON closer.auth_actor_id=s.closed_by
      WHERE s.local_date BETWEEN ${from}::date AND ${to}::date
        AND (${registerFilter}::text IS NULL OR r.code=${registerFilter})
        AND (${ownerView}::boolean OR EXISTS(SELECT 1 FROM economic_cash_custodies c WHERE c.cash_session_id=s.id AND c.actor_id=${context.actorId}))
      ORDER BY s.local_date DESC,r.code NULLS LAST,s.opened_at DESC LIMIT 200`;
    const items=[] as any[];
    for(const row of rows){
      const base={id:row.id,registerCode:row.registerCode,registerName:row.registerName??'Histórica sin registro',localDate:row.localDate,status:row.status,openedAt:row.openedAt,closedAt:row.closedAt,openedByName:row.openedByName??null,closedByName:row.closedByName??null};
      if(!ownerView){items.push(base);continue;}
      const snapshot=await cashSnapshot(db,row.id);
      const closed=row.status!=='open';
      items.push({...base,openingCents:Number(snapshot?.openingCents??0),expectedCents:Number(snapshot?.expectedCents??0),countedCents:closed?Number(snapshot?.countedCents??0):null,differenceCents:closed?Number(snapshot?.differenceCents??0):null,balanced:closed?Number(snapshot?.differenceCents??0)===0:null});
    }
    const dayMap=new Map<string,any>();
    for(const item of items){
      const day=dayMap.get(item.localDate)??{date:item.localDate,sessions:0,openCount:0,expectedCents:0,countedCents:0,differenceCents:0};
      day.sessions+=1;if(item.status==='open')day.openCount+=1;
      if(ownerView){day.expectedCents+=item.expectedCents;day.countedCents+=item.countedCents??0;day.differenceCents+=item.differenceCents??0;}
      dayMap.set(item.localDate,day);
    }
    const days=[...dayMap.values()].map(day=>ownerView
      ?{date:day.date,sessions:day.sessions,openCount:day.openCount,closed:day.openCount===0,expectedCents:day.expectedCents,countedCents:day.openCount===0?day.countedCents:null,differenceCents:day.openCount===0?day.differenceCents:null,balanced:day.openCount===0?day.differenceCents===0:null}
      :{date:day.date,sessions:day.sessions,openCount:day.openCount,closed:day.openCount===0});
    return {timezone:'Atlantic/Canary',from,to,registerCode:registerFilter,items,days,truncated:rows.length===200};
  });
  app.post('/api/economics/cash/open', async (request, reply) => {
    const context = await auth(request, reply, 'billing.cash.manage'); if (!context) return;
    const parsed = z.object({ registerCode: z.enum(['bunker','sala']), openingDenominations: cashDenominationsSchema }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    const openingCents = cashDenominationsToCents(parsed.data.openingDenominations);
    try {
      const result = await db.begin(async tx => {
        await tx`SELECT pg_advisory_xact_lock(hashtext('2j-economic-register-operations'))`;
        const [legacy] = await tx`SELECT id FROM economic_cash_sessions WHERE status='open' AND register_id IS NULL LIMIT 1 FOR UPDATE`;
        if (legacy) return { error: 'cash_legacy_session_requires_owner_resolution' as const };
        const [stale] = await tx`SELECT id FROM economic_cash_sessions WHERE status='open' AND local_date<(now() AT TIME ZONE 'Atlantic/Canary')::date LIMIT 1 FOR UPDATE`;
        if (stale) return { error: 'cash_session_previous_day_requires_owner_resolution' as const };
        const [person] = await tx`SELECT id FROM staff_professionals WHERE auth_actor_id=${context.actorId} AND status='active' FOR UPDATE`;
        if (!person) return { error: 'staff_account_unlinked' as const };
        const [clock] = await tx`SELECT e.event_type AS "eventType" FROM staff_timeclock_events e LEFT JOIN LATERAL(SELECT corrected_occurred_at FROM staff_timeclock_corrections c WHERE c.event_id=e.id ORDER BY c.revision DESC LIMIT 1)c ON true WHERE e.professional_id=${person.id} ORDER BY COALESCE(c.corrected_occurred_at,e.occurred_at) DESC,e.id DESC LIMIT 1`;
        if (clock?.eventType !== 'clock_in') return { error: 'clock_in_required' as const };
        const [currentCustody] = await tx`SELECT id FROM economic_cash_custodies WHERE actor_id=${context.actorId} AND ended_at IS NULL LIMIT 1 FOR UPDATE`;
        if (currentCustody) return { error: 'already_holds_register' as const };
        const [register] = await tx`SELECT id,code,name FROM economic_cash_registers WHERE code=${parsed.data.registerCode} AND active=true FOR UPDATE`;
        if (!register) return { error: 'cash_register_not_found' as const };
        const [open] = await tx`SELECT id,local_date=(now() AT TIME ZONE 'Atlantic/Canary')::date AS "isToday" FROM economic_cash_sessions WHERE register_id=${register.id} AND status='open' LIMIT 1 FOR UPDATE`;
        if (open) return { error: open.isToday ? 'cash_already_open' as const : 'cash_session_previous_day_requires_owner_resolution' as const };
        const [usedToday] = await tx`SELECT id FROM economic_cash_sessions WHERE register_id=${register.id} AND local_date=(now() AT TIME ZONE 'Atlantic/Canary')::date LIMIT 1 FOR UPDATE`;
        if (usedToday) return { error: 'cash_register_already_used_today' as const };
        const [row] = await tx`INSERT INTO economic_cash_sessions(register_id,local_date,opening_cents,opening_denominations,opened_by) VALUES (${register.id},(now() AT TIME ZONE 'Atlantic/Canary')::date,${openingCents},${JSON.stringify(parsed.data.openingDenominations)}::jsonb,${context.actorId}) RETURNING id,register_id AS "registerId",local_date AS "localDate",status,opened_at AS "openedAt"`;
        if (!row) throw new Error('cash session insert returned no row');
        await tx`INSERT INTO economic_cash_custodies(cash_session_id,professional_id,actor_id) VALUES (${row.id},${person.id},${context.actorId})`;
        await audit(tx, context, 'cash.opened', 'cash_session', row.id, null, { registerId: register.id, registerCode: register.code, openingCents, openingDenominations: parsed.data.openingDenominations, localDate: String(row.localDate) });
        return { row: { ...row, registerCode: register.code, registerName: register.name } };
      });
      if ('error' in result) return reply.code(result.error==='staff_account_unlinked'?404:409).send({ error: result.error, ...(result.error==='cash_session_previous_day_requires_owner_resolution'?{message:previousDayCashSessionMessage}:result.error==='cash_legacy_session_requires_owner_resolution'?{message:legacyCashSessionMessage}:{}) });
      return reply.code(201).send({ ...result.row, openingCents, openingDenominations: parsed.data.openingDenominations });
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      const constraint=typeof error==='object'&&error&&'constraint'in error?String(error.constraint):'';
      const uniqueViolation=constraint==='economic_cash_one_session_per_register_day'||(typeof error==='object'&&error&&'message'in error&&String(error.message).includes('economic_cash_one_session_per_register_day'));
      return reply.code(code === '23505' ? 409 : 500).send({ error: code === '23505'&&uniqueViolation ? 'cash_register_already_used_today' : code === '23505' ? 'cash_session_exists' : 'cash_open_failed' });
    }
  });

  app.post('/api/economics/cash/:sessionId/owner-reopen',async(request,reply)=>{
    const context=await auth(request,reply,'owner.panel.read');if(!context)return;
    const params=z.object({sessionId:uuid}).safeParse(request.params);
    const body=z.object({custodianActorId:z.string().trim().min(1).max(120),openingDenominations:cashDenominationsSchema}).strict().safeParse(request.body);
    if(!params.success||!body.success)return reply.code(400).send({error:'validation_error'});
    const openingCents=cashDenominationsToCents(body.data.openingDenominations);
    try{
      const result=await db.begin(async tx=>{
        await tx`SELECT pg_advisory_xact_lock(hashtext('2j-economic-register-operations'))`;
        const [legacy]=await tx`SELECT id FROM economic_cash_sessions WHERE status='open' AND register_id IS NULL LIMIT 1 FOR UPDATE`;
        if(legacy)return {error:'cash_legacy_session_requires_owner_resolution'} as const;
        const [stale]=await tx`SELECT id FROM economic_cash_sessions WHERE status='open' AND local_date<(now() AT TIME ZONE 'Atlantic/Canary')::date LIMIT 1 FOR UPDATE`;
        if(stale)return {error:'cash_session_previous_day_requires_owner_resolution'} as const;
        const [session]=await tx`SELECT id,register_id AS "registerId",local_date AS "localDate",status,opened_by AS "openedBy" FROM economic_cash_sessions WHERE id=${params.data.sessionId} FOR UPDATE`;
        if(!session)return {error:'cash_session_not_found'} as const;
        if(!session.registerId)return {error:'cash_legacy_session_requires_owner_resolution'} as const;
        if(session.localDate!==(await tx`SELECT (now() AT TIME ZONE 'Atlantic/Canary')::date AS date`)[0]?.date)return {error:'cash_reopen_today_only'} as const;
        if(!['closed','late_close'].includes(session.status))return {error:'cash_session_not_closed'} as const;
        const [custodian]=await tx`SELECT id,auth_actor_id AS "actorId" FROM staff_professionals WHERE auth_actor_id=${body.data.custodianActorId} AND status='active' FOR UPDATE`;
        if(!custodian)return {error:'staff_account_unlinked'} as const;
        const [clock]=await tx`SELECT e.event_type AS "eventType" FROM staff_timeclock_events e LEFT JOIN LATERAL(SELECT corrected_occurred_at FROM staff_timeclock_corrections c WHERE c.event_id=e.id ORDER BY c.revision DESC LIMIT 1)c ON true WHERE e.professional_id=${custodian.id} ORDER BY COALESCE(c.corrected_occurred_at,e.occurred_at) DESC,e.id DESC LIMIT 1`;
        if(clock?.eventType!=='clock_in')return {error:'cash_custodian_not_clocked_in'} as const;
        const [held]=await tx`SELECT id FROM economic_cash_custodies WHERE actor_id=${custodian.actorId} AND ended_at IS NULL FOR UPDATE`;
        if(held)return {error:'already_holds_register'} as const;
        await tx`SELECT set_config('twoj.cash_reopen_actor',${context.actorId},true)`;
        await audit(tx,context,'cash.reopened','cash_session',session.id,null,{registerId:session.registerId,localDate:String(session.localDate),custodianActorId:custodian.actorId,openingCents,openingDenominations:body.data.openingDenominations});
        const [reopened]=await tx`UPDATE economic_cash_sessions SET status='open',closed_at=NULL,closed_by=NULL,expected_cents=NULL,counted_cents=NULL,counted_denominations=NULL,difference_cents=NULL,close_kind=NULL WHERE id=${session.id} AND status IN ('closed','late_close') RETURNING id,register_id AS "registerId",local_date AS "localDate",status`;
        if(!reopened)return {error:'cash_session_not_closed'} as const;
        await tx`INSERT INTO economic_cash_custodies(cash_session_id,professional_id,actor_id) VALUES (${session.id},${custodian.id},${custodian.actorId})`;
        const [register]=await tx`SELECT code,name FROM economic_cash_registers WHERE id=${session.registerId}`;
        if(!register)throw new Error('cash register missing for physical cash session');
        return {id:reopened.id,registerId:reopened.registerId,registerCode:register.code,registerName:register.name,localDate:reopened.localDate,status:reopened.status,openingCents,openingDenominations:body.data.openingDenominations} as const;
      });
      if('error'in result)return reply.code(result.error==='cash_session_not_found'?404:result.error==='staff_account_unlinked'?404:409).send({error:result.error});
      return reply.send(result);
    }catch(error){
      const code=typeof error==='object'&&error&&'code'in error?String(error.code):'';
      return reply.code(code==='55000'?409:code==='23505'?409:500).send({error:code==='55000'?'cash_transition_invalid':code==='23505'?'already_holds_register':'cash_reopen_failed'});
    }
  });
  const closeBody = z.object({ countedDenominations: cashDenominationsSchema }).strict();
  app.post('/api/economics/cash/close', async (request, reply) => {
    const context = await auth(request, reply, 'billing.cash.manage'); if (!context) return;
    const parsed = closeBody.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    const [legacy] = await db`SELECT id FROM economic_cash_sessions WHERE status='open' AND register_id IS NULL LIMIT 1`;
    if (legacy) return reply.code(409).send({error:'cash_legacy_session_requires_owner_resolution',message:legacyCashSessionMessage});
    const [session] = await db`SELECT s.id FROM economic_cash_custodies c JOIN economic_cash_sessions s ON s.id=c.cash_session_id WHERE c.actor_id=${context.actorId} AND c.ended_at IS NULL AND s.local_date=(now() AT TIME ZONE 'Atlantic/Canary')::date AND s.status='open' LIMIT 1`;
    if (!session) {
      const [stale]=await db`SELECT s.id FROM economic_cash_custodies c JOIN economic_cash_sessions s ON s.id=c.cash_session_id WHERE c.actor_id=${context.actorId} AND c.ended_at IS NULL AND s.status='open' LIMIT 1`;
      return reply.code(409).send(stale?{error:'cash_session_previous_day_requires_owner_resolution',message:previousDayCashSessionMessage}:{error:'cash_not_open'});
    }
    return closeCash(request, reply, session.id, parsed.data.countedDenominations, context);
  });
  app.post('/api/economics/cash/:sessionId/close', async (request, reply) => {
    const context = await auth(request, reply, 'billing.cash.manage'); if (!context) return;
    const params = z.object({ sessionId: uuid }).safeParse(request.params);
    const parsed = closeBody.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: 'validation_error' });
    return closeCash(request, reply, params.data.sessionId, parsed.data.countedDenominations, context);
  });

  app.post('/api/economics/cash/legacy/:sessionId/resolve',async(request,reply)=>{
    const context=await auth(request,reply,'owner.panel.read');if(!context)return;
    const p=z.object({sessionId:uuid}).safeParse(request.params);const b=z.object({countedDenominations:cashDenominationsSchema,reason:z.string().trim().min(3).max(240)}).strict().safeParse(request.body);
    if(!p.success||!b.success)return reply.code(400).send({error:'validation_error'});
    try{const result=await db.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtext('2j-economic-register-operations'))`;
      const [session]=await tx`SELECT id,opened_by AS "openedBy",register_id AS "registerId",local_date AS "localDate",status FROM economic_cash_sessions WHERE id=${p.data.sessionId} FOR UPDATE`;
      if(!session||session.registerId!==null)return {error:'legacy_cash_session_not_found'} as const;
      if(session.status!=='open')return {error:'cash_already_closed'} as const;
      const snapshot=await cashSnapshot(tx,session.id);if(!snapshot)return {error:'legacy_cash_session_not_found'} as const;
      const countedCents=cashDenominationsToCents(b.data.countedDenominations);const difference=countedCents-snapshot.expectedCents;
      const [closed]=await tx`UPDATE economic_cash_sessions SET status=CASE WHEN local_date<(now() AT TIME ZONE 'Atlantic/Canary')::date THEN 'late_close' ELSE 'closed' END,close_kind=CASE WHEN local_date<(now() AT TIME ZONE 'Atlantic/Canary')::date THEN 'late_close' ELSE 'closed' END,expected_cents=${snapshot.expectedCents},counted_cents=${countedCents},counted_denominations=${JSON.stringify(b.data.countedDenominations)}::jsonb,difference_cents=${difference},closed_by=${context.actorId},closed_at=now() WHERE id=${session.id} AND status='open' RETURNING id,status,closed_at AS "closedAt"`;
      if(!closed)return {error:'cash_already_closed'} as const;
      await audit(tx,context,'cash.legacy_resolved','cash_session',session.id,null,{reason:b.data.reason,registerId:null,localDate:String(session.localDate),openingCents:snapshot.openingCents,openingDenominations:snapshot.openingDenominations,expectedCents:snapshot.expectedCents,countedCents,countedDenominations:b.data.countedDenominations,differenceCents:difference,timeclockChanged:false});
      const [former]=await tx`SELECT auth_actor_id AS "actorId" FROM staff_professionals WHERE auth_actor_id=${session.openedBy} LIMIT 1`;
      if(former?.actorId)await appendNotificationEvent(tx,{type:'staff.cash_legacy_resolved',aggregateType:'cash_session',aggregateId:session.id,staffActorId:former.actorId,dedupeKey:`legacy-cash-resolved:${session.id}:${former.actorId}`});
      return {id:closed.id,status:closed.status,localDate:session.localDate,openingDenominations:snapshot.openingDenominations,countedDenominations:b.data.countedDenominations,expectedCents:snapshot.expectedCents,countedCents,differenceCents:difference};
    });
      if('error'in result)return reply.code(result.error==='legacy_cash_session_not_found'?404:409).send({error:result.error});
      return reply.send(result);
    }catch{return reply.code(500).send({error:'legacy_cash_resolution_failed'});}
  });

  app.post('/api/economics/cash/:sessionId/owner-resolve',async(request,reply)=>{
    const context=await auth(request,reply,'owner.panel.read');if(!context)return;
    const p=z.object({sessionId:uuid}).safeParse(request.params);const b=z.object({countedDenominations:cashDenominationsSchema,reason:z.string().trim().min(3).max(240)}).strict().safeParse(request.body);
    if(!p.success||!b.success)return reply.code(400).send({error:'validation_error'});
    try{
      const result=await db.begin(async tx=>{
        await tx`SELECT pg_advisory_xact_lock(hashtext('2j-economic-register-operations'))`;
        const [session]=await tx`SELECT id,register_id AS "registerId",local_date AS "localDate",status,opened_by AS "openedBy",local_date<(now() AT TIME ZONE 'Atlantic/Canary')::date AS "isPreviousDay" FROM economic_cash_sessions WHERE id=${p.data.sessionId} FOR UPDATE`;
        if(!session)return {error:'cash_session_not_found'} as const;
        if(session.registerId===null)return {error:'cash_legacy_session_requires_legacy_resolution'} as const;
        if(session.status!=='open')return {error:'cash_already_closed'} as const;
        if(!session.isPreviousDay)return {error:'cash_owner_resolution_only_for_previous_day'} as const;
        const [pending]=await tx`SELECT id FROM economic_cash_outflows WHERE cash_session_id=${session.id} AND status='pending_owner_approval' LIMIT 1`;
        if(pending)return {error:'cash_outflow_approval_pending'} as const;
        const snapshot=await cashSnapshot(tx,session.id);if(!snapshot)return {error:'cash_session_not_found'} as const;
        const countedCents=cashDenominationsToCents(b.data.countedDenominations);const difference=countedCents-snapshot.expectedCents;
        const [closed]=await tx`UPDATE economic_cash_sessions SET status='late_close',close_kind='late_close',expected_cents=${snapshot.expectedCents},counted_cents=${countedCents},counted_denominations=${JSON.stringify(b.data.countedDenominations)}::jsonb,difference_cents=${difference},closed_by=${context.actorId},closed_at=now() WHERE id=${session.id} AND status='open' RETURNING id,status`;
        if(!closed)return {error:'cash_already_closed'} as const;
        const custodians=await tx`SELECT actor_id AS "actorId" FROM economic_cash_custodies WHERE cash_session_id=${session.id} AND ended_at IS NULL ORDER BY started_at,id FOR UPDATE`;
        await tx`UPDATE economic_cash_custodies SET ended_at=now(),ended_reason='owner_resolution',ended_by=${context.actorId} WHERE cash_session_id=${session.id} AND ended_at IS NULL`;
        await audit(tx,context,'cash.forgotten_session_resolved','cash_session',session.id,null,{reason:b.data.reason,registerId:session.registerId,localDate:String(session.localDate),expectedCents:snapshot.expectedCents,countedCents,countedDenominations:b.data.countedDenominations,differenceCents:difference,timeclockChanged:false});
        const recipients=await tx`SELECT DISTINCT actor_id AS "actorId" FROM (
          SELECT actor_id FROM economic_cash_custodies WHERE cash_session_id=${session.id}
          UNION SELECT auth_actor_id AS actor_id FROM staff_professionals WHERE auth_actor_id=${session.openedBy} AND status='active'
        ) recipients WHERE actor_id IS NOT NULL`;
        for(const recipient of recipients){const staffActorId=String(recipient.actorId);await appendNotificationEvent(tx,{type:'staff.cash_legacy_resolved',aggregateType:'cash_session',aggregateId:session.id,staffActorId,dedupeKey:`forgotten-cash-resolved:${session.id}:${staffActorId}`});}
        return {id:closed.id,status:closed.status,localDate:session.localDate,registerId:session.registerId,countedDenominations:b.data.countedDenominations,expectedCents:snapshot.expectedCents,countedCents,differenceCents:difference,notifiedStaff:recipients.length,timeclockChanged:false} as const;
      });
      if('error'in result)return reply.code(result.error==='cash_session_not_found'?404:409).send({error:result.error});
      return result;
    }catch{return reply.code(500).send({error:'cash_owner_resolution_failed'});}
  });

  app.post('/api/economics/cash/:sessionId/handover',async(request,reply)=>{
    const context=await auth(request,reply,'billing.cash.manage');if(!context)return;
    const p=z.object({sessionId:uuid}).safeParse(request.params);const b=z.object({incomingProfessionalId:uuid,outgoingDenominations:cashDenominationsSchema}).strict().safeParse(request.body);
    if(!p.success||!b.success)return reply.code(400).send({error:'validation_error'});
    try{const result=await db.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtext('2j-economic-register-operations'))`;
      const [session]=await tx`SELECT id,register_id AS "registerId",local_date,status,local_date=(now() AT TIME ZONE 'Atlantic/Canary')::date AS "isToday" FROM economic_cash_sessions WHERE id=${p.data.sessionId} FOR UPDATE`;
      if(!session||!session.registerId)return {error:'cash_session_not_found'} as const;
      if(session.status!=='open')return {error:'cash_not_open'} as const;
      if(!session.isToday)return {error:'cash_session_previous_day_requires_owner_resolution'} as const;
      const [outgoing]=await tx`SELECT id,professional_id AS "professionalId" FROM economic_cash_custodies WHERE cash_session_id=${session.id} AND actor_id=${context.actorId} AND ended_at IS NULL FOR UPDATE`;
      if(!outgoing)return {error:'cash_custodian_required'} as const;
      const [recipient]=await tx`SELECT id,auth_actor_id AS "actorId" FROM staff_professionals WHERE id=${b.data.incomingProfessionalId} AND status='active' FOR UPDATE`;
      if(!recipient?.actorId||recipient.actorId===context.actorId)return {error:'handover_recipient_invalid'} as const;
      const [clock]=await tx`SELECT e.event_type AS "eventType" FROM staff_timeclock_events e LEFT JOIN LATERAL(SELECT corrected_occurred_at FROM staff_timeclock_corrections c WHERE c.event_id=e.id ORDER BY c.revision DESC LIMIT 1)c ON true WHERE e.professional_id=${recipient.id} ORDER BY COALESCE(c.corrected_occurred_at,e.occurred_at) DESC,e.id DESC LIMIT 1`;
      if(clock?.eventType!=='clock_in')return {error:'handover_recipient_not_clocked_in'} as const;
      const [alreadyCustodian]=await tx`SELECT id FROM economic_cash_custodies WHERE actor_id=${recipient.actorId} AND ended_at IS NULL LIMIT 1 FOR UPDATE`;
      if(alreadyCustodian)return {error:'handover_recipient_holds_register'} as const;
      const [pending]=await tx`SELECT id FROM economic_cash_handovers WHERE cash_session_id=${session.id} AND completed_at IS NULL LIMIT 1 FOR UPDATE`;
      if(pending)return {error:'handover_already_pending'} as const;
      const [handover]=await tx`INSERT INTO economic_cash_handovers(cash_session_id,outgoing_custody_id,outgoing_actor_id,incoming_professional_id,incoming_actor_id,outgoing_denominations,outgoing_confirmed_at)
        VALUES (${session.id},${outgoing.id},${context.actorId},${recipient.id},${recipient.actorId},${JSON.stringify(b.data.outgoingDenominations)}::jsonb,now())
        RETURNING id,cash_session_id AS "cashSessionId"`;
      if(!handover)throw new Error('cash_handover_insert_missing');
      await audit(tx,context,'cash.handover_started','cash_handover',handover.id,null,{sessionId:session.id,registerId:session.registerId,incomingProfessionalId:recipient.id,outgoingDenominations:b.data.outgoingDenominations});
      return {id:handover.id,sessionId:session.id,status:'awaiting_incoming_confirmation'} as const;
    });
      if('error'in result)return reply.code(result.error==='cash_session_not_found'?404:409).send({error:result.error,...(result.error==='cash_session_previous_day_requires_owner_resolution'?{message:previousDayCashSessionMessage}:{})});
      return reply.code(201).send(result);
    }catch{return reply.code(500).send({error:'cash_handover_start_failed'});}
  });

  app.get('/api/economics/cash/handover-recipients',async(request,reply)=>{
    reply.header('Cache-Control','no-store');const context=await auth(request,reply,'billing.cash.manage');if(!context)return;
    const items=await db`SELECT p.id,p.display_name AS "displayName" FROM staff_professionals p
      JOIN LATERAL(SELECT e.event_type FROM staff_timeclock_events e LEFT JOIN LATERAL(SELECT corrected_occurred_at FROM staff_timeclock_corrections WHERE event_id=e.id ORDER BY revision DESC LIMIT 1)c ON true WHERE e.professional_id=p.id ORDER BY COALESCE(c.corrected_occurred_at,e.occurred_at) DESC,e.id DESC LIMIT 1) latest ON latest.event_type='clock_in'
      WHERE p.status='active' AND p.auth_actor_id IS NOT NULL AND p.auth_actor_id<>${context.actorId}
        AND NOT EXISTS(SELECT 1 FROM economic_cash_custodies c WHERE c.actor_id=p.auth_actor_id AND c.ended_at IS NULL)
      ORDER BY lower(p.display_name),p.id`;
    return {items};
  });

  app.get('/api/economics/cash/handovers/pending',async(request,reply)=>{
    reply.header('Cache-Control','no-store');const context=await auth(request,reply,'billing.cash.manage');if(!context)return;
    const items=await db`SELECT h.id,h.cash_session_id AS "sessionId",r.code AS "registerCode",r.name AS "registerName",p.display_name AS "fromName",h.created_at AS "createdAt"
      FROM economic_cash_handovers h JOIN economic_cash_sessions s ON s.id=h.cash_session_id JOIN economic_cash_registers r ON r.id=s.register_id
      JOIN economic_cash_custodies c ON c.id=h.outgoing_custody_id JOIN staff_professionals p ON p.id=c.professional_id
      WHERE h.incoming_actor_id=${context.actorId} AND h.completed_at IS NULL AND s.status='open' AND s.local_date=(now() AT TIME ZONE 'Atlantic/Canary')::date
      ORDER BY h.created_at,h.id`;
    return {items};
  });

  app.post('/api/economics/cash/handovers/:handoverId/confirm',async(request,reply)=>{
    const context=await auth(request,reply,'billing.cash.manage');if(!context)return;
    const p=z.object({handoverId:uuid}).safeParse(request.params);const b=z.object({incomingDenominations:cashDenominationsSchema}).strict().safeParse(request.body);
    if(!p.success||!b.success)return reply.code(400).send({error:'validation_error'});
    try{const result=await db.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtext('2j-economic-register-operations'))`;
      const [handover]=await tx`SELECT id,cash_session_id AS "cashSessionId",outgoing_custody_id AS "outgoingCustodyId",incoming_professional_id AS "incomingProfessionalId",outgoing_actor_id AS "outgoingActorId",incoming_actor_id AS "incomingActorId",outgoing_denominations AS "outgoingDenominations",completed_at AS "completedAt" FROM economic_cash_handovers WHERE id=${p.data.handoverId} FOR UPDATE`;
      if(!handover||handover.incomingActorId!==context.actorId)return {error:'handover_not_found'} as const;
      if(handover.completedAt)return {error:'handover_already_completed'} as const;
      const [session]=await tx`SELECT id,register_id AS "registerId",status,local_date=(now() AT TIME ZONE 'Atlantic/Canary')::date AS "isToday" FROM economic_cash_sessions WHERE id=${handover.cashSessionId} FOR UPDATE`;
      if(session?.status!=='open')return {error:'cash_not_open'} as const;
      if(!session.isToday)return {error:'cash_session_previous_day_requires_owner_resolution'} as const;
      const [recipient]=await tx`SELECT id FROM staff_professionals WHERE id=${handover.incomingProfessionalId} AND auth_actor_id=${context.actorId} AND status='active' FOR UPDATE`;
      if(!recipient)return {error:'staff_account_unlinked'} as const;
      const [clock]=await tx`SELECT e.event_type AS "eventType" FROM staff_timeclock_events e LEFT JOIN LATERAL(SELECT corrected_occurred_at FROM staff_timeclock_corrections c WHERE c.event_id=e.id ORDER BY c.revision DESC LIMIT 1)c ON true WHERE e.professional_id=${recipient.id} ORDER BY COALESCE(c.corrected_occurred_at,e.occurred_at) DESC,e.id DESC LIMIT 1`;
      if(clock?.eventType!=='clock_in')return {error:'handover_recipient_not_clocked_in'} as const;
      const [alreadyCustodian]=await tx`SELECT id FROM economic_cash_custodies WHERE actor_id=${context.actorId} AND ended_at IS NULL LIMIT 1 FOR UPDATE`;
      if(alreadyCustodian)return {error:'handover_recipient_holds_register'} as const;
      const outgoingTotal=cashDenominationsToCents(handover.outgoingDenominations as z.infer<typeof cashDenominationsSchema>);
      const incomingTotal=cashDenominationsToCents(b.data.incomingDenominations);const mismatch=outgoingTotal!==incomingTotal;
      const [oldCustody]=await tx`SELECT id,professional_id AS "professionalId" FROM economic_cash_custodies WHERE id=${handover.outgoingCustodyId} AND actor_id=${handover.outgoingActorId} AND ended_at IS NULL FOR UPDATE`;
      if(!oldCustody)return {error:'handover_custody_changed'} as const;
      await tx`UPDATE economic_cash_custodies SET ended_at=now(),ended_reason='handover',ended_by=${context.actorId} WHERE id=${oldCustody.id} AND ended_at IS NULL`;
      await tx`INSERT INTO economic_cash_custodies(cash_session_id,professional_id,actor_id) VALUES (${session.id},${recipient.id},${context.actorId})`;
      const [completed]=await tx`UPDATE economic_cash_handovers SET incoming_denominations=${JSON.stringify(b.data.incomingDenominations)}::jsonb,incoming_confirmed_at=now(),completed_at=now(),mismatch=${mismatch} WHERE id=${handover.id} AND completed_at IS NULL RETURNING id,completed_at AS "completedAt",mismatch`;
      if(!completed)throw new Error('cash_handover_completion_missing');
      await audit(tx,context,'cash.handover_completed','cash_handover',handover.id,null,{sessionId:session.id,registerId:session.registerId,incomingDenominations:b.data.incomingDenominations,mismatch,denominationDifferenceCents:incomingTotal-outgoingTotal});
      // A mismatch is an owner-only incident; the incoming cashier only needs confirmation.
      return {id:completed.id,status:'completed',completedAt:completed.completedAt} as const;
    });
      if('error'in result)return reply.code(result.error==='handover_not_found'?404:409).send({error:result.error,...(result.error==='cash_session_previous_day_requires_owner_resolution'?{message:previousDayCashSessionMessage}:{})});
      return reply.send(result);
    }catch{return reply.code(500).send({error:'cash_handover_confirmation_failed'});}
  });
  app.post('/api/economics/cash/adjustments', async (_request, reply) => reply.code(410).send({error:'manual_cash_adjustments_disabled',message:'Usa el flujo tipado de gasto o retirada; no se admiten entradas o salidas manuales genéricas.'}));

  app.post('/api/economics/cash/outflows', { bodyLimit: 3 * 1024 * 1024 }, async (request, reply) => {
    const context = await auth(request, reply, 'billing.cash.adjust'); if (!context) return;
    const parsed = z.object({ movementType:z.enum(['withdrawal','expense']), amountCents:z.number().int().min(1).max(100_000_000_000), reason:z.string().trim().min(3).max(240), receipt:z.object({contentType:z.enum(['application/pdf','image/jpeg','image/png','image/webp']),fileName:z.string().trim().min(1).max(180),base64:z.string().max(2_800_000)}).strict().optional() }).strict().safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:'validation_error'});
    let receiptBytes:Buffer|null=null;
    if(parsed.data.receipt){
      const encoded=parsed.data.receipt.base64;
      if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))return reply.code(400).send({error:'invalid_receipt'});
      receiptBytes=Buffer.from(encoded,'base64');
      if(receiptBytes.length<1||receiptBytes.length>2*1024*1024)return reply.code(413).send({error:'receipt_too_large'});
      const mime=parsed.data.receipt.contentType;
      const valid=mime==='application/pdf'?receiptBytes.subarray(0,5).toString('ascii')==='%PDF-':mime==='image/jpeg'?receiptBytes[0]===0xff&&receiptBytes[1]===0xd8&&receiptBytes[2]===0xff:mime==='image/png'?receiptBytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])):receiptBytes.length>=12&&receiptBytes.subarray(0,4).toString('ascii')==='RIFF'&&receiptBytes.subarray(8,12).toString('ascii')==='WEBP';
      if(!valid)return reply.code(415).send({error:'unsupported_receipt_content'});
    }
    try{
      const result=await db.begin(async tx=>{
        const cash=await openCashForToday(tx,context.actorId);if(!cash.ok)return {error:cash.error} as const;
        const [settings]=await tx`SELECT outflow_limit_cents AS "limitCents" FROM economic_cash_settings WHERE singleton=true FOR SHARE`;
        const pending=settings?.limitCents!=null&&parsed.data.amountCents>Number(settings.limitCents);
        const [row]=await tx`INSERT INTO economic_cash_outflows(cash_session_id,movement_type,amount_cents,reason,receipt_content_type,receipt_file_name,receipt_bytes,actor_id,status,approved_by,approved_at)
          VALUES (${cash.id},${parsed.data.movementType},${parsed.data.amountCents},${parsed.data.reason},${parsed.data.receipt?.contentType??null},${parsed.data.receipt?.fileName??null},${receiptBytes},${context.actorId},${pending?'pending_owner_approval':'approved'},${pending?null:context.actorId},CASE WHEN ${pending} THEN NULL ELSE now() END)
          RETURNING id,cash_session_id AS "cashSessionId",movement_type AS "movementType",amount_cents AS "amountCents",reason,status,receipt_bytes IS NOT NULL AS "hasReceipt",created_at AS "createdAt"`;
        if(!row)throw new Error('cash_outflow_insert_missing');
        await audit(tx,context,pending?'cash.outflow_pending':'cash.outflow_recorded','cash_outflow',row.id,null,{sessionId:cash.id,registerId:cash.registerId,movementType:row.movementType,amountCents:row.amountCents,reason:row.reason,hasReceipt:Boolean(row.hasReceipt),status:row.status});
        return {row} as const;
      });
      if('error'in result)return reply.code(409).send({error:result.error,...(result.error==='cash_session_previous_day_requires_owner_resolution'?{message:previousDayCashSessionMessage}:result.error==='cash_legacy_session_requires_owner_resolution'?{message:legacyCashSessionMessage}:{})});
      return reply.code(201).send(result.row);
    }catch(error){const code=typeof error==='object'&&error&&'code'in error?String(error.code):'';return reply.code(code==='23514'?409:500).send({error:code==='23514'?'cash_custodian_required':'cash_outflow_failed'});}
  });

  app.post('/api/economics/cash/outflows/:outflowId/decision', async (request,reply)=>{
    const context=await auth(request,reply,'owner.panel.read');if(!context)return;
    const p=z.object({outflowId:uuid}).safeParse(request.params);const b=z.object({decision:z.enum(['approved','rejected']),reason:z.string().trim().min(3).max(240)}).strict().safeParse(request.body);
    if(!p.success||!b.success)return reply.code(400).send({error:'validation_error'});
    try{const result=await db.begin(async tx=>{await tx`SELECT pg_advisory_xact_lock(hashtext('2j-economic-register-operations'))`;const [row]=await tx`SELECT id,cash_session_id AS "cashSessionId",movement_type AS "movementType",amount_cents AS "amountCents",status FROM economic_cash_outflows WHERE id=${p.data.outflowId} FOR UPDATE`;if(!row)return {error:'cash_outflow_not_found'} as const;if(row.status!=='pending_owner_approval')return {error:'cash_outflow_already_decided'} as const;const [session]=await tx`SELECT status FROM economic_cash_sessions WHERE id=${row.cashSessionId} FOR UPDATE`;if(session?.status!=='open')return {error:'cash_session_not_open'} as const;const [updated]=await tx`UPDATE economic_cash_outflows SET status=${b.data.decision},approved_by=${context.actorId},approved_at=now() WHERE id=${row.id} AND status='pending_owner_approval' RETURNING id,status,approved_at AS "approvedAt"`;if(!updated)return {error:'cash_outflow_already_decided'} as const;await audit(tx,context,`cash.outflow_${b.data.decision}`,'cash_outflow',row.id,null,{sessionId:row.cashSessionId,movementType:row.movementType,amountCents:row.amountCents,reason:b.data.reason});return updated;});if('error'in result)return reply.code(result.error==='cash_outflow_not_found'?404:409).send(result);return result;}catch{return reply.code(500).send({error:'cash_outflow_decision_failed'});}
  });

  app.get('/api/economics/cash/settings/outflow-limit',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    const context=await auth(request,reply,'owner.panel.read');if(!context)return;
    const [row]=await db`SELECT outflow_limit_cents AS "limitCents",updated_at AS "updatedAt" FROM economic_cash_settings WHERE singleton=true`;
    return row??{limitCents:null,updatedAt:null};
  });
  app.put('/api/economics/cash/settings/outflow-limit',async(request,reply)=>{
    const context=await auth(request,reply,'owner.panel.read');if(!context)return;
    const b=z.object({limitCents:z.number().int().min(1).max(100_000_000_000).nullable()}).strict().safeParse(request.body);if(!b.success)return reply.code(400).send({error:'validation_error'});
    try{const [row]=await db`UPDATE economic_cash_settings SET outflow_limit_cents=${b.data.limitCents},updated_by=${context.actorId},updated_at=now() WHERE singleton=true RETURNING outflow_limit_cents AS "limitCents",updated_at AS "updatedAt"`;if(!row)return reply.code(500).send({error:'cash_settings_missing'});await audit(db,context,'cash.outflow_limit_updated','cash_settings',randomUUID(),null,{limitCents:b.data.limitCents});return row;}catch(error){const code=typeof error==='object'&&error&&'code'in error?String(error.code):'';app.log.error({databaseCode:code,route:'PUT /api/economics/cash/settings/outflow-limit'},'cash setting update failed');return reply.code(500).send({error:'cash_settings_update_failed'});}
  });

  app.post('/api/economics/charges/:chargeId/void', async (request, reply) => {
    const context = await auth(request, reply, 'billing.payments.manage'); if (!context) return;
    const params = z.object({ chargeId: uuid }).safeParse(request.params);
    const body = z.object({ reason: z.string().trim().min(3).max(240) }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    try {
      const result = await db.begin(async tx => {
        const [charge] = await tx`SELECT id,client_id AS "clientId",state FROM economic_charges WHERE id=${params.data.chargeId} FOR UPDATE`;
        if (!charge) return { error: 'charge_not_found' as const };
        if (charge.state !== 'pending') return { error: 'charge_not_pending' as const };
        const [money] = await tx`SELECT count(*)::int count FROM economic_transactions WHERE charge_id=${charge.id}`;
        if (Number(money?.count) > 0) return { error: 'refund_required' as const };
        const [row] = await tx`UPDATE economic_charges SET state='void',void_reason=${body.data.reason},voided_by=${context.actorId},voided_at=now() WHERE id=${charge.id} AND state='pending' RETURNING id,state,void_reason AS "voidReason",voided_at AS "voidedAt"`;
        if (!row) return { error: 'charge_not_pending' as const };
        await audit(tx, context, 'charge.voided', 'charge', charge.id, charge.clientId, { reason: body.data.reason });
        return { row };
      });
      if ('error' in result) return reply.code(result.error === 'charge_not_found' ? 404 : 409).send({ error: result.error });
      return result.row;
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      return reply.code(code === '55000' ? 409 : 500).send({ error: code === '55000' ? 'charge_transition_invalid' : 'charge_void_failed' });
    }
  });

  app.post('/api/economics/transfer-proofs', { bodyLimit: 3_000_000 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await auth(request, reply, 'billing.payments.manage'); if (!context) return;
    const parsed = z.object({ chargeId: uuid, amountCents: z.number().int().min(1).max(100_000_000_000), contentType: z.enum(['application/pdf','image/jpeg','image/png','image/webp']), fileName: z.string().trim().min(1).max(180), base64: z.string().min(4).max(2_800_000) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    const bytes = Buffer.from(parsed.data.base64, 'base64');
    if (!bytes.length || bytes.length > 2_097_152 || bytes.toString('base64').replace(/=+$/,'') !== parsed.data.base64.replace(/=+$/,'')) return reply.code(400).send({ error: 'invalid_file' });
    const signature = parsed.data.contentType === 'application/pdf' ? bytes.subarray(0,5).toString() === '%PDF-'
      : parsed.data.contentType === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : parsed.data.contentType === 'image/jpeg' ? bytes.subarray(0,3).equals(Buffer.from([255,216,255]))
      : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP';
    if (!signature) return reply.code(400).send({ error: 'file_type_mismatch' });
    const digest = createHash('sha256').update(bytes).digest('hex');
    try {
      const result = await db.begin(async tx => {
        const [charge] = await tx`SELECT id,client_id AS "clientId",amount_cents AS "amountCents",state FROM economic_charges WHERE id=${parsed.data.chargeId} FOR UPDATE`;
        if (!charge) return { error: 'charge_not_found' as const };
        if (charge.state !== 'pending' || parsed.data.amountCents > Number(charge.amountCents)) return { error: 'charge_closed' as const };
        const [balance] = await tx`SELECT COALESCE(sum(amount_cents) FILTER(WHERE kind='payment'),0)::bigint paid,COALESCE(sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END),0)::bigint net FROM economic_transactions WHERE charge_id=${charge.id}`;
        if (Number(balance?.paid ?? 0) > 0 && Number(balance?.net ?? 0) === 0) return { error: 'charge_refunded' as const };
        const [proof] = await tx`INSERT INTO economic_transfer_proofs(charge_id,amount_cents,content_type,file_name,file_bytes,sha256,submitted_by) VALUES (${charge.id},${parsed.data.amountCents},${parsed.data.contentType},${parsed.data.fileName},${bytes},${digest},${context.actorId}) RETURNING id,status`;
        if (!proof) throw new Error('proof insert returned no row');
        await audit(tx, context, 'transfer_proof.submitted', 'transfer_proof', proof.id, charge.clientId, { amountCents: parsed.data.amountCents, sha256: digest });
        const admins=await tx`SELECT auth_actor_id AS actor_id FROM staff_professionals WHERE status='active' AND base_role='admin' AND auth_actor_id IS NOT NULL`;
        for(const recipient of admins)await appendNotificationEvent(tx,{type:'staff.transfer_pending',aggregateType:'transfer_proof',aggregateId:proof.id,staffActorId:recipient.actor_id,dedupeKey:`transfer-proof:${proof.id}:${recipient.actor_id}`});
        return { id: proof.id, status: proof.status };
      });
      if ('error' in result) return reply.code(result.error === 'charge_not_found' ? 404 : 409).send({ error: result.error });
      return reply.code(201).send(result);
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      return reply.code(code === '23505' ? 409 : 500).send({ error: code === '23505' ? 'duplicate_proof' : 'transfer_proof_failed' });
    }
  });
  app.get('/api/economics/transfer-proofs', async (request, reply) => {
    if (!await auth(request, reply, 'billing.validate_transfer')) return;
    return { items: await db`SELECT id,charge_id AS "chargeId",amount_cents AS "amountCents",content_type AS "contentType",file_name AS "fileName",status,submitted_by AS "submittedBy",submitted_at AS "submittedAt",reviewed_by AS "reviewedBy",reviewed_at AS "reviewedAt",decision_note AS "decisionNote" FROM economic_transfer_proofs ORDER BY submitted_at DESC LIMIT 100` };
  });
  app.get('/api/economics/transfer-proofs/:proofId/file', async (request, reply) => {
    if (!await auth(request, reply, 'billing.validate_transfer')) return;
    const params = z.object({ proofId: uuid }).safeParse(request.params); if (!params.success) return reply.code(400).send({ error: 'invalid_proof_id' });
    const [file] = await db`SELECT content_type AS "contentType",file_name AS "fileName",file_bytes AS bytes FROM economic_transfer_proofs WHERE id=${params.data.proofId}`;
    if (!file) return reply.code(404).send({ error: 'proof_not_found' });
    reply.header('Cache-Control','no-store').header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    return reply.type(file.contentType).send(file.bytes);
  });
  app.post('/api/economics/transfer-proofs/:proofId/review', async (request, reply) => {
    const context = await auth(request, reply, 'billing.validate_transfer'); if (!context) return;
    const params = z.object({ proofId: uuid }).safeParse(request.params);
    const body = z.object({ decision: z.enum(['validated','rejected']), note: z.string().trim().min(3).max(240).optional() }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    try {
      const result = await db.begin(async tx => {
        const [proof] = await tx`SELECT id,charge_id AS "chargeId",amount_cents AS "amountCents",status,submitted_by AS "submittedBy" FROM economic_transfer_proofs WHERE id=${params.data.proofId} FOR UPDATE`;
        if (!proof) return { error: 'proof_not_found' as const };
        if (proof.submittedBy === context.actorId) return { error: 'self_review_forbidden' as const };
        if (proof.status !== 'pending_validation') return { error: 'proof_already_reviewed' as const };
        const [charge] = await tx`SELECT id,client_id AS "clientId",state,amount_cents AS "amountCents" FROM economic_charges WHERE id=${proof.chargeId} FOR UPDATE`;
        if (!charge || charge.state !== 'pending') return { error: 'charge_closed' as const };
        let transactionId: string | null = null;
        if (body.data.decision === 'validated') {
          const [balance] = await tx`SELECT COALESCE(sum(amount_cents) FILTER(WHERE kind='payment'),0)::bigint paid,COALESCE(sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END),0)::bigint cents FROM economic_transactions WHERE charge_id=${charge.id}`;
          if (Number(balance?.paid ?? 0) > 0 && Number(balance?.cents ?? 0) === 0) return { error: 'charge_refunded' as const };
          if (Number(balance?.cents ?? 0) + Number(proof.amountCents) > Number(charge.amountCents)) return { error: 'amount_exceeds_balance' as const };
          transactionId = randomUUID();
          const requestHash = createHash('sha256').update(`proof:${proof.id}:${proof.amountCents}`).digest('hex');
          const [updated] = await tx`UPDATE economic_transfer_proofs SET status='validated',reviewed_by=${context.actorId},reviewed_at=now(),decision_note=${body.data.note ?? null},transaction_id=${transactionId} WHERE id=${proof.id} AND status='pending_validation' RETURNING id`;
          if (!updated) return { error: 'proof_already_reviewed' as const };
          await tx`INSERT INTO economic_transactions(id,charge_id,client_id,kind,amount_cents,note,actor_id,idempotency_key,request_hash,cash_session_id) VALUES (${transactionId},${charge.id},${charge.clientId},'payment',${proof.amountCents},'Justificante de transferencia validado',${context.actorId},${proof.id},${requestHash},NULL)`;
          await tx`INSERT INTO economic_payment_splits(transaction_id,method,amount_cents) VALUES (${transactionId},'transfer',${proof.amountCents})`;
          await audit(tx, context, 'payment.transfer_validated', 'transaction', transactionId, charge.clientId, { amountCents: proof.amountCents, proofId: proof.id });
          await activateSettledEntitlementPeriods(tx,charge.id,context.actorId);
        } else {
          const [updated] = await tx`UPDATE economic_transfer_proofs SET status='rejected',reviewed_by=${context.actorId},reviewed_at=now(),decision_note=${body.data.note ?? null} WHERE id=${proof.id} AND status='pending_validation' RETURNING id`;
          if (!updated) return { error: 'proof_already_reviewed' as const };
        }
        const [updated] = await tx`SELECT id,status,reviewed_at AS "reviewedAt" FROM economic_transfer_proofs WHERE id=${proof.id}`;
        if (!updated) throw new Error('proof review update returned no row');
        await audit(tx, context, `transfer_proof.${body.data.decision}`, 'transfer_proof', proof.id, charge.clientId, { note: body.data.note ?? null });
        return updated;
      });
      if ('error' in result) return reply.code(result.error === 'proof_not_found' ? 404 : result.error === 'self_review_forbidden' ? 403 : 409).send({ error: result.error });
      return result;
    } catch { return reply.code(500).send({ error: 'transfer_review_failed' }); }
  });

  app.get('/api/clients/:clientId/fiscal-profile', async (request, reply) => {
    reply.header('Cache-Control','no-store');
    if (!await auth(request, reply, 'billing.read-tax')) return;
    const params = z.object({ clientId: uuid }).safeParse(request.params); if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    const [profile] = await db`SELECT client_id AS "clientId",legal_name AS "legalName",tax_id AS "taxId",billing_address AS "billingAddress",postal_code AS "postalCode",locality,province,country_code AS "countryCode",updated_at AS "updatedAt" FROM client_fiscal_profiles WHERE client_id=${params.data.clientId}`;
    return profile ?? reply.code(404).send({ error: 'fiscal_profile_not_found' });
  });
  app.put('/api/clients/:clientId/fiscal-profile', async (request, reply) => {
    reply.header('Cache-Control','no-store');
    const context = await auth(request, reply, 'billing.write-tax'); if (!context) return;
    const params = z.object({ clientId: uuid }).safeParse(request.params);
    const body = z.object({ legalName: z.string().trim().min(1).max(160), taxId, billingAddress: z.string().trim().max(240).nullable().optional(), postalCode: z.string().trim().max(20).nullable().optional(), locality: z.string().trim().max(100).nullable().optional(), province: z.string().trim().max(100).nullable().optional(), countryCode: z.string().regex(/^[A-Z]{2}$/).default('ES') }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error', message: body.success ? undefined : body.error.issues[0]?.message });
    try {
      const result = await db.begin(async tx => {
        const [profile] = await tx`INSERT INTO client_fiscal_profiles(client_id,legal_name,tax_id,billing_address,postal_code,locality,province,country_code,updated_by) VALUES (${params.data.clientId},${body.data.legalName},${body.data.taxId ?? null},${body.data.billingAddress ?? null},${body.data.postalCode ?? null},${body.data.locality ?? null},${body.data.province ?? null},${body.data.countryCode},${context.actorId}) ON CONFLICT(client_id) DO UPDATE SET legal_name=EXCLUDED.legal_name,tax_id=EXCLUDED.tax_id,billing_address=EXCLUDED.billing_address,postal_code=EXCLUDED.postal_code,locality=EXCLUDED.locality,province=EXCLUDED.province,country_code=EXCLUDED.country_code,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING client_id AS "clientId",legal_name AS "legalName",tax_id AS "taxId",country_code AS "countryCode",updated_at AS "updatedAt"`;
        if (!profile) return null;
        await audit(tx, context, 'client_fiscal_profile.updated', 'fiscal_profile', params.data.clientId, params.data.clientId, { taxIdFormatValidated: Boolean(body.data.taxId), identityVerified: false });
        return profile;
      });
      return result ?? reply.code(404).send({ error: 'client_not_found' });
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      return reply.code(code === '23503' ? 404 : 500).send({ error: code === '23503' ? 'client_not_found' : 'fiscal_profile_update_failed' });
    }
  });
  app.post('/api/economics/invoice-series', async (request, reply) => {
    const context = await auth(request, reply, 'billing.invoices.manage'); if (!context) return;
    const body = z.object({ name: z.string().trim().min(1).max(80), prefix: z.string().trim().min(1).max(20) }).strict().safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'validation_error' });
    try {
      const [row] = await db`INSERT INTO economic_invoice_series(name,prefix) VALUES (${body.data.name},${body.data.prefix}) RETURNING id,name,prefix,active`;
      if (!row) throw new Error('invoice series insert returned no row');
      await audit(db, context, 'invoice.series_created', 'invoice_series', row.id, null, { name: row.name });
      return reply.code(201).send(row);
    } catch { return reply.code(409).send({ error: 'invoice_series_conflict' }); }
  });
  app.post('/api/economics/invoice-drafts', async (request, reply) => {
    reply.header('Cache-Control','no-store');
    const context = await auth(request, reply, 'billing.invoices.manage'); if (!context) return;
    const key = uuid.safeParse(request.headers['idempotency-key']); if (!key.success) return reply.code(400).send({ error: 'idempotency_key_required' });
    const lineSchema = z.object({ description:z.string().trim().min(1).max(240), netCents:z.number().int().min(0).max(100_000_000_000), taxTreatment:z.enum(['taxable','exempt','non_subject']), taxBasisPoints:z.number().int().min(0).max(10_000).optional(), taxDescription:z.string().trim().min(3).max(160).optional() }).strict();
    const body = z.object({ clientId: uuid, seriesId: uuid, concept: z.string().trim().min(1).max(240).optional(), netCents: z.number().int().min(0).max(100_000_000_000).optional(), taxTreatment: z.enum(['taxable','exempt','non_subject']).optional(), taxBasisPoints: z.number().int().min(0).max(10_000).optional(), taxDescription: z.string().trim().min(3).max(160).optional(), lines:z.array(lineSchema).min(1).max(100).optional(), documentType: z.enum(['simplified_ticket','full_invoice']).default('simplified_ticket'), sourceChargeId: uuid }).strict().superRefine((value, issue) => {
      if (!value.lines && (!value.concept || value.netCents===undefined || value.taxTreatment===undefined)) issue.addIssue({ code:'custom', path:['lines'], message:'Indica las líneas del documento o una línea simple completa.' });
      for (const [index,line] of (value.lines??[]).entries()) {
        if (line.taxTreatment==='taxable' && line.taxBasisPoints===undefined) issue.addIssue({ code:'custom', path:['lines',index,'taxBasisPoints'], message:'Indica el tipo IGIC aplicable a esta línea.' });
        if (line.taxTreatment!=='taxable' && !line.taxDescription) issue.addIssue({ code:'custom', path:['lines',index,'taxDescription'], message:'Explica el tratamiento fiscal pendiente de revisión.' });
      }
      if (!value.lines && value.taxTreatment==='taxable' && value.taxBasisPoints===undefined) issue.addIssue({ code:'custom', path:['taxBasisPoints'], message:'Indica el tipo IGIC de la línea.' });
      if (!value.lines && value.taxTreatment!=='taxable' && !value.taxDescription) issue.addIssue({ code:'custom', path:['taxDescription'], message:'Explica el tratamiento fiscal pendiente de revisión.' });
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'validation_error' });
    const data = body.data; const normalizedLines = data.lines ?? [{ description:data.concept!, netCents:data.netCents!, taxTreatment:data.taxTreatment!, taxBasisPoints:data.taxBasisPoints, taxDescription:data.taxDescription }];
    const lines = normalizedLines.map(line=>({description:line.description,netCents:line.netCents,taxTreatment:line.taxTreatment,taxRateBasisPoints:line.taxTreatment==='taxable'?line.taxBasisPoints:null,taxCents:line.taxTreatment==='taxable'?Math.round(line.netCents*(line.taxBasisPoints??0)/10_000):0,taxDescription:line.taxDescription??null}));
    const netCents=lines.reduce((sum,line)=>sum+line.netCents,0);const taxCents=lines.reduce((sum,line)=>sum+line.taxCents,0);const treatments=[...new Set(lines.map(line=>line.taxTreatment))];const overallTreatment=treatments.length>1?'mixed':treatments[0]!;const concept=data.concept??lines.map(line=>line.description).join(' · ').slice(0,240);const requestHash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    try {
      const result = await db.begin(async tx => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key.data},0))`;
        const [existing] = await tx`SELECT id,request_hash AS "requestHash" FROM economic_invoice_drafts WHERE idempotency_key=${key.data}`;
        if (existing) return existing.requestHash.trim() === requestHash ? { id: existing.id, replay: true as const } : { error:'idempotency_conflict' as const };
        const [charge] = await tx`SELECT id,client_id AS "clientId",amount_cents AS "amountCents" FROM economic_charges WHERE id=${data.sourceChargeId}`;
        if (!charge || charge.clientId !== data.clientId) return { error:'source_charge_not_found' as const };
        const paymentMethods = await tx`SELECT s.method,COALESCE(sum(s.amount_cents),0)::bigint AS "amountCents" FROM economic_transactions t JOIN economic_payment_splits s ON s.transaction_id=t.id WHERE t.charge_id=${charge.id} AND t.kind='payment' GROUP BY s.method ORDER BY s.method`;
        if (!paymentMethods.length) return { error:'payment_required' as const };
        const [profile] = await tx`SELECT legal_name AS "legalName",tax_id AS "taxId",billing_address AS "billingAddress",postal_code AS "postalCode",locality,province,country_code AS "countryCode" FROM client_fiscal_profiles WHERE client_id=${data.clientId}`;
        const [series] = await tx`SELECT id,name FROM economic_invoice_series WHERE id=${data.seriesId} AND active=true`;
        if (!series) return { error:'series_not_found' as const };
        if (data.documentType === 'full_invoice' && (!profile?.taxId || !profile.billingAddress || !profile.postalCode || !profile.locality || !profile.province || !profile.countryCode)) return { error:'complete_fiscal_profile_required' as const };
        if (netCents + taxCents !== Number(charge.amountCents)) return { error:'document_total_mismatch' as const };
        const id = randomUUID();
        const auditTreatment=overallTreatment;
        await tx`INSERT INTO economic_invoice_drafts(id,client_id,series_id,series_name,invoice_number,concept,net_cents,tax_basis_points,tax_cents,gross_cents,tax_description,fiscal_snapshot,created_by,idempotency_key,request_hash,document_type,source_charge_id,line_items,tax_treatment,tax_rate_basis_points,payment_methods) VALUES (${id},${data.clientId},${series.id},NULL,NULL,${concept},${netCents},${data.taxBasisPoints??lines.find(line=>line.taxTreatment==='taxable')?.taxRateBasisPoints??0},${taxCents},${netCents+taxCents},${data.taxDescription??null},${JSON.stringify(profile??{})}::jsonb,${context.actorId},${key.data},${requestHash},${data.documentType},${data.sourceChargeId},${JSON.stringify(lines)}::jsonb,${overallTreatment},${overallTreatment==='taxable'?data.taxBasisPoints??lines[0]?.taxRateBasisPoints??0:null},${JSON.stringify(paymentMethods)}::jsonb)`;
        await audit(tx, context, 'invoice.draft_created', 'invoice_draft', id, data.clientId, { documentType:data.documentType, sourceChargeId:data.sourceChargeId, netCents, taxTreatment:auditTreatment, officialNumberAssigned:false });
        return { id, replay:false as const };
      });
      if ('error' in result) return reply.code(result.error === 'series_not_found' || result.error === 'source_charge_not_found' ? 404 : result.error === 'idempotency_conflict' || result.error === 'payment_required' ? 409 : 422).send({ error:result.error });
      return reply.code(result.replay ? 200 : 201).send({ id:result.id, status:'draft', officialNumber:null, officiallyIssued:false });
    } catch { return reply.code(500).send({ error:'invoice_draft_failed' }); }
  });
  app.get('/api/economics/document-policy',async(request,reply)=>{
    if(!await auth(request,reply,'billing.read-tax'))return;
    const [policy]=await db`SELECT retention_months AS "retentionMonths",updated_by AS "updatedBy",updated_at AS "updatedAt" FROM economic_document_policy WHERE singleton=true`;
    return policy??reply.code(500).send({error:'document_policy_missing'});
  });
  app.put('/api/economics/document-policy',async(request,reply)=>{
    const context=await auth(request,reply,'billing.invoices.manage');if(!context)return;
    const body=z.object({retentionMonths:z.number().int().min(1).max(1200).nullable()}).strict().safeParse(request.body);
    if(!body.success)return reply.code(400).send({error:'validation_error'});
    try{return await db.begin(async tx=>{const [policy]=await tx`UPDATE economic_document_policy SET retention_months=${body.data.retentionMonths},updated_by=${context.actorId},updated_at=now() WHERE singleton=true RETURNING retention_months AS "retentionMonths",updated_at AS "updatedAt"`;if(!policy)return reply.code(500).send({error:'document_policy_missing'});const [auditId]=await tx`SELECT gen_random_uuid() AS id`;await audit(tx,context,'document.retention_policy.updated','document_policy',auditId!.id,null,{retentionMonths:body.data.retentionMonths,automaticDeletion:false});return policy;});}catch{return reply.code(500).send({error:'document_policy_update_failed'});}
  });
}
