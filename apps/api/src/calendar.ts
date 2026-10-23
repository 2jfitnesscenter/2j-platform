import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';
import type { TransactionSql } from 'postgres';
import { createHash, randomUUID } from 'node:crypto';
import { createBookingEligibilityResolver, type BookingEntitlementOption, type BookingEligibilityResolver, type BookingEligibilityResult } from './booking-eligibility.js';
import type { ClientAuthorizationContext } from './communications.js';
import { appendNotificationEvent } from './notifications.js';
import { materializeCalendarTemplates } from './calendar-materializer.js';

type SqlClient = ReturnType<typeof createDatabase>['client'];
type SqlTransaction = TransactionSql<Record<string, unknown>>;
const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const sessionFields = {
  serviceId: uuid,
  areaId: uuid,
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(5).max(480),
  capacity: z.number().int().min(1).max(500),
};
export const createSessionInput = z.object({ ...sessionFields, individualClientId: uuid.optional(), entitlementAssignmentId: uuid.optional(), professionalId: uuid.optional(), overrideAvailability: z.boolean().optional().default(false), availabilityReason: z.string().trim().min(3).max(240).optional(), overrideDebt: z.boolean().optional().default(false), overrideReason: z.string().trim().min(3).max(240).optional(), overrideDocuments: z.boolean().optional().default(false), documentOverrideReason: z.string().trim().min(3).max(240).optional() }).strict().superRefine((value, context) => {
  if (value.individualClientId && value.capacity !== 1) context.addIssue({ code: 'custom', path: ['capacity'], message: 'Una sesión individual tiene una sola plaza.' });
  if (value.overrideDebt && !value.overrideReason) context.addIssue({ code: 'custom', path: ['overrideReason'], message: 'Indica el motivo de la excepción.' });
  if (value.overrideAvailability && !value.availabilityReason) context.addIssue({ code: 'custom', path: ['availabilityReason'], message: 'Indica el motivo de la excepción.' });
  if (value.overrideDocuments && !value.documentOverrideReason) context.addIssue({ code: 'custom', path: ['documentOverrideReason'], message: 'Indica el motivo de la excepción documental.' });
});
export const createTemplateInput = z.object({
  serviceId: uuid, areaId: uuid, professionalId: uuid.optional(), weekday: z.number().int().min(0).max(6), localStartTime: time,
  durationMinutes: z.number().int().min(5).max(480), capacity: z.number().int().min(1).max(500), startsOn: date, endsOn: date.nullable().optional(),
}).strict().refine((value) => !value.endsOn || value.endsOn >= value.startsOn, { message: 'La fecha final no puede ser anterior a la inicial.', path: ['endsOn'] });
export const createTemplateBatchInput = z.object({
  serviceId: uuid, areaId: uuid, professionalId: uuid.optional(), weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  blocks: z.array(z.object({ localStartTime: time, durationMinutes: z.number().int().min(5).max(480), capacity: z.number().int().min(1).max(500) }).strict()).min(1).max(12),
  startsOn: date, endsOn: date.nullable().optional(),
}).strict().superRefine((value, context) => {
  if (new Set(value.weekdays).size !== value.weekdays.length) context.addIssue({ code: 'custom', path: ['weekdays'], message: 'No repitas días.' });
  if (value.endsOn && value.endsOn < value.startsOn) context.addIssue({ code: 'custom', path: ['endsOn'], message: 'La fecha final no puede ser anterior a la inicial.' });
  const candidateCount = value.weekdays.length * value.blocks.length;
  if (candidateCount > 50) context.addIssue({ code: 'custom', path: ['blocks'], message: 'Puedes crear hasta 50 horarios de una vez.' });
  if (value.blocks.some((block) => Number(block.localStartTime.slice(0, 2)) * 60 + Number(block.localStartTime.slice(3)) + block.durationMinutes > 1440)) context.addIssue({ code: 'custom', path: ['blocks'], message: 'Una franja no puede terminar al día siguiente.' });
});
const weekQuery = z.object({ weekStart: date }).strict().refine(({ weekStart }) => new Date(`${weekStart}T00:00:00Z`).getUTCDay() === 1, { message: 'La semana debe comenzar en lunes.', path: ['weekStart'] });
const updateOccurrenceInput = z.object({
  startsAt: z.string().datetime({ offset: true }).optional(),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  capacity: z.number().int().min(1).max(500).optional(),
  professionalId: uuid.nullable().optional(),
  overrideAvailability: z.boolean().optional().default(false),
  availabilityReason: z.string().trim().min(3).max(240).optional(),
}).strict().superRefine((value, context) => {
  if (value.overrideAvailability && !value.availabilityReason) context.addIssue({ code: 'custom', path: ['availabilityReason'], message: 'Indica el motivo de la excepción.' });
  if (!Object.keys(value).some((key) => !['overrideAvailability', 'availabilityReason'].includes(key))) context.addIssue({ code: 'custom', message: 'Indica al menos un cambio.' });
});

export function registerCalendarRoutes(
  app: FastifyInstance<any, any, any, any, any>,
  database: SqlClient,
  resolveAuthorization: (request: FastifyRequest) => Promise<AuthorizationContext | null>,
  resolveBookingEligibility: BookingEligibilityResolver = createBookingEligibilityResolver(),
  resolveClient?: (request: FastifyRequest) => Promise<ClientAuthorizationContext | null>,
  allowMemberBooking?: (personId: string | undefined, request: FastifyRequest) => Promise<boolean>,
) {
  async function authorized(request: FastifyRequest, reply: any, permission: string) {
    const context = await resolveAuthorization(request);
    if (!context) { reply.code(401).send({ error: 'authentication_required' }); return null; }
    if (!can(context, permission)) { reply.code(403).send({ error: 'permission_denied' }); return null; }
    return context;
  }
  async function checkService(tx: SqlTransaction, serviceId: string, areaId: string) {
    const [service] = await tx`SELECT s.id,s.status,s.area_id AS "areaId" FROM services s WHERE s.id=${serviceId} FOR SHARE`;
    if (!service) return 'service_not_found';
    if (service.status !== 'active') return 'service_archived';
    if (service.areaId !== areaId) return 'service_area_mismatch';
    const [area] = await tx`SELECT id,status FROM areas WHERE id=${areaId} FOR SHARE`;
    if (!area) return 'area_not_found';
    if (area.status !== 'active') return 'area_archived';
    return null;
  }
  async function checkProfessional(tx: SqlTransaction, professionalId: string | undefined, startsAt: string, durationMinutes: number, override: boolean, overrideReason: string | undefined, context: AuthorizationContext, excludeSessionId?: string) {
    if (!professionalId) return { error: null as string | null, warnings: [] as string[] };
    // Serialize the conflict check for this professional: row-level SHARE locks do not
    // conflict with another session writer, so concurrent creates could otherwise race.
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'2j:calendar-professional:' + professionalId},0))`;
    const [staff] = await tx`SELECT id,status,display_name AS "displayName" FROM staff_professionals WHERE id=${professionalId} FOR SHARE`;
    if (!staff || staff.status !== 'active') return { error: 'professional_unavailable', warnings: [] as string[] };
    const endsAt = new Date(new Date(startsAt).getTime() + durationMinutes * 60_000).toISOString();
    const [conflict] = await tx`SELECT EXISTS(SELECT 1 FROM calendar_sessions WHERE professional_id=${professionalId} AND status='scheduled' AND (${excludeSessionId ?? null}::uuid IS NULL OR id<>${excludeSessionId ?? null}::uuid) AND starts_at<${endsAt} AND starts_at + duration_minutes * interval '1 minute'>${startsAt}) AS conflict`;
    if (conflict?.conflict) return { error: 'professional_session_conflict', warnings: [] as string[] };
    const local = await tx`SELECT extract(dow FROM ${startsAt}::timestamptz AT TIME ZONE 'Atlantic/Canary')::int AS weekday,(${startsAt}::timestamptz AT TIME ZONE 'Atlantic/Canary')::date AS local_date,(${startsAt}::timestamptz AT TIME ZONE 'Atlantic/Canary')::time AS local_time,(${endsAt}::timestamptz AT TIME ZONE 'Atlantic/Canary')::time AS local_end`;
    const day = local[0]!;
    const slots = await tx`SELECT starts_at AS "startsAt",ends_at AS "endsAt" FROM staff_schedule_slots WHERE professional_id=${professionalId} AND status='active' AND weekday=${day.weekday} AND valid_from<=${day.local_date} AND (valid_until IS NULL OR valid_until>=${day.local_date}) ORDER BY starts_at`;
    const [coverage] = await tx`SELECT ${day.local_time}::time AS starts,${day.local_end}::time AS ends`;
    const minute = (value: string) => { const [hour, minutes] = String(value).slice(0, 5).split(':').map(Number); return hour! * 60 + minutes!; };
    let coveredUntil = minute(coverage!.starts);
    const requestedEnd = minute(coverage!.ends);
    for (const slot of slots) { const start = minute(slot.startsAt); const end = minute(slot.endsAt); if (start > coveredUntil) break; if (end > coveredUntil) coveredUntil = end; }
    const [extraAvailability] = await tx`SELECT EXISTS(SELECT 1 FROM staff_exceptions WHERE professional_id=${professionalId} AND status='active' AND kind='extra_availability' AND starts_at<=${startsAt} AND ends_at>=${endsAt}) AS covered`;
    const scheduleCovered = coveredUntil >= requestedEnd || Boolean(extraAvailability?.covered);
    const [absence] = await tx`SELECT EXISTS(SELECT 1 FROM staff_exceptions WHERE professional_id=${professionalId} AND status='active' AND kind<>'extra_availability' AND starts_at<${endsAt} AND ends_at>${startsAt}) AS unavailable`;
    const [substitution] = await tx`SELECT id,substitute_professional_id AS "substituteProfessionalId" FROM staff_substitutions WHERE source_professional_id=${professionalId} AND status='active' AND starts_at<${endsAt} AND ends_at>${startsAt} ORDER BY starts_at LIMIT 1`;
    const warnings = [...(!scheduleCovered?['outside_working_hours']:[]),...(absence?.unavailable?['professional_absent']:[]),...(substitution?['substitution_available']:[])];
    if (!warnings.length) return { error: null as string | null, warnings };
    if (!override) return { error: 'professional_availability_confirmation_required', warnings };
    if (!can(context,'staff.schedule.override')) return { error: 'permission_denied', warnings };
    if (!overrideReason) return { error: 'override_reason_required', warnings };
    return { error: null as string | null, warnings };
  }
  async function debtBlocksNewBooking(tx: SqlTransaction, clientId: string) {
    const [settings] = await tx`SELECT debt_blocks_new_reservations AS enabled FROM economic_settings WHERE singleton=true`;
    if (!settings?.enabled) return false;
    const [debt] = await tx`SELECT EXISTS(SELECT 1 FROM economic_charges c
      LEFT JOIN LATERAL(SELECT sum(amount_cents) FILTER(WHERE kind='payment') paid,
        sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END) net
        FROM economic_transactions WHERE charge_id=c.id)x ON true
      WHERE c.client_id=${clientId} AND c.state='pending'
        AND NOT EXISTS(SELECT 1 FROM client_plan_assignments a JOIN assignment_contract_terms t ON t.assignment_id=a.id
          WHERE a.charge_id=c.id AND a.client_id=c.client_id)
        AND NOT (COALESCE(x.paid,0)>0 AND COALESCE(x.net,0)=0)
        AND c.due_on<(now() AT TIME ZONE 'Atlantic/Canary')::date
        AND c.amount_cents>COALESCE(x.net,0)) AS overdue`;
    return Boolean(debt?.overdue);
  }
  async function missingDocuments(tx: SqlTransaction, clientId: string, serviceId: string, planId?: string) {
    const missing = await tx`SELECT dr.id AS "requirementId",dr.requirement_type AS "requirementType",COALESCE(f.name,cv.title) AS label FROM document_requirements dr LEFT JOIN client_forms f ON f.id=dr.form_id LEFT JOIN client_consents c ON c.id=dr.consent_id LEFT JOIN client_consent_versions cv ON cv.id=c.active_version_id WHERE dr.active AND dr.required AND ((dr.scope_type='center' AND dr.scope_id IS NULL) OR (dr.scope_type='service' AND dr.scope_id=${serviceId}) OR (dr.scope_type='client' AND dr.scope_id=${clientId}) OR (dr.scope_type='plan' AND ${Boolean(planId)}::boolean AND dr.scope_id=${planId ?? '00000000-0000-0000-0000-000000000000'}::uuid)) AND ((dr.requirement_type='form' AND NOT EXISTS(SELECT 1 FROM client_form_assignments a JOIN client_form_versions v ON v.id=a.form_version_id WHERE a.client_id=${clientId} AND v.form_id=dr.form_id AND a.status IN ('submitted','approved'))) OR (dr.requirement_type='consent' AND NOT EXISTS(SELECT 1 FROM client_consent_acceptances ac JOIN client_consents cc ON cc.active_version_id=ac.consent_version_id WHERE ac.client_id=${clientId} AND cc.id=dr.consent_id))) ORDER BY label,dr.id`;
    if (planId) return missing;
    const unresolved = await tx`SELECT dr.id AS "requirementId",dr.requirement_type AS "requirementType",COALESCE(f.name,cv.title,'Requisito de plan') AS label FROM document_requirements dr LEFT JOIN client_forms f ON f.id=dr.form_id LEFT JOIN client_consents c ON c.id=dr.consent_id LEFT JOIN client_consent_versions cv ON cv.id=c.active_version_id WHERE dr.active AND dr.required AND dr.scope_type='plan' AND NOT ((dr.requirement_type='form' AND EXISTS(SELECT 1 FROM client_form_assignments a JOIN client_form_versions v ON v.id=a.form_version_id WHERE a.client_id=${clientId} AND v.form_id=dr.form_id AND a.status IN ('submitted','approved'))) OR (dr.requirement_type='consent' AND EXISTS(SELECT 1 FROM client_consent_acceptances ac JOIN client_consents cc ON cc.active_version_id=ac.consent_version_id WHERE ac.client_id=${clientId} AND cc.id=dr.consent_id))) ORDER BY label,dr.id`;
    return [...missing,...unresolved];
  }
  async function appendAudit(tx: SqlTransaction, actorId: string, action: string, resourceType: string, resourceId: string, sessionId: string | null, clientId: string | null, details: Record<string, string | number | boolean | null> = {}) {
    await tx`INSERT INTO calendar_audit_events(actor_id,action,resource_type,resource_id,session_id,client_id,details) VALUES (${actorId},${action},${resourceType},${resourceId},${sessionId},${clientId},${JSON.stringify(details)}::jsonb)`;
  }
  function selectEntitlement(result: BookingEligibilityResult, assignmentId?: string): BookingEntitlementOption | null {
    if (!result.eligible) return null;
    if (assignmentId) return result.availableAlternatives?.find((item) => item.assignmentId === assignmentId) ?? null;
    return result.selectedEntitlement ?? null;
  }
  async function storeReservationRights(tx: SqlTransaction, reservationId: string, clientId: string, entitlement: BookingEntitlementOption, actorId: string) {
    await tx`SELECT id FROM client_plan_assignments WHERE id=${entitlement.assignmentId} AND client_id=${clientId} FOR UPDATE`;
    const rightIds = [entitlement.accessRightId, ...entitlement.quotaRightIds];
    const rights = await tx`SELECT id,right_type AS "rightType" FROM plan_rights WHERE id=ANY(${rightIds}::uuid[]) ORDER BY id`;
    for (const right of rights) {
      let ledgerEntryId: string | null = null;
      if (right.rightType === 'sessions_quota') {
        const periodId = entitlement.entitlementPeriodIdsByRightId[right.id] ?? null;
        const [ledger] = await tx`INSERT INTO client_entitlement_ledger(client_id,assignment_id,right_key,entitlement_period_id,entry_type,quantity,reason,external_reference,actor_id,idempotency_key,request_hash)
          VALUES (${clientId},${entitlement.assignmentId},${right.id}::text,${periodId},'consume',-1,'Reserva confirmada',${`calendar_reservation:${reservationId}`},${actorId},${randomUUID()},${createHash('sha256').update(`consume:${reservationId}:${right.id}`).digest('hex')}) RETURNING id`;
        ledgerEntryId = ledger!.id;
        await appendAudit(tx, actorId, 'reservation.entitlement_consumed', 'calendar_reservation', reservationId, null, clientId, { rightId: right.id, ledgerEntryId });
      }
      const periodId = right.rightType === 'sessions_quota' ? entitlement.entitlementPeriodIdsByRightId[right.id] ?? null : null;
      await tx`INSERT INTO calendar_reservation_rights(reservation_id,assignment_id,client_id,right_id,right_type,ledger_entry_id,entitlement_period_id)
        VALUES (${reservationId},${entitlement.assignmentId},${clientId},${right.id},${right.rightType},${ledgerEntryId},${periodId})`;
    }
  }
  const operationIdempotencyHeader = (request: FastifyRequest) => z.string().uuid().safeParse(request.headers['idempotency-key']);
  function requestHash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
  async function replayOperation(tx: SqlTransaction, key: string | undefined, operation: string, payload: unknown) {
    if (!key) return { replay: null as Record<string, unknown> | null, error: null as string | null };
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
    const [previous] = await tx`SELECT operation,request_hash AS "requestHash",response FROM calendar_booking_operations WHERE idempotency_key=${key}`;
    if (!previous) return { replay: null, error: null };
    if (previous.operation !== operation || previous.requestHash !== requestHash(payload)) return { replay: null, error: 'idempotency_conflict' };
    return { replay: previous.response as Record<string, unknown>, error: null };
  }
  async function saveOperation(tx: SqlTransaction, key: string | undefined, operation: string, payload: unknown, response: Record<string, unknown>, actorId: string) {
    if (!key) return;
    await tx`INSERT INTO calendar_booking_operations(idempotency_key,operation,request_hash,response,actor_id)
      VALUES (${key},${operation},${requestHash(payload)},${JSON.stringify(response)}::jsonb,${actorId})`;
  }
  async function promoteEligibleWaitlist(tx: SqlTransaction, session: any, actorId: string) {
    const promoted: string[] = [];
    const sessionServiceId=session.service_id??session.serviceId;
    const sessionStartsAt=session.starts_at??session.startsAt;
    const entries = await tx`SELECT id,client_id AS "clientId",entitlement_assignment_id AS "assignmentId"
      FROM calendar_waitlist_entries WHERE session_id=${session.id} AND status='waiting' ORDER BY created_at,id FOR UPDATE`;
    for (const entry of entries) {
      const [client] = await tx`SELECT id,status FROM clients WHERE id=${entry.clientId} FOR UPDATE`;
      if (!client || client.status !== 'active') {
        await appendAudit(tx,actorId,'waitlist.promotion_skipped','calendar_waitlist_entry',entry.id,session.id,entry.clientId,{reason:'client_inactive'});
        continue;
      }
      const eligibility=await resolveBookingEligibility({tx,clientId:entry.clientId,serviceId:sessionServiceId,startsAt:sessionStartsAt instanceof Date?sessionStartsAt.toISOString():String(sessionStartsAt),sessionId:session.id,ignoreWaitlistId:entry.id});
      if(!eligibility.eligible){
        if(eligibility.reason==='session_full')break;
        await appendAudit(tx,actorId,'waitlist.promotion_skipped','calendar_waitlist_entry',entry.id,session.id,entry.clientId,{reason:eligibility.reason});
        continue;
      }
      const entitlement=selectEntitlement(eligibility,entry.assignmentId??undefined);
      if(!entitlement){
        await appendAudit(tx,actorId,'waitlist.promotion_skipped','calendar_waitlist_entry',entry.id,session.id,entry.clientId,{reason:'entitlement_selection_required'});
        continue;
      }
      if(await debtBlocksNewBooking(tx,entry.clientId)){
        await appendAudit(tx,actorId,'waitlist.promotion_skipped','calendar_waitlist_entry',entry.id,session.id,entry.clientId,{reason:'debt_restriction'});
        continue;
      }
      const missing=await missingDocuments(tx,entry.clientId,sessionServiceId,entitlement.planId);
      if(missing.length){
        await appendAudit(tx,actorId,'waitlist.promotion_skipped','calendar_waitlist_entry',entry.id,session.id,entry.clientId,{reason:'required_document_missing'});
        continue;
      }
      const [reservation]=await tx`INSERT INTO calendar_reservations(session_id,client_id,entitlement_reference,entitlement_assignment_id,idempotency_key,created_by)
        VALUES (${session.id},${entry.clientId},${entitlement.accessRightId},${entitlement.assignmentId},${randomUUID()},${actorId}) RETURNING id`;
      if(!reservation)throw new Error('Waitlist promotion reservation insert returned no row.');
      await storeReservationRights(tx,reservation.id,entry.clientId,entitlement,actorId);
      await tx`UPDATE calendar_waitlist_entries SET status='promoted',promoted_reservation_id=${reservation.id},cancelled_at=now() WHERE id=${entry.id} AND status='waiting'`;
      await appendAudit(tx,actorId,'reservation.created','calendar_reservation',reservation.id,session.id,entry.clientId,{source:'waitlist_promotion'});
      await appendAudit(tx,actorId,'waitlist.promoted','calendar_waitlist_entry',entry.id,session.id,entry.clientId,{reservationId:reservation.id});
      await appendNotificationEvent(tx,{type:'waitlist.promoted',aggregateType:'calendar_reservation',aggregateId:reservation.id,clientId:entry.clientId,dedupeKey:`waitlist-promoted:${entry.id}`});
      promoted.push(reservation.id);
    }
    return promoted;
  }
  async function restoreReservationEntitlements(tx: SqlTransaction, reservationId: string, clientId: string, actorId: string, reason: string) {
    const consumed=await tx`SELECT cr.assignment_id AS "assignmentId",cr.right_id AS "rightId",cr.entitlement_period_id AS "periodId"
      FROM calendar_reservation_rights cr WHERE cr.reservation_id=${reservationId} AND cr.right_type='sessions_quota' AND cr.ledger_entry_id IS NOT NULL ORDER BY cr.assignment_id,cr.right_id FOR UPDATE`;
    for(const item of consumed){
      await tx`SELECT id FROM client_plan_assignments WHERE id=${item.assignmentId} AND client_id=${clientId} FOR UPDATE`;
      const [prior]=await tx`SELECT id FROM client_entitlement_ledger WHERE external_reference=${`calendar_reservation_restore:${reservationId}:${item.rightId}`}`;
      if(prior)continue;
      const [entry]=await tx`INSERT INTO client_entitlement_ledger(client_id,assignment_id,right_key,entitlement_period_id,entry_type,quantity,reason,external_reference,actor_id,idempotency_key,request_hash)
        VALUES (${clientId},${item.assignmentId},${item.rightId}::text,${item.periodId},'restore',1,${reason},${`calendar_reservation_restore:${reservationId}:${item.rightId}`},${actorId},${randomUUID()},${createHash('sha256').update(`restore:${reservationId}:${item.rightId}`).digest('hex')}) RETURNING id`;
      await appendAudit(tx,actorId,'reservation.entitlement_restored','calendar_reservation',reservationId,null,clientId,{rightId:item.rightId,ledgerEntryId:entry!.id});
    }
  }

  app.get('/api/calendar/week', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await authorized(request, reply, 'calendar.read'); if (!context) return;
    const parsed = weekQuery.safeParse(request.query); if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    try {
      const weekStart = parsed.data.weekStart;
      await database.begin((tx) => materializeCalendarTemplates(tx));
      const sessions = await database`
        SELECT cs.id,cs.service_id AS "serviceId",s.name AS "serviceName",cs.area_id AS "areaId",a.name AS "areaName",
          cs.template_id AS "templateId",cs.professional_id AS "professionalId",sp.display_name AS "professionalName",cs.source,cs.starts_at AS "startsAt",cs.duration_minutes AS "durationMinutes",cs.capacity,cs.status,(cs.individual_client_id IS NOT NULL) AS "isIndividual",
          (SELECT count(*)::int FROM calendar_reservations r WHERE r.session_id=cs.id AND r.status IN ('reserved','attended','no_show','cancelled_late')) AS "occupiedCount",
          GREATEST((SELECT count(*)::int FROM calendar_reservations r WHERE r.session_id=cs.id AND r.status IN ('reserved','attended','no_show','cancelled_late'))-cs.capacity,0)::int AS "overbookCount",
          (SELECT count(*)::int FROM calendar_waitlist_entries w WHERE w.session_id=cs.id AND w.status='waiting') AS "waitlistCount",
          EXISTS(SELECT 1 FROM calendar_audit_events ae WHERE ae.session_id=cs.id AND ae.action='session.occurrence_overridden') AS "occurrenceOverridden"
        FROM calendar_sessions cs JOIN services s ON s.id=cs.service_id JOIN areas a ON a.id=cs.area_id LEFT JOIN staff_professionals sp ON sp.id=cs.professional_id
        WHERE cs.starts_at >= (${weekStart}::date::timestamp AT TIME ZONE 'Atlantic/Canary')
          AND cs.starts_at < ((${weekStart}::date + 7)::timestamp AT TIME ZONE 'Atlantic/Canary')
        ORDER BY cs.starts_at,cs.id`;
      const areas = await database`SELECT id,name FROM areas WHERE status='active' ORDER BY normalized_name,id`;
      const services = await database`SELECT id,name,area_id AS "areaId" FROM services WHERE status='active' ORDER BY lower(name),id`;
      const professionals = await database`SELECT id,display_name AS "displayName",calendar_color AS "calendarColor" FROM staff_professionals WHERE status='active' ORDER BY lower(display_name),id`;
      const [currentProfessional] = await database`SELECT id FROM staff_professionals WHERE auth_actor_id=${context.actorId} AND status='active' LIMIT 1`;
      const templates = await database`SELECT t.id,t.service_id AS "serviceId",s.name AS "serviceName",t.area_id AS "areaId",a.name AS "areaName",t.professional_id AS "professionalId",sp.display_name AS "professionalName",t.weekday,t.local_start_time AS "localStartTime",t.duration_minutes AS "durationMinutes",t.capacity,to_char(t.starts_on,'YYYY-MM-DD') AS "startsOn",CASE WHEN t.ends_on IS NULL THEN NULL ELSE to_char(t.ends_on,'YYYY-MM-DD') END AS "endsOn" FROM recurring_session_templates t JOIN services s ON s.id=t.service_id JOIN areas a ON a.id=t.area_id LEFT JOIN staff_professionals sp ON sp.id=t.professional_id WHERE t.status='active' ORDER BY t.weekday,t.local_start_time,t.id`;
      return { weekStart, timezone: 'Atlantic/Canary', sessions, areas, services, professionals, templates, currentProfessionalId: currentProfessional?.id ?? null, capabilities: { manage: can(context, 'reservations.manage'), attendance: can(context, 'reservations.attendance'), overrideCapacity: can(context, 'scheduling.override_capacity'), overrideAvailability: can(context, 'staff.schedule.override'), overrideDocuments: can(context, 'documents.requirement.override'),overrideDebt:can(context,'billing.debt.override') } };
    } catch (error) { app.log.error({ databaseCode: dbCode(error), route: 'GET /api/calendar/week' }, 'calendar week failed'); return reply.code(500).send({ error: 'internal_error' }); }
  });

  app.get('/api/calendar/sessions/:sessionId/attendees', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await authorized(request, reply, 'calendar.read'); if (!context) return;
    if (!can(context, 'clients.read')) return reply.code(403).send({ error: 'permission_denied' });
    const params = z.object({ sessionId: uuid }).safeParse(request.params); if (!params.success) return reply.code(400).send({ error: 'invalid_session_id' });
    try {
      const reservations = await database`SELECT r.id,r.client_id AS "clientId",c.first_name AS "firstName",c.last_name AS "lastName",r.status,r.created_at AS "createdAt" FROM calendar_reservations r JOIN clients c ON c.id=r.client_id WHERE r.session_id=${params.data.sessionId} ORDER BY r.created_at,r.id`;
      const waitlist = await database`SELECT w.id,w.client_id AS "clientId",c.first_name AS "firstName",c.last_name AS "lastName",w.status,w.created_at AS "createdAt" FROM calendar_waitlist_entries w JOIN clients c ON c.id=w.client_id WHERE w.session_id=${params.data.sessionId} ORDER BY w.created_at,w.id`;
      return { reservations, waitlist };
    } catch (error) { app.log.error({ databaseCode: dbCode(error), route: 'GET /api/calendar/sessions/:sessionId/attendees' }, 'session attendees failed'); return reply.code(500).send({ error: 'internal_error' }); }
  });

  app.get('/api/calendar/sessions/:sessionId/booking-eligibility', async (request, reply) => {
    reply.header('Cache-Control','no-store');
    const context = await authorized(request, reply, 'calendar.read'); if (!context) return;
    if (!can(context,'clients.read')) return reply.code(403).send({ error:'permission_denied' });
    const params=z.object({sessionId:uuid}).safeParse(request.params);
    const query=z.object({clientId:uuid}).strict().safeParse(request.query);
    if(!params.success||!query.success)return reply.code(400).send({error:'validation_error'});
    try {
      const result=await database.begin(async tx=>{
        const [session]=await tx`SELECT id,status,service_id AS "serviceId",area_id AS "areaId",starts_at AS "startsAt",capacity FROM calendar_sessions WHERE id=${params.data.sessionId}`;
        if(!session)return {error:'session_not_found'};
        const serviceIssue=await checkService(tx,session.serviceId,session.areaId);
        const eligibility=serviceIssue?null:await resolveBookingEligibility({tx,clientId:query.data.clientId,serviceId:session.serviceId,startsAt:session.startsAt instanceof Date?session.startsAt.toISOString():String(session.startsAt),sessionId:session.id,allowFullSession:true});
        const debt=await debtBlocksNewBooking(tx,query.data.clientId);
        const entitlement=eligibility?.eligible?selectEntitlement(eligibility):null;
        const missing=eligibility?.eligible&&entitlement?await missingDocuments(tx,query.data.clientId,session.serviceId,entitlement.planId):[];
        const reasons:string[]=[];
        if(session.status!=='scheduled')reasons.push('session_cancelled');
        if(serviceIssue)reasons.push(serviceIssue);
        if(eligibility&&!eligibility.eligible)reasons.push(...(eligibility.blockingReasons??[eligibility.reason]));
        if(debt)reasons.push('debt_restriction');
        if(missing.length)reasons.push('required_document_missing');
        const full=(eligibility?.capacity?.available??0)<=0;
        if(full)reasons.push('session_full');
        const entitlementReady=Boolean(eligibility?.eligible);
        return {allowed:reasons.length===0,decision:reasons.length?'blocked':full?'waitlist_only':'allowed',blockingReasons:[...new Set(reasons)],selectedEntitlement:entitlement,availableAlternatives:eligibility?.availableAlternatives??[],capacity:eligibility?.capacity??null,waitlistAllowed:full&&entitlementReady,overridePossible:{debt:debt&&can(context,'billing.debt.override'),documents:missing.length>0&&can(context,'documents.requirement.override'),capacity:full&&can(context,'scheduling.override_capacity')},requiredDocuments:missing.map((item:any)=>({requirementId:item.requirementId,requirementType:item.requirementType,label:item.label}))};
      });
      if('error'in result)return reply.code(404).send({error:result.error});
      return result;
    } catch(error){app.log.error({databaseCode:dbCode(error),route:'GET /api/calendar/sessions/:sessionId/booking-eligibility'},'booking eligibility preview failed');return reply.code(500).send({error:'internal_error'});}
  });

  app.get('/api/calendar/reservations/:reservationId/cancellation-preview', async (request, reply) => {
    reply.header('Cache-Control','no-store');
    const context=await authorized(request,reply,'calendar.read');if(!context)return;
    const params=z.object({reservationId:uuid}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:'invalid_reservation_id'});
    try {
      const [row]=await database`SELECT r.id,r.status,s.starts_at AS "startsAt",s.duration_minutes AS "durationMinutes",sv.cancellation_window_minutes AS "windowMinutes",sv.late_cancellation_policy AS "latePolicy" FROM calendar_reservations r JOIN calendar_sessions s ON s.id=r.session_id JOIN services sv ON sv.id=s.service_id WHERE r.id=${params.data.reservationId}`;
      if(!row)return reply.code(404).send({error:'reservation_not_found'});
      const minutes=Math.floor((new Date(String(row.startsAt)).getTime()-Date.now())/60000);
      const late=minutes<Number(row.windowMinutes);
      const restoresEntitlement=!late||row.latePolicy==='restore';
      return {reservationId:row.id,status:row.status,canCancel:row.status==='reserved',cancellation:{late,minutesUntilStart:minutes,policy:row.latePolicy,restoresEntitlement,summary:late&&!restoresEntitlement?'Cancelación tardía: la sesión seguirá consumida.':'Si cancelas ahora, recuperarás la sesión.'}};
    }catch(error){app.log.error({databaseCode:dbCode(error),route:'GET /api/calendar/reservations/:reservationId/cancellation-preview'},'cancellation preview failed');return reply.code(500).send({error:'internal_error'});}
  });

  app.post('/api/calendar/sessions', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await authorized(request, reply, 'reservations.manage'); if (!context) return;
    const parsed = createSessionInput.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
    if (parsed.data.individualClientId && !can(context, 'clients.read')) return reply.code(403).send({ error: 'permission_denied' });
    if (parsed.data.overrideDebt && !can(context, 'billing.debt.override')) return reply.code(403).send({ error: 'permission_denied' });
    if (parsed.data.overrideDocuments && !can(context, 'documents.requirement.override')) return reply.code(403).send({ error: 'permission_denied' });
    try {
      const result = await database.begin(async (tx) => {
        const issue = await checkService(tx, parsed.data.serviceId, parsed.data.areaId); if (issue) return { error: issue };
        const availability = await checkProfessional(tx, parsed.data.professionalId, parsed.data.startsAt, parsed.data.durationMinutes, parsed.data.overrideAvailability, parsed.data.availabilityReason, context);
        if (availability.error) return { error: availability.error, warnings: availability.warnings };
        let entitlementReference: string | null = null;
        let selectedIndividualEntitlement: BookingEntitlementOption | null = null;
        let debtOverrideApplied = false;
        let documentRequirementIds: string[] = [];
        if (parsed.data.individualClientId) {
          const [client] = await tx`SELECT id,status FROM clients WHERE id=${parsed.data.individualClientId} FOR UPDATE`;
          if (!client) return { error: 'client_not_found' };
          if (client.status !== 'active') return { error: 'client_archived' };
          const eligibility = await resolveBookingEligibility({ tx, clientId: client.id, serviceId: parsed.data.serviceId, startsAt: parsed.data.startsAt });
          if (!eligibility.eligible) return { error: eligibility.reason };
          const entitlement=selectEntitlement(eligibility,parsed.data.entitlementAssignmentId);
          if(eligibility.availableAlternatives?.length&&!entitlement)return {error:parsed.data.entitlementAssignmentId?'entitlement_selection_invalid':'entitlement_selection_required',alternatives:eligibility.availableAlternatives};
          const missing = await missingDocuments(tx, client.id, parsed.data.serviceId, entitlement?.planId??eligibility.planId);
          if (missing.length && !parsed.data.overrideDocuments) return { error: 'required_documents_pending', missing };
          if (missing.length && parsed.data.overrideDocuments) documentRequirementIds = missing.map((item:any) => String(item.requirementId));
          const overdue = await debtBlocksNewBooking(tx, client.id);
          if (overdue && !parsed.data.overrideDebt) return { error: 'overdue_balance_blocks_booking' };
          debtOverrideApplied = overdue && parsed.data.overrideDebt;
          entitlementReference = entitlement?.accessRightId??eligibility.entitlementId;
          selectedIndividualEntitlement=entitlement;
        }
        const [session] = await tx`INSERT INTO calendar_sessions(service_id,area_id,professional_id,starts_at,duration_minutes,capacity,individual_client_id,created_by) VALUES (${parsed.data.serviceId},${parsed.data.areaId},${parsed.data.professionalId ?? null},${parsed.data.startsAt},${parsed.data.durationMinutes},${parsed.data.capacity},${parsed.data.individualClientId ?? null},${context.actorId}) RETURNING id`;
        if (!session) throw new Error('Session insert returned no row.');
        await appendAudit(tx, context.actorId, 'session.created', 'calendar_session', session.id, session.id, parsed.data.individualClientId ?? null, { capacity: parsed.data.capacity, individual: Boolean(parsed.data.individualClientId) });
        if (documentRequirementIds.length && parsed.data.individualClientId) await appendAudit(tx, context.actorId, 'reservation.document_override', 'calendar_session', session.id, session.id, parsed.data.individualClientId, { requirementIds: documentRequirementIds.join(','), reason: parsed.data.documentOverrideReason ?? '' });
        if (availability.warnings.length) await appendAudit(tx, context.actorId, 'session.availability_override', 'calendar_session', session.id, session.id, parsed.data.individualClientId ?? null, { warnings: availability.warnings.join(','), reason: parsed.data.availabilityReason ?? '' });
        if (parsed.data.individualClientId) {
          if (debtOverrideApplied) await appendAudit(tx, context.actorId, 'reservation.debt_override', 'calendar_session', session.id, session.id, parsed.data.individualClientId, { reason: parsed.data.overrideReason ?? '' });
          const [reservation] = await tx`INSERT INTO calendar_reservations(session_id,client_id,entitlement_reference,entitlement_assignment_id,created_by) VALUES (${session.id},${parsed.data.individualClientId},${entitlementReference},${selectedIndividualEntitlement?.assignmentId??null},${context.actorId}) RETURNING id`;
          if (!reservation) throw new Error('Reservation insert returned no row.');
          await appendNotificationEvent(tx,{type:'booking.confirmed',aggregateType:'calendar_reservation',aggregateId:reservation.id,clientId:parsed.data.individualClientId,dedupeKey:`booking-confirmed:${reservation.id}`});
          if(selectedIndividualEntitlement)await storeReservationRights(tx,reservation.id,parsed.data.individualClientId,selectedIndividualEntitlement,context.actorId);
          await appendAudit(tx, context.actorId, 'reservation.created', 'calendar_reservation', reservation.id, session.id, parsed.data.individualClientId);
        }
        return { id: session.id };
      });
      if ('error' in result) return reply.code(result.error === 'client_not_found' || result.error === 'service_not_found' || result.error === 'area_not_found' || result.error === 'professional_unavailable' ? 404 : result.error==='permission_denied'?403:409).send({ error: result.error, ...('warnings' in result ? { warnings: result.warnings } : {}), ...('missing' in result ? { missing: result.missing } : {}) });
      return reply.code(201).send(await readSession(database, result.id));
    } catch (error) { app.log.error({ databaseCode: dbCode(error), route: 'POST /api/calendar/sessions' }, 'session create failed'); return reply.code(500).send({ error: 'internal_error' }); }
  });

  app.patch('/api/calendar/sessions/:sessionId', async (request, reply) => {
    const context = await authorized(request, reply, 'reservations.manage'); if (!context) return;
    const params = z.object({ sessionId: uuid }).safeParse(request.params);
    const parsed = updateOccurrenceInput.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: 'validation_error' });
    try {
      const result = await database.begin(async (tx) => {
        const [session] = await tx`SELECT id,service_id AS "serviceId",area_id AS "areaId",professional_id AS "professionalId",template_id AS "templateId",individual_client_id AS "individualClientId",starts_at AS "startsAt",duration_minutes AS "durationMinutes",capacity,status FROM calendar_sessions WHERE id=${params.data.sessionId} FOR UPDATE`;
        if (!session) return { error: 'session_not_found' };
        if (session.status !== 'scheduled') return { error: 'session_not_editable' };
        const serviceIssue = await checkService(tx, session.serviceId, session.areaId);
        if (serviceIssue) return { error: serviceIssue };
        const startsAt = parsed.data.startsAt ?? (session.startsAt instanceof Date ? session.startsAt.toISOString() : String(session.startsAt));
        const durationMinutes = parsed.data.durationMinutes ?? Number(session.durationMinutes);
        const capacity = parsed.data.capacity ?? Number(session.capacity);
        if (session.individualClientId && capacity !== 1) return { error: 'individual_capacity_fixed' };
        const professionalId = Object.hasOwn(parsed.data, 'professionalId') ? parsed.data.professionalId ?? undefined : session.professionalId ?? undefined;
        const [occupancy] = await tx`SELECT count(*)::int AS count FROM calendar_reservations WHERE session_id=${session.id} AND status IN ('reserved','attended','no_show','cancelled_late')`;
        if (capacity < Number(occupancy?.count ?? 0)) return { error: 'capacity_below_occupancy' };
        const availability = await checkProfessional(tx, professionalId, startsAt, durationMinutes, parsed.data.overrideAvailability, parsed.data.availabilityReason, context, session.id);
        if (availability.error) return { error: availability.error };
        const changed = startsAt !== (session.startsAt instanceof Date ? session.startsAt.toISOString() : String(session.startsAt))
          || durationMinutes !== Number(session.durationMinutes) || capacity !== Number(session.capacity)
          || (professionalId ?? null) !== (session.professionalId ?? null);
        if (!changed) return { id: session.id, changed: false };
        await tx`UPDATE calendar_sessions SET starts_at=${startsAt},duration_minutes=${durationMinutes},capacity=${capacity},professional_id=${professionalId ?? null} WHERE id=${session.id}`;
        await appendAudit(tx, context.actorId, 'session.occurrence_overridden', 'calendar_session', session.id, session.id, null, {
          templateId: session.templateId ?? null,
          previousStartsAt: session.startsAt instanceof Date ? session.startsAt.toISOString() : String(session.startsAt), startsAt,
          previousDurationMinutes: Number(session.durationMinutes), durationMinutes,
          previousCapacity: Number(session.capacity), capacity,
          previousProfessionalId: session.professionalId ?? null, professionalId: professionalId ?? null,
        });
        if (availability.warnings.length && parsed.data.overrideAvailability) await appendAudit(tx, context.actorId, 'session.availability_override', 'calendar_session', session.id, session.id, null, { professionalId: professionalId ?? null, warnings: availability.warnings.join(','), reason: parsed.data.availabilityReason ?? '' });
        return { id: session.id, changed: true };
      });
      if ('error' in result) return reply.code(result.error === 'session_not_found' ? 404 : result.error === 'permission_denied' ? 403 : 409).send({ error: result.error });
      return { ...await readSession(database, result.id), changed: result.changed };
    } catch (error) { app.log.error({ databaseCode: dbCode(error), route: 'PATCH /api/calendar/sessions/:sessionId' }, 'session occurrence update failed'); return reply.code(500).send({ error: 'internal_error' }); }
  });

  app.post('/api/calendar/templates', async (request, reply) => {
    const context = await authorized(request, reply, 'reservations.manage'); if (!context) return;
    const parsed = createTemplateInput.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
    try {
      const result = await database.begin(async (tx) => {
        const issue = await checkService(tx, parsed.data.serviceId, parsed.data.areaId); if (issue) return { error: issue };
        if(parsed.data.professionalId){const [professional]=await tx`SELECT id FROM staff_professionals WHERE id=${parsed.data.professionalId} AND status='active' FOR SHARE`;if(!professional)return {error:'professional_unavailable'};}
        const [template] = await tx`INSERT INTO recurring_session_templates(service_id,area_id,professional_id,weekday,local_start_time,duration_minutes,capacity,starts_on,ends_on,created_by) VALUES (${parsed.data.serviceId},${parsed.data.areaId},${parsed.data.professionalId??null},${parsed.data.weekday},${parsed.data.localStartTime},${parsed.data.durationMinutes},${parsed.data.capacity},${parsed.data.startsOn},${parsed.data.endsOn ?? null},${context.actorId}) RETURNING id`;
        if (!template) throw new Error('Template insert returned no row.');
        await appendAudit(tx, context.actorId, 'template.created', 'calendar_template', template.id, null, null, { weekday: parsed.data.weekday, localStartTime: parsed.data.localStartTime });
        const materialization = await materializeCalendarTemplates(tx);
        return { id: template.id, materializedCount: materialization.created };
      });
      if ('error' in result) return reply.code(result.error === 'service_not_found' || result.error === 'area_not_found' ? 404 : 409).send({ error: result.error });
      return reply.code(201).send({ id: result.id, status: 'active', materializedCount: result.materializedCount });
    } catch (error) { app.log.error({ databaseCode: dbCode(error), route: 'POST /api/calendar/templates' }, 'template create failed'); return reply.code(500).send({ error: 'internal_error' }); }
  });

  app.post('/api/calendar/templates/batch', async (request, reply) => {
    const context = await authorized(request, reply, 'reservations.manage'); if (!context) return;
    const parsed = createTemplateBatchInput.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
    const input = parsed.data;
    const candidates = input.weekdays.flatMap((weekday) => input.blocks.map((block) => ({ ...block, weekday, startMinute: Number(block.localStartTime.slice(0, 2)) * 60 + Number(block.localStartTime.slice(3)), endMinute: Number(block.localStartTime.slice(0, 2)) * 60 + Number(block.localStartTime.slice(3)) + block.durationMinutes })));
    const overlaps = (a: { weekday: number; startMinute: number; endMinute: number; startsOn: string; endsOn: string | null }, b: { weekday: number; startMinute: number; endMinute: number; startsOn: string; endsOn: string | null }) => {
      if (a.weekday !== b.weekday || a.startMinute >= b.endMinute || b.startMinute >= a.endMinute) return false;
      const from = new Date(`${a.startsOn > b.startsOn ? a.startsOn : b.startsOn}T00:00:00Z`);
      const endA = a.endsOn ?? '9999-12-31'; const endB = b.endsOn ?? '9999-12-31';
      const through = new Date(`${endA < endB ? endA : endB}T00:00:00Z`);
      if (from > through) return false;
      from.setUTCDate(from.getUTCDate() + ((a.weekday - from.getUTCDay() + 7) % 7));
      return from <= through;
    };
    const range = { startsOn: input.startsOn, endsOn: input.endsOn ?? null };
    if (candidates.some((candidate, index) => candidates.slice(index + 1).some((other) => overlaps({ ...candidate, ...range }, { ...other, ...range })))) return reply.code(409).send({ error: 'schedule_conflict' });
    try {
      const result = await database.begin(async (tx) => {
        // Serialize schedule writes so two concurrent batches cannot both pass the conflict check.
        await tx`SELECT pg_advisory_xact_lock(710030071)`;
        const issue = await checkService(tx, input.serviceId, input.areaId); if (issue) return { error: issue };
        if (input.professionalId) { const [professional] = await tx`SELECT id FROM staff_professionals WHERE id=${input.professionalId} AND status='active' FOR SHARE`; if (!professional) return { error: 'professional_unavailable' }; }
        const existing = await tx`SELECT service_id AS "serviceId",professional_id AS "professionalId",weekday,local_start_time AS "localStartTime",duration_minutes AS "durationMinutes",starts_on AS "startsOn",ends_on AS "endsOn" FROM recurring_session_templates WHERE status='active' AND (service_id=${input.serviceId} OR (${input.professionalId ?? null}::uuid IS NOT NULL AND professional_id=${input.professionalId ?? null}))`;
        const conflict = existing.some((row: any) => (row.serviceId === input.serviceId || (input.professionalId && row.professionalId === input.professionalId)) && candidates.some((candidate) => overlaps({ ...candidate, ...range }, { weekday: Number(row.weekday), startMinute: Number(String(row.localStartTime).slice(0, 2)) * 60 + Number(String(row.localStartTime).slice(3, 5)), endMinute: Number(String(row.localStartTime).slice(0, 2)) * 60 + Number(String(row.localStartTime).slice(3, 5)) + Number(row.durationMinutes), startsOn: String(row.startsOn).slice(0, 10), endsOn: row.endsOn ? String(row.endsOn).slice(0, 10) : null })));
        if (conflict) return { error: 'schedule_conflict' };
        const created: string[] = [];
        for (const candidate of candidates) {
          const [template] = await tx`INSERT INTO recurring_session_templates(service_id,area_id,professional_id,weekday,local_start_time,duration_minutes,capacity,starts_on,ends_on,created_by) VALUES (${input.serviceId},${input.areaId},${input.professionalId ?? null},${candidate.weekday},${candidate.localStartTime},${candidate.durationMinutes},${candidate.capacity},${input.startsOn},${input.endsOn ?? null},${context.actorId}) RETURNING id`;
          if (!template) throw new Error('Template batch insert returned no row.');
          created.push(template.id);
          await appendAudit(tx, context.actorId, 'template.created', 'calendar_template', template.id, null, null, { weekday: candidate.weekday, localStartTime: candidate.localStartTime });
        }
        const materialization = await materializeCalendarTemplates(tx);
        return { templates: created.map((id) => ({ id, status: 'active' })), materializedCount: materialization.created };
      });
      if ('error' in result) return reply.code(result.error === 'service_not_found' || result.error === 'area_not_found' ? 404 : 409).send({ error: result.error });
      return reply.code(201).send({ templates: result.templates, materializedCount: result.materializedCount });
    } catch (error) { app.log.error({ databaseCode: dbCode(error), route: 'POST /api/calendar/templates/batch' }, 'template batch create failed'); return reply.code(500).send({ error: 'internal_error' }); }
  });

  app.patch('/api/calendar/templates/:templateId/archive', async (request, reply) => {
    const context = await authorized(request, reply, 'reservations.manage'); if (!context) return;
    const params = z.object({ templateId: uuid }).safeParse(request.params); if (!params.success) return reply.code(400).send({ error: 'invalid_template_id' });
    try {
      const result = await database.begin(async (tx) => {
        const [template] = await tx`SELECT id,status FROM recurring_session_templates WHERE id=${params.data.templateId} FOR UPDATE`;
        if (!template) return { error: 'template_not_found' };
        if (template.status !== 'active') return { error: 'template_not_active' };
        await tx`UPDATE recurring_session_templates SET status='archived' WHERE id=${template.id}`;
        await appendAudit(tx, context.actorId, 'template.archived', 'calendar_template', template.id, null, null);
        return { id: template.id, status: 'archived' };
      });
      if ('error' in result) return reply.code(result.error === 'template_not_found' ? 404 : 409).send({ error: result.error });
      return result;
    } catch (error) { app.log.error({ databaseCode: dbCode(error), route: 'PATCH /api/calendar/templates/:templateId/archive' }, 'template archive failed'); return reply.code(500).send({ error: 'internal_error' }); }
  });

  app.post('/api/calendar/templates/:templateId/sessions', async (request, reply) => {
    const context = await authorized(request, reply, 'reservations.manage'); if (!context) return;
    const params = z.object({ templateId: uuid }).safeParse(request.params);
    const body = z.object({ sessionDate: date, overrideAvailability: z.boolean().optional().default(false), availabilityReason: z.string().trim().min(3).max(240).optional() }).strict().superRefine((value, context) => {
      if (value.overrideAvailability && !value.availabilityReason) context.addIssue({ code: 'custom', path: ['availabilityReason'], message: 'Indica el motivo de la excepción.' });
    }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    try {
      const result = await database.begin(async (tx) => {
        const [template] = await tx`SELECT id,service_id,area_id,professional_id,weekday,local_start_time,duration_minutes,capacity,status,to_char(starts_on,'YYYY-MM-DD') AS starts_on,CASE WHEN ends_on IS NULL THEN NULL ELSE to_char(ends_on,'YYYY-MM-DD') END AS ends_on FROM recurring_session_templates WHERE id=${params.data.templateId} FOR UPDATE`;
        if (!template) return { error: 'template_not_found' };
        if (template.status !== 'active' || body.data.sessionDate < template.starts_on || (template.ends_on && body.data.sessionDate > template.ends_on)) return { error: 'template_inactive' };
        const weekday = new Date(`${body.data.sessionDate}T00:00:00Z`).getUTCDay();
        if (weekday !== template.weekday) return { error: 'template_weekday_mismatch' };
        const issue = await checkService(tx, template.service_id, template.area_id); if (issue) return { error: issue };
        const startsAt = await tx`SELECT (${body.data.sessionDate}::date + ${String(template.local_start_time).slice(0, 5)}::time) AT TIME ZONE 'Atlantic/Canary' AS value`;
        const availability = await checkProfessional(tx, template.professional_id ?? undefined, startsAt[0]!.value, template.duration_minutes, body.data.overrideAvailability, body.data.availabilityReason, context);
        if (availability.error) return { error: availability.error };
        const [session] = await tx`INSERT INTO calendar_sessions(service_id,area_id,professional_id,template_id,template_occurrence_date,source,starts_at,duration_minutes,capacity,created_by) VALUES (${template.service_id},${template.area_id},${template.professional_id},${template.id},${body.data.sessionDate},'template',${startsAt[0]!.value},${template.duration_minutes},${template.capacity},${context.actorId}) ON CONFLICT DO NOTHING RETURNING id`;
        if (!session) return { error: 'session_already_generated' };
        await appendAudit(tx, context.actorId, 'session.generated', 'calendar_session', session.id, session.id, null, { templateId: template.id, sessionDate: body.data.sessionDate });
        if (availability.warnings.length && body.data.overrideAvailability) await appendAudit(tx, context.actorId, 'session.availability_override', 'calendar_session', session.id, session.id, null, { professionalId:template.professional_id, warnings:availability.warnings.join(','), reason:body.data.availabilityReason??null });
        return { id: session.id };
      });
      if ('error' in result) return reply.code(result.error.endsWith('_not_found') ? 404 : 409).send({ error: result.error });
      return reply.code(201).send(await readSession(database, result.id));
    } catch (error) { app.log.error({ databaseCode: dbCode(error), route: 'POST /api/calendar/templates/:templateId/sessions' }, 'template generation failed'); return reply.code(500).send({ error: 'internal_error' }); }
  });

  const createReservation = async (request: FastifyRequest, reply: any, selfService = false) => {
    const context = selfService ? null : await authorized(request, reply, 'reservations.manage'); if (!selfService && !context) return;
    if (context && !can(context, 'clients.read')) return reply.code(403).send({ error: 'permission_denied' });
    const clientActor = selfService ? await resolveClient?.(request) : null;
    if (selfService && !clientActor) return reply.code(401).send({ error: 'client_authentication_required' });
    if (selfService && !await allowMemberBooking?.(clientActor?.personId, request)) return reply.code(403).send({ error: 'member_pilot_action_not_enabled' });
    if (selfService && !uuid.safeParse(clientActor?.clientId).success) return reply.code(401).send({ error: 'client_authentication_required' });
    const params = z.object({ sessionId: uuid }).safeParse(request.params);
    const body = z.object({ clientId: uuid.optional(), entitlementAssignmentId: uuid.optional(), overbook: z.boolean().optional().default(false), overrideDebt: z.boolean().optional().default(false), overrideReason: z.string().trim().min(3).max(240).optional(), overrideDocuments: z.boolean().optional().default(false), documentOverrideReason: z.string().trim().min(3).max(240).optional() }).strict().superRefine((value, issue) => {
      if (!selfService && !value.clientId) issue.addIssue({ code: 'custom', path: ['clientId'], message: 'Selecciona un cliente.' });
      if (value.overrideDebt && !value.overrideReason) issue.addIssue({ code: 'custom', path: ['overrideReason'], message: 'Indica el motivo de la excepción.' });
      if (value.overrideDocuments && !value.documentOverrideReason) issue.addIssue({ code: 'custom', path: ['documentOverrideReason'], message: 'Indica el motivo de la excepción documental.' });
    }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    if (selfService && (body.data.overbook || body.data.overrideDebt || body.data.overrideDocuments || body.data.clientId)) return reply.code(400).send({ error: 'invalid_self_service_request' });
    const clientId = selfService ? clientActor!.clientId.toLowerCase() : body.data.clientId!;
    const actorId = selfService ? `client:${clientId}` : context!.actorId;
    const idemHeader = operationIdempotencyHeader(request); if (request.headers['idempotency-key'] !== undefined && !idemHeader.success) return reply.code(400).send({ error: 'invalid_idempotency_key' });
    const idempotencyKey = idemHeader.success ? idemHeader.data : undefined;
    if (body.data.overbook && !can(context!, 'scheduling.override_capacity')) return reply.code(403).send({ error: 'permission_denied' });
    if (body.data.overrideDebt && !can(context!, 'billing.debt.override')) return reply.code(403).send({ error: 'permission_denied' });
    if (body.data.overrideDocuments && !can(context!, 'documents.requirement.override')) return reply.code(403).send({ error: 'permission_denied' });
    try {
      const result = await database.begin(async (tx) => {
        const [session] = await tx`SELECT id,status,capacity,service_id,area_id,individual_client_id,starts_at FROM calendar_sessions WHERE id=${params.data.sessionId} FOR UPDATE`;
        if (!session) return { error: 'session_not_found' };
        const operationPayload = { sessionId: params.data.sessionId, clientId, entitlementAssignmentId: body.data.entitlementAssignmentId ?? null, overbook: body.data.overbook, overrideDebt: body.data.overrideDebt, overrideDocuments: body.data.overrideDocuments, overrideReason: body.data.overrideReason ?? null, documentOverrideReason: body.data.documentOverrideReason ?? null };
        const replay = await replayOperation(tx, idempotencyKey, 'reserve', operationPayload);
        if (replay.error) return { error: replay.error };
        if (replay.replay) return { replay: replay.replay };
        if (session.status !== 'scheduled') return { error: 'session_cancelled' };
        const serviceIssue = await checkService(tx, session.service_id, session.area_id); if (serviceIssue) return { error: serviceIssue };
        const [client] = await tx`SELECT id,status FROM clients WHERE id=${clientId} FOR UPDATE`;
        if (!client) return { error: 'client_not_found' };
        if (client.status !== 'active') return { error: 'client_archived' };
        if (session.individual_client_id && session.individual_client_id !== client.id) return { error: 'individual_session_client_mismatch' };
        const eligibility = await resolveBookingEligibility({ tx, clientId: client.id, serviceId: session.service_id, startsAt: session.starts_at instanceof Date ? session.starts_at.toISOString() : String(session.starts_at), sessionId: session.id, allowFullSession: body.data.overbook });
        if (!eligibility.eligible) return { error: eligibility.reason };
        const entitlement = selectEntitlement(eligibility, body.data.entitlementAssignmentId);
        if (eligibility.availableAlternatives?.length && !entitlement) return { error: body.data.entitlementAssignmentId ? 'entitlement_selection_invalid' : 'entitlement_selection_required', alternatives: eligibility.availableAlternatives };
        const missing = await missingDocuments(tx, client.id, session.service_id, eligibility.planId);
        if (missing.length && !body.data.overrideDocuments) return { error: 'required_documents_pending', missing };
        const overdue = await debtBlocksNewBooking(tx, client.id);
        if (overdue && !body.data.overrideDebt) return { error: 'overdue_balance_blocks_booking' };
        if (overdue && body.data.overrideDebt) await appendAudit(tx, actorId, 'reservation.debt_override', 'calendar_session', session.id, session.id, client.id, { reason: body.data.overrideReason ?? '' });
        const [existing] = await tx`SELECT id FROM calendar_reservations WHERE session_id=${session.id} AND client_id=${client.id} AND status IN ('reserved','attended','no_show','cancelled_late') UNION ALL SELECT id FROM calendar_waitlist_entries WHERE session_id=${session.id} AND client_id=${client.id} AND status='waiting' LIMIT 1`;
        if (existing) return { error: 'client_already_added' };
        const [count] = await tx`SELECT count(*)::int AS occupied FROM calendar_reservations WHERE session_id=${session.id} AND status IN ('reserved','attended','no_show','cancelled_late')`;
        if (!body.data.overbook && (count?.occupied ?? 0) >= session.capacity) return { error: 'capacity_full' };
        const [reservation] = await tx`INSERT INTO calendar_reservations(session_id,client_id,entitlement_reference,entitlement_assignment_id,idempotency_key,created_by)
          VALUES (${session.id},${client.id},${entitlement?.accessRightId ?? eligibility.entitlementId},${entitlement?.assignmentId ?? null},${idempotencyKey ?? randomUUID()},${actorId}) RETURNING id`;
        if (!reservation) throw new Error('Reservation insert returned no row.');
        if (entitlement) await storeReservationRights(tx, reservation.id, client.id, entitlement, actorId);
        if (missing.length && body.data.overrideDocuments) await appendAudit(tx, actorId, 'reservation.document_override', 'calendar_reservation', reservation.id, session.id, client.id, { requirementIds: missing.map((item:any) => String(item.requirementId)).join(','), reason: body.data.documentOverrideReason! });
        await appendAudit(tx, actorId, body.data.overbook ? 'reservation.overbooked' : 'reservation.created', 'calendar_reservation', reservation.id, session.id, client.id, { overbooked: body.data.overbook, debtOverride: overdue && body.data.overrideDebt, debtOverrideReason: overdue && body.data.overrideDebt ? body.data.overrideReason ?? '' : null });
        await appendNotificationEvent(tx,{type:'booking.confirmed',aggregateType:'calendar_reservation',aggregateId:reservation.id,clientId:client.id,dedupeKey:`booking-confirmed:${reservation.id}`});
        const response = { id: reservation.id, overbooked: body.data.overbook, ...(entitlement ? { entitlementAssignmentId: entitlement.assignmentId, entitlementRightIds: entitlement.quotaRightIds } : {}) };
        await saveOperation(tx, idempotencyKey, 'reserve', operationPayload, response, actorId);
        return response;
      });
      if ('replay' in result) return reply.code(200).send(result.replay);
      if ('error' in result) return reply.code(result.error === 'session_not_found' || result.error === 'client_not_found' ? 404 : 409).send({ error: result.error, ...('missing' in result ? { missing: result.missing } : {}) });
      return reply.code(201).send(result);
    } catch (error) { app.log.error({ databaseCode: dbCode(error), route: selfService ? 'POST /api/me/sessions/:sessionId/reservations' : 'POST /api/calendar/sessions/:sessionId/reservations' }, 'reservation create failed'); return reply.code(500).send({ error: 'internal_error' }); }
  };
  app.post('/api/calendar/sessions/:sessionId/reservations', (request, reply) => createReservation(request, reply));
  app.post('/api/me/sessions/:sessionId/reservations', (request, reply) => createReservation(request, reply, true));

  const joinWaitlist = async (request: FastifyRequest, reply: any, selfService = false) => {
    const context = selfService ? null : await authorized(request, reply, 'reservations.manage'); if (!selfService && !context) return;
    if (context && !can(context, 'clients.read')) return reply.code(403).send({ error: 'permission_denied' });
    const clientActor = selfService ? await resolveClient?.(request) : null;
    if (selfService && (!clientActor || !uuid.safeParse(clientActor.clientId).success)) return reply.code(401).send({ error: 'client_authentication_required' });
    if (selfService && !await allowMemberBooking?.(clientActor?.personId, request)) return reply.code(403).send({ error: 'member_pilot_action_not_enabled' });
    const params = z.object({ sessionId: uuid }).safeParse(request.params);
    const body = z.object({ clientId: uuid.optional(), entitlementAssignmentId: uuid.optional() }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    if (!selfService && !body.data.clientId) return reply.code(400).send({ error: 'validation_error' });
    if (selfService && body.data.clientId) return reply.code(400).send({ error: 'invalid_self_service_request' });
    const clientId = selfService ? clientActor!.clientId.toLowerCase() : body.data.clientId!;
    const actorId = selfService ? `client:${clientId}` : context!.actorId;
    const idemHeader = operationIdempotencyHeader(request); if (request.headers['idempotency-key'] !== undefined && !idemHeader.success) return reply.code(400).send({ error: 'invalid_idempotency_key' });
    const idempotencyKey = idemHeader.success ? idemHeader.data : undefined;
    try {
      const result = await database.begin(async (tx) => {
        const [session] = await tx`SELECT id,status,capacity,service_id,area_id,individual_client_id,starts_at FROM calendar_sessions WHERE id=${params.data.sessionId} FOR UPDATE`;
        if (!session) return { error: 'session_not_found' };
        const operationPayload = { sessionId: params.data.sessionId, clientId, entitlementAssignmentId: body.data.entitlementAssignmentId ?? null };
        const replay = await replayOperation(tx, idempotencyKey, 'waitlist_join', operationPayload);
        if (replay.error) return { error: replay.error };
        if (replay.replay) return { replay: replay.replay };
        if (session.status !== 'scheduled') return { error: 'session_cancelled' };
        const serviceIssue = await checkService(tx, session.service_id, session.area_id); if (serviceIssue) return { error: serviceIssue };
        const [client] = await tx`SELECT id,status FROM clients WHERE id=${clientId} FOR UPDATE`;
        if (!client) return { error: 'client_not_found' };
        if (client.status !== 'active') return { error: 'client_archived' };
        if (session.individual_client_id && session.individual_client_id !== client.id) return { error: 'individual_session_client_mismatch' };
        const eligibility = await resolveBookingEligibility({ tx, clientId: client.id, serviceId: session.service_id, startsAt: session.starts_at instanceof Date ? session.starts_at.toISOString() : String(session.starts_at), sessionId: session.id, allowFullSession: true, ignoreDebt: true });
        if (!eligibility.eligible) return { error: eligibility.reason };
        const entitlement = selectEntitlement(eligibility, body.data.entitlementAssignmentId);
        if (eligibility.availableAlternatives?.length && !entitlement) return { error: body.data.entitlementAssignmentId ? 'entitlement_selection_invalid' : 'entitlement_selection_required', alternatives: eligibility.availableAlternatives };
        const [existing] = await tx`SELECT id FROM calendar_reservations WHERE session_id=${session.id} AND client_id=${client.id} AND status IN ('reserved','attended','no_show','cancelled_late') UNION ALL SELECT id FROM calendar_waitlist_entries WHERE session_id=${session.id} AND client_id=${client.id} AND status='waiting' LIMIT 1`;
        if (existing) return { error: 'client_already_added' };
        const [count] = await tx`SELECT count(*)::int AS occupied FROM calendar_reservations WHERE session_id=${session.id} AND status IN ('reserved','attended','no_show','cancelled_late')`;
        if ((count?.occupied ?? 0) < session.capacity) return { error: 'space_available' };
        const [entry] = await tx`INSERT INTO calendar_waitlist_entries(session_id,client_id,entitlement_reference,entitlement_assignment_id,idempotency_key,created_by)
          VALUES (${session.id},${client.id},${entitlement?.accessRightId ?? eligibility.entitlementId},${entitlement?.assignmentId ?? null},${idempotencyKey ?? randomUUID()},${actorId}) RETURNING id`;
        if (!entry) throw new Error('Waitlist insert returned no row.');
        await appendAudit(tx, actorId, 'waitlist.entered', 'calendar_waitlist_entry', entry.id, session.id, client.id);
        await appendNotificationEvent(tx,{type:'waitlist.joined',aggregateType:'calendar_waitlist_entry',aggregateId:entry.id,clientId:client.id,dedupeKey:`waitlist-joined:${entry.id}`});
        const response = { id: entry.id, status: 'waiting', entitlementAssignmentId: entitlement?.assignmentId ?? null };
        await saveOperation(tx, idempotencyKey, 'waitlist_join', operationPayload, response, actorId);
        return response;
      });
      if ('replay' in result) return reply.code(200).send(result.replay);
      if ('error' in result) return reply.code(result.error === 'session_not_found' || result.error === 'client_not_found' ? 404 : 409).send({ error: result.error, ...('missing' in result ? { missing: result.missing } : {}) });
      return reply.code(201).send(result);
    } catch (error) { app.log.error({ databaseCode: dbCode(error), route: selfService ? 'POST /api/me/sessions/:sessionId/waitlist' : 'POST /api/calendar/sessions/:sessionId/waitlist' }, 'waitlist entry failed'); return reply.code(500).send({ error: 'internal_error' }); }
  };
  app.post('/api/calendar/sessions/:sessionId/waitlist', (request, reply) => joinWaitlist(request, reply));
  app.post('/api/me/sessions/:sessionId/waitlist', (request, reply) => joinWaitlist(request, reply, true));

  const cancelReservation = async (request: FastifyRequest, reply: any, selfService = false) => {
    const context = selfService ? null : await authorized(request, reply, 'reservations.manage'); if (!selfService && !context) return;
    const clientActor = selfService ? await resolveClient?.(request) : null;
    if (selfService && (!clientActor || !uuid.safeParse(clientActor.clientId).success)) return reply.code(401).send({ error: 'client_authentication_required' });
    if (selfService && !await allowMemberBooking?.(clientActor?.personId, request)) return reply.code(403).send({ error: 'member_pilot_action_not_enabled' });
    const clientId = selfService ? clientActor!.clientId.toLowerCase() : null;
    const actorId = selfService ? `client:${clientId}` : context!.actorId;
    const params = z.object({ reservationId: uuid }).safeParse(request.params); if (!params.success) return reply.code(400).send({ error: 'invalid_reservation_id' });
    const idemHeader=operationIdempotencyHeader(request);if(request.headers['idempotency-key']!==undefined&&!idemHeader.success)return reply.code(400).send({error:'invalid_idempotency_key'});const idempotencyKey=idemHeader.success?idemHeader.data:undefined;
    try {
      const result = await database.begin(async (tx) => {
        const [row] = await tx`SELECT session_id AS "sessionId",client_id AS "clientId" FROM calendar_reservations WHERE id=${params.data.reservationId}`;
        if (!row) return { error: 'reservation_not_found' };
        if (selfService && row.clientId !== clientId) return { error: 'reservation_not_found' };
        const [session] = await tx`SELECT s.id,s.status,s.starts_at AS "startsAt",s.service_id AS "serviceId",s.area_id AS "areaId",s.capacity,sv.cancellation_window_minutes AS "windowMinutes",sv.late_cancellation_policy AS "latePolicy"
          FROM calendar_sessions s JOIN services sv ON sv.id=s.service_id WHERE s.id=${row.sessionId} FOR UPDATE OF s`;
        const operationPayload={reservationId:params.data.reservationId};const replay=await replayOperation(tx,idempotencyKey,'cancel',operationPayload);
        if(replay.error)return {error:replay.error};if(replay.replay)return {replay:replay.replay};
        if(!session||session.status!=='scheduled')return {error:'session_cancelled'};
        const [reservation] = await tx`SELECT id,status FROM calendar_reservations WHERE id=${params.data.reservationId} FOR UPDATE`;
        if(reservation?.status!=='reserved')return { error: 'reservation_not_active' };
        const startsAt=new Date(String(session.startsAt)).getTime();const late=(startsAt-Date.now())<Number(session.windowMinutes)*60_000;
        const consumeLate=late&&session.latePolicy==='consume';const newStatus=consumeLate?'cancelled_late':'cancelled';
        const [updated] = await tx`UPDATE calendar_reservations SET status=${newStatus},cancelled_at=now(),cancelled_by=${actorId},updated_at=now() WHERE id=${params.data.reservationId} AND status='reserved' RETURNING id`;
        if (!updated) return { error: 'reservation_not_active' };
        if(!consumeLate)await restoreReservationEntitlements(tx,updated.id,row.clientId,actorId,late?'Cancelación tardía con restauración':'Cancelación dentro de ventana');
        await appendAudit(tx, actorId, consumeLate?'reservation.cancelled_late':'reservation.cancelled', 'calendar_reservation', updated.id, row.sessionId, row.clientId,{previousStatus:'reserved',newStatus,late,restored:!consumeLate});
        await appendNotificationEvent(tx,{type:'booking.cancelled',aggregateType:'calendar_reservation',aggregateId:updated.id,clientId:row.clientId,dedupeKey:`booking-cancelled:${updated.id}`});
        const promoted=await promoteEligibleWaitlist(tx,session,actorId);
        const response={id:updated.id,status:newStatus,restored:!consumeLate,promotedReservationIds:promoted};
        await saveOperation(tx,idempotencyKey,'cancel',operationPayload,response,actorId);
        return response;
      });
      if('replay'in result)return reply.code(200).send(result.replay);
      if ('error' in result) return reply.code(result.error === 'reservation_not_found' ? 404 : 409).send({ error: result.error });
      return result;
    } catch (error) { app.log.error({ databaseCode: dbCode(error), route: selfService ? 'PATCH /api/me/bookings/:reservationId/cancel' : 'PATCH /api/calendar/reservations/:reservationId/cancel' }, 'reservation cancel failed'); return reply.code(500).send({ error: 'internal_error' }); }
  };
  app.patch('/api/calendar/reservations/:reservationId/cancel', (request, reply) => cancelReservation(request, reply));
  app.patch('/api/me/bookings/:reservationId/cancel', (request, reply) => cancelReservation(request, reply, true));

  const leaveWaitlist = async (request: FastifyRequest, reply: any, selfService = false) => {
    const context = selfService ? null : await authorized(request, reply, 'reservations.manage'); if (!selfService && !context) return;
    const clientActor = selfService ? await resolveClient?.(request) : null;
    if (selfService && (!clientActor || !uuid.safeParse(clientActor.clientId).success)) return reply.code(401).send({ error: 'client_authentication_required' });
    if (selfService && !await allowMemberBooking?.(clientActor?.personId, request)) return reply.code(403).send({ error: 'member_pilot_action_not_enabled' });
    const clientId = selfService ? clientActor!.clientId.toLowerCase() : null;
    const actorId = selfService ? `client:${clientId}` : context!.actorId;
    const params = z.object({ entryId: uuid }).safeParse(request.params); if (!params.success) return reply.code(400).send({ error: 'invalid_waitlist_id' });
    const idemHeader=operationIdempotencyHeader(request);if(request.headers['idempotency-key']!==undefined&&!idemHeader.success)return reply.code(400).send({error:'invalid_idempotency_key'});const idempotencyKey=idemHeader.success?idemHeader.data:undefined;
    try {
      const result = await database.begin(async (tx) => {
        const [row] = await tx`SELECT id,session_id AS "sessionId",client_id AS "clientId" FROM calendar_waitlist_entries WHERE id=${params.data.entryId}`;
        if (!row) return { error: 'waitlist_not_found' };
        if (selfService && row.clientId !== clientId) return { error: 'waitlist_not_found' };
        await tx`SELECT id FROM calendar_sessions WHERE id=${row.sessionId} FOR UPDATE`;
        const operationPayload={entryId:row.id};const replay=await replayOperation(tx,idempotencyKey,'waitlist_leave',operationPayload);if(replay.error)return {error:replay.error};if(replay.replay)return {replay:replay.replay};
        const [updated] = await tx`UPDATE calendar_waitlist_entries SET status='cancelled',cancelled_at=now() WHERE id=${row.id} AND status='waiting' RETURNING id`;
        if (!updated) return { error: 'waitlist_not_active' };
        await appendAudit(tx, actorId, 'waitlist.cancelled', 'calendar_waitlist_entry', row.id, row.sessionId, row.clientId);
        const response={id:row.id,status:'cancelled'};await saveOperation(tx,idempotencyKey,'waitlist_leave',operationPayload,response,actorId);return response;
      });
      if('replay'in result)return reply.code(200).send(result.replay);
      if ('error' in result) return reply.code(result.error === 'waitlist_not_found' ? 404 : 409).send({ error: result.error });
      return result;
    } catch (error) { app.log.error({ databaseCode: dbCode(error), route: selfService ? 'PATCH /api/me/waitlist/:entryId/cancel' : 'PATCH /api/calendar/waitlist/:entryId/cancel' }, 'waitlist cancel failed'); return reply.code(500).send({ error: 'internal_error' }); }
  };
  app.patch('/api/calendar/waitlist/:entryId/cancel', (request, reply) => leaveWaitlist(request, reply));
  app.patch('/api/me/waitlist/:entryId/cancel', (request, reply) => leaveWaitlist(request, reply, true));

  app.patch('/api/calendar/reservations/:reservationId/attendance', async (request, reply) => {
    const context = await authorized(request, reply, 'reservations.attendance'); if (!context) return;
    const params = z.object({ reservationId: uuid }).safeParse(request.params);
    const body = z.object({ status: z.enum(['reserved','attended','no_show']) }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    try {
      const result = await database.begin(async (tx) => {
        const [reference] = await tx`SELECT session_id AS "sessionId" FROM calendar_reservations WHERE id=${params.data.reservationId}`;
        if (!reference) return { error: 'reservation_not_found' };
        const [session] = await tx`SELECT id,status FROM calendar_sessions WHERE id=${reference.sessionId} FOR UPDATE`;
        if (!session || session.status !== 'scheduled') return { error: 'session_cancelled' };
        const [row] = await tx`SELECT id,session_id AS "sessionId",client_id AS "clientId",status FROM calendar_reservations WHERE id=${params.data.reservationId} FOR UPDATE`;
        if (!row || !['reserved','attended','no_show'].includes(row.status)) return { error: 'reservation_not_active' };
        if (row.status === body.data.status) return { id: row.id, status: row.status, previousStatus: row.status };
        const [updated] = await tx`UPDATE calendar_reservations SET status=${body.data.status},updated_at=now() WHERE id=${row.id} RETURNING id,status,updated_at AS "updatedAt"`;
        if (!updated) return { error: 'reservation_not_active' };
        await appendAudit(tx, context.actorId, 'reservation.attendance_changed', 'calendar_reservation', row.id, row.sessionId, row.clientId, { previousStatus: row.status, newStatus: body.data.status });
        return { ...updated, previousStatus: row.status };
      });
      if ('error' in result) return reply.code(result.error === 'reservation_not_found' ? 404 : 409).send({ error: result.error });
      return result;
    } catch (error) { app.log.error({ databaseCode: dbCode(error), route: 'PATCH /api/calendar/reservations/:reservationId/attendance' }, 'attendance update failed'); return reply.code(500).send({ error: 'internal_error' }); }
  });

  app.patch('/api/calendar/sessions/:sessionId/cancel', async (request, reply) => {
    const context = await authorized(request, reply, 'reservations.manage'); if (!context) return;
    const params = z.object({ sessionId: uuid }).safeParse(request.params); if (!params.success) return reply.code(400).send({ error: 'invalid_session_id' });
    const idemHeader=operationIdempotencyHeader(request);if(request.headers['idempotency-key']!==undefined&&!idemHeader.success)return reply.code(400).send({error:'invalid_idempotency_key'});const idempotencyKey=idemHeader.success?idemHeader.data:undefined;
    try {
      const result = await database.begin(async (tx) => {
        const [session] = await tx`SELECT id,status FROM calendar_sessions WHERE id=${params.data.sessionId} FOR UPDATE`;
        if (!session) return { error: 'session_not_found_or_cancelled' };
        const operationPayload={sessionId:session.id};const replay=await replayOperation(tx,idempotencyKey,'center_cancel',operationPayload);if(replay.error)return {error:replay.error};if(replay.replay)return {replay:replay.replay};
        if(session.status!=='scheduled')return {error:'session_not_found_or_cancelled'};
        const reservations = await tx`SELECT id,client_id AS "clientId",status FROM calendar_reservations WHERE session_id=${session.id} AND status IN ('reserved','attended','no_show','cancelled_late') FOR UPDATE`;
        const waitlist = await tx`SELECT id,client_id AS "clientId" FROM calendar_waitlist_entries WHERE session_id=${session.id} AND status='waiting' FOR UPDATE`;
        await tx`UPDATE calendar_sessions SET status='cancelled' WHERE id=${session.id}`;
        await tx`UPDATE calendar_reservations SET status='cancelled_by_center',updated_at=now() WHERE session_id=${session.id} AND status IN ('reserved','attended','no_show','cancelled_late')`;
        await tx`UPDATE calendar_waitlist_entries SET status='cancelled_by_center',cancelled_at=now() WHERE session_id=${session.id} AND status='waiting'`;
        for (const row of reservations) {
          await restoreReservationEntitlements(tx,row.id,row.clientId,context.actorId,'Sesión cancelada por el centro');
          await appendAudit(tx, context.actorId, 'reservation.cancelled_by_center', 'calendar_reservation', row.id, session.id, row.clientId, { previousStatus: row.status, newStatus: 'cancelled_by_center' });
          await appendNotificationEvent(tx,{type:'booking.cancelled',aggregateType:'calendar_reservation',aggregateId:row.id,clientId:row.clientId,dedupeKey:`booking-cancelled:${row.id}`});
        }
        for (const row of waitlist) { await appendAudit(tx, context.actorId, 'waitlist.cancelled_by_center', 'calendar_waitlist_entry', row.id, session.id, row.clientId, { previousStatus: 'waiting', newStatus: 'cancelled_by_center' }); await appendNotificationEvent(tx,{type:'booking.cancelled',aggregateType:'calendar_waitlist_entry',aggregateId:row.id,clientId:row.clientId,dedupeKey:`waitlist-center-cancelled:${row.id}`}); }
        await appendAudit(tx, context.actorId, 'session.cancelled', 'calendar_session', session.id, session.id, null, { reservationsCancelled: reservations.length, waitlistCancelled: waitlist.length });
        const response={ id: session.id, reservationsCancelled: reservations.length, waitlistCancelled: waitlist.length };
        await saveOperation(tx,idempotencyKey,'center_cancel',operationPayload,response,context.actorId);return response;
      });
      if('replay'in result)return reply.code(200).send(result.replay);
      if ('error' in result) return reply.code(409).send({ error: result.error });
      return result;
    } catch (error) { app.log.error({ databaseCode: dbCode(error), route: 'PATCH /api/calendar/sessions/:sessionId/cancel' }, 'session cancel failed'); return reply.code(500).send({ error: 'internal_error' }); }
  });
}
async function readSession(database: SqlClient, id: string) {
  const [session] = await database`SELECT cs.id,cs.service_id AS "serviceId",s.name AS "serviceName",cs.area_id AS "areaId",a.name AS "areaName",cs.professional_id AS "professionalId",sp.display_name AS "professionalName",cs.template_id AS "templateId",cs.source,cs.starts_at AS "startsAt",cs.duration_minutes AS "durationMinutes",cs.capacity,cs.status,cs.individual_client_id AS "individualClientId",EXISTS(SELECT 1 FROM calendar_audit_events ae WHERE ae.session_id=cs.id AND ae.action='session.occurrence_overridden') AS "occurrenceOverridden" FROM calendar_sessions cs JOIN services s ON s.id=cs.service_id JOIN areas a ON a.id=cs.area_id LEFT JOIN staff_professionals sp ON sp.id=cs.professional_id WHERE cs.id=${id}`;
  return session;
}
function dbCode(error: unknown) { return typeof error === 'object' && error !== null && 'code' in error ? String(error.code).slice(0, 12) : 'unknown'; }
