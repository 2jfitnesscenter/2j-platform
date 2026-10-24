# The six PRs: real dependencies, the Home visual commits, and an integration order (decision 1)

Nothing here was merged, retargeted or force-pushed. All six PRs are **drafts**. This is evidence plus a proposal; the owner decides. Verified with `git` and `gh` on 2026-10-23.

## 1. Stacks and what each PR really contains

```
2j-platform:  main ← #64 PLATFORM-IDENTITY ← #65 HOME-CONNECTED ← #66 E2E ← #67 CLOSURE
2jfitnessapp: main ← #56 BUNKER-CONSUMER  ← #57 BUNKER-CLOSURE
```

| PR | Commits that are its own | Depends on |
|---|---|---|
| **#64** | 2: `6c7571e7` one-time SSO codes (migration 0039), `fc0714e0` hardening after review | `main` (`f87818a`, #63 squash) |
| **#65** | 8: the **five Home visual / demo / staging commits** (`7bb8ce01`, `01a93ad5`, `5d0e037e`, `2f169966`, `dd144e99`), the Home SSO entry `bbc7a3ac`, a **merge commit** `912494c4` of #64 into it, and the review fix `988cb85f` | #64 |
| **#66** | 3: E2E harness `ead5fcc9`, a merge commit `2dfa281c` of #65, review fix `2b0e01c2` | #65 |
| **#67** | 13: link lifecycle + provisioning (0040), passkeys (0041), trusted proxies, E2E link suite, latency tool, runbooks, reviewer package | #66 |
| **#56** | 3: consumer (`1a147f86`), `/sso` landing (`6141b62e`), review fix (`a8106704`) | Búnker `main` |
| **#57** | 19: state authorization, link lifecycle, kiosk re-check, sessions follow the mode, route matrix, differential tool, **Dockerfile `COPY platform-sso/`**… | #56 |

**Correction of an earlier statement** (README and `MERGE-STRATEGY.md` said #64 carries the Home visual commits): **they are in #65, not #64.** #64 has exactly two commits, both SSO.

Cross-repository runtime dependency (not a git dependency): Home (#65) → Platform SSO (#64) → Búnker consumer (#56/#57). The Platform↔Búnker contracts (`2J-SERVICE-AUTH-V1`, `2J-CAPABILITIES-V2`, SSO redeem **v2**, `2J-CAPABILITY-SIGNAL-V1`) must be deployed in a compatible pair; see `CONTRACTS.md` "Compatibility". Everything is behind flags that default OFF, so merging code does not change behaviour.

## 2. The Home visual commits exist three times

`git patch-id --stable` shows the five commits are **byte-for-byte the same patches** under different SHAs:

| Patch | Codex lane (`agent/codex/2J-HOME-VISUAL-UNIFICATION`) | Claude rebase (`agent/claude/2J-INT-HOME-REBASE`) | In #65 |
|---|---|---|---|
| Prepare isolated synthetic Home demo build | `0025d6c` | `9eadc78` | `7bb8ce0` |
| Harden isolated synthetic Home staging candidate | `0987639` (also on `codex/2J-HOME-004-staging-readiness`) | `aa488e7` | `01a93ad` |
| align home visuals with bunker theme | `88b7163` | `a7accd5` | `5d0e037` |
| docs: add home visual unification handoff | `a9cd24d` | `75a2484` | `2f16996` |
| docs: correct implementation commit | `6763cf9` | `1bc037f` | `dd144e9` |

None is in `main`. No open PR carries the Codex or REBASE copies. Merging two of these lanes without care yields duplicate commits or conflicting histories.

What the five commits change (read by the implementing agent, **not audited independently**): `client-app.tsx` (Training URL resolution, demo flag), `styles.css` (+228 lines of visual tokens), a demo build script and nginx/compose files for an *isolated synthetic* staging candidate, design-token tests, handoff docs. No backend, no auth, no migration. Overlap with the SSO work is limited to `apps/client-app/src/client-app.tsx` (my browser-binding commit `98842a4` touches the same file and applies on top).

## 3. Proposed integration strategy (no duplicated or lost commits)

1. **Decide the owner of the Home visuals once.** Recommended: keep them in **#65 only**, and retire the two other lanes (`2J-HOME-VISUAL-UNIFICATION`, `2J-INT-HOME-REBASE`, `2J-HOME-004-staging-readiness`) *without deleting them* until #65 is merged — then close them as superseded. Reason: #65 is the only one reviewed in the stack and the only one with the SSO entry applied on top.
2. **Alternative** if the visuals should ship independently of SSO: open one PR from `2J-HOME-VISUAL-UNIFICATION` to `main`; merge it with a **merge commit or rebase-merge** (not squash); then rebase #65 with `git rebase --onto origin/main <old #64 tip> agent/claude/2J-INT-HOME-CONNECTED` — git drops commits whose patch-id is already upstream, so the five commits disappear from #65 instead of duplicating. This needs a force-push of a *feature* branch (explicit authorization).
3. **Merge mechanics for the stack:** with merge commits (Option A of `MERGE-STRATEGY.md`) the order #64 → #65 → #66 → #67 loses nothing and duplicates nothing. With squash (the repository's habit), rebase every child with `--onto` after its parent lands, because the two merge commits inside #65/#66 would otherwise re-apply the parent's content.
4. **Order across repositories** (when, and only when, authorized): Búnker #56+#57 first (consumer + receiver, all flags off, legacy by default) → Platform #64 → #65 → #66 → #67. Reason: Platform's new redeem v2, `/sso/start` handshake and signal dispatcher need the Búnker side to exist, and with the flags off none of it is reachable. **#56 must never go without #57's Dockerfile line.**
5. **Before any merge:** `git fetch && git rev-parse origin/main` equal to the base used here (Platform `f87818a`); migration numbers `0039`–`0043` still free; the closing-commit audit (below) done by someone who did not write it.

## 4. What is *new* since the previous package (local commits, not pushed until the final step)

| Repo / branch | Commit | Content |
|---|---|---|
| Platform `2J-INT-CLOSURE` (#67) | `04c18c2` | browser-bound SSO (migration **0042**) |
| | `98842a4` | Home: leave for Training's start page, then ask for a code bound to the challenge |
| | `9145eb2`, `d603e18` | signed signal dispatcher (migration **0043**, off, dev/test only) |
| | `35173c2` | signal-latency measurement tool |
| Búnker `2J-INT-BUNKER-CLOSURE` (#57) | `36b4482` | `/sso/start` + binding cookie + redeem v2 |
| | `f933bce` | signal receiver + stale-answer guard |
| | `b561534`, `8644886` | consumer corpus + validations ported from the Codex consumer |

Because these commits sit on top of #67 and #57, **all of the new code arrives through the two top PRs**; #64–#66 and #56 are unchanged by this pass.
