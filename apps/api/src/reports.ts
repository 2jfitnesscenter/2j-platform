import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';

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

  async function loadSales(query: SalesQuery) {
    const q = query.q && query.q.length > 0 ? `%${query.q.replace(/[\\%_]/g, (character) => `\\${character}`)}%` : null;
    const rows = await db`
      SELECT * FROM (
        SELECT c.id, CASE WHEN c.plan_id IS NOT NULL THEN 'plan' ELSE 'charge' END AS kind, c.created_at AS "occurredAt", c.client_id AS "clientId",
          (cl.first_name || ' ' || cl.last_name) AS "clientName", c.concept, c.amount_cents::bigint AS "soldCents",
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
          s.total_cents::bigint,
          CASE WHEN s.status='completed' AND s.payment_state='paid' THEN s.total_cents ELSE 0 END::bigint,
          CASE WHEN s.status='voided' THEN 'void' WHEN s.payment_state='paid' THEN 'paid' ELSE 'pending' END,
          CASE WHEN s.payment_method IS NULL THEN '{}'::text[] ELSE ARRAY[s.payment_method] END,
          'none'
        FROM store_sales s JOIN clients cl ON cl.id=s.client_id
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
}
