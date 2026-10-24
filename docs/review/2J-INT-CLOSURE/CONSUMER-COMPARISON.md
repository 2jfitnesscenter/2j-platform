# Two consumers of 2J-CAPABILITIES-V2: comparison, equivalence tests and recommendation (decision 2)

**Nothing was deleted.** The Codex branch `codex/bunker-v2-snapshot-consumer-prep` (`9377e517`) is untouched. The Codex consumer is read with `git show` by the tools below and never added to the Búnker branch.

| | Claude consumer | Codex consumer |
|---|---|---|
| Code | `api/platform-sso/capabilities.js` (+ `index.js`, `link.js`, `route-policy.js`, `state-policy.js`) | `api/platform-capabilities/consumer.js` |
| State | **Wired**: gate on every route, per-user mode (legacy/shadow/enforced), sessions, kiosk, state authorization, link lifecycle, signals | **Inert**: "no route/store wiring"; a client library only |
| Tests | `platform-sso.test.js` (58), `platform-capabilities-conformance.test.js` (4) | `platform-capabilities-consumer.test.js` |

## How it was compared (reproducible)

- `api/test/capabilities-corpus.mjs` — **59 scenarios**: valid answers, identity/contract breaks, time windows, **internal inconsistencies**, transport/status, and six multi-call sequences (cache hit, expiry on our clock, outage after a valid answer, rejection, suspension then lift, concurrent callers share one request). Each states the verdict expected from **each** consumer in one vocabulary (`allow | baseline | suspended | revoked | not_linked | rejected | unavailable`) and, where they differ, **why**.
- `api/test/capabilities-conformance-runner.mjs` — adapters; the same corpus runs through both consumers.
- `node api/scripts/compare-capabilities-consumers.mjs [--json]` prints both columns. `npm test` runs `platform-capabilities-conformance.test.js`, which fails if either consumer deviates from the corpus **or if the two differ anywhere the corpus does not explain**.

## First run (before any change): Claude 43/59, Codex 57/59

The Codex consumer was stricter. The Claude consumer, believed an answer that contradicts itself, in the direction that happens to widen access:

| Scenario | Claude did | Risk |
|---|---|---|
| `ADMIN_SUSPENDED` + level `full` + every flag true | *suspended* (blocked, by luck of reading the reason) — but the cache then held full flags | a Platform bug or tampered answer could mix |
| `FREE_BASELINE` + paid flags (`aiCoach: true`) | accepted as **baseline with a paid flag** | paid right without payment |
| `FREE_BASELINE` + level `full` | **allow** | same |
| `suspensionStatus: suspended` with an *active* reason | **allow** | a suspension ignored |
| `accessState: baseline` with a paid reason | **allow** | state/reason contradiction |
| revoked link with flags granted; link reason on an active link | classified from the reason, flags ignored | inconsistent link |
| 200 KB body of a valid answer | **allow** (unbounded read) | memory / not a snapshot |
| `redirected: true`, or a different final URL | **allow** | answer not from the configured origin |
| RFC 3339 timestamp without milliseconds | **rejected** (regex) | false negative; Platform's own schema accepts it |

All 16 deviations were the Claude consumer's. The Codex run showed one expectation error of mine (an impossible window: Codex rejects it; fixed in the corpus) and one real Codex gap (level `blocked` with an active reason is accepted; see the differences below).

## What was ported into the Claude consumer (commit `8644886`)

Codex's invariants, verbatim in meaning: `inconsistency()` (link reason ↔ link status ↔ flags; suspension requires `accessState` + `suspensionStatus` + reason + level `blocked` + **all flags false**; `FREE_BASELINE` requires level `baseline`, state `baseline` and the **exact** baseline flag set; `accessState: baseline` only with `FREE_BASELINE`); a **64 KB bounded body read** (declared length *and* bytes received); `redirected` and final-URL (origin + path, no query/hash) checks; `z.iso.datetime({ offset:false })` and `z.iso.date()` as Platform's own schema. One rule is stricter than Codex: level `blocked` with no restriction reason is refused (verified against `packages/domain/src/training-capabilities.ts`: `blocked` only occurs with a missing/revoked link or a suspension).
Origin validation of `PLATFORM_API_BASE_URL` (https or loopback http, no credentials, origin only) already existed in `platform-sso/index.js`.

## Result after the port: both consumers match the corpus (59/59 each); 6 intended differences

| Scenario | Claude | Codex | Why Claude keeps its behaviour |
|---|---|---|---|
| answer already expired / issued 10 min in the future | unavailable | rejected | decision **H4**: our clock cannot use it → outage, degrade; not a refusal |
| issued 30 s in the future | allow | rejected | 60 s tolerated skew between hosts; the cache is bounded by OUR clock anyway |
| HTTP 429 / 408 | unavailable | rejected | decision **H6**: being rate-limited is not a decision about the person |
| level `blocked` without a restriction reason | rejected | allow | strictness (Codex accepts it; harmless today because every flag is false) |

## Not comparable by the corpus (only the Claude consumer has them)

Per-user mode and sessions that follow it; circuit breaker (2/4/8/12 s) so an outage costs one timeout; persisted restriction (a known suspension keeps blocking across restarts and outages); 5-s rejection cache that is **not** persisted; single-flight; `forget` + epoch guard for signed signals; alerts; H3 switch confirmation; kiosk re-check; state authorization. The Codex consumer's failure model has two classes (`invalid`/`unavailable`); on a forced refresh that fails it serves the still-valid cached entry (`stale: true`, never beyond its 60 s bound). The Claude consumer answers from the cache while valid and, once it lapsed during an outage, degrades to the baseline or the known restriction — it never serves a lapsed answer.

## Recommendation (provisional — the owner decides; no independent review yet)

**Keep `platform-sso` as the single effective consumer** and treat the Codex file as a reference implementation now fully covered by the ported invariants. Reasons: it is the only one wired to enforcement; the failure model, breaker and persisted restriction have no counterpart in the other; after the port the security-relevant validation is equivalent on all 59 scenarios except the six differences above, each deliberate.
**Do not delete** the Codex branch until the independent reviewer has run `compare-capabilities-consumers.mjs` and accepted the six differences. If the owner prefers Codex's library as the validation core, the corpus is the acceptance test for swapping it under the existing service.
Open risks: the corpus is written by the implementer (it encodes my reading of the contract); a reviewer should add scenarios. If `9377e517` is merged someday, its `Dockerfile` line `COPY platform-capabilities/` is required.
