# 2J-DESIGN-V2-PILOT-01 — Design System V2 visual pilot: professional shell + Resumen

## Objective
First real, incremental application of the approved Design System V2 (docs/design/) so the product owner can open the pilot, judge it in the browser and approve it screen by screen. Not a global redesign.

## Scope
- V2 token layer in `packages/design-tokens` (single source, no second palette, one brand green `#73b52e`), scoped with `data-2j-design="v2"`.
- Inter self-hosted (DD-05) and Lucide as the only icon library (DD-04) for the touched components.
- `@2j/ui` base components: Button (+ IconButton), Card, StatusChip, PageHeader (+ Icon primitive).
- Professional shell V2 (graphite sidebar, green active indicator, rail/drawer responsive behaviour) and Resumen V2 (attention first).

## Out of scope / stop conditions
- No Clientes, Cliente 360, Agenda, Servicios, Planes, Tienda or Member work; `staff-app` is not rebuilt (DD-08).
- No booking, cancellation, waitlist, entitlement, membership, payment, RBAC, store, stock, notification, database, migration or API-contract change. No new endpoint.
- No invented data: PP-01 (attention engine), recent activity and session identity (avatar/name/role) are capability pending.
- No deploy to production. Draft PR only; `VISUAL_APPROVED=no` until the owner approves.

## Acceptance
- Tests, typecheck and build pass; token contrast tests cover every documented V2 pair.
- Shell and Resumen verified at 1440, 1024, 768 and 390 px; keyboard, focus and reduced-motion handled.
- Owner opens the local pilot (`pnpm owner:review`) and gives visual feedback; iterate on this same pilot before extending the system.
- Handoff: `docs/handoffs/2J-DESIGN-V2-PILOT-01.md`.
