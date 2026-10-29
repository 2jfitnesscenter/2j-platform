import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';
import { buildXlsx } from './xlsx.js';

type SqlClient = ReturnType<typeof createDatabase>['client'];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
const methods = ['cash', 'card', 'transfer', 'direct_debit', 'other'] as const;
const salesQuery = z.object({
  from: day,
  to: day,
  q: z.string().trim().max(80).optional(),
  kind: z.enum(['all', 'plan', 'charge', 'store']).default('all'),
  method: z.enum(methods).optional(),
  invoice: z.enum(['all', 'with', 'without']).default('all'),
  limit: z.coerce.number().int().min(1).max(500).default(200),
}).strict().refine((value) => value.to >= value.from, { message: 'range_inverted' })
  .refine((value) => Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`) <= 366 * 86_400_000, { message: 'range_too_long' });

type SalesQuery = z.infer<typeof salesQuery>;
export type SaleRow = { id: string; kind: 'plan' | 'charge' | 'store'; occurredAt: string; clientId: string; clientName: string; concept: string; soldCents: number; collectedCents: number; status: string; methods: string[]; invoice: 'issued' | 'none' };

/**
 * Informes (D108): listado simple de ventas — cuotas y cargos (economic_charges) y ventas de tienda (store_sales) — con vendido frente a cobrado y las
 * anuladas diferenciadas. Solo lectura, sin gráficos y sin emitir nada (D106). Los importes salen de los mismos asientos que el resto de la economía.
 * Listar exige `billing.read-basic`; descargar el CSV exige además `billing.export`.
 */
export function registerReportRoutes(app: FastifyInstance<any, any, any, any, any>, db: SqlClient, resolveAuthorization: (request: FastifyRequest) => Promise<AuthorizationContext | null>) {
  async function authorize(request: FastifyRequest, reply: any, permission: string) {
    reply.header('Cache-Control', 'no-store');
    const context = await resolveAuthorization(request);
    if (!context) { reply.code(401).send({ error: 'authentication_required' }); return null; }
    if (!can(context, permission)) { reply.code(403).send({ error: 'permission_denied' }); return null; }
    return context;
  }

  /** Filas de ventas (cuotas, cargos y tienda) con vendido y cobrado; base común del listado, el resumen y la exportación. */
  function salesBase() {
    return db`
        SELECT c.id, CASE WHEN c.plan_id IS NOT NULL THEN 'plan' ELSE 'charge' END AS kind, c.created_at AS "occurredAt", c.client_id AS "clientId",
          (cl.first_name || ' ' || cl.last_name) AS "clientName", c.concept, c.due_on AS "dueOn", c.amount_cents::bigint AS "soldCents",
          CASE WHEN c.state IN ('void','exempt') THEN 0 ELSE GREATEST(COALESCE(x.net,0),0) END::bigint AS "collectedCents",
          CASE WHEN c.state='void' THEN 'void' WHEN c.state='exempt' THEN 'exempt'
               WHEN COALESCE(x.paid,0)>0 AND COALESCE(x.net,0)=0 THEN 'refunded'
               WHEN COALESCE(x.net,0)>=c.amount_cents THEN 'paid'
               WHEN COALESCE(x.net,0)>0 THEN 'partial'
               WHEN c.due_on<(now() AT TIME ZONE 'Atlantic/Canary')::date THEN 'unpaid' ELSE 'pending' END AS status,
          COALESCE(x.methods,'{}'::text[]) AS methods,
          CASE WHEN EXISTS (SELECT 1 FROM economic_fiscal_documents d WHERE d.source_charge_id=c.id) THEN 'issued' ELSE 'none' END AS invoice
        FROM economic_charges c JOIN clients cl ON cl.id=c.client_id
        LEFT JOIN LATERAL (
          SELECT sum(t.amount_cents) FILTER(WHERE t.kind='payment') AS paid, sum(CASE WHEN t.kind='payment' THEN t.amount_cents ELSE -t.amount_cents END) AS net,
            array(SELECT DISTINCT s.method FROM economic_transactions t2 JOIN economic_payment_splits s ON s.transaction_id=t2.id WHERE t2.charge_id=c.id AND t2.kind='payment' ORDER BY s.method) AS methods
          FROM economic_transactions t WHERE t.charge_id=c.id
        ) x ON true
        UNION ALL
        SELECT s.id, 'store', s.created_at, s.client_id, (cl.first_name || ' ' || cl.last_name),
          COALESCE((SELECT string_agg(l.quantity || ' × ' || l.product_name_snapshot, ', ' ORDER BY l.id) FROM store_sale_lines l WHERE l.sale_id=s.id), 'Venta de tienda'),
          NULL::date,
          s.total_cents::bigint,
          CASE WHEN s.status='completed' AND s.payment_state='paid' THEN s.total_cents ELSE 0 END::bigint,
          CASE WHEN s.status='voided' THEN 'void' WHEN s.payment_state='paid' THEN 'paid' ELSE 'pending' END,
          CASE WHEN s.payment_method IS NULL THEN '{}'::text[] ELSE ARRAY[s.payment_method] END,
          'none'
        FROM store_sales s JOIN clients cl ON cl.id=s.client_id`;
  }

  async function loadSales(query: SalesQuery) {
    const q = query.q && query.q.length > 0 ? `%${query.q.replace(/[\\%_]/g, (character) => `\\${character}`)}%` : null;
    const rows = await db`
      SELECT * FROM (
        ${salesBase()}
      ) v
      WHERE (v."occurredAt" AT TIME ZONE 'Atlantic/Canary')::date BETWEEN ${query.from}::date AND ${query.to}::date
        AND (${query.kind}::text='all' OR v.kind=${query.kind}::text)
        AND (${query.method ?? null}::text IS NULL OR ${query.method ?? null}::text = ANY(v.methods))
        AND (${query.invoice}::text='all' OR (${query.invoice}::text='with' AND v.invoice='issued') OR (${query.invoice}::text='without' AND v.invoice='none'))
        AND (${q}::text IS NULL OR unaccent(lower(v."clientName" || ' ' || v.concept)) LIKE unaccent(lower(${q}::text)) ESCAPE '\\')
      ORDER BY v."occurredAt" DESC, v.id DESC
      LIMIT ${query.limit + 1}`;
    const items: SaleRow[] = rows.slice(0, query.limit).map((row) => ({
      id: row.id, kind: row.kind, occurredAt: new Date(row.occurredAt).toISOString(), clientId: row.clientId, clientName: row.clientName, concept: row.concept,
      soldCents: Number(row.soldCents), collectedCents: Number(row.collectedCents), status: row.status, methods: row.methods, invoice: row.invoice,
    }));
    return { items, truncated: rows.length > query.limit };
  }

  function totalsOf(items: SaleRow[]) {
    const live = items.filter((item) => item.status !== 'void' && item.status !== 'exempt');
    const soldCents = live.reduce((sum, item) => sum + item.soldCents, 0);
    const collectedCents = live.reduce((sum, item) => sum + item.collectedCents, 0);
    const voided = items.filter((item) => item.status === 'void');
    return { soldCents, collectedCents, pendingCents: Math.max(0, soldCents - collectedCents), voidedCount: voided.length, voidedCents: voided.reduce((sum, item) => sum + item.soldCents, 0), rowCount: items.length };
  }

  app.get('/api/reports/sales', async (request, reply) => {
    const context = await authorize(request, reply, 'billing.read-basic'); if (!context) return;
    const parsed = salesQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    const { items, truncated } = await loadSales(parsed.data);
    return { currency: 'EUR', timezone: 'Atlantic/Canary', from: parsed.data.from, to: parsed.data.to, items, truncated, totals: totalsOf(items), capabilities: { export: can(context, 'billing.export') } };
  });

  app.get('/api/reports/sales.csv', async (request, reply) => {
    const context = await authorize(request, reply, 'billing.export'); if (!context) return;
    const parsed = salesQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    const { items } = await loadSales({ ...parsed.data, limit: 500 });
    const kindLabel: Record<string, string> = { plan: 'Cuota', charge: 'Cargo', store: 'Tienda' };
    const statusLabel: Record<string, string> = { paid: 'Cobrada', partial: 'Cobro parcial', pending: 'Pendiente', unpaid: 'Vencida', refunded: 'Devuelta', void: 'Anulada', exempt: 'Exenta' };
    const euros = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
    // Cells that a spreadsheet could read as a formula are neutralised (client names and concepts are free text).
    const cell = (value: string) => { const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value; return `"${safe.replace(/"/g, '""')}"`; };
    const header = ['Fecha', 'Cliente', 'Concepto', 'Tipo', 'Vendido (EUR)', 'Cobrado (EUR)', 'Pendiente (EUR)', 'Estado', 'Métodos', 'Factura'];
    const fmtDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
    const lines = items.map((item) => [fmtDate(item.occurredAt), item.clientName, item.concept, kindLabel[item.kind] ?? item.kind, euros(item.soldCents), euros(item.collectedCents), euros(item.status === 'void' || item.status === 'exempt' ? 0 : Math.max(0, item.soldCents - item.collectedCents)), statusLabel[item.status] ?? item.status, item.methods.join(' + '), item.invoice === 'issued' ? 'Con factura' : 'Sin factura'].map(cell).join(';'));
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="ventas-${parsed.data.from}-${parsed.data.to}.csv"`);
    return `﻿${[header.map(cell).join(';'), ...lines].join('\r\n')}\r\n`;
  });

  const rangeQuery = z.object({ from: day, to: day }).strict()
    .refine((value) => value.to >= value.from, { message: 'range_inverted' })
    .refine((value) => Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`) <= 366 * 86_400_000, { message: 'range_too_long' });
  const monthsBetween = (from: string, to: string) => { const out: string[] = []; for (let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7)); `${y}-${String(m).padStart(2, '0')}` <= to.slice(0, 7); m === 12 ? (y += 1, m = 1) : (m += 1)) out.push(`${y}-${String(m).padStart(2, '0')}`); return out; };

  /**
   * Resumen (A59): KPIs financieros y operativos del rango, calculados con consultas parametrizadas de solo lectura sobre los mismos asientos que el listado.
   * Solo agregados: ni nombres de clientes ni datos de salud. "Vencido sin cobrar" es la foto de hoy, no depende del rango.
   */
  async function loadSummary(from: string, to: string) {
    const inRange = (column: string) => db`(${db.unsafe(column)} AT TIME ZONE 'Atlantic/Canary')::date BETWEEN ${from}::date AND ${to}::date`;
    const [monthlyRows, [overdue], [fees], [occupancy], [attendance], serviceRows, planRows, methodRows] = await Promise.all([
      db`SELECT to_char(v."occurredAt" AT TIME ZONE 'Atlantic/Canary', 'YYYY-MM') AS month,
          COALESCE(sum(v."soldCents") FILTER (WHERE v.status NOT IN ('void','exempt')),0)::bigint AS sold, COALESCE(sum(v."collectedCents"),0)::bigint AS collected
        FROM (${salesBase()}) v WHERE ${inRange('v."occurredAt"')} GROUP BY 1 ORDER BY 1`,
      db`SELECT COALESCE(sum(v."soldCents" - v."collectedCents"),0)::bigint AS cents, count(*)::int AS count
        FROM (${salesBase()}) v WHERE v.kind IN ('plan','charge') AND v.status IN ('unpaid','partial') AND v."dueOn" < (now() AT TIME ZONE 'Atlantic/Canary')::date`,
      db`SELECT COALESCE(round(avg(v."soldCents")),0)::bigint AS average, count(*)::int AS count
        FROM (${salesBase()}) v WHERE v.kind='plan' AND v.status NOT IN ('void','exempt') AND ${inRange('v."occurredAt"')}`,
      db`SELECT count(*)::int AS sessions, COALESCE(sum(s.capacity),0)::int AS capacity, COALESCE(sum(r.n),0)::int AS occupied
        FROM calendar_sessions s LEFT JOIN LATERAL (SELECT count(*) AS n FROM calendar_reservations r WHERE r.session_id=s.id AND r.status IN ('reserved','attended','no_show')) r ON true
        WHERE s.status='scheduled' AND ${inRange('s.starts_at')}`,
      db`SELECT count(*) FILTER (WHERE r.status='attended')::int AS attended, count(*) FILTER (WHERE r.status='no_show')::int AS "noShow"
        FROM calendar_reservations r JOIN calendar_sessions s ON s.id=r.session_id WHERE s.status='scheduled' AND s.starts_at < now() AND ${inRange('s.starts_at')}`,
      db`SELECT sv.name AS name, count(*)::int AS count FROM calendar_reservations r JOIN calendar_sessions s ON s.id=r.session_id JOIN services sv ON sv.id=s.service_id
        WHERE s.status='scheduled' AND r.status IN ('reserved','attended','no_show') AND ${inRange('s.starts_at')} GROUP BY sv.id, sv.name ORDER BY count(*) DESC, sv.name LIMIT 20`,
      db`SELECT p.name AS name, count(*)::int AS count, COALESCE(sum(c.amount_cents),0)::bigint AS sold FROM economic_charges c JOIN plans p ON p.id=c.plan_id
        WHERE c.state NOT IN ('void','exempt') AND ${inRange('c.created_at')} GROUP BY p.id, p.name ORDER BY count(*) DESC, p.name LIMIT 20`,
      db`SELECT m.method AS method, sum(m.cents)::bigint AS cents FROM (
          SELECT sp.method, sp.amount_cents AS cents FROM economic_transactions t JOIN economic_payment_splits sp ON sp.transaction_id=t.id WHERE t.kind='payment' AND ${inRange('t.created_at')}
          UNION ALL SELECT s.payment_method, s.total_cents FROM store_sales s WHERE s.status='completed' AND s.payment_state='paid' AND s.payment_method IS NOT NULL AND ${inRange('s.created_at')}
        ) m GROUP BY m.method ORDER BY m.method`,
    ]);
    const byMonth = new Map(monthlyRows.map((row) => [row.month as string, row]));
    const monthly = monthsBetween(from, to).map((month) => ({ month, soldCents: Number(byMonth.get(month)?.sold ?? 0), collectedCents: Number(byMonth.get(month)?.collected ?? 0) }));
    const decided = Number(attendance?.attended ?? 0) + Number(attendance?.noShow ?? 0);
    const capacity = Number(occupancy?.capacity ?? 0);
    return {
      currency: 'EUR', timezone: 'Atlantic/Canary', from, to, monthly,
      overdue: { cents: Number(overdue?.cents ?? 0), count: Number(overdue?.count ?? 0) },
      averageFee: { cents: Number(fees?.average ?? 0), count: Number(fees?.count ?? 0) },
      occupancy: { sessions: Number(occupancy?.sessions ?? 0), capacity, occupied: Number(occupancy?.occupied ?? 0), rate: capacity > 0 ? Number(occupancy?.occupied ?? 0) / capacity : null },
      attendance: { attended: Number(attendance?.attended ?? 0), noShow: Number(attendance?.noShow ?? 0), rate: decided > 0 ? Number(attendance?.attended ?? 0) / decided : null },
      reservationsByService: serviceRows.map((row) => ({ name: row.name as string, count: Number(row.count) })),
      feesByPlan: planRows.map((row) => ({ name: row.name as string, count: Number(row.count), soldCents: Number(row.sold) })),
      collectedByMethod: methodRows.map((row) => ({ method: row.method as string, cents: Number(row.cents) })),
    };
  }

  app.get('/api/reports/summary', async (request, reply) => {
    const context = await authorize(request, reply, 'billing.read-basic'); if (!context) return;
    const parsed = rangeQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    return { ...(await loadSummary(parsed.data.from, parsed.data.to)), capabilities: { export: can(context, 'billing.export') } };
  });

  app.get('/api/reports/export.xlsx', async (request, reply) => {
    const context = await authorize(request, reply, 'billing.export'); if (!context) return;
    const parsed = rangeQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    const { from, to } = parsed.data;
    const [summary, sales] = await Promise.all([loadSummary(from, to), loadSales({ from, to, kind: 'all', invoice: 'all', limit: 5000 })]);
    const eur = (cents: number) => Math.round(cents) / 100;
    const pct = (rate: number | null) => (rate === null ? 'Sin datos' : `${(rate * 100).toFixed(1).replace('.', ',')} %`);
    const kindLabel: Record<string, string> = { plan: 'Cuota', charge: 'Cargo', store: 'Tienda' };
    const statusLabel: Record<string, string> = { paid: 'Cobrada', partial: 'Cobro parcial', pending: 'Pendiente', unpaid: 'Vencida', refunded: 'Devuelta', void: 'Anulada', exempt: 'Exenta' };
    const methodLabel: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', direct_debit: 'Domiciliación', other: 'Otro' };
    const fmtDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
    const workbook = buildXlsx([
      { name: 'Resumen', money: [1], rows: [['Indicador', 'Valor'], ['Periodo', `${from} a ${to}`], ['Vencido sin cobrar (EUR, hoy)', eur(summary.overdue.cents)], ['Cuotas vencidas sin cobrar', summary.overdue.count], ['Cuota media (EUR)', eur(summary.averageFee.cents)], ['Sesiones programadas', summary.occupancy.sessions], ['Plazas ofertadas', summary.occupancy.capacity], ['Plazas ocupadas', summary.occupancy.occupied], ['Ocupación', pct(summary.occupancy.rate)], ['Asistencias', summary.attendance.attended], ['Ausencias', summary.attendance.noShow], ['Asistencia', pct(summary.attendance.rate)]] },
      { name: 'Ventas', money: [4, 5, 6], rows: [['Fecha', 'Cliente', 'Concepto', 'Tipo', 'Vendido (EUR)', 'Cobrado (EUR)', 'Pendiente (EUR)', 'Estado', 'Métodos', 'Factura'], ...sales.items.map((item) => [fmtDate(item.occurredAt), item.clientName, item.concept, kindLabel[item.kind] ?? item.kind, eur(item.soldCents), eur(item.collectedCents), eur(item.status === 'void' || item.status === 'exempt' ? 0 : Math.max(0, item.soldCents - item.collectedCents)), statusLabel[item.status] ?? item.status, item.methods.map((m) => methodLabel[m] ?? m).join(' + '), item.invoice === 'issued' ? 'Con factura' : 'Sin factura'])] },
      { name: 'Cobros por método', money: [1], rows: [['Método', 'Cobrado (EUR)'], ...summary.collectedByMethod.map((row) => [methodLabel[row.method] ?? row.method, eur(row.cents)])] },
      { name: 'Ingresos mensuales', money: [1, 2], rows: [['Mes', 'Vendido (EUR)', 'Cobrado (EUR)'], ...summary.monthly.map((row) => [row.month, eur(row.soldCents), eur(row.collectedCents)])] },
      { name: 'Reservas por servicio', rows: [['Servicio', 'Reservas'], ...summary.reservationsByService.map((row) => [row.name, row.count])] },
      { name: 'Cuotas por plan', money: [2], rows: [['Plan', 'Cuotas', 'Vendido (EUR)'], ...summary.feesByPlan.map((row) => [row.name, row.count, eur(row.soldCents)])] },
    ]);
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="informes-${from}-${to}.xlsx"`);
    return reply.send(workbook);
  });
}
