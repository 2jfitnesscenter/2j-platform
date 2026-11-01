// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The blocks of Home as a CLOSED catalogue, and the member's choice about them — the same pattern as lib/progress-cards.js. The choice lives in S.ux.home =
// { order?: string[], hidden?: string[] }, so it syncs across devices with the rest of the profile (Sync V2 keeps S opaque) and:
//   · absent (S.ux === null, a profile that never personalised) → the DEFAULT Home: calendar, Premium and only the blocks that earn their place; the rest are
//     one tap away ("Personalizar" → Add). Nothing is ever deleted: a hidden block is just not drawn, and a running Premium program is untouched by hiding its card;
//   · stored (V1 or later): the member's explicit choice wins. `hidden` lists what they turned off; ids they never saw (a block added in a later release) keep their
//     default place and their default visibility;
//   · only blocks marked `optional` can be hidden (a review that is due, the gym's follow-up and its announcements are never switched off by a layout).
// Each block still applies its own data/feature gates; this only decides "shown by choice" and "where". The greeting at the top, the invitation to personalise and
// the welcome card of an empty profile are structural and not part of the catalogue.
export const HOME_BLOCKS = [
  { id: 'week', label: 'Calendar', icon: 'calendar', optional: true },
  { id: 'premium', label: 'Premium training', icon: 'trophy', optional: true, feature: 'premium' },
  { id: 'reorder', label: 'Week suggestions', icon: 'calendar' },
  { id: 'review', label: 'Routine review', icon: 'history' },
  { id: 'followup', label: 'Follow-up', icon: 'chartLine' },
  { id: 'news', label: 'News & notices', icon: 'bell' },
  { id: 'readiness', label: 'Readiness', icon: 'heart', optional: true },
  { id: 'coach', label: 'Coach', icon: 'sparkles', optional: true, feature: 'coach' },
  { id: 'train2j', label: 'Train with 2J', icon: 'dumbbell', optional: true, feature: 'train2j', defaultHidden: true },
  { id: 'intelligence', label: 'Today for you', icon: 'bolt', optional: true, defaultHidden: true },
]
export const HOME_IDS = HOME_BLOCKS.map(b => b.id)
export const HOME_DEFAULT_HIDDEN = HOME_BLOCKS.filter(b => b.defaultHidden).map(b => b.id)
const KNOWN = new Set(HOME_IDS)
const OPTIONAL = new Set(HOME_BLOCKS.filter(b => b.optional).map(b => b.id))
export const isHomeOptional = id => OPTIONAL.has(id)
const list = (x, ok) => (Array.isArray(x) ? [...new Set(x.filter(i => typeof i === 'string' && ok.has(i)))] : [])

/** The stored choice, cleaned: known ids only, no repeats, and only optional blocks can be hidden. Anything malformed is ignored (→ defaults). */
export function normalizeHome(h) {
  return { order: list(h?.order, KNOWN), hidden: list(h?.hidden, OPTIONAL) }
}
const stored = S => (S?.ux?.home && typeof S.ux.home === 'object' ? S.ux.home : null)

/** The member's sequence merged with the defaults: listed blocks first in their order; any block they do not list goes after its default predecessor. */
export function homeOrder(S) {
  const { order } = normalizeHome(stored(S))
  const out = [...order]
  HOME_IDS.forEach((id, i) => {
    if (out.includes(id)) return
    let at = 0
    for (let k = i - 1; k >= 0; k--) { const p = out.indexOf(HOME_IDS[k]); if (p >= 0) { at = p + 1; break } }
    out.splice(at, 0, id)
  })
  return out
}

/** The hidden ids that apply to this member: the default clean set when nothing is stored, otherwise their own list plus never-seen blocks that are hidden by default. */
export function homeHidden(S) {
  const s = stored(S)
  if (!s) return [...HOME_DEFAULT_HIDDEN]
  const n = normalizeHome(s)
  if (!n.order.length && !n.hidden.length) return [...HOME_DEFAULT_HIDDEN]      // nothing usable stored: the default layout
  const seen = new Set(n.order)
  return [...new Set([...n.hidden, ...(n.order.length ? HOME_DEFAULT_HIDDEN.filter(id => !seen.has(id)) : [])])]
}

/** Blocks to draw, in order (the member's hidden ones removed). */
export function visibleHomeBlocks(S) {
  const hidden = homeHidden(S)
  return homeOrder(S).filter(id => !hidden.includes(id))
}
/** What the editor works on. */
export const homeLayoutOf = S => ({ order: homeOrder(S), hidden: homeHidden(S) })

/** Blocks that are not on Home right now: what "Add" offers. */
export const availableHomeBlocks = S => { const v = new Set(visibleHomeBlocks(S)); return HOME_IDS.filter(id => !v.has(id)) }

/** What to store for a layout: nothing when it equals the default (so "restore" really clears it and an untouched profile stays untouched). */
export function homeChoice(order, hidden) {
  const n = normalizeHome({ order, hidden })
  const sameHidden = n.hidden.length === HOME_DEFAULT_HIDDEN.length && HOME_DEFAULT_HIDDEN.every(id => n.hidden.includes(id))
  const isDefault = sameHidden && n.order.length === HOME_IDS.length && n.order.every((id, i) => id === HOME_IDS[i])
  return isDefault ? undefined : n
}
export const defaultHomeLayout = () => ({ order: [...HOME_IDS], hidden: [...HOME_DEFAULT_HIDDEN] })
