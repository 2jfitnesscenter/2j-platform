import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { createDatabase } from './db.js';
import type { ClientAuthorizationContext } from './communications.js';
import type { BookingEligibilityResolver } from './booking-eligibility.js';
import { materializeCalendarTemplates } from './calendar-materializer.js';
import type { TrainingAdapter } from './training-integration.js';

type DB = ReturnType<typeof createDatabase>['client'];
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Self-service reads always derive the client id from the authenticated session resolver. */
export function registerClientAppRoutes(
  app: FastifyInstance,
  db: DB,
  resolveClient: (request: FastifyRequest) => Promise<ClientAuthorizationContext | null>,
  resolveEligibility: BookingEligibilityResolver,
  memberBookingEnabled = false,
  trainingAdapter?: TrainingAdapter,
) {
  async function client(request: FastifyRequest, reply: any) {
    reply.header('Cache-Control', 'no-store');
    const actor = await resolveClient(request);
    if (!actor) { reply.code(401).send({ error: 'client_authentication_required' }); return null; }
    if (!uuid.safeParse(actor.clientId).success) { reply.code(401).send({ error: 'client_authentication_required' }); return null; }
    const clientId = actor.clientId.toLowerCase();
    const [activeClient] = await db`SELECT id FROM clients WHERE id=${clientId} AND status='active'`;
    if (!activeClient) { reply.code(401).send({ error: 'client_authentication_required' }); return null; }
    return { clientId, ...(actor.personId ? { personId: actor.personId } : {}) };
  }

  async function canonicalMemberPerson(actor: { clientId: string; personId?: string }, reply: any) {
    const [person] = await db`
      SELECT p.id FROM platform_person_clients pc
      JOIN platform_persons p ON p.id=pc.person_id AND p.status='active'
      WHERE pc.client_id=${actor.clientId}::uuid
        AND (${actor.personId ?? null}::uuid IS NULL OR pc.person_id=${actor.personId ?? null}::uuid)
      LIMIT 1`;
    if (!person) { reply.code(409).send({ error: 'member_identity_unavailable' }); return null; }
    return String(person.id);
  }

  const defaultPreferences = { appearance: 'system' as const, language: 'es' as const };
  app.get('/api/me/preferences', async (request, reply) => {
    const actor = await client(request, reply); if (!actor) return;
    const personId = await canonicalMemberPerson(actor, reply); if (!personId) return;
    const [row] = await db`SELECT appearance,language FROM platform_member_preferences WHERE person_id=${personId}::uuid`;
    return { preferences: row ? { appearance: row.appearance, language: row.language } : defaultPreferences };
  });

  app.patch('/api/me/preferences', async (request, reply) => {
    const actor = await client(request, reply); if (!actor) return;
    const personId = await canonicalMemberPerson(actor, reply); if (!personId) return;
    const parsed = z.object({ appearance: z.enum(['system','light','dark']).optional(), language: z.literal('es').optional() }).strict().refine(value => Object.keys(value).length > 0).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_preferences' });
    const [row] = await db.begin(async tx => {
      await tx`INSERT INTO platform_member_preferences(person_id) VALUES (${personId}::uuid) ON CONFLICT(person_id) DO NOTHING`;
      const [updated] = await tx`
        UPDATE platform_member_preferences SET
          appearance=COALESCE(${parsed.data.appearance ?? null},appearance),
          language=COALESCE(${parsed.data.language ?? null},language), updated_at=now()
        WHERE person_id=${personId}::uuid RETURNING appearance,language`;
      return [updated];
    });
    return { preferences: { appearance: row?.appearance ?? defaultPreferences.appearance, language: row?.language ?? defaultPreferences.language } };
  });

  app.get('/api/me/booking-access', async (request, reply) => {
    const actor = await client(request, reply); if (!actor) return;
    if (!memberBookingEnabled || !actor.personId) return { enabled: false };
    const [row] = await db`SELECT 1 AS enabled FROM platform_member_booking_pilot_cohort WHERE person_id=${actor.personId}::uuid AND status='active'`;
    return { enabled: Boolean(row) };
  });

  app.get('/api/me', async (request, reply) => {
    const actor = await client(request, reply); if (!actor) return;
    const [profile] = await db`SELECT id,first_name AS "firstName",last_name AS "lastName",email,phone,status FROM clients WHERE id=${actor.clientId} AND status='active'`;
    if (!profile) return reply.code(401).send({ error: 'client_authentication_required' });
    return { profile };
  });

  app.get('/api/me/training-summary', async (request, reply) => {
    const actor = await client(request, reply); if (!actor) return;
    if (!actor.personId) return { status: 'not_linked' as const };
    const [link] = await db`SELECT l.training_user_id AS "trainingUserId"
      FROM training_account_links l JOIN platform_persons p ON p.id=l.person_id
      WHERE l.person_id=${actor.personId}::uuid AND l.status='active' AND p.status='active'`;
    if (!link) return { status: 'not_linked' as const };
    const result = await trainingAdapter?.getSummary(String(link.trainingUserId)) ?? { status: 'disabled' as const };
    if (result.status !== 'available' || !result.summary) return { status: 'linked' as const, summaryStatus: 'unavailable' as const };
    const { trainingStatus, asOf, currentProgram, recentActivity } = result.summary;
    return {
      status: 'linked' as const,
      summaryStatus: 'available' as const,
      summary: {
        trainingStatus, asOf,
        ...(currentProgram ? { currentProgram: { name: currentProgram.name } } : {}),
        ...(recentActivity ? { recentActivity } : {}),
      },
    };
  });

  app.get('/api/me/membership', async (request, reply) => {
    const actor = await client(request, reply); if (!actor) return;
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const assignments = await db`
      SELECT a.id,a.starts_on::text AS "startsOn",a.ends_on::text AS "endsOn",a.status,
        COALESCE(a.snapshot->>'name',p.name) AS "planName",v.kind,
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',r.id,'rightType',r.right_type,'serviceId',r.service_id,'serviceName',sv.name,'serviceStatus',sv.status,'quantity',r.quantity,'period',r.period,'balance',CASE WHEN r.right_type='sessions_quota' THEN (SELECT COALESCE(sum(l.quantity),0)::int FROM client_entitlement_ledger l WHERE l.assignment_id=a.id AND l.right_key=r.id::text) ELSE NULL END) ORDER BY r.right_type,r.id),'[]'::jsonb) FROM plan_rights r LEFT JOIN services sv ON sv.id=r.service_id WHERE r.plan_id=a.plan_id AND r.plan_version=a.plan_version) AS rights,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('module',m.module,'accessLevel',m.access_level,'capabilities',COALESCE((SELECT jsonb_agg(c.capability ORDER BY c.capability) FROM plan_module_capabilities c WHERE c.plan_id=m.plan_id AND c.plan_version=m.plan_version AND c.module=m.module),'[]'::jsonb)) ORDER BY m.module) FROM plan_module_accesses m WHERE m.plan_id=a.plan_id AND m.plan_version=a.plan_version),'[]'::jsonb) AS modules,
        COALESCE((SELECT e.event_type FROM client_plan_assignment_events e WHERE e.assignment_id=a.id AND e.effective_on<=${localDate}::date ORDER BY e.effective_on DESC,e.created_at DESC,e.id DESC LIMIT 1),'activated') AS "lastEvent"
      FROM client_plan_assignments a JOIN plans p ON p.id=a.plan_id JOIN plan_versions v ON v.plan_id=a.plan_id AND v.version=a.plan_version
      WHERE a.client_id=${actor.clientId} ORDER BY a.starts_on DESC,a.created_at DESC,a.id DESC LIMIT 100`;
    const derivedAssignments = assignments.map((item: any) => ({ ...item, status: item.lastEvent === 'paused' ? 'paused' : item.lastEvent === 'cancelled' || item.lastEvent === 'changed' ? 'cancelled' : item.startsOn > localDate ? 'scheduled' : item.endsOn && item.endsOn < localDate ? 'expired' : item.status }));
    const active = derivedAssignments.filter((item: any) => item.status === 'active');
    return { asOf: localDate, timezone: 'Atlantic/Canary', assignments: derivedAssignments, active };
  });

  app.get('/api/me/bookings', async (request, reply) => {
    const actor = await client(request, reply); if (!actor) return;
    const reservations = await db`
      SELECT r.id,r.status,s.id AS "sessionId",s.starts_at AS "startsAt",s.duration_minutes AS "durationMinutes",s.capacity,
        sv.name AS "serviceName",a.name AS "areaName",s.status AS "sessionStatus",(s.individual_client_id IS NOT NULL) AS "isIndividual",r.created_at AS "createdAt"
      FROM calendar_reservations r JOIN calendar_sessions s ON s.id=r.session_id JOIN services sv ON sv.id=s.service_id JOIN areas a ON a.id=s.area_id
      WHERE r.client_id=${actor.clientId} ORDER BY s.starts_at DESC,r.created_at DESC,r.id DESC LIMIT 200`;
    const waitlist = await db`
      SELECT w.id,w.status,s.id AS "sessionId",s.starts_at AS "startsAt",s.duration_minutes AS "durationMinutes",sv.name AS "serviceName",a.name AS "areaName",s.status AS "sessionStatus",w.created_at AS "createdAt"
      FROM calendar_waitlist_entries w JOIN calendar_sessions s ON s.id=w.session_id JOIN services sv ON sv.id=s.service_id JOIN areas a ON a.id=s.area_id
      WHERE w.client_id=${actor.clientId} ORDER BY s.starts_at DESC,w.created_at DESC,w.id DESC LIMIT 200`;
    return { reservations, waitlist };
  });

  app.get('/api/me/bookings/:reservationId/cancellation-preview', async (request, reply) => {
    const actor = await client(request, reply); if (!actor) return;
    const params = z.object({ reservationId: uuid }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_reservation_id' });
    const [row] = await db`SELECT r.id,r.status,s.starts_at AS "startsAt",sv.cancellation_window_minutes AS "windowMinutes",sv.late_cancellation_policy AS "latePolicy"
      FROM calendar_reservations r JOIN calendar_sessions s ON s.id=r.session_id JOIN services sv ON sv.id=s.service_id
      WHERE r.id=${params.data.reservationId} AND r.client_id=${actor.clientId}`;
    if (!row) return reply.code(404).send({ error: 'reservation_not_found' });
    const minutes = Math.floor((new Date(String(row.startsAt)).getTime() - Date.now()) / 60_000);
    const late = minutes < Number(row.windowMinutes);
    const restoresEntitlement = !late || row.latePolicy === 'restore';
    return { reservationId: row.id, status: row.status, canCancel: row.status === 'reserved', cancellation: { late, minutesUntilStart: minutes, policy: row.latePolicy, restoresEntitlement, summary: late && !restoresEntitlement ? 'Cancelación tardía: la sesión seguirá consumida.' : 'Si cancelas ahora, recuperarás la sesión.' } };
  });

  app.get('/api/me/sessions', async (request, reply) => {
    const actor = await client(request, reply); if (!actor) return;
    const query = z.object({ from: date, to: date }).strict().safeParse(request.query);
    if (!query.success || query.data.to < query.data.from || (Date.parse(`${query.data.to}T00:00:00Z`) - Date.parse(`${query.data.from}T00:00:00Z`)) > 31 * 86_400_000) return reply.code(400).send({ error: 'invalid_date_range' });
    await db.begin((tx) => materializeCalendarTemplates(tx));
    const sessions = await db`
      SELECT s.id,s.starts_at AS "startsAt",s.duration_minutes AS "durationMinutes",s.capacity,s.status,s.individual_client_id IS NOT NULL AS "isIndividual",sp.display_name AS "professionalName",
        sv.id AS "serviceId",sv.name AS "serviceName",a.id AS "areaId",a.name AS "areaName",
        (SELECT count(*)::int FROM calendar_reservations r WHERE r.session_id=s.id AND r.status IN ('reserved','attended','no_show','cancelled_late')) AS "occupiedCount",
        (SELECT count(*)::int FROM calendar_waitlist_entries w WHERE w.session_id=s.id AND w.status='waiting') AS "waitlistCount",
        (SELECT r.status FROM calendar_reservations r WHERE r.session_id=s.id AND r.client_id=${actor.clientId} AND r.status IN ('reserved','attended','no_show','cancelled_late') ORDER BY r.created_at DESC,r.id DESC LIMIT 1) AS "myReservationStatus",
        (SELECT w.status FROM calendar_waitlist_entries w WHERE w.session_id=s.id AND w.client_id=${actor.clientId} AND w.status IN ('waiting','promoted') ORDER BY w.created_at DESC,w.id DESC LIMIT 1) AS "myWaitlistStatus"
      FROM calendar_sessions s JOIN services sv ON sv.id=s.service_id JOIN areas a ON a.id=s.area_id LEFT JOIN staff_professionals sp ON sp.id=s.professional_id AND sp.status='active'
      WHERE s.starts_at >= (${query.data.from}::date::timestamp AT TIME ZONE 'Atlantic/Canary') AND s.starts_at < ((${query.data.to}::date + 1)::timestamp AT TIME ZONE 'Atlantic/Canary')
        AND s.status='scheduled' AND sv.status='active' AND a.status='active' AND (s.individual_client_id IS NULL OR s.individual_client_id=${actor.clientId})
      ORDER BY s.starts_at,s.id LIMIT 300`;
    return { timezone: 'Atlantic/Canary', sessions };
  });

  app.get('/api/me/sessions/:sessionId', async (request, reply) => {
    const actor = await client(request, reply); if (!actor) return;
    const params = z.object({ sessionId: uuid }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_session_id' });
    const [session] = await db`
      SELECT s.id,s.starts_at AS "startsAt",s.duration_minutes AS "durationMinutes",s.capacity,s.status,s.individual_client_id IS NOT NULL AS "isIndividual",sp.display_name AS "professionalName",
        sv.id AS "serviceId",sv.name AS "serviceName",a.id AS "areaId",a.name AS "areaName",
        (SELECT count(*)::int FROM calendar_reservations r WHERE r.session_id=s.id AND r.status IN ('reserved','attended','no_show','cancelled_late')) AS "occupiedCount",
        (SELECT count(*)::int FROM calendar_waitlist_entries w WHERE w.session_id=s.id AND w.status='waiting') AS "waitlistCount",
        (SELECT r.status FROM calendar_reservations r WHERE r.session_id=s.id AND r.client_id=${actor.clientId} AND r.status IN ('reserved','attended','no_show','cancelled_late') ORDER BY r.created_at DESC,r.id DESC LIMIT 1) AS "myReservationStatus",
        (SELECT w.status FROM calendar_waitlist_entries w WHERE w.session_id=s.id AND w.client_id=${actor.clientId} AND w.status IN ('waiting','promoted') ORDER BY w.created_at DESC,w.id DESC LIMIT 1) AS "myWaitlistStatus"
      FROM calendar_sessions s JOIN services sv ON sv.id=s.service_id JOIN areas a ON a.id=s.area_id LEFT JOIN staff_professionals sp ON sp.id=s.professional_id AND sp.status='active'
      WHERE s.id=${params.data.sessionId} AND s.status='scheduled' AND sv.status='active' AND a.status='active' AND (s.individual_client_id IS NULL OR s.individual_client_id=${actor.clientId})`;
    if (!session) return reply.code(404).send({ error: 'session_not_found' });
    const eligibility = await db.begin(tx => resolveEligibility({ tx, clientId: actor.clientId, serviceId: session.serviceId, startsAt: session.startsAt instanceof Date ? session.startsAt.toISOString() : String(session.startsAt), sessionId: session.id, allowFullSession: true }));
    const eligibilityReason = eligibility.eligible ? null : eligibility.reason;
    return { timezone: 'Atlantic/Canary', session: { ...session, eligible: eligibility.eligible, eligibilityReason, canJoinWaitlist: eligibility.waitlistAllowed ?? eligibilityReason === 'session_full', availableAlternatives: eligibility.availableAlternatives ?? [] } };
  });
}
