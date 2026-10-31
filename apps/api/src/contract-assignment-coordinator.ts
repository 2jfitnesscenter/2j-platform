import { createHash, randomUUID } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import { canaryBusinessDate, calculateContractEnd, calculateContractPaymentDeadline, EntitlementMaterializationError, validateCustomContractRange, validateNaturalMonthContract } from '@2j/domain';
import { can, type AuthorizationContext } from '@2j/permissions';
import { z } from 'zod';
import type { createDatabase } from './db.js';
import { materializeContractEntitlementPeriods } from './assignment-periods.js';

type DB = ReturnType<typeof createDatabase>['client'];
type Tx = TransactionSql<Record<string, unknown>>;

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
});
const requestSchema = z.object({
  clientId: uuid,
  planId: uuid,
  idempotencyKey: uuid,
  contractStart: dateOnly,
  dueOn: dateOnly.optional(),
  customRangeEnd: dateOnly.optional(),
  amountCents: z.number().int().min(1).max(100_000_000_000),
  adjustmentReason: z.string().trim().min(3).max(240).optional(),
}).strict();

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dbCode = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
const monthEnd = (value: string) => new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)), 0)).toISOString().slice(0, 10);

async function loadPersistedAssignmentResult(tx: Tx, assignmentId: string, replay: boolean) {
  const [row] = await tx`SELECT a.id AS "assignmentId",a.charge_id AS "chargeId",a.starts_on::text AS "startsOn",a.ends_on::text AS "endsOn",
      c.due_on::text AS "dueOn",t.term_kind AS "termKind",t.contract_start::text AS "contractStart",t.contract_end::text AS "contractEnd",
      t.term_months AS "termMonths",t.payment_rule AS "paymentRule",t.payment_block AS "paymentBlock",t.deadline_computation AS deadline
    FROM client_plan_assignments a JOIN economic_charges c ON c.id=a.charge_id
    JOIN assignment_contract_terms t ON t.assignment_id=a.id WHERE a.id=${assignmentId}`;
  if (!row) throw new ContractAssignmentError('idempotency_conflict');
  if (row.deadline?.dueOn !== row.dueOn) throw new ContractAssignmentError('idempotency_conflict');
  const periods = await tx`SELECT id,right_id AS "rightId",period_index AS "periodIndex",period_start::text AS "startsOn",
      period_end::text AS "endsOn",entitlement_mode AS mode,sessions_granted AS "sessionsGranted"
    FROM assignment_entitlement_periods WHERE assignment_id=${assignmentId} ORDER BY right_id,period_index`;
  const grants = await tx`SELECT id,entitlement_period_id AS "periodId",right_key AS "rightId",quantity
    FROM client_entitlement_ledger WHERE assignment_id=${assignmentId} AND entry_type='grant' AND entitlement_period_id IS NOT NULL
    ORDER BY entitlement_period_id,id`;
  return {
    assignmentId: String(row.assignmentId), chargeId: String(row.chargeId), startsOn: String(row.startsOn),
    endsOn: row.endsOn == null ? null : String(row.endsOn), dueOn: String(row.dueOn),
    paymentBlockEffectiveOn: row.deadline.paymentBlockEffectiveOn ?? null,
    contract: {
      termKind: row.termKind, termMonths: row.termMonths == null ? null : Number(row.termMonths),
      contractStart: row.contractStart == null ? null : String(row.contractStart),
      contractEnd: row.contractEnd == null ? null : String(row.contractEnd),
      paymentRule: row.paymentRule, paymentBlock: row.paymentBlock,
    },
    periods: periods.map(period => ({
      id: String(period.id), rightId: String(period.rightId), periodIndex: period.periodIndex == null ? null : Number(period.periodIndex),
      startsOn: String(period.startsOn), endsOn: period.endsOn == null ? null : String(period.endsOn), mode: period.mode,
      sessionsGranted: period.sessionsGranted == null ? null : Number(period.sessionsGranted),
    })),
    grants: grants.map(grant => ({ id: String(grant.id), periodId: String(grant.periodId), rightId: String(grant.rightId), quantity: Number(grant.quantity) })),
    replay,
  };
}

export class ContractAssignmentError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'ContractAssignmentError'; }
}

/**
 * Atomically creates a new 2J term assignment, its single charge, immutable
 * contract facts and initial F1-B period bags. This service is intentionally
 * not wired to a public sale route until F1-C receives independent review.
 */
export async function coordinateContractAssignment(
  db: DB,
  rawInput: unknown,
  context: AuthorizationContext,
  now = new Date(),
) {
  if (!can(context, 'entitlements.manage') || !can(context, 'clients.read')) throw new ContractAssignmentError('permission_denied');
  if (!context.actorId || context.actorId.length > 120) throw new ContractAssignmentError('invalid_actor');
  const parsed = requestSchema.safeParse(rawInput);
  if (!parsed.success) throw new ContractAssignmentError('validation_error');
  const input = parsed.data;
  const assignedLocalDate = canaryBusinessDate(now);
  const requestHash = digest({
    clientId: input.clientId,
    planId: input.planId,
    contractStart: input.contractStart,
    customRangeEnd: input.customRangeEnd ?? null,
    dueOn: input.dueOn ?? null,
    amountCents: input.amountCents,
    adjustmentReason: input.adjustmentReason ?? null,
  });

  try {
    return await db.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${input.idempotencyKey},0))`;
      const [prior] = await tx`SELECT id,request_hash AS "requestHash",charge_id AS "chargeId",starts_on::text AS "startsOn",ends_on::text AS "endsOn"
        FROM client_plan_assignments WHERE idempotency_key=${input.idempotencyKey}`;
      if (prior) {
        if (String(prior.requestHash).trim() !== requestHash) throw new ContractAssignmentError('idempotency_conflict');
        return loadPersistedAssignmentResult(tx as Tx, String(prior.id), true);
      }

      const [client] = await tx`SELECT id,status FROM clients WHERE id=${input.clientId} FOR UPDATE`;
      if (!client || client.status !== 'active') throw new ContractAssignmentError('client_unavailable');

      const [plan] = await tx`SELECT p.id,p.name,p.status,p.current_version AS "currentVersion",v.kind,v.term_kind AS "termKind",
          v.term_months AS "termMonths",v.max_span_days AS "maxSpanDays",v.payment_rule AS "paymentRule",v.payment_block AS "paymentBlock",
          v.base_price_cents AS "basePriceCents",v.renewal_cadence AS "renewalCadence",v.period_days AS "periodDays",v.timezone,v.frozen_at AS "frozenAt"
        FROM plans p JOIN plan_versions v ON v.plan_id=p.id AND v.version=p.current_version
        WHERE p.id=${input.planId} AND p.status='active' AND v.frozen_at IS NOT NULL
          AND v.term_kind IN ('natural_month','custom_range','rolling_months','pack','one_off')
          AND EXISTS (SELECT 1 FROM plan_services ps WHERE ps.plan_id=p.id AND ps.plan_version=v.version)
          AND NOT EXISTS (SELECT 1 FROM plan_rights r WHERE r.plan_id=p.id AND r.plan_version=v.version AND r.right_type='service_access' AND r.service_id IS NULL)
          AND NOT EXISTS (SELECT 1 FROM plan_services ps JOIN services s ON s.id=ps.service_id JOIN areas a ON a.id=s.area_id
            WHERE ps.plan_id=p.id AND ps.plan_version=v.version AND (s.status<>'active' OR a.status<>'active'))
        FOR SHARE OF p,v`;
      if (!plan) throw new ContractAssignmentError('term_plan_unavailable');

      const termKind = String(plan.termKind) as 'natural_month' | 'custom_range' | 'rolling_months' | 'pack' | 'one_off';
      const fixedTerm = termKind === 'pack' || termKind === 'one_off';
      if(!fixedTerm&&input.dueOn!=null)throw new ContractAssignmentError('validation_error');
      let contractEnd: string | null;
      let deadline: {rule:string;assignedLocalDate:string;inputs:Record<string,unknown>;dueOn:string;accessBlockEffectiveOn?:string|null} | null = null;
      let paymentBlock: 'enforce'|'off' = 'off';
      if (fixedTerm) {
        if (input.customRangeEnd || !input.dueOn || input.dueOn < assignedLocalDate) throw new ContractAssignmentError('fixed_term_due_date_required');
        if (plan.paymentRule !== 'on_payment_v1' || plan.paymentBlock !== 'off') throw new ContractAssignmentError('term_plan_invalid');
        contractEnd = null;
        paymentBlock = 'off';
        deadline = {rule:'on_payment_v1',assignedLocalDate,inputs:{dueOn:input.dueOn},dueOn:input.dueOn,accessBlockEffectiveOn:null};
      } else if (termKind === 'natural_month') {
        if (input.customRangeEnd) throw new ContractAssignmentError('contract_range_not_allowed');
        contractEnd = monthEnd(input.contractStart);
        const valid = validateNaturalMonthContract(assignedLocalDate, input.contractStart, contractEnd);
        if (!valid.valid) throw new ContractAssignmentError(valid.error);
      } else if (termKind === 'custom_range') {
        if (!input.customRangeEnd) throw new ContractAssignmentError('contract_end_required');
        contractEnd = input.customRangeEnd;
        const valid = validateCustomContractRange(assignedLocalDate, input.contractStart, contractEnd, plan.maxSpanDays == null ? null : Number(plan.maxSpanDays));
        if (!valid.valid) throw new ContractAssignmentError(valid.error);
      } else {
        if (input.customRangeEnd || ![3, 6, 12].includes(Number(plan.termMonths))) throw new ContractAssignmentError('rolling_term_invalid');
        contractEnd = calculateContractEnd(input.contractStart, Number(plan.termMonths));
        if (contractEnd < assignedLocalDate) throw new ContractAssignmentError('contract_start_before_assignment');
      }

      if (!fixedTerm) {
        const expectedPaymentRule = termKind === 'natural_month' ? 'monthly_day10_v1' : 'grace_from_assignment_v1';
        if (plan.paymentRule !== expectedPaymentRule || !['enforce', 'off'].includes(String(plan.paymentBlock))) throw new ContractAssignmentError('term_plan_invalid');
        const [settings] = await tx`SELECT due_day AS "dueDay",grace_days AS "graceDays",timezone FROM economic_settings WHERE singleton=true FOR SHARE`;
        if (!settings || settings.timezone !== 'Atlantic/Canary') throw new ContractAssignmentError('economic_settings_unavailable');
        deadline = calculateContractPaymentDeadline({
          termKind:termKind as 'natural_month'|'custom_range'|'rolling_months',
          assignedLocalDate,
          contractStart: input.contractStart,
          contractEnd: contractEnd!,
          dueDay: Number(settings.dueDay),
          graceDays: Number(settings.graceDays),
        });
        paymentBlock=String(plan.paymentBlock) as 'enforce'|'off';
      }
      if (!deadline) throw new ContractAssignmentError('term_plan_invalid');
      const paymentDeadline=deadline;

      const [commercial] = await tx`SELECT
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'area',a.name) ORDER BY s.id)
          FROM plan_services ps JOIN services s ON s.id=ps.service_id JOIN areas a ON a.id=s.area_id WHERE ps.plan_id=${plan.id} AND ps.plan_version=${plan.currentVersion}),'[]'::jsonb) AS services,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'rightType',r.right_type,'trainingAccessLevel',r.training_access_level,'serviceId',r.service_id,
          'quotaScope',r.quota_scope,'quantity',r.quantity,'weeklyFrequency',r.weekly_frequency,'quantityRule',r.quantity_rule,'period',r.period,
          'periodMode',r.period_mode,'timezone',r.timezone,'validDays',r.valid_days,'validDaysStartRule',r.valid_days_start_rule)
          ORDER BY r.id) FROM plan_rights r WHERE r.plan_id=${plan.id} AND r.plan_version=${plan.currentVersion}),'[]'::jsonb) AS rights,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('module',m.module,'accessLevel',m.access_level,'capabilities',COALESCE(
          (SELECT jsonb_agg(c.capability ORDER BY c.capability) FROM plan_module_capabilities c WHERE c.plan_id=m.plan_id AND c.plan_version=m.plan_version AND c.module=m.module),'[]'::jsonb))
          ORDER BY m.module) FROM plan_module_accesses m WHERE m.plan_id=${plan.id} AND m.plan_version=${plan.currentVersion}),'[]'::jsonb) AS modules`;
      const listPrice = plan.basePriceCents == null ? null : Number(plan.basePriceCents);
      if (listPrice == null && !can(context, 'catalog.pricing.manage')) throw new ContractAssignmentError('catalog_price_required');
      if (listPrice != null && listPrice !== input.amountCents && !can(context, 'catalog.pricing.manage')) throw new ContractAssignmentError('price_override_forbidden');
      if ((listPrice == null || listPrice !== input.amountCents) && !input.adjustmentReason) throw new ContractAssignmentError('adjustment_reason_required');

      const assignmentId = randomUUID();
      const chargeId = randomUUID();
      const chargeKey = randomUUID();
      const concept = `${String(plan.name)} · Contrato`;
      const contractSnapshot = {
        termKind,
        termMonths: termKind === 'rolling_months' ? Number(plan.termMonths) : null,
        contractStart: fixedTerm ? null : input.contractStart,
        contractEnd,
        paymentRule: paymentDeadline.rule,
        paymentBlock,
      };
      const assignmentSnapshot = {
        planId: plan.id,
        planVersion: Number(plan.currentVersion),
        name: plan.name,
        kind: plan.kind,
        listPriceCents: listPrice,
        salePriceCents: input.amountCents,
        priceAdjustmentCents: listPrice == null ? 0 : input.amountCents - listPrice,
        priceAdjustmentReason: input.adjustmentReason ?? null,
        currency: 'EUR',
        soldBy: context.actorId,
        services: commercial!.services,
        rights: commercial!.rights,
        modules: commercial!.modules,
        startsOn: input.contractStart,
        endsOn: contractEnd,
        terms: { ...contractSnapshot, renewalCadence: plan.renewalCadence, periodDays: plan.periodDays, timezone: plan.timezone },
      };
      const paymentBlockEffectiveOn = paymentBlock === 'enforce' ? paymentDeadline.accessBlockEffectiveOn ?? null : null;
      const deadlineSnapshot = { ...paymentDeadline, paymentBlockEffectiveOn };

      await tx`INSERT INTO economic_charges(id,client_id,plan_id,concept,amount_cents,due_on,state,created_by,idempotency_key,request_hash)
        VALUES (${chargeId},${client.id},${plan.id},${concept},${input.amountCents},${paymentDeadline.dueOn},'pending',${context.actorId},${chargeKey},${requestHash})`;
      await tx`INSERT INTO client_plan_assignments(id,client_id,plan_id,plan_version,charge_id,starts_on,ends_on,idempotency_key,request_hash,created_by,sale_price_cents,snapshot)
        VALUES (${assignmentId},${client.id},${plan.id},${plan.currentVersion},${chargeId},${input.contractStart},${fixedTerm?null:contractEnd},${input.idempotencyKey},${requestHash},${context.actorId},${input.amountCents},${JSON.stringify(assignmentSnapshot)}::text::jsonb)`;
      await tx`INSERT INTO assignment_contract_terms(assignment_id,term_kind,contract_start,contract_end,term_months,payment_rule,payment_block,deadline_computation,assigned_local_date)
        VALUES (${assignmentId},${termKind},${fixedTerm?null:input.contractStart},${fixedTerm?null:contractEnd},${contractSnapshot.termMonths},${paymentDeadline.rule},${paymentBlock},${JSON.stringify(deadlineSnapshot)}::text::jsonb,${assignedLocalDate})`;
      await tx`INSERT INTO client_plan_assignment_events(assignment_id,event_type,effective_on,actor_id,actor_role,idempotency_key,request_hash)
        VALUES (${assignmentId},'activated',${input.contractStart},${context.actorId},${context.role},${randomUUID()},${requestHash})`;

      await materializeContractEntitlementPeriods(tx as Tx, assignmentId, context.actorId);
      await tx`INSERT INTO client_events(client_id,event_type,actor_id,actor_role) VALUES (${client.id},'client.plan_assigned',${context.actorId},${context.role})`;
      await tx`INSERT INTO economic_audit_events(actor_id,action,resource_type,resource_id,client_id,details)
        VALUES (${context.actorId},'client_plan.assigned','client_plan_assignment',${assignmentId},${client.id},${JSON.stringify({planId:plan.id,planVersion:Number(plan.currentVersion),chargeId,amountCents:input.amountCents,termKind,contractStart:fixedTerm?null:input.contractStart,contractEnd,dueOn:paymentDeadline.dueOn})}::text::jsonb)`;
      await tx`INSERT INTO economic_audit_events(actor_id,action,resource_type,resource_id,client_id,details)
        VALUES (${context.actorId},'charge.created','charge',${chargeId},${client.id},${JSON.stringify({amountCents:input.amountCents,planId:plan.id,assignmentId,dueOn:paymentDeadline.dueOn})}::text::jsonb)`;
      return loadPersistedAssignmentResult(tx as Tx, assignmentId, false);
    });
  } catch (error) {
    if (error instanceof ContractAssignmentError) throw error;
    if (error instanceof EntitlementMaterializationError) throw new ContractAssignmentError(error.code);
    if (dbCode(error) === '23505') throw new ContractAssignmentError('idempotency_conflict');
    if (dbCode(error) === '23503' || dbCode(error) === '23514' || dbCode(error) === '55000') throw new ContractAssignmentError('term_assignment_conflict');
    throw error;
  }
}
