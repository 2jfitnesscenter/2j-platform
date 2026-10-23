# 2J-INT-CLOSURE — Security closure report

Branches: Platform `agent/claude/2J-INT-CLOSURE` (PRs 2j-platform#64–#67) and Búnker `agent/claude/2J-INT-BUNKER-CLOSURE` (PRs 2jfitnessapp#56–#57). Everything local and isolated; no merge, deploy, DNS, real migration or flag activation.

## Independence of this review

**This review was performed by the same agent that implemented the code. It is NOT an independent review.** It closes the two limitations raised after the previous report (no tests were executed; Búnker had not been reviewed from an updated diff). The human or external security review, and QA with real devices, remain **pending** and are listed at the end.

## 1. Diff re-read

Re-read with a security lens in this pass (current code, not summaries): Búnker `platform-sso/index.js` (gate, redeem, enforcement, `authorizeStateWrite`), `link.js`, `state-policy.js`, `route-policy.js`, `lib/sync.js`, `lib/state-store.js`, the HTTP dispatcher in `server.js`, `bunker/routes.js` writers, `bunker/rate-limit.js`; Platform `training-sso.ts`, `training-link-flow.ts`, `platform-passkeys.ts`, `member-pilot-auth.ts`, the `server.ts` wiring and migrations `0040`/`0041`. Not re-audited line by line in this pass: the Home client, the E2E tooling and the earlier unrelated Home visual commits that ride in the stack.

## 2. Every route that writes member state (Búnker)

Full table, with one negative test per route: `docs/security/2J-INT-CLOSURE-security-closure.md` in the Búnker branch. Summary: `POST /api/sync` (save/replace/reset/delete), `PUT /api/data`, `POST /api/workouts/delete`, `POST /api/active/{activity,clear,finish-inactive}`, `POST /api/bunker/{handoff,finish}`, 12 staff writers (`/api/admin/user/*`, `/api/trainer/*`), plus the Coach/Premium/Opposition/follow-up families. Only `sync` and `PUT /api/data` accept a whole state, and both go through `authorizeStateWrite`; all others write one narrow field and ignore extra commercial fields (tested); staff writers refuse members with both session types.

## 3. Findings and corrections

| # | Finding | Severity | Fix | Evidence |
|---|---|---|---|---|
| 1 | `authorizeStateWrite` coerced an array/scalar `state` to `{}`, so `POST /api/sync` `save` with `state: []` skipped `mutate`'s validation and could be stored as an empty state (destructive for the caller's own non-list data). `PUT /api/data` also accepted arrays. | Medium (own-data integrity, found by the new negative test) | Arrays are passed through to the validators; sync answers 400; PUT answers 400 for arrays | test "a non-object state is rejected…" (was failing before the fix) |
| 2 | An RP ID of the registrable parent (`2jfitnesscenter.com`) was accepted for `home.2jfitnesscenter.com`, which would widen every credential to all sibling subdomains and cannot be narrowed later. | Medium (configuration hazard) | The RP ID must equal the member-origin host exactly | test "effective RP ID is the exact Home host…" |
| 3 | Platform had no way to trust a proxy safely: behind Caddy all clients would share one limiter bucket and the cookie would not be `Secure`. | Low/Medium (operational) | `PLATFORM_TRUSTED_PROXIES`: explicit addresses/narrow CIDRs only, default none | test "trusted proxies are explicit and narrow…" |
| 4 | Provisioning could be switched on in any `NODE_ENV`. | Low (defence in depth) | Server refuses `TRAINING_PROVISIONING_ENABLED` unless NODE_ENV is development/test | test "provisioning is not on by default…" |
| 5 | `.env.example` lacked the new flags (so their OFF default was undocumented). | Info | Added, all `false`/empty | `apps/api/.env.example` |

No bypass of `authorizeStateWrite` was found: path variants (`/api/data/`, `//api/data`, encoded dots, query, lowercase method) 404 or are refused; unknown sync types 400; `PUT` is 409 once Sync V2 is on; blocked accounts get 403 on every writer.

## 4. RP ID (`home.2jfitnesscenter.com`)

- Effective RP ID = the exact host of the configured member origin (`PLATFORM_PASSKEY_RP_ID` must equal it; parent, TLD, sibling, trailing-dot, IP and missing values are refused at start-up).
- Today the Platform server only accepts **loopback** member origins, and passkeys are refused outside development/test, so `home.2jfitnesscenter.com` cannot be configured at all in this branch: a production rollout needs a reviewed code change that lifts both guards.
- Each stored credential records its `rp_id`; a mismatch never logs in (tested by altering the column with the protection trigger disabled in the test).
- Búnker's `RP_ID`, `ORIGIN`, WebAuthn routes and credential storage are untouched (`git diff` against `main` contains none of them).

## 5. IP limits behind the proxy

See `docs/runbooks/2J-INT-proxy-and-rate-limits.md` (documentation only, nothing applied). Key points: Platform trusts no proxy by default; Búnker believes the first `X-Forwarded-For` hop from a private peer, which is safe only if Caddy overwrites the header (`header_up X-Forwarded-For {remote_host}`); never `trusted_proxies` on the public edge; verification steps included. A Búnker contract test pins the behaviour.

## 6. Provisioning is not available to real users

- Off by default on both sides (`TRAINING_PROVISIONING_ENABLED` / `PLATFORM_PROVISIONING_ENABLED` = `false` in both `.env.example`); no code path calls it except the administrator route.
- Platform refuses to start with it enabled outside development/test; the route requires `identity.people.manage` (trainer 403, anonymous 401); no member route exists (404 variants tested).
- Búnker's endpoint additionally needs the flag and a valid single-use Platform signature, and creates no credentials.

## 7. Tests executed (final state of both branches)

| Suite | Result |
|---|---|
| Platform workspace (`pnpm test`) | all packages pass; API **269/269** on a clean PostgreSQL |
| Platform `pnpm typecheck` / `pnpm build` | 11/11 / 9/9 |
| Búnker API (`npm test`) | 870 tests, **823 pass, 0 fail**, 47 skipped (pre-existing) |
| Búnker frontend (vitest) | 1865/1865 |
| E2E SSO and capabilities (real Platform + Búnker processes) | 15/15 |
| E2E link lifecycle / provisioning | 8/8 |
| New in this pass | 7 Búnker platform-sso tests (state-writing routes, staff writers, non-object state), 1 Búnker proxy contract test, 3 Platform tests (RP ID, trusted proxies, provisioning defaults) |

## 8. Residual risks

- ~~Kiosk bearer tokens (4 h) survive a suspension~~ → **resolved in the follow-up (section 10)**: re-checked on every use; remaining latency ≤ 60 s (capability cache). Instant push from Platform is proposed, not built.
- ~~Finishing a workout advances a guided program after the fee ended~~ → **resolved in the follow-up (section 10)**: the workout is recorded, the program is frozen without `guidedTraining`.
- Staff can assign guided programs irrespective of the member's fee (by design).
- Legacy and shadow users are not blocked (by design; enforcement is opt-in per user).
- Rate limiting in Platform is in-memory per process.
- WebAuthn only exercised with a virtual authenticator; no real device, native shell or `assetlinks`.
- Búnker UI for link-proof issuance and admin/Home passkey UIs are not built.
- Search for state fields beyond `premium`, `opposition`, `coach` and `source: 'guided-v2'` programs found none that carry paid content, but the list is maintained by hand in `state-policy.js`; a new paid feature must add its subtree there (the route-classification test does not cover state keys).
- Production Búnker SHA unverified; no production environment, DNS or Caddy was inspected.

## 9. Still pending (cannot be completed by the implementing agent)

1. **Independent human/external security review** of: `link.js` activation/anti-takeover rules, migrations `0040`/`0041`, the passkey ceremony and RP ID decision, `state-policy.js`, the signed service client, and this report's conclusions.
2. **QA with real devices** (iOS/Android browsers, native shell if used) on a staging copy.
3. Reviewer approvals on the six PRs, and an explicit owner decision before any flag, Caddy change or deployment.

Status: `validated_locally_by_implementer_pending_independent_review`.

## 10. Follow-up pass (kiosk, guided programs, proxy trust, reviewer package)

Same caveat: implemented and tested by the implementing agent; **not** independent.

| Topic | Change | Evidence |
|---|---|---|
| Suspension and kiosk | Kiosk token routes (`session`, `active`, `rest`, `finish`) re-check the Platform gate on every use (`readKioskMember`): blocked account → 403 `capability_required`, room presence ends, in-progress workout kept (the server inactivity sweep still closes it into history). Legacy/staff: no Platform call, no change. Existing tokens and the token format are unchanged; lifting restores the same token. Latency ≤ 60 s. | Búnker tests "kiosk tokens are re-checked on every use…", "legacy members never call Platform from the kiosk…" |
| Guided programs | Separation of *conservation* (program, history, workouts: always kept) from *use* (closing/advancing the program: needs `guidedTraining`, the same right sync already requires). Finish always records the workout; without the right the program is frozen and the answer carries `guidedProgress: 'frozen'`. | Búnker test "finishing a workout of a guided program records it for everyone…" |
| X-Forwarded-For | A private address is not proof of a proxy. New optional `TRUSTED_PROXIES` (Búnker): only listed peers are believed, client = rightmost non-proxy hop; wide/malformed values stop start-up. Default unchanged (legacy rule) so nothing moves by itself. Runbook now lists exact configuration and eight pre-production tests. | Búnker `bunker-rate-limit.test.js`; runbook |
| Reviewer package | `docs/review/2J-INT-CLOSURE/` (README with PR order and SHAs, CONTRACTS, MIGRATIONS, ROUTE-MATRIX (generated), CHECKLISTS with acceptance/rejection criteria). | — |

Final results after this pass: Platform API 269/269 (unchanged code); Búnker API 874 tests, 827 pass, 0 fail, 47 skipped; Búnker frontend 1865/1865; E2E 15/15 and 8/8.

## 11. Architect's review pass (H1–H16)

See `docs/review/2J-INT-CLOSURE/STATUS-H1-H16.md` for the table with evidence and tests. Summary of final numbers: Platform API 269/269; Búnker API 885 tests, 838 pass, 0 fail, 47 skipped (the same 47 as `main`); frontend 1867/1867; E2E 15/15 and 9/9; legacy differential 62/63 identical (1 intentional); kiosk suspension latency 8/8 blocked, p50 19.2 s, max 39.7 s. Still the implementer's own pass: **not independent**.
