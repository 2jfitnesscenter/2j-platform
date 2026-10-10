# 2J Staff App

Mobile-first staff workspace built with React, TypeScript, Vite, Capacitor and the shared 2J design tokens. It has its own `com.2jfitness.staff` application ID and PWA shell.

The app reuses the central staff session and API. `/api/session/capabilities` supplies server-derived navigation/action capabilities; business APIs perform their own permission checks. Private API responses use `no-store` and the service worker excludes `/api/` completely. Only public app shell assets are cached. No role switcher, alternate authentication, local PII store, offline mutation queue, or booking rules are implemented here.

Current V1 flows: permission-aware Home/Agenda, session roster and waitlist view, attendance/no-show changes, client search and compact profile, entitlement read and fixed-price plan assignment (pending charge), existing 2J booking eligibility plus staff reservation/waitlist APIs, inbox and 1:1 text replies when permitted, own timeclock, and a small operational team summary when permitted.

Economics/cash are deliberately not duplicated in this app. Payment collection and cash sessions remain in the existing authorized economy surface pending a focused mobile-safe interaction. No store release, push, geofence, Health, payroll, or advanced admin configuration is included.

Run `pnpm --filter @2j/staff-app dev`, `typecheck`, `test`, and `build` from the repository root. `pnpm --filter @2j/staff-app cap:sync` syncs native projects once Android/iOS platforms have been added by the app build pipeline.
