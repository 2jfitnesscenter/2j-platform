# Real-device QA procedure (decision 5) — written, NOT executed

**Nothing in this file has been run.** It is the script a QA person (not the implementing agent) follows on an isolated staging environment built from `docs/design/2J-INT-staging-mode.md`. No deployment, DNS, Caddy or real migration was done to produce it. Results belong in a copy of the sheet at the bottom; the integration is not approved until they exist and the independent security audit is done.

## 0. Preconditions (all must be true; otherwise stop)
- Staging environment exists per the design: own hosts (exact `https` origins), own databases with the staging marker, own secrets (`stg-` key ids), synthetic data only, every flag OFF at the start. **No real member, real passkey, real payment or production host is involved.** Do not use a personal account.
- Builds under test: record the Git SHA of Platform (#67 tip), Home, Búnker (#57 tip) and the migration list applied (0039–0043).
- Clocks of all hosts within 2 s (NTP); record offsets.
- QA personas seeded (names are fixed so results are comparable): `legacy`, `legacy-linked`, `shadow-free`, `enforced-free`, `enforced-fuerza`, `enforced-autonomous`, `suspended`, `revoked`, `provisioned`, `kiosk-member`, `admin`.
- Tester has: iPhone (current iOS, Safari) + iPhone with an older iOS still in use at the gym, Android Chrome (two vendors), a laptop (Chrome, Firefox, Safari), a kiosk/tablet as used on the gym floor, a device **with** a platform authenticator (Face/Touch ID, Android biometrics) and one hardware key.

## 1. Matrix (run every row on every device class that applies)
| ID | Scenario | Expected | Notes to record |
|---|---|---|---|
| S1 | Home → "Abrir Búnker" with SSO on, linked enforced member | lands in Búnker signed in as that member, URL fragment cleared, back button does not re-redeem | time to land; any extra screens |
| S2 | S1 from the **installed PWA** (home-screen icon) | works, or fails cleanly with the "start from here" page — never as another person | which cookie jar the browser used |
| S3 | Open the Home link inside **Instagram / WhatsApp / Facebook in-app browsers** | works or clean failure; never a wrong login | which app, what happened |
| S4 | **Login CSRF**: copy the `…/sso#code=…` URL (minted for tester A's start) and open it in a second browser/device with no session, and in a browser that has a session of persona B | no session created / "switch account?" confirmation for B (never silent) | screenshots |
| S5 | Forwarded link: send the SSO URL to another device via messaging, open it | refused (not started in this browser) | |
| S6 | Cookies blocked / private mode / ITP (Safari "Prevent cross-site tracking", Firefox strict) | clean failure message, legacy sign-in still works | |
| S7 | Expiry and reuse: wait > 60 s on the code; reuse a consumed URL | `sso_code_invalid` page, no session | |
| S8 | Another account's session present (persona B signed in, then SSO as A) | confirmation screen, B's session is kept until confirmed | |
| S9 | Suspended persona: member app and kiosk | blocked within the measured bound (< 60 s cache-only; < ~2 s with signals if enabled); read-only withdrawal actions still work | measure with a stopwatch from the admin action; 5 trials |
| S10 | Lift the suspension | access returns only after Platform answers (≤ 60 s cache-only; seconds with signals) | |
| S11 | Platform unreachable (stop the service) after a suspension and before a suspension | known suspension keeps blocking; otherwise baseline; kiosk keeps working for free-baseline features | what the member sees |
| S12 | Búnker restart during a suspension | still blocked on return | |
| S13 | Fee states: enforced-free vs Fuerza vs autonomous: premium/guided/coach/professional features | gated exactly per `CONTRACTS.md` table | one screenshot per gated area |
| S14 | Legacy persona full workout, history, sync, kiosk check-in, passkey login | **identical to production behaviour today** (compare with a recorded session) | any difference is a defect |
| S15 | WebAuthn (passkeys of Platform): register, sign in, revoke; exact RP ID; on platform authenticator and on a hardware key; cross-device (QR/hybrid) | works; credential bound to the exact host; revoked key cannot sign in | authenticator type, OS version |
| S16 | Browser matrix for Home and Búnker UI (visual unification): 320/375/414/768/1280 widths, light/dark, reduced motion, 200 % text zoom, screen reader (VoiceOver, TalkBack) | no horizontal scroll, focus visible, labels read | list defects |
| S17 | Throttling: 5 wrong PINs / many SSO starts from one device on mobile data and on gym Wi-Fi (shared IP) | per-IP limiter does not lock out other members on the same Wi-Fi | |
| S18 | Rollback drill: set every flag OFF, set the persona back to legacy | all personas behave as legacy again, no data lost | |

## 2. Evidence to capture (per row)
Date/time, tester, device + OS + browser version, build SHAs, steps, expected vs observed, screenshots or screen recording (no real personal data on screen), server-side `security events` ids for refusals, pass / fail / blocked.

## 3. Stop conditions
Stop and report immediately if: any step reaches a production host; any real person's data appears; a signed-in session belongs to a persona other than the one started; a suspended persona keeps access beyond the stated bound; any secret is displayed. Do not "work around" a failure.

## 4. Sign-off sheet (blank — to be filled by QA, not by the implementer)
| Row | Device | Result | Evidence | Defect id |
|---|---|---|---|---|
| S1 … S18 | | | | |

QA lead: ________ date: ________ · Independent security auditor: ________ date: ________
