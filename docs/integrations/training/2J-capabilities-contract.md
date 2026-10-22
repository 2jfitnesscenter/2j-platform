# 2J-CAPABILITIES-V2 — Platform Training capabilities

Status: Platform-side V2 contract and suspension lifecycle are implemented on PR #59. No Home or Búnker consumer, invitation flow, production key, deployment, or real database migration is included.

## Identity, baseline and commercial elevation

`personId` is the canonical human identity. Membership is not identity authorization, and no membership is not an administrative block. An active Platform person with an active canonical Training link receives the free autonomous baseline: `autonomousTraining`, `personalRoutineCreation`, `personalRoutineManagement`, `workoutRecording`, and `workoutHistory`. The baseline does not grant guided training, Premium, AI, or professional follow-up.

Current explicit commercial rights elevate that baseline. `training_access=autonomous` retains the approved commercial extras (`routineCreation`, `guidedTraining`, `premiumPrograms`) but not AI or professional follow-up. `training_access=full` enables all capabilities, including AI and professional follow-up. Unpaid, ended, or absent commercial assignments fall back to the free baseline. Platform's 098E payment and period derivation remains authoritative for commercial grants.

Historical Training routines, workouts, measurements and history remain owned by Training. The contract describes current authorization and must not tell a consumer to delete or hide retained content when commercial rights end. Continuing to use/copy delivered routines and retaining history requires Training-side consumer behavior and is pending E2E verification; Platform does not store routine contents.

Administrative suspension is independent of membership, payment and Training link status. A suspension overrides all operational capability booleans and reports `accessState=suspended`; it preserves person identity, Training link and historical data. Lifting suspension recomputes from current commercial state, returning either full/commercial capabilities or the free baseline.

## Versioned response and endpoint

The machine-readable schema is [`contracts/2J-capabilities-v2.schema.json`](../../../contracts/2J-capabilities-v2.schema.json), with fixtures at [`contracts/fixtures/2J-capabilities-v2.json`](../../../contracts/fixtures/2J-capabilities-v2.json). V2 is an intentional wire-contract evolution: V1's `blocked` interpretation for no membership could not truthfully express the approved baseline, and no consumers are wired. Consumers must reject unknown versions; V1 is not silently reinterpreted.

`GET /api/internal/platform/v2/persons/{personId}/training-capabilities` resolves Platform identity, optional active client facet, effective commercial rights, Training link and administrative suspension. It accepts no caller-supplied client ID, membership, or capability state and returns `Cache-Control: no-store`. A legitimate external person can be resolved without a client facet if identity and Training link already exist. This is capability-layer support only; invitation authorization proof is not represented by the current schema.

The endpoint uses the existing `2J-SERVICE-AUTH-V1` HMAC format, exact canonical path/method/body hashing, constant-time signature comparison, ±30-second request timestamp validation and atomic PostgreSQL replay prevention. Maximum TTL remains 60 seconds and is clipped to the next known commercial transition using `Atlantic/Canary`. Service authentication/database failures fail closed; a successfully authenticated linked person with no current membership receives only the free baseline.

## Suspension lifecycle and authorization

`training.suspension.manage` is a dedicated permission. Admin receives it through the existing wildcard. Trainer, Reception and Accountant do not receive it by default. Explicit per-Trainer grants await the future granular RBAC policy layer (2J-098C); this PR does not implement that layer. Admin-only lifecycle routes are `GET /api/platform/v1/persons/{personId}/training-suspension`, `POST .../suspend`, and `POST .../lift`. Mutations require a reason and idempotency key and append immutable lifecycle and identity-audit records.

## Invitation and enrollment boundaries

There is no public unauthenticated self-registration. A Búnker identity must originate from an authorized unified-identity registration path. D278/D279/D280 invitation creation and Home registration are pending E2E integration; PR #59 does not fabricate invitation proof. D281 requires future enrollment to attach the client facet to the same canonical person and preserve the existing Training link and Training-owned history. The current Platform schema and linking contract preserve this identity boundary, but end-to-end enrollment is pending.

No SSO, user-session handoff, Training changes, membership/payment changes, or consumer calls are part of PR #59.
