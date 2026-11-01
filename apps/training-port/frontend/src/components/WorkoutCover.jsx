// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// 2J covers — every guided routine gets its own artwork from its metadata, no photographs and no
// images to host: a graphite ground, the 2J emerald, gold used sparingly, and one graphic idea
// per format drawn in SVG. The same routine always draws the same cover (seeded by its id), and
// all text stays real HTML on top of it (readable, translatable, never baked into pixels).
//
//   tabata   the 20/10 rhythm itself: work bars twice as wide as the rest gaps, last round gold
//   hiit     peaks — short, sharp efforts on a faint grid
//   circuit  stations on a loop, one lit
//   interval a stepped effort line, like a machine's interval profile
//   mobility slow, layered curves
//   core     concentric rings around a centre
//   mixed    bars on one side, peaks on the other
import { memo } from 'react'

const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }
const rng = seed => () => { seed = (Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x6d2b79f5) >>> 0; return (seed % 10000) / 10000 }

// One emerald family: each format only shifts it slightly, so the catalogue reads as one brand.
export const COVER_TONE = {
  tabata: ['#10B981', '#34D399'], hiit: ['#0EA271', '#6EE7B7'], circuit: ['#10B981', '#A7F3D0'], interval: ['#14B8A6', '#5EEAD4'],
  mobility: ['#2DD4BF', '#99F6E4'], core: ['#059669', '#34D399'], mixed: ['#10B981', '#D4AF37'],
  strength: ['#16A34A', '#86EFAC'],
}
const GOLD = '#D4AF37'

function Pattern({ category, rnd, n }) {
  const [a, b] = COVER_TONE[category] || COVER_TONE.circuit
  switch (category) {
    case 'tabata': {
      const x0 = 118, w = 24, gap = 10, base = 250
      return <g>{Array.from({ length: 8 }, (_, i) => {
        const h = 60 + rnd() * 110
        return <rect key={i} x={x0 + i * (w + gap)} y={base - h} width={w} height={h} rx="5" fill={i === 7 ? GOLD : a} opacity={i === 7 ? 0.95 : 0.35 + i * 0.07} />
      })}</g>
    }
    case 'hiit': {
      let x = 120, pts = []
      for (let i = 0; i < 9; i++) { pts.push(`${x},${230 - (i % 2 ? 40 + rnd() * 30 : 120 + rnd() * 60)}`); x += 32 }
      return <g>
        {Array.from({ length: 6 }, (_, i) => <line key={i} x1="110" x2="400" y1={90 + i * 32} y2={90 + i * 32} stroke={b} strokeOpacity="0.07" />)}
        <polyline points={pts.join(' ')} fill="none" stroke={a} strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
        <polyline points={pts.join(' ')} fill="none" stroke={b} strokeWidth="2" strokeLinejoin="round" opacity="0.8" transform="translate(0,14)" />
      </g>
    }
    case 'circuit': {
      const k = Math.max(3, Math.min(6, n || 5)), cx = 250 + rnd() * 60, cy = 140 + rnd() * 40, R = 70 + rnd() * 25, lit = Math.floor(rnd() * k), rot = rnd() * Math.PI
      return <g>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke={a} strokeOpacity="0.35" strokeWidth="3" strokeDasharray="10 8" />
        {Array.from({ length: k }, (_, i) => {
          const t = -Math.PI / 2 + rot + i * 2 * Math.PI / k
          return <circle key={i} cx={cx + R * Math.cos(t)} cy={cy + R * Math.sin(t)} r={i === lit ? 17 : 12} fill={i === lit ? a : '#0B0F12'} stroke={a} strokeWidth="3" opacity={i === lit ? 1 : 0.8} />
        })}
      </g>
    }
    case 'interval': {
      const steps = 6, x0 = 110, w = 48
      let d = `M${x0},230`
      for (let i = 0; i < steps; i++) { const hi = 110 + rnd() * 30; d += ` H${x0 + i * w + w * 0.15} V${hi} H${x0 + i * w + w * 0.65} V230` }
      return <g>
        {Array.from({ length: 5 }, (_, i) => <line key={i} x1={130 + i * 18} x2={390} y1={70 + i * 9} y2={70 + i * 9} stroke={b} strokeOpacity={0.12 - i * 0.02} strokeWidth="2" />)}
        <path d={d} fill="none" stroke={a} strokeWidth="6" strokeLinejoin="round" opacity="0.9" />
      </g>
    }
    case 'mobility': {
      const k = 2 + Math.floor(rnd() * 3), y0 = 110 + rnd() * 70, amp = 50 + rnd() * 80, tilt = rnd() * 60 - 30
      return <g fill="none" strokeLinecap="round">
        {Array.from({ length: k }, (_, i) => {
          const y = y0 + i * (22 + rnd() * 14), p = rnd() * 50
          return <path key={i} d={`M70,${y + tilt} C${160 + p},${y - amp} ${250 - p},${y + amp} ${410},${y - tilt}`} stroke={i === 1 ? b : a} strokeWidth={11 - i * 2.5} opacity={0.6 - i * 0.12} />
        })}
      </g>
    }
    case 'core': {
      const cx = 250 + rnd() * 70, cy = 130 + rnd() * 60
      return <g fill="none">{[92, 70, 48, 26].map((r, i) => <circle key={r} cx={cx} cy={cy} r={r} stroke={i === 3 ? GOLD : a} strokeWidth={i === 3 ? 6 : 5} opacity={i === 3 ? 0.9 : 0.25 + i * 0.15} />)}</g>
    }
    case 'strength': {
      const x = 155 + rnd() * 45
      return <g fill="none" stroke={a} strokeLinecap="round"><path d={`M${x},228 V82 M${x + 78},228 V82`} strokeWidth="13" opacity=".85" /><path d={`M${x - 32},108 H${x + 110} M${x - 32},202 H${x + 110}`} strokeWidth="9" opacity=".65" /><circle cx={x + 39} cy="155" r="27" stroke={b} strokeWidth="7" opacity=".8" /></g>
    }
    default: { // mixed
      return <g>
        {Array.from({ length: 4 }, (_, i) => { const h = 70 + rnd() * 70; return <rect key={i} x={140 + i * 30} y={240 - h} width="20" height={h} rx="4" fill={a} opacity={0.3 + i * 0.12} /> })}
        <polyline points="270,210 295,120 320,190 345,95 372,180" fill="none" stroke={GOLD} strokeWidth="6" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
      </g>
    }
  }
}

/**
 * @param r      the routine (category, id, parts…) or a collection-like { id, style }
 * @param shape  'card' (4:3) | 'wide' (16:9) | 'tall' (4:5) | 'square'
 */
function WorkoutCover({ r, shape = 'card', children, className = '' }) {
  const category = r.category || ({ start: 'circuit', express: 'hiit' }[r.style] || r.style || 'circuit')
  const rnd = rng(hash(r.id || category))
  const [a] = COVER_TONE[category] || COVER_TONE.circuit
  const main = (r.parts || []).find(p => p.role === 'main')
  const gx = 20 + rnd() * 50, gy = 20 + rnd() * 40
  const uid = 'g' + hash(r.id + shape).toString(36)
  return <div className={`wcov ${shape} ${category} ${className}`} aria-hidden={children ? undefined : 'true'}>
    <svg className="wcov-art" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={uid} cx={`${gx}%`} cy={`${gy}%`} r="85%">
          <stop offset="0%" stopColor={a} stopOpacity="0.30" />
          <stop offset="55%" stopColor="#0B0F12" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="300" fill="#0B0F12" />
      <rect width="400" height="300" fill={`url(#${uid})`} />
      <Pattern category={category} rnd={rnd} n={main?.exercises} />
      <text x="380" y="284" textAnchor="end" className="wcov-mono">2J</text>
    </svg>
    {children && <div className="wcov-over">{children}</div>}
  </div>
}
export default memo(WorkoutCover)
