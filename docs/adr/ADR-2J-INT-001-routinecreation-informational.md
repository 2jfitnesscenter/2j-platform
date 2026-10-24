# ADR-2J-INT-001 — `routineCreation` (commercial) stays informational; personal routines are free

- Status: **accepted by the owner for now** (temporary; to be revisited)
- Decision date: 2026-10-23
- Source of the decision: the owner's instruction in the session "2J MASTER INTEGRATION — correcciones del dictamen del arquitecto" (decision H14), also consistent with the earlier owner decision D1 (free limited training mode without a fee). Recorded here because the architect's review (H14) noted it was not registered anywhere citable.
- Scope: Platform `2J-CAPABILITIES-V2`, Búnker consumer (`platform-sso`), documentation.

## Context

`2J-CAPABILITIES-V2` carries two different flags: `routineCreation` (a possible *commercial* capability: creating routines as a paid feature) and `personalRoutineCreation` / `personalRoutineManagement` (creating and managing one's own routines, part of the free baseline together with `autonomousTraining`, `workoutRecording`, `workoutHistory`).

## Decision

1. `routineCreation` **does not gate anything**. No route, no state operation and no UI decision in Búnker or Platform depends on it. It is carried in the contract and exposed for information only.
2. Creating, editing and deleting **personal routines and programs is free** for every account (legacy, shadow or enforced), through `personalRoutineCreation` and `personalRoutineManagement`. This is what the content-level state authorization checks (`api/platform-sso/state-policy.js`).
3. Guided programs (`source: 'guided-v2'`), Premium, Opposition and the AI Coach remain commercial and keep their own capabilities (`guidedTraining`, `premiumPrograms`, `aiCoach`).

## Consequences

- The contract is unchanged on the wire; the *meaning* of `routineCreation` is frozen as "informational" until a new owner decision. Any future use needs a new ADR, a change in `state-policy.js` and tests, and must not remove what historical users already do.
- The tests that pin this: Búnker `api/test/platform-state-policy.test.js` (personal routines pass with the baseline) and `api/test/platform-sso.test.js` ("free users keep saving personal content…").
- The readiness and reviewer documents point here instead of describing the decision as "recorded".
