# Handoff: Claude Code to Work Platform / Codex (2026-10-25)

Claude usage is nearly exhausted until Thursday. This is the state of play so work continues without Claude. Repo: `2jfitnesscenter/2j-platform` (public; do not change visibility). CI checks: `quality`, `secret scan`, `e2e (training SSO + link)`. Snapshot taken 2026-10-25; re-check CI before acting.

## 1. Open PRs

CI column is the last snapshot ("green" = quality + secret scan passed; #80 had a failure, #97/#98 reported no checks).

| PR | Title (short) | Branch / stack parent | CI | Reviewer | Blocker | Next action |
|---|---|---|---|---|---|---|
| #9 | docs 2J-010 closeout | codex/2j010-closeout-docs / main | green (draft) | Work Platform | none known | Decide: merge or close |
| #46 | docs 2J-098 architecture plan | claude/2J-098-master-docs / main | green (draft) | Work Platform | none known | Owner decides |
| #51 | Services/plans design v2 | PILOT-04 / PILOT-03 | green (draft) | Work Platform | stack base | Merge in stack order |
| #52 | Store design v2 | PILOT-05 / #51 | green (draft) | Work Platform | conflicts with #97 in `store.ts`; migration 0050 | Merge after #51; resolve against #97 |
| #80 | D185 session eligibility (Codex) | codex / main | failure seen | Work Platform | failing check | Codex fixes CI |
| #89 | Staging setup script + runbook | claude/2J-STAGING-SETUP / main | green (draft) | Work Platform + owner | NOT to be executed without owner OK; `init` takes the IP as an argument | Owner decision |
| #95 | Base44 vs Platform mapping (docs) | claude / main | green | Work Platform | needs independent review | Review, then owner OK |
| #96 | MyGym spec (docs, Phase 1 + Phase 2 defaults) | claude / main | green | Work Platform | needs independent review; decision number pending | Review, assign decision number |
| #97 | Cash: require open shift (D113) | codex/2J-CASH-D113 / main | none reported (draft) | Work Platform (security/money) | fixes 3-5 + re-review pending; no production grant of `owner.panel.read`; conflicts with #52 in `store.ts` | Codex finishes; independent re-review |
| #98 | Cash handover/denomination proposal | codex / main | n/a (draft) | Work Platform | waits for #97 | Review after #97 |
| #99 | CI minute savings | claude/2J-CI-MINUTES / main | green | Work Platform (author is Claude) | needs independent review | Review; merge with owner OK; then measure 7 days |
| #100 | Owner-assigned shifts design | codex / main | green (draft) | Work Platform | none known | Review |
| #102 / #103 / #104 | Codex parity versions (Resumen actions, Espacios/Servicios, asistencia) | codex / main | green (draft) | Work Platform | overlap with Claude #106 / #108 / #105 | Owner picks one version per screen; close the other |
| #105 | Parity 1: attendance check/cross | claude / main | green | Work Platform | review | Review |
| #106 | Parity 2: Resumen quick actions | claude / main | green | Work Platform | review; parent of #118 | Review; merge before #118 |
| #107 | Member read contract (docs) | codex / main | green (draft) | Work Home + Work Platform | 5-check review done | Fixes by Codex |
| #108 | Parity 3: Espacios / Servicios | claude / main | green | Work Platform | review; parent of #115 | Review; merge before #115 |
| #110 | Member payment/session eligibility API | codex / main | green (draft) | Work Platform | findings M1-M4 + 3 LOW | Codex fixes; re-review |
| #111 | Parity 4: Actividad (Avisos / Auditoria) | claude / main | green | Work Platform (security) | audit endpoint needs security review | Security review |
| #112 | Parity 5: Clientes tab order + Compras | claude / main | green | Work Platform | review | Review |
| #113 | Parity 6: Fichaje | claude / main | green | Work Platform | review; D121 kept (no totals) | Review |
| #114 | Parity 7: Agenda room filter | claude / main | green | Work Platform | review; time grid kept | Review |
| #115 | Parity 8: Planes y cuotas | claude / #108 | green | Work Platform | stacked on #108 | Merge after #108 |
| #116 | Home waitlist only with eligibility (Codex) | codex / #110 | green (draft) | Work Home | stacked on #110 | After #110 |
| #117 | Parity 10: Informes (sales list + CSV) | claude / main | green | Work Platform | review; D108 simple list | Review |
| #118 | Resumen 2b: verbs + deep links | claude / #106 | green | Work Platform | stacked on #106 | Merge after #106 |
| #119 | Parity 12: Tienda figures + category filter | claude / #52 | green | Work Platform | stacked on #52 (which sits on #51) | Merge after #52 |
| #120 | Parity 11: Configuracion tabs (read only) | claude / main | green | Work Platform | review | Review |
| #121 | Parity 13: Mi gimnasio Panel (4 tabs) | claude / main | green | Work Platform | nobody holds `owner.panel.read` in production; copies the #97 permissions diff | Review; merge together with or after #97 |

## 2. Merge order, stacks and migrations

- Stacks: `#51 -> #52 -> #119`; `#108 -> #115`; `#106 -> #118`; `#110 -> #116`. Merge parents first, then retarget children to `main` (merge commits only, no force-push).
- `#97` and `#52` both touch `apps/api/src/store.ts`. Land #97 first (cash is top priority and Codex-owned), then merge `main` into #52 and resolve.
- `#121` copies the exact `packages/permissions` diff from #97 and also edits `apps/api/src/dashboard.ts`; expect a trivial conflict in whichever lands second.
- Migrations on main end at 0045. `0046`, `0047`, `0048` are used by #97; `0050` by #52 (store product media). `0049` was not seen in any open PR (free as far as checked); `0051+` is free. Re-list `apps/api/migrations` across open PRs before assigning a number.
- Never run migrations against a real database.

## 3. Owner decisions in force

The full A28-A53 log lives in the owner's decision records, not in this repo. Below is what Claude applied; check numbers against the owner's log.

- A33: Claude Code may merge plan PRs only with green CI and the owner's say-so. Currently the owner said: do not merge anything.
- A46-A50: cash withdrawals and expenses are allowed (reverts D98). D97 / D111 / the cash screen stay untouched until #97 merges.
- A48 / D124: permissions by profiles.
- A51: visual parity in the order of `PARIDAD-VISUAL-BASE44.md`, one PR per screen, before/after next to Base44. Claude does UI parity, Work Platform reviews, Codex owns cash.
- D121 kept: no totals in Fichaje. Actividad has no read/unread state. Agenda keeps its time grid.
- D93: Promociones visible with no price effect. D106: no internal invoice emission. D108: Informes is a simple sales list + export.
- Resumen "2b": quick actions with verbs and deep links.
- Informes and Configuracion are taken from the Base44 prototype sources (UI only, labelled "no conectado" where no API exists).
- MyGym: 4 tabs (Panel option A first, then Datos del negocio, Novedades, Consentimientos). No health or fiscal data until D33 and fiscal validation. Only the cash difference is owner-only.
- GitHub: the owner will not pay for a plan; the repo stays public. Measure CI minutes for 7 days after #99; do NOT enable "skip CI after merge to main".
- A54+: none recorded by Claude after A53.

## 4. Open findings

- #97: fixes 3, 4 and 5 (Codex decides) plus independent re-review. No production resolver grants `owner.panel.read` (finding M1).
- #110: M1-M4 and 3 LOW; Codex fixes, Work Platform re-reviews. #116 depends on it.
- #111: the audit endpoint needs a security review.
- H13: reason mapping still open.
- D111: blind count still open (Codex, after #97).
- `dashboard.test.mjs` "cash summary" is not idempotent on a reused database (totals accumulate); it passes on a fresh DB.

## 5. Rules

- Never merge without the owner's explicit approval. Claude Code may merge only plan PRs with green CI under A33.
- No deploys, real-database migrations, secrets, DNS changes or deletions.
- The author cannot review their own PR.
- No screenshots or owner data in repos. Base44 screenshots are never committed; only synthetic-data screenshots of Platform, under `docs/evidence/<pr>/`.
- Staging uses synthetic data only. No real, health or production data in Base44.
- No force-push; do not rewrite published history.

## 6. Parity status per screen

| Screen | Status | PR |
|---|---|---|
| Asistencia | done | #105 (Codex alt: #104) |
| Resumen quick actions | done | #106, then 2b in #118 (Codex alt: #102) |
| Espacios / Servicios | done | #108 (Codex alt: #103) |
| Actividad | done | #111 |
| Clientes | done | #112 |
| Fichaje | done | #113 |
| Agenda | done | #114 |
| Planes y cuotas | done | #115 |
| Informes | done | #117 |
| Configuracion | done | #120 |
| Tienda | done | #52 + #119 |
| Mi gimnasio | Panel done; other tabs read-only or not connected | #121 |
| Pagos / Caja | pending; waits for #97 (do not touch `economics-page.tsx`) | none |

Local-only comparison boards (never commit them): `temp/parity-compare/` inside the local 2J workspace.

## 7. Next 10 actions (priority order)

1. Codex: finish #97 fixes 3-5 and decide how `owner.panel.read` gets granted.
2. Work Platform: independent re-review of #97 (security / money).
3. Work Platform: independent review of #99; with owner OK merge it and start the 7-day CI measurement.
4. Codex: fix #110 M1-M4 + 3 LOW; Work Platform re-reviews; then Work Home continues #116.
5. Work Platform: security review of the #111 audit endpoint.
6. Work Platform: review #95 and #96 and assign the MyGym decision number.
7. Owner: choose Claude vs Codex versions for Resumen / Espacios / Asistencia (#102-#104 vs #105 / #106 / #108) and approve merges in stack order.
8. Codex: after #97 lands, D97 + D111 + cash screen and Pagos parity; then update #52.
9. Work Platform: review the parity PRs (#105-#108, #112-#115, #117-#121) following section 2.
10. Owner: decide on #89 staging (not executed; synthetic data only) and on the resolver that grants `owner.panel.read`.
