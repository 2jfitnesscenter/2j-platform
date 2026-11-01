// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// A plate-loading breakdown for a straight barbell: given a set's total weight, works out what
// actually goes on each side. Shown only on tap (Workout.jsx's plate button, and Settings' own
// standalone entry, both open sheets.jsx's platesSheet) rather than as an inline row icon — at
// row size the drawing read as noise more than information. Hand-drawn SVG, same convention as
// RecoveryRing/LineChart — no charting library.
const BAR_WEIGHT = { kg: 20, lb: 45 }
// Every bar type the calculator's picker offers (platesSheet) — `kg` is what actually feeds
// plateBreakdown; a lb profile just keeps the single BAR_WEIGHT.lb default below, since none of
// these has an established pound-plate convention worth inventing. Two of these (smith and
// shortOlympic) land on the same 15kg — kept as separate entries because a lifter picks by what
// the bar in front of them is *called*, not by its number.
export const BARBELL_TYPES = [
  { id: 'olympic', label: 'Olympic bar (20kg)', kg: 20 },
  { id: 'technique', label: 'Technique bar (10kg)', kg: 10 },
  { id: 'smith', label: 'Smith / multipower (15kg)', kg: 15 },
  { id: 'shortOlympic', label: 'Short olympic bar (15kg)', kg: 15 },
  { id: 'zBar', label: 'Z-bar (8kg)', kg: 8 },
  { id: 'roman', label: 'Roman bar (10kg)', kg: 10 },
  { id: 'swiss', label: 'Swiss bar (10kg)', kg: 10 },
  { id: 'safety', label: 'Safety bar (32kg)', kg: 32 },
  { id: 'none', label: 'No bar / machine (0kg)', kg: 0 },
]
// Official IWF competition plate colours — 25 red / 20 blue / 15 yellow / 10 green / 5 white /
// 2.5 black / 1.25 chrome — so a lifter recognises a plate by colour, not just size. `h`/`t` are
// each plate's height and thickness *relative to the 25kg plate* (real olympic-plate
// proportions), what both the drawing and the "available weights" picker's circles size
// themselves from. 1.25kg ships in the set but starts switched off in DEFAULT_AVAILABLE_KG —
// a real but uncommon micro-plate most home/commercial racks don't have.
// Exported so the "Available weights" editor (sheets.jsx's PlatesSheet) can draw the exact same
// colours/order as the calculation and the drawing use, instead of keeping a second copy.
export const KG_PLATES = [
  { w: 25, color: '#e53935', h: 1, t: 1 },
  { w: 20, color: '#1e88e5', h: 1, t: .84 },
  { w: 15, color: '#fdd835', h: .89, t: .84 },
  { w: 10, color: '#43a047', h: .72, t: .68 },
  { w: 5, color: '#ffffff', h: .51, t: .5, outline: true },
  { w: 2.5, color: '#212121', h: .43, t: .34 },
  { w: 1.25, color: '#c7c7cc', h: .36, t: .24 },
]
const LB_PLATES = [
  { w: 45, color: '#3b82f6', h: 1, t: 1 },
  { w: 35, color: '#eab308', h: .84, t: .84 },
  { w: 25, color: '#22c55e', h: .68, t: .68 },
  { w: 10, color: '#f4f4f5', h: .5, t: .5, outline: true },
  { w: 5, color: '#18181b', h: .38, t: .38 },
  { w: 2.5, color: '#c7c7cc', h: .3, t: .24 },
]
// Every real kg plate except 1.25 — what a fresh install's "available weights" starts from
// (store/useStore.js's DEF.availablePlates uses this too, so both share one source of truth).
export const DEFAULT_AVAILABLE_KG = KG_PLATES.filter(p => p.w !== 1.25).map(p => p.w)

// Greedy breakdown of one side's load — biggest plate first, same order they actually go on
// (heaviest against the collar, lightest on the outside). `left` (what's still owed once no
// available plate fits) comes back too, rather than being silently dropped — a target that isn't
// exactly reachable with this plate set should say so, not just quietly round down. `available`
// (a list of allowed plate weights, unit-matched) narrows the set to what the lifter actually has
// — omit it for the full set, same as before this existed.
function plateStack(perSide, unit, available) {
  const all = unit === 'lb' ? LB_PLATES : KG_PLATES
  const plates = available ? all.filter(p => available.includes(p.w)) : all
  const stack = []
  let left = perSide
  const eps = 0.01
  for (const p of plates) {
    while (left >= p.w - eps) { stack.push(p); left -= p.w }
  }
  return { stack, left: Math.max(0, left) }
}

/**
 * The pure calculation, shared by the drawing and the plain-text summary next to it.
 * `barW` overrides the unit's default bar weight (platesSheet's bar-type picker) — omit it to
 * get the plain 20kg/45lb default. `leftover` is the difference between what was asked for and
 * what's actually achievable with this plate set (0 when exact); `achieved` is that real total.
 */
export function plateBreakdown(weight, unit, barW, available) {
  const bar = barW != null ? barW : BAR_WEIGHT[unit === 'lb' ? 'lb' : 'kg']
  const rawPerSide = (weight - bar) / 2
  if (rawPerSide <= 0) return { barW: bar, perSide: 0, plates: [], leftover: 0, achieved: bar }
  const { stack, left } = plateStack(rawPerSide, unit, available)
  const perSide = rawPerSide - left
  const achieved = Math.round((bar + 2 * perSide) * 100) / 100
  return { barW: bar, perSide, plates: stack, leftover: Math.round((weight - achieved) * 100) / 100, achieved }
}

// "Fewer changes" mode (platesSheet's ⇄ toggle) — instead of the plain greedy fewest-plates
// breakdown above, keeps as much of the PREVIOUS weight's per-side stack in place as possible
// and only touches what the new target actually needs. Moving from one working set to the next
// on the same bar, not disturbing a plate that's already correct beats a theoretically tidier
// stack. Not a global optimum (that's a subset-sum search over 6-7 denominations) — just: shed
// the SMALLEST plate whenever the kept stack overshoots the new target (removing the least
// value per step gets closest to landing exactly with the fewest removals), then top up
// heaviest-first exactly like plateStack does when there's still room. Same shape as
// plateBreakdown, so the sheet can render either without a special case.
export function plateBreakdownMinChange(fromWeight, toWeight, unit, barW, available) {
  const from = plateBreakdown(fromWeight, unit, barW, available)
  const to = plateBreakdown(toWeight, unit, barW, available)
  const eps = 0.01
  let working = [...from.plates]
  let sum = working.reduce((s, p) => s + p.w, 0)
  while (sum > to.perSide + eps && working.length) {
    working.sort((a, b) => a.w - b.w)
    sum -= working.shift().w
  }
  const pool = (unit === 'lb' ? LB_PLATES : KG_PLATES)
    .filter(p => !available || available.includes(p.w))
    .sort((a, b) => b.w - a.w)
  for (const p of pool) { while (sum + p.w <= to.perSide + eps) { working.push(p); sum += p.w } }
  working.sort((a, b) => b.w - a.w)
  const achieved = Math.round((to.barW + 2 * sum) * 100) / 100
  return { barW: to.barW, perSide: sum, plates: working, leftover: Math.round((toWeight - achieved) * 100) / 100, achieved }
}

// Collapses a flat heaviest-first stack into one row per denomination ({w, color, count}) — what
// the "Per side" chip list wants instead of one chip per physical disc.
export function groupPlates(stack) {
  const out = []
  for (const p of stack) {
    const last = out[out.length - 1]
    if (last && last.w === p.w) last.count++
    else out.push({ w: p.w, color: p.color, count: 1, outline: p.outline })
  }
  return out
}

// A glossy front-elevation drawing: a chromed sleeve with each side's discs threaded on,
// biggest-against-the-collar outward — real relative height/thickness per plate (KG_PLATES'
// own h/t), not a schematic. `height` lets callers size it (platesSheet's big hero drawing vs.
// a smaller inline confirmation) without the SVG's own coordinate math caring.
export default function BarbellPlates({ weight, unit, barW, available, height = 130 }) {
  const { plates } = plateBreakdown(weight, unit, barW, available)
  if (!plates.length) return <BarSleeve height={height} />

  const shown = plates.slice(0, 6)   // clip a very heavy load rather than squeeze it unreadable
  const maxH = 92, cx = 160, barY = 60, gap = 2.5
  const side = dir => {
    let x = cx + dir * 10
    return shown.map((p, i) => {
      const h = maxH * p.h
      const w = 10 + 16 * p.t
      x += dir * (i === 0 ? w / 2 : gap + w / 2)
      const rectX = x - w / 2
      const grad = `plateGrad${p.outline ? 'Light' : 'Dark'}`
      const el = <rect key={i} x={rectX} y={barY - h / 2} width={w} height={h} rx={3}
        fill={p.color} stroke={p.outline ? 'var(--sep)' : 'rgba(0,0,0,.25)'} strokeWidth={p.outline ? 1 : .5} />
      const sheen = <rect key={i + 's'} x={rectX} y={barY - h / 2} width={w} height={h} rx={3}
        fill={`url(#${grad})`} />
      x += dir * (w / 2)
      return <g key={i} filter="url(#plateShadow)">{el}{sheen}</g>
    })
  }

  return (
    <svg viewBox="0 0 320 130" width="100%" height={height} style={{ maxWidth: 320 }} role="img" aria-hidden="true">
      <defs>
        <linearGradient id="sleeveGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8b8d92" /><stop offset="18%" stopColor="#f2f3f5" />
          <stop offset="38%" stopColor="#b7b9be" /><stop offset="55%" stopColor="#e9eaed" />
          <stop offset="75%" stopColor="#9a9ca1" /><stop offset="100%" stopColor="#c7c9cd" />
        </linearGradient>
        <linearGradient id="plateGradDark" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#fff" stopOpacity=".22" /><stop offset="35%" stopColor="#fff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity=".18" />
        </linearGradient>
        <linearGradient id="plateGradLight" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#000" stopOpacity=".08" /><stop offset="45%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity=".14" />
        </linearGradient>
        <filter id="plateShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodOpacity=".35" />
        </filter>
      </defs>
      <rect x="4" y={barY - 5} width="312" height="10" rx="5" fill="url(#sleeveGrad)" />
      <rect x={cx - 3} y={barY - 22} width="6" height="44" rx="2" fill="#6b6d72" />
      {side(-1)}
      {side(1)}
    </svg>
  )
}

// Just the bare sleeve, no discs threaded on — a fresh calculator before any weight is entered,
// or a target at/under the bar's own weight.
function BarSleeve({ height }) {
  return (
    <svg viewBox="0 0 320 130" width="100%" height={height} style={{ maxWidth: 320 }} role="img" aria-hidden="true">
      <defs>
        <linearGradient id="sleeveGrad2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8b8d92" /><stop offset="18%" stopColor="#f2f3f5" />
          <stop offset="38%" stopColor="#b7b9be" /><stop offset="55%" stopColor="#e9eaed" />
          <stop offset="75%" stopColor="#9a9ca1" /><stop offset="100%" stopColor="#c7c9cd" />
        </linearGradient>
      </defs>
      <rect x="4" y="55" width="312" height="10" rx="5" fill="url(#sleeveGrad2)" />
      <rect x="157" y="38" width="6" height="44" rx="2" fill="#6b6d72" />
    </svg>
  )
}
