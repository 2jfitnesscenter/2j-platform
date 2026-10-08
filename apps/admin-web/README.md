# 2J Admin Web

Local-first administrative interface for services/plans/rights, Clients 360, and weekly calendar operations. The calendar uses the shared 2J design tokens and reads/writes through the PostgreSQL API.

Run `pnpm dev` from this workspace after starting the API and local PostgreSQL described in the root README. The Vite server binds to loopback. The current application has no production sign-in; keep API and browser local-only, and do not expose or deploy this preview.

The weekly view uses Atlantic/Canary time. It supports punctual sessions, manually generated occurrences from distinct recurring templates, staff reservations, cancellation, attendance, and waitlist entry/withdrawal. It does not apply late-cancel or no-show penalties and never promotes waitlisted clients automatically. The API fails closed on booking/waitlist until a server-side entitlement resolver is connected.
