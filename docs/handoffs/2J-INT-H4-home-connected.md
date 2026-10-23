# 2J-INT-H4 — Home: connected Búnker entry behind a flag

## State

- Repository `2jfitnesscenter/2j-platform`; branch `agent/claude/2J-INT-HOME-CONNECTED`; worktree `C:\Users\juanj\Dev\2J\worktrees\claude\platform\2J-INT-HOME-CONNECTED`.
- Built on the H2 branch (`agent/claude/2J-INT-PLATFORM-IDENTITY` `6c7571e`, base `origin/main` `f87818a`) plus the five Home design commits (graphite / lime `#A4D65E`, synthetic demo build). The Home design branches are also protected on GitHub: `agent/codex/2J-HOME-004-staging-readiness` `0987639`, `agent/codex/2J-HOME-VISUAL-UNIFICATION` `6763cf9`, `agent/claude/2J-INT-HOME-REBASE` `1bc037f`.
- Not pushed (this branch), no PR, no merge, no deploy. Home lives in this monorepo (`apps/client-app`).

## What changed

Only `apps/client-app/src/client-app.tsx` and a new `apps/client-app/test/training-sso.test.mjs`.

- New build flag `VITE_2J_TRAINING_SSO` (**off by default**). With it on, and outside the synthetic demo, the Búnker destination shows an "Abrir Búnker" button that calls `POST /api/me/training/sso` (empty body: Platform derives the person from the member session; Home sends no identity), validates the returned URL and navigates the tab. A secondary "Abrir con tu acceso habitual" link keeps the passkey login available.
- `trainingSsoDestination()` follows a URL only if its origin is the configured Training origin, scheme is https (or loopback http), there are no credentials or query string, and the code is in the fragment (`#code=` + 43–128 URL-safe characters). Anything else is refused and nothing is followed.
- Platform answers are mapped to plain messages without inventing rules: suspended, link not yet confirmed, rate limited, session expired, and a generic "use your usual access" for outages or a disabled feature. Home never decides entitlements.
- The synthetic demo is untouched: `build:demo` strips every `VITE_*` variable, preview mode forces the SSO path off, the demo makes no requests and its bundle does not contain the production Búnker host.
- No reservations, payments or store behaviour changed; they remain as they were.

## Verification (local)

`@2j/client-app` 20/20 (15 existing + 5 new), root typecheck 11/11, `build:demo` OK with the bundle guard. The new tests cover: destination validation (cross-origin, lookalike host, query string, missing/short code, credentials, `javascript:`), flag off (no request, current link kept), flag on (one POST with credentials, empty body, validated navigation), error mapping for 201-bad-destination/403/409/423/503/401 with nothing followed, and the demo never using it. Independent review, QA and a browser/E2E run against real Platform + Búnker are **pending** (H5).

## Open

- Real Home → Platform login is still the test-only `platform-pilot` member session; the Platform passkey credential needs a verified RP ID distinct from Búnker (Búnker's `RP_ID`/`ORIGIN` stay unchanged).
- The flag needs `TRAINING_SSO_ENABLED` and `TRAINING_SSO_REDIRECT_URL` on Platform and `PLATFORM_SSO_ENABLED` plus a Platform client on Búnker; none is enabled anywhere.
- Home shows no capability-based UI yet; the API gates are in Búnker (H3).

## Review fixes (independent code review of this branch)

- The button stays disabled after a successful navigation request (a second tap can no longer mint another one-time code) and re-enables only on failure.
- `trainingSsoDestination` also requires the exact path `/sso` (the only page that redeems a code).
- The SSO flag stays off inside the Capacitor shell, where a same-tab navigation would replace the app with the Training site; there the previous link remains.
- The button is not offered when the Training summary already says the account is not linked (the usual-access link remains); Platform still decides in every other case.
- One `isHttpsOrLoopback` helper backs both URL validators; the navigation hook is a module-level `trainingSsoRuntime.navigate` instead of a test-only component prop; tests use `waitFor`.
- `VITE_2J_TRAINING_URL` (https or loopback only; the demo never has one) now lives on this branch, where the Home change belongs.
- Machine-readable handoff and `tasks/2J-INT-H4.md` added.
- Accepted with justification: the demo bundle still contains the SSO endpoint string (dead code in the demo). The demo cannot reach it: `build:demo` strips every `VITE_*` variable, preview mode forces the feature off (tested: zero requests) and the demo web image answers 404 for `/api/*`. Tree-shaking it out would need a build-time constant that the current `import.meta.env?.` access pattern does not give; revisit if the demo is ever served with an API.

Verification: `@2j/client-app` 23/23, root typecheck 11/11, `build:demo` OK.
