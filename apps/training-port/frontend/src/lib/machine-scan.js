// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Turns a scanned gym machine's raw { name, nameEn } (api/lib/machine-scan.js) into candidate
// library exercises to confirm — reuses import-csv.js's own matchExerciseCandidates(), the
// same fuzzy matcher routine-scan.js already trusts for a whole printed routine. The one real
// difference: routine-scan silently auto-applies a single clean match (asking about every line
// of a multi-exercise scan would be tedious), while this flow always surfaces at least that one
// match for a tap-to-confirm — the entire point of a dedicated "scan one machine" screen is
// precision over throughput, since a wrongly-filed duplicate is exactly the bug being fixed.
import { matchExerciseCandidates } from './import-csv.js'
import { EXIDX } from './exercises.js'
import { nameFor } from './i18n.js'

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

/** The gym-wide alias table's key for a scanned name — same normalisation on every call, so a
 *  second photo of the same machine (even worded slightly differently by the AI) still lands
 *  on the same key as long as its canonical English name matches. */
export const machineAliasKey = nameEn => norm(nameEn)

/**
 * @param {{name: string, nameEn: string}} raw — api/lib/machine-scan.js's result.
 * @returns {{ name: string, key: string, candidates: Array<{id: string, n: string}> }}
 */
export function matchScannedMachine(raw) {
  const key = machineAliasKey(raw.nameEn || raw.name)
  const { id, candidates } = matchExerciseCandidates(raw.nameEn || raw.name)
  const list = id ? [{ id, n: nameFor(EXIDX[id]) }] : candidates
  return { name: raw.name || raw.nameEn || '', key, candidates: list }
}
