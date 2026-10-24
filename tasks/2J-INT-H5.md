# 2J-INT-H5 — End-to-end validation of Home + Platform + Búnker (isolated)

Branch `agent/claude/2J-INT-E2E` (built on `2J-INT-HOME-CONNECTED`, which includes `2J-INT-PLATFORM-IDENTITY`). Búnker under test: `2jfitnessapp` branch `agent/claude/2J-INT-BUNKER-CONSUMER`.

## Scope
Tooling only (`tooling/e2e/`): a repeatable harness that runs real Platform and Búnker processes against a disposable PostgreSQL on loopback and checks the mandatory cases (free baseline, Fuerza, other fee, unpaid, expired contract, suspension and lift, revoked link, expired and reused SSO code, Platform outage, expired cache, direct API access, preserved users and history), plus a smoke stack for manual browser checks. No product code on this branch.

## Out of scope
Anything in production, real credentials or data, WebAuthn ceremonies, merges, deployments.

## Done criteria
All cases green on two consecutive runs; no unexpected errors or leaked codes/cookies in the process logs; artefacts removed; independent review recorded; reviewer and QA approvals remain pending until actually performed.
