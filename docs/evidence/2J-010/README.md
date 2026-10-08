# Visual QA evidence — 2J-010

Captured from the local Chromium browser against the running API and an isolated PostgreSQL 17 database seeded with eight active services and a recurring draft plan with explicit service access and a targeted session limit. These baseline captures predate the latest neutral-copy adjustment for an access right without a destination.

| CSS viewport | Screenshot | What it shows |
| --- | --- | --- |
| 1440 × 1000 | [desktop-1440.png](desktop-1440.png) | Desktop service table, selected service detail and readable rights. The visible sample plan contains one service. |
| 768 × 1000 | [tablet-768.png](tablet-768.png) | Collapsed horizontal navigation and vertically stacked master/detail panels. |
| 390 × 844 | [mobile-390.png](mobile-390.png) | Compact header, touch-sized controls, service cards and stacked plan detail without a wide table. |

The full-page captures preserve the exact requested viewport width while showing all vertically scrollable content. Separate interactive checks verified first-field focus for both dialogs, Escape closing, and automated tests verify that focus returns to the opener. The plan dialog was also visually inspected at the narrow viewport; it keeps the selected service visible and communicates when that service is still a draft.

Follow-up capture requested by UX re-review is still pending: the multi-service plan, both dialogs at 390 px, and explicit loading, error and empty states. The current three viewport captures remain useful for the page layout but do not claim to cover those scenarios or the latest copy change.
