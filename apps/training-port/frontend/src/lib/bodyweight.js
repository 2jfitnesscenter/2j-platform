// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The ONE reader of body weight. Storage stays S.bodyweight ([{ d, w, t?, src? }]) — nothing is copied or cached; every screen and every calculation that needs "the
// weight" asks here, so Progress, Health, Profile, energy and the member sheet can never disagree about which reading is the latest.
// Rules (unchanged from before, now in one place): ordered by calendar day, then by the moment it was logged; entries without a valid date or a positive
// number are ignored (legacy and imported data can contain them); the latest reading wins even if it was appended out of order.
const ISO = /^\d{4}-\d{2}-\d{2}$/
const valid = e => !!e && typeof e === 'object' && ISO.test(e.d || '') && Number(e.w) > 0
const stamp = e => (Number.isFinite(e.t) ? e.t : 0)

/** Valid readings, oldest first. A new array every call; the stored entries themselves are returned (never copies), so `src` and `t` are intact. */
export function orderedBodyWeightSeries(S) {
  const list = Array.isArray(S?.bodyweight) ? S.bodyweight.filter(valid) : []
  return list.map((e, i) => [e, i]).sort(([a, i], [b, j]) => (a.d < b.d ? -1 : a.d > b.d ? 1 : stamp(a) - stamp(b) || i - j)).map(([e]) => e)
}

/** The most recent reading, or null. */
export function latestBodyWeight(S) {
  const s = orderedBodyWeightSeries(S)
  return s.length ? s[s.length - 1] : null
}

/** The latest reading from an EARLIER day than the latest one (what a change is measured against), or null. */
export function previousBodyWeight(S) {
  const s = orderedBodyWeightSeries(S)
  if (s.length < 2) return null
  const last = s[s.length - 1]
  for (let i = s.length - 2; i >= 0; i--) if (s[i].d < last.d) return s[i]
  return null
}
