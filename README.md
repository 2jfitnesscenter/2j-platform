# 2J Platform

## Local product preview — clean start

### One-command local pilot (Windows)

Start Docker Desktop and run this from the repository root:

```powershell
pnpm pilot
```

On first run, the launcher installs the locked workspace dependencies automatically. It prepares a dedicated local PostgreSQL container/database (`2j-platform-084-pilot`, database `2j_demo`, port `55440`), applies migrations, and safely adds synthetic demo records. It starts the real-session Member pilot plus the Trainer and Admin workspaces, each with a dedicated API process. Open the printed Member URL to sign in with one of the local-only member codes below; the fixture preview remains available by adding `?preview=1`. `pnpm pilot:stop` stops only the six app/API processes created by the launcher. The synthetic database is retained between launches, and the seed is idempotent.

All web and API processes bind to `127.0.0.1`. Trainer and Admin use distinct API processes and process-local development roles. Member uses its own API process and a database-backed session cookie. The three surfaces share only the isolated synthetic database. If a preferred web/API port is occupied, the launcher selects and prints a free loopback port; it never kills an unrelated process. PostgreSQL uses its own port and named volume and fails clearly if that port is occupied. The earlier `2j-platform-079b-pilot` database remains untouched.

Synthetic Member A is María González (`2j-member-a-local`) and has a 12-session pilot entitlement. Member B is Álvaro Martín (`2j-member-b-local`) and has no entitlement, which makes it easy to verify account separation and eligibility. These codes are public local demo credentials; they are not passwords and must never be used outside this loopback-only pilot. The pilot Member API requires `PILOT_MEMBER_AUTH_ENABLED=true`, `MEMBER_APP_ORIGIN` set to the exact local Member origin, and `NODE_ENV=development`. Session cookies are host-only, HttpOnly, SameSite=Lax, eight hours, and stored as SHA-256 hashes in PostgreSQL.

This harness is local development only. The limited synthetic-member session is not production authentication. It does not configure production credentials, deployment, DNS, TLS, Cloudflare, or Training. The Training app remains `https://app.2jfitnesscenter.com`. Production identity provider, passkey and SSO decisions remain future work. Never put real member data in the synthetic pilot database.

See [the 2J-079B handoff](docs/handoffs/2J-079B.md) for the pilot topology and [the 2J-084 handoff](docs/handoffs/2J-084.md) for the Member session boundary and verification.

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
