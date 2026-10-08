# 2J-030 visual evidence

Captured from the local admin web app against an isolated PostgreSQL database with synthetic demo data. The desktop view shows a full week, occupied and available places, and a waitlist count. Tablet uses a compact two-column week; mobile keeps a selectable day strip and shows the selected day's sessions. No real client data is present.

| Width | Evidence |
| ---: | --- |
| 1440 px | [calendar-1440.png](./calendar-1440.png) |
| 768 px | [calendar-768.png](./calendar-768.png) |
| 390 px | [calendar-390.png](./calendar-390.png) |

The screenshots validate layout and read presentation. Reservation and waitlist mutations are covered by PostgreSQL API integration tests using an injected eligibility resolver. The running default configuration intentionally rejects those writes until a real client-plan entitlement source is integrated.
