import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';

type DB = ReturnType<typeof createDatabase>['client'];

const query = z.object({
  status: z.enum(['current', 'active', 'scheduled', 'expired', 'cancelled', 'paused', 'all']).default('current'),
  payment: z.enum(['paid', 'pending', 'unpaid', 'all']).default('all'),
  expiring: z.enum(['0', '1']).default('0'),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict();

/**
 * Lista de contratos (cuotas asignadas a clientes) de todo el centro, de solo lectura.
 * Estado = el mismo que la ficha del cliente (evento vigente + fechas); pago = cargo asociado menos devoluciones.
 * Los importes solo se devuelven con `billing.read-basic`; sin él, el filtro de pago no se puede usar.
 */
export function registerContractRoutes(app: FastifyInstance<any, any, any, any, any>, db: DB, resolve: (request: FastifyRequest) => Promise<AuthorizationContext | null>) {
  app.get('/api/contracts', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await resolve(request);
    if (!context) return reply.code(401).send({ error: 'authentication_required' });
    if (!can(context, 'entitlements.read') || !can(context, 'clients.read')) return reply.code(403).send({ error: 'permission_denied' });
    const parsed = query.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    const { status, payment, expiring, limit } = parsed.data;
    const canMoney = can(context, 'billing.read-basic');
    if (payment !== 'all' && !canMoney) return reply.code(403).send({ error: 'permission_denied' });
    const term = (parsed.data.q ?? '').normalize('NFKC').toLocaleLowerCase('es');
    try {
      const rows = await db`
        WITH today AS (SELECT (now() AT TIME ZONE 'Atlantic/Canary')::date AS d),
        base AS (
          SELECT x.id, x.client_id, concat_ws(' ', cl.first_name, cl.last_name) AS client_name, p.name AS plan_name, v.kind,
                 x.starts_on, x.ends_on, c.amount_cents, c.due_on, c.state AS charge_state,
                 COALESCE(t.paid, 0)::bigint AS paid, COALESCE(t.net, 0)::bigint AS net,
                 CASE WHEN x.status = 'cancelled' OR le.event_type IN ('cancelled', 'changed') THEN 'cancelled'
                      WHEN le.event_type = 'paused' THEN 'paused'
                      WHEN x.starts_on > (SELECT d FROM today) THEN 'scheduled'
                      WHEN x.ends_on IS NOT NULL AND x.ends_on < (SELECT d FROM today) THEN 'expired'
                      ELSE 'active' END AS derived
          FROM client_plan_assignments x
          JOIN clients cl ON cl.id = x.client_id
          JOIN plans p ON p.id = x.plan_id
          JOIN plan_versions v ON v.plan_id = x.plan_id AND v.version = x.plan_version
          JOIN economic_charges c ON c.id = x.charge_id
          LEFT JOIN LATERAL (SELECT e.event_type FROM client_plan_assignment_events e WHERE e.assignment_id = x.id AND e.effective_on <= (SELECT d FROM today) ORDER BY e.effective_on DESC, e.created_at DESC, e.id DESC LIMIT 1) le ON true
          LEFT JOIN LATERAL (SELECT sum(amount_cents) FILTER (WHERE kind = 'payment') AS paid, sum(CASE WHEN kind = 'payment' THEN amount_cents ELSE -amount_cents END) AS net FROM economic_transactions WHERE charge_id = c.id) t ON true
          WHERE (${term} = '' OR strpos(unaccent(lower(concat_ws(' ', cl.first_name, cl.last_name))), unaccent(${term})) > 0)
        ), shaped AS (
          SELECT b.*, GREATEST(b.amount_cents - b.net, 0)::bigint AS balance,
                 CASE WHEN b.charge_state = 'void' THEN 'void' WHEN b.charge_state = 'exempt' THEN 'exempt'
                      WHEN b.net >= b.amount_cents THEN 'paid'
                      WHEN b.due_on < (SELECT d FROM today) THEN 'unpaid' ELSE 'pending' END AS pay_state,
                 (b.derived = 'active' AND b.ends_on IS NOT NULL AND b.ends_on <= (SELECT d FROM today) + 7) AS expiring_soon
          FROM base b
        )
        SELECT id, client_id AS "clientId", client_name AS "clientName", plan_name AS "planName", kind,
               starts_on::text AS "startsOn", ends_on::text AS "endsOn", derived AS "status", pay_state AS "paymentState",
               due_on::text AS "dueOn", amount_cents::bigint AS "amountCents", balance AS "balanceCents", expiring_soon AS "expiringSoon"
        FROM shaped
        WHERE (${status} = 'all' OR (${status} = 'current' AND derived IN ('active', 'scheduled', 'paused')) OR derived = ${status})
          AND (${payment} = 'all' OR pay_state = ${payment})
          AND (${expiring} = '0' OR expiring_soon)
        ORDER BY (ends_on IS NULL), ends_on, lower(client_name), id
        LIMIT ${limit}`;
      const [summary] = await db`
        WITH today AS (SELECT (now() AT TIME ZONE 'Atlantic/Canary')::date AS d)
        SELECT count(*) FILTER (WHERE s.derived = 'active')::int AS "activeCount",
               count(*) FILTER (WHERE s.derived = 'active' AND s.ends_on IS NOT NULL AND s.ends_on <= (SELECT d FROM today) + 7)::int AS "expiringSoonCount",
               COALESCE(sum(GREATEST(s.amount_cents - s.net, 0)) FILTER (WHERE s.derived IN ('active', 'scheduled', 'paused') AND s.charge_state NOT IN ('void', 'exempt')), 0)::bigint AS "pendingCents"
        FROM (
          SELECT x.ends_on, c.amount_cents, c.state AS charge_state, COALESCE(t.net, 0) AS net,
                 CASE WHEN x.status = 'cancelled' OR le.event_type IN ('cancelled', 'changed') THEN 'cancelled' WHEN le.event_type = 'paused' THEN 'paused'
                      WHEN x.starts_on > (SELECT d FROM today) THEN 'scheduled' WHEN x.ends_on IS NOT NULL AND x.ends_on < (SELECT d FROM today) THEN 'expired' ELSE 'active' END AS derived
          FROM client_plan_assignments x JOIN economic_charges c ON c.id = x.charge_id
          LEFT JOIN LATERAL (SELECT e.event_type FROM client_plan_assignment_events e WHERE e.assignment_id = x.id AND e.effective_on <= (SELECT d FROM today) ORDER BY e.effective_on DESC, e.created_at DESC, e.id DESC LIMIT 1) le ON true
          LEFT JOIN LATERAL (SELECT sum(CASE WHEN kind = 'payment' THEN amount_cents ELSE -amount_cents END) AS net FROM economic_transactions WHERE charge_id = c.id) t ON true
        ) s`;
      const items = rows.map((row: any) => canMoney
        ? { ...row, amountCents: Number(row.amountCents), balanceCents: Number(row.balanceCents) }
        : { ...row, paymentState: null, dueOn: null, amountCents: null, balanceCents: null });
      return {
        items,
        summary: { activeCount: Number(summary?.activeCount ?? 0), expiringSoonCount: Number(summary?.expiringSoonCount ?? 0), pendingCents: canMoney ? Number(summary?.pendingCents ?? 0) : null },
        capabilities: { money: canMoney, assignPlans: can(context, 'entitlements.manage') },
      };
    } catch (error) {
      const databaseCode = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown';
      app.log.error({ databaseCode, route: 'GET /api/contracts' }, 'contracts list failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
  });
}
