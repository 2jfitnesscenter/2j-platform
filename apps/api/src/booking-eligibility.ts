import type { TransactionSql } from 'postgres';
import { evaluateTermPaymentAccess } from './term-payment-access.js';

export type BookingBlockingReason =
  | 'client_inactive' | 'session_cancelled' | 'session_started' | 'session_full'
  | 'no_entitlement' | 'entitlement_not_started' | 'entitlement_expired'
  | 'entitlement_paused' | 'entitlement_cancelled' | 'entitlement_exhausted'
  | 'weekly_limit_reached' | 'monthly_limit_reached' | 'duplicate_booking'
  | 'booking_conflict' | 'debt_restriction' | 'required_document_missing'
  | 'service_not_allowed' | 'entitlement_unavailable';

export interface BookingEntitlementOption {
  readonly assignmentId: string;
  readonly planId: string;
  readonly planName: string;
  readonly accessRightId: string;
  readonly quotaRightIds: readonly string[];
  readonly sessionsQuotaRightIds: readonly string[];
  readonly entitlementPeriodIdsByRightId: Readonly<Record<string, string>>;
  readonly availableBalance: number | null;
  readonly periodUsage: readonly { rightId: string; period: string; used: number; limit: number; startsAt: string; endsAt: string }[];
  readonly validUntil: string | null;
}

export interface BookingEligibilityRequest {
  readonly tx: TransactionSql<Record<string, unknown>>;
  readonly clientId: string;
  readonly serviceId: string;
  readonly startsAt: string;
  readonly sessionId?: string;
  readonly ignoreWaitlistId?: string;
  readonly now?: Date;
  readonly ignoreCapacity?: boolean;
  readonly allowFullSession?: boolean;
  readonly ignoreDebt?: boolean;
  readonly ignoreDocuments?: boolean;
}

export type BookingEligibilityResult =
  | {
      readonly eligible: true;
      readonly entitlementId: string;
      readonly assignmentId?: string;
      readonly planId?: string;
      readonly selectedEntitlement?: BookingEntitlementOption;
      readonly availableAlternatives?: readonly BookingEntitlementOption[];
      readonly blockingReasons?: readonly never[];
      readonly capacity?: { occupied: number; limit: number; available: number };
      readonly waitlistAllowed?: boolean;
      readonly overridePossible?: boolean;
    }
  | {
      readonly eligible: false;
      readonly reason: BookingBlockingReason | 'entitlement_required' | 'entitlement_unavailable';
      readonly blockingReasons?: readonly BookingBlockingReason[];
      readonly selectedEntitlement?: null;
      readonly availableAlternatives?: readonly BookingEntitlementOption[];
      readonly capacity?: { occupied: number; limit: number; available: number };
      readonly waitlistAllowed?: boolean;
      readonly overridePossible?: boolean;
    };

type EntitlementRow = {
  assignmentId: string; planId: string; planName: string; assignmentStatus: string;
  lastEvent: string | null; startsOn: string; endsOn: string | null;
  termKind: string | null;
  accessRightId: string; accessValidDays: number | null; accessValidDaysStartRule: string | null;
  quotaRightId: string | null; quotaRightType: 'sessions_quota'|'period_quota'|null;
  quantity: number | null; period: string | null; periodMode: string | null; timezone: string | null;
  validDays: number | null; validDaysStartRule: string | null; balance: number | null;
  entitlementPeriodId: string | null; periodStatus: string | null; entitlementMode: string | null; periodBalance: number | null; periodSessions: number | null;
};

/**
 * Central, server-side entitlement check used by previews and booking mutations.
 * It intentionally does not infer service access from plan_services: a targeted
 * service_access right is mandatory. Quota usage is derived from reservations,
 * never from a mutable counter.
 */
export async function evaluateBookingEligibility(
  request: BookingEligibilityRequest,
): Promise<BookingEligibilityResult> {
  const { tx, clientId, serviceId, startsAt } = request;
  const now = request.now ?? new Date();
  let capacity: { occupied: number; limit: number; available: number } | undefined;
  let sessionFull = false;
  const [client] = await tx`SELECT id,status FROM clients WHERE id=${clientId}`;
  if (!client || client.status !== 'active') return denied('client_inactive');

  if (request.sessionId) {
    const [session] = await tx`SELECT id,status,capacity,starts_at AS "startsAt"
      FROM calendar_sessions WHERE id=${request.sessionId}`;
    if (!session || session.status !== 'scheduled') return denied('session_cancelled');
    if (new Date(String(session.startsAt)).getTime() <= now.getTime()) return denied('session_started');
    const [existing] = await tx`SELECT EXISTS(
      SELECT 1 FROM calendar_reservations WHERE session_id=${request.sessionId} AND client_id=${clientId}
        AND status IN ('reserved','attended','no_show','cancelled_late')
      UNION ALL
      SELECT 1 FROM calendar_waitlist_entries WHERE session_id=${request.sessionId} AND client_id=${clientId} AND status='waiting'
        AND (${request.ignoreWaitlistId ?? null}::uuid IS NULL OR id<>${request.ignoreWaitlistId ?? null}::uuid)
    ) AS present`;
    if (existing?.present) return denied('duplicate_booking');
    const [conflict] = await tx`SELECT EXISTS(
      SELECT 1 FROM calendar_reservations r JOIN calendar_sessions other ON other.id=r.session_id
      WHERE r.client_id=${clientId} AND r.status IN ('reserved','attended','no_show','cancelled_late')
        AND other.status='scheduled' AND other.id<>${request.sessionId}
        AND other.starts_at<(${startsAt}::timestamptz + (SELECT duration_minutes FROM calendar_sessions WHERE id=${request.sessionId}) * interval '1 minute')
        AND other.starts_at + other.duration_minutes * interval '1 minute'>${startsAt}::timestamptz
    ) AS conflict`;
    if (conflict?.conflict) return denied('booking_conflict');
    const [capacityRow] = await tx`SELECT s.capacity,
      (SELECT count(*)::int FROM calendar_reservations r WHERE r.session_id=s.id AND r.status IN ('reserved','attended','no_show','cancelled_late')) AS occupied
      FROM calendar_sessions s WHERE s.id=${request.sessionId}`;
    const occupied = Number(capacityRow?.occupied ?? 0); const limit = Number(capacityRow?.capacity ?? 0);
    capacity = { occupied, limit, available: Math.max(0,limit-occupied) };
    sessionFull = !request.ignoreCapacity && occupied >= limit;
  }

  const rows = await tx<EntitlementRow[]>`
    SELECT a.id AS "assignmentId",a.plan_id AS "planId",p.name AS "planName",a.status AS "assignmentStatus",
      latest.event_type AS "lastEvent",to_char(a.starts_on,'YYYY-MM-DD') AS "startsOn",
      CASE WHEN a.ends_on IS NULL THEN NULL ELSE to_char(a.ends_on,'YYYY-MM-DD') END AS "endsOn",
      access.id AS "accessRightId",access.valid_days AS "accessValidDays",access.valid_days_start_rule AS "accessValidDaysStartRule",
      quota.id AS "quotaRightId",quota.right_type AS "quotaRightType",quota.quantity,quota.period,quota.period_mode AS "periodMode",quota.timezone,
      quota.valid_days AS "validDays",quota.valid_days_start_rule AS "validDaysStartRule",
      CASE WHEN quota.id IS NULL OR quota.right_type<>'sessions_quota' THEN NULL
        WHEN ep.id IS NOT NULL THEN ep.balance
        ELSE (SELECT COALESCE(sum(l.quantity),0)::int FROM client_entitlement_ledger l WHERE l.assignment_id=a.id AND l.right_key=quota.id::text AND l.entitlement_period_id IS NULL) END AS balance,
      v.term_kind AS "termKind",
      ep.id AS "entitlementPeriodId",ep.period_status AS "periodStatus",ep.entitlement_mode AS "entitlementMode",ep.balance AS "periodBalance",ep.sessions_snapshot AS "periodSessions"
    FROM client_plan_assignments a
    JOIN plans p ON p.id=a.plan_id
    JOIN plan_versions v ON v.plan_id=a.plan_id AND v.version=a.plan_version
    LEFT JOIN LATERAL (SELECT e.event_type FROM client_plan_assignment_events e WHERE e.assignment_id=a.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1) latest ON true
    JOIN plan_services ps ON ps.plan_id=a.plan_id AND ps.plan_version=a.plan_version AND ps.service_id=${serviceId}
    JOIN plan_rights access ON access.plan_id=a.plan_id AND access.plan_version=a.plan_version
      AND access.right_type='service_access' AND access.service_id=${serviceId}
    LEFT JOIN plan_rights quota ON quota.plan_id=a.plan_id AND quota.plan_version=a.plan_version
      AND quota.right_type IN ('sessions_quota','period_quota')
      AND (quota.service_id=${serviceId} OR (quota.service_id IS NULL AND quota.quota_scope='shared'))
    LEFT JOIN LATERAL (
      SELECT p.id,p.sessions_snapshot,p.entitlement_mode,
        COALESCE((SELECT sum(l.quantity)::int FROM client_entitlement_ledger l WHERE l.entitlement_period_id=p.id AND l.right_key=p.right_id::text),0)::int AS balance,
        CASE WHEN EXISTS(SELECT 1 FROM assignment_entitlement_period_events e WHERE e.period_id=p.id AND e.event_type='payment_validated') THEN 'active'
          WHEN (now() AT TIME ZONE 'Atlantic/Canary')::date BETWEEN p.period_start AND LEAST(p.period_end,date_trunc('month',p.period_start)::date+9)
            AND (SELECT e.enabled FROM assignment_recurrence_events e WHERE e.assignment_id=p.assignment_id ORDER BY e.effective_on DESC,e.created_at DESC,e.id DESC LIMIT 1) IS TRUE THEN 'provisional'
          ELSE 'blocked_unpaid' END AS period_status
      FROM assignment_entitlement_periods p
      WHERE quota.right_type='sessions_quota' AND p.assignment_id=a.id AND p.right_id=quota.id
        AND p.period_start<=(${startsAt}::timestamptz AT TIME ZONE 'Atlantic/Canary')::date
        AND p.period_end>=(${startsAt}::timestamptz AT TIME ZONE 'Atlantic/Canary')::date
      ORDER BY p.period_start DESC LIMIT 1
    ) ep ON true
    WHERE a.client_id=${clientId}
    ORDER BY a.ends_on NULLS LAST,a.starts_on,a.id,quota.id`;

  if (!rows.length) {
    const [included] = await tx`SELECT EXISTS(SELECT 1 FROM client_plan_assignments a JOIN plan_services ps ON ps.plan_id=a.plan_id AND ps.plan_version=a.plan_version WHERE a.client_id=${clientId} AND ps.service_id=${serviceId}) AS included`;
    return denied(included?.included ? 'no_entitlement' : 'service_not_allowed');
  }

  const [dates] = await tx`SELECT (now() AT TIME ZONE 'Atlantic/Canary')::date::text AS today,
    (${startsAt}::timestamptz AT TIME ZONE 'Atlantic/Canary')::date::text AS "sessionDate"`;
  const groups = new Map<string, { rows: EntitlementRow[]; unavailable: BookingBlockingReason[] }>();
  for (const row of rows) {
    let group = groups.get(row.assignmentId);
    if (!group) { group = { rows: [], unavailable: [] }; groups.set(row.assignmentId, group); }
    group.rows.push(row);
    if (row.assignmentStatus !== 'active' || row.lastEvent === 'cancelled' || row.lastEvent === 'changed') group.unavailable.push('entitlement_cancelled');
    else if (row.lastEvent === 'paused') group.unavailable.push('entitlement_paused');
    else if (row.startsOn > String(dates!.today) || row.startsOn > String(dates!.sessionDate)) group.unavailable.push('entitlement_not_started');
    else if ((row.endsOn && row.endsOn < String(dates!.today)) || (row.endsOn && row.endsOn < String(dates!.sessionDate))) group.unavailable.push('entitlement_expired');
  }

  const alternatives: BookingEntitlementOption[] = [];
  const reasons = new Set<BookingBlockingReason>();
  const paymentAccess = await evaluateTermPaymentAccess(tx, [...groups].filter(([, group]) => group.unavailable.length === 0).map(([assignmentId, group]) => ({
    assignmentId,
    termKind: group.rows[0]?.termKind ?? null,
  })), now);
  for (const [assignmentId, group] of groups) {
    if (group.unavailable.length) { group.unavailable.forEach((reason) => reasons.add(reason)); continue; }
    const first = group.rows[0]!;
    const payment = paymentAccess.get(assignmentId);
    if (first.termKind !== null && !payment) { reasons.add('entitlement_unavailable'); continue; }
    if (payment?.state === 'entitlement_unavailable') { reasons.add('entitlement_unavailable'); continue; }
    if (payment?.state === 'payment_overdue' && !request.ignoreDebt) { reasons.add('debt_restriction'); continue; }
    const quotaRows = group.rows.filter((row) => row.quotaRightId);
    const validityRows = [
      ...(first.accessValidDays && first.accessValidDaysStartRule ? [{ rightId: first.accessRightId, validDays: first.accessValidDays, rule: first.accessValidDaysStartRule }] : []),
      ...quotaRows.filter((right) => right.validDays && right.validDaysStartRule).map((right) => ({ rightId: right.quotaRightId!, validDays: right.validDays!, rule: right.validDaysStartRule! })),
    ];
    let validityExpired = false;
    const validityEndDates: string[] = [];
    for (const right of validityRows) {
      let anchor = right.rule === 'purchase' ? first.startsOn : null;
      if (right.rule === 'first_use') {
        const [firstUse] = await tx`SELECT min((s.starts_at AT TIME ZONE 'Atlantic/Canary')::date)::text AS day
          FROM calendar_reservation_rights cr
          JOIN calendar_reservations r ON r.id=cr.reservation_id
          JOIN calendar_sessions s ON s.id=r.session_id
          WHERE cr.assignment_id=${assignmentId} AND cr.right_id=${right.rightId}
            AND r.status IN ('reserved','attended','no_show','cancelled_late','cancelled')`;
        anchor = firstUse?.day ? String(firstUse.day) : null;
      }
      // A first-use term starts only when the entitlement is actually used.
      if (!anchor) continue;
      const expiresOn = addLocalDays(anchor, right.validDays);
      validityEndDates.push(expiresOn);
      if (expiresOn < String(dates!.today) || expiresOn < String(dates!.sessionDate)) validityExpired = true;
    }
    if (validityExpired) { reasons.add('entitlement_expired'); continue; }
    const sessionsRows = quotaRows.filter((row) => row.quotaRightType === 'sessions_quota');
    const periodUsage: BookingEntitlementOption['periodUsage'][number][] = [];
    let exhausted = false;
    for (const quota of quotaRows) {
      if (quota.quotaRightType === 'sessions_quota') {
        if (first.termKind !== null) {
          if (!quota.entitlementPeriodId || !quota.entitlementMode) {
            exhausted = true; reasons.add('entitlement_unavailable');
          } else if (quota.entitlementMode === 'quota' && Number(quota.periodBalance ?? 0) <= 0) {
            exhausted = true;
          } else if (quota.entitlementMode !== 'quota' && quota.entitlementMode !== 'unlimited') {
            exhausted = true; reasons.add('entitlement_unavailable');
          }
        } else if (quota.entitlementPeriodId && quota.periodStatus !== 'active' && quota.periodStatus !== 'provisional') {
          exhausted = true; reasons.add('entitlement_unavailable');
        } else if (quota.entitlementPeriodId && quota.periodStatus === 'provisional') {
          // Provisional reservations are bounded by the initial monthly estimate.
          // A late prorated grant may leave this ledger negative; existing bookings remain.
          if (Number(quota.periodSessions ?? 0) + Number(quota.periodBalance ?? 0) <= 0) exhausted = true;
        } else if (Number(quota.balance ?? 0) <= 0) exhausted = true;
        continue;
      }
      if (quota.quotaRightType !== 'period_quota' || !quota.quantity || !quota.period || !quota.timezone) continue;
      const period = await resolveQuotaPeriod(tx, quota, startsAt, now);
      const [usage] = await tx`SELECT count(*)::int AS used FROM calendar_reservation_rights cr
        JOIN calendar_reservations r ON r.id=cr.reservation_id
        JOIN calendar_sessions s ON s.id=r.session_id
        WHERE cr.assignment_id=${assignmentId} AND cr.right_id=${quota.quotaRightId}
          AND r.status IN ('reserved','attended','no_show','cancelled_late')
          AND s.starts_at>=${period.startsAt} AND s.starts_at<${period.endsAt}
          AND (${request.sessionId ?? null}::uuid IS NULL OR s.id<>${request.sessionId ?? null}::uuid)`;
      const used = Number(usage?.used ?? 0);
      periodUsage.push({ rightId: quota.quotaRightId!, period: quota.period, used, limit: quota.quantity, startsAt: period.startsAt, endsAt: period.endsAt });
      if (used >= quota.quantity) { exhausted = true; reasons.add(quota.period === 'week' ? 'weekly_limit_reached' : 'monthly_limit_reached'); }
    }
    if (exhausted) { if (!reasons.has('weekly_limit_reached') && !reasons.has('monthly_limit_reached')) reasons.add('entitlement_exhausted'); continue; }
    const validUntil = [first.endsOn, ...validityEndDates].filter((value): value is string => Boolean(value)).sort()[0] ?? null;
    alternatives.push({ assignmentId, planId: first.planId, planName: first.planName, accessRightId: first.accessRightId,
      quotaRightIds: quotaRows.map((right) => right.quotaRightId!), sessionsQuotaRightIds: sessionsRows.map((right) => right.quotaRightId!),
      entitlementPeriodIdsByRightId: Object.fromEntries(sessionsRows.filter((right) => right.entitlementPeriodId).map((right) => [right.quotaRightId!, right.entitlementPeriodId!])),
      availableBalance: sessionsRows.some((right) => right.entitlementMode !== 'unlimited')
        ? Math.min(...sessionsRows.map((right) => Number(right.balance ?? 0))) : null,
      periodUsage, validUntil });
  }
  if (!alternatives.length) {
    const reason = reasons.values().next().value ?? 'no_entitlement';
    return { ...denied(reason), availableAlternatives: [], ...(capacity ? { capacity } : {}) };
  }
  if (sessionFull && !request.allowFullSession) return { ...denied('session_full'), availableAlternatives: alternatives, ...(capacity ? { capacity } : {}) };
  // No implicit choice between separate assignments: their commercial effects
  // may differ. A booking mutation must name the chosen assignment when needed.
  const selected = alternatives.length === 1 ? alternatives[0]! : undefined;
  return { eligible: true, entitlementId: selected?.accessRightId ?? '',
    ...(selected ? { assignmentId: selected.assignmentId, planId: selected.planId, selectedEntitlement: selected } : {}),
    availableAlternatives: alternatives, ...(capacity ? { capacity } : {}),
    blockingReasons: [], waitlistAllowed: true, overridePossible: false };
}

export type BookingEligibilityResolver = (request: BookingEligibilityRequest) => Promise<BookingEligibilityResult>;
export const createBookingEligibilityResolver = (): BookingEligibilityResolver => evaluateBookingEligibility;
/** Fail closed for isolated tests and integrations that explicitly omit the engine. */
export const unavailableBookingEligibility: BookingEligibilityResolver = async () => ({ eligible: false, reason: 'entitlement_unavailable', blockingReasons: ['entitlement_unavailable'] });

function denied(reason: BookingBlockingReason): BookingEligibilityResult {
  return { eligible: false, reason, blockingReasons: [reason], selectedEntitlement: null, waitlistAllowed: reason === 'session_full', overridePossible: false };
}

async function resolveQuotaPeriod(tx: TransactionSql<Record<string, unknown>>, right: EntitlementRow, startsAt: string, now: Date) {
  const pivot = right.periodMode === 'rolling' ? now.toISOString() : startsAt;
  const [row] = await tx`SELECT
    CASE WHEN ${right.period}='week' AND ${right.periodMode}='rolling' THEN ${pivot}::timestamptz - interval '7 days'
      WHEN ${right.period}='month' AND ${right.periodMode}='rolling' THEN ${pivot}::timestamptz - interval '1 month'
      WHEN ${right.period}='week' THEN date_trunc('week',${pivot}::timestamptz AT TIME ZONE ${right.timezone}) AT TIME ZONE ${right.timezone}
      WHEN ${right.period}='month' THEN date_trunc('month',${pivot}::timestamptz AT TIME ZONE ${right.timezone}) AT TIME ZONE ${right.timezone}
      ELSE ${pivot}::timestamptz END AS "startsAt",
    CASE WHEN ${right.period}='week' AND ${right.periodMode}='rolling' THEN ${pivot}::timestamptz
      WHEN ${right.period}='month' AND ${right.periodMode}='rolling' THEN ${pivot}::timestamptz
      WHEN ${right.period}='week' THEN (date_trunc('week',${pivot}::timestamptz AT TIME ZONE ${right.timezone}) + interval '1 week') AT TIME ZONE ${right.timezone}
      WHEN ${right.period}='month' THEN (date_trunc('month',${pivot}::timestamptz AT TIME ZONE ${right.timezone}) + interval '1 month') AT TIME ZONE ${right.timezone}
      ELSE ${pivot}::timestamptz + interval '1 day' END AS "endsAt"`;
  return { startsAt: new Date(String(row!.startsAt)).toISOString(), endsAt: new Date(String(row!.endsAt)).toISOString() };
}

function addLocalDays(date: string, days: number) {
  const result = new Date(`${date}T12:00:00Z`); result.setUTCDate(result.getUTCDate()+days);
  return result.toISOString().slice(0,10);
}
