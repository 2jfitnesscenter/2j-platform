# 2J MASTER INTEGRATION — Reviewer package (for a reviewer other than the implementer)

> **Prepared and updated by the implementing agent. This is NOT an independent review and nothing here is an approval.** The independent security review, QA with real devices and PR approvals are **pending**. The integration is **not approved for production**. Updated 2026-10-23 after the architect's review (H1–H16) and again after the six final pre-audit decisions (see `STATUS-H1-H16.md` last table). **The independent security audit and the real-device QA have not been done; nothing is approved.**

## 1. What is being reviewed

Home → Platform → Búnker (Training) identity integration in six stacked **draft** PRs. Everything is off by default; nothing is deployed, merged, migrated on a real database or pointed at production. Historical Búnker users stay in `legacy` mode — **through passkey and through Platform SSO alike** — unless an administrator moves *that* user to `shadow` and then `enforced`.

| Order | PR | Branch → base | Reviewed code SHA (full) | Content |
|---|---|---|---|---|
| 1 | [2j-platform#64](https://github.com/2jfitnesscenter/2j-platform/pull/64) | `agent/claude/2J-INT-PLATFORM-IDENTITY` → `main` | `fc0714e07cfebeda6e8641fdba36cdccc9b7f169` | one-time Training SSO codes (migration 0039), capabilities consumption endpoint; two commits only. (The Home visual commits are in #65, **not** #64 — correction; see `PR-DEPENDENCIES.md`) |
| 2 | [2j-platform#65](https://github.com/2jfitnesscenter/2j-platform/pull/65) | `agent/claude/2J-INT-HOME-CONNECTED` → #64 | `988cb85f4f48cfe40bcdb75fdcf83d3e1c23cee3` | Home client entry to Búnker via SSO behind a flag **+ the five Home visual / synthetic-demo / staging-candidate commits (not independently audited; the same patches also exist on two other branches)** |
| 3 | [2j-platform#66](https://github.com/2jfitnesscenter/2j-platform/pull/66) | `agent/claude/2J-INT-E2E` → #65 | `2b0e01c2ec88ee14a8d5360ef68897ac965a4eb0` | isolated E2E harness |
| 4 | [2j-platform#67](https://github.com/2jfitnesscenter/2j-platform/pull/67) | `agent/claude/2J-INT-CLOSURE` → #66 | `747272552666e7b2d9a9bdac87944091447fcd58` (last code commit of the first pass). **The second pass adds code on top of this PR**: `04c18c2` (browser binding, migration 0042), `98842a4` (Home binding), `9145eb2`+`d603e18` (signal dispatcher, migration 0043), `35173c2` (latency tool), then docs — see `PR-DEPENDENCIES.md` §4 for the exact list; the reviewed tip is the branch head at the time of review | link lifecycle + provisioning (0040), passkeys (0041), trusted proxies, exact RP ID, E2E link suite, latency tool, runbooks, this package |
| 5 | [2jfitnessapp#56](https://github.com/2jfitnesscenter/2jfitnessapp/pull/56) | `agent/claude/2J-INT-BUNKER-CONSUMER` → `main` | `a8106704ea9aadd2b28fd86cc0d73d7364ade6bc` | Búnker consumes SSO + capabilities V2 |
| 6 | [2jfitnessapp#57](https://github.com/2jfitnesscenter/2jfitnessapp/pull/57) | `agent/claude/2J-INT-BUNKER-CLOSURE` → #56 | `8d7be6380a964abba770cd91ca1db83e67bfc9bf` (last code commit of the first pass). **The second pass adds** `36b4482` (`/sso/start` + binding), `f933bce` (signal receiver), `b561534` + `8644886` (consumer corpus and ported validations), then the conformance runner | state authorization, link lifecycle, kiosk re-check, guided freeze, session-follows-mode, failure model, switch confirmation, `TRUSTED_PROXIES`, route matrix from the router, differential tool, **Dockerfile fix** |

Dependency order: **1 → 2 → 3 → 4** and **5 → 6**. `MERGE-STRATEGY.md` explains how to merge the stack (merge commits or squash + `rebase --onto`), what must be true first, and that **#56 must not be merged without the `Dockerfile` line of #57** (otherwise the image does not start). Verify SHAs with `git rev-parse <branch>`; if a branch moved, diff against the SHA above and ask why.

## 2. Reading order (security-critical first)

0. **New in the second pass (read first):** `PR-DEPENDENCIES.md` (stacks, duplicated Home commits, order), `CONSUMER-COMPARISON.md` (decision 2), `BROWSER-BINDING.md` (decision 3), `SIGNALS-PROPOSAL.md` (decision 4), `REAL-DEVICE-QA.md` (decision 5, not executed).
1. `STATUS-H1-H16.md` — what the architect found, what was done, the evidence and the tests.
2. `CONTRACTS.md` — identity, capabilities (and the failure model), enforcement semantics, SSO/switch confirmation, link lifecycle, feature map of "Entrena con 2J".
3. Búnker `api/platform-sso/index.js` (gate, redeem/confirm, enforcement transitions, `authorizeStateWrite`, `gateFailureMayProceed`), `capabilities.js` (failure model, breaker), `link.js`, `state-policy.js`, `route-policy.js`.
4. `ROUTE-MATRIX.md` (generated from the effective router) and the dispatcher in `api/server.js` (`platformIntegration.gate`, `DUMP_ROUTES`).
5. Búnker `api/bunker/routes.js` (`readKioskMember`, guided freeze in `finishWorkout`) and `api/bunker/rate-limit.js` (`TRUSTED_PROXIES`).
6. Platform migrations `0040`, `0041` + `MIGRATIONS.md`; `training-link-flow.ts`, `training-sso.ts`, `platform-passkeys.ts`, `server.ts`.
7. Runbooks and design: `docs/runbooks/2J-INT-proxy-and-rate-limits.md`, `docs/runbooks/2J-INT-emergency-suspension.md`, `docs/design/2J-INT-staging-mode.md`, `docs/adr/ADR-2J-INT-001-routinecreation-informational.md`, `MERGE-STRATEGY.md`.
8. Tests as specification: Búnker `platform-sso.test.js`, `platform-state-policy.test.js`, `bunker-rate-limit.test.js`, `dockerfile-covers-imports.test.js`; Platform `training-link-flow.test.mjs`, `platform-passkeys.test.mjs`; E2E `tooling/e2e/*.e2e.mjs`.

## 3. Reproduce (disposable resources only)

Node 22+, pnpm, Docker for a throw-away PostgreSQL. Never point these at a real database.
```bash
docker run -d --name 2j-review-pg -e POSTGRES_PASSWORD=testonly -e POSTGRES_DB=twoj_test -p 127.0.0.1::5432 postgres:16
export DATABASE_URL=postgres://postgres:testonly@127.0.0.1:<port>/twoj_test

# Platform (agent/claude/2J-INT-CLOSURE) — the API suite needs a FRESH schema:
#   psql … -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
pnpm install --frozen-lockfile && pnpm test && pnpm typecheck && pnpm build

# Búnker (agent/claude/2J-INT-BUNKER-CLOSURE)
cd api && npm ci && npm test            # run it from a shell WITHOUT bash on the PATH and from Git Bash: 47 vs 0 skipped, same on main
cd ../frontend && npm ci && npx vitest run && npx vite build

# End to end (real processes, own database, random secrets, loopback)
cd <platform>/apps/api
E2E_DATABASE_ADMIN_URL=postgres://postgres:testonly@127.0.0.1:<port>/postgres E2E_BUNKER_API_DIR=<bunker>/api \
  node --import tsx ../../tooling/e2e/training-sso.e2e.mjs      # 16 cases (incl. 10b: login CSRF / forwarded link)
  node --import tsx ../../tooling/e2e/training-link.e2e.mjs     # 9 cases

# Differential run for historical users: main vs the branch (identical data, no Platform)
git -C <bunker> worktree add --detach ../main-baseline origin/main   # then junction/symlink node_modules
cd <bunker>/api && node scripts/legacy-differential.mjs ../../main-baseline/api .    # exit 0 = no unexpected difference

# Kiosk suspension latency (≈ 18 min, real Platform + Búnker): same E2E_* variables
node --import tsx ../../tooling/e2e/kiosk-suspension-latency.mjs
# Same with the signed signal on (about 4 min; dev/test only):
node --import tsx ../../tooling/e2e/kiosk-signal-latency.mjs

# Two capabilities consumers on the same 59-scenario corpus (read-only; the Codex consumer is read with `git show 9377e517`)
(cd <bunker>/api && node scripts/compare-capabilities-consumers.mjs)

# Route matrix from the effective router
cd <bunker>/api && node scripts/route-matrix.mjs > ROUTE-MATRIX.md
```

## 4. Results obtained by the implementer (branch tips above, 2026-10-23, second pass)

| Suite | Result |
|---|---|
| Platform `pnpm test` (all packages) | packages other than `apps/api`: all pass (6, 29, 9, 18, 2, 3 tests). **`apps/api`: 282 tests, 279 pass, 3 fail** — the 3 failures are `term-payment-booking.integration.test.mjs` (PR #63, already on `main`, file byte-identical to `origin/main`): it hard-codes a session at `2026-10-23T12:00:00Z` and fails with `session_started` once the real clock passes it (run at 15:22Z). They passed earlier the same day (269/269 before the second pass added 13 tests). **Not caused by this work; not fixed here** (not our file). The 13 tests added in this pass (5 SSO-binding, 8 signal-dispatcher) pass. |
| Platform `pnpm typecheck` / `pnpm build` (`--force`, no cache) | 11/11 · 9/9 |
| Búnker API `npm test` | **902 tests · 902 pass · 0 fail · 0 skipped** (run from Git Bash; under a shell without `bash` 47 bash-dependent tests skip, same as on `main`) — includes the SSO suite (58, of which 6 are signal tests) and the conformance suite (4) |
| Búnker frontend vitest / `vite build` | **1875/1875** · ok |
| E2E SSO + capabilities (real processes) | **16/16** (adds 10b: login CSRF / forwarded link without a session) |
| E2E link lifecycle + provisioning + switch confirmation | **9/9** |
| Differential `main` vs branch (legacy users) | 63 requests: 62 identical, **1 intentional** (`PUT /api/data` with an array as the whole state: `main` 200 and destroys the state, branch 400), 0 unexpected — decision 6 re-verified |
| Capabilities consumers, same 59-scenario corpus | Claude **59/59** (43/59 before the port), Codex **59/59**, 6 intended differences — `CONSUMER-COMPARISON.md` |
| Signed signal latency (real processes, n = 6) | suspension → kiosk blocked p50 **0.47 s**, max 0.48 s, never unblocked (cache-only: p50 19.2 s, max 39.7 s); lift → restored 0.47–0.85 s after re-asking Platform — `SIGNALS-PROPOSAL.md`, `EVIDENCE-signal-latency.json` |
| Real browser, SSO handshake (built-in browser pane, local stack) | happy path lands signed in with cookie HttpOnly and fragment cleared; login CSRF with no session refused (`/api/me` 401) — `BROWSER-BINDING.md` |
| Kiosk suspension latency, cache-only (first pass) | not rerun (code unchanged): 8/8 blocked, p50 19.2 s, max 39.7 s; emergency disable 6 ms |
| Secret scan of every pushed diff | repeated before the push (see the final report); clean on the unpushed range of both repos at the time of writing |

## 5. Residual risks (known)

1. ~~H3 residual~~ **closed in code by decision 3** (browser-bound codes). Remaining: Safari/iOS ITP, in-app browsers and PWA cookie jars are **untested on real devices**; the failure mode is a clean "start from here" page.
2. **Suspension latency**: cache-only ≈ 60 s (measured p50 19 s, n = 8). With the signal (proof of concept, off) p50 0.47 s, n = 6 on loopback — **not a guarantee**, not wired for any real environment, key distribution and alert routing missing. Unknown during a Platform outage unless the signal was delivered first. Mitigation in all cases: the emergency local disable (runbook) and an alert on `platform_unreachable`, which operations must wire.
3. Legacy / shadow users are never blocked by Platform (by design); protection exists only after an administrator enforces a user.
4. `TRUSTED_PROXIES` / `PLATFORM_TRUSTED_PROXIES` unset (the default) keeps the legacy "private peer" rule in Búnker — a configuration obligation before exposure (runbook, 8 staging tests).
5. State keys carrying paid content are guarded by `COMMERCIAL_SUBTREES` plus a test that fails on an unclassified key; a new paid feature still needs a human decision.
6. Staff can assign guided programs regardless of the member's fee (by design); finishing a workout of a guided program without the right records it and freezes the program.
7. WebAuthn only with a virtual authenticator; no real device; the production RP ID cannot even be configured in this branch (loopback-only origins, dev/test-only passkeys).
8. Platform rate limiting is in-memory per process; admin/Home UIs for passkeys/enrollment/provisioning and the Búnker link-proof UI do not exist (API only).
9. `routineCreation` informational (ADR-2J-INT-001, temporary).
10. **Two consumers of capabilities still exist.** After the port, the Claude consumer matches the Codex one on every corpus scenario except six deliberate differences; the recommendation is to keep `platform-sso` (provisional, unreviewed). The corpus was written by the implementer.
11. **Not independently audited:** the Home client, the five Home visual/demo/staging commits (in #65, triplicated across branches by identical patches), the new browser-binding and signal code, and infrastructure (Caddy, DNS, Contabo, backups) — untouched.
12. A staging mode does not exist: **design only** (`docs/design/2J-INT-staging-mode.md`, extended); today the only safe environments are development/test. The real-device QA procedure (`REAL-DEVICE-QA.md`) is **written and not executed**.
13. **Shared-contract break by design:** SSO redeem v2 and the Home challenge mean Home, Platform and Búnker must be deployed as a set; SSO is off everywhere so nothing live is affected.
14. A clock-dependent test from #63 fails after 2026-10-23T12:00Z (see §4); a reviewer reproducing the suite will see 3 red tests that are unrelated to this integration.
15. Signal proof of concept: one delivery was still pending at the end of the latency run (not investigated); the dispatcher is dev/test-only and unmonitored.

## 6. Decisions that still need the owner (short list)

1. Merge strategy for the stacks (merge commits vs squash + rebase), which lane keeps the five Home visual commits (`PR-DEPENDENCIES.md`), and whether they get their own audit.
2. Which capabilities consumer survives (recommendation: `platform-sso`; the Codex branch stays until the independent reviewer has run the comparison) — and whether the six intended differences are acceptable.
3. Keep the browser-bound SSO as implemented (it changes the shared contract) — it was built on the owner's instruction; the decision left is *when* it may be enabled anywhere.
4. Adopt, defer or drop the signed signals (key distribution, alert routing, who reviews `training-signals.ts`); in any case the emergency local disable stays.
5. Approve (or not) the staging design and say who runs staging, the real-device QA and the independent audit.
6. Keep an array / invalid whole state in `PUT /api/data` rejected with 400 (the only intentional difference for legacy users; the owner already decided yes — recorded here).

## 7. Other files

`CHECKLISTS.md` (security checklist, QA checklist, acceptance and rejection criteria, section F added), `MIGRATIONS.md` (0040–0043), `ROUTE-MATRIX.md`, `EVIDENCE-kiosk-latency.json`, `EVIDENCE-signal-latency.json`, `MERGE-STRATEGY.md`, `STATUS-H1-H16.md`, `PR-DEPENDENCIES.md`, `CONSUMER-COMPARISON.md`, `BROWSER-BINDING.md`, `SIGNALS-PROPOSAL.md`, `REAL-DEVICE-QA.md`.

## 8. What this package is not

It is not an independent review, a QA result, an approval or an authorization to merge, deploy, change DNS/Caddy, migrate real data or enable any flag.
