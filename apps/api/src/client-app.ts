import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { createDatabase } from './db.js';
import type { ClientAuthorizationContext } from './communications.js';
import type { BookingEligibilityResolver } from './booking-eligibility.js';
import { materializeCalendarTemplates } from './calendar-materializer.js';
import type { TrainingAdapter } from './training-integration.js';
import { memberTrainingCapabilities } from './training-capabilities-api.js';
import { canaryBusinessDate, canaryLocalMidnightUtc } from '@2j/domain';
import { evaluateTermPaymentAccess } from './term-payment-access.js';

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
  memberNow: () => Date = () => new Date(),
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

  app.get('/api/me/booking-services', async (request, reply) => {
    const actor = await client(request, reply); if (!actor) return;
    const services = await db`
      SELECT DISTINCT sv.id,sv.name
      FROM services sv
      WHERE sv.status='active' AND EXISTS (
        SELECT 1 FROM calendar_sessions s JOIN areas a ON a.id=s.area_id
        WHERE s.service_id=sv.id AND s.status='scheduled' AND s.starts_at>now() AND a.status='active'
          AND (s.individual_client_id IS NULL OR s.individual_client_id=${actor.clientId})
      )
      ORDER BY sv.name,sv.id LIMIT 100`;
    return { services };
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
    const now = memberNow();
    const localDate = canaryBusinessDate(now);
    const assignments = await db`
      SELECT a.id,a.starts_on::text AS "startsOn",a.ends_on::text AS "endsOn",a.status,
        COALESCE(a.snapshot->>'name',p.name) AS "planName",v.kind,
        v.term_kind AS "termKind",c.id AS "linkedChargeId",c.due_on::text AS "dueOn",c.state AS "chargeState",c.amount_cents AS "amountCents",
        t.payment_rule AS "paymentRule",t.payment_block AS "paymentBlock",t.deadline_computation AS deadline,
        t.term_kind AS "contractTermKind",t.assigned_local_date::text AS "assignedLocalDate",
        COALESCE(x.paid_cents,0)::bigint AS "paidCents",COALESCE(x.net_cents,0)::bigint AS "netCents",
        COALESCE(x.payments,'[]'::jsonb) AS payments,
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',r.id,'rightType',r.right_type,'trainingAccessLevel',r.training_access_level,'serviceId',r.service_id,'serviceName',sv.name,'serviceStatus',sv.status,'quantity',r.quantity,'period',r.period,'balance',CASE WHEN r.right_type='sessions_quota' THEN (SELECT COALESCE(sum(l.quantity),0)::int FROM client_entitlement_ledger l WHERE l.assignment_id=a.id AND l.right_key=r.id::text) ELSE NULL END) ORDER BY r.right_type,r.id),'[]'::jsonb) FROM plan_rights r LEFT JOIN services sv ON sv.id=r.service_id WHERE r.plan_id=a.plan_id AND r.plan_version=a.plan_version) AS rights,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('module',m.module,'accessLevel',m.access_level,'capabilities',COALESCE((SELECT jsonb_agg(c.capability ORDER BY c.capability) FROM plan_module_capabilities c WHERE c.plan_id=m.plan_id AND c.plan_version=m.plan_version AND c.module=m.module),'[]'::jsonb)) ORDER BY m.module) FROM plan_module_accesses m WHERE m.plan_id=a.plan_id AND m.plan_version=a.plan_version),'[]'::jsonb) AS modules,
        COALESCE((SELECT e.event_type FROM client_plan_assignment_events e WHERE e.assignment_id=a.id AND e.effective_on<=${localDate}::date ORDER BY e.effective_on DESC,e.created_at DESC,e.id DESC LIMIT 1),'activated') AS "lastEvent"
      FROM client_plan_assignments a JOIN plans p ON p.id=a.plan_id JOIN plan_versions v ON v.plan_id=a.plan_id AND v.version=a.plan_version
      LEFT JOIN economic_charges c ON c.id=a.charge_id AND c.client_id=a.client_id AND c.plan_id=a.plan_id
      LEFT JOIN assignment_contract_terms t ON t.assignment_id=a.id
      LEFT JOIN LATERAL (SELECT sum(amount_cents) FILTER(WHERE kind='payment') AS paid_cents,
        sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END) AS net_cents,
        jsonb_agg(jsonb_build_object('amountCents',amount_cents,'occurredAt',created_at) ORDER BY created_at,id) FILTER(WHERE kind='payment') AS payments
        FROM economic_transactions WHERE charge_id=c.id) x ON true
      WHERE a.client_id=${actor.clientId} ORDER BY a.starts_on DESC,a.created_at DESC,a.id DESC LIMIT 100`;
    const paymentAccess = await db.begin(tx => evaluateTermPaymentAccess(tx, assignments.map((item: any) => ({ assignmentId: String(item.id), termKind: item.termKind == null ? null : String(item.termKind) })), now));
    const derivedAssignments = assignments.map((item: any) => {
      const assignmentStatus = item.lastEvent === 'paused' ? 'paused' : item.lastEvent === 'cancelled' || item.lastEvent === 'changed' ? 'cancelled' : item.startsOn > localDate ? 'scheduled' : item.endsOn && item.endsOn < localDate ? 'expired' : item.status;
      const chargeState = item.chargeState == null ? null : String(item.chargeState);
      const amountCents = item.amountCents == null ? null : Number(item.amountCents);
      const paidCents = Number(item.paidCents ?? 0);
      const netCents = Number(item.netCents ?? 0);
      const pendingAmountCents = chargeState === 'void' || chargeState === 'exempt' || !amountCents || (paidCents > 0 && netCents === 0) ? 0 : Math.max(0, amountCents - netCents);
      const paymentStatus = chargeState === 'void' ? 'void'
        : chargeState === 'exempt' ? 'exempt'
        : paidCents > 0 && netCents === 0 ? 'refunded'
        : amountCents !== null && netCents >= amountCents ? 'paid'
        : pendingAmountCents > 0 && item.dueOn && item.dueOn < localDate ? 'unpaid'
        : netCents > 0 ? 'partially_paid' : 'pending';
      const termAccess = paymentAccess.get(String(item.id));
      const accessStatus = assignmentStatus === 'expired' || assignmentStatus === 'cancelled' ? 'ended'
        : assignmentStatus === 'paused' ? 'paused'
        : assignmentStatus === 'scheduled' ? 'scheduled'
        : termAccess?.state === 'payment_overdue' ? 'blocked_unpaid'
        : termAccess?.state === 'payment_pending' ? 'provisional'
        : termAccess?.state === 'entitlement_unavailable' ? 'unavailable'
        : assignmentStatus === 'active' ? 'active' : 'ended';
      const blockDate = termAccess?.paymentBlockEffectiveOn ?? null;
      const payment = !item.linkedChargeId ? null : {
        status: paymentStatus,
        accessStatus,
        amountCents,
        paidCents: Math.max(0, netCents),
        pendingAmountCents,
        dueOn: item.dueOn ?? null,
        effectiveBlockAt: blockDate ? canaryLocalMidnightIso(blockDate) : null,
        timezone: 'Atlantic/Canary',
        payments: item.payments ?? [],
      };
      const { linkedChargeId: _linkedChargeId, chargeState: _chargeState, amountCents: _amountCents, paidCents: _paidCents, netCents: _netCents, termKind: _termKind, paymentRule: _paymentRule, paymentBlock: _paymentBlock, deadline: _deadline, contractTermKind: _contractTermKind, assignedLocalDate: _assignedLocalDate, payments: _payments, ...publicItem } = item;
      return { ...publicItem, status: assignmentStatus, payment };
    });
    const active = derivedAssignments.filter((item: any) => item.status === 'active');
    // V2.1 capabilities computed here from the member's own session: Home gets them without any service signature. Absent when the member has no active person yet.
    const [personRow] = await db`
      SELECT p.id FROM platform_person_clients pc JOIN platform_persons p ON p.id=pc.person_id AND p.status='active'
      WHERE pc.client_id=${actor.clientId}::uuid AND (${actor.personId ?? null}::uuid IS NULL OR pc.person_id=${actor.personId ?? null}::uuid) LIMIT 1`;
    const trainingCapabilities = personRow ? await memberTrainingCapabilities(db, String(personRow.id)) : null;
    return { asOf: localDate, timezone: 'Atlantic/Canary', assignments: derivedAssignments, active, trainingCapabilities };
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
        (SELECT w.status FROM calendar_waitlist_entries w WHERE w.session_id=s.id AND w.client_id=${actor.clientId} AND w.status IN ('waiting','promoted') ORDER BY w.created_at DESC,w.id DESC LIMIT 1) AS "myWaitlistStatus",
        (SELECT w.id FROM calendar_waitlist_entries w WHERE w.session_id=s.id AND w.client_id=${actor.clientId} AND w.status='waiting' ORDER BY w.created_at DESC,w.id DESC LIMIT 1) AS "myWaitlistId"
      FROM calendar_sessions s JOIN services sv ON sv.id=s.service_id JOIN areas a ON a.id=s.area_id LEFT JOIN staff_professionals sp ON sp.id=s.professional_id AND sp.status='active'
      WHERE s.starts_at >= (${query.data.from}::date::timestamp AT TIME ZONE 'Atlantic/Canary') AND s.starts_at < ((${query.data.to}::date + 1)::timestamp AT TIME ZONE 'Atlantic/Canary')
        AND s.status='scheduled' AND sv.status='active' AND a.status='active' AND (s.individual_client_id IS NULL OR s.individual_client_id=${actor.clientId})
      ORDER BY s.starts_at,s.id LIMIT 300`;
    const evaluated: any[] = [];
    const eligibilityNow = memberNow();
    // Leave most of the API pool available to staff and admin traffic. The
    // underlying query is already capped at 300 sessions per request.
    for (let index = 0; index < sessions.length; index += 2) {
      const batch = sessions.slice(index, index + 2);
      evaluated.push(...await Promise.all(batch.map(async (session: any) => {
        const eligibility = await db.begin(tx => resolveEligibility({ tx, clientId: actor.clientId, serviceId: session.serviceId, startsAt: session.startsAt instanceof Date ? session.startsAt.toISOString() : String(session.startsAt), sessionId: session.id, ...(session.myWaitlistId == null ? {} : { ignoreWaitlistId: String(session.myWaitlistId) }), allowFullSession: true, now: eligibilityNow }));
        const availability = memberSessionAvailability(eligibility, session.myReservationStatus, session.myWaitlistStatus);
        const { myWaitlistId: _myWaitlistId, ...publicSession } = session;
        return { ...publicSession, availability };
      })));
    }
    return { timezone: 'Atlantic/Canary', sessions: evaluated };
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
        (SELECT w.status FROM calendar_waitlist_entries w WHERE w.session_id=s.id AND w.client_id=${actor.clientId} AND w.status IN ('waiting','promoted') ORDER BY w.created_at DESC,w.id DESC LIMIT 1) AS "myWaitlistStatus",
        (SELECT w.id FROM calendar_waitlist_entries w WHERE w.session_id=s.id AND w.client_id=${actor.clientId} AND w.status='waiting' ORDER BY w.created_at DESC,w.id DESC LIMIT 1) AS "myWaitlistId"
      FROM calendar_sessions s JOIN services sv ON sv.id=s.service_id JOIN areas a ON a.id=s.area_id LEFT JOIN staff_professionals sp ON sp.id=s.professional_id AND sp.status='active'
      WHERE s.id=${params.data.sessionId} AND s.status='scheduled' AND sv.status='active' AND a.status='active' AND (s.individual_client_id IS NULL OR s.individual_client_id=${actor.clientId})`;
    if (!session) return reply.code(404).send({ error: 'session_not_found' });
    const eligibility = await db.begin(tx => resolveEligibility({ tx, clientId: actor.clientId, serviceId: session.serviceId, startsAt: session.startsAt instanceof Date ? session.startsAt.toISOString() : String(session.startsAt), sessionId: session.id, ...(session.myWaitlistId == null ? {} : { ignoreWaitlistId: String(session.myWaitlistId) }), allowFullSession: true, now: memberNow() }));
    const availability = memberSessionAvailability(eligibility, session.myReservationStatus, session.myWaitlistStatus);
    const { myWaitlistId: _myWaitlistId, myReservationStatus: _myReservationStatus, myWaitlistStatus: _myWaitlistStatus, ...publicSession } = session;
    return { timezone: 'Atlantic/Canary', session: { ...publicSession, eligible: availability.status === 'available' || availability.status === 'full' || availability.status === 'waitlisted' || availability.status === 'booked', availability, canJoinWaitlist: availability.canJoinWaitlist, availableAlternatives: eligibility.availableAlternatives ?? [] } };
  });
}

function memberSessionAvailability(
  eligibility: Awaited<ReturnType<BookingEligibilityResolver>>,
  reservationStatus: unknown,
  waitlistStatus: unknown,
): { status: 'available' | 'full' | 'booked' | 'not_allowed_by_plan' | 'waitlisted' | 'waitlist_suspended'; reason: string | null; canJoinWaitlist: boolean } {
  if (['reserved','attended','no_show','cancelled_late'].includes(String(reservationStatus))) return { status: 'booked', reason: null, canJoinWaitlist: false };
  const waitlisted = waitlistStatus === 'waiting';
  if (waitlisted && !eligibility.eligible) return { status: 'waitlist_suspended', reason: null, canJoinWaitlist: false };
  if (waitlisted) return { status: 'waitlisted', reason: null, canJoinWaitlist: false };
  if (!eligibility.eligible) return { status: 'not_allowed_by_plan', reason: memberEligibilityReason(eligibility.reason), canJoinWaitlist: false };
  if (Number(eligibility.capacity?.available ?? 1) <= 0) return { status: 'full', reason: null, canJoinWaitlist: Boolean(eligibility.waitlistAllowed) };
  return { status: 'available', reason: null, canJoinWaitlist: false };
}

function canaryLocalMidnightIso(date: string): string {
  const midnightUtc = canaryLocalMidnightUtc(date);
  const [year, month, day] = date.split('-').map(Number);
  const offsetMinutes = Math.round((Date.UTC(year!, month! - 1, day!) - midnightUtc.getTime()) / 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, '0');
  const minutes = String(absoluteMinutes % 60).padStart(2, '0');
  return `${date}T00:00:00${sign}${hours}:${minutes}`;
}

function memberEligibilityReason(reason: string): string {
  switch (reason) {
    case 'debt_restriction': return 'payment_blocked';
    case 'no_entitlement': return 'no_entitlement';
    case 'entitlement_not_started': return 'entitlement_not_started';
    case 'entitlement_expired': return 'entitlement_expired';
    case 'entitlement_paused': return 'entitlement_paused';
    case 'entitlement_cancelled': return 'entitlement_cancelled';
    case 'entitlement_exhausted': return 'entitlement_exhausted';
    case 'weekly_limit_reached': return 'weekly_limit_reached';
    case 'monthly_limit_reached': return 'monthly_limit_reached';
    case 'service_not_allowed': return 'service_not_allowed';
    case 'required_document_missing': return 'required_document_missing';
    case 'session_started': return 'session_started';
    case 'client_inactive': return 'client_inactive';
    default: return 'entitlement_unavailable';
  }
}
