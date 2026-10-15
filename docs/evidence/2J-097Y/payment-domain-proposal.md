# Propuesta de dominio — periodos naturales y vencimiento de pago

## Estado actual

`plan_versions` supports `kind = recurring | session_pack`. `recurring` supports `renewal_cadence = weekly | monthly | custom_period`; a custom period stores only `period_days`. An assignment currently stores `starts_on`, nullable `ends_on`, a charge reference, a status, an immutable snapshot and append-only effective events. The charge stores `due_on` and its derived payment state from immutable economic transactions. Entitlement eligibility uses assignment dates/status and rights. There is no separate service-month identity, grace deadline, non-payment suspension state or expiry worker.

## Gap

The product rules distinguish the month/term being purchased, when access starts/ends, when payment becomes due, and whether the customer has paid. Today's `starts_on`/`ends_on` plus `due_on` cannot safely express both an assignment made in October for November service and a current-October assignment made after October 10 with a five-day grace period. A client-side clock check would not block API booking routes, and reusing `ends_on`, `due_on`, `paused`, `cancelled`, or an arbitrary `period_days` value would give those fields/state a new unsupported meaning. Current assignment events cannot distinguish a reversible non-payment block from a deliberate pause/cancel.

## Candidate fields/state for a dedicated TASK

Subject to domain review, consider immutable term snapshots/columns such as `service_period_kind`, `service_period_start`, `service_period_end`, `assigned_at`, `payment_deadline`, plus a derived or explicit access state such as `payment_blocked_at`/effective event. Define whether late payment permits authorized reactivation in the same term, who may reactivate, and what happens after expiry. Do not duplicate ledger payment truth in assignment rows.

## Constraints and indexes to evaluate

- Valid date range and timezone/date rules.
- At most one applicable assignment per client/service/term where product rules require it, while retaining renewals/plan changes/history.
- Indexes for pending charges and due assignments by `payment_deadline` and status, designed around the chosen worker/query.
- Atomic idempotent transition and audit; never delete person, client, assignment, charge or ledger rows.

## Backfill and compatibility

Existing assignments lack an explicit service term. Backfill only where the frozen version and assignment dates unambiguously encode the term; leave ambiguous legacy rows unchanged and define a conservative compatibility policy. Preserve snapshots and all economic/entitlement ledger history. New API fields must be optional for historical reads and any new writer versioned or backward compatible.

## Enforcement and rollback

First choose an existing durable scheduler/outbox/job mechanism or approve one. The worker must process overdue assignments idempotently, record audit/event state, and the shared eligibility resolver used by Member and staff booking must fail closed for new reservations after the server deadline. Existing bookings/history remain. Rollback must disable the worker and restore access only by explicit audited transition; never erase charges or ledger movements.

## Approved rules and remaining implementation choices

The owner-approved rules to preserve are: natural-month service dates belong to calendar months; future-month assignments can remain pending through the 10th of that service month; current-month assignments made by the 10th are due on the 10th; current-month assignments made after the 10th are due five natural days after assignment; overdue unpaid access must stop without deleting the assignment/history; and a late payment within the same service period should permit authorized manual reactivation when implemented safely. Bonos use their activation-based validity and do not use the day-10 grace rule. Quarterly, half-year and annual offers are one period/one charge by default, not installments.

Those rules are not represented by the current schema, so this PR does not implement them. A follow-up implementation TASK must review/accept the concrete field/event model, conservative historical backfill, scheduler ownership and rollback plan above before adding a migration or worker. It must preserve the approved rules and must not reinterpret current assignment dates or charge due dates as service-term/grace fields.
