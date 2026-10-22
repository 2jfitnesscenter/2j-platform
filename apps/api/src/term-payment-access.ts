import type { TransactionSql } from 'postgres';
import { addDateDays, canaryBusinessDate, isValidDateOnly } from '@2j/domain';

type Tx = TransactionSql<Record<string, unknown>>;

export type TermPaymentAccessState = 'allowed' | 'payment_pending' | 'payment_overdue' | 'entitlement_unavailable';
export interface TermPaymentAccess {
  readonly assignmentId: string;
  readonly chargeId: string | null;
  readonly state: TermPaymentAccessState;
  readonly dueOn: string | null;
  readonly paymentBlockEffectiveOn: string | null;
  readonly requiredAmountCents: number | null;
  readonly netValidatedAmountCents: number;
  readonly outstandingAmountCents: number | null;
  readonly paymentBlock: 'enforce' | 'off' | null;
}

/** Pure date-and-ledger derivation. The stored deadline snapshot is the authority. */
export function deriveTermPaymentAccess(input: {
  assignmentId: string;
  chargeId: string | null;
  termKind: string;
  contractTermKind?: string | null;
  assignedLocalDate?: string | null;
  paymentRule: string | null;
  paymentBlock: string | null;
  deadline: unknown;
  dueOn: string | null;
  chargeState: string | null;
  requiredAmountCents: number | null;
  netValidatedAmountCents: number;
  businessNow: Date;
}): TermPaymentAccess {
  const unavailable = (): TermPaymentAccess => ({
    assignmentId: input.assignmentId, chargeId: input.chargeId, state: 'entitlement_unavailable',
    dueOn: input.dueOn, paymentBlockEffectiveOn: null, requiredAmountCents: input.requiredAmountCents,
    netValidatedAmountCents: input.netValidatedAmountCents, outstandingAmountCents: null,
    paymentBlock: input.paymentBlock === 'off' || input.paymentBlock === 'enforce' ? input.paymentBlock : null,
  });
  if (!['natural_month', 'custom_range', 'rolling_months'].includes(input.termKind)
    || (input.contractTermKind !== undefined && input.contractTermKind !== input.termKind)
    || (input.assignedLocalDate !== undefined && !input.assignedLocalDate)
    || !['monthly_day10_v1', 'grace_from_assignment_v1'].includes(String(input.paymentRule))
    || !['enforce', 'off'].includes(String(input.paymentBlock))
    || !input.chargeId || !input.dueOn || !Number.isSafeInteger(input.requiredAmountCents) || Number(input.requiredAmountCents) <= 0
    || !Number.isSafeInteger(input.netValidatedAmountCents) || input.netValidatedAmountCents < 0) return unavailable();
  const snapshot = input.deadline;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return unavailable();
  const data = snapshot as Record<string, unknown>;
  let expectedBlockDate: string;
  try { expectedBlockDate = addDateDays(input.dueOn, 1); }
  catch { return unavailable(); }
  if (data.rule !== input.paymentRule || data.dueOn !== input.dueOn
    || typeof data.assignedLocalDate !== 'string' || typeof data.accessBlockEffectiveOn !== 'string'
    || !isValidDateOnly(data.dueOn) || !isValidDateOnly(data.assignedLocalDate)
    || !isValidDateOnly(data.accessBlockEffectiveOn)
    || data.accessBlockEffectiveOn !== expectedBlockDate) return unavailable();
  if ((input.assignedLocalDate !== undefined && data.assignedLocalDate !== input.assignedLocalDate)
    || (input.paymentBlock === 'enforce' && data.paymentBlockEffectiveOn !== data.accessBlockEffectiveOn)
    || (input.paymentBlock === 'off' && data.paymentBlockEffectiveOn != null)) return unavailable();
  if (input.termKind === 'natural_month' && input.paymentRule !== 'monthly_day10_v1') return unavailable();
  if (input.termKind !== 'natural_month' && input.paymentRule !== 'grace_from_assignment_v1') return unavailable();
  if (input.chargeState === 'exempt') return {
    assignmentId: input.assignmentId, chargeId: input.chargeId, state: 'allowed', dueOn: input.dueOn,
    paymentBlockEffectiveOn: input.paymentBlock === 'enforce' ? data.accessBlockEffectiveOn : null,
    requiredAmountCents: input.requiredAmountCents, netValidatedAmountCents: input.netValidatedAmountCents,
    outstandingAmountCents: 0, paymentBlock: input.paymentBlock as 'enforce' | 'off',
  };
  if (input.chargeState !== 'pending') return unavailable();
  const outstanding = Math.max(0, Number(input.requiredAmountCents) - input.netValidatedAmountCents);
  if (outstanding === 0) return {
    assignmentId: input.assignmentId, chargeId: input.chargeId, state: 'allowed', dueOn: input.dueOn,
    paymentBlockEffectiveOn: input.paymentBlock === 'enforce' ? data.accessBlockEffectiveOn : null,
    requiredAmountCents: input.requiredAmountCents, netValidatedAmountCents: input.netValidatedAmountCents,
    outstandingAmountCents: 0, paymentBlock: input.paymentBlock as 'enforce' | 'off',
  };
  const overdue = input.paymentBlock === 'enforce' && canaryBusinessDate(input.businessNow) >= String(data.accessBlockEffectiveOn);
  return {
    assignmentId: input.assignmentId, chargeId: input.chargeId, state: overdue ? 'payment_overdue' : 'payment_pending',
    dueOn: input.dueOn, paymentBlockEffectiveOn: input.paymentBlock === 'enforce' ? data.accessBlockEffectiveOn : null,
    requiredAmountCents: input.requiredAmountCents, netValidatedAmountCents: input.netValidatedAmountCents,
    outstandingAmountCents: outstanding, paymentBlock: input.paymentBlock as 'enforce' | 'off',
  };
}

/**
 * Read current economic truth for term assignments. Share-locking charge rows
 * serializes this decision with payment/refund writers (which take FOR UPDATE)
 * until the surrounding booking transaction commits or rolls back.
 */
export async function evaluateTermPaymentAccess(
  tx: Tx,
  assignments: readonly { assignmentId: string; termKind: string | null }[],
  businessNow: Date,
): Promise<Map<string, TermPaymentAccess>> {
  const termAssignments = assignments.filter(item => item.termKind !== null);
  const result = new Map<string, TermPaymentAccess>();
  if (!termAssignments.length) return result;
  const ids = termAssignments.map(item => item.assignmentId);

  // Lock in a stable order to avoid conflicting multi-assignment booking attempts.
  await tx`SELECT c.id FROM economic_charges c
    JOIN client_plan_assignments a ON a.charge_id=c.id
    WHERE a.id=ANY(${ids}::uuid[]) ORDER BY c.id FOR SHARE OF c`;

  // A second statement observes any payment/refund transaction committed while
  // this transaction waited for the charge lock (READ COMMITTED).
  const rows = await tx`SELECT a.id AS "assignmentId",a.client_id AS "clientId",a.plan_id AS "planId",a.sale_price_cents AS "salePriceCents",
      a.charge_id AS "chargeId",v.term_kind AS "termKind",t.term_kind AS "contractTermKind",t.assigned_local_date::text AS "assignedLocalDate",
      t.payment_rule AS "paymentRule",t.payment_block AS "paymentBlock",t.deadline_computation AS deadline,
      c.client_id AS "chargeClientId",c.plan_id AS "chargePlanId",c.due_on::text AS "dueOn",c.state AS "chargeState",c.amount_cents AS "requiredAmountCents",
      COALESCE(x.net,0)::bigint AS "netValidatedAmountCents"
    FROM client_plan_assignments a
    JOIN plan_versions v ON v.plan_id=a.plan_id AND v.version=a.plan_version
    LEFT JOIN assignment_contract_terms t ON t.assignment_id=a.id
    LEFT JOIN economic_charges c ON c.id=a.charge_id
    LEFT JOIN LATERAL (SELECT sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END) AS net
      FROM economic_transactions WHERE charge_id=c.id)x ON true
    WHERE a.id=ANY(${ids}::uuid[]) ORDER BY a.id`;
  const byId = new Map(rows.map(row => [String(row.assignmentId), row]));
  for (const assignment of termAssignments) {
    const row = byId.get(assignment.assignmentId);
    const referencesCoherent = row && row.chargeId != null && row.chargeClientId === row.clientId
      && row.chargePlanId === row.planId && Number(row.salePriceCents) === Number(row.requiredAmountCents);
    const access = deriveTermPaymentAccess({
      assignmentId: assignment.assignmentId, chargeId: row?.chargeId == null ? null : String(row.chargeId),
      termKind: String(row?.termKind ?? assignment.termKind), paymentRule: row?.paymentRule == null ? null : String(row.paymentRule),
      contractTermKind: referencesCoherent ? String(row.contractTermKind ?? '') : null,
      assignedLocalDate: referencesCoherent ? String(row.assignedLocalDate ?? '') : null,
      paymentBlock: row?.paymentBlock == null ? null : String(row.paymentBlock), deadline: row?.deadline ?? null,
      dueOn: row?.dueOn == null ? null : String(row.dueOn), chargeState: row?.chargeState == null ? null : String(row.chargeState),
      requiredAmountCents: row?.requiredAmountCents == null ? null : Number(row.requiredAmountCents),
      netValidatedAmountCents: Number(row?.netValidatedAmountCents ?? 0), businessNow,
    });
    result.set(assignment.assignmentId, access);
  }
  return result;
}
