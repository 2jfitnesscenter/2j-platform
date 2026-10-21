# 2J-CAPABILITIES-V1 — Platform training capabilities

Status: **contract proposal implemented as a versioned schema and pure mapping helper; no endpoint or consumer integration is enabled.** This work does not change authentication, 2J-098E, Home, Búnker, Training, or 2jfitnessapp.

## Current source of truth

Platform's canonical person is `platform_persons.id` (`personId`). A Training relationship is held in `training_account_links`; only an active row links the person to the opaque `trainingUserId`. Revocation is a credential/link lifecycle event, separate from entitlement capability revocation.

2J-098E represents a purchased plan in `client_plan_assignments`, its recurring windows in `assignment_entitlement_periods`, recurrence and payment validation as append-only event histories, and usage in period-scoped `client_entitlement_ledger` rows. `derivePeriodAccess` in `packages/domain/src/period-entitlements.ts` is the period authority; `getEffectiveEntitlements` and `GET /api/clients/:clientId/entitlements/effective` in `apps/api/src/entitlements.ts` are the current Platform effective-access service/API. Booking eligibility consumes the same period rules in Platform. Consumers must not recalculate them.

2J-089 currently exposes authenticated Member `GET /api/me/training-summary`. Platform resolves the active person and link server-side, then makes an outbound signed request to Training's fixed `POST /api/platform/v1/training-summary`. The response is a read-only summary and does not carry entitlement capabilities. No inbound Platform service-auth endpoint for Home or Búnker exists.

## V1 wire contract

The machine-readable schema is [`contracts/2J-capabilities-v1.schema.json`](../../../contracts/2J-capabilities-v1.schema.json), with representative resolver fixtures in [`contracts/fixtures/2J-capabilities-v1.json`](../../../contracts/fixtures/2J-capabilities-v1.json). `packages/domain/src/training-capabilities.ts` maps already-resolved Platform membership states to exactly three levels: `full`, `autonomous`, and `blocked`.

- `full`: effective Force membership. Enables autonomous training, routine creation, guided training, Premium, AI coach, and professional follow-up.
- `autonomous`: another effective membership. Enables autonomous training, routine creation, guided training, and Premium; AI and professional follow-up remain false.
- `blocked`: no effective membership, unpaid/ended period, missing Training link, or revoked Training link. All operational capability booleans are false; identity, local account, routines, progress, and history are preserved. Login/history should remain possible where the consumer supports it.

`accessState` remains separate from `capabilityLevel`: active and provisional memberships retain their mapped level. Link revocation blocks the operational capabilities while preserving the underlying entitlement `accessState`; it does not mislabel an active entitlement as unpaid. The helper only accepts Platform's `active`, `provisional`, `blocked_unpaid`, or `ended` result; it does not know the day-10/day-11 cutoff, payment state, proration, or balances. A late validated payment maps back to the corresponding level when Platform reports active access.

The V1 `reasonCode` is diagnostic, not authorization logic. Contract ID/version are independent of plan version. Compatible V1 changes may add optional fields only through a compatible schema update; changing meanings or required fields needs `2J-CAPABILITIES-V2`, and unknown contract IDs/versions must be rejected.

## Unresolved source classification

The current `services` catalog has a mutable display `name` and area, but no stable product/service code or capability class. Consequently, Platform cannot safely distinguish “Fuerza” from any other membership by reading the current catalog without guessing from editable text. The pure helper receives a `kind: force | other` only after a trusted Platform-side classifier has resolved it. Before an endpoint is implemented, Platform needs a stable catalog classification for Force (or an explicit centrally managed mapping). No classification field or data migration is added in this task.

## Endpoint and authentication boundary

The current `2J-SERVICE-AUTH-V1` is implemented as an outbound Platform signer: HMAC-SHA256, base64url signature, headers `x-2j-key-id`, `x-2j-timestamp`, `x-2j-request-id`, `x-2j-signature`, and canonical UTF-8 fields including exact method/path and lowercase SHA-256 body digest. The receiver protocol for proof exchange is in Training. The inspected Platform code has no inbound signature verifier, caller identity/allowlist, clock-skew policy, or atomic replay store for a capability request. The existing `requestId` used by link workflows is not, by itself, proof of replay protection for inbound service calls.

Proposed future route, subject to the inbound service-auth contract: `GET /api/internal/platform/v1/persons/{personId}/training-capabilities`. It must resolve person, active link, client facet, effective assignment/period/payment state, and Force classification entirely server-side; authorize a named service caller; be read-only; and return `Cache-Control: no-store`. It must not accept a clientId, capability level, payment state, or membership classification from the caller.

## Freshness and outage behavior

There is no existing downstream capability-cache TTL policy. V1 proposes a **60-second maximum response age** as a technical starting point: it limits stale grants after unpaid blocking/revocation without requiring every consumer action to round-trip synchronously. This is a proposal, not an approved offline entitlement window. On Platform unavailability, a consumer may use only a previously verified response still inside that 60-second TTL; otherwise operational capabilities fail closed. A Platform outage must never promote access. Preserve local login/history independently where possible. Do not interpret `expiresAt` as permission to extend a response after it expires.

For the eventual inbound verifier, the minimum proposal is exact method/path/body binding, authenticated key ID, constant-time HMAC comparison, strict UTC timestamp parsing with a bounded clock-skew window, and atomic request-ID replay rejection retained longer than that window. Key rotation/revocation and named caller identity must be server configuration; no credentials belong in this contract or repository. The current 2J-089 outgoing adapter already uses exact-origin allowlisting, HTTPS outside loopback tests, redirect denial, a bounded timeout, and strict response validation; it does not provide the missing inbound controls for Platform.

## Revocation semantics

Entitlement/capability revocation is derived from Platform assignment and effective period state, including payment reversal where the existing effective resolver reports blocked. Recurrence alone does not grant access. A revoked/non-active person link or Training link yields `blocked` and must not expose `trainingUserId`. Credential revocation (Training link/session) and membership capability revocation are distinct events; either may remove operational access, but consumers must preserve user history and must not infer the other event from it.

## Follow-up required before wiring consumers

1. Add stable Force classification to Platform catalog or approve a centrally maintained mapping.
2. Define and implement the inbound service-to-service verifier/replay store and named Home/Búnker caller credentials.
3. Add a read-only Platform endpoint that reuses the existing effective entitlement service and active link lifecycle.
4. Validate this schema/fixtures cross-repository before changing Home or Búnker. No SSO or user-session handoff is part of that work.
