# tooling

Operational scripts for the 2J Platform live here. Product behavior is not implemented in tooling.

## Pilot and release preparation

- `pnpm pilot` starts the synthetic, loopback-only Member/Trainer/Admin pilot. It is the local staging environment; it uses a disposable development database and demo roles.
- `deploy/prepare-admin-pilot-release.ps1 -PrepareOnly` runs the repository gates and creates a signed-by-hash release archive for review. It never connects to a server, changes DNS, runs migrations, or deploys.
- `deploy/admin-release-manifest.mjs` and its tests validate the archive metadata and reject secrets, local data, and any release that is not explicitly marked internal pilot with the fiscal gate closed.

Public staging and production deployment remain disabled. The API executable currently accepts only loopback binding, and its demo-role authentication is development-only. Do not expose it through a public hostname until a server-suitable staff authentication path has passed independent security review. See `docs/runbooks/admin-pilot-deploy.md` for the verified boundary and infrastructure requirements to approve later.
