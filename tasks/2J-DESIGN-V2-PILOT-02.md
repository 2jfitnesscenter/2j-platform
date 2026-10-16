# 2J-DESIGN-V2-PILOT-02 — Design System V2 pilot: Clientes + Cliente 360

## Objective
Migrate the presentation of Clientes and Cliente 360 to Design System V2 while preserving every existing operation, endpoint and permission, so the owner can test real management (not a static demo) and approve it before the system is extended.

## Scope
- List: PageHeader, search, status filter, rows, empty/loading/error, load more.
- Cliente 360 as a page: header, real key facts, tabs backed by real sections, action weights (primary / secondary / tertiary / danger), existing dialogs restyled.
- New `@2j/ui` pieces only as needed: Tabs, SearchField, SegmentedControl, EmptyState, danger Button variants, modal and form styling.

## Out of scope / stop conditions
- No change to booking, cancellation, waitlist, memberships, entitlements, payments, RBAC, store, stock, notifications, API contracts, database or migrations. A real pre-existing bug that blocks testing is reported, never fixed silently.
- No invented data or actions: PP-01/PP-06 engine, PP-02 "Vista del cliente", Compras, notes, activity and a Datos tab are not built (no backend or deliberate PII minimization).
- No Agenda, Servicios, Planes, Tienda or Member work until PILOT-02 is approved.
- No deploy to production. Draft PR only.

## Acceptance
- Tests, typecheck and build pass; permissions tested for Admin-like and Trainer-like profiles.
- Verified at 1440, 1024, 768 and 390 px in the local owner-review pilot (Admin and Trainer).
- Owner follows `docs/handoffs/2J-DESIGN-V2-PILOT-02-manual-test.md` and decides `VISUAL_APPROVED` and `FUNCTIONAL_APPROVED` separately (both `no` until then).
- Handoff: `docs/handoffs/2J-DESIGN-V2-PILOT-02.md`.
