# Quality and security gates

`Quality and security` is the required workflow name. Its checks are `quality`, `secret scan`, and (for pull requests) `dependency review`. It runs with read-only repository permissions; dependency review is scoped to read-only contents and pull requests. Third-party actions are pinned to immutable commits, with release tags in comments.

The repository is currently an architecture/bootstrap shell with no application packages. `pnpm typecheck` and `pnpm build` therefore establish that the workspace resolves, but do not claim application coverage. Each package added later must provide its own `lint`, `typecheck`, `test`, and `build` scripts and be included by Turbo. CI must add those package checks and an integration test before application code is considered merge-ready.

Security gates include lockfile audit at high severity, PR dependency review at high severity, and full-history Gitleaks scanning. A finding blocks the check; do not paste secret values into issues/logs. Revoke/rotate exposed credentials through the owning provider and report only secret type, location, and commit hash.

## Main protection

Require PRs, one independent approval, dismissal of stale approvals, conversation resolution, and the `quality`, `secret scan`, and `dependency review` checks when the repository plan supports them. Do not enable auto-merge. Keep the repository private. The owner runbook is `protection.json` and the Phase 0 results document explains the current GitHub plan/API blocker; do not change subscription or visibility as part of CI implementation.

Before a package is added, an empty Turborepo result must not be described as code coverage. CI here is an infrastructure gate, not application QA.
