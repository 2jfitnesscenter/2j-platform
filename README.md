# 2J Platform

## Local product preview — 2J-070

The local admin preview now has a shared Command Center shell over Services, Clients 360, Calendar, Economics, Team and Communications. Inicio and global search are served by permission-filtered PostgreSQL read models. This is local-only and does not connect to the production training/Búnker application.

Requirements: Node 24, pnpm 10.34.6 or compatible, and Docker.

```powershell
pnpm install --frozen-lockfile
docker run --rm -d --name 2j-demo-db -e POSTGRES_USER=2j_local -e POSTGRES_PASSWORD=2j_local_dev_only -e POSTGRES_DB=2j_demo -p 55434:5432 postgres:17-alpine
$env:DATABASE_URL = 'postgres://2j_local:2j_local_dev_only@127.0.0.1:55434/2j_demo'
$env:NODE_ENV = 'development'
pnpm --filter @2j/api db:migrate
pnpm seed:demo
$env:LOCAL_DEMO_ROLE = 'admin'
pnpm --filter @2j/api dev
```

In another terminal, from the same repository, run `pnpm --filter @2j/admin-web dev` and open `http://127.0.0.1:5173/#home`. The API and UI bind to loopback. This local demo profile is a development-only shortcut, not production authentication. No production credentials are needed. Change `LOCAL_DEMO_ROLE` to `trainer`, `reception-management` or `accountant` and restart the API to inspect each role's permission-filtered view.

The demo seed is an explicit, additive operation and is rejected unless the environment is `development` or `test`, the database host is loopback, and the database is exactly `2j_demo`. It creates synthetic `.example.test` people and sample activity; it is safe to run again. It does not delete or update rows. To reset the demo, stop its disposable database with `docker stop 2j-demo-db`, then repeat the commands above to create a fresh database. Do not point the seed at any other database.

The current version shows read-only summaries and links into the existing modules; the quick actions do not create records themselves. It does not connect to production data, nor duplicate training/Búnker/Health. Screenshots at the requested viewports and independent Claude/Antigravity review remain pending for this draft.
