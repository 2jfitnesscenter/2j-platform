# 2J Platform

## Local product preview — clean start

### One-command local pilot (Windows)

Start Docker Desktop and run this from the repository root:

```powershell
pnpm pilot
```

On first run, the launcher installs the locked workspace dependencies automatically. It then prepares a dedicated local PostgreSQL container/database (`2j-platform-079b-pilot`, database `2j_demo`), applies migrations, and safely adds the repository's synthetic demo records. It starts the member fixture preview, Trainer workspace/API and Admin workspace/API together. Open the printed member, Trainer and Admin URLs; the member preview URL includes the required `?preview=1` opt-in. `pnpm pilot:stop` stops only the five app/API processes created by the launcher. The disposable synthetic database is retained between launches so the owner does not need to reseed it manually.

All web and API processes bind to `127.0.0.1`. Trainer and Admin use distinct API processes and process-local development roles, while sharing only the isolated synthetic database. The member surface uses fictional fixture data and does not call the API. If a preferred web/API port is already occupied, the launcher selects and prints a free loopback port; it never kills an unrelated process. PostgreSQL uses a dedicated port and named volume and fails clearly if that port is occupied. Existing local databases and containers are not reused or modified.

This harness is local development only. It does not configure real authentication, production credentials, deployment, DNS, TLS, Cloudflare, or Training. The Training app remains `https://app.2jfitnesscenter.com`. Never put real member data in the synthetic pilot database.

See [the 2J-079B handoff](docs/handoffs/2J-079B.md) for topology, safeguards and verification notes.

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
