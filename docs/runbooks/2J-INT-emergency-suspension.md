# Emergency suspension while Platform is down (procedure; nothing here was applied to a real environment)

## When to use it

A member must lose access to Búnker **now** (abuse, safety, a lost device, a staff decision) and Platform cannot be asked or cannot answer — or the delay of the normal path is not acceptable.

## What each path guarantees (measured, not assumed)

| Path | Who acts | Reaches an already-open kiosk token / web session | Needs Platform | Measured |
|---|---|---|---|---|
| **Normal**: `POST /api/platform/v1/persons/:id/training-suspension/suspend` | Platform administrator (`training.suspension.manage`) | after the cached capability answer lapses (cache ≤ 60 s counted on the Búnker clock) | yes | **8 of 8 trials blocked**; latency min 7.3 s, p50 19.2 s, p95 = max 39.7 s (cache age before the suspension 20–53 s; latency + cache age = 60.0–60.3 s in every trial) |
| **Emergency**: `POST /api/admin/user/disable {id, disabled: true}` on Búnker | Búnker administrator with a **passkey** session (a Platform SSO session cannot) | the next request (tokens, cookies and room presence are checked against `user.disabled` on every use) | **no** | **6 ms** from the admin call to the first 401 (7 ms in the first run) |
| Nothing done while Platform is down | — | **never**: an unknown suspension degrades to the free baseline, which includes `autonomousTraining`, so the kiosk keeps working until Platform answers again | — | **kiosk answered 200 for the whole 75 s observed with Platform stopped** |

Measurement: `tooling/e2e/kiosk-suspension-latency.mjs` (real Platform + Búnker processes, loopback, synthetic data, poll every 250 ms), raw numbers in `docs/review/2J-INT-CLOSURE/EVIDENCE-kiosk-latency.json`. After a *lift* the blocked answer stays cached too: access came back after 60.0–60.2 s in every trial (the restoration latency is also ≈ 60 s). A first run of the harness had a flaw (it tried to check in while the previous suspension was still cached and then polled an invalid token, so half of its trials reported nothing); the harness was fixed and rerun, and only the fixed run is reported.

Honest limit: **the 60-second figure is a bound derived from the cache rule and checked by measurement; it is not a guarantee.** It does not cover a Platform outage (nothing can be learned) nor a Búnker with a badly skewed clock. NTP is required on both hosts.

## Steps

1. Decide with the centre who may do it (two people for anything other than safety). Write down the member, the reason and the time.
2. **Disable locally** (Búnker admin, passkey session): `POST /api/admin/user/disable` with `{"id":"<training user id>","disabled":true}`. Effects: no new sign-in of any kind, every cookie and kiosk token stops at the next call, the member leaves "training now", shared-staff sessions are revoked, a security event `account_disabled` is logged. The member's data and history are untouched.
3. **Also record it in Platform as soon as it answers**, so the decision is not lost: suspend the person (reason ≥ 10 characters). Until then Platform thinks the person is active.
4. Verify: with the member's session or token, any call answers 401; `GET /api/bunker/board` no longer lists them.
5. While Platform is unreachable the Búnker log shows an alert `platform integration alert: platform_unreachable …` (rate-limited to one per 5 minutes). If it persists for more than the centre's tolerance (suggested: 10 minutes), treat every suspension decided in that window as "not yet delivered" and use step 2 for each.
6. **Lifting**: `POST /api/admin/user/disable {"id":…, "disabled": false}` and lift the Platform suspension. The member regains access with the same data; the persisted restriction clears when Platform next confirms the lift.

## Things that do not work (and why)

- Waiting for the 4-hour kiosk token to expire — not acceptable and not needed (see the table).
- Disabling an administrator account (`no se puede desactivar a un administrador`): demote first through the normal role change.
- Using a Platform SSO session to administer: destructive/admin routes are passkey-only by design.
- Relying on enforcement for someone in `legacy` mode: Platform's suspension does not apply to a legacy user until an administrator moves that user to `enforced`; the local disable always applies.

## Alerting expected from operations (not built here)

Page someone when `platform_unreachable` has been logged for more than N minutes; watch the 403/503 counters; review `account_disabled` events weekly.
