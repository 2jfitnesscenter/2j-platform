# Contracts — identity, capabilities, service authentication, link lifecycle

## 1. `2J-SERVICE-AUTH-V1` (server-to-server, both directions)

Headers: `x-2j-key-id`, `x-2j-timestamp` (ISO-8601 UTC, ms), `x-2j-request-id` (UUID), `x-2j-signature`.
Signature = `base64url(HMAC-SHA256(secret, canonical))`, with `canonical` = seven lines joined by `\n`, no trailing newline:
`2J-SERVICE-AUTH-V1` · keyId · timestamp · requestId · METHOD · exact request target (path **and** query) · lowercase hex SHA-256 of the exact body bytes.
Rules: freshness window ±30 s on Platform and ±60 s on Búnker (`SERVICE_AUTH_FRESHNESS_MS`); each request id is single use (replay → 409); keys are base64url ≥ 32 bytes; verification is on the raw bytes (`Buffer`), then strict schema; fixed paths only; clients refuse redirects and use time-bounded requests; plain `http` only for loopback in development/test.
Keys: Búnker→Platform in `PLATFORM_INTERNAL_SERVICE_KEYS` (caller `bunker` is the only one allowed to redeem SSO); Platform→Búnker in `PLATFORM_SERVICE_AUTH_KEYS` (Búnker) and `TRAINING_SERVICE_KEY_ID/SECRET` (Platform).

## 2. `2J-CAPABILITIES-V2` (Platform is the single authority)

`GET /api/internal/platform/v2/persons/:personId/training-capabilities` (signed) and embedded in the SSO redeem answer.
Fields (strict): `contract`, `version: 2`, `personId`, `trainingSubject {linkStatus: active|not_linked|revoked, trainingUserId?}`, `capabilityLevel: full|autonomous|baseline|blocked`, `accessState: active|provisional|blocked_unpaid|ended|baseline|suspended`, `capabilities{…}`, `reasonCode: ACTIVE_FULL|ACTIVE_AUTONOMOUS|PROVISIONAL_FULL|PROVISIONAL_AUTONOMOUS|TRAINING_LINK_REVOKED|TRAINING_LINK_MISSING|FREE_BASELINE|ADMIN_SUSPENDED`, `suspensionStatus: none|suspended|lifted`, `effectiveFrom`, `expiresAt`, `generatedAt`, `source{platform:true}`.
Capability flags: `autonomousTraining`, `routineCreation`, `personalRoutineCreation`, `personalRoutineManagement`, `workoutRecording`, `workoutHistory`, `guidedTraining`, `premiumPrograms`, `aiCoach`, `professionalFollowUp`.
Free baseline = `autonomousTraining`, `personalRoutineCreation`, `personalRoutineManagement`, `workoutRecording`, `workoutHistory`. `routineCreation` (commercial) is informational.
Consumer rules (Búnker `platform-sso/capabilities.js`): payload must match the person, the linked Training user and the clock (skew ≤ 60 s, `expiresAt − generatedAt ≤ 60 s`); cached only until `expiresAt`; if Platform is unreachable → **never grant paid rights unverified**: a known suspension/revocation keeps blocking (persisted), otherwise only the free baseline; `ADMIN_SUSPENDED`, "link missing" and "link revoked" are distinct from "no fee" (baseline).

## 3. Identity model

- **Platform** (`platform_persons`) is the person. Auth subjects (`platform_person_auth_subjects`): provider `platform-pilot` (test-only access codes) or `platform-passkey` (dev/test only). One subject can belong to one person forever.
- **Canonical link** (`training_account_links`): `status` pending → active → revocation_pending → revoked, or conflict; `method` explicit_admin (legacy, starts active) · verified_training_proof · provisioned; `link_version`; Training ACK ids. One non-terminal link per person **and** per Training user (unique partial indexes + advisory locks).
- **Búnker** user: `personId` and `platformLink {personId, state pending|active|revoked, origin proof|provisioned, linkId, linkVersion, ackId, receiptId?, …}`; `platformEnforcement` legacy|shadow|enforced (default legacy; transitions legacy↔shadow↔enforced only, per user, by an administrator with a passkey session; enforced needs an active link and a fresh Platform verification).
- A link is real only when **both** sides hold it: Platform activates after Training's ACK; Training agrees only with its own evidence.

## 4. SSO (Platform → Búnker)

Issue: `POST /api/me/training/sso` (member session, exact member origin, not cross-site) → `{redirectUrl: <fixed Training /sso>#code=<43-char base64url>}`; hash-only storage, 60 s, single use, one live code per person, ≤ 10/min, person row locked.
Redeem: Búnker → `POST /api/internal/platform/v2/sso/redeem` (signed; caller must be `bunker`) → Platform re-evaluates binding + capabilities in the same transaction and consumes the code. Búnker then requires: capability payload matches person/user, `capabilityLevel ≠ blocked`, an **active acknowledged** link for exactly that person, no conflicting link, not an `ADMIN_UIDS` account; it opens an `authLevel=sso` session (strict, member routes only, never passkey-only/staff/destructive routes).

## 5. Link lifecycle (Platform ⇄ Búnker), all signed, all OFF by default

| Call | Direction | Semantics |
|---|---|---|
| `POST /api/platform/v1/training-link-transactions` | member → Platform | challenge (5 min), bound to the member's auth subject |
| `POST /api/platform/v1/link-proofs` | owner (Búnker passkey session) → Búnker | one-time code for that exact transaction context |
| `POST /api/me/training/link {transactionId, challenge, code}` | member → Platform | exchange code at Búnker (`link-proofs/exchange`), reconcile receipt, create **pending** link, then activate |
| `POST /api/platform/v1/link/activate` | Platform → Búnker | `{v,linkId,linkVersion,personId,trainingUserId,origin: proof|provisioned,receiptId?}`; `proof` needs Búnker's own receipt for exactly that person+user (and, after a revocation, a newer one); `provisioned` only for a still-pending provisioned account of that person; conflicts → 409 |
| `POST /api/platform/v1/link/revoke` | Platform → Búnker | closes the link, frees `personId`, revokes sso sessions, **never relaxes enforcement** |
| `DELETE /api/me/training/link`, admin `…/training-link/{revoke,resume}` | member/admin → Platform | `active → revocation_pending` (access stops at once) → `revoked` on Training's ACK, "unknown on Training", or an audited administrative waiver |
| `POST /api/platform/v1/persons/:id/training-provision` (+ `Idempotency-Key`) | admin → Platform → `POST /api/platform/v1/provision` Búnker | creates one minimal enforced profile (display name + personId, no credentials); idempotent per key; one profile per person; **dev/test only** |

## 6. Platform passkeys (dev/test only, off by default)

Admin-issued enrollment (`identity.people.manage`, 15 min, single use, hash-only) → `register/options`+`register/verify` → discoverable `login/options`+`login/verify` → `platform_member_sessions` (8 h, HttpOnly, SameSite=Lax). RP ID must equal the exact member-origin host (`PLATFORM_PASSKEY_RP_ID`); user verification required; counter regression rejected; revocation ends sessions. Búnker's own passkeys, `RP_ID` and `ORIGIN` are unchanged.
