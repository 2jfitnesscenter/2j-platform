# 2J-PUSH-INFRA — Web Push infrastructure (Platform), behind a flag

Status: **Draft, implemented and tested locally; OFF by default.** Nothing was deployed, no real push service was contacted, no VAPID key exists yet.
Decisions served: D152, D176, D199, D209, D211, D248, D255 (and review items #47, #59, #71); defaults E14 (Spanish, no special sound, **1 retry**, invalid tokens discarded, every attempt logged); D25 and D187 (no push for evaluation publication or booking confirmation).

## Provider decision: standard Web Push (VAPID), library `web-push` 3.6.7

| Option | Cost | Android | iOS | Third party sees content | Verdict |
|---|---|---|---|---|---|
| **Web Push / VAPID (chosen)** | free | Chrome, Firefox, Edge | **Safari 16.4+, only for a PWA added to the home screen** | only the browser vendor's push service (payload is encrypted end to end, RFC 8291) | matches "free/low cost, Android + iOS PWA" and needs no account with anyone |
| FCM (Firebase) | free | yes | web push only through the same standard | Google account, console, SDK | adds a vendor and a project for nothing the standard does not give; becomes the right choice only when a native shell (Capacitor) exists |
| OneSignal / similar | free tier, paid at scale | yes | yes | the vendor stores subscriptions and content | extra processor under RGPD, lock-in |

`PushProvider` is a one-method interface (`send`), so FCM/APNs can be added later without touching callers. **Limit to tell the owner:** on iPhone the member must add Home to the home screen before notifications can be enabled; Home says so (`needs-install`).

## What exists

- Migration `0044_push_infrastructure.sql` (number chosen to avoid the open SSO stack's 0039–0043): `platform_push_consent_events` (append-only), `platform_push_subscriptions`, `platform_push_intents`, `platform_push_deliveries` (append-only).
- `apps/api/src/push.ts`
  - **`enqueuePushIntent(sql, { personId, kind, dedupeKey, params? })` — the API modules call.** Pass the module's own transaction so the intent exists only if the business change committed. Idempotent per `(person, dedupeKey)`. **Texts are fixed generic templates per kind (owner decision: nothing on a lock screen with names, amounts or health data); a module cannot pass text, only integer counts** (`count`, `recovered`, `notRecovered`, 0–999). Sends nothing by itself.
  - `createPushService`: consent, subscribe/unsubscribe, dispatcher (`FOR UPDATE SKIP LOCKED` + 5-min lease, so concurrent workers never double-send), one retry after 60 s, a retry never repeats to a device that already got it, 410/404 discards the token, expiry (default 24 h), `status()` for a probe.
  - Member routes: `GET /api/me/push/config`, `PUT /api/me/push/consent`, `POST|DELETE /api/me/push/subscriptions`. Person always from the session, member origin enforced on mutations, `423 push_disabled` when off.
- `apps/api/src/push-web-provider.ts`: VAPID provider; maps 404/410 → gone, 429/5xx/network → retryable.
- Home (new files only, nothing existing edited): `apps/client-app/src/push/push-client.ts` (pure, tested), `use-push-subscription.ts` (React hook), `public/push-sw-handlers.js` (service-worker handlers; Home's `service-worker.js` needs one line: `importScripts('/push-sw-handlers.js');`).

## Kinds approved and their fixed texts (`PUSH_TEMPLATES`)

| Kind | Category | Decision |
|---|---|---|
| `waitlist.promoted` | essential | D199 (also carries D211: one grouped push for the overlapping waits cancelled) |
| `waitlist.suspended` | essential | D209 — one push **per event**, not per request (review #47) |
| `booking.cancelled_by_membership` | essential | D176/D248, one grouped push, only when something was cancelled |
| `booking.recovered` | essential | D255, one grouped push |
| `document.requested`, `document.rejected` | regular | D152 |

Not registered on purpose: booking confirmed (D187), evaluation published (D25), waiting request reactivated (D209), protected-absence notice (D206), anything about health. A module cannot add a kind without a code change and a decision.

## Configuration (all off)

`PUSH_ENABLED=true`, `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_VAPID_SUBJECT` (`mailto:` or `https:`). Generate keys once with `generateVapidKeys()` (from `push-web-provider.ts`) and store the private key in the secret store — **a secret and a production setting: needs the owner's approval, I created none.** Starting with the flag on and no keys fails. `ServerOptions`: `pushEnabled`, `pushProvider`, `pushVapidPublicKey`, `pushIntervalMs`.

## Defaults applied (not decided by the owner)

1. "Essential" kinds (D38: not switchable) still need a registered device; consent withdrawal removes every device, so after withdrawal nothing is sent. Regular kinds also re-check consent at send time.
2. Push consent is its own append-only history; a device subscription requires `granted`.
3. A browser endpoint belongs to whoever registered it last (shared devices).
4. Expiry 24 h per intent; push TTL 1 h at the push service.

## Tests (real, run locally on a throwaway PostgreSQL)

`apps/api/test/push.test.mjs` 8 tests: off by default / 423 / refuses to start without keys; member routes (auth, origin, consent first, strict bodies, https only, isolation between members); consent withdrawal + append-only; intent API validation and transaction atomicity; delivery, logging, dead-token discard, consent check; retry rules; expiry, 3 concurrent dispatchers send once, a throwing provider; Web Push provider error mapping. `apps/client-app/test/push-client.test.mjs` 5 tests. **Not tested:** a real push service, a real browser/iOS device, the service worker handlers (plain JS, reviewed by reading only).

## Risks / open

- Lock-screen text is visible to anyone holding the phone: texts are short and the `SENSITIVE` filter is a heuristic, not a guarantee.
- A push service outage degrades to "retry once, then failed"; there is no queue-wide alerting yet (use `status()`).
- iOS needs the home-screen install; Android notifications depend on the user's battery/permission settings.
- Wiring each kind into its business module (waiting list, membership change, payment correction, documents) belongs to those modules' PRs; this PR gives them the API and nothing calls it yet.
- Migration `0044` requires approval before any real database (none applied).
