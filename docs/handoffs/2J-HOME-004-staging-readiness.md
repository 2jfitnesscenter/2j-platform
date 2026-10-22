# 2J-HOME-004 — Staging readiness handoff

Updated: 2026-10-22

## Verified Git state

- Repository: `2jfitnesscenter/2j-platform`
- Branch: `agent/codex/2J-HOME-004-staging-readiness`
- Base: `origin/main` at `e4b6218f02d24f9c78d7670252d68474cfea2232`
- This handoff describes the local Home-only synthetic demo preparation. No Platform business rules, API contracts, Búnker code, production environment, DNS, Caddy, database, or VPS services were changed.

## Implemented in this worktree

- A dedicated `build:demo` build strips inherited `VITE_*` process variables, uses a temporary empty Vite environment directory, and enables only the synthetic demo flag/build label.
- A build-level demo flag keeps the client on synthetic fixtures without a query parameter and prevents fall-through to Platform API mode.
- The demo labels the UI `DEMO · DATOS FICTICIOS`, hides pilot/staff/admin tools, and removes the production Búnker URL from the demo bundle. Normal authenticated mode retains its existing Búnker link.
- The build script refuses to replace an unmarked `dist-demo` directory and limits cleanup to its own generated output.
- The build fails if the production Búnker hostname appears in the generated JavaScript.
- Added client regression coverage and README instructions. The generated folder is ignored by Git.
- Added an Nginx static image and Compose candidate: pinned Nginx base digest, non-root user, read-only filesystem, in-memory temp space, dropped capabilities, no published port, and one internal Docker network. Only generated `dist-demo` assets are copied. Unknown, API, pilot, auth, operational, staff and admin paths return 404.
- The Nginx demo response has a restrictive Content Security Policy with `connect-src 'self'`; no API or business-service hostname is configured. The internal Docker network has no external route, and the demo container could not resolve the Búnker hostname during isolation verification.
- Compose configuration is for isolated local validation. The existing Caddy/proxy network has not been changed; public access requires a separate approved proxy/network change.
- Corrected the token checker to normalize CRLF to LF before comparing generated output, with a Windows CRLF regression test. The prior failure was a Windows `core.autocrlf` mismatch, not semantic token drift.

## Current verified boundaries

- Existing client-app authenticated mode already consumes Platform `/api/me/*` and `/api/client-portal/*` contracts. This work adds no production authentication or business endpoint.
- Existing 2J-089 training summary is read-only data; it is not an SSO, account-link, or entitlement-enforcement contract.
- Platform has a draft 2J-F1-B period/bag implementation (PR #61), and current client contracts do not yet provide a unified authoritative identity/session, recurrence/payment-period state, or capability view for the future Home screens.
- Platform main's current capabilities contract permits a free autonomous baseline without a paid membership. This conflicts with the owner's stated no-active-membership operational block. Resolve that rule in Platform and align its contract before connecting real users; Home must not infer or override it.
- Platform main has no production central registration/identity provider, user-account linking flow, or Home-to-Búnker SSO. Synthetic local member pilot support is not production identity.
- Búnker main is `a7678b864ca404cb38c13706d780e659c47f214a`. Current code authenticates with its own `gymsid` signed cookie/passkeys and local role checks; it has no Home SSO consumer. Open Búnker PR #55 is a draft design only, not runtime implementation. It proposes a one-time server-redeemed code, explicit account linking, retention of Búnker UIDs/passkeys/data, and server-enforced capabilities. Auth assurance and endpoint contracts still need agreement.
- No automated account migration, SSO, Búnker profile provisioning, or real entitlement test is present in this change.

## Validation

- Client tests: 14/14 passed.
- Design-token tests: 6/6 passed, including CRLF regression.
- Root typecheck: 11/11 tasks passed.
- Root build: 9/9 tasks passed. Client production build and static demo build passed.
- Docker Compose config validated; image built locally as `sha256:7d3964989b1556fefdac7c695b312b9bd5cea7fbe49b816b2aa9f348cbda87ac` from pinned Nginx base digest `sha256:c59d1f8b1e0e42da75be973424cd72e23f7f8adfb54e982f4d1cd0216a5a5576`.
- Nginx config test passed inside the container. Root, manifest, service worker, icon and hashed assets returned 200. `/api`, `/api/me`, `/api/client-portal/profile`, `/pilot/member/login`, `/auth/login`, `/login`, `/register`, `/bookings`, `/payments`, `/admin`, `/staff`, `/training`, `/bunker`, `/profile`, unknown paths and the hidden build marker returned 404.
- Container inspection confirmed UID 101, read-only root, no mounts, no published ports, and one `internal: true` network. The static image contains only the generated app shell/assets and Nginx config; no API/database service or credentials.
- `connect-src 'self'` is present on HTTP responses; the synthetic JavaScript bundle does not contain `app.2jfitnesscenter.com`. External Búnker hostname resolution from the isolated container failed as expected.
- Platform test batch outside the API package: passed (the client, staff, admin and shared-package suites run in this worktree).
- Root typecheck: 11/11 tasks passed.
- API integration suite was not run against any available Docker database. The baseline run requires `DATABASE_URL`; no disposable DB was available, and existing containers were left untouched.
- Repository has no lint script/configuration.
- Browser smoke check used local Vite preview at `http://127.0.0.1:4173/`, with no query parameter. Inicio, booking navigation/disabled synthetic confirmation, Store, Profile, Settings and the disabled Búnker state were inspected. This is browser emulation, not a physical-device test.
- Local PWA assets returned HTTP 200 (root, manifest, service worker, icon). The service worker excludes `/api/`; public hosting must also deny `/api/*` and `/pilot/*` at the server/reverse-proxy layer.

## Staging status and next gates

- `dist-demo` is a reproducible static synthetic candidate. The Nginx image built locally and serves successfully inside its isolated container. No public deployment occurred.
- The currently reachable `https://home.2jfitnesscenter.com` was observed to serve a synthetic but older interface, not this candidate. Public unauthenticated `/api/me`, `/api/pilot/member/login`, and `/pilot/member/login` returned 404 at observation time. Re-check before any approved deployment.
- The local Compose network is internal and the container has no published port or default external access. It has no service credentials, database, API upstream, or production Búnker URL. The browser can test the current static demo at the local Vite preview; the container is inspected internally because no port is exposed.
- The local isolated Compose service has no published port. Its HTTP checks ran inside the container; the UI is reviewable from the local Vite preview at `http://127.0.0.1:4173/`.
- Public staging deployment is **not authorized or performed**. The existing public `home.2jfitnesscenter.com` is not changed. Serving this image publicly requires explicit owner approval for the staging route/network attachment to the reverse proxy, HTTPS route and rollback procedure.
- Before real integration: Platform must settle the free/no-fee entitlement conflict and publish central identity/session, user link, period/payment/recurrence, profile, booking and authorization contracts; Búnker must agree and implement its server-side link redemption, identity provisioning/linking, session issuance/revocation and capability enforcement. Keep production accounts disabled until those are reviewed.
- A GitHub pull request was not opened because repository instructions prohibit provider calls. The branch is prepared for review; no push or merge was performed.
