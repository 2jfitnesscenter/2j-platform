import type { FastifyInstance, FastifyRequest } from 'fastify';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';

type SqlClient = ReturnType<typeof createDatabase>['client'];

const SHIFT_DAYS = 14;
const DIFFERENCE_DAYS = 30;
const n = (value: unknown) => Number(value ?? 0);

/**
 * Administración · Panel de gestión (paridad con Administration.jsx de 2jfit-admin). Solo lectura y solo para `owner.panel.read`:
 * cajas abiertas ahora, turnos de caja cerrados de los últimos 14 días con su diferencia, descuadre acumulado de 30 días y
 * los fichajes del equipo de hoy. A38: las diferencias de caja no se enseñan a nadie más. D121: los fichajes no llevan totales de horas.
 */
export function registerManagementPanelRoutes(app: FastifyInstance<any, any, any, any, any>, db: SqlClient, resolve: (request: FastifyRequest) => Promise<AuthorizationContext | null>) {
  app.get('/api/admin/management-panel', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await resolve(request);
    if (!context) return reply.code(401).send({ error: 'authentication_required' });
    if (!can(context, 'owner.panel.read')) return reply.code(403).send({ error: 'permission_denied' });
    try {
      const [openRegisters, closedShifts, accumulated, clockings, cashHistory] = await Promise.all([
        db`SELECT s.id, COALESCE(r.name, 'Histórica sin registro') AS "registerName", s.local_date::text AS "localDate", s.opened_at AS "openedAt",
                  (SELECT p.display_name FROM economic_cash_custodies c JOIN staff_professionals p ON p.id = c.professional_id WHERE c.cash_session_id = s.id AND c.ended_at IS NULL LIMIT 1) AS "custodian",
                  s.local_date < (now() AT TIME ZONE 'Atlantic/Canary')::date AS "forgotten"
           FROM economic_cash_sessions s LEFT JOIN economic_cash_registers r ON r.id = s.register_id
           WHERE s.status = 'open' ORDER BY s.opened_at, s.id`,
        db`SELECT s.id, COALESCE(r.name, 'Histórica sin registro') AS "registerName", s.local_date::text AS "localDate", s.opened_at AS "openedAt", s.closed_at AS "closedAt",
                  s.status, s.counted_cents AS "countedCents", s.expected_cents AS "expectedCents", s.difference_cents AS "differenceCents"
           FROM economic_cash_sessions s LEFT JOIN economic_cash_registers r ON r.id = s.register_id
           WHERE s.status <> 'open' AND s.local_date >= (now() AT TIME ZONE 'Atlantic/Canary')::date - ${SHIFT_DAYS}::int
           ORDER BY s.local_date DESC, s.closed_at DESC NULLS LAST, s.id LIMIT 60`,
        db`SELECT COALESCE(sum(s.difference_cents), 0)::bigint AS "differenceCents", count(*) FILTER (WHERE COALESCE(s.difference_cents, 0) <> 0)::int AS "withDifference", count(*)::int AS "shifts"
           FROM economic_cash_sessions s WHERE s.status <> 'open' AND s.local_date >= (now() AT TIME ZONE 'Atlantic/Canary')::date - ${DIFFERENCE_DAYS}::int`,
        db`SELECT e.id, p.display_name AS "displayName", e.event_type AS "eventType", e.occurred_at AS "occurredAt", e.origin
           FROM staff_timeclock_events e JOIN staff_professionals p ON p.id = e.professional_id
           WHERE e.local_date = (now() AT TIME ZONE 'Atlantic/Canary')::date ORDER BY e.occurred_at DESC, e.id DESC LIMIT 60`,
        db`SELECT e.id,e.action,e.actor_id AS "actorId",COALESCE(p.display_name,e.actor_id) AS "actorName",e.occurred_at AS "occurredAt",
                  COALESCE(r.name,'Histórica sin registro') AS "registerName",e.details
           FROM economic_audit_events e
           LEFT JOIN economic_cash_sessions s ON e.resource_type='cash_session' AND s.id=e.resource_id
           LEFT JOIN economic_cash_registers r ON r.id=COALESCE(s.register_id,NULLIF(e.details->>'registerId','')::uuid)
           LEFT JOIN staff_professionals p ON p.auth_actor_id=e.actor_id
           WHERE e.action IN ('cash.opened','cash.closed','cash.reopened','cash.handover_started','cash.handover_completed')
             AND e.occurred_at >= now() - (${SHIFT_DAYS}::text || ' days')::interval
           ORDER BY e.occurred_at DESC,e.id DESC LIMIT 200`,
      ]);
      return {
        timezone: 'Atlantic/Canary',
        windows: { shiftDays: SHIFT_DAYS, differenceDays: DIFFERENCE_DAYS },
        openRegisters: openRegisters.map((row: any) => ({ id: row.id, registerName: row.registerName, localDate: row.localDate, openedAt: new Date(row.openedAt).toISOString(), custodian: row.custodian ?? null, forgotten: Boolean(row.forgotten) })),
        closedShifts: closedShifts.map((row: any) => ({ id: row.id, registerName: row.registerName, localDate: row.localDate, openedAt: new Date(row.openedAt).toISOString(), closedAt: row.closedAt ? new Date(row.closedAt).toISOString() : null, status: row.status, countedCents: row.countedCents == null ? null : n(row.countedCents), expectedCents: row.expectedCents == null ? null : n(row.expectedCents), differenceCents: row.differenceCents == null ? null : n(row.differenceCents) })),
        accumulatedDifference: { differenceCents: n(accumulated[0]?.differenceCents), shiftsWithDifference: n(accumulated[0]?.withDifference), shifts: n(accumulated[0]?.shifts) },
        teamClockings: clockings.map((row: any) => ({ id: row.id, displayName: row.displayName, eventType: row.eventType, occurredAt: new Date(row.occurredAt).toISOString(), origin: row.origin })),
        cashHistory: cashHistory.map((row: any) => ({ id: row.id, action: row.action, actorId: row.actorId, actorName: row.actorName, occurredAt: new Date(row.occurredAt).toISOString(), registerName: row.registerName, details: row.details })),
      };
    } catch (error) {
      const databaseCode = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown';
      app.log.error({ databaseCode, route: 'GET /api/admin/management-panel' }, 'management panel failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
  });
}
