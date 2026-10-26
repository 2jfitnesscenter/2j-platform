import type { FastifyInstance, FastifyRequest } from 'fastify';
import { can, type AuthorizationContext } from '@2j/permissions';
import { canaryBusinessDate } from '@2j/domain';
import type { createDatabase } from './db.js';
import { evaluateTermPaymentAccess } from './term-payment-access.js';

type SqlClient = ReturnType<typeof createDatabase>['client'];

const LOW_OCCUPANCY_PERCENT = 25;
const LOW_STOCK_UNITS = 3;
const LIST_LIMIT = 10;
const METHODS = ['cash', 'card', 'transfer', 'direct_debit', 'other'] as const;

const n = (value: unknown) => Number(value ?? 0);

/**
 * «Mi gimnasio» · Panel del propietario (spec #96, opción A, Fase 1). Solo lectura y solo agregados.
 * Permiso único `owner.panel.read`. No incluye datos de salud, notas internas, mensajes, contacto ni datos fiscales; las listas llevan
 * como mucho nombre de servicio/producto o de profesional. Los indicadores de Fase 2 (rachas de ausencias, clientes sin asistencia,
 * retención, bajas, horas fichadas) no están aquí: requieren definiciones del propietario.
 */
export function registerOwnerPanelRoutes(app: FastifyInstance<any, any, any, any, any>, db: SqlClient, resolveAuthorization: (request: FastifyRequest) => Promise<AuthorizationContext | null>) {
  app.get('/api/admin/owner-panel', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await resolveAuthorization(request);
    if (!context) return reply.code(401).send({ error: 'authentication_required' });
    if (!can(context, 'owner.panel.read')) return reply.code(403).send({ error: 'permission_denied' });

    try {
    const now = new Date();
    const nowIso = now.toISOString();
    const today = canaryBusinessDate(now);
    const SESSION_DAY = db`(s.starts_at AT TIME ZONE 'Atlantic/Canary')::date`;

    // ------------------------------------------------------------------ HOY
    const [sessionsToday, openShifts, cashRows, receivable, waitlist, unassigned, absences, transfers, formReviews, bunkerReviews] = await Promise.all([
      db`SELECT s.id,s.starts_at AS "startsAt",sv.name AS "serviceName",s.capacity,
          (SELECT count(*)::int FROM calendar_reservations r WHERE r.session_id=s.id AND r.status IN ('reserved','attended','no_show','cancelled_late')) AS occupied
        FROM calendar_sessions s JOIN services sv ON sv.id=s.service_id
        WHERE ${SESSION_DAY}=${today}::date AND s.status='scheduled' ORDER BY s.starts_at,s.id`,
      db`SELECT p.id,p.display_name AS "displayName",e.occurred_at AS "since",e.local_date::text AS "localDate"
        FROM staff_professionals p
        JOIN LATERAL (SELECT event_type,occurred_at,local_date FROM staff_timeclock_events WHERE professional_id=p.id ORDER BY occurred_at DESC,id DESC LIMIT 1) e ON true
        WHERE p.status='active' AND e.event_type='clock_in' ORDER BY e.occurred_at,p.id`,
      db`SELECT status,opened_at AS "openedAt",closed_at AS "closedAt",difference_cents AS "differenceCents",local_date::text AS "localDate"
        FROM economic_cash_sessions WHERE status='open' OR local_date=${today}::date ORDER BY (status='open') DESC,opened_at DESC LIMIT 1`,
      db`SELECT q.client_id AS "clientId",q.due_on::text AS "dueOn",q.balance FROM (
          SELECT c.client_id,c.due_on,CASE WHEN COALESCE(x.paid,0)>0 AND COALESCE(x.net,0)=0 THEN 0 ELSE c.amount_cents-COALESCE(x.net,0) END AS balance
          FROM economic_charges c LEFT JOIN LATERAL (SELECT sum(amount_cents) FILTER(WHERE kind='payment') AS paid,sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END) AS net
            FROM economic_transactions WHERE charge_id=c.id) x ON true WHERE c.state='pending') q WHERE q.balance>0`,
      db`SELECT count(*)::int AS entries,count(DISTINCT w.session_id)::int AS sessions FROM calendar_waitlist_entries w JOIN calendar_sessions s ON s.id=w.session_id
        WHERE w.status='waiting' AND s.status='scheduled' AND s.starts_at>${nowIso}::timestamptz`,
      db`SELECT count(*)::int AS count FROM calendar_sessions s WHERE s.status='scheduled' AND s.professional_id IS NULL AND s.starts_at>${nowIso}::timestamptz AND ${SESSION_DAY}<=(${today}::date+7)`,
      db`SELECT count(*)::int AS count FROM staff_exceptions e WHERE e.status='active' AND e.starts_at<=${nowIso}::timestamptz AND e.ends_at>${nowIso}::timestamptz`,
      db`SELECT count(*)::int AS count FROM economic_transfer_proofs WHERE status='pending_validation'`,
      db`SELECT count(*)::int AS count FROM client_form_assignments WHERE status='review_required'`,
      db`SELECT count(*)::int AS count FROM training_link_review_cases WHERE status='open'`,
    ]);

    const openAssignments = await db`SELECT a.id,a.client_id AS "clientId",v.term_kind AS "termKind" FROM client_plan_assignments a
      JOIN plan_versions v ON v.plan_id=a.plan_id AND v.version=a.plan_version
      WHERE a.status='active' AND a.starts_on<=${today}::date AND (a.ends_on IS NULL OR a.ends_on>=${today}::date) AND v.term_kind IS NOT NULL`;
    const access = openAssignments.length
      ? await db.begin((tx) => evaluateTermPaymentAccess(tx, openAssignments.map((row) => ({ assignmentId: String(row.id), termKind: String(row.termKind) })), now))
      : new Map();
    const blockedClients = new Set(openAssignments.filter((row) => access.get(String(row.id))?.state === 'payment_overdue').map((row) => String(row.clientId)));
    const overdueClients = new Set(receivable.filter((row) => String(row.dueOn) < today).map((row) => String(row.clientId)));
    const cash = cashRows[0];

    const capacity = sessionsToday.reduce((sum, row) => sum + n(row.capacity), 0);
    const occupied = sessionsToday.reduce((sum, row) => sum + n(row.occupied), 0);

    // ---------------------------------------------------------------- SEMANA
    const [dueSoon, upcomingSessions, lowStock, storeWeek] = await Promise.all([
      db`SELECT count(*)::int AS count FROM client_plan_assignments WHERE status='active' AND ends_on BETWEEN ${today}::date AND (${today}::date+7)`,
      db`SELECT s.id,s.starts_at AS "startsAt",sv.name AS "serviceName",s.capacity,
          (SELECT count(*)::int FROM calendar_reservations r WHERE r.session_id=s.id AND r.status IN ('reserved','attended','no_show','cancelled_late')) AS occupied,
          (SELECT count(*)::int FROM calendar_waitlist_entries w WHERE w.session_id=s.id AND w.status='waiting') AS waiting
        FROM calendar_sessions s JOIN services sv ON sv.id=s.service_id
        WHERE s.status='scheduled' AND s.individual_client_id IS NULL AND s.starts_at>${nowIso}::timestamptz AND ${SESSION_DAY}<=(${today}::date+7) ORDER BY s.starts_at,s.id`,
      db`SELECT p.name AS "productName",v.label AS "variantLabel",COALESCE(sum(m.quantity_delta),0)::int AS stock
        FROM store_product_variants v JOIN store_products p ON p.id=v.product_id LEFT JOIN store_inventory_movements m ON m.variant_id=v.id
        WHERE v.active AND v.stock_tracked AND p.active GROUP BY v.id,p.name,v.label HAVING COALESCE(sum(m.quantity_delta),0)<=${LOW_STOCK_UNITS} ORDER BY stock,p.name,v.label LIMIT ${LIST_LIMIT}`,
      db`SELECT count(*)::int AS count,COALESCE(sum(total_cents) FILTER(WHERE payment_state='paid'),0)::bigint AS "collectedCents",COALESCE(sum(total_cents) FILTER(WHERE payment_state<>'paid'),0)::bigint AS "pendingCents"
        FROM store_sales WHERE status='completed' AND (created_at AT TIME ZONE 'Atlantic/Canary')::date BETWEEN (${today}::date-6) AND ${today}::date`,
    ]);
    const lowSessions = upcomingSessions.filter((row) => n(row.capacity) > 0 && n(row.occupied) * 100 < LOW_OCCUPANCY_PERCENT * n(row.capacity) && new Date(row.startsAt as string).getTime() - now.getTime() <= 24 * 3_600_000);
    const fullWithWaitlist = upcomingSessions.filter((row) => n(row.capacity) > 0 && n(row.occupied) >= n(row.capacity) && n(row.waiting) > 0);
    const shortSession = (row: any) => ({ id: row.id, startsAt: new Date(row.startsAt).toISOString(), serviceName: row.serviceName, capacity: n(row.capacity), occupied: n(row.occupied), waiting: n(row.waiting ?? 0) });

    // ------------------------------------------------------------------- MES
    const [newClients, plansByMonth, storeByMonth, methodRows, slotRows, bunker] = await Promise.all([
      db`SELECT count(*) FILTER(WHERE (created_at AT TIME ZONE 'Atlantic/Canary')::date>=date_trunc('month',${today}::date))::int AS "thisMonth",
          count(*) FILTER(WHERE (created_at AT TIME ZONE 'Atlantic/Canary')::date>=date_trunc('month',${today}::date)-interval '1 month' AND (created_at AT TIME ZONE 'Atlantic/Canary')::date<date_trunc('month',${today}::date))::int AS "previousMonth"
        FROM clients`,
      db`SELECT COALESCE(sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END) FILTER(WHERE (created_at AT TIME ZONE 'Atlantic/Canary')::date>=date_trunc('month',${today}::date)),0)::bigint AS "thisMonth",
          COALESCE(sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END) FILTER(WHERE (created_at AT TIME ZONE 'Atlantic/Canary')::date>=date_trunc('month',${today}::date)-interval '1 month' AND (created_at AT TIME ZONE 'Atlantic/Canary')::date<date_trunc('month',${today}::date)),0)::bigint AS "previousMonth"
        FROM economic_transactions`,
      db`SELECT COALESCE(sum(total_cents) FILTER(WHERE (created_at AT TIME ZONE 'Atlantic/Canary')::date>=date_trunc('month',${today}::date)),0)::bigint AS "thisMonth",
          COALESCE(sum(total_cents) FILTER(WHERE (created_at AT TIME ZONE 'Atlantic/Canary')::date>=date_trunc('month',${today}::date)-interval '1 month' AND (created_at AT TIME ZONE 'Atlantic/Canary')::date<date_trunc('month',${today}::date)),0)::bigint AS "previousMonth"
        FROM store_sales WHERE status='completed' AND payment_state='paid'`,
      db`SELECT method,COALESCE(sum(amount) FILTER(WHERE month='this'),0)::bigint AS "thisMonth",COALESCE(sum(amount) FILTER(WHERE month='previous'),0)::bigint AS "previousMonth" FROM (
          SELECT ps.method,CASE WHEN t.kind='payment' THEN ps.amount_cents ELSE -ps.amount_cents END AS amount,
            CASE WHEN (t.created_at AT TIME ZONE 'Atlantic/Canary')::date>=date_trunc('month',${today}::date) THEN 'this'
                 WHEN (t.created_at AT TIME ZONE 'Atlantic/Canary')::date>=date_trunc('month',${today}::date)-interval '1 month' THEN 'previous' END AS month
          FROM economic_transactions t JOIN economic_payment_splits ps ON ps.transaction_id=t.id
          UNION ALL
          SELECT s.payment_method,s.total_cents,
            CASE WHEN (s.created_at AT TIME ZONE 'Atlantic/Canary')::date>=date_trunc('month',${today}::date) THEN 'this'
                 WHEN (s.created_at AT TIME ZONE 'Atlantic/Canary')::date>=date_trunc('month',${today}::date)-interval '1 month' THEN 'previous' END
          FROM store_sales s WHERE s.status='completed' AND s.payment_state='paid' AND s.payment_method IS NOT NULL) u
        WHERE month IS NOT NULL GROUP BY method`,
      db`SELECT sv.name AS "serviceName",(EXTRACT(hour FROM s.starts_at AT TIME ZONE 'Atlantic/Canary'))::int AS hour,count(*)::int AS sessions,
          sum(s.capacity)::int AS capacity,sum((SELECT count(*) FROM calendar_reservations r WHERE r.session_id=s.id AND r.status IN ('reserved','attended','no_show','cancelled_late')))::int AS occupied
        FROM calendar_sessions s JOIN services sv ON sv.id=s.service_id
        WHERE s.status='scheduled' AND s.individual_client_id IS NULL AND s.starts_at<=${nowIso}::timestamptz AND ${SESSION_DAY}>=date_trunc('month',${today}::date)
        GROUP BY sv.name,hour HAVING sum(s.capacity)>0 ORDER BY sv.name,hour LIMIT 60`,
      db`SELECT count(DISTINCT person_id)::int AS count FROM training_account_links WHERE status='active'`,
    ]);

    const byMethod: Record<string, { thisMonthCents: number; previousMonthCents: number }> = {};
    for (const method of METHODS) byMethod[method] = { thisMonthCents: 0, previousMonthCents: 0 };
    for (const row of methodRows) { const key = String(row.method); (byMethod[key] ??= { thisMonthCents: 0, previousMonthCents: 0 }); byMethod[key]!.thisMonthCents = n(row.thisMonth); byMethod[key]!.previousMonthCents = n(row.previousMonth); }

    return {
      timezone: 'Atlantic/Canary',
      asOf: now.toISOString(),
      localDate: today,
      today: {
        classes: { sessionCount: sessionsToday.length, capacity, occupied, sessions: sessionsToday.slice(0, LIST_LIMIT).map((row) => ({ id: row.id, startsAt: new Date(row.startsAt as string).toISOString(), serviceName: row.serviceName, capacity: n(row.capacity), occupied: n(row.occupied) })) },
        clockedIn: openShifts.map((row) => ({ id: row.id, displayName: row.displayName, since: new Date(row.since as string).toISOString(), forgotten: String(row.localDate) < today })),
        cash: cash ? { state: cash.status === 'open' ? 'open' : cash.status === 'late_close' ? 'late_close' : 'closed', openedAt: new Date(cash.openedAt as string).toISOString(), closedAt: cash.closedAt ? new Date(cash.closedAt as string).toISOString() : null, differenceCents: cash.differenceCents == null ? null : n(cash.differenceCents), localDate: cash.localDate } : { state: 'none', openedAt: null, closedAt: null, differenceCents: null, localDate: today },
        collections: { pendingCents: receivable.reduce((sum, row) => sum + n(row.balance), 0), chargeCount: receivable.length, overdueCount: receivable.filter((row) => String(row.dueOn) < today).length },
        clients: { overdue: overdueClients.size, blocked: blockedClients.size },
        waitlist: { entries: n(waitlist[0]?.entries), sessions: n(waitlist[0]?.sessions) },
        teamAlerts: { forgottenShifts: openShifts.filter((row) => String(row.localDate) < today).length, activeAbsences: n(absences[0]?.count), unassignedSessions: n(unassigned[0]?.count) },
        reviews: { transfers: n(transfers[0]?.count), forms: n(formReviews[0]?.count), bunkerLinks: n(bunkerReviews[0]?.count) },
      },
      week: {
        dueSoon: { assignments: n(dueSoon[0]?.count), windowDays: 7 },
        sessions: { lowOccupancy: lowSessions.slice(0, LIST_LIMIT).map(shortSession), fullWithWaitlist: fullWithWaitlist.slice(0, LIST_LIMIT).map(shortSession), thresholds: { lowOccupancyPercent: LOW_OCCUPANCY_PERCENT, lowOccupancyHoursAhead: 24 } },
        lowStock: { threshold: LOW_STOCK_UNITS, items: lowStock.map((row) => ({ productName: row.productName, variantLabel: row.variantLabel, stock: n(row.stock) })) },
        storeSales: { count: n(storeWeek[0]?.count), collectedCents: n(storeWeek[0]?.collectedCents), pendingCents: n(storeWeek[0]?.pendingCents) },
      },
      month: {
        newClients: { thisMonth: n(newClients[0]?.thisMonth), previousMonth: n(newClients[0]?.previousMonth) },
        revenue: {
          plans: { thisMonthCents: n(plansByMonth[0]?.thisMonth), previousMonthCents: n(plansByMonth[0]?.previousMonth) },
          store: { thisMonthCents: n(storeByMonth[0]?.thisMonth), previousMonthCents: n(storeByMonth[0]?.previousMonth) },
          byMethod,
        },
        occupancyBySlot: slotRows.map((row) => ({ serviceName: row.serviceName, hour: n(row.hour), sessions: n(row.sessions), occupancyPercent: n(row.capacity) > 0 ? Math.round((n(row.occupied) / n(row.capacity)) * 100) : 0 })),
        bunkerLinkedClients: n(bunker[0]?.count),
      },
    };
    } catch (error) {
      app.log.error({ route: "GET /api/admin/owner-panel", errorCode: typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "" }, "owner panel failed");
      return reply.code(500).send({ error: "internal_error" });
    }
  });
}
