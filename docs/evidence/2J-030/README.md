# 2J-030 visual evidence

Captured from the local admin app against an isolated PostgreSQL database populated only with synthetic demo records. All times use `Atlantic/Canary`. The first three images show the same weekly view at desktop, tablet, and mobile widths.

| Viewport | Evidence |
| ---: | --- |
| 1440 px | [calendar-1440.png](./calendar-1440.png) |
| 768 px | [calendar-768.png](./calendar-768.png) |
| 390 px | [calendar-390.png](./calendar-390.png) |

## Session and eligibility states

| State | Evidence |
| --- | --- |
| Available places | [session-libre-1440.png](./session-libre-1440.png) |
| Full session | [session-completa-1440.png](./session-completa-1440.png) |
| Active waitlist | [session-lista-espera-1440.png](./session-lista-espera-1440.png) |
| Audited over-capacity session (`Sobrecupo +N`) | [session-sobrecupo-1440.png](./session-sobrecupo-1440.png) |
| Individual appointment | [session-individual-1440.png](./session-individual-1440.png) |
| Eligibility blocked by the fail-closed resolver | [session-eligibility-blocked-1440.png](./session-eligibility-blocked-1440.png) |

## Confirmation and runtime states

| State | Evidence |
| --- | --- |
| Cancel a reservation | [confirmation-cancel-reservation-390.png](./confirmation-cancel-reservation-390.png) |
| Cancel a session | [confirmation-cancel-session-1440.png](./confirmation-cancel-session-1440.png) |
| Authorize over-capacity | [confirmation-overbook-390.png](./confirmation-overbook-390.png) |
| Individual-session form with the capacity field removed | [dialog-individual-390.png](./dialog-individual-390.png) |
| Loading week | [state-loading-768.png](./state-loading-768.png) |
| Week load error | [state-error-768.png](./state-error-768.png) |

The eligibility screenshot demonstrates that the default server runtime refuses to reserve when a client's entitlement cannot be verified. API integration tests inject an eligible resolver to exercise reservation, concurrency, waitlist, cancellation, audit, and client-link behavior. Test fixtures never consume or alter a real balance.
