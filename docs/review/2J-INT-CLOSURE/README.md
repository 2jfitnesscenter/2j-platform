# 2J MASTER INTEGRATION — Reviewer package (for a reviewer other than the implementer)

> **Prepared and updated by the implementing agent. This is NOT an independent review and nothing here is an approval.** The independent security review, QA with real devices and PR approvals are **pending**. The integration is **not approved for production**. Updated 2026-10-23 after the architect's review (H1–H16).

## 1. What is being reviewed

Home → Platform → Búnker (Training) identity integration in six stacked **draft** PRs. Everything is off by default; nothing is deployed, merged, migrated on a real database or pointed at production. Historical Búnker users stay in `legacy` mode — **through passkey and through Platform SSO alike** — unless an administrator moves *that* user to `shadow` and then `enforced`.

| Order | PR | Branch → base | Reviewed code SHA (full) | Content |
|---|---|---|---|---|
| 1 | [2j-platform#64](https://github.com/2jfitnesscenter/2j-platform/pull/64) | `agent/claude/2J-INT-PLATFORM-IDENTITY` → `main` | `fc0714e07cfebeda6e8641fdba36cdccc9b7f169` | one-time Training SSO codes (migration 0039), capabilities consumption endpoint; also carries the unaudited Home visual commits (see `MERGE-STRATEGY.md`) |
| 2 | [2j-platform#65](https://github.com/2jfitnesscenter/2j-platform/pull/65) | `agent/claude/2J-INT-HOME-CONNECTED` → #64 | `988cb85f4f48cfe40bcdb75fdcf83d3e1c23cee3` | Home client entry to Búnker via SSO behind a flag |
| 3 | [2j-platform#66](https://github.com/2jfitnesscenter/2j-platform/pull/66) | `agent/claude/2J-INT-E2E` → #65 | `2b0e01c2ec88ee14a8d5360ef68897ac965a4eb0` | isolated E2E harness |
| 4 | [2j-platform#67](https://github.com/2jfitnesscenter/2j-platform/pull/67) | `agent/claude/2J-INT-CLOSURE` → #66 | `747272552666e7b2d9a9bdac87944091447fcd58` (last code commit; later commits on the branch are documentation only — check with `git diff 7472725..origin/agent/claude/2J-INT-CLOSURE --stat`, only `docs/` may appear) | link lifecycle + provisioning (0040), passkeys (0041), trusted proxies, exact RP ID, E2E link suite, latency tool, runbooks, this package |
| 5 | [2jfitnessapp#56](https://github.com/2jfitnesscenter/2jfitnessapp/pull/56) | `agent/claude/2J-INT-BUNKER-CONSUMER` → `main` | `a8106704ea9aadd2b28fd86cc0d73d7364ade6bc` | Búnker consumes SSO + capabilities V2 |
| 6 | [2jfitnessapp#57](https://github.com/2jfitnesscenter/2jfitnessapp/pull/57) | `agent/claude/2J-INT-BUNKER-CLOSURE` → #56 | `8d7be6380a964abba770cd91ca1db83e67bfc9bf` (last code commit; later ones are documentation only) | state authorization, link lifecycle, kiosk re-check, guided freeze, session-follows-mode, failure model, switch confirmation, `TRUSTED_PROXIES`, route matrix from the router, differential tool, **Dockerfile fix** |

Dependency order: **1 → 2 → 3 → 4** and **5 → 6**. `MERGE-STRATEGY.md` explains how to merge the stack (merge commits or squash + `rebase --onto`), what must be true first, and that **#56 must not be merged without the `Dockerfile` line of #57** (otherwise the image does not start). Verify SHAs with `git rev-parse <branch>`; if a branch moved, diff against the SHA above and ask why.

## 2. Reading order (security-critical first)

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
  node --import tsx ../../tooling/e2e/training-sso.e2e.mjs      # 15 cases
  node --import tsx ../../tooling/e2e/training-link.e2e.mjs     # 9 cases

# Differential run for historical users: main vs the branch (identical data, no Platform)
git -C <bunker> worktree add --detach ../main-baseline origin/main   # then junction/symlink node_modules
cd <bunker>/api && node scripts/legacy-differential.mjs ../../main-baseline/api .    # exit 0 = no unexpected difference

# Kiosk suspension latency (≈ 18 min, real Platform + Búnker): same E2E_* variables
node --import tsx ../../tooling/e2e/kiosk-suspension-latency.mjs

# Route matrix from the effective router
cd <bunker>/api && node scripts/route-matrix.mjs > ROUTE-MATRIX.md
```

## 4. Results obtained by the implementer (branch tips above)

| Suite | Result |
|---|---|
| Platform `pnpm test` (all packages) | pass; `apps/api` **269/269** |
| Platform `pnpm typecheck` / `pnpm build` | 11/11 · 9/9 |
| Búnker API `npm test` | **885 tests · 838 pass · 0 fail · 47 skipped** (identical 47 names on `main`: bash-dependent) |
| Búnker frontend vitest / `vite build` | **1867/1867** · ok |
| Búnker `ops/deploy-kit/windows/*.test.mjs` | 9 files, 0 failures |
| E2E SSO + capabilities | **15/15** (personas now opted in to enforcement, as sessions follow the user's mode) |
| E2E link lifecycle + provisioning + switch confirmation | **9/9** |
| Differential `main` vs branch (legacy users) | 63 requests: 62 identical, 1 intentional, 0 unexpected |
| Kiosk suspension latency | 8/8 blocked; min 7.3 s, p50 19.2 s, max 39.7 s (≈ 60 s − cache age); emergency local disable 6 ms; Platform down + nobody acts = kiosk keeps working |
| Secret scan of every pushed diff | clean |

## 5. Residual risks (known)

1. **H3 residual:** a visitor with no session can still be signed in to the account of whoever sent the link (login CSRF without a victim session). Fix = bind the code to the initiating browser (Home↔Búnker handshake) — design proposed, not built.
2. **Suspension latency** is ≈ 60 s (measured, n = 8, loopback, synchronised clocks) — not guaranteed; **unknown during a Platform outage** (kiosk keeps the free baseline). Mitigation: the emergency local disable (runbook) and an alert on `platform_unreachable`, which operations must wire.
3. Legacy / shadow users are never blocked by Platform (by design); protection exists only after an administrator enforces a user.
4. `TRUSTED_PROXIES` / `PLATFORM_TRUSTED_PROXIES` unset (the default) keeps the legacy "private peer" rule in Búnker — a configuration obligation before exposure (runbook, 8 staging tests).
5. State keys carrying paid content are guarded by `COMMERCIAL_SUBTREES` plus a test that fails on an unclassified key (`test/state-key-classes.mjs`); a new paid feature still needs a human decision.
6. Staff can assign guided programs regardless of the member's fee (by design); finishing a workout of a guided program without the right records it and freezes the program.
7. WebAuthn only with a virtual authenticator; no real device; the production RP ID cannot even be configured in this branch (loopback-only origins, dev/test-only passkeys).
8. Platform rate limiting is in-memory per process; admin/Home UIs for passkeys/enrollment/provisioning and the Búnker link-proof UI do not exist (API only).
9. `routineCreation` informational (ADR-2J-INT-001, temporary).
10. Two consumers of capabilities exist (Claude `platform-sso` and the unmerged Codex `platform-capabilities`); #56 neither includes nor replaces the Codex one.
11. Not re-audited: the Home client, the Home visual commits carried by #64, and infrastructure (Caddy, DNS, Contabo, backups) — untouched.
12. A staging mode does not exist: **design only** (`docs/design/2J-INT-staging-mode.md`); today the only safe environments are development/test.

## 6. Decisions that still need the owner (short list)

1. Merge strategy for the stacks (merge commits vs squash + rebase) and what to do with the unaudited Home visual commits in #64.
2. Which capabilities consumer survives in Búnker (Claude `platform-sso` vs Codex `platform-capabilities`), or how they are merged.
3. Build the browser-bound SSO code (closes the H3 residual) before enabling SSO for anyone: yes/no.
4. Accept ≈ 60 s kiosk suspension latency plus the emergency local disable and the outage exposure — or require a Platform→Búnker push of suspensions.
5. Approve (or not) the staging design and say who runs staging, QA and the independent audit.
6. Whether an array as the whole state in `PUT /api/data` may stay rejected (it is the only intentional difference for legacy users).

## 7. Other files

`CHECKLISTS.md` (security checklist, QA checklist, acceptance and rejection criteria), `MIGRATIONS.md`, `ROUTE-MATRIX.md`, `EVIDENCE-kiosk-latency.json`, `MERGE-STRATEGY.md`, `STATUS-H1-H16.md`.
