import { createHash, randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import { resolveEffectiveClientAssignments } from './entitlements.js';
import { enqueuePushForClient } from './push.js';

type Tx = Sql<Record<string, unknown>>;
export type ReconcileResult = { cancelled: number; restored: number; checked: number };

/**
 * D247/D253/D254 — one reconciliation service for every event that can change what a member is entitled to
 * (plan change, payment voided, period changed, membership ended). It is the only place that decides whether a
 * future reservation is still covered.
 *
 * Rules:
 * - A reserved, future session is COVERED when at least one of its rights points to an assignment that is active and
 *   operationally usable (charge settled or provisional). Reservations with no recorded rights are left alone: we do not
 *   cancel what we cannot explain.
 * - An uncovered reservation is cancelled without penalty (status cancelled_by_membership), its sessions_quota units
 *   are restored through the immutable ledger, and the audit trail records it.
 * - Idempotent: the reservation update is guarded by status='reserved', restores are keyed by reservation and right, and the
 *   push is deduplicated by eventKey. Running it twice for the same event changes nothing the second time.
 * - Runs in the caller's transaction and locks the client's assignments first, so it serializes with booking and payment writes.
 */
export async function reconcileClientReservationCoverage(
  tx: Tx,
  input: { clientId: string; actorId: string; eventKey: string; now?: Date },
): Promise<ReconcileResult> {
  const now = input.now ?? new Date();
  await tx`SELECT id FROM client_plan_assignments WHERE client_id=${input.clientId}::uuid ORDER BY id FOR UPDATE`;

  const reserved = await tx`SELECT r.id, r.session_id AS "sessionId"
    FROM calendar_reservations r JOIN calendar_sessions s ON s.id=r.session_id
    WHERE r.client_id=${input.clientId}::uuid AND r.status='reserved' AND s.starts_at>${now.toISOString()}::timestamptz
    ORDER BY r.id FOR UPDATE OF r`;
  if (reserved.length === 0) return { cancelled: 0, restored: 0, checked: 0 };

  // Single source of truth: the same resolver the booking and access paths use (usable = active + operational + target present).
  const { effective } = await resolveEffectiveClientAssignments(tx as never, input.clientId, now);
  const usable = new Set(effective.assignments.filter(assignment => assignment.usable).map(assignment => String(assignment.id)));

  let cancelled = 0, restored = 0;
  for (const reservation of reserved) {
    const rights = await tx`SELECT assignment_id AS "assignmentId", right_id AS "rightId", right_type AS "rightType", entitlement_period_id AS "periodId", ledger_entry_id AS "ledgerEntryId"
      FROM calendar_reservation_rights WHERE reservation_id=${String(reservation.id)}::uuid ORDER BY assignment_id, right_id`;
    if (rights.length === 0) continue;
    if (rights.some(right => usable.has(String(right.assignmentId)))) continue;

    const [updated] = await tx`UPDATE calendar_reservations SET status='cancelled_by_membership', cancelled_at=${now.toISOString()}::timestamptz,
        cancelled_by=${'system:entitlement-reconciliation'}, updated_at=${now.toISOString()}::timestamptz
      WHERE id=${String(reservation.id)}::uuid AND status='reserved' RETURNING id`;
    if (!updated) continue;
    cancelled++;

    for (const right of rights.filter(item => item.rightType === 'sessions_quota' && item.ledgerEntryId != null)) {
      const reference = `calendar_reservation_restore:${reservation.id}:${right.rightId}`;
      const [prior] = await tx`SELECT id FROM client_entitlement_ledger WHERE external_reference=${reference}`;
      if (prior) continue;
      const [entry] = await tx`INSERT INTO client_entitlement_ledger(client_id,assignment_id,right_key,entitlement_period_id,entry_type,quantity,reason,external_reference,actor_id,idempotency_key,request_hash)
        VALUES (${input.clientId}::uuid,${String(right.assignmentId)}::uuid,${String(right.rightId)},${right.periodId ?? null},'restore',1,
          ${'Reserva cancelada por cambio en la cuota'},${reference},${input.actorId},${randomUUID()},
          ${createHash('sha256').update(`restore:${reservation.id}:${right.rightId}`).digest('hex')})
        RETURNING id`;
      restored++;
      await tx`INSERT INTO calendar_audit_events(actor_id,action,resource_type,resource_id,session_id,client_id,details)
        VALUES (${input.actorId},'reservation.entitlement_restored','calendar_reservation',${String(reservation.id)},${String(reservation.sessionId)},${input.clientId},
          ${JSON.stringify({ rightId: String(right.rightId), ledgerEntryId: String(entry!.id), eventKey: input.eventKey })}::text::jsonb)`;
    }
    await tx`INSERT INTO calendar_audit_events(actor_id,action,resource_type,resource_id,session_id,client_id,details)
      VALUES (${input.actorId},'reservation.cancelled_by_membership','calendar_reservation',${String(reservation.id)},${String(reservation.sessionId)},${input.clientId},
        ${JSON.stringify({ previousStatus: 'reserved', newStatus: 'cancelled_by_membership', eventKey: input.eventKey })}::text::jsonb)`;
  }

  // D248: one grouped push per member and event, only when something was cancelled.
  if (cancelled > 0) {
    await enqueuePushForClient(tx, input.clientId, 'booking.cancelled_by_membership', `reconcile-push:${input.eventKey}:${input.clientId}`, { count: Math.min(cancelled, 999) });
  }
  return { cancelled, restored, checked: reserved.length };
}
