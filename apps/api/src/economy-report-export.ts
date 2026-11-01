import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';
import { buildXlsx } from './xlsx.js';
import { buildEconomySummaryPdf } from './reports-pdf.js';

type DB = ReturnType<typeof createDatabase>['client'];
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value);
const sections = ['sales','payments','pending','defaults','cash','expenses','igic','staffHours'] as const;
type Section = typeof sections[number];
const custodyNotice = 'La custodia real no puede reconstruirse hasta registrar los traspasos A39–A44.';
const methodLabel: Record<string,string> = { cash:'Efectivo',card:'Tarjeta',transfer:'Transferencia',bizum:'Bizum',direct_debit:'Domiciliación',other:'Otro' };
const statusLabel: Record<string,string> = { paid:'Cobrada',partial:'Cobro parcial',pending:'Pendiente',unpaid:'Vencida',refunded:'Devuelta',void:'Anulada',exempt:'Exenta' };
const kindLabel: Record<string,string> = { plan:'Cuota',charge:'Cargo',store:'Tienda' };
const euro = (cents:number) => Math.round(cents)/100;
const isDateTime = (value:unknown) => value == null ? null : new Date(value as string|Date).toISOString();

async function custodyIsIncomplete(db:DB,context:AuthorizationContext,from:string,to:string,owner:boolean) {
  const [row]=await db`SELECT count(*) FILTER(WHERE COALESCE(c.handover_count,0)<>COALESCE(h.handover_count,0))::int AS incomplete FROM economic_cash_sessions s
    LEFT JOIN LATERAL(SELECT count(*) FILTER(WHERE ended_reason='handover')::int AS handover_count FROM economic_cash_custodies WHERE cash_session_id=s.id)c ON true
    LEFT JOIN LATERAL(SELECT count(*) FILTER(WHERE completed_at IS NOT NULL)::int AS handover_count FROM economic_cash_handovers WHERE cash_session_id=s.id)h ON true
    WHERE s.local_date BETWEEN ${from}::date AND ${to}::date AND (${owner}::boolean OR EXISTS(SELECT 1 FROM economic_cash_custodies own WHERE own.cash_session_id=s.id AND own.actor_id=${context.actorId}))`;
  return Number(row?.incomplete??0)>0;
}

type SaleQuery = { from:string; to:string; kind:'all'; invoice:'all'; limit:number };
type SaleLoader = (query:SaleQuery) => Promise<{items:Array<any>;truncated:boolean}>;
type SummaryLoader = (from:string,to:string) => Promise<any>;

/** Detailed export is deliberately wired to the same sales and KPI loaders as the Reports screen. */
export function registerDetailedReportRoutes(app:FastifyInstance<any,any,any,any,any>,db:DB,resolve:(request:FastifyRequest)=>Promise<AuthorizationContext|null>,loadSales:SaleLoader,loadSummary:SummaryLoader) {
  async function authorize(request:FastifyRequest,reply:any) {
    reply.header('Cache-Control','private, no-store');
    const context=await resolve(request);
    if(!context){reply.code(401).send({error:'authentication_required'});return null;}
    if(!can(context,'economy.read')){reply.code(403).send({error:'permission_denied'});return null;}
    return context;
  }
  const commonQuery=z.object({from:date,to:date}).strict().refine(value=>value.to>=value.from,{message:'range_inverted'}).refine(value=>Date.parse(`${value.to}T00:00:00Z`)-Date.parse(`${value.from}T00:00:00Z`)<=366*86_400_000,{message:'range_too_long'});
  const workbookQuery=commonQuery.extend({sections:z.string().optional()}).strict();
  const selected=(input:string|undefined):Section[]|null=>{
    if(!input)return [...sections];
    const values=input.split(',').map(value=>value.trim()).filter(Boolean);
    if(!values.length||values.some(value=>!sections.includes(value as Section)))return null;
    return [...new Set(values as Section[])];
  };
  const dateText=(iso:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Atlantic/Canary',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));

  async function makeSheets(context:AuthorizationContext,from:string,to:string,wanted:Section[]) {
    const [summary,sales]=await Promise.all([loadSummary(from,to),wanted.includes('sales')?loadSales({from,to,kind:'all',invoice:'all',limit:5_000}):Promise.resolve(null)]);
    if(sales?.truncated)return {error:'export_result_limit_exceeded',limit:5_000} as const;
    const collected=summary.monthly.reduce((sum:number,row:any)=>sum+row.collectedCents,0);
    const sold=summary.monthly.reduce((sum:number,row:any)=>sum+row.soldCents,0);
    const rows:any[]=[];
    const totals:any={name:'Totales',money:[1],rows:[['Indicador','Valor'],['Periodo',`${from} a ${to}`],['Generado',new Date().toISOString()],['Usuario',context.actorId],['Vendido (EUR)',euro(sold)],['Cobrado (EUR)',euro(collected)],['Pendiente (EUR)',euro(summary.pending.cents)],['Vencido sin cobrar a fecha de generación (EUR)',euro(summary.overdue.cents)],['Cargos vencidos',summary.overdue.count],['Cobros por método (EUR)',summary.collectedByMethod.reduce((sum:any,row:any)=>sum+row.cents,0)/100]]};
    rows.push(totals);
    if(wanted.includes('sales')&&sales)rows.push({name:'Ventas',money:[4,5,6],rows:[['Fecha','Cliente','Concepto','Tipo','Vendido (EUR)','Cobrado (EUR)','Pendiente (EUR)','Estado','Métodos','Factura'],...sales.items.map((item:any)=>[dateText(item.occurredAt),item.clientName,item.concept,kindLabel[item.kind]??item.kind,euro(item.soldCents),euro(item.collectedCents),euro(item.status==='void'||item.status==='exempt'?0:Math.max(0,item.soldCents-item.collectedCents)),statusLabel[item.status]??item.status,item.methods.map((method:string)=>methodLabel[method]??method).join(' + '),item.invoice==='issued'?'Con factura':'Sin factura'])]});
    if(wanted.includes('payments'))rows.push({name:'Cobros por método',money:[1],rows:[['Método','Cobrado (EUR)'],...summary.collectedByMethod.map((item:any)=>[methodLabel[item.method]??item.method,euro(item.cents)])]});
    if(wanted.includes('pending')){
      const pending=await db`SELECT c.due_on::text AS due_on,(cl.first_name||' '||cl.last_name) AS client,c.concept,c.amount_cents::bigint AS amount,
        GREATEST(c.amount_cents-COALESCE(x.net,0),0)::bigint AS balance,COALESCE(x.net,0)::bigint AS collected,
        CASE WHEN a.starts_on>(now() AT TIME ZONE 'Atlantic/Canary')::date THEN 'Programado' ELSE 'Pendiente' END AS schedule,
        CASE WHEN COALESCE(x.paid,0)>0 AND COALESCE(x.net,0)=0 THEN 'Devuelta' WHEN COALESCE(x.net,0)>=c.amount_cents THEN 'Cobrada' WHEN c.due_on<(now() AT TIME ZONE 'Atlantic/Canary')::date THEN 'Vencida' WHEN COALESCE(x.net,0)>0 THEN 'Cobro parcial' ELSE 'Pendiente' END AS status
        FROM economic_charges c JOIN clients cl ON cl.id=c.client_id LEFT JOIN client_plan_assignments a ON a.charge_id=c.id
        LEFT JOIN LATERAL(SELECT sum(amount_cents) FILTER(WHERE kind='payment') paid,sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END) net FROM economic_transactions WHERE charge_id=c.id)x ON true
        WHERE c.state='pending' AND c.due_on BETWEEN ${from}::date AND ${to}::date AND NOT(COALESCE(x.paid,0)>0 AND COALESCE(x.net,0)=0) AND COALESCE(x.net,0)<c.amount_cents ORDER BY c.due_on,cl.last_name,c.id LIMIT 5001`;
      if(pending.length>5000)return {error:'export_result_limit_exceeded',limit:5000} as const;
      rows.push({name:'Pendientes y programados',money:[3,4,5],rows:[['Vencimiento','Cliente','Concepto','Importe (EUR)','Cobrado (EUR)','Saldo (EUR)','Estado','Tipo'],...pending.map((item:any)=>[String(item.due_on).slice(0,10),item.client,item.concept,euro(Number(item.amount)),euro(Number(item.collected)),euro(Number(item.balance)),statusLabel[item.status]??item.status,item.schedule])]});
    }
    if(wanted.includes('defaults')){
      const list=await db`SELECT * FROM (SELECT c.created_at AS at,(cl.first_name||' '||cl.last_name) AS client,c.concept,c.amount_cents::bigint AS amount,c.state,c.due_on::text AS due_on,
        CASE WHEN COALESCE(x.paid,0)>0 AND COALESCE(x.net,0)=0 THEN 'refunded' WHEN COALESCE(x.net,0)>=c.amount_cents THEN 'paid' WHEN c.due_on<(now() AT TIME ZONE 'Atlantic/Canary')::date THEN 'unpaid' ELSE c.state END AS status,
        COALESCE(x.net,0)::bigint AS net
        FROM economic_charges c JOIN clients cl ON cl.id=c.client_id LEFT JOIN LATERAL(SELECT sum(amount_cents) FILTER(WHERE kind='payment') paid,sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END) net FROM economic_transactions WHERE charge_id=c.id)x ON true
        WHERE (c.created_at AT TIME ZONE 'Atlantic/Canary')::date BETWEEN ${from}::date AND ${to}::date AND (c.state='void' OR c.due_on<(now() AT TIME ZONE 'Atlantic/Canary')::date OR (COALESCE(x.paid,0)>0 AND COALESCE(x.net,0)=0))
        UNION ALL
        SELECT s.voided_at AS at,(cl.first_name||' '||cl.last_name) AS client,COALESCE((SELECT string_agg(l.quantity||' × '||l.product_name_snapshot,', ' ORDER BY l.id) FROM store_sale_lines l WHERE l.sale_id=s.id),'Venta de tienda') AS concept,s.total_cents::bigint AS amount,'void'::text AS state,NULL::text AS due_on,'void'::text AS status,0::bigint AS net
        FROM store_sales s JOIN clients cl ON cl.id=s.client_id WHERE s.status='voided' AND (s.voided_at AT TIME ZONE 'Atlantic/Canary')::date BETWEEN ${from}::date AND ${to}::date
        ) cancellations ORDER BY at LIMIT 5001`;
      if(list.length>5000)return {error:'export_result_limit_exceeded',limit:5000} as const;
      rows.push({name:'Impagos y cancelaciones',money:[3,4,5],rows:[['Fecha','Cliente','Concepto','Importe (EUR)','Cobrado neto (EUR)','Saldo (EUR)','Estado'],...list.map((item:any)=>[dateText(new Date(item.at).toISOString()),item.client,item.concept,euro(Number(item.amount)),euro(Number(item.net)),item.status==='void'||item.status==='refunded'?0:euro(Math.max(0,Number(item.amount)-Number(item.net))),statusLabel[item.status]??item.status])]});
    }
    const owner=can(context,'owner.panel.read');
    const cashData=(wanted.includes('cash')||wanted.includes('expenses'))?await cashSheets(db,context,from,to,owner):null;
    if(cashData&&'error'in cashData)return {error:'export_result_limit_exceeded',limit:1000} as const;
    if(wanted.includes('cash')&&cashData) {
      const cash=cashData as Exclude<typeof cashData,{error:string}>;
      rows.push({name:'Caja',money:[5,7,8,10],rows:[...cash.sessions,[],['Aviso de custodia',cash.incomplete?custodyNotice:'Custodia registrada para el periodo.'],[],...cash.movements]});
      rows.push({name:'Traspasos de caja',rows:cash.handovers});
    }
    if(wanted.includes('expenses')&&cashData&&!('error'in cashData))rows.push({name:'Gastos y retiradas',money:[3],rows:cashData.expenses});
    if(wanted.includes('igic')){
      const taxes=await db`SELECT line->>'taxTreatment' AS treatment,(line->>'taxRateBasisPoints')::int AS rate,sum((line->>'netCents')::bigint)::bigint AS base,sum((line->>'taxCents')::bigint)::bigint AS tax,count(*)::int AS count
        FROM economic_fiscal_documents d CROSS JOIN LATERAL jsonb_array_elements(d.lines_snapshot) line
        WHERE d.issued_at>=(${from}::date::timestamp AT TIME ZONE 'Atlantic/Canary') AND d.issued_at<((${to}::date+1)::timestamp AT TIME ZONE 'Atlantic/Canary') GROUP BY 1,2 ORDER BY 1,2`;
      rows.push({name:'IGIC por tipo',money:[2,3],rows:[['Tratamiento','Tipo IGIC (%)','Base (EUR)','IGIC (EUR)','Líneas'],...taxes.map((item:any)=>[item.treatment,item.rate==null?'—':Number(item.rate)/100,euro(Number(item.base)),euro(Number(item.tax)),Number(item.count)])]});
    }
    if(wanted.includes('staffHours')){
      const shifts=await db`SELECT s.local_date::text AS date,p.display_name AS professional,s.starts_at,s.ends_at,round(extract(epoch FROM (s.ends_at-s.starts_at))/3600.0,2)::numeric AS hours FROM staff_shift_assignments s JOIN staff_professionals p ON p.id=s.professional_id WHERE s.status='scheduled' AND s.local_date BETWEEN ${from}::date AND ${to}::date ORDER BY s.local_date,p.display_name,s.starts_at LIMIT 5001`;
      if(shifts.length>5000)return {error:'export_result_limit_exceeded',limit:5000} as const;
      const sums=new Map<string,number>();for(const item of shifts as any[])sums.set(item.professional,(sums.get(item.professional)??0)+Number(item.hours));
      rows.push({name:'Horas de personal',rows:[['Fecha','Profesional','Desde','Hasta','Horas'],...shifts.map((item:any)=>[String(item.date).slice(0,10),item.professional,new Date(item.starts_at).toISOString(),new Date(item.ends_at).toISOString(),Number(item.hours)]),[],['Total por profesional','Horas'],...[...sums].map(([name,hours])=>[name,hours])]});
    }
    const custodyIncomplete=cashData&&!('error'in cashData)?cashData.incomplete:await custodyIsIncomplete(db,context,from,to,owner);
    return {sheets:rows,summary,custodyIncomplete} as const;
  }

  app.get('/api/reports/export.xlsx',async(request,reply)=>{
    const context=await authorize(request,reply);if(!context)return;
    const parsed=workbookQuery.safeParse(request.query);if(!parsed.success)return reply.code(400).send({error:'validation_error'});
    if(parsed.data.to<parsed.data.from||Date.parse(`${parsed.data.to}T00:00:00Z`)-Date.parse(`${parsed.data.from}T00:00:00Z`)>366*86_400_000)return reply.code(400).send({error:'validation_error'});
    const wanted=selected(parsed.data.sections);if(!wanted)return reply.code(400).send({error:'validation_error'});
    const result=await makeSheets(context,parsed.data.from,parsed.data.to,wanted);
    if('error'in result)return reply.code(413).send({error:result.error,limit:result.limit});
    reply.header('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('Content-Disposition',`attachment; filename="economia-${parsed.data.from}-${parsed.data.to}.xlsx"`);
    return reply.send(buildXlsx(result.sheets));
  });
  app.get('/api/reports/export.pdf',async(request,reply)=>{
    const context=await authorize(request,reply);if(!context)return;
    const parsed=commonQuery.safeParse(request.query);if(!parsed.success||parsed.data.to<parsed.data.from||Date.parse(`${parsed.data.to}T00:00:00Z`)-Date.parse(`${parsed.data.from}T00:00:00Z`)>366*86_400_000)return reply.code(400).send({error:'validation_error'});
    const result=await makeSheets(context,parsed.data.from,parsed.data.to,[] as Section[]);if('error'in result)return reply.code(413).send({error:result.error,limit:result.limit});
    const summary=result.summary;const collected=summary.monthly.reduce((sum:number,row:any)=>sum+row.collectedCents,0);const sold=summary.monthly.reduce((sum:number,row:any)=>sum+row.soldCents,0);
    const pdf=await buildEconomySummaryPdf({from:parsed.data.from,to:parsed.data.to,generatedAt:new Date().toISOString(),actorId:context.actorId,soldCents:sold,collectedCents:collected,pendingCents:summary.pending.cents,overdueCents:summary.overdue.cents,overdueCount:summary.overdue.count,byMethod:summary.collectedByMethod,custodyNotice:result.custodyIncomplete?custodyNotice:null});
    reply.header('Content-Type','application/pdf').header('Content-Length',pdf.length).header('Content-Disposition',`attachment; filename="economia-${parsed.data.from}-${parsed.data.to}.pdf"`).header('X-Content-Type-Options','nosniff');return reply.send(pdf);
  });
}

async function cashSheets(db:DB,context:AuthorizationContext,from:string,to:string,owner:boolean) {
  const sessions=await db`SELECT s.id,s.local_date::text AS "day",s.status,s.opened_at,s.closed_at,r.name AS "register",s.opening_cents,s.opening_denominations,s.expected_cents,s.counted_cents,s.counted_denominations,s.difference_cents
    FROM economic_cash_sessions s LEFT JOIN economic_cash_registers r ON r.id=s.register_id WHERE s.local_date BETWEEN ${from}::date AND ${to}::date AND (${owner}::boolean OR EXISTS(SELECT 1 FROM economic_cash_custodies c WHERE c.cash_session_id=s.id AND c.actor_id=${context.actorId})) ORDER BY s.local_date,r.code,s.opened_at,s.id LIMIT 1001`;
  if(sessions.length>1000)return {error:true} as const;
  const sessionRows:any[]=[['Fecha','Registro','Estado','Apertura','Cierre','Fondo (EUR)','Denominaciones apertura','Esperado (EUR)','Recuento final (EUR)','Denominaciones cierre','Diferencia (EUR)','Cuadrada']];
  const movements:any[]=[['Fecha','Registro','Tipo','Método','Importe (EUR)','Actor','Motivo']];
  const handovers:any[]=[['Fecha','Registro','Sale','Entra','Recuento saliente','Recuento entrante','Descuadre']];
  const expenses:any[]=[['Fecha','Registro','Tipo','Importe (EUR)','Estado','Motivo','Actor','Justificante']];
  const [transactions,sales,refunds,adjustments,outflows,transfers]=await Promise.all([
    db`SELECT s.local_date::text AS "day",r.name AS "register",t.kind,ps.method,ps.amount_cents cents,t.actor_id actor,t.note reason,t.created_at at FROM economic_transactions t JOIN economic_payment_splits ps ON ps.transaction_id=t.id JOIN economic_cash_sessions s ON s.id=t.cash_session_id LEFT JOIN economic_cash_registers r ON r.id=s.register_id WHERE s.local_date BETWEEN ${from}::date AND ${to}::date AND (${owner}::boolean OR (t.actor_id=${context.actorId} AND EXISTS(SELECT 1 FROM economic_cash_custodies c WHERE c.cash_session_id=t.cash_session_id AND c.actor_id=${context.actorId} AND t.created_at>=c.started_at AND t.created_at<COALESCE(c.ended_at,'infinity'::timestamptz)))) ORDER BY t.created_at,t.id,ps.method LIMIT 5001`,
    db`SELECT s.local_date::text AS "day",r.name AS "register",'venta tienda' kind,x.payment_method method,x.total_cents cents,x.created_by actor,x.note reason,x.created_at at FROM store_sales x JOIN economic_cash_sessions s ON s.id=x.cash_session_id LEFT JOIN economic_cash_registers r ON r.id=s.register_id WHERE s.local_date BETWEEN ${from}::date AND ${to}::date AND (${owner}::boolean OR (x.created_by=${context.actorId} AND EXISTS(SELECT 1 FROM economic_cash_custodies c WHERE c.cash_session_id=x.cash_session_id AND c.actor_id=${context.actorId} AND x.created_at>=c.started_at AND x.created_at<COALESCE(c.ended_at,'infinity'::timestamptz)))) ORDER BY x.created_at,x.id LIMIT 5001`,
    db`SELECT s.local_date::text AS "day",r.name AS "register",'anulación tienda' kind,m.payment_method method,m.amount_cents cents,m.actor_id actor,m.reason,m.occurred_at at FROM store_sale_cash_movements m JOIN economic_cash_sessions s ON s.id=m.cash_session_id LEFT JOIN economic_cash_registers r ON r.id=s.register_id WHERE s.local_date BETWEEN ${from}::date AND ${to}::date AND (${owner}::boolean OR (m.actor_id=${context.actorId} AND EXISTS(SELECT 1 FROM economic_cash_custodies c WHERE c.cash_session_id=m.cash_session_id AND c.actor_id=${context.actorId} AND m.occurred_at>=c.started_at AND m.occurred_at<COALESCE(c.ended_at,'infinity'::timestamptz)))) ORDER BY m.occurred_at,m.id LIMIT 5001`,
    db`SELECT s.local_date::text AS "day",r.name AS "register",'ajuste' kind,NULL::text method,a.amount_cents cents,a.actor_id actor,a.reason,a.created_at at FROM economic_cash_adjustments a JOIN economic_cash_sessions s ON s.id=a.cash_session_id LEFT JOIN economic_cash_registers r ON r.id=s.register_id WHERE s.local_date BETWEEN ${from}::date AND ${to}::date AND (${owner}::boolean OR (a.actor_id=${context.actorId} AND EXISTS(SELECT 1 FROM economic_cash_custodies c WHERE c.cash_session_id=a.cash_session_id AND c.actor_id=${context.actorId} AND a.created_at>=c.started_at AND a.created_at<COALESCE(c.ended_at,'infinity'::timestamptz)))) ORDER BY a.created_at,a.id LIMIT 5001`,
    db`SELECT s.local_date::text AS "day",r.name AS "register",o.movement_type kind,o.amount_cents cents,o.actor_id actor,o.reason,o.status,o.receipt_bytes IS NOT NULL receipt,o.created_at at FROM economic_cash_outflows o JOIN economic_cash_sessions s ON s.id=o.cash_session_id LEFT JOIN economic_cash_registers r ON r.id=s.register_id WHERE s.local_date BETWEEN ${from}::date AND ${to}::date AND (${owner}::boolean OR (o.actor_id=${context.actorId} AND EXISTS(SELECT 1 FROM economic_cash_custodies c WHERE c.cash_session_id=o.cash_session_id AND c.actor_id=${context.actorId} AND o.created_at>=c.started_at AND o.created_at<COALESCE(c.ended_at,'infinity'::timestamptz)))) ORDER BY o.created_at,o.id LIMIT 5001`,
    db`SELECT s.local_date::text AS "day",r.name AS "register",h.created_at,h.outgoing_actor_id,h.incoming_actor_id,h.outgoing_denominations,h.incoming_denominations,h.mismatch FROM economic_cash_handovers h JOIN economic_cash_sessions s ON s.id=h.cash_session_id LEFT JOIN economic_cash_registers r ON r.id=s.register_id WHERE s.local_date BETWEEN ${from}::date AND ${to}::date AND (${owner}::boolean OR h.outgoing_actor_id=${context.actorId} OR h.incoming_actor_id=${context.actorId}) ORDER BY h.created_at,h.id LIMIT 5001`,
  ]);
  if([transactions,sales,refunds,adjustments,outflows,transfers].some(result=>result.length>5000))return {error:true} as const;
  const cents=(value:any)=>Number(value??0)/100;
  for(const session of sessions)sessionRows.push([String(session.day),session.register??'Histórica sin registro',session.status,isDateTime(session.opened_at),isDateTime(session.closed_at),owner?cents(session.opening_cents):null,owner?JSON.stringify(session.opening_denominations??{}):null,owner?cents(session.expected_cents):null,owner&&session.counted_cents!=null?cents(session.counted_cents):null,owner?JSON.stringify(session.counted_denominations??{}):null,owner&&session.difference_cents!=null?cents(session.difference_cents):null,owner&&session.difference_cents!=null?(Number(session.difference_cents)===0?'Sí':'No'):null]);
  const all:any[]=[...transactions,...sales,...refunds,...adjustments].sort((a,b)=>new Date(a.at).getTime()-new Date(b.at).getTime());
  for(const item of all)movements.push([isDateTime(item.at),item.register??'Histórica sin registro',item.kind,item.method??'',cents(item.cents),item.actor,item.reason??'']);
  for(const item of outflows)expenses.push([isDateTime(item.at),item.register??'Histórica sin registro',item.kind,cents(item.cents),item.status,item.reason,item.actor,item.receipt?'Sí':'No']);
  for(const item of transfers)handovers.push([isDateTime(item.created_at),item.register??'Histórica sin registro',item.outgoing_actor_id,item.incoming_actor_id,owner?JSON.stringify(item.outgoing_denominations??{}):'Recuento registrado',owner?JSON.stringify(item.incoming_denominations??{}):'Recuento registrado',owner?item.mismatch==null?'Pendiente':item.mismatch?'Sí':'No':'']);
  return {sessions:sessionRows,movements,handovers,expenses,incomplete:await custodyIsIncomplete(db,context,from,to,owner)};
}
