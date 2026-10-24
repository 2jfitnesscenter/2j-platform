# 2J-DESIGN-V2-PILOT-03 — Design System V2 pilot: Agenda

## Objective
Migrate the professional Agenda to Design System V2 keeping every existing operation, endpoint and permission (presentation only).

## Scope
Day/Week views, navigation, filters, minimal session cards, simultaneous sessions as real cards, session detail (side drawer on desktop, full screen below 1024), responsive behaviour; existing dialogs reskinned.

## Out of scope / stop conditions
No change to booking, cancellation, waitlist, attendance, templates, entitlements, RBAC, API, database or migrations. No new session URL route, configurable time axis, professional pivot or 3-day view. Stop and report on any real functional bug, RBAC loss or booking regression.

## Acceptance
Existing and new tests pass; typecheck and build pass; verified at 1440/1024/768/390; owner decides `VISUAL_APPROVED` and `FUNCTIONAL_APPROVED` (both `no` until then). Handoff: `docs/handoffs/2J-DESIGN-V2-PILOT-03.md`.
