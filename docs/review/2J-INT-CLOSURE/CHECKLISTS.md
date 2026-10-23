# Checklists, acceptance and rejection criteria

Nothing here is ticked. Each box is to be completed by the independent reviewer / QA with evidence. Implementer evidence is only a pointer.

## A. Security checklist (reviewer)

**Authentication and identity**
- [ ] Search for any path that creates or activates a link without Búnker's own evidence or Training's ACK (`link.js`, `training-link-flow.ts`).
- [ ] A leaked Platform→Búnker service key alone cannot take over a historical account (needs the owner's receipt) — try `POST /api/platform/v1/link/activate` with a valid signature and no receipt.
- [ ] One link per person and per Training user holds under concurrency (try parallel activations).
- [ ] Revoked → re-link needs a newer proof; old receipt rejected.
- [ ] SSO code: single use, 60 s, hash-only, bound to person+subject+Training user, re-evaluated at redemption; fragment-only delivery; no code in logs.
- [ ] `authLevel=sso` sessions can never reach passkey-only, staff, deletion/export, passkey-management routes (see `ROUTE-MATRIX.md`; test "an sso session can never reach staff…").
- [ ] Platform passkeys: origin, RP ID, user verification, challenge single use, counter regression, enrollment single use, revocation ends sessions; refused outside dev/test.
- [ ] RP ID equals the exact Home host; the parent domain cannot be configured; Búnker passkeys/`RP_ID`/`ORIGIN` untouched (`git diff main..` shows no change).

**Authorization**
- [ ] H1: with a legacy user, compare passkey and Platform-SSO sessions route by route (`ROUTE-MATRIX.md`): identical rights, no Platform call; with an enforced user, identical decisions for both session types.
- [ ] H2: a suspended enforced account is closed on gated and interactive member routes but keeps recovery, export, deletion, logout, withdrawal actions and news/media/notification reads.
- [ ] H3: open `/sso#code=<another account's code>` in a browser signed in as someone else: no silent switch, the confirmation page names both accounts, the ticket is single-use and browser-bound; decide the no-session residual.
- [ ] H6: stop Platform (degrades to baseline, known suspension still blocks), make it answer 401/403/404 or garbage (enforced users fail closed, legacy untouched), and check the alerts.
- [ ] H10/H11: run `api/scripts/legacy-differential.mjs` against a fresh `main` worktree and read every `[UNEXPECTED]` line (must be none).
- [ ] Every route that writes member state is accounted for (Búnker `docs/security/2J-INT-CLOSURE-security-closure.md`); re-run `grep -rn "writeState\|mutate(\|saveDirect\|saveTrainer" api` and confirm nothing is missing.
- [ ] `authorizeStateWrite` cannot be bypassed: sync types, `PUT /api/data`, path variants, non-object bodies, Sync V2 side door.
- [ ] Free personal routines/workouts/history keep working for a no-fee enforced account; paid subtrees and guided programs are stripped, never erased.
- [ ] Kiosk tokens are re-checked per use; suspension ends the kiosk presence and keeps the in-progress workout; legacy untouched.
- [ ] Guided programs: kept and history intact without the right; not closed/advanced without it.
- [ ] Route table has no `unclassified` entry (test) and the matrix matches your reading of the handlers.

**Data and database**
- [ ] Migrations 0040/0041: run the probes in `MIGRATIONS.md`; review triggers for gaps.
- [ ] All SQL parameterized (`tx.unsafe` only with bound params).
- [ ] No secrets, codes, challenges or cookies in logs (E2E case X1 / L-X1 scan both logs).

**Configuration and operations**
- [ ] Every new flag defaults OFF in code and in both `.env.example` files; provisioning and passkeys refuse non-dev/test environments.
- [ ] `TRUSTED_PROXIES` / `PLATFORM_TRUSTED_PROXIES` semantics match the runbook; wide or malformed values stop start-up.
- [ ] Runbook `docs/runbooks/2J-INT-proxy-and-rate-limits.md` is complete enough to configure Caddy without guessing.

## B. QA checklist (to run on a staging copy with synthetic data; never production)

- [ ] Historical user (legacy): every screen, routines, history, Coach, guided/premium unchanged; kiosk check-in and workout finish work.
- [ ] Link an existing account with its owner's passkey proof; SSO from Home opens Búnker; unlink; relink.
- [ ] Revocation while Búnker is stopped, then started: `revocation_pending` → `revoked`.
- [ ] Free account in `enforced`: create/edit/delete routines, record workouts; guided/premium/coach blocked with the expected messages; consent withdrawal still works.
- [ ] Fee ends mid-program: program and history visible, next guided session not startable, workout still recordable.
- [ ] Suspension: web session, kiosk token and SSO all stop within ≈ 60 s; in-progress workout is not lost; lifting restores access.
- [ ] Platform down: free baseline preserved, paid rights never granted unverified, known suspension still blocks.
- [ ] Passkey registration/login on real iOS/Android/desktop browsers with the real Home host (only possible after a reviewed change lifts the loopback and dev/test guards).
- [ ] Provisioning (staging only, flag on): one profile, retry-safe, first sign-in by recovery link.
- [ ] Proxy tests 1–8 of the runbook from outside the host.
- [ ] Suspension: measure web (passkey), SSO and kiosk latency with timestamps on the real tablet (p50/p95/max) and the outage case; rehearse the emergency local disable (`docs/runbooks/2J-INT-emergency-suspension.md`).
- [ ] Q5/Q6 of the architect's plan: login CSRF with a signed-in victim; legacy-linked user entering through Home.

## C. Acceptance criteria (all must hold)

1. Independent security review finds **no** unresolved High/Medium issue in the six PRs (or each has an owner-approved mitigation).
2. All suites in README §4 pass on the reviewer's machine from a clean checkout of the stated SHAs.
3. QA checklist B passes on staging, including real-device WebAuthn if passkeys are to be enabled.
4. Historical Búnker users keep access and data (legacy mode verified before and after).
5. Production plan exists and is separately approved: flags off by default, enforcement per user, rollback path, Caddy/`TRUSTED_PROXIES` configured and tested, secrets in the runtime store.
6. Residual risks 1–12 and the six owner decisions in the README are each accepted or closed.
7. `STATUS-H1-H16.md` rows are re-verified by the reviewer (not taken on trust).

## D. Rejection criteria (any one blocks approval)

- A link can become active, or a Training account can be linked to a person, without the owner's proof on Búnker's side or without Training's ACK.
- Any state-writing route lets an enforced no-fee account add or change paid content, or erases personal routines/history.
- An `sso` session reaches a passkey-only, staff or destructive route.
- A flag is enabled by default, or provisioning/passkeys can be enabled in a production-like environment.
- Historical (legacy) users lose access or data, or are forced into enforcement.
- Secrets, one-time codes, challenges or cookies appear in logs, URLs (other than the fragment code), audit rows or error bodies.
- The client IP used for limits can be chosen by the caller under the documented configuration.
- Any migration cannot be explained as additive and safe to apply to a copy of production.

## E. Not covered by this package

Real-device WebAuthn, native shells, load/performance, accessibility, the Home visual commits, production infrastructure, backups, and legal/consent texts.

## F. Added in the second pass (final pre-audit decisions) — also unticked

**Security (reviewer)**
- [ ] Browser binding (`BROWSER-BINDING.md`): with a valid code and **no** `j2ssob` cookie the redeem is refused before Platform is called; with a wrong verifier Platform refuses and the code is **not** consumed; the challenge in the DB is immutable (probe in `MIGRATIONS.md` 0042); `/sso/start` cannot be made to redirect anywhere but `PLATFORM_HOME_URL`.
- [ ] Redeem **v1** is really gone (send `{code, audience, purpose}` with a valid signature: must fail), and an old Home build cannot obtain a code (no `challenge`: must fail).
- [ ] Signals (`SIGNALS-PROPOSAL.md`): there is no signal kind that grants; `lifted` never makes the account usable before Platform's own answer; old/duplicate sequence is ignored; unsigned, stale-timestamp and replayed-request-id signals are refused; the signal carries ids only; both flags OFF = no new behaviour; the dispatcher refuses to start outside development/test.
- [ ] Capabilities consumer: run `node api/scripts/compare-capabilities-consumers.mjs`, read the six intended differences, add scenarios of your own to `capabilities-corpus.mjs`; confirm no self-contradicting answer widens access.
- [ ] The Codex consumer branch is untouched; decide which consumer survives (`CONSUMER-COMPARISON.md`).
- [ ] PR hygiene: the Home visual commits are only in #65 (and duplicated on two other branches by identical patches); no commit is lost or duplicated by the merge plan (`PR-DEPENDENCIES.md`); migrations 0039–0043 are free on `main`.
- [ ] Legacy: `api/scripts/legacy-differential.mjs` against a fresh `main` — only the array-body `PUT /api/data` 400 differs.

**QA (real devices):** the whole of `REAL-DEVICE-QA.md` (S1–S18) on staging — not run.

**Known failing test not caused by this work:** `apps/api/test/term-payment-booking.integration.test.mjs` (3 cases from PR #63, already on `main`) hard-codes a session at `2026-10-23T12:00:00Z` and asserts `eligible`/bookable at the real clock; from that instant on it fails with `session_started`. The file is byte-identical to `origin/main`. The reviewer should expect these 3 failures on any run after 2026-10-23T12:00Z (or run with the clock before it) and ask the owner of #63 to make the test clock-independent. It was not modified here.
