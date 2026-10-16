# @2j/ui

Shared React components that consume `@2j/design-tokens`. They need an ancestor with `data-2j-design="v2"` until the V2 token layer moves to `:root` (see `docs/handoffs/2J-DESIGN-V2-PILOT-01.md`).

Implemented (PILOT-01): `Button`, `IconButton`, `Card` / `CardHeader`, `StatusChip`, `PageHeader`, and the `Icon` primitive. `icons.ts` is the single Lucide surface apps import from (DD-04).

Import the styles once: `import '@2j/ui/ui.css'`. Components ship no data access.

The visual contract and states live in [`docs/design/2J-DESIGN-SYSTEM-V2.md`](../../docs/design/2J-DESIGN-SYSTEM-V2.md) and [`docs/design-system/foundation.md`](../../docs/design-system/foundation.md). Add components only in a scoped TASK, as screens adopt V2.
