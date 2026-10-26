import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';
import { countLabel } from './text.js';

type Database = ReturnType<typeof createDatabase>['client'];
const zone = 'Atlantic/Canary';
const homeBlock = z.enum(['agenda','attention','clients','communication','economics','team','shortcuts']);
const dashboardLayoutInput = z.object({order:z.array(homeBlock).max(7),hidden:z.array(homeBlock).max(7)}).strict().superRefine((value,context)=>{
  if(new Set(value.order).size!==value.order.length)context.addIssue({code:'custom',path:['order'],message:'El orden no puede repetir bloques.'});
  if(new Set(value.hidden).size!==value.hidden.length)context.addIssue({code:'custom',path:['hidden'],message:'La lista de bloques ocultos no puede repetir elementos.'});
});
const defaultDashboardLayout={order:['agenda','attention','clients','communication','economics','team','shortcuts'],hidden:[]};

type AttentionRecord = { id: string; kind: string; ageAt: string | Date | null };
export function sortAttentionItems<T extends AttentionRecord>(items: T[]): T[] {
  const priority: Record<string, number> = { sensitive_review: 0, overdue_payments: 1, pending_transfers: 2, consent_pending: 3, document_pending: 4, absence_sessions: 5, open_timeclock: 6, unassigned_session: 7, overdue_checkin: 8, waitlist: 9 };
  const epoch = (value: AttentionRecord['ageAt']) => value === null ? Number.POSITIVE_INFINITY : value instanceof Date ? value.getTime() : Date.parse(value);
  return [...items].sort((a, b) => (priority[a.kind] ?? 10) - (priority[b.kind] ?? 10) || epoch(a.ageAt) - epoch(b.ageAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function registerDashboardRoutes(
  app: FastifyInstance<any, any, any, any, any>,
  db: Database,
  resolve: (request: FastifyRequest) => Promise<AuthorizationContext | null>,
) {
  async function contextFor(request: FastifyRequest, reply: any) {
    const context = await resolve(request);
    if (!context) { reply.code(401).send({ error: 'authentication_required' }); return null; }
    return context;
  }

  app.get('/api/dashboard/preferences',async(request,reply)=>{
    reply.header('Cache-Control','no-store');const context=await contextFor(request,reply);if(!context)return;
    const [row]=await db`SELECT layout FROM dashboard_preferences WHERE actor_id=${context.actorId}`;
    return row?.layout??defaultDashboardLayout;
  });
  app.put('/api/dashboard/preferences',async(request,reply)=>{
    reply.header('Cache-Control','no-store');const context=await contextFor(request,reply);if(!context)return;
    const parsed=dashboardLayoutInput.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:'validation_error'});
    const layout={order:parsed.data.order,hidden:parsed.data.hidden};
    const [row]=await db`INSERT INTO dashboard_preferences(actor_id,layout,updated_at) VALUES (${context.actorId},${JSON.stringify(layout)}::jsonb,now()) ON CONFLICT(actor_id) DO UPDATE SET layout=EXCLUDED.layout,updated_at=now() RETURNING layout`;
    return row?.layout??defaultDashboardLayout;
  });

  app.get('/api/session/capabilities', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await contextFor(request, reply);
    if (!context) return;
    return {
      calendar: can(context, 'calendar.read'),
      clients: can(context, 'clients.read'),
      communications: can(context, 'communication.read'),
      billing: can(context, 'billing.read-basic'),
      staff: can(context, 'staff.read'),
      notificationSettings: can(context, 'settings.manage'),
      news: can(context, 'news.manage'),
      reservationManage: can(context, 'reservations.manage'),
      attendanceManage: can(context, 'reservations.attendance'),
      entitlementsRead: can(context, 'entitlements.read'),
      entitlementsManage: can(context, 'entitlements.manage'),
      paymentsManage: can(context, 'billing.payments.manage'),
      communicationSend: can(context, 'communication.send'),
      documentsRead: can(context, 'documents.read'),
      timeclockSelf: can(context, 'timeclock.self'),
      capacityOverride: can(context, 'scheduling.override_capacity'),
      catalogPricingManage: can(context, 'catalog.pricing.manage'),
      store: can(context, 'store.catalog.read'),
    };
  });

  app.get('/api/dashboard/command-center', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await contextFor(request, reply);
    if (!context) return;
    const permissions = {
      calendar: can(context, 'calendar.read'),
      clients: can(context, 'clients.read'),
      communications: can(context, 'communication.read'),
      documents: can(context, 'documents.read'),
      sensitiveReview: can(context, 'health.read') && can(context, 'forms.responses.sensitive.read'),
      followup: can(context, 'followup.read'),
      billing: can(context, 'billing.read-basic'),
      cash: can(context, 'billing.cash.manage') || can(context, 'billing.payments.manage'),
      ownerPanel: can(context, 'owner.panel.read'),
      transfers: can(context, 'billing.validate_transfer'),
      staff: can(context, 'staff.read'),
      timeclock: can(context, 'timeclock.read'),
    };
    try {
      const [today, clients, attentionData, economics, team, unread] = await Promise.all([
        permissions.calendar ? db`SELECT
          count(*) FILTER (WHERE s.status='scheduled')::int AS "sessionCount",
          count(*) FILTER (WHERE s.status='scheduled' AND s.starts_at >= now())::int AS "upcomingCount",
          COALESCE(sum(s.capacity) FILTER (WHERE s.status='scheduled'),0)::int AS capacity,
          COALESCE(sum(r.occupied) FILTER (WHERE s.status='scheduled'),0)::int AS occupied,
          COALESCE(sum(w.waiting) FILTER (WHERE s.status='scheduled'),0)::int AS "waitlistCount",
          count(*) FILTER (WHERE s.status='scheduled' AND s.professional_id IS NULL)::int AS "unassignedCount",
          (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'id',day.id,'serviceName',day.service_name,'professionalName',day.professional_name,'startsAt',day.starts_at,
              'occupied',day.occupied,'capacity',day.capacity,'free',GREATEST(day.capacity-day.occupied,0),
              'waitlistCount',day.waitlist_count,'isNow',day.starts_at<=now() AND day.ends_at>now(),
              'state',CASE WHEN day.starts_at<=now() AND day.ends_at>now() THEN 'in_progress' WHEN day.ends_at<=now() THEN 'finished' ELSE 'upcoming' END
            ) ORDER BY day.starts_at,day.id),'[]'::jsonb)
            FROM (SELECT cs.id,s.name AS service_name,sp.display_name AS professional_name,cs.starts_at,
                cs.starts_at+cs.duration_minutes*interval '1 minute' AS ends_at,cs.capacity,
                (SELECT count(*)::int FROM calendar_reservations r WHERE r.session_id=cs.id AND r.status IN ('reserved','attended','no_show')) AS occupied,
                (SELECT count(*)::int FROM calendar_waitlist_entries w WHERE w.session_id=cs.id AND w.status='waiting') AS waitlist_count
              FROM calendar_sessions cs JOIN services s ON s.id=cs.service_id LEFT JOIN staff_professionals sp ON sp.id=cs.professional_id
              WHERE cs.status='scheduled' AND cs.starts_at >= (((now() AT TIME ZONE ${zone})::date)::timestamp AT TIME ZONE ${zone})
                AND cs.starts_at < ((((now() AT TIME ZONE ${zone})::date + 1)::timestamp) AT TIME ZONE ${zone})) day
          ) AS sessions,
          (SELECT jsonb_build_object('id',n.id,'serviceName',ns.name,'startsAt',n.starts_at,'professionalName',np.display_name)
            FROM calendar_sessions n JOIN services ns ON ns.id=n.service_id LEFT JOIN staff_professionals np ON np.id=n.professional_id
            WHERE n.status='scheduled' AND n.starts_at >= (((now() AT TIME ZONE ${zone})::date)::timestamp AT TIME ZONE ${zone})
              AND n.starts_at < ((((now() AT TIME ZONE ${zone})::date + 1)::timestamp) AT TIME ZONE ${zone})
            ORDER BY n.starts_at LIMIT 1) AS "nextSession"
          FROM calendar_sessions s
          LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE status IN ('reserved','attended','no_show'))::int AS occupied FROM calendar_reservations WHERE session_id=s.id) r ON true
          LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE status='waiting')::int AS waiting FROM calendar_waitlist_entries WHERE session_id=s.id) w ON true
          WHERE s.starts_at >= (((now() AT TIME ZONE ${zone})::date)::timestamp AT TIME ZONE ${zone})
            AND s.starts_at < ((((now() AT TIME ZONE ${zone})::date + 1)::timestamp) AT TIME ZONE ${zone})` : Promise.resolve(null),
        permissions.clients ? db`SELECT
          count(*) FILTER (WHERE status='active')::int AS active,
          count(*) FILTER (WHERE status='active' AND created_at >= now() - interval '30 days')::int AS "recentSignups"
          FROM clients` : Promise.resolve(null),
        Promise.all([
          permissions.billing ? db`SELECT count(*)::int AS count, COALESCE(sum(balance),0)::bigint AS "balanceCents" FROM (
            SELECT c.id,(c.amount_cents-COALESCE(t.net,0))::bigint AS balance
            FROM economic_charges c LEFT JOIN LATERAL (SELECT sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END) AS net FROM economic_transactions WHERE charge_id=c.id) t ON true
            WHERE c.state='pending' AND c.due_on < (now() AT TIME ZONE ${zone})::date AND c.amount_cents > COALESCE(t.net,0)
              AND NOT (EXISTS (SELECT 1 FROM economic_transactions p WHERE p.charge_id=c.id AND p.kind='payment') AND COALESCE(t.net,0)=0)
          ) overdue` : Promise.resolve(null),
          permissions.documents && permissions.clients ? db`SELECT a.id,a.client_id AS "clientId",c.first_name AS "firstName",c.last_name AS "lastName",f.name,
              CASE WHEN f.category='par_q' OR f.sensitivity='health' THEN 'sensitive_review' ELSE 'document_pending' END AS kind,
              a.due_at AS due_at,a.assigned_at AS occurred_at
            FROM client_form_assignments a JOIN clients c ON c.id=a.client_id JOIN client_form_versions v ON v.id=a.form_version_id JOIN client_forms f ON f.id=v.form_id
            WHERE ((a.status='assigned' AND a.required=true) OR a.status='review_required') AND f.category<>'check_in'
              AND (f.category<>'par_q' AND f.sensitivity<>'health' OR ${permissions.sensitiveReview})
            ORDER BY COALESCE(a.due_at,a.assigned_at),a.id LIMIT 8` : Promise.resolve([]),
          permissions.documents && permissions.clients ? db`SELECT c.id AS "clientId",c.first_name AS "firstName",c.last_name AS "lastName",x.name,xv.title,x.required,xv.id AS "versionId"
            FROM client_consents x JOIN client_consent_versions xv ON xv.id=x.active_version_id JOIN clients c ON c.status='active'
            WHERE x.status='active' AND x.required=true AND NOT EXISTS (SELECT 1 FROM client_consent_acceptances a WHERE a.client_id=c.id AND a.consent_version_id=xv.id)
            ORDER BY x.name,c.last_name,c.first_name LIMIT 8` : Promise.resolve([]),
          permissions.calendar ? db`SELECT s.id,s.starts_at AS "startsAt",s.professional_id AS "professionalId",sv.name AS "serviceName"
            FROM calendar_sessions s JOIN services sv ON sv.id=s.service_id
            WHERE s.status='scheduled' AND s.starts_at >= now() AND s.professional_id IS NULL ORDER BY s.starts_at LIMIT 8` : Promise.resolve([]),
          permissions.calendar ? db`SELECT w.session_id AS "sessionId",s.starts_at AS "startsAt",sv.name AS "serviceName",count(*)::int AS count
            FROM calendar_waitlist_entries w JOIN calendar_sessions s ON s.id=w.session_id JOIN services sv ON sv.id=s.service_id
            WHERE w.status='waiting' AND s.status='scheduled' AND s.starts_at >= now()
            GROUP BY w.session_id,s.starts_at,sv.name ORDER BY s.starts_at LIMIT 8` : Promise.resolve([]),
          permissions.followup && permissions.clients ? db`SELECT a.client_id AS "clientId",c.first_name AS "firstName",c.last_name AS "lastName",f.name,a.due_at AS "dueAt"
            FROM client_form_assignments a JOIN clients c ON c.id=a.client_id JOIN client_form_versions v ON v.id=a.form_version_id JOIN client_forms f ON f.id=v.form_id
            WHERE f.category='check_in' AND a.status='assigned' AND a.due_at < now()
            ORDER BY a.due_at LIMIT 8` : Promise.resolve([]),
          permissions.transfers ? db`SELECT count(*)::int AS count FROM economic_transfer_proofs WHERE status='pending_validation'` : Promise.resolve(null),
          permissions.timeclock ? db`SELECT e.professional_id AS "professionalId",p.display_name AS "professionalName",e.at AS "occurredAt"
            FROM (SELECT DISTINCT ON (event.professional_id) event.professional_id,event.event_type,event.at
              FROM (SELECT e.professional_id,e.event_type,COALESCE(c.corrected_occurred_at,e.occurred_at) AS at,e.id
                FROM staff_timeclock_events e
                LEFT JOIN LATERAL (SELECT corrected_occurred_at FROM staff_timeclock_corrections WHERE event_id=e.id ORDER BY revision DESC LIMIT 1)c ON true) event
              ORDER BY event.professional_id,event.at DESC,event.id DESC) e
            JOIN staff_professionals p ON p.id=e.professional_id AND p.status='active'
            WHERE e.event_type='clock_in' AND (e.at AT TIME ZONE ${zone})::date < (now() AT TIME ZONE ${zone})::date
            ORDER BY e.at DESC,e.professional_id LIMIT 8` : Promise.resolve([]),
          permissions.staff && can(context, 'staff.absence.read') && permissions.calendar ? db`SELECT x.id,p.display_name AS "professionalName",x.starts_at AS "startsAt",count(s.id)::int AS "affectedSessions"
            FROM staff_exceptions x JOIN staff_professionals p ON p.id=x.professional_id LEFT JOIN calendar_sessions s ON s.professional_id=x.professional_id AND s.status='scheduled' AND s.starts_at>=now() AND s.starts_at<x.ends_at AND s.starts_at+s.duration_minutes*interval '1 minute'>x.starts_at
            WHERE x.status='active' AND x.kind<>'extra_availability' AND p.status='active' AND x.ends_at>now() GROUP BY x.id,p.display_name,x.starts_at HAVING count(s.id)>0 ORDER BY x.starts_at LIMIT 8` : Promise.resolve([]),
        ]),
        permissions.billing ? db`WITH charge_balances AS (
          SELECT c.id,c.state,c.due_on,c.amount_cents,COALESCE(x.paid,0) AS paid,COALESCE(x.net,0) AS net,
            CASE WHEN c.state<>'pending' OR (COALESCE(x.paid,0)>0 AND COALESCE(x.net,0)=0) THEN 0 ELSE GREATEST(c.amount_cents-COALESCE(x.net,0),0) END AS balance
          FROM economic_charges c LEFT JOIN LATERAL (SELECT sum(amount_cents) FILTER(WHERE kind='payment') paid,sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END) net FROM economic_transactions WHERE charge_id=c.id)x ON true
        ) SELECT
          COALESCE(sum(balance) FILTER (WHERE state='pending'),0)::bigint AS "pendingCents",
          count(*) FILTER (WHERE state='pending' AND balance>0 AND due_on < (now() AT TIME ZONE ${zone})::date)::int AS "overdueCount",
          COALESCE((SELECT sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END)::bigint FROM economic_transactions WHERE created_at >= (((now() AT TIME ZONE ${zone})::date)::timestamp AT TIME ZONE ${zone}) AND created_at < ((((now() AT TIME ZONE ${zone})::date + 1)::timestamp) AT TIME ZONE ${zone})),0)::bigint AS "collectedTodayCents",
          CASE WHEN ${permissions.cash} THEN COALESCE((SELECT jsonb_build_object('status',s.status,'openingCents',s.opening_cents,'expectedCents',COALESCE(s.expected_cents,s.opening_cents+COALESCE(cash.amount,0)+COALESCE(adj.amount,0)),'countedCents',s.counted_cents,'differenceCents',s.difference_cents) - CASE WHEN ${permissions.ownerPanel} THEN ARRAY[]::text[] ELSE ARRAY['expectedCents','differenceCents']::text[] END
            FROM economic_cash_sessions s
            LEFT JOIN LATERAL (SELECT COALESCE(sum(CASE WHEN t.kind='payment' THEN ps.amount_cents ELSE -ps.amount_cents END),0)::bigint AS amount FROM economic_transactions t JOIN economic_payment_splits ps ON ps.transaction_id=t.id WHERE t.cash_session_id=s.id AND ps.method='cash') cash ON true
            LEFT JOIN LATERAL (SELECT COALESCE(sum(amount_cents),0)::bigint AS amount FROM economic_cash_adjustments WHERE cash_session_id=s.id) adj ON true
            WHERE s.status='open' OR s.local_date=(now() AT TIME ZONE ${zone})::date
            ORDER BY (s.status='open') DESC,s.opened_at DESC LIMIT 1),'null'::jsonb) ELSE 'null'::jsonb END AS "cashSession"
          FROM charge_balances` : Promise.resolve(null),
        permissions.staff ? db`SELECT
          count(*) FILTER (WHERE p.status='active' AND latest.event_type='clock_in' AND (latest.at AT TIME ZONE ${zone})::date=(now() AT TIME ZONE ${zone})::date)::int AS "workingNow",
          (SELECT count(*)::int FROM staff_exceptions x JOIN staff_professionals active_staff ON active_staff.id=x.professional_id AND active_staff.status='active' WHERE x.status='active' AND x.kind<>'extra_availability' AND x.starts_at<=now() AND x.ends_at>now()) AS "activeAbsences",
          (SELECT count(*) FILTER (WHERE s.status='active')::int FROM staff_professionals s) AS active,
          (SELECT count(*)::int FROM staff_substitutions s WHERE s.status='active' AND s.starts_at<=now() AND s.ends_at>now()) AS substitutions
          FROM staff_professionals p LEFT JOIN LATERAL (
            SELECT e.event_type,COALESCE(c.corrected_occurred_at,e.occurred_at) AS at
            FROM staff_timeclock_events e LEFT JOIN LATERAL (SELECT corrected_occurred_at FROM staff_timeclock_corrections WHERE event_id=e.id ORDER BY revision DESC LIMIT 1)c ON true
            WHERE e.professional_id=p.id ORDER BY COALESCE(c.corrected_occurred_at,e.occurred_at) DESC,e.id DESC LIMIT 1
          )latest ON true` : Promise.resolve(null),
        permissions.communications ? db`SELECT count(*)::int AS count FROM communication_messages m WHERE m.sender_kind='client' AND NOT EXISTS (SELECT 1 FROM communication_message_reads r WHERE r.message_id=m.id AND r.reader_kind='center' AND r.is_read=true)` : Promise.resolve(null),
      ]);

      const [overdueResults, documentRows, consentRows, unassignedRows, waitlistRows, overdueCheckinRows, transferResults, openTimeclockRows, affectedAbsenceRows] = attentionData;
      const overdueRow = Array.isArray(overdueResults) ? overdueResults[0] : overdueResults;
      const transferRow = Array.isArray(transferResults) ? transferResults[0] : transferResults;
      const todaySummary = Array.isArray(today) ? today[0] ?? null : today;
      const clientsSummary = Array.isArray(clients) ? clients[0] ?? null : clients;
      const economicsSummary = Array.isArray(economics) ? economics[0] ?? null : economics;
      const teamSummary = Array.isArray(team) ? team[0] ?? null : team;
      const unreadSummary = Array.isArray(unread) ? unread[0] ?? null : unread;
      const attentionItems: Array<Record<string, unknown>> = [];
      if (overdueRow && Number(overdueRow.count) > 0) attentionItems.push({ id: 'overdue-payments', kind: 'overdue_payments', title: countLabel(Number(overdueRow.count), 'cargo vencido', 'cargos vencidos'), summary: 'Revisar saldos pendientes', href: '#economics', ageAt: null });
      for (const item of documentRows as any[]) attentionItems.push({
        id: `form-${item.id}`,
        kind: item.kind,
        title: item.kind === 'sensitive_review' ? 'Revisión de formulario pendiente' : 'Documento pendiente',
        summary: `${item.firstName} ${item.lastName} · ${item.name}`,
        href: `#clients?clientId=${item.clientId}&tab=documents`,
        ageAt: item.due_at ?? item.occurred_at,
      });
      for (const item of consentRows as any[]) attentionItems.push({ id: `consent-${item.clientId}-${item.versionId}`, kind: 'consent_pending', title: 'Consentimiento pendiente', summary: `${item.firstName} ${item.lastName} · ${item.name}`, href: `#clients?clientId=${item.clientId}&tab=documents`, ageAt: null });
      for (const item of unassignedRows as any[]) attentionItems.push({ id: `unassigned-${item.id}`, kind: 'unassigned_session', title: 'Sesión sin profesional', summary: item.serviceName, href: '#calendar', ageAt: item.startsAt });
      for (const item of waitlistRows as any[]) attentionItems.push({ id: `waitlist-${item.sessionId}`, kind: 'waitlist', title: 'Lista de espera por resolver', summary: `${item.count} ${Number(item.count) === 1 ? 'persona' : 'personas'} · ${item.serviceName}`, href: '#calendar', ageAt: item.startsAt });
      for (const item of overdueCheckinRows as any[]) attentionItems.push({ id: `checkin-${item.clientId}-${item.name}`, kind: 'overdue_checkin', title: 'Seguimiento vencido', summary: `${item.firstName} ${item.lastName} · ${item.name}`, href: `#clients?clientId=${item.clientId}&tab=followup`, ageAt: item.dueAt });
      if (transferRow && Number(transferRow.count) > 0) attentionItems.push({ id: 'pending-transfers', kind: 'pending_transfers', title: countLabel(Number(transferRow.count), 'transferencia por validar', 'transferencias por validar'), summary: 'Revisar justificantes recibidos', href: '#economics', ageAt: null });
      for (const item of openTimeclockRows as any[]) attentionItems.push({ id: `timeclock-${item.professionalId}`, kind: 'open_timeclock', title: 'Fichaje abierto', summary: item.professionalName, href: '#staff', ageAt: item.occurredAt });
      for (const item of affectedAbsenceRows as any[]) attentionItems.push({ id: `absence-${item.id}`, kind: 'absence_sessions', title: 'Ausencia con sesiones afectadas', summary: `${item.professionalName} · ${item.affectedSessions} ${Number(item.affectedSessions)===1?'sesión':'sesiones'}`, href: '#staff', ageAt: item.startsAt });
      const orderedAttention = sortAttentionItems(attentionItems as AttentionRecord[]);
      const canManageReservations = can(context, 'reservations.manage');
      const canCreateClient = can(context, 'clients.manage');
      const canSend = can(context, 'communication.send');
      const quickActions = [
        ...(canCreateClient ? [{ id: 'new-client', label: 'Abrir clientes', href: '#clients' }] : []),
        ...(canManageReservations ? [{ id: 'new-reservation', label: 'Abrir agenda', href: '#calendar' }] : []),
        ...(can(context, 'billing.payments.manage') ? [{ id: 'collect-payment', label: 'Abrir economía', href: '#economics' }] : []),
        ...(canSend ? [{ id: 'send-message', label: 'Abrir mensajes', href: '#communications' }] : []),
        ...(can(context, 'staff.absence.manage') ? [{ id: 'record-absence', label: 'Abrir equipo', href: '#staff' }] : []),
        ...(permissions.cash ? [{ id: 'cash', label: 'Abrir caja', href: '#economics' }] : []),
      ].slice(0, 6);
      return {
        timezone: zone,
        permissions,
        today: todaySummary ?? { sessionCount: 0, upcomingCount: 0, capacity: 0, occupied: 0, waitlistCount: 0, unassignedCount: 0, nextSession: null },
        clients: clientsSummary,
        attention: orderedAttention.slice(0, 12),
        economics: economicsSummary,
        team: teamSummary,
        unread: unreadSummary?.count ?? 0,
        quickActions,
      };
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown';
      app.log.error({ databaseCode: code, route: 'GET /api/dashboard/command-center' }, 'command center read model failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
  });

  app.get('/api/search', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await contextFor(request, reply);
    if (!context) return;
    const parsed = z.object({ q: z.string().trim().min(2).max(80) }).strict().safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    const term = parsed.data.q.normalize('NFKC').toLocaleLowerCase('es');
    try {
      const [clients, staff, services] = await Promise.all([
        can(context, 'clients.read') ? db`SELECT id,concat_ws(' ',first_name,last_name) AS label FROM clients WHERE status='active' AND strpos(unaccent(lower(concat_ws(' ',first_name,last_name))),unaccent(${term}))>0 ORDER BY lower(last_name),lower(first_name),id LIMIT 5` : Promise.resolve([]),
        can(context, 'staff.read') ? db`SELECT id,display_name AS label FROM staff_professionals WHERE status='active' AND strpos(unaccent(lower(display_name)),unaccent(${term}))>0 ORDER BY lower(display_name),id LIMIT 5` : Promise.resolve([]),
        can(context, 'calendar.read') ? db`SELECT id,name AS label FROM services WHERE status='active' AND strpos(unaccent(lower(name)),unaccent(${term}))>0 ORDER BY lower(name),id LIMIT 5` : Promise.resolve([]),
      ]);
      return { groups: [
        ...(can(context, 'clients.read') ? [{ type: 'clients', label: 'Clientes', items: clients }] : []),
        ...(can(context, 'staff.read') ? [{ type: 'team', label: 'Equipo', items: staff }] : []),
        ...(can(context, 'calendar.read') ? [{ type: 'services', label: 'Servicios', items: services }] : []),
      ] };
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown';
      app.log.error({ databaseCode: code, route: 'GET /api/search' }, 'global search failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
  });
}
