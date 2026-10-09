# 2J Platform

## Local product preview — clean start

The local admin preview now has a shared Command Center shell over Services, Clients 360, Calendar, Economics, Team and Communications. Inicio and global search are served by permission-filtered PostgreSQL read models. This is local-only and does not connect to the production training/Búnker application.

Requirements: Node 24, pnpm 10.34.6 or compatible, and Docker.

```powershell
pnpm install --frozen-lockfile
docker run --rm -d --name 2j-local-db -e POSTGRES_USER=2j_local -e POSTGRES_PASSWORD=2j_local_dev_only -e POSTGRES_DB=2j_platform_local -p 55434:5432 postgres:17-alpine
$env:DATABASE_URL = 'postgres://2j_local:2j_local_dev_only@127.0.0.1:55434/2j_platform_local'
$env:NODE_ENV = 'development'
pnpm --filter @2j/api db:migrate
$env:LOCAL_DEMO_ROLE = 'admin'
pnpm --filter @2j/api dev
```

In another terminal, from the same repository, run `pnpm --filter @2j/admin-web dev` and open `http://127.0.0.1:5173/#home`. The API and UI bind to loopback. This local demo profile is a development-only shortcut, not production authentication. No production credentials are needed. Change `LOCAL_DEMO_ROLE` to `trainer`, `reception-management` or `accountant` and restart the API to inspect each role's permission-filtered view.

The quickstart creates an empty operational dataset; migrations add only the minimum structural catalog required by the platform. No clients, sessions, reservations, messages, charges or professionals are inserted. To inspect synthetic examples, create a separate disposable database named `2j_demo`, point `DATABASE_URL` to it and explicitly run `pnpm seed:demo`. That additive seed is rejected unless the environment is `development` or `test`, the database host is loopback, and the database is exactly `2j_demo`. It never deletes or updates rows. To reset only that disposable demo, stop its container and recreate it. Never point the demo seed at `2j_platform_local` or real data.

Inicio is an operational “today at the center” agenda with current sessions, occupancy, free places and waitlist counts. Calendar’s “Configurar horarios” creates multiple recurring templates in one validated transaction; templates remain separate from sessions and never generate occurrences automatically. The app does not connect to production data, nor duplicate training/Búnker/Health.
