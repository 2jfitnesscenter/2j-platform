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
- The demo labels the UI `DEMO · DATOS FICTICIOS`, hides pilot/staff/admin tools, and does not link to the production Búnker app. Normal authenticated mode retains its existing Búnker link.
- The build script refuses to replace an unmarked `dist-demo` directory and limits cleanup to its own generated output.
- Added client regression coverage and README instructions. The generated folder is ignored by Git.

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
- Client TypeScript check: passed.
- Client production build: passed.
- Static demo build: passed, including repeat build through its owned-output marker.
- Platform test batch outside the API package: passed (the client, staff, admin and shared-package suites run in this worktree).
- Root typecheck: 11/11 tasks passed.
- Root build: blocked by the existing `packages/design-tokens/tokens.css` stale check (`tokens.css is stale; regenerate from tokens.json`). No token files were changed as unrelated to Home's staging isolation.
- API integration suite was not run against any available Docker database. The baseline run requires `DATABASE_URL`; no disposable DB was available, and existing containers were left untouched.
- Repository has no lint script/configuration.
- Browser smoke check used local Vite preview at `http://127.0.0.1:4173/`, with no query parameter. Inicio, booking navigation/disabled synthetic confirmation, Store, Profile, Settings and the disabled Búnker state were inspected. This is browser emulation, not a physical-device test.
- Local PWA assets returned HTTP 200 (root, manifest, service worker, icon). The service worker excludes `/api/`; public hosting must also deny `/api/*` and `/pilot/*` at the server/reverse-proxy layer.

## Staging status and next gates

- `dist-demo` is a reproducible static synthetic candidate. This work did not deploy it and does not certify any host configuration.
- The currently reachable `https://home.2jfitnesscenter.com` was observed to serve a synthetic but older interface, not this candidate. Public unauthenticated `/api/me`, `/api/pilot/member/login`, and `/pilot/member/login` returned 404 at observation time. Re-check before any approved deployment.
- A staging host should serve only `dist-demo`, with server-side denials for `/api/*` and `/pilot/*`, no API/database connectivity, and an explicit synthetic-data banner. Production Búnker must remain an external dependency and inaccessible from the synthetic demo.
- Before real integration: Platform must settle the free/no-fee entitlement conflict and publish central identity/session, user link, period/payment/recurrence, profile, booking and authorization contracts; Búnker must agree and implement its server-side link redemption, identity provisioning/linking, session issuance/revocation and capability enforcement. Keep production accounts disabled until those are reviewed.
- A GitHub pull request was not opened because repository instructions prohibit provider calls. The branch is prepared for review; no push or merge was performed.
