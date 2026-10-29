# Handoff: Platform row 21 API review

Snapshot audited: `origin/main` at `abd31b89ffc2ce64c9fae167f2226267234b2348`.

## Available on main

- **Center news:** `GET /api/admin/news`, `POST /api/admin/news`, `PATCH /api/admin/news/:newsId`, `POST /api/admin/news/:newsId/{publish,withdraw,feature,unfeature}`, `GET /api/admin/news/:newsId/audit`, and member-facing `GET /api/me/news`. Staff reads require `news.read`; mutations require `news.manage`. Changes are audited in `center_news_audit_events`. Tests: `apps/api/test/center-news.test.mjs`.
- **Consent templates:** `GET /api/consents` and `GET /api/consents/:consentId/versions` are added in this branch with `consents.read`, SQL-side status/name/required filters, bounded pagination, and no-store responses. The existing `POST /api/consents`, `POST /api/consents/:consentId/versions`, `POST /api/consents/:consentId/activate`, and `POST /api/consents/:consentId/archive` provide the audited mutations. Acceptance history preserves the accepted content snapshot/hash. Client and staff acceptance routes exist, including assisted acceptance. Tests are in `apps/api/test/communications.test.mjs`.
- **Settings read model:** `GET /api/settings/overview` exposes the existing payment settings, permission profiles and integration booleans to `settings.manage`; it is deliberately read-only. Existing economic mutations are under `/api/economics/settings` and cover only payment settings, not a general business profile.

## Exact remaining gap

The row-21 “Datos del negocio” write API has no agreed field contract or corresponding general business-profile model/table on this main snapshot. The prototype/reference says “Datos del negocio” but does not establish which fields Platform should own. Implementing a guessed profile or adding a second opening-hours source would be unsafe. Owner-approved opening hours are already scoped by A45 in open PR #124; do not introduce a second source of truth. Consent template reads were the only confirmed API gap implemented here.

Open PR #124 (`codex/2J-A45-center-hours-staff-shifts`, head `0f516edab22f051ab34fff77be02562b539719c7`) already proposes the owner-editable center opening-hours model and API under A45. Its migration is `0053_center_hours_staff_shifts.sql`; it must remain the sole source for those hours if integrated. This row-21 branch must not duplicate that model/API.

No migration was created. Therefore no migration number was selected and no open-PR migration collision check was needed for this handoff. Business-profile writes remain blocked on an explicit field contract; health questionnaires remain excluded by D33 and fiscal/invoice emission by D106.

## Result

This delta adds only two read APIs for existing consent templates/versions; it does not change the underlying model or acceptance behavior. Center news already exists and was not changed. General business-profile writes remain blocked on an approved field contract; keep A45 opening hours on PR #124. Health questionnaires and fiscal/invoice emission were not touched.

## Validation

- Synthetic PostgreSQL: `communications.test.mjs` + `center-news.test.mjs`, 10/10 pass. The center-news test is regression coverage only; its implementation was unchanged.
- `pnpm --filter @2j/api typecheck`: pass.
- `pnpm --filter @2j/api build`: pass.
- `git diff --check`: pass.
- No migration or production/staging data was changed. Full API suite was not run.
