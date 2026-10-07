# 2J design system foundation

## Brand and visual language

The accent pair (`#73b52e`, `#578923`) is sampled from the existing 2J client app, preserving brand continuity. Neutral surfaces and status colors are semantic and tested for readable contrast. Product research remains the authority for any brand or UX decision; these tokens establish implementation names and accessible starting values, not a new product direction.

The package exports both light and dark palettes. It intentionally does not select a product-wide default theme. Each application shell can choose its approved default and preference behavior. System font stacks avoid an external font fetch or licensing dependency.

## Density and layout

- Desktop may show operationally useful density through consistent row heights, alignment, and restrained dividers; details can expand on demand.
- Mobile and tablet controls need comfortable touch targets (minimum 44 CSS px for primary interactive targets) and must not inherit dense desktop tables unchanged.
- Dashboard information follows the approved 3–5 priority block limit; the page should show the next action without competing cards.
- Cards use surface hierarchy and spacing before adding borders or shadows. Elevation is reserved for overlays and deliberate focus.

## Component contracts

| Component | Required states and behavior |
|---|---|
| Button | primary, secondary, quiet, danger; hover, focus-visible, pressed, disabled, loading; one primary action per region |
| Input / select | label, hint, error association, required state, keyboard operation, visible focus |
| Card | surface, subtle, interactive; interactive cards disclose affordance and keyboard focus |
| Modal / drawer | labelled title, focus containment/return, Escape where safe, mobile drawer adaptation |
| Tabs | semantic tablist, arrow-key movement, selected state and visible focus |
| Table / list | responsive alternative for small screens, sortable header semantics, no color-only status |
| Badge / status | semantic text/icon plus color; contrast checked on both themes |
| Toast | concise, non-blocking, announced without stealing focus; errors persist until understood |
| Empty state | explains why empty and offers one relevant next action when allowed |
| Skeleton | matches final geometry and does not impersonate actionable content |

## Accessibility and motion

Use semantic HTML, keyboard operability, visible focus, accessible names, and WCAG AA 4.5:1 text contrast for the tested semantic color pairs. `tokens.json` defines the permitted foreground/background combinations: `textOnBrand` is for the primary `brand` surface only; `brandStrong` is not a text surface. Tests verify every permitted pair in light and dark themes. Do not encode meaning by color alone. Respect `prefers-reduced-motion`; tokens expose short durations and do not mandate animation. Loading/error/success feedback must not depend on motion.

## Verification

`packages/design-tokens/tokens.json` is the source. Generated CSS must remain synchronized. Node tests check required token shape, brand preservation, and WCAG contrast for semantic text/status pairs on both themes. Before visual adoption, build reference screens from approved product flows and review them at desktop and mobile widths in a separate TASK; this foundation does not implement app screens.
