# 2J-095 visual evidence

## Setup and method

Real browser captures were taken from Admin and Trainer Vite sessions backed by a fresh, loopback-only PostgreSQL database containing the deterministic synthetic demo seed. No production data or external services were used. Browser viewport emulation was set to the exact CSS viewport dimensions shown below; screenshots are unscaled JPEG captures from the browser. The capture surface returns raster sizes 1425×891, 753×1004, and 375×812 for the configured CSS viewports 1440×900, 768×1024, and 390×844. CSS layout and overflow checks were evaluated at the configured viewport sizes.

The existing token mechanism is `data-theme="dark"` on the document root. For dark QA only, a temporary local Vite entry page set that attribute and loaded the same Admin app entry point and components. The QA entry file was removed after capture; no theme selector or production behavior was added.

## Captures

| Role and theme | Viewport | Capture | Result |
| --- | --- | --- | --- |
| Admin, light | 1440×900 | [admin-1440x900.jpg](./admin-1440x900.jpg) | Agenda is primary; attention and pending items are actionable; finance and team blocks appear for this authorized actor. No horizontal overflow. |
| Admin, light | 768×1024 | [admin-768x1024.jpg](./admin-768x1024.jpg) | Navigation becomes a horizontal scroll row; agenda, attention, and pending stack in order. No horizontal page overflow; agenda remains readable. |
| Admin, light | 390×844 | [admin-390x844.jpg](./admin-390x844.jpg) | Fallback check: stacked content, visible actions, horizontally scrollable navigation. No horizontal page overflow. |
| Trainer, light | 1440×900 | [trainer-1440x900.jpg](./trainer-1440x900.jpg) | Operational summary renders; economics block is absent and the API response has no economics data for Trainer. No horizontal overflow. |
| Trainer, light | 768×1024 | [trainer-768x1024.jpg](./trainer-768x1024.jpg) | Stacked operational blocks and no finance block. No horizontal page overflow. |
| Trainer, light | 390×844 | [trainer-390x844.jpg](./trainer-390x844.jpg) | Fallback spot-check; no horizontal page overflow and no finance block. |
| Admin, dark tokens | 1440×900 | [admin-dark-1440x900.jpg](./admin-dark-1440x900.jpg) | Existing dark token palette applied at runtime; hierarchy, status accents, and focus styles remain legible. |
| Trainer, dark tokens | 1440×900 | [trainer-dark-1440x900.jpg](./trainer-dark-1440x900.jpg) | Same dark token palette; no finance block. |

Browser measurements at 1440, 768, and 390 CSS pixels found `document.documentElement.scrollWidth` below the viewport width in each captured role. The local desktop browser reserves a scrollbar gutter, so reported document widths were 1425, 753, and 375 px respectively against 1440, 768, and 390 px viewports.

## Accessibility observations

- One page-level `h1`, followed by labeled `h2` sections; agenda and work queues use list semantics and capacity metrics use definition lists.
- Session times use `<time>` and are formatted for `Atlantic/Canary`.
- Actionable rows and controls are links/buttons; focus-visible styling is token-based. Loading and error states use status/alert roles, and error offers retry.
- Status text accompanies color markers. No health or training data appears in the summary.

## Scope note

The only shell change fixes the existing medium/narrow responsive cascade: the expanded shell had retained a 220 px desktop rail at tablet/mobile widths, leaving the content clipped. The established six-destination IA remains unchanged; the rail now becomes its existing horizontal navigation layout at those widths.
