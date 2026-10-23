# 2J MASTER INTEGRATION — Reviewer package (for a reviewer other than the implementer)

> **This package was prepared by the implementing agent. Preparing it is NOT an independent review, and nothing in it should be read as an approval.** Independent security review, QA and PR approvals are **pending**. The integration is **not approved for production**.

## 1. What is being reviewed

Home → Platform → Búnker (Training) identity integration, in six stacked **draft** PRs. Everything is off by default; nothing is deployed, merged, migrated on a real database or pointed at production. Historical Búnker users stay in `legacy` mode (no behaviour change) unless an administrator moves *that* user to `shadow` and then `enforced`.

| Order | PR | Branch → base | Reviewed tip (SHA) | Content |
|---|---|---|---|---|
| 1 | [2j-platform#64](https://github.com/2jfitnesscenter/2j-platform/pull/64) | `agent/claude/2J-INT-PLATFORM-IDENTITY` → `main` | `fc0714e07cfebeda6e8641fdba36cdccc9b7f169` | one-time Training SSO codes (migration 0039), capabilities consumption endpoint; includes the earlier Home visual-unification commits |
| 2 | [2j-platform#65](https://github.com/2jfitnesscenter/2j-platform/pull/65) | `agent/claude/2J-INT-HOME-CONNECTED` → #64 | `988cb85f4f48cfe40bcdb75fdcf83d3e1c23cee3` | Home client entry to Búnker via SSO behind a build flag |
| 3 | [2j-platform#66](https://github.com/2jfitnesscenter/2j-platform/pull/66) | `agent/claude/2J-INT-E2E` → #65 | `2b0e01c2ec88ee14a8d5360ef68897ac965a4eb0` | isolated E2E harness (15 cases) |
| 4 | [2j-platform#67](https://github.com/2jfitnesscenter/2j-platform/pull/67) | `agent/claude/2J-INT-CLOSURE` → #66 | code tip `28dc500` (`1ed396aa49c1b24db14d3fe18b68de8740e756c9` is the last pre-package commit; this package is a docs-only commit on top) | bilateral link lifecycle + provisioning (0040), Platform passkeys (0041), trusted proxies, exact RP ID, E2E link suite, docs |
| 5 | [2jfitnessapp#56](https://github.com/2jfitnesscenter/2jfitnessapp/pull/56) | `agent/claude/2J-INT-BUNKER-CONSUMER` → `main` | `a8106704ea9aadd2b28fd86cc0d73d7364ade6bc` | Búnker consumes SSO + capabilities V2 (per-user legacy/shadow/enforced, safe degradation, route policy) |
| 6 | [2jfitnessapp#57](https://github.com/2jfitnesscenter/2jfitnessapp/pull/57) | `agent/claude/2J-INT-BUNKER-CLOSURE` → #56 | `f7635ad0f47b3deab6d8f5acf9a217d4dacf7ad5` | content-level state authorization, Búnker link lifecycle/provisioning, kiosk re-check, guided-program freeze, `TRUSTED_PROXIES`, tests, docs |

Dependency order: review/merge **1 → 2 → 3 → 4** (Platform) and **5 → 6** (Búnker). The two repositories talk through the contracts in `CONTRACTS.md`; both sides were exercised together by the E2E suites. (Re-verify the SHAs with `git rev-parse <branch>`; if a branch moved, the reviewer should diff against the SHA above and ask why.)

## 2. Suggested reading order (≈ security-critical first)

1. `CONTRACTS.md` — identity, capabilities, service-auth, link lifecycle.
2. Búnker `api/platform-sso/link.js` — activation evidence, anti-takeover, revocation, provisioning.
3. Búnker `api/platform-sso/index.js` (gate, redeem, enforcement transitions, `authorizeStateWrite`) and `state-policy.js`.
4. Búnker `api/platform-sso/route-policy.js` + `ROUTE-MATRIX.md`; dispatcher in `api/server.js` (search `platformIntegration.gate`).
5. Búnker `api/bunker/routes.js` (`readKioskMember`, guided freeze in `finishWorkout`) and `api/bunker/rate-limit.js`.
6. Platform `apps/api/migrations/0040_*.sql`, `0041_*.sql` + `MIGRATIONS.md`.
7. Platform `apps/api/src/training-link-flow.ts`, `training-sso.ts`, `platform-passkeys.ts`, `member-pilot-auth.ts`, `server.ts` (flags, guards, `parseTrustedProxies`).
8. Docs: `docs/handoffs/2J-INT-CLOSURE-security-closure.md`, `docs/runbooks/2J-INT-proxy-and-rate-limits.md` (Platform) and `docs/security/2J-INT-CLOSURE-security-closure.md` (Búnker).
9. Tests (they document intended behaviour): Búnker `api/test/platform-sso.test.js`, `platform-state-policy.test.js`, `bunker-rate-limit.test.js`; Platform `apps/api/test/training-link-flow.test.mjs`, `platform-passkeys.test.mjs`, `training-sso.test.mjs`; E2E `tooling/e2e/training-sso.e2e.mjs`, `training-link.e2e.mjs`.

## 3. How to reproduce the tests (disposable resources only)

Prerequisites: Node 22+, pnpm (Platform), Docker (a throw-away PostgreSQL). Never point these at a real database.

```bash
# Disposable PostgreSQL (loopback only, random port)
docker run -d --name 2j-review-pg -e POSTGRES_PASSWORD=testonly -e POSTGRES_DB=twoj_test -p 127.0.0.1::5432 postgres:16
docker port 2j-review-pg 5432        # note the port
export DATABASE_URL=postgres://postgres:testonly@127.0.0.1:<port>/twoj_test

# Platform (branch agent/claude/2J-INT-CLOSURE)
pnpm install --frozen-lockfile
pnpm test            # all packages; apps/api needs DATABASE_URL and a CLEAN schema
pnpm typecheck && pnpm build

# Búnker (branch agent/claude/2J-INT-BUNKER-CLOSURE)
cd api && npm ci && npm test                   # 874 tests, 47 pre-existing skips
cd ../frontend && npm ci && npx vitest run && npx vite build

# End to end (real Platform + Búnker processes, own throw-away database, random secrets, loopback)
cd <platform>/apps/api
E2E_DATABASE_ADMIN_URL=postgres://postgres:testonly@127.0.0.1:<port>/postgres \
E2E_BUNKER_API_DIR=<bunker>/api \
node --import tsx ../../tooling/e2e/training-sso.e2e.mjs     # 15 cases
node --import tsx ../../tooling/e2e/training-link.e2e.mjs    # 8 cases

# Regenerate the protected-route matrix from the real route table
cd <bunker>/api && node scripts/route-matrix.mjs > ROUTE-MATRIX.md
docker rm -f 2j-review-pg
```

Note: the Platform API suite expects a clean schema (`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`) before a full run; some older tests assert on global counts.

## 4. Results obtained by the implementer (last run, branch tips above)

| Suite | Result |
|---|---|
| Platform `pnpm test` (all packages) | pass; `apps/api` **269/269** (incl. 8 link-flow, 7 passkey tests) |
| Platform `pnpm typecheck` / `pnpm build` | 11/11 · 9/9 |
| Búnker API `npm test` | 874 tests · **827 pass · 0 fail** · 47 skipped (skips pre-date this work) |
| Búnker frontend vitest / `vite build` | 1865/1865 · ok |
| E2E SSO + capabilities | 15/15 |
| E2E link lifecycle + provisioning | 8/8 |
| Secret scan of every pushed diff | clean (patterns for private keys, GitHub/AWS/Slack/OpenAI-style tokens, quoted secrets) |

Defects found and fixed during the implementer's own closure pass: non-object state coerced to `{}` (sync) and arrays accepted by `PUT /api/data`; RP ID parent-domain widening; no safe proxy trust in Platform; provisioning enableable in any `NODE_ENV`; kiosk tokens valid for 4 h after suspension; guided program closable without the right. Each has a test.

## 5. Residual risks (known, not hidden)

1. **Suspension latency at the kiosk** ≤ 60 s (capability cache). Instant revocation would need Platform to push suspensions to Búnker (new signed endpoint) — *proposed, not built*.
2. **Legacy / shadow users are never blocked** by design; protection exists only after an administrator enforces a user.
3. `TRUSTED_PROXIES` unset (default) keeps the legacy "any private peer" rule; production must set it (see runbook) — a configuration obligation, not enforced by code.
4. State fields that carry paid content are listed by hand in `state-policy.js` (`premium`, `opposition`, `coach`, guided programs); a new paid feature must be added there.
5. Staff can assign guided programs regardless of the member's fee (by design).
6. WebAuthn tested only with a virtual authenticator; no real device, native shell or `assetlinks`; RP ID `home.2jfitnesscenter.com` cannot even be configured in this branch (loopback-only origins, dev/test-only passkeys).
7. Platform rate limiting is in-memory per process; Búnker UI for the link proof and admin/Home UIs for passkeys, enrollment and provisioning are not built (API only).
8. Production Búnker SHA unverified; no real environment inspected; Caddy/DNS/Contabo untouched.
9. `routineCreation` as a commercial distinction is informational only (decision recorded).
10. The earlier Home visual commits and the Home client changes were not re-audited in the final pass.

## 6. Where the checklists and acceptance criteria are

`CHECKLISTS.md` (security checklist, QA checklist, acceptance and rejection criteria). `MIGRATIONS.md` (0040/0041 invariants and probes). `ROUTE-MATRIX.md` (336 routes classified).
