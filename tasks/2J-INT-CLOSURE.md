# 2J-INT-CLOSURE — Bilateral link lifecycle, provisioning and isolated Platform passkeys

Branch `agent/claude/2J-INT-CLOSURE` (built on `2J-INT-E2E`). Búnker counterpart: `2jfitnessapp` branch `agent/claude/2J-INT-BUNKER-CLOSURE`.

## Scope
Platform link activation/revocation with Training acknowledgement, idempotent provisioning, Platform-owned passkeys (RP ID `home.2jfitnesscenter.com`, dev/test only), migrations 0040/0041, tests and E2E (`tooling/e2e/training-link.e2e.mjs`).

## Out of scope
Production, real data or credentials, enabling any flag, changing Búnker RP_ID/ORIGIN/passkeys, UI for passkeys/link proofs, merges, deployments.

## Done criteria
Tests, typecheck, builds and both E2E suites green; independent security review and QA recorded (pending until performed); draft PRs only.

Readiness report: `docs/handoffs/2J-INT-CLOSURE-readiness.md`.
