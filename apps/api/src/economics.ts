import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';
import { activateSettledEntitlementPeriods } from './assignment-periods.js';

type DB = ReturnType<typeof createDatabase>['client'];
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const methods = ['cash','card','transfer','direct_debit','other'] as const;
const money = z.number().int().min(1).max(100_000_000_000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value);
const chargeInput = z.object({ clientId:uuid, planId:uuid.nullable().optional(), concept:z.string().trim().min(1).max(160), amountCents:money, dueOn:date, exemptReason:z.string().trim().min(3).max(240).optional() }).strict();
const paymentInput = z.object({ chargeId:uuid, splits:z.array(z.object({method:z.enum(methods),amountCents:money}).strict()).min(1).max(5), note:z.string().trim().max(240).nullable().optional() }).strict();
const hash = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dbCode = (error:unknown) => typeof error==='object' && error && 'code' in error ? String(error.code) : '';

export function registerEconomicRoutes(app:FastifyInstance<any,any,any,any,any>,db:DB,resolve:(request:FastifyRequest)=>Promise<AuthorizationContext|null>) {
  async function auth(request:FastifyRequest,reply:any,permission:string) {
    const context=await resolve(request);
    if(!context){reply.code(401).send({error:'authentication_required'});return null;}
    if(!can(context,permission)){reply.code(403).send({error:'permission_denied'});return null;}
    return context;
  }
  async function audit(tx:any,actor:string,action:string,type:string,id:string,clientId:string|null,details:Record<string,unknown>={}) {
    await tx`INSERT INTO economic_audit_events(actor_id,action,resource_type,resource_id,client_id,details) VALUES (${actor},${action},${type},${id},${clientId},${JSON.stringify(details)}::jsonb)`;
  }
  const error=(reply:any,error:unknown)=>{const code=dbCode(error);app.log.error({databaseCode:code,route:'economic_api'},'economic operation failed');if(code==='23505')return reply.code(409).send({error:'conflict'});if(code==='23503')return reply.code(409).send({error:'reference_conflict'});if(code==='55000')return reply.code(409).send({error:'economic_history_immutable'});if(['23514','22003','22P02'].includes(code))return reply.code(422).send({error:'validation_error'});return reply.code(500).send({error:'internal_error'});};

  app.get('/api/economics/overview',async(request,reply)=>{
    reply.header('Cache-Control','no-store');const context=await auth(request,reply,'billing.read-basic');if(!context)return;
    try {
      const [overview]=await db`SELECT count(*) FILTER(WHERE c.state='pending' AND NOT (COALESCE(x.paid,0)>0 AND COALESCE(x.net,0)=0) AND c.due_on<(now() AT TIME ZONE 'Atlantic/Canary')::date AND c.amount_cents>COALESCE(x.net,0))::int AS "overdueCount",COALESCE(sum(c.amount_cents-COALESCE(x.net,0)) FILTER(WHERE c.state='pending' AND NOT (COALESCE(x.paid,0)>0 AND COALESCE(x.net,0)=0) AND c.due_on<(now() AT TIME ZONE 'Atlantic/Canary')::date),0)::bigint AS "overdueCents",count(*) FILTER(WHERE c.state='pending' AND NOT (COALESCE(x.paid,0)>0 AND COALESCE(x.net,0)=0))::int AS "chargeCount" FROM economic_charges c LEFT JOIN LATERAL(SELECT sum(amount_cents) FILTER(WHERE kind='payment') paid,sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END) net FROM economic_transactions WHERE charge_id=c.id)x ON true`;
      const [cashSession]=await db`SELECT id,local_date AS "localDate",opening_cents AS "openingCents",status FROM economic_cash_sessions WHERE local_date=(now() AT TIME ZONE 'Atlantic/Canary')::date`;
      return {currency:'EUR',timezone:'Atlantic/Canary',...overview,cashSession:cashSession??null,capabilities:{payments:can(context,'billing.payments.manage'),cash:can(context,'billing.cash.manage'),ownerPanelRead:can(context,'owner.panel.read'),invoices:can(context,'billing.invoices.manage'),tax:can(context,'billing.read-tax'),writeTax:can(context,'billing.write-tax'),validateTransfers:can(context,'billing.validate_transfer')}};
    } catch(e){return error(reply,e);}
  });

  app.get('/api/economics/charges',async(request,reply)=>{
    reply.header('Cache-Control','no-store');if(!await auth(request,reply,'billing.read-basic'))return;
    const query=z.object({clientId:uuid.optional(),limit:z.coerce.number().int().min(1).max(100).default(25),offset:z.coerce.number().int().min(0).max(100000).default(0),status:z.enum(['all','due','paid']).default('all'),q:z.string().trim().max(100).default('')}).strict().safeParse(request.query);
    if(!query.success)return reply.code(400).send({error:'validation_error'});
    const q=query.data.q.normalize('NFKC').toLocaleLowerCase('es');
    try {
      const items=await db`WITH charges AS (
        SELECT c.id,c.client_id AS "clientId",cl.first_name AS "firstName",cl.last_name AS "lastName",c.concept,c.amount_cents AS "amountCents",c.due_on AS "dueOn",c.state,c.created_at AS "createdAt",COALESCE(x.paid,0)::bigint AS "paidCents",CASE WHEN COALESCE(x.paid,0)>0 AND COALESCE(x.net,0)=0 THEN 0 ELSE (c.amount_cents-COALESCE(x.net,0)) END::bigint AS "balanceCents",
          CASE WHEN c.state='void' THEN 'void' WHEN c.state='exempt' THEN 'exempt' WHEN COALESCE(x.paid,0)>0 AND COALESCE(x.net,0)=0 THEN 'refunded' WHEN COALESCE(x.net,0)>=c.amount_cents THEN 'paid' WHEN c.due_on<(now() AT TIME ZONE 'Atlantic/Canary')::date THEN 'unpaid' ELSE 'pending' END AS status
        FROM economic_charges c JOIN clients cl ON cl.id=c.client_id LEFT JOIN LATERAL(SELECT sum(amount_cents) FILTER(WHERE kind='payment') paid,sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END) net FROM economic_transactions WHERE charge_id=c.id)x ON true
        WHERE (${query.data.clientId??null}::uuid IS NULL OR c.client_id=${query.data.clientId??null}::uuid)
          AND (${q}='' OR strpos(lower(concat_ws(' ',cl.first_name,cl.last_name,c.concept)),${q})>0)
      ) SELECT * FROM charges WHERE (${query.data.status}='all' OR (${query.data.status}='paid' AND status='paid') OR (${query.data.status}='due' AND status IN ('pending','unpaid'))) ORDER BY "dueOn" DESC,"createdAt" DESC,id LIMIT ${query.data.limit} OFFSET ${query.data.offset}`;
      const [count]=await db`SELECT count(*)::int AS total FROM economic_charges c JOIN clients cl ON cl.id=c.client_id LEFT JOIN LATERAL(SELECT sum(amount_cents) FILTER(WHERE kind='payment') paid,sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END) net FROM economic_transactions WHERE charge_id=c.id)x ON true WHERE (${query.data.clientId??null}::uuid IS NULL OR c.client_id=${query.data.clientId??null}::uuid) AND (${q}='' OR strpos(lower(concat_ws(' ',cl.first_name,cl.last_name,c.concept)),${q})>0) AND (${query.data.status}='all' OR (${query.data.status}='paid' AND c.state='pending' AND COALESCE(x.net,0)>=c.amount_cents) OR (${query.data.status}='due' AND c.state='pending' AND NOT (COALESCE(x.paid,0)>0 AND COALESCE(x.net,0)=0) AND COALESCE(x.net,0)<c.amount_cents))`;
      return {items,total:count?.total??0,limit:query.data.limit,offset:query.data.offset,hasMore:query.data.offset+items.length<Number(count?.total??0),currency:'EUR'};
    } catch(e){return error(reply,e);}
  });

  app.get('/api/economics/export',async(request,reply)=>{
    reply.header('Cache-Control','no-store');if(!await auth(request,reply,'billing.export'))return;
    const query=z.object({limit:z.coerce.number().int().min(1).max(1000).default(500),offset:z.coerce.number().int().min(0).max(100000).default(0)}).strict().safeParse(request.query);
    if(!query.success)return reply.code(400).send({error:'validation_error'});
    const items=await db`SELECT c.id,c.client_id AS "clientId",cl.first_name AS "firstName",cl.last_name AS "lastName",c.concept,c.amount_cents AS "amountCents",c.due_on AS "dueOn",c.state,c.void_reason AS "voidReason",COALESCE(x.net,0)::bigint AS "netPaidCents",CASE WHEN COALESCE(x.paid,0)>0 AND COALESCE(x.net,0)=0 THEN 0 ELSE (c.amount_cents-COALESCE(x.net,0)) END::bigint AS "balanceCents",CASE WHEN c.state='void' THEN 'void' WHEN c.state='exempt' THEN 'exempt' WHEN COALESCE(x.paid,0)>0 AND COALESCE(x.net,0)=0 THEN 'refunded' WHEN COALESCE(x.net,0)>=c.amount_cents THEN 'paid' WHEN c.due_on<(now() AT TIME ZONE 'Atlantic/Canary')::date THEN 'unpaid' ELSE 'pending' END AS status FROM economic_charges c JOIN clients cl ON cl.id=c.client_id LEFT JOIN LATERAL(SELECT sum(amount_cents) FILTER(WHERE kind='payment') paid,sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END) net FROM economic_transactions WHERE charge_id=c.id)x ON true ORDER BY c.created_at,c.id LIMIT ${query.data.limit} OFFSET ${query.data.offset}`;
    return{items,limit:query.data.limit,offset:query.data.offset,currency:'EUR',timezone:'Atlantic/Canary'};
  });
  app.get('/api/economics/fiscal-export',async(request,reply)=>{
    reply.header('Cache-Control','no-store');if(!await auth(request,reply,'billing.read-tax'))return;if(!await auth(request,reply,'billing.export'))return;
    const documents=await db`SELECT id,document_type AS "documentType",status,series_name AS "seriesName",document_number AS "documentNumber",document_date AS "documentDate",client_snapshot AS "client",issuer_snapshot AS "issuer",lines_snapshot AS lines,payment_methods AS "paymentMethods",totals_snapshot AS totals,issued_at AS "issuedAt" FROM economic_fiscal_documents ORDER BY issued_at,id`;
    const profiles=await db`SELECT client_id AS "clientId",legal_name AS "legalName",tax_id AS "taxId",billing_address AS "billingAddress",postal_code AS "postalCode",locality,province,country_code AS "countryCode",updated_at AS "updatedAt" FROM client_fiscal_profiles ORDER BY client_id`;
    return{documents,profiles};
  });

  app.post('/api/economics/charges',async(request,reply)=>{
    reply.header('Cache-Control','no-store');const context=await auth(request,reply,'billing.payments.manage');if(!context)return;
    const key=uuid.safeParse(request.headers['idempotency-key']);if(!key.success)return reply.code(400).send({error:'idempotency_key_required'});
    const parsed=chargeInput.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:'validation_error',details:parsed.error.flatten()});
    const data=parsed.data,requestHash=hash(data),id=randomUUID();
    try {
      const result=await db.begin(async tx=>{
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key.data},0))`;
        const [prior]=await tx`SELECT id,request_hash AS "requestHash" FROM economic_charges WHERE idempotency_key=${key.data}`;
        if(prior)return prior.requestHash.trim()===requestHash?{id:prior.id,replay:true as const}:{error:'idempotency_conflict' as const};
        const [client]=await tx`SELECT id,status FROM clients WHERE id=${data.clientId} FOR SHARE`;
        if(!client||client.status!=='active')return{error:'client_unavailable' as const};
        if(data.planId){const [plan]=await tx`SELECT id FROM plans WHERE id=${data.planId}`;if(!plan)return{error:'plan_not_found' as const};}
        const state=data.exemptReason?'exempt':'pending';
        await tx`INSERT INTO economic_charges(id,client_id,plan_id,concept,amount_cents,due_on,state,exempt_reason,created_by,idempotency_key,request_hash) VALUES (${id},${data.clientId},${data.planId??null},${data.concept},${data.amountCents},${data.dueOn},${state},${data.exemptReason??null},${context.actorId},${key.data},${requestHash})`;
        await audit(tx,context.actorId,state==='exempt'?'charge.exempted':'charge.created','charge',id,data.clientId,{amountCents:data.amountCents});return{id,replay:false as const};
      });
      if('error'in result)return reply.code(result.error==='plan_not_found'?404:result.error==='idempotency_conflict'?409:404).send({error:result.error});
      return reply.code(result.replay?200:201).send({id:result.id});
    }catch(e){return error(reply,e);}
  });

  app.post('/api/economics/payments',async(request,reply)=>{
    reply.header('Cache-Control','no-store');const context=await auth(request,reply,'billing.payments.manage');if(!context)return;
    const key=uuid.safeParse(request.headers['idempotency-key']);if(!key.success)return reply.code(400).send({error:'idempotency_key_required'});
    const parsed=paymentInput.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:'validation_error',details:parsed.error.flatten()});
    if(new Set(parsed.data.splits.map(split=>split.method)).size!==parsed.data.splits.length)return reply.code(400).send({error:'duplicate_method'});
    const total=parsed.data.splits.reduce((sum,split)=>sum+split.amountCents,0);if(!Number.isSafeInteger(total))return reply.code(400).send({error:'invalid_amount'});
    const data=parsed.data,requestHash=hash({...data,splits:[...data.splits].sort((a,b)=>a.method<b.method?-1:a.method>b.method?1:0)}),id=randomUUID();
    try {
      const result=await db.begin(async tx=>{
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key.data},0))`;
        const [prior]=await tx`SELECT id,request_hash AS "requestHash" FROM economic_transactions WHERE idempotency_key=${key.data}`;
        if(prior)return prior.requestHash.trim()===requestHash?{id:prior.id,replay:true as const}:{error:'idempotency_conflict' as const};
        const [charge]=await tx`SELECT id,client_id AS "clientId",amount_cents AS "amountCents",state FROM economic_charges WHERE id=${data.chargeId} FOR UPDATE`;
        if(!charge)return{error:'charge_not_found' as const};if(charge.state!=='pending')return{error:'charge_closed' as const};
        const [balance]=await tx`SELECT COALESCE(sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END),0)::bigint cents,COALESCE(sum(amount_cents) FILTER(WHERE kind='payment'),0)::bigint AS paid_cents FROM economic_transactions WHERE charge_id=${charge.id}`;
        if(Number(balance?.paid_cents??0)>0&&Number(balance?.cents??0)===0)return{error:'charge_refunded' as const};
        if(total+Number(balance?.cents??0)>Number(charge.amountCents))return{error:'amount_exceeds_balance' as const};
        const [cash]=await tx`SELECT id FROM economic_cash_sessions WHERE status='open' ORDER BY opened_at LIMIT 1 FOR UPDATE`;
        if(!cash)return{error:'cash_session_required' as const};
        await tx`INSERT INTO economic_transactions(id,charge_id,client_id,kind,amount_cents,note,actor_id,idempotency_key,request_hash,cash_session_id) VALUES (${id},${charge.id},${charge.clientId},'payment',${total},${data.note??null},${context.actorId},${key.data},${requestHash},${cash.id})`;
        for(const split of data.splits)await tx`INSERT INTO economic_payment_splits(transaction_id,method,amount_cents) VALUES (${id},${split.method},${split.amountCents})`;
        await audit(tx,context.actorId,'payment.recorded','transaction',id,charge.clientId,{amountCents:total,methods:data.splits.map(split=>split.method),cashSessionId:cash.id});
        await activateSettledEntitlementPeriods(tx,charge.id,context.actorId);
        return{id,replay:false as const};
      });
      if('error'in result)return reply.code(result.error==='charge_not_found'?404:409).send({error:result.error});
      return reply.code(result.replay?200:201).send({id:result.id});
    }catch(e){return error(reply,e);}
  });

  app.post('/api/economics/refunds',async(request,reply)=>{
    const context=await auth(request,reply,'billing.payments.manage');if(!context)return;
    const key=uuid.safeParse(request.headers['idempotency-key']);if(!key.success)return reply.code(400).send({error:'idempotency_key_required'});
    const parsed=z.object({transactionId:uuid,amountCents:money,method:z.enum(methods),note:z.string().trim().min(3).max(240)}).strict().safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:'validation_error'});
    const data=parsed.data,requestHash=hash(data),id=randomUUID();
    try {
      const result=await db.begin(async tx=>{
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key.data},0))`;
        const [prior]=await tx`SELECT id,request_hash AS "requestHash" FROM economic_transactions WHERE idempotency_key=${key.data}`;
        if(prior)return prior.requestHash.trim()===requestHash?{id:prior.id,replay:true as const}:{error:'idempotency_conflict' as const};
        const [payment]=await tx`SELECT id,charge_id AS "chargeId",client_id AS "clientId",amount_cents AS "amountCents",kind FROM economic_transactions WHERE id=${data.transactionId} FOR UPDATE`;
        if(!payment||payment.kind!=='payment')return{error:'payment_not_found' as const};
        await tx`SELECT id FROM economic_charges WHERE id=${payment.chargeId} FOR UPDATE`;
        const [refunded]=await tx`SELECT COALESCE(sum(amount_cents),0)::bigint cents FROM economic_transactions WHERE refund_of=${payment.id}`;
        if(data.amountCents+Number(refunded?.cents??0)>Number(payment.amountCents))return{error:'refund_exceeds_payment' as const};
        const [cash]=await tx`SELECT id FROM economic_cash_sessions WHERE status='open' ORDER BY opened_at LIMIT 1 FOR UPDATE`;
        if(!cash)return{error:'cash_session_required' as const};
        await tx`INSERT INTO economic_transactions(id,charge_id,client_id,kind,amount_cents,refund_of,note,actor_id,idempotency_key,request_hash,cash_session_id) VALUES (${id},${payment.chargeId},${payment.clientId},'refund',${data.amountCents},${payment.id},${data.note},${context.actorId},${key.data},${requestHash},${cash.id})`;
        await tx`INSERT INTO economic_payment_splits(transaction_id,method,amount_cents) VALUES (${id},${data.method},${data.amountCents})`;
        await audit(tx,context.actorId,'payment.refunded','transaction',id,payment.clientId,{amountCents:data.amountCents,reverses:payment.id,method:data.method,cashSessionId:cash.id});
        return{id,replay:false as const};
      });
      if('error'in result)return reply.code(result.error==='payment_not_found'?404:409).send({error:result.error});
      return reply.code(result.replay?200:201).send({id:result.id});
    }catch(e){return error(reply,e);}
  });

  app.get('/api/clients/:clientId/economics',async(request,reply)=>{
    reply.header('Cache-Control','no-store');if(!await auth(request,reply,'billing.read-basic'))return;
    const params=z.object({clientId:uuid}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:'invalid_client_id'});
    try {
      const items=await db`SELECT c.id,c.concept,c.amount_cents AS "amountCents",c.due_on AS "dueOn",c.state,c.void_reason AS "voidReason",COALESCE(x.paid,0)::bigint AS "paidCents",CASE WHEN COALESCE(x.paid,0)>0 AND COALESCE(x.net,0)=0 THEN 0 ELSE (c.amount_cents-COALESCE(x.net,0)) END::bigint AS "balanceCents",CASE WHEN c.state='void' THEN 'void' WHEN c.state='exempt' THEN 'exempt' WHEN COALESCE(x.paid,0)>0 AND COALESCE(x.net,0)=0 THEN 'refunded' WHEN COALESCE(x.net,0)>=c.amount_cents THEN 'paid' WHEN c.due_on<(now() AT TIME ZONE 'Atlantic/Canary')::date THEN 'unpaid' ELSE 'pending' END AS status FROM economic_charges c LEFT JOIN LATERAL(SELECT sum(amount_cents) FILTER(WHERE kind='payment') paid,sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END) net FROM economic_transactions WHERE charge_id=c.id)x ON true WHERE c.client_id=${params.data.clientId} ORDER BY c.due_on DESC,c.created_at DESC,c.id DESC LIMIT 100`;
      const movements=await db`SELECT t.id,t.charge_id AS "chargeId",c.concept,t.kind,t.amount_cents AS "amountCents",t.note,t.actor_id AS "actorId",t.created_at AS "createdAt",t.cash_session_id AS "cashSessionId",COALESCE(jsonb_agg(jsonb_build_object('method',s.method,'amountCents',s.amount_cents)) FILTER(WHERE s.transaction_id IS NOT NULL),'[]'::jsonb) AS splits FROM economic_transactions t JOIN economic_charges c ON c.id=t.charge_id LEFT JOIN economic_payment_splits s ON s.transaction_id=t.id WHERE t.client_id=${params.data.clientId} GROUP BY t.id,c.concept ORDER BY t.created_at DESC,t.id DESC LIMIT 100`;
      const [summary]=await db`SELECT COALESCE(sum(c.amount_cents-COALESCE(x.net,0)) FILTER(WHERE c.state='pending' AND NOT (COALESCE(x.paid,0)>0 AND COALESCE(x.net,0)=0)),0)::bigint AS "balanceCents",count(*) FILTER(WHERE c.state='pending' AND NOT (COALESCE(x.paid,0)>0 AND COALESCE(x.net,0)=0) AND c.due_on<(now() AT TIME ZONE 'Atlantic/Canary')::date AND c.amount_cents>COALESCE(x.net,0))::int AS "overdueCount" FROM economic_charges c LEFT JOIN LATERAL(SELECT sum(amount_cents) FILTER(WHERE kind='payment') paid,sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END) net FROM economic_transactions WHERE charge_id=c.id)x ON true WHERE c.client_id=${params.data.clientId}`;
      return{items,movements,...summary,currency:'EUR'};
    }catch(e){return error(reply,e);}
  });

  app.get('/api/economics/settings',async(request,reply)=>{if(!await auth(request,reply,'billing.read-basic'))return;const [row]=await db`SELECT due_day AS "dueDay",timezone,debt_blocks_new_reservations AS "debtBlocksNewReservations",fiscal_legal_gate_open AS "fiscalLegalGateOpen",document_retention_months AS "documentRetentionMonths" FROM economic_settings WHERE singleton=true`;return row;});
  app.patch('/api/economics/settings',async(request,reply)=>{
    const context=await auth(request,reply,'billing.invoices.manage');if(!context)return;
    const parsed=z.object({dueDay:z.number().int().min(1).max(28),debtBlocksNewReservations:z.boolean().optional()}).strict().safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:'validation_error'});
    try{return await db.begin(async tx=>{const [row]=await tx`UPDATE economic_settings SET due_day=${parsed.data.dueDay},debt_blocks_new_reservations=COALESCE(${parsed.data.debtBlocksNewReservations??null},debt_blocks_new_reservations),updated_at=now(),updated_by=${context.actorId} WHERE singleton=true RETURNING due_day AS "dueDay",timezone,debt_blocks_new_reservations AS "debtBlocksNewReservations"`;if(!row)return reply.code(500).send({error:'settings_missing'});const [id]=await tx`SELECT gen_random_uuid() AS id`;await audit(tx,context.actorId,'settings.updated','settings',id!.id,null,parsed.data);return row;});}catch(e){return error(reply,e);}
  });
}
