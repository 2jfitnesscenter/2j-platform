# Merge strategy for the six stacked PRs (H8, H9) — a proposal; nothing here is authorized or executed

All six PRs are **drafts**. No merge, no retarget and no force-push was done. This file explains how the stack should be merged *if and when the owner authorizes it*, and what to check first.

## Facts (verified with Git and `gh`, 2026-10-23)

- `main` of `2j-platform` is `f87818afe474176c6e6ae77cb4d62a7e73fc1adf` — "feat: enforce term payment access for bookings (#63)". PR **#63 is MERGED** (squash, 2026-10-22T18:20:39Z, head `7965738834d6888395afa34e6de504a39efc5378`, merge commit `f87818a…`). `f87818a` **is an ancestor of every Platform branch of this integration**, which is why `apps/api/src/term-payment-access.ts` (added by `f87818a`) is in the working tree. It is **not** content of #64–#67: the diffs of the PRs do not touch it. The handoff statement "PR #63 merged at f87818a" is therefore correct; the architect's doubt (H9) is resolved by Git (`git merge-base --is-ancestor f87818a origin/main` → yes). Because #63 was squashed, its original head `7965738` is *not* an ancestor of `main` (expected for squash merges).
- The repository merges with **squash** (`#62`, `#63`: single commits on `main`). Stacked PRs and squash do not mix without a step in between (below).
- Platform migrations on `main` end at `0038_economic_grace_days.sql`; the stack adds `0039_training_sso_codes`, `0040_training_link_activation_provisioning`, `0041_platform_passkeys`. Any other PR merged first that adds a migration `0039+` collides.
- `agent/claude/2J-INT-PLATFORM-IDENTITY` (#64) carries the Home visual-unification commits (`5d0e037`, `2f16996`, `dd144e9`, `7bb8ce0`, `01a93ad`) that were never audited; they already exist on the remote branch `agent/claude/2J-INT-HOME-REBASE`.
- Búnker: `agent/claude/2J-INT-BUNKER-CONSUMER` (#56) is the Claude consumer of capabilities/SSO. A **different, unmerged** Codex branch, `codex/bunker-v2-snapshot-consumer-prep` (`9377e517b88d6eb8168a5e671a8913ebb2cbc5f8`, `api/platform-capabilities/consumer.js` + its test, plus one `COPY platform-capabilities/` line in `api/Dockerfile`), prepares a *parallel* capabilities consumer. Neither includes the other: **two consumers of the same contract exist**. #56 does not incorporate or replace it. Decision needed from the owner (see README §Decisions).

## Before any merge (all must be true)

1. Independent security review and QA complete; owner authorization recorded.
2. `main` has not moved: `git fetch && git rev-parse origin/main` equals the base used for the stack (`f87818a…` for Platform; for Búnker the base of #56).
3. Migration numbers still free (`ls apps/api/migrations | tail`). If not, renumber **before** applying anywhere (migrations are checksummed).
4. `api/Dockerfile` of Búnker copies every imported directory (`platform-sso/` was missing and is fixed in #57; the test `dockerfile-covers-imports.test.js` guards it) — and, if the Codex consumer is merged, `platform-capabilities/` too.
5. Decide #64's Home visual commits: audit them, or move them to their own PR (`2J-INT-HOME-REBASE`) and rebase the stack without them.

## Mechanics (Platform stack #64 → #65 → #66 → #67)

Option A — **merge commits for the stack** (simplest, keeps SHAs): merge #64, then #65, #66, #67 in order with "Create a merge commit"; GitHub retargets each child to `main` after its parent merges. History keeps the individual commits.

Option B — **squash**, as the repository usually does. After squashing a parent, rebase the child onto the new `main` removing the parent's commits, then retarget:
```bash
# after #64 is squashed into main as <S64>
git fetch origin
git rebase --onto origin/main <old tip of agent/claude/2J-INT-PLATFORM-IDENTITY> agent/claude/2J-INT-HOME-CONNECTED
git push --force-with-lease origin agent/claude/2J-INT-HOME-CONNECTED     # needs explicit authorization
gh pr edit 65 --base main
# repeat for #66 (old tip = HOME-CONNECTED tip) and #67 (old tip = E2E tip)
```
Option B rewrites the child branches: it requires an explicit authorization for the force-push of those *feature* branches (never of `main`).

Búnker (#56 → #57): same two options. Merge #56 first; #57 depends on it (and carries the Dockerfile fix that #56 alone needs: **do not merge #56 without #57's Dockerfile line, or the image will not start**; if they must go separately, cherry-pick that line into #56).

## After a merge (still no activation)

Flags stay OFF in both repositories; deployment (Platform before Búnker only matters for SSO/linking), Caddy, DNS, secrets and per-user enforcement are separate, separately authorized steps (README §Staging and the staging design).
