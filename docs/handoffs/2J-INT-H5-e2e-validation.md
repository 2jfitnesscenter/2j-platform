# 2J-INT-H5 — End-to-end validation of Home + Platform + Búnker (isolated)

## Scope and state

- Repository `2jfitnesscenter/2j-platform`, branch `agent/claude/2J-INT-E2E` (built on `agent/claude/2J-INT-HOME-CONNECTED` `bbc7a3a`, which contains H2 `6c7571e` on `origin/main` `f87818a`). Not pushed, no PR, no merge, no deploy.
- Búnker under test: `2jfitnessapp` branch `agent/claude/2J-INT-BUNKER-CONSUMER` `6141b62` (H3 `1a147f8` + `/sso` landing), base `origin/main` `cbfa050`.
- Everything ran on loopback against a disposable PostgreSQL 17 container and temp data directories. No production system, real data, real secret, DNS, Caddy/Contabo, or external service was touched. Production SHA of Búnker remains **not verified**.

## What ran

`tooling/e2e/training-sso.e2e.mjs` starts **real processes** — Platform (`apps/api/src/server.ts`, as in local development) and Búnker (`server.js`) — with fresh databases/data, seeds eleven linked test people through Platform's own HTTP API (services, plans, clients, sales, payments, persons, suspension routes) plus test-only SQL for pilot credentials and links, completes Búnker's side of the bilateral link through its **real** proof endpoints (passkey-backed issue, Platform-signed exchange), and drives the Home steps (member login, `POST /api/me/training/sso`, destination validation with Home's own function, redeem on Búnker). It includes two real 62-second windows (all cached answers and the 60-second code expire) and a **real outage** (the Platform process is killed and restarted).

Run (from `apps/api`): `E2E_DATABASE_ADMIN_URL=<loopback postgres admin url> E2E_BUNKER_API_DIR=<bunker>/api node --import tsx ../../tooling/e2e/training-sso.e2e.mjs`. A second helper, `tooling/e2e/smoke-stack.mjs`, keeps Platform and the Búnker API up for a manual browser check.

## Mandatory cases — results (two consecutive full runs, 14/14 each)

| # | Case | Result | Evidence |
|---|---|---|---|
| 1 | No fee: free capabilities | pass | sso session: history yes; guided, Premium, AI, professional follow-up denied (`FREE_BASELINE`) |
| 2 | Fuerza active | pass | all five probes allowed |
| 3 | Other active fee | pass | guided + Premium allowed; AI and professional follow-up denied |
| 4 | Unpaid | pass | back to the free baseline; account untouched |
| 5 | Expired contract | pass | back to the free baseline |
| 6 | Administrative suspension | pass | Platform refuses new codes (403 `training_access_suspended`); after the cache window Búnker answers `platform_access_blocked` / `ADMIN_SUSPENDED` on every probe |
| 7 | Suspension lifted | pass | after recovery the free baseline returns; the persisted restriction is cleared; both events recorded on Platform |
| 8 | Link revoked | pass | new codes refused (409 `TRAINING_LINK_REVOKED`); the sso session is closed (401) while the account's own passkey login still works |
| 9 | Expired SSO code | pass | redeem after 62 s → `sso_code_invalid`; row finalised `expired` |
| 10 | Reused SSO code | pass | three parallel redemptions: exactly one 200; a later replay refused; a fresh code works |
| 11 | Platform down | pass | real process outage: cached answer used inside its TTL; known suspension keeps blocking; new SSO → 503; passkey login unaffected |
| 12 | Expired cache | pass | after the TTL with Platform still down: free functions kept, **Fuerza falls to baseline** (paid rights are never granted without verification); an unverified lift is not assumed; recovery restores Fuerza |
| 13 | Direct API access without authorization | pass | no/forged cookies → 401; sso session on admin/trainer/passkey/delete/export/logout-all routes → 403 `passkey_required`; non-admin cannot set modes; cross-origin redeem 403; Platform: no/forged member session 401, CSRF origin 403, unsigned/wrong-secret/replayed service requests 401 |
| 14 | Users and history preserved | pass | every account, routine and workout record intact after suspension, revocation, outage and SSO; no account created, merged or removed; PostgreSQL and Training counts match; audit holds issued 14 / redeemed 13 / rejected 4 |
| – | Modes | pass | legacy keeps today's access with no Platform call; shadow never blocks (divergences logged); enforced applies the contract to a passkey session too; legacy→enforced refused |

Logs and the report contain no codes or cookies (checked).

## Real-browser smoke (built-in browser, one pass)

Home on `127.0.0.1:5173` (flags on, local only) → test member login → Búnker destination shows "Abrir Búnker" plus "Abrir con tu acceso habitual" → click → the tab lands on Búnker's `/sso`, redeems, reloads and opens the app as *María* with `authLevel: sso`, `admin/trainer: false`, her **historical routine visible**, `GET /api/data` 200, `GET /api/guided` 403 `FREE_BASELINE`, `GET /api/me/passkeys` 403 `passkey_required`, and a clean URL. Checked only for the free persona.

## Small change made for this validation

`apps/client-app` can now take the Training URL from `VITE_2J_TRAINING_URL` (https or loopback only; the demo never has one; anything else falls back to production), with a test (21/21 client tests). Without it no non-production environment could exercise the flow.

## Not covered / limitations (be explicit)

- WebAuthn ceremonies were **not** exercised; passkey sessions were forged with the test secret. Platform's production credential is still the test-only `platform-pilot`; the Platform passkey RP ID is unverified.
- On Platform the link was inserted as an `explicit_admin` link (SQL); the Platform-side link transaction/lifecycle was **not** run end-to-end (the main entrypoint does not enable it by env). Búnker's side did use its real proof endpoints.
- The kiosk (PIN) check-in gate is covered by unit-level tests only; `routineCreation` (commercial) has no distinct route and is not enforced; provisioning and ACK messages are not implemented.
- The Home "Búnker conectado" summary panel shows "temporarily unavailable" in this stack because the Platform → Búnker training-summary adapter is not configured there.
- Independent review and QA are **pending**.
