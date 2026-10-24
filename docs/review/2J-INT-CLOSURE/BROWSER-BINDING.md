# Browser-bound Training SSO (decision 3) — closes the H3 residual

Status: implemented and tested in isolated development only; flags OFF; no real account used. **Not independently reviewed.**

## What it prevents
A one-time code was a bearer credential: anyone who got a victim-minted or attacker-minted code into a browser could sign that browser in (login CSRF, forwarded links), even when the browser had no previous session (the case the earlier confirmation step could not cover). Now a code is only redeemable by **the browser that started the flow**.

## Flow (PKCE S256)
1. The member taps "Abrir Búnker" in Home. Home navigates the **same tab** to Búnker `GET /api/platform/v1/sso/start`.
2. Búnker creates 32 random bytes (`verifier`), stores it in the cookie **`j2ssob`** (`HttpOnly`, `SameSite=Lax`, `Path=/api/platform/v1/sso`, `Max-Age=600`, `Secure` on https) and redirects to Home with **only** `#sso_challenge=base64url(SHA-256(verifier))` in the fragment. Nothing is stored on the server; nothing here proves who the person is. The Home URL comes from `PLATFORM_HOME_URL` (https or loopback, origin only); unset → the start page answers a clean error and the legacy entry stays.
3. Home (member session) calls `POST /api/me/training/sso {challenge}`. Platform validates link / suspension / identity as before, stores **only the challenge** with the code (`binding_challenge`, migration **0042**, immutable) and returns the redirect `…/sso#code=…`. Home follows it only if origin + path + fragment shape validate.
4. Búnker `/sso` reads the code from the fragment, clears it from the URL, and calls `POST /api/platform/v1/sso/redeem {code}`. Búnker reads `j2ssob`, and sends Platform (server to server, signed) the **redeem request v2**: `{v:2, code, verifier, audience, purpose}`. Platform recomputes `SHA-256(verifier)` and compares in constant time to the stored challenge.
5. On success the code is consumed and Búnker clears `j2ssob`. **A wrong or missing verifier never consumes the code** and is audited, so an attacker cannot burn a victim's code and a victim cannot be locked out by a probing attacker.

Failure semantics in Búnker: no cookie → `400 sso_binding_missing` (the code is **not even sent** to Platform); mismatch → `400 sso_binding_mismatch`; both count towards the per-IP limiter; Platform down → retryable `503` and the cookie stays. The landing page says "Este enlace no se inició en este navegador… Empieza desde aquí" with a way to restart.

## Contract changes (shared Platform ↔ Búnker ↔ Home — both consumers verified)
| Surface | Before | Now |
|---|---|---|
| Home → Platform issue | `POST /api/me/training/sso {}` | `{challenge}` required (43 base64url chars) |
| Platform → Búnker redirect | `…/sso#code=` | unchanged shape |
| Búnker → Platform redeem | v1 `{code, audience, purpose}` | **v2** `{v:2, code, verifier, audience, purpose}`; v1 is refused |
| DB | — | `binding_challenge char(43)` NOT NULL for new rows (insert guard), immutable; **0042** |
| Búnker env | — | `PLATFORM_HOME_URL` |

**Incompatibility by design:** a Búnker or Home build from before this change cannot complete an SSO against a Platform with 0042 (and vice versa). Because SSO is OFF everywhere, nothing live is affected; for any future activation the three components must be deployed as a set. Verified consumers: Platform (15 SSO API tests), Home (14 tests + 29 total), Búnker (SSO suite incl. the binding tests; frontend 1875), E2E SSO 16/16, E2E link 9/9, and a real browser run (below).

## Evidence
- **Platform** `training-sso.test.mjs` (15): challenge required and only the challenge stored; wrong/missing/foreign verifier never succeeds nor burns the code; login CSRF (attacker-bound code vs the victim's verifier); immutability; concurrent redemption has one winner and a wrong verifier never wins.
- **Búnker** `platform-sso.test.js`: start sets the cookie and sends only the challenge; no cookie → refused before calling Platform; mismatch audited; cookie cleared after success; expiry (Max-Age) and reuse; another account's session is not replaced silently (H3 confirmation still applies on top); legacy users keep the old entry.
- **E2E (real processes)** `training-sso.e2e.mjs` 16 cases, incl. **10b: login CSRF with no prior session** — the browser without the cookie gets 400 and no session.
- **Real browser, 2026-10-23** (built-in browser pane, local stack: Platform 3100, Búnker API 4301, Búnker web 4300, Home 5173, throwaway DB, test-only member codes; **no real account**): (a) Home → *Abrir Búnker* → navigated to `/api/platform/v1/sso/start` → Home → `/sso` → `POST /sso/redeem 200` → Búnker home as the linked demo member; `document.cookie` empty (cookies HttpOnly), URL fragment cleared (`#/home`), `/api/me` 200. (b) After logging out, a code minted for an attacker-chosen challenge was opened in that browser (no `j2ssob`): landing shows the "no se inició en este navegador" message, `/api/me` stays **401**, the fragment is gone. Two harness mistakes on the way (Home built without the SSO flag opened the production URL in a new tab — blocked by the pane and unrelated to Búnker; the Búnker dev proxy pointed at the wrong port) are not product defects.

## What still needs a real browser / device (not done)
Safari/iOS ITP and cookie behaviour on the cross-site top-level navigation (`SameSite=Lax` is sent on top-level GET navigations; expected fine, **unverified on Safari/iOS**); in-app browsers (Instagram/WhatsApp webviews) that may open links in a different cookie jar than the one that started the flow — the failure mode is the clean "start from here" page, never a wrong login; Android Chrome custom tabs; privacy modes that block first-party cookies; PWA standalone vs browser cookie jars; real `Secure` cookies and the final production origins/`PLATFORM_HOME_URL`. See `REAL-DEVICE-QA.md`.

## Residual risks
Cookie theft on the victim's device (XSS in Búnker origin) could mint a verifier match — mitigated by `HttpOnly`; an attacker who controls the victim's browser already wins. Code in the URL fragment is visible to browser history/extension of that device (as before; consumed in ≤ 60 s, single use). The start route is unauthenticated by design (it proves nothing; it is rate limited and open-redirect-safe because the Home URL is configuration, not input).
