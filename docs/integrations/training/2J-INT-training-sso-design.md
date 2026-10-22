# 2J-INT — Home/Platform → Búnker identity, one-time SSO and capability enforcement

**Status:** H2 (Platform side) implemented on branch `agent/claude/2J-INT-PLATFORM-IDENTITY`; **disabled by default, not deployed, not enabled in any real environment.** Búnker (H3) and Home (H4) are separate branches that must land and pass their own tests before any activation.

## Verified baseline

- Platform `origin/main` = `f87818afe474176c6e6ae77cb4d62a7e73fc1adf`. **PR #63 is merged** (term payment access for bookings). The older Home-004 handoff, which called #55 a draft SSO design and described Platform as not yet carrying #61–#63, is out of date.
- Búnker `origin/main` = `cbfa0502ab10cbc954b8fe504362fc4334a5b487` (docs alignment #55). Production SHA of Búnker is **not verified**: `/api/health` exposes no version, and the endpoint must not be changed to find out.

## Commercial semantics (supersedes “no fee = blocked”)

`2J-CAPABILITIES-V2` is the only reference. No active fee is **not** a block:

| State | Result |
|---|---|
| Fuerza (`full`) active/provisional | everything, including `aiCoach` and `professionalFollowUp` |
| Other fee (`autonomous`) active/provisional | autonomous training, own routines, `guidedTraining`, `premiumPrograms`; no AI, no professional follow-up |
| No fee / unpaid / ended | `FREE_BASELINE`: `autonomousTraining`, `personalRoutineCreation`, `personalRoutineManagement`, `workoutRecording`, `workoutHistory` only |
| Administrative suspension | `ADMIN_SUSPENDED`, all capabilities off, identity/link/data retained, reversible and audited |
| Link missing / revoked | `TRAINING_LINK_MISSING` / `TRAINING_LINK_REVOKED`, a separate state from commercial status |

The contract was checked against D1 (fixtures, schema, domain tests): it does not grant anything D1 forbids, so no contract change was made.

## Reused vs new

Reused unchanged: `platform_persons`, facets, `platform_person_auth_subjects`, `platform_member_sessions` (hashed token, revocation, audit), `training_account_links` (one active link per person and per Training user), link transactions and Búnker `link-proofs`, `2J-SERVICE-AUTH-V1`, capabilities endpoint and suspension lifecycle.

New in H2:

1. `computeTrainingCapabilities()` extracted from the capabilities route so the endpoint and SSO redemption share one implementation.
2. `verifyInternalServiceRequest` now also verifies `POST` with the exact body digest (GET behaviour unchanged).
3. Migration `0039_training_sso_codes.sql`: `platform_training_sso_codes` plus audit actions `training.sso_issued|redeemed|rejected`.
4. `POST /api/me/training/sso` (member session) and `POST /api/internal/platform/v2/sso/redeem` (service auth, caller `bunker` only).
5. `resolvePerson` on the pilot session so persons without a client facet can start SSO.

## One-time code

- 32 random bytes, only SHA-256 stored, TTL ≤ 60 s (DB constraint), single use (`pending → consumed|expired|revoked`, final, no delete/truncate).
- Bound to person, active auth subject, audience `2j-training-sso`, purpose `training-session` and the Training user linked at issue time.
- The browser receives a fixed server-configured URL with the code in the **fragment**; no open redirect, nothing in query strings or logs, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`.
- At redemption Platform takes a shared lock on the person row (suspension and lifting take it exclusively), then re-evaluates inside the same transaction: person active, auth subject active, same active link, capabilities not blocked. A suspension or revocation committed before the lock is therefore always seen; one committed after it applies from the next verification (Training re-verifies within 60 s). A changed binding or a suspension revokes the code.
- One live code per person: issuing a new code supersedes the previous one (`revoked`/`superseded`); at most 10 codes per person per rolling minute. Replays of a used, expired or revoked code stay refused (409/410) and leave at most 5 audit rows per code.
- Issuance (`POST /api/me/training/sso`) requires the exact member-app origin (`MEMBER_APP_ORIGIN`) and rejects `Sec-Fetch-Site: cross-site`, whichever authentication provider resolved the session; without a configured origin it answers 503.
- Redemption response carries `personId`, `trainingUserId` and the full V2 payload so Búnker needs no second call.
- Platform never creates or alters a Training identity here; it only vouches that an authenticated person owns an already-linked Training user.

## Legacy → shadow → enforced (per user, Búnker side)

State lives on the Búnker user record and is changed only by an administrator with an audit entry; there is no global switch.

- `legacy` (default for every existing user): current behaviour, no Platform check.
- `shadow`: Búnker fetches capabilities and logs where enforcement would differ; it blocks nothing.
- `enforced`: gates apply. Requires an active link. Can be rolled back to `shadow`.

Unlinked historical users stay in `legacy`; their routines, history and passkey login are untouched.

## Safe degradation when Platform is unavailable or a cache expired

A stale cache never blocks free functions by itself and never grants paid ones.

- Last verified state suspended or link revoked: stay blocked until a fresh verification (known restrictions are respected).
- Otherwise after expiry: only baseline capabilities and history; `routineCreation`, guided, Premium, AI and professional follow-up require a fresh, verified payload.
- No cache at all: `legacy`/`shadow` users keep today's access; `enforced` users get baseline only.
- An `sso` session (`authLevel=sso`) is never treated as `passkey`; operations that require a passkey keep requiring it.

## Bilateral link, ACK, revocation and uniqueness — risks to close before enabling SSO

1. Platform enforces one active link per person and per Training user; Búnker must enforce the same in its own store (`db.users[].personId` is metadata, not a lock). Open item for H3.
2. The ACK/reconciliation path (`link-proofs/exchange|reconcile`) must be idempotent on both sides; a lost response must reconcile, never create a second link.
3. Revocation on Platform must invalidate Búnker `sso` sessions: bump the Búnker session version on revoke/suspend and keep the capability TTL short (≤ 60 s).
4. Redemption audit lives only in Platform; Búnker must keep its own minimal audit (session opened/refused) with no code material.
5. Credential for production Platform login is still `platform-pilot` (test only). Passkeys for Platform/Home need their own RP ID, distinct from Búnker; the exact domain must be verified before implementing it. Búnker `RP_ID`/`ORIGIN` are never changed.

## Verification

Run on a disposable PostgreSQL 17 container with a fresh database: API suite 251/251, including `training-sso.test.mjs` (7 tests: disabled/unconfigured/unauthenticated, raw code never stored, service auth + caller + replay, single use, concurrency (3 parallel → 1 winner), expiry, link missing/revoked/changed, subject revoked, suspension block and lift, rate limit). Existing migration-history tests that pinned “latest = 0038” were updated to the new tail.
