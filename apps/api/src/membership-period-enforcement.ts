import { createHash } from 'node:crypto';
import type { Sql } from 'postgres';
import { canaryBusinessDate } from '@2j/domain';
import { appendNotificationEvent } from './notifications.js';

type Db = Sql<Record<string, unknown>>;

/**
 * Expire unpaid scheduled entitlement bookings after the charge deadline.
 * The assignment and charge locks serialize this with booking/payment writes;
 * all changes to a reservation, its restored bag, audit and notice are atomic.
 */
export async function cancelUncoveredPeriodBookings(db: Db, now = new Date()) {
  const today = canaryBusinessDate(now);
  const candidates = await db`
    SELECT DISTINCT p.id AS "periodId",p.assignment_id AS "assignmentId",p.client_id AS "clientId",COALESCE(linked.charge_id,a.charge_id) AS "chargeId"
    FROM assignment_entitlement_periods p
    JOIN client_plan_assignments a ON a.id=p.assignment_id AND a.client_id=p.client_id
    JOIN plan_versions v ON v.plan_id=a.plan_id AND v.version=a.plan_version
    LEFT JOIN LATERAL(SELECT e.charge_id FROM assignment_entitlement_period_events e WHERE e.period_id=p.id AND e.event_type='charge_linked' ORDER BY e.created_at DESC,e.id DESC LIMIT 1) linked ON true
    JOIN economic_charges c ON c.id=COALESCE(linked.charge_id,a.charge_id)
    LEFT JOIN LATERAL(SELECT COALESCE(sum(amount_cents) FILTER(WHERE kind='payment'),0)::bigint AS paid,
      COALESCE(sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END),0)::bigint AS net
      FROM economic_transactions WHERE charge_id=c.id) balance ON true
    WHERE c.state='pending' AND c.due_on<${today}::date
      AND balance.net<c.amount_cents AND NOT (balance.paid>0 AND balance.net=0)
      AND EXISTS(SELECT 1 FROM calendar_reservation_rights cr JOIN calendar_reservations r ON r.id=cr.reservation_id
        WHERE cr.assignment_id=p.assignment_id AND cr.entitlement_period_id=p.id AND r.status='reserved')
      AND v.kind='recurring' AND v.renewal_cadence='monthly' AND (v.term_kind IS NULL OR v.term_kind='natural_month')
    ORDER BY p.id LIMIT 500`;
  let cancelled = 0;
  for (const candidate of candidates) {
    const changed = await db.begin(async tx => {
      let periodCancelled = 0;
      await tx`SELECT id FROM client_plan_assignments WHERE id=${candidate.assignmentId} FOR UPDATE`;
      await tx`SELECT id FROM economic_charges WHERE id=${candidate.chargeId} FOR UPDATE`;
      const [charge] = await tx`SELECT c.state,c.amount_cents AS amount,"balance".net::bigint AS net,"balance".paid::bigint AS paid,c.due_on::text AS "dueOn"
        FROM economic_charges c LEFT JOIN LATERAL(SELECT COALESCE(sum(amount_cents) FILTER(WHERE kind='payment'),0)::bigint AS paid,
          COALESCE(sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END),0)::bigint AS net
          FROM economic_transactions WHERE charge_id=c.id) balance ON true
        WHERE c.id=${candidate.chargeId}`;
      if (!charge || charge.state!=='pending' || String(charge.dueOn)>=today || Number(charge.net)>=Number(charge.amount) || (Number(charge.paid)>0&&Number(charge.net)===0)) return 0;
      const [assignment] = await tx`SELECT a.charge_id AS "chargeId",v.kind,v.renewal_cadence AS cadence,v.term_kind AS "termKind"
        FROM client_plan_assignments a JOIN plan_versions v ON v.plan_id=a.plan_id AND v.version=a.plan_version
        WHERE a.id=${candidate.assignmentId}`;
      const [link] = await tx`SELECT EXISTS(SELECT 1 FROM assignment_entitlement_period_events WHERE period_id=${candidate.periodId} AND assignment_id=${candidate.assignmentId} AND charge_id=${candidate.chargeId} AND event_type='charge_linked') AS linked`;
      if (!assignment || (assignment.chargeId !== candidate.chargeId && !link?.linked)) return 0;
      if (assignment.kind!=='recurring'||assignment.cadence!=='monthly'||(assignment.termKind!=null&&assignment.termKind!=='natural_month')) return 0;
      const reservations = await tx`SELECT r.id,r.client_id AS "clientId",r.session_id AS "sessionId"
        FROM calendar_reservations r JOIN calendar_reservation_rights cr ON cr.reservation_id=r.id
        WHERE cr.assignment_id=${candidate.assignmentId} AND cr.entitlement_period_id=${candidate.periodId} AND r.status='reserved'
        ORDER BY r.id FOR UPDATE OF r`;
      for (const reservation of reservations) {
        const [updated] = await tx`UPDATE calendar_reservations SET status='cancelled_by_membership',cancelled_at=${now.toISOString()},cancelled_by='system:membership-period-worker',updated_at=${now.toISOString()}
          WHERE id=${reservation.id} AND status='reserved' RETURNING id`;
        if (!updated) continue;
        const consumed = await tx`SELECT cr.assignment_id AS "assignmentId",cr.client_id AS "clientId",cr.right_id AS "rightId",cr.entitlement_period_id AS "periodId"
          FROM calendar_reservation_rights cr WHERE cr.reservation_id=${reservation.id} AND cr.right_type='sessions_quota' AND cr.ledger_entry_id IS NOT NULL ORDER BY cr.assignment_id,cr.right_id`;
        for (const item of consumed) {
          const reference=`calendar_reservation_restore:${reservation.id}:${item.rightId}`;
          const [existing] = await tx`SELECT id FROM client_entitlement_ledger WHERE external_reference=${reference}`;
          if (existing) continue;
          const [entry] = await tx`INSERT INTO client_entitlement_ledger(client_id,assignment_id,right_key,entitlement_period_id,entry_type,quantity,reason,external_reference,actor_id,idempotency_key,request_hash)
            VALUES (${item.clientId},${item.assignmentId},${String(item.rightId)},${item.periodId},'restore',1,'Reserva cancelada por cuota pendiente tras vencimiento',${reference},'system:membership-period-worker',gen_random_uuid(),${createHash('sha256').update(`restore:${reservation.id}:${item.rightId}`).digest('hex')}) RETURNING id`;
          await tx`INSERT INTO calendar_audit_events(actor_id,action,resource_type,resource_id,session_id,client_id,details)
            VALUES ('system:membership-period-worker','reservation.entitlement_restored','calendar_reservation',${reservation.id},${reservation.sessionId},${reservation.clientId},${tx.json({rightId:item.rightId,ledgerEntryId:entry!.id,reason:'membership_payment_overdue'})})`;
        }
        await tx`INSERT INTO calendar_audit_events(actor_id,action,resource_type,resource_id,session_id,client_id,details)
          VALUES ('system:membership-period-worker','reservation.cancelled_by_membership','calendar_reservation',${reservation.id},${reservation.sessionId},${reservation.clientId},${tx.json({previousStatus:'reserved',newStatus:'cancelled_by_membership',periodId:candidate.periodId,dueOn:charge.dueOn,penalty:false})})`;
        await appendNotificationEvent(tx,{type:'booking.cancelled_by_membership',aggregateType:'calendar_reservation',aggregateId:String(reservation.id),clientId:String(reservation.clientId),dedupeKey:`membership-period-cancelled:${reservation.id}`});
        periodCancelled++;
      }
      return periodCancelled;
    });
    cancelled += changed;
  }
  return {cancelled, checked:candidates.length, localDate:today, timezone:'Atlantic/Canary' as const};
}
