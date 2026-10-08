# Services, plans and rights domain contract

This first vertical covers the service catalog and commercial definitions only. It does not implement prices, payments, automatic renewals, clients, reservations, training routines or Búnker behavior.

## Domain and versioning

- An **area** is a configurable entity. A service references an `area_id`; it never stores an area name as free text. The initial active areas are La Sala, El Búnker, El Estudio and Entrenamiento personal.
- A **service** describes an activity the center offers. Services and areas are archived, not deleted.
- A **plan** is a named product which can include several services. Names are unique across all non-archived plans because no single service owns a multi-service plan.
- Each plan points at an immutable `plan_versions` row. `plan_services` and `plan_rights` both reference that exact version. An active version cannot be edited; a future version is append-only and the current-version pointer may only move forward. A later client purchase or entitlement can therefore retain its version reference.
- A session pack has no renewal cadence and must include at least one finite `sessions_quota` right. It cannot include a period quota. A recurring plan must explicitly state weekly, monthly or custom-period cadence. This cadence is definition data only: it does not initiate billing or renewal jobs.
- Plans begin as drafts. Activation locks the current definition after validating that all included services remain active. Archiving preserves the plan and all its versions.

## Rights and quota semantics

- `service_id = NULL` means the right is intentionally global across the services in that plan version. A non-null service ID must be linked to that same version.
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
