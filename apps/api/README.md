# 2J API

Fastify API for local service, plan and entitlement configuration. PostgreSQL is the persistent source of truth. Migrations are explicit SQL under `migrations/` and are applied with `pnpm --filter @2j/api db:migrate`.

The API binds to `127.0.0.1` by default. Runtime authentication is not implemented in this first vertical; do not expose this API publicly or deploy it.
