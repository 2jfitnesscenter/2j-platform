# 2J-INT-H2 — Platform: one-time Training SSO codes (disabled by default)

Branch `agent/claude/2J-INT-PLATFORM-IDENTITY`, base `origin/main` `f87818afe474176c6e6ae77cb4d62a7e73fc1adf`. Platform only; Búnker is a separate task (`2J-INT-H3`).

## Scope
Issue a single-use, 60-second, hash-only code bound to the person, the active auth subject and the linked Training user; let Training redeem it server-to-server with `2J-SERVICE-AUTH-V1`, re-evaluating the link and the `2J-CAPABILITIES-V2` payload at redemption. Migration `0039`, `training-sso.ts`, shared `computeTrainingCapabilities`, signed-POST support in the internal service auth.

## Out of scope
Passkey credential for Platform/Home, provisioning, link ACK/lifecycle messages, any production activation, merges, deployments.

## Done criteria
`TRAINING_SSO_ENABLED` off by default; origin required for issuance with any provider; one live code per person; redemption cannot use a stale suspension/revocation snapshot; replays refused with bounded evidence; API suite and typecheck green on a disposable PostgreSQL; independent review recorded; reviewer and QA approvals remain pending until actually performed.
