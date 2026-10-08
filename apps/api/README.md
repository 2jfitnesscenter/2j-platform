# 2J API

Fastify API for the local services/plans/rights catalog. PostgreSQL is the persistent source of truth. The domain contract and quota semantics live in [`docs/product/services-plans-rights.md`](../../docs/product/services-plans-rights.md).

Apply the checksummed baseline with `pnpm --filter @2j/api db:migrate`. The runner takes a PostgreSQL advisory transaction lock and commits each migration separately. CI requires `DATABASE_URL` and runs migrations twice through the test setup; integration tests fail if PostgreSQL is missing.

The API binds to `127.0.0.1` by default. `HOST` and `CORS_ORIGIN` are validated as loopback-only. Runtime authentication is not implemented in this first vertical; do not expose this API publicly or deploy it.
# Client data and local access

`/api/clients` and `/api/clients/:clientId` return personal data only after the server resolves an authorization context and checks `clients.read`. No role header or browser state is trusted. Creation and archival require `clients.manage`, currently granted only to Admin through the approved wildcard; other role write scopes remain gated. Missing context returns 401 and denied roles return 403.

The standalone API denies client endpoints unless an authorization resolver is supplied. For local-only synthetic development data, set both `NODE_ENV=development` and `LOCAL_DEMO_ROLE=admin` before running `pnpm --filter @2j/api dev`. This creates a fixed server-side demo context and is rejected in every other runtime mode. It is not login or a production identity provider. The listener and CORS origin remain loopback-only. Do not import real client data or expose the API until an approved runtime identity/session provider is integrated.

Search terms are excluded from request logs. Client audit history stores event type, actor ID and timestamp only; it does not copy email, phone, health data, payment data, or documents.

The 360 profile currently owns contact details, active/archive state and create/archive history. Reservations, billing, training, progress, health, documents/forms and messages remain empty module connections. Training/Health remain in the existing 2J Fitness App/Búnker sources; this module does not duplicate them.
