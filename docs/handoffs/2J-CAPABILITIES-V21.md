# 2J-CAPABILITIES-V2.1 — Platform side (D40, D41, A23)

Owner decisions applied (2026-10-23): Premium and Oposiciones are free for registered people; "registered" = any person with a Home/Platform account, **plus** existing Búnker users even if not yet linked (A23); it does **not** require an active Búnker link. Contract name `2J-CAPABILITIES-V2.1`, versioned endpoint, V2 consumers keep working.

## What changed
- `resolveTrainingCapabilitiesV21` (packages/domain): same shape as V2 plus `revision: 1`. New contract id so V2 consumers (which validate the free baseline exactly) are not affected.
- Endpoint `GET /api/internal/platform/v2.1/persons/:personId/training-capabilities` (service auth `2J-SERVICE-AUTH-V1`, the signed path is the V2.1 path, single-use request id, `no-store`, TTL <= 60 s). `/v2/` is untouched and still returns V2.
- Schema `contracts/2J-capabilities-v2.1.schema.json`, fixture `contracts/fixtures/2J-capabilities-v2.1.json` (9 cases).

## Semantics
| Situation | V2 | **V2.1** |
|---|---|---|
| free baseline flags | autonomousTraining, personalRoutineCreation, personalRoutineManagement, workoutRecording, workoutHistory | **same + guidedTraining + premiumPrograms** |
| still NOT free | aiCoach, professionalFollowUp, routineCreation (informational) | same |
| never linked (`not_linked`) | blocked, `TRAINING_LINK_MISSING` | **baseline**, `FREE_BASELINE`, `trainingSubject {linkStatus:'not_linked'}` |
| revoked link | blocked, `TRAINING_LINK_REVOKED` | same (default I applied: a revocation is deliberate; see question 1) |
| `suspended` | blocked only with an active link | **blocked whatever the link status**, `ADMIN_SUSPENDED` |
| paid levels, provisional, unpaid fallback | as V2 | as V2 (unpaid falls back to the richer baseline) |

## For Work Búnker / Work Home
- Búnker consumer: pin the baseline table per contract id; V2.1 validations additionally accept `not_linked` + `FREE_BASELINE` (baseline) and `ADMIN_SUSPENDED` with `not_linked`. (Done in the stacked Búnker PR; see its handoff.) Routes already gate by capability, so `/api/guided`, `/api/premium`, `/api/opposition` open for free users only by this table.
- Home: read-only; nothing to change except preferring the V2.1 path when it shows what Búnker offers.
- The SSO redeem answer embeds a V2 payload today; adding a `contract` field to the redeem request is part of the SSO stack (#64-#67) and is **not** in this PR.

## Defaults I applied (owner may change)
1. A revoked link stays blocked in V2.1 (a person whose link was revoked on purpose is not silently treated as a fresh registered person).
2. Suspension is reported for people without a link too, so a suspended Home user is blocked in Búnker before ever linking.
3. `revision` is a literal `1`; any later change of the baseline is V2.2, never a silent change of V2.1.

## Tests
domain 34/34 (5 new), API 247/247 (3 new): unlinked baseline + V2 unchanged, linked/revoked/suspended (linked and unlinked)/lifted, service-auth rules for the V2.1 path (a V2 signature does not open V2.1, replay, bad id, unknown person).
