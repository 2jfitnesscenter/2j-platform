# 2J-DESIGN-V2-PILOT-04 — Design System V2 pilot: Servicios + Planes

## Objective
Migrate Espacios y servicios and the plan catalogue to Design System V2 keeping every operation (create, edit/version, activate), validation, price rule and permission, without implementing 2J-098E.

## Out of scope / stop conditions
No change to entitlements, plan assignment, payments, RBAC, API, database or migrations. No frontend calculation of sessions, periods or validity. Legacy plan data is displayed as stored and flagged as legacy. Stop and report on any real functional bug or missing critical API.

## Acceptance
Existing and new tests pass; typecheck and build pass; verified in the local pilot; owner decides `VISUAL_APPROVED` and `FUNCTIONAL_APPROVED` (both `no` until then). Handoff: `docs/handoffs/2J-DESIGN-V2-PILOT-04.md`.
