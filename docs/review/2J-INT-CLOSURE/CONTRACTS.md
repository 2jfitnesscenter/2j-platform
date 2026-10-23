# Contracts — identity, capabilities, service authentication, link lifecycle, enforcement semantics

Updated after the architect's review (H1–H16). Wherever a statement names a test, the test exists in the branch tips listed in `README.md`.

## 1. `2J-SERVICE-AUTH-V1` (server-to-server, both directions)

Headers: `x-2j-key-id`, `x-2j-timestamp` (ISO-8601 UTC, ms), `x-2j-request-id` (UUID), `x-2j-signature`.
Signature = `base64url(HMAC-SHA256(secret, canonical))`, with `canonical` = seven lines joined by `\n`, no trailing newline:
`2J-SERVICE-AUTH-V1` · keyId · timestamp · requestId · METHOD · exact request target (path **and** query) · lowercase hex SHA-256 of the exact body bytes.
Rules: freshness window ±30 s on Platform and ±60 s on Búnker (`SERVICE_AUTH_FRESHNESS_MS`) — a documented asymmetry, NTP is required on both hosts; each request id is single use (replay → 409), consumed only after signature and schema validation; keys are base64url ≥ 32 bytes; verification is on the raw bytes, then a strict schema; fixed paths only; clients refuse redirects and use time-bounded requests; plain `http` only for loopback in development/test.
Keys: Búnker→Platform in `PLATFORM_INTERNAL_SERVICE_KEYS` (caller `bunker` is the only one allowed to redeem SSO); Platform→Búnker in `PLATFORM_SERVICE_AUTH_KEYS` (Búnker) and `TRAINING_SERVICE_KEY_ID/SECRET` (Platform). Separate keys per direction are required in any shared environment.

## 2. `2J-CAPABILITIES-V2` (Platform is the single authority)

`GET /api/internal/platform/v2/persons/:personId/training-capabilities` (signed) and embedded in the SSO redeem answer.
Fields (strict): `contract`, `version: 2`, `personId`, `trainingSubject {linkStatus: active|not_linked|revoked, trainingUserId?}`, `capabilityLevel: full|autonomous|baseline|blocked`, `accessState: active|provisional|blocked_unpaid|ended|baseline|suspended`, `capabilities{…}`, `reasonCode: ACTIVE_FULL|ACTIVE_AUTONOMOUS|PROVISIONAL_FULL|PROVISIONAL_AUTONOMOUS|TRAINING_LINK_REVOKED|TRAINING_LINK_MISSING|FREE_BASELINE|ADMIN_SUSPENDED`, `suspensionStatus: none|suspended|lifted`, `effectiveFrom`, `expiresAt`, `generatedAt`, `source{platform:true}`.
Capability flags: `autonomousTraining`, `routineCreation`, `personalRoutineCreation`, `personalRoutineManagement`, `workoutRecording`, `workoutHistory`, `guidedTraining`, `premiumPrograms`, `aiCoach`, `professionalFollowUp`.
Free baseline = `autonomousTraining`, `personalRoutineCreation`, `personalRoutineManagement`, `workoutRecording`, `workoutHistory`. `routineCreation` (commercial) is **informational** — `docs/adr/ADR-2J-INT-001-routinecreation-informational.md` (H14).

### Consumer failure model (Búnker `platform-sso/capabilities.js`) — H4, H5, H6

| Situation | Class | Result |
|---|---|---|
| network error, timeout, 5xx, 408, 429, or an answer whose clock is unusable (generated far in the future / already expired) | **unavailable** | safe degradation: a known suspension/revocation keeps blocking (persisted across restarts), otherwise the free baseline; paid rights are never granted unverified. A circuit breaker (backoff 2 s, 4 s, 8 s, then 12 s; so recovery after an outage is noticed within at most 12 s) answers immediately instead of making every request wait for the 3 s timeout; one probe passes after each backoff. |
| 401/403/404/other 4xx (Platform does not accept our call or does not know the person) | **rejected** | **fail closed**: view `blocked` (`PLATFORM_REJECTED`), cached 5 s, **not** persisted as a restriction, alert. |
| invalid JSON or contract, an answer about another person or another Training user, an impossible validity window | **inconsistent** | **fail closed**: view `blocked` (`IDENTITY_INCONSISTENT`), cached 5 s, not persisted, alert. |
| Platform not configured on an enforced user | misconfiguration | baseline only (never paid rights), loud alert. |

Cache lifetime = `min(expiresAt, receipt + 60 s)` measured with **our** clock (a skewed clock inside the answer cannot stretch it). Alerts are rate-limited to one per kind per 5 minutes and carry no secrets. Shadow and legacy users are never blocked by any of this.

## 3. Identity model

- **Platform** (`platform_persons`) is the person. Auth subjects (`platform_person_auth_subjects`): provider `platform-pilot` (test-only access codes) or `platform-passkey` (dev/test only). One subject can belong to one person forever.
- **Canonical link** (`training_account_links`): `status` pending → active → revocation_pending → revoked, or conflict; `method` explicit_admin · verified_training_proof · provisioned; `link_version`; Training ACK ids. One non-terminal link per person **and** per Training user.
- **Búnker** user: `personId` and `platformLink {personId, state pending|active|revoked, origin proof|provisioned, linkId, linkVersion, ackId, receiptId?, …}`; `platformEnforcement` legacy|shadow|enforced (default legacy; transitions legacy↔shadow↔enforced only, per user, by an administrator with a passkey session; enforced needs an active link and a fresh Platform verification).
- A link is real only when **both** sides hold it: Platform activates after Training's ACK; Training agrees only with its own evidence.

### `explicit_admin` links (H13) — the exception to "both sides hold it"

`explicit_admin` is the pre-existing, administrator-created link: it is **born `active` in Platform with no Training ACK**, and Búnker has no record of it (`user.personId` empty, no `platformLink`). Consequences, all fail-closed: Platform's capabilities endpoint reports the link; Búnker's SSO redemption answers `link_not_confirmed` (no session); enforcement cannot be enabled for that user (`link_required`); the user remains `legacy` and works exactly as before with the passkey. To bring such an account into the bilateral model it is re-linked with the owner's proof (the normal flow); revoking an `explicit_admin` link is a direct `active → revoked` with no Training call.
Do real ones exist? In this code base the only way to create one is `POST /api/platform/v1/persons/:id/training-link`, which is **disabled (423) unless `trainingLinkingEnabled` is passed programmatically — no environment variable enables it** (`apps/api/src/server.ts`, the start-up block sets no such option) and the Platform health endpoint reports `mode: local-only`. So none should exist outside test fixtures and local development databases — but that is a statement about the code, not an inspection of any real database. Anyone who must be sure runs, against the Platform database: `SELECT count(*) FROM training_account_links WHERE method='explicit_admin';` — expected 0 outside development.

## 4. Enforcement semantics (H1, H2) — the mode belongs to the USER, not to the session type

| Mode | passkey session | Platform SSO session |
|---|---|---|
| **legacy** (default) | exactly what Búnker gives today; no Platform call | **the same** (decision H1); only the route limits of sso apply |
| **shadow** | never blocked; divergences are compared in the background (never waits for Platform) | same |
| **enforced** | capabilities apply; blocked account closed on interactive routes | same (one rule for both session types) |

Route limits of an `sso` session do not depend on the mode: it only reaches routes marked `ssoAllowed` (never passkey-only, staff, deletion/export-of-account, passkey management).

Route kinds under **enforced** (generated, with the full list, in `ROUTE-MATRIX.md`):
- `gated`: needs the listed capabilities.
- `member` (social, chat, friends, media upload, push, notifications, news): closed for a **blocked** account (administrative suspension, revoked/missing link, rejected/inconsistent identity). Always open: reads of news/media/notifications, and *withdrawal* actions (delete/leave/block/unsubscribe/mark read/privacy preferences).
- `identity`, `public`, `staff`: never closed by the capability contract (recovery, export, deletion, logout, administration keep their own guards).
- `kiosk`: PIN check-in and every token use are re-checked (`memberGate` / `readKioskMember`): a blocked account loses the kiosk and its presence in the room; an in-progress workout is kept (the server inactivity sweep closes it into history).
- A revoked link: Platform tells Búnker (`link/revoke`), Búnker closes the sso sessions, frees `personId`, never relaxes the mode and never deletes the historical account or its data.

If the integration code itself fails (an exception in the gate), legacy and anonymous callers proceed; shadow/enforced users get 503 (H10).

## 5. SSO (Platform → Búnker)

Issue: `POST /api/me/training/sso` (member session, exact member origin, not cross-site) → `{redirectUrl: <fixed Training /sso>#code=<43-char base64url>}`; hash-only storage, 60 s, single use, one live code per person, ≤ 10/min, person row locked.
Redeem: Búnker → `POST /api/internal/platform/v2/sso/redeem` (signed; caller must be `bunker`) → Platform re-evaluates binding + capabilities in the same transaction and consumes the code. The browser-facing route on Búnker is `POST /api/platform/v1/sso/redeem` (different path on purpose: it is the page's own endpoint). Búnker then requires an **active acknowledged** link for exactly that person, no conflicting link, not an `ADMIN_UIDS` account.
**Session handling (H3).** No session → a new sso session. Same account with a passkey session → the passkey session is kept. Same account with an older sso session → refreshed. A valid session of **another account → never replaced silently**: answer `409 session_switch_confirmation_required` with a single-use ticket (60 s) bound to the browser session that is signed in, plus both names; the landing page shows "this browser is signed in as A; continue as B?"; only `POST /api/platform/v1/sso/confirm {ticket}` from that same session, after re-checking the account and link, switches. Residual: a visitor with *no* session can still be signed in by a link carrying someone else's code (login CSRF without a victim session); binding the code to the initiating browser needs a Home↔Búnker handshake that was not built (see README residual risks).

## 6. Link lifecycle (Platform ⇄ Búnker), all signed, all OFF by default

| Call | Direction | Semantics |
|---|---|---|
| `POST /api/platform/v1/training-link-transactions` | member → Platform | challenge (5 min), bound to the member's auth subject |
| `POST /api/platform/v1/link-proofs` | owner (Búnker passkey session) → Búnker | one-time code for that exact transaction context |
| `POST /api/me/training/link {transactionId, challenge, code}` | member → Platform | exchange code at Búnker, reconcile receipt, create **pending** link, then activate |
| `POST /api/platform/v1/link/activate` | Platform → Búnker | `{v,linkId,linkVersion,personId,trainingUserId,origin: proof|provisioned,receiptId?}`; `proof` needs Búnker's own receipt for exactly that person+user (and, after a revocation, a newer one). Refusals: `link_conflict`, `not_provisioned`, … are terminal (`conflict`); **`proof_required` leaves the link `pending` and answers 202 `proof_not_yet_visible`** so a lag between receipt and reconciliation can be retried (H12). |
| `POST /api/platform/v1/link/revoke` | Platform → Búnker | closes the link, frees `personId`, revokes sso sessions, **never relaxes enforcement** |
| `DELETE /api/me/training/link`, admin `…/training-link/{revoke,resume}` | member/admin → Platform | `active → revocation_pending` (access stops at once) → `revoked` on Training's ACK, "unknown on Training", or an audited administrative waiver |
| `POST /api/platform/v1/persons/:id/training-provision` (+ `Idempotency-Key`) | admin → Platform → `POST /api/platform/v1/provision` Búnker | one minimal enforced profile; idempotent per key; one profile per person; **dev/test only** |

## 7. Platform passkeys (dev/test only, off by default)

Admin-issued enrollment (`identity.people.manage`, 15 min, single use, hash-only) → `register/options`+`register/verify` → discoverable `login/options`+`login/verify` → `platform_member_sessions` (8 h, HttpOnly, SameSite=Lax). RP ID must equal the **exact** member-origin host (`PLATFORM_PASSKEY_RP_ID`; the parent domain is refused); user verification required; counter regression rejected; revocation ends sessions. Búnker's own passkeys, `RP_ID` and `ORIGIN` are unchanged.

## 8. Feature map: "Entrena con 2J" (F)

Behaviour read from the code (`api/lib/guided-routes.js`, `guided-store.js`, `AI_HANDOFF.md` §7), not invented:
| Part of the feature | Real behaviour | Governed by |
|---|---|---|
| Catalogue of official routines, programs, collections (`GET /api/guided`) | member read of the official content | `guidedTraining` (route gate) |
| Starting a guided *routine* | creates a **free session** (`routineId: null`, `src2j` in the history); never touches week/dayPlan/program/master routine | the workout is personal recording: `workoutRecording` (free). The content comes from the catalogue (`guidedTraining`) or from the local cache. |
| A guided *program* (`source: 'guided-v2'`) in the member's state | progress is derived from the recorded workouts; the server only closes a program as completed | keeping it and its history: free; adding/changing/activating/closing it: `guidedTraining` (sync policy + `finishWorkout`) |
| Trainer assigns a routine / program to a member | staff writes into the member's state (`assign-routine` copies a personal routine; `assign-program` adds a guided program) | staff role guards (never the member's capabilities) |
| Admin / trainer curation (`/api/guided/*` writes) | official catalogue management | role guards (`staff`) |
No new capability was invented: the feature maps onto `guidedTraining` (content and program use) and the free baseline (recording).
