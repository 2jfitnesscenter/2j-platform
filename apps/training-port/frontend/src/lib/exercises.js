import { EXDB } from './exercises-data.js'
import { t } from './i18n.js'
// Loading the library layer applies the corrected English display names to EXDB once, before
// anything reads `ex.n` (see lib/library/core.js).
import './library/core.js'

export { EXDB }
export const EXIDX = {}
EXDB.forEach(e => { EXIDX[e.id] = e })

// Equipment options present in a given list of exercises, most common first (issue #6).
// Deriving them from the *already filtered* list keeps the chip row short and means
// every body-part × equipment combination on screen has results behind it.
export function equipmentOf(list) {
  const c = {}
  list.forEach(e => { if (e.eq) c[e.eq] = (c[e.eq] || 0) + 1 })
  return Object.keys(c).sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1))
}

// Custom (user-created) exercises live in synced state S.customEx (issue #11) and are
// merged into the id index here so every EXIDX[id] lookup keeps working unchanged.
let customIds = []
export function registerCustom(list) {
  customIds.forEach(id => delete EXIDX[id])
  customIds = (list || []).map(e => e.id)
  ;(list || []).forEach(e => { EXIDX[e.id] = e })
}

// The owner's gym-wide exercise blacklist, from GET /api/config's hiddenExercises (set once
// at boot — see useStore.js). EXIDX keeps every id resolvable (a workout logged against a
// since-hidden exercise, or a plan built before it was hidden, must still render); only the
// *pickers* — allExercises — stop offering a hidden id for new selection.
let hidden = new Set()
export function setHiddenExercises(ids) { hidden = new Set(ids || []) }
export const isHidden = id => hidden.has(id)

// Equipment the gym is temporarily without (from GET /api/config's unavailableEquipment, same
// boot-time wiring as hidden above) — a second, orthogonal way an exercise can be unavailable.
// Values are exercises-data.js's own `eq` strings (equipmentOf() enumerates them).
let unavailableEq = new Set()
export function setUnavailableEquipment(list) { unavailableEq = new Set(list || []) }
export const isEquipmentUnavailable = eq => !!eq && unavailableEq.has(eq)
export const unavailableEquipmentList = () => [...unavailableEq]

// Combined "don't offer/use this right now" check — either the exercise itself was hidden by
// admin, or the equipment it needs currently isn't available. Takes an id or a resolved
// exercise object (same dual-accept idiom as isCardio below), since callers have one or the
// other on hand depending on where they sit.
export const isUnavailable = idOrEx => {
  const ex = typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx
  if (!ex) return false
  return isHidden(ex.id) || isEquipmentUnavailable(ex.eq)
}

// Full searchable catalogue — customs first so your own exercises are easy to find. Customs
// are the member's own and are never affected by the gym's blacklist. `excludedEx` is the
// member's own "don't recommend me this" list (RoutineEdit's exercise menu) — unlike `hidden`
// it's per-profile, not gym-wide, and only ever affects this same offer-for-new-selection path;
// an existing routine/workout entry still resolves fine through EXIDX.
export const allExercises = st => {
  const excluded = new Set(st.excludedEx || [])
  return [...(st.customEx || []), ...EXDB.filter(e => !hidden.has(e.id) && !excluded.has(e.id))]
}

// Media normally sits next to the app (img/ and gif/, mounted into the web container).
// A build can point them somewhere else — the demo/mobile build uses the pinned upstream CDN.
const IMG_BASE = import.meta.env.VITE_IMG_BASE || 'img/'
const GIF_BASE = import.meta.env.VITE_GIF_BASE || 'gif/'
export const imgSrc = ex => ex?.img ? IMG_BASE + ex.img : null
export const gifSrc = ex => ex?.gif ? GIF_BASE + ex.gif : null

// Cardio exercises log time + speed instead of weight × reps.
export const isCardio = idOrEx => (typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.bp === 'cardio'

// An id that resolves to nothing — a plan file built against a different exercise dataset,
// a custom exercise deleted on another device before the sync arrived — still has to
// render. A placeholder keeps it visible (and removable) instead of taking the whole view
// down on the first `ex.n`.
export const exOr = id => EXIDX[id] ||
  { id, n: t('Unknown exercise'), bp: '', tg: '', eq: '', sm: [], st: [], missing: true }

// Custom-exercise ids start with 'c' (see sheets.jsx's CustomExForm) — used by Social publishing
// to know which ids in a routine need their full definition attached, since EXIDX only knows
// about the exercises registered from whichever user's own customEx last loaded in this tab.
export const isCustomId = id => typeof id === 'string' && id.startsWith('c')

// Every custom-exercise definition a routine's ex[] references, for embedding alongside a
// Social publish so another member's client can resolve them.
export function extractCustomDefs(routine, S) {
  const ids = new Set((routine.ex || []).map(e => e.id).filter(isCustomId))
  return (S.customEx || []).filter(e => ids.has(e.id))
}

// Adds any custom-exercise defs a copied/assigned routine needs that this profile doesn't
// already have, matched by id (not name) — the routine's ex[] references these exact ids, so a
// name-based dedup could silently leave one unresolved ("Unknown exercise") if this profile
// already has a differently-named-but-similar custom exercise under a different id.
export function mergeCustomDefs(defs, customEx) {
  const have = new Set((customEx || []).map(e => e.id))
  const missing = (defs || []).filter(d => !have.has(d.id))
  return missing.length ? [...(customEx || []), ...missing] : (customEx || [])
}
