# 2J-INT-H2 — Platform: one-time Training SSO (handoff)

## State

- Repository: `2jfitnesscenter/2j-platform`; branch `agent/claude/2J-INT-PLATFORM-IDENTITY`; worktree `C:\Users\juanj\Dev\2J\worktrees\claude\platform\2J-INT-PLATFORM-IDENTITY`.
- Base: `origin/main` `f87818afe474176c6e6ae77cb4d62a7e73fc1adf` (PR #63 merged; earlier handoffs that list it as open are outdated).
- Not pushed, no PR, no merge, no deployment, no real database touched. Feature flag `TRAINING_SSO_ENABLED` is off by default.
- Home branches protected on GitHub (no force, no PR): `agent/codex/2J-HOME-004-staging-readiness` `0987639`, `agent/codex/2J-HOME-VISUAL-UNIFICATION` `6763cf9`, `agent/claude/2J-INT-HOME-REBASE` `1bc037f`.

## Changed

- `apps/api/migrations/0039_training_sso_codes.sql`
- `apps/api/src/training-sso.ts` (new), `training-capabilities-api.ts` (shared `computeTrainingCapabilities`), `internal-service-auth.ts` (signed POST), `member-pilot-auth.ts` (`resolvePerson`), `server.ts` (wiring, flags)
- `apps/api/test/training-sso.test.mjs` (new), `services.test.mjs` (migration-tail assertions only)
- `apps/api/.env.example` (variable names), `docs/integrations/training/2J-INT-training-sso-design.md`

## Verification

Disposable PostgreSQL 17 container (fresh database): `@2j/api` 254/254 after the review fixes (was 251/251); typecheck 11/11. Independent review and QA are **pending**; no browser/E2E run yet (needs H3/H4).

## Pending / open

- H3 Búnker consumer and gates (legacy/shadow/enforced), bilateral link uniqueness in Búnker, session-version revocation.
- H4 Home connected mode behind a flag.
- Platform passkey credential: needs a verified RP ID distinct from Búnker; `platform-pilot` is test-only.
- Production SHA of Búnker: not verified.

## Review fixes (independent code review of this branch)

- Origin/CSRF protection on code issuance for every authentication provider (was pilot-only).
- Redemption evaluates capabilities inside the transaction that holds a shared lock on the person, closing the window against a concurrent suspension; the capability read no longer happens for dead codes.
- One live code per person (new supersedes old) and a per-minute issuance limit instead of a pending-count cap; bounded audit for replays.
- `resolvePerson` and `resolve` share one session lookup (and `resolvePerson` now refreshes `last_seen_at`).
- Migration-history tests derive their expectations from the migration directory (latest-migration upgrade, ordered full listing) instead of pinning counts.
- Machine-readable handoff `2J-INT-H2-training-sso.json` and `tasks/2J-INT-H2.md` added (AGENTS.md).

