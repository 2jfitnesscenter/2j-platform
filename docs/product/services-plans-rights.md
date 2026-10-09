# Services, plans and rights domain contract

This contract began with 2J-010's service catalog and commercial definitions. 2J-073 extends it with catalog pricing, immutable sale snapshots, entitlements, a session-balance ledger and module-access grants. It still does not implement payment gateways, automatic renewals, reservation consumption, training routines or Búnker behavior.

## Domain and versioning

- An **area** is a configurable entity. A service references an `area_id`; it never stores an area name as free text. The initial active areas are La Sala, El Búnker, El Estudio and Entrenamiento personal.
- A **service** describes an activity the center offers. Services and areas are archived, not deleted.
- A **plan** is a named product which can include several services. Names are unique across all non-archived plans because no single service owns a multi-service plan.
- Each plan points at an immutable `plan_versions` row. `plan_services` and `plan_rights` both reference that exact version. An active version cannot be edited; a future version is append-only and the current-version pointer may only move forward. A later client purchase or entitlement can therefore retain its version reference.
- A session pack has no renewal cadence and must include at least one finite `sessions_quota` right. It cannot include a period quota. A recurring plan must explicitly state weekly, monthly or custom-period cadence. This cadence is definition data only: it does not initiate billing or renewal jobs.
- Plans begin as drafts. Activation locks the current definition after validating that all included services remain active. Archiving preserves the plan and all its versions.

## Rights and quota semantics

- For quota rights, a null service target is interpreted by `quota_scope`: `shared` is one balance across the included services, while `per_service` requires an explicit service linked to that version. For `service_access`, a null target remains unspecified and must not be inferred as access to every service; the business meaning is still unresolved. The effective entitlement read model returns it neutrally and does not make a booking decision.
- `quota_scope = shared` is always a single global balance across the version's included services and therefore requires a null service target. `per_service` requires one explicit service target and records a separate quantity for that service.
- A global and a service-targeted right of the same type and period cannot coexist in one plan version. Distinct service-targeted rights may coexist for different services, and period quotas may coexist for different periods (for example, weekly and monthly limits). PostgreSQL and API validation both enforce this rule.
- Within a given target, a right type may have one entry per period. PostgreSQL's unique indexes include the period so distinct period quotas remain representable.
- `week` and `month` with `period_mode = calendar` use the ISO week (Monday to Monday) or calendar month boundary in `Atlantic/Canary`. `rolling` means an elapsed seven-day or thirty-day window from the entitlement start instant. The mode and time zone are stored with the right; future center-level time-zone configuration can replace the present `Atlantic/Canary` default.
- `plan_period` follows the recurring plan's version period and has no separate calendar/rolling mode. Period quotas are recurring-plan rights only.
- `valid_days` must include an explicit `valid_days_start_rule`: `purchase` starts at purchase time; `first_use` starts when the right is first consumed. No implicit expiry is created.

## Persistence and errors

The initial SQL baseline is the canonical migration. Drizzle describes the same tables, columns, checks, indexes and foreign keys; the integration suite compares that metadata with PostgreSQL. SQL adds deferred version/entitlement invariants and append-only triggers that Drizzle does not express.

Each migration is SHA-256 checksummed and applied under an advisory transaction lock in its own transaction. Reapplying a migration is a no-op only when its checksum matches. Database uniqueness/FK errors map to `409`, check/data constraints to `422`, and actual connectivity/unavailability to `503`; unexpected failures remain `500`.

Plan creation requires an `Idempotency-Key`, locks its service rows while validating status, stores a request hash, inserts service links and rights atomically, and rolls all rows back if any right violates a constraint. Listing uses stable area/service or plan-name ordering.

## 2J-073: purchased entitlements

- A plan version may include an optional catalog price in integer EUR cents. A sale stores the contemporaneous list price, sold price, any adjustment and reason, actor, currency, dates, service/right/module data and operating terms in the assignment's immutable JSON snapshot. A later catalog version never rewrites that snapshot.
- `recurring` and `session_pack` remain separate. Recurring plans hold a manual term and periodic rights; session packs receive one initial grant and do not regenerate balance. Payments remain economic charges/transactions owned by the existing Economics module.
- Assignment lifecycle is an append-only dated event stream: activated, paused, resumed, cancelled, renewed and changed. The read model derives scheduled, active, paused, expired, cancelled or exhausted state in `Atlantic/Canary`. Pausing blocks entitlement use without erasing balance or automatically extending dates. Renewal/change creates another assignment and charge; the earlier assignment is retained.
- `client_entitlement_ledger` is append-only. Grants, future consumption/restoration/expiry event types and manual adjustments are separate rows; this TASK exposes only grant and adjustment. PostgreSQL serializes writes on the assignment and rejects a resulting negative balance. 2J-073 itself does not consume a session.
- `plan_module_accesses` stores `reservations`, `training`, `nutrition` or `health`, with `limited`/`full` and optional namespaced capabilities. The resolver combines only active, in-date, unpaused and non-exhausted assignments; full wins over limited and capabilities are unioned. This is a central entitlement contract, not an implementation of the child modules or a local customer profile.
- Admin remains the only role granted the new catalog and entitlement write/read capabilities under the currently approved matrix. No role grants were broadened. A broader reception/trainer commercial access matrix is unresolved and must be approved before granting it.
- A null `service_access` target stays unspecified; no global booking grant is inferred. 2J-074 must resolve booking eligibility together with debt policy, schedule/capacity and explicit rights, then record consumption transactionally.
