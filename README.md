# 2J Platform

## Local product preview — 2J-010

This first product vertical provides a premium-token-based admin screen for services, plans and access rights, backed by Fastify and PostgreSQL. It is local-only and does not connect to the production training/Búnker application.

Requirements: Node 24, pnpm 10.34.6 or compatible, and Docker Compose.

```powershell
pnpm install --frozen-lockfile
docker compose up -d postgres
$env:DATABASE_URL = 'postgres://2j_local:2j_local_dev_only@127.0.0.1:54329/2j_platform'
pnpm --filter @2j/api db:migrate
pnpm --filter @2j/api dev
```

In another terminal, run `pnpm --filter @2j/admin-web dev` and open the local Vite address shown by the command. The API and UI bind to loopback. No production credentials are needed. Authentication and permissions at the HTTP boundary are not yet implemented, so this preview must not be exposed to a network or deployed.

The local database uses a named Docker volume. `docker compose down` stops the container while retaining its data. No automatic payment, billing, price policy, renewals, client records, bookings, waitlist, training plans or Búnker features are included.
