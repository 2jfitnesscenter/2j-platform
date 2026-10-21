# 2J-CAPABILITIES-V1 — Platform Training capabilities

Status: **Platform-side V1 contract, explicit plan right, resolver, inbound service authentication, durable replay protection, and read-only endpoint are implemented locally on `codex/platform-capabilities-contract`. No consumer is wired and no credentials, deployment, or production activation are included.**

## Source of truth

Platform's canonical person is `platform_persons.id` (`personId`). A Training relationship is held in `training_account_links`; only an active row supplies the opaque `trainingUserId`. Platform owns plan assignments, effective period access, payment-derived state, and the capability result. The resolver consumes those Platform facts and never matches by email or phone.

2J-098E represents purchased plans in `client_plan_assignments`, recurring windows in `assignment_entitlement_periods`, recurrence and payment validation in append-only event histories, and usage in period-scoped ledger rows. `derivePeriodAccess` and `nextPeriodAccessTransition` in `packages/domain/src/period-entitlements.ts` remain the period authority. This task adds only the next known transition output and does not change 098E business behavior.

## Versioned access right and response

The machine-readable response schema is [`contracts/2J-capabilities-v1.schema.json`](../../../contracts/2J-capabilities-v1.schema.json), with representative cases in [`contracts/fixtures/2J-capabilities-v1.json`](../../../contracts/fixtures/2J-capabilities-v1.json). The explicit, versioned plan right is `right_type='training_access'` with `training_access_level='full'|'autonomous'`. A plan version may contain at most one such right. It is part of the immutable plan version and is never inferred from service, area, or plan names.

- `full`: active/provisional explicit full access enables autonomous training, routine creation, guided training, Premium, AI coach, and professional follow-up.
- `autonomous`: active/provisional explicit autonomous access enables autonomous training, routine creation, guided training, and Premium; AI and professional follow-up stay disabled.
- `blocked`: no effective Training access right, blocked/ended access, or a missing/revoked Training link disables every operational capability.

`accessState` stays separate from `capabilityLevel`. A provisional grant retains its explicit level. Link revocation blocks operational capability without relabeling the entitlement as unpaid. `reasonCode` is diagnostic; consumers authorize from `capabilityLevel` and the booleans only. Unknown contract IDs/versions must be rejected.

The resolver receives Platform's effective `active`, `provisional`, `blocked_unpaid`, or `ended` state. It does not calculate payment grace, proration, balances, rollover, or entitlement validity.

## Endpoint and service authentication

Platform exposes the read-only endpoint:

`GET /api/internal/platform/v1/persons/{personId}/training-capabilities`

It resolves the Platform person, active client facet, current immutable plan rights, effective access, and Training link on the server. It accepts no client ID or caller-supplied membership/capability state and returns `Cache-Control: no-store`. A Member cookie or session is not accepted as service authentication.

Inbound authentication uses the existing `2J-SERVICE-AUTH-V1` format: HMAC-SHA256 over canonical UTF-8 fields, base64url signature, and `x-2j-key-id`, `x-2j-timestamp`, `x-2j-request-id`, and `x-2j-signature` headers. The exact method/path and lowercase SHA-256 digest of the empty GET body are signed. Signature comparison is constant-time. The accepted timestamp window is ±30 seconds.

Each authenticated request ID is consumed atomically in PostgreSQL and retained for 120 seconds, longer than the accepted clock-skew window. Expired rows are deleted during a subsequent authenticated request. Concurrent replays have one winner. The key ID maps to a named `home` or `bunker` caller. Server-only configuration is `PLATFORM_INTERNAL_SERVICE_KEYS`, a JSON object whose entries contain `caller` and a canonical base64url `secret` of at least 32 bytes. Removing a key ID revokes it; old and new key IDs may coexist during rotation. No real key or secret is stored in this repository.

## Freshness and consumer outage behavior

The maximum capability TTL is **60 seconds**. Platform sets `expiresAt` to the earlier of `generatedAt + 60 seconds` and any next known assignment, entitlement-period, or access-state transition. Known boundaries use `Atlantic/Canary`; consumers never compute a period boundary themselves.

A consumer may use a previously authenticated response only through `expiresAt`. After it expires, operational capabilities fail closed. An outage can never promote `autonomous` to `full` or `blocked` to an operational level. Preserving local login/history is future consumer work and is not implemented here.

Home and Búnker must not calculate membership validity, payment grace, period boundaries, late-payment proration, balances, rollover, or capability elevation. Platform is the only authority for those decisions.

## Follow-up before consumer wiring

1. Independently review the Platform endpoint, schema, key configuration, and replay behavior.
2. Provision service keys through the approved secret manager before any non-test consumer connection.
3. Implement Home and Búnker adapters in separate approved tasks, validating the shared contract and fixtures first.

No SSO, user-session handoff, Training changes, or consumer calls are part of this implementation.
