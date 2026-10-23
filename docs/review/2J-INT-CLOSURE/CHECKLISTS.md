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

## C. Acceptance criteria (all must hold)

1. Independent security review finds **no** unresolved High/Medium issue in the six PRs (or each has an owner-approved mitigation).
2. All suites in README §4 pass on the reviewer's machine from a clean checkout of the stated SHAs.
3. QA checklist B passes on staging, including real-device WebAuthn if passkeys are to be enabled.
4. Historical Búnker users keep access and data (legacy mode verified before and after).
5. Production plan exists and is separately approved: flags off by default, enforcement per user, rollback path, Caddy/`TRUSTED_PROXIES` configured and tested, secrets in the runtime store.
6. Residual risks 1–10 in the README are each accepted or closed by the owner.

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
