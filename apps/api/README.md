# 2J API

Fastify API for the local services/plans/rights catalog. PostgreSQL is the persistent source of truth. The domain contract and quota semantics live in [`docs/product/services-plans-rights.md`](../../docs/product/services-plans-rights.md).

Apply the checksummed baseline with `pnpm --filter @2j/api db:migrate`. The runner takes a PostgreSQL advisory transaction lock and commits each migration separately. CI requires `DATABASE_URL` and runs migrations twice through the test setup; integration tests fail if PostgreSQL is missing.

The API binds to `127.0.0.1` by default. `HOST` and `CORS_ORIGIN` are validated as loopback-only. Runtime authentication is not implemented in this first vertical; do not expose this API publicly or deploy it.
