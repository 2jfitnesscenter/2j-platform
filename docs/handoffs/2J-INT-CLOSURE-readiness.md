# 2J-INT-CLOSURE — Technical closure and readiness report (for independent review)

Platform branch `agent/claude/2J-INT-CLOSURE` (stacked on `2J-INT-E2E` → `2J-INT-HOME-CONNECTED` → `2J-INT-PLATFORM-IDENTITY`).
Búnker branch `agent/claude/2J-INT-BUNKER-CLOSURE` (stacked on `2J-INT-BUNKER-CONSUMER`).
Everything is local, isolated and **off by default**. Nothing was deployed, merged, migrated on a real database or pointed at production.

## 1. Authentication architecture chosen

**Platform is the authority for member identity; Búnker keeps its own passkeys untouched.**

| Piece | Decision |
|---|---|
| Central member authentication | Platform-owned WebAuthn passkeys (`apps/api/src/platform-passkeys.ts`, migration `0041`). Auth-subject provider `platform-passkey`; sessions reuse `platform_member_sessions` (8 h, HttpOnly, SameSite=Lax). |
| Relying-party ID | **`home.2jfitnesscenter.com`** (exact host of the Home member app), taken from configuration (`PLATFORM_PASSKEY_RP_ID`) and validated against the member origin at startup. |
| Búnker | `RP_ID`, `ORIGIN` and existing passkeys are **not changed**. Platform → Búnker identity travels through one-time SSO codes (`authLevel=sso`), never through shared credentials. |
| Production guard | `platformPasskeysEnabled` is refused unless `NODE_ENV` is `development`/`test`. It cannot be switched on in production until a human security review lifts that guard. |
| Enrollment | Administrator-issued, single-use, hash-only, 15-minute token (`identity.people.manage`). No self-service sign-up; no account is created by the ceremony. |

**RP ID implications (audited)**
- The RP ID is immutable for a credential: moving Home to another host orphans every passkey. Each credential stores its `rp_id`; login rejects any mismatch.
- An RP ID of the apex (`2jfitnesscenter.com`) would also be valid for `home.` but would widen the scope to every sibling subdomain; the exact host was chosen. The validator still accepts a registrable parent, so a deliberate widening needs a conscious configuration change.
- Búnker's host and Platform's Home host differ, so passkeys are **not shared** between them (by design: SSO is the bridge). Native shells would additionally need `assetlinks`/`apple-app-site-association` for the Home host — not covered.
- Origin must be exactly the configured member origin (`Sec-Fetch-Site` cross-site refused); `https` is mandatory except loopback in development.

Why not alternatives: sharing Búnker's RP ID would force a cookie/origin merge and put Búnker's passkeys at risk; an external IdP needs explicit approval (not granted); the pilot code login is test-only.

## 2. Capabilities matrix (personal vs commercial routines)

Authority: Platform `2J-CAPABILITIES-V2`; Búnker enforces by **content**, not by route name (`api/platform-sso/state-policy.js`). `FREE_BASELINE` = autonomous training, personal routine creation/management, workout recording and history.

| Operation (same routes `POST /api/sync`, `PUT /api/data`) | Free baseline | Needs |
|---|---|---|
| Create / edit / delete personal routines and programs | ✅ | `personalRoutineCreation` / `personalRoutineManagement` |
| Record workouts, read history | ✅ | `workoutRecording`, `workoutHistory` |
| Add/change/activate a guided program (`source: guided-v2`) | ❌ stripped | `guidedTraining` |
| Premium / opposition subtrees | ❌ stripped | `premiumPrograms` |
| AI Coach subtree | ❌ stripped (withdrawing consent always allowed) | `aiCoach` |
| Professional follow-up (`/api/followup`) | ❌ route gate | `professionalFollowUp` |

Properties: nothing is deleted; reductions are always allowed; unauthorized additions are stripped (not rejected) so a stale client cannot jam its sync queue and the response lists what was ignored; capability degradation never grants paid rights unverified; `ADMIN_SUSPENDED`, "link missing" and "link revoked" are separate states. `routineCreation` as a *commercial* distinction stays informational (decision recorded: not applied for now).

## 3. Link and provisioning flow

**Link an existing (historical) account** — owner proof required:
1. Member (Platform session) → `POST /api/platform/v1/training-link-transactions` (challenge, 5 min).
2. Owner proves control in Búnker with their passkey session → `POST /api/platform/v1/link-proofs` (one-time code).
3. Member → `POST /api/me/training/link {transactionId, challenge, code}`: Platform exchanges the code (signed `2J-SERVICE-AUTH-V1`), reconciles the receipt, creates a **pending** canonical link.
4. Platform → `POST /api/platform/v1/link/activate` (signed). Búnker activates **only** if it holds its own receipt for exactly that person+account (a leaked service key alone cannot take over an account); one link per person and per Training user.
5. Platform records `training_ack_id` and moves `pending → active`. Retry-safe at every point (`…/training-link/resume`).

**Revocation:** `DELETE /api/me/training/link` or admin `…/training-link/revoke` → `active → revocation_pending` (access stops at once) → Búnker closes link + SSO sessions (never relaxes enforcement) → `revoked` with Training's ACK, "unknown on Training", or an **audited administrative waiver**. A new link after revocation needs a newer proof.

**Provisioning (new members):** admin `POST …/persons/:id/training-provision` with `Idempotency-Key` → Platform stores the request, Búnker creates one minimal profile (display name + personId, `platformEnforcement: enforced`, no credentials), then the normal activation. Same key = same result; one profile per person; outages leave resumable state; the first passkey comes from the existing admin recovery link.

DB guards (migration `0040`): triggers allow `pending→active` only with an ACK, `revocation_pending→revoked` only with a revocation ACK/waiver, immutable ACKs and history, uniqueness per person and per Training user.

Legacy mode for unlinked historical users, per-user `legacy → shadow → enforced`, and "enforcement off by default" are preserved.

## 4. Commits and branches

Platform `agent/claude/2J-INT-CLOSURE`: `4994f5e` link lifecycle + provisioning (+ migration 0040) · `32d2f2e` passkeys (+ migration 0041) · `8650342` E2E seeding · `9b9d852` link-lifecycle E2E.
Búnker `agent/claude/2J-INT-BUNKER-CLOSURE`: `7bddedc`, `8fcc4df` state authorization · `5f2d3f0` link lifecycle/provisioning · `92d5dca` event labels EN/ES.
Earlier stack (already reviewed): Platform `fc0714e`, `988cb85`, `2b0e01c`; Búnker `a810670`.

## 5. Tests executed (all green)

| Suite | Result |
|---|---|
| Platform workspace `pnpm test` (design-tokens, domain, permissions, ui, auth, audit, api, admin-web, client-app, staff-app) | all pass; API 266/266 on a clean PostgreSQL |
| `pnpm typecheck` / `pnpm build` (Platform) | 11/11 · 9/9 successful |
| Platform new tests | `training-link-flow` 7 (fake signed Training server), `platform-passkeys` 5 (virtual authenticator, real WebAuthn verification) |
| Búnker API | 863 tests, 816 pass, 0 fail, 47 skipped (pre-existing skips); `platform-sso` 28, `platform-state-policy` 8 |
| Búnker frontend | vitest 1865/1865; `vite build` ok |
| E2E `training-sso.e2e.mjs` (real Platform + Búnker processes) | 15/15 |
| E2E `training-link.e2e.mjs` (new) | 8/8: link with proof, takeover, revocation, outage revocation, provisioning, provisioning outage, duplication, log secrecy |

## 6. Pending risks / not covered

- WebAuthn tested with a virtual authenticator only; no real device, no native shell, no `assetlinks`.
- Búnker UI page for issuing the link proof is not built (the API exists and is exercised by E2E).
- Admin UI for enrollment/link/provision/revoke is API-only.
- Passkey ceremony in the Home client UI is not built; only the API.
- Provisioned accounts get their first Búnker passkey through the existing recovery flow (needs a staff action).
- `routineCreation` commercial distinction is informational.
- Production SHA of Búnker not verified; no production environment variable, DNS, Caddy or Contabo change was made or planned here.
- Rate limiting for passkey ceremonies is in-memory per process.
- Human security review, QA and reviewer approvals remain **pending** until actually performed.

## 7. Recommendation for independent audit

Run an independent security review before any PR is marked ready, focusing on: (1) the Búnker-side activation evidence rules and anti-takeover logic (`api/platform-sso/link.js`), (2) the migration triggers `0040`/`0041`, (3) the passkey ceremony and RP ID decision, (4) content-level state authorization, (5) the signed service client and replay handling. Then a QA pass with real devices on a staging copy before any flag is enabled.

## 8. Pull requests

Draft PRs only, stacked, no merge, no deploy (see JSON handoff for status).

## 9. Security closure (implementer pass)

See `docs/handoffs/2J-INT-CLOSURE-security-closure.md`: state-write inventory with negative tests, exact RP ID, explicit trusted proxies, provisioning guard, Caddy guidance (documentation only). That pass was done by the implementing agent and is **not** an independent review; the human/external security review and device QA remain pending.
