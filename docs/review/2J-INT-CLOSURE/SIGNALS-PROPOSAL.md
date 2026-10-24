# 2J-CAPABILITY-SIGNAL-V1 — signed Platform → Búnker suspension/revocation signals (decision 4)

**Status: proposal + isolated proof of concept.** Both sides are off by default; the dispatcher refuses to start outside `development`/`test`; no infrastructure, DNS, proxy or deployment is involved; nothing was run against a real database or a real account. It does **not** replace the 60 s capability cache or the local emergency disable — it is an accelerator on top of them.

## 1. Problem

A Platform suspension reaches Búnker only when its cached capability answer lapses: measured **7–40 s (p50 19 s) in the worst direction, bounded by 60 s + polling** (`EVIDENCE-kiosk-latency.json`, 8 trials; 7–40 s measured). During a Platform outage right after the suspension, Búnker would not learn it at all (it keeps the baseline). A push closes both gaps without making Platform's push an authority.

## 2. Design

```
Platform (source of truth)                                  Búnker
 admin suspends/lifts  →  platform_training_access_events
 dispatcher (reads it, own bookkeeping 0043)
   POST /api/platform/v1/signals  ── 2J-SERVICE-AUTH-V1 ─→  receiver (flag PLATFORM_SIGNALS_ENABLED)
   {v:1, signalId, kind, personId, trainingUserId,           applySignal(): ordered per person
    sequence, occurredAt}                                      suspended → block now + remember (restriction)
   ← {v:1, status: applied|ignored, signalId, reason?}         lifted    → forget cache; Platform is asked again
```

**Restrict-only.** `kind` is `suspended | lifted`; there is no kind that grants. `lifted` drops the cached verdict and bumps an *epoch* so an answer already in flight is discarded and asked again; access returns **only** when Platform's own capability answer says the account is not blocked. A forged or replayed `lifted` can therefore at worst cost one extra capability request.

**Carries ids only** (`personId`, `trainingUserId`, `sequence`, timestamp). No reason text, no payment, no profile data.

### Contract
- Body strict (extra fields rejected), `v: 1`, `signalId` UUID, `sequence` positive safe integer (the dispatcher's delivery `seq`, monotonic), `occurredAt` ISO with milliseconds. Max body bounded by the shared raw-body reader.
- Signing: **2J-SERVICE-AUTH-V1** exactly as the other server-to-server calls (HMAC-SHA-256 over the 7-line canonical string including the body digest; ±60 s freshness; **single-use request id**). A fresh request id is signed on every attempt; the `signalId` stays the same across retries.
- Receiver answers: `423 platform_link_disabled` (flag off), `401` (signature/ clock/ key), `400` (shape), `409 service_request_replayed`, `404 link_not_found` (no active link for that person+user), `200 applied|ignored`.

### Ordering, idempotency, replay
Per person, a signal with `sequence ≤ last applied` is **ignored** (`duplicate`/`stale`) — delivery may repeat and arrive out of order; only forward movement changes state. Replay of a *signed request* is refused by the single-use request id (409). Replay of an old *body* with a new signature is impossible without the key; with the key it is the same as the attacker holding the service secret (see threat model).

### Dispatcher (Platform, migration 0043)
Reads `platform_training_access_events` (never writes it). Its own tables: `platform_training_signal_state` (when it was first enabled — earlier history is **never replayed**) and `platform_training_signal_deliveries` (one row per event, state `pending|delivered|superseded|abandoned`, attempts, lease). Properties: durable across restarts; at-least-once; two workers never send the same delivery (`FOR UPDATE SKIP LOCKED` + lease); exponential backoff 1,2,4… capped at 300 s; per person only the **latest** state is worth telling (older undelivered → `superseded`); abandoned after 24 h (the 60 s cache has long since delivered the fact) or when there is no active link / Búnker says 404; operational alerts (rate-limited to one per kind per 5 min) on refusal, unreachable Búnker, abandonment; `status()` exposes `pending` and `oldestPendingSeconds` for a probe.

## 3. Threat model

| Threat | Mitigation | Residual |
|---|---|---|
| Forged signal from the network | service signature + per-request id + freshness; loopback/private + `TRUSTED_PROXIES` rules apply as for other service routes | whoever holds the service secret can send `suspended` for a linked person: a **denial of service for that member**, never a grant |
| Forged `lifted` to regain access | cannot grant: it only forces re-verification | none beyond one extra capability request |
| Replay of a captured signal | single-use request id (409); `sequence` ordering | depends on the single-use request-id store of the Búnker proof store (the same one the other service calls use) |
| Reordering / duplicates | per-person sequence; dispatcher supersedes | a very old `suspended` re-sent with a newer sequence is by definition a Platform decision |
| Stale in-flight capability answer overwrites a fresh suspension | epoch guard: an answer fetched before the signal is discarded and asked again once | one extra request |
| Platform down after suspending | the signal is already stored in Búnker as a restriction; kiosk blocked while Platform is down (measured, §5) | if the signal never left before Platform died, delivery resumes on restart (durable) |
| Búnker down | dispatcher retries with backoff; the kiosk token is signed, survives the restart; blocked ≈ 1.2 s after Búnker is ready (measured) | up to 5 min between retries |
| Legacy/shadow users | a signal never blocks them and never makes Búnker call Platform for them (tested) | by design: protection only after an administrator enforces the user |
| Data leakage in the signal | ids only; ack carries no personal data | ids are pseudonymous but linkable by whoever sees both systems |
| Key compromise | rotation below | — |

**Key rotation.** `PLATFORM_SERVICE_AUTH_KEYS` is a map of key ids: add the new key id on the receiver, switch the signer's `keyId`, remove the old id after one freshness window. No signal format change. (Same as the other server-to-server contracts.)

**Local emergency disable preserved.** The documented operator switch (`docs/runbooks/2J-INT-emergency-suspension.md`) is independent of Platform and of this feature and was not touched: first 401 after 6–7 ms in the latency tool. Turning `PLATFORM_SIGNALS_ENABLED` off returns Búnker to the cache-only behaviour, which is still correct.

## 4. What is *not* in this proof of concept
No staging/production wiring, no key distribution, no alert routing (callbacks exist; operations must wire them), no admin UI, no metrics endpoint beyond `status()`, no back-pressure beyond batch size 20 per tick.

## 5. Evidence

Tests (all local, disposable data): Búnker `platform-sso.test.js` 6 signal tests — immediate block without waiting for the cache; stays in force when Platform becomes unreachable; a lift never grants unverified; legacy users untouched; ordering/replay/validation (unsigned, malformed, stale, repeated); no kind grants; a pre-signal answer is discarded. Platform `training-signals.test.mjs` 8 tests — off by default and dev/test-only guard; history before enabling is never replayed; ids only; retry/backoff and one winner between two workers; supersession; no link/404 handling; max age and backlog visibility; constrained bookkeeping.

**Measured latency with the signal on** (`tooling/e2e/kiosk-signal-latency.mjs`; real Platform + Búnker processes, loopback, dispatcher poll 500 ms, client poll 100 ms, 6 trials at cache ages 30–45 s; raw `EVIDENCE-signal-latency.json`):

| | cache only (8 trials) | with signal (6 trials) |
|---|---|---|
| suspension → kiosk blocked | min 7.3 s · p50 19.2 s · max 39.7 s | min 0.17 s · **p50 0.47 s · p95/max 0.48 s** · never unblocked |
| lift → kiosk restored | ≈ 60 s | 0.47–0.85 s (restored only after Búnker re-asked Platform) |
| Platform killed right after suspending | kiosk kept working (unknown) | blocked 6.6 s after (the signal was in flight or redelivered after restart) |
| Búnker restarted after suspending | — | blocked 1.2 s after Búnker was ready |
| deliveries | — | 14 delivered, 1 still pending at the end of the run, max 3 attempts |

Limits of this evidence: loopback, synchronised clocks, n = 6, one machine; the 0.17–0.48 s is dominated by the 500 ms dispatcher interval (the default is 1 s, so expect up to ≈ 1 s) and a real network adds to it. "1 pending" at the end of the run was not investigated further (backoff would retry it); I did not check which trial it came from. Not a guarantee.

## 6. Decision for the owner
Adopt as designed (then: key distribution, alert routing, production flag plan, independent review of `training-signals.ts` + the receiver) / keep cache-only (≈ 60 s + the emergency switch) / adopt later. This document does not enable anything.
