# 2J-INT-H4 — Home: connected Búnker entry behind a flag

Branch `agent/claude/2J-INT-HOME-CONNECTED` (built on `2J-INT-PLATFORM-IDENTITY`). Home lives in `apps/client-app`.

## Scope
A build flag (`VITE_2J_TRAINING_SSO`, off by default) that makes the Búnker destination request a one-time code from Platform and follow only a validated Training URL (`<training origin>/sso#code=…`). The passkey link stays available. Home sends no identity and decides no entitlements. The synthetic demo never uses it.

## Out of scope
Capability-based UI, reservations/payments, Platform credential (passkeys), any production activation, merges, deployments.

## Done criteria
Flag off by default; destination validated (origin, path, fragment, no credentials); no duplicate codes on repeat taps; disabled in preview and in the native shell; client suite, typecheck and demo build green; independent review recorded; reviewer and QA approvals remain pending until actually performed.
