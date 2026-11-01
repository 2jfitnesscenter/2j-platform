// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Experience V2 primitives (styles in src/v2.css). Small, presentational and theme-aware: Home, Post-workout,
// Progress today; Health V2 / Social V2 / Seguimiento V2 next. Nothing here reads the store.
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { reducedMotion, easeOut } from '../lib/motion.js'

const cx = (...a) => a.filter(Boolean).join(' ')

export const Surface = ({ raised, glass, className, as: Tag = 'div', ...p }) =>
  <Tag className={cx(glass ? 'v2-glass' : 'v2-surface', raised && 'raised', className)} {...p} />

export const Pill = ({ tone, icon, className, children, ...p }) =>
  <span className={cx('v2-pill', tone, className)} {...p}>{icon && <Icon name={icon} />}{children}</span>

/** value 0–1 (clamped). Announced as a progressbar. */
export function ProgressBar({ value = 0, tone, label, className }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  return <div className={cx('v2-progress', tone, className)} role="progressbar" aria-label={label}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}><i style={{ width: v * 100 + '%' }} /></div>
}

/** A round indicator: value 0–1, optional icon in the middle and a caption below. `color` is any CSS colour.
 *  value null/undefined = a STATE ring (no arc, no percentage): the figure is shown, nothing is claimed about progress. */
export function Ring({ value = 0, size = 64, stroke = 7, color = 'var(--acc)', icon, label, caption, children, className }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r
  const state = value == null || !Number.isFinite(value)
  const v = state ? 1 : Math.max(0, Math.min(1, value))
  return <div className={cx('v2-ring', state && 'state', className)} role="img" aria-label={label}>
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="v2-ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle className={'v2-ring-arc' + (state ? ' state' : '')} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={state ? `2 ${c / 18 - 2}` : c} strokeDashoffset={state ? 0 : c * (1 - v)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color, fontSize: size * 0.34 }}>
        {children || (icon && <Icon name={icon} />)}
      </div>
    </div>
    {caption}
  </div>
}

export const Skeleton = ({ width = '100%', height = 14, className, style }) =>
  <div className={cx('v2-skel', className)} style={{ width, height, ...style }} aria-hidden="true" />

/** Loading placeholder for a list of rows (avatar + two lines): same footprint as the real rows, so nothing jumps on arrival. */
export const ListSkeleton = ({ rows = 3 }) =>
  <div className="v2-lskel" role="status" aria-busy="true" aria-label="…">{Array.from({ length: rows }, (_, i) =>
    <div key={i} className="v2-lskel-row"><Skeleton width={40} height={40} /><div><Skeleton width="55%" /><Skeleton width="80%" height={11} /></div></div>)}</div>

export const EmptyState = ({ icon = 'sparkles', title, children, action }) =>
  <div className="v2-empty"><div className="ic"><Icon name={icon} /></div>{title && <div className="tt">{title}</div>}{children}{action}</div>

export const Stat = ({ value, label, delta, tone }) =>
  <div className={cx('v2-stat', tone === 'gold' && 'gold')}><span className="v">{value}</span><span className="k">{label}</span>{delta != null && <span className={cx('d', tone !== 'gold' && tone)}>{delta}</span>}</div>

/** Counts up to `value` in ~250 ms. Renders the final number at once with reduced motion or a non-finite value. */
export function useCountUp(value, ms = 250) {
  const target = Number.isFinite(value) ? value : 0
  // Starts at the final number when nothing can animate (reduced motion, server render, tests) so no screen ever shows a stale 0.
  const [v, setV] = useState(() => reducedMotion() || typeof requestAnimationFrame !== 'function' ? target : 0)
  const raf = useRef(0)
  useEffect(() => {
    if (reducedMotion() || typeof requestAnimationFrame !== 'function') { setV(target); return }
    const from = 0, t0 = performance.now()
    const tick = now => {
      const k = Math.min(1, (now - t0) / ms)
      setV(from + (target - from) * easeOut(k))
      if (k < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [target, ms])
  return v
}

export function CountUp({ value, format = n => String(Math.round(n)), ms }) {
  const v = useCountUp(value, ms)
  return <span className="v2-num">{format(v)}</span>
}

/** Minimal inline trend line (no chart library). `points` = numbers, oldest first; renders nothing with fewer than two. */
export function Sparkline({ points = [], width = 120, height = 36, color = 'var(--acc)', label }) {
  const p = points.filter(Number.isFinite)
  if (p.length < 2) return null
  const min = Math.min(...p), max = Math.max(...p), span = max - min || 1
  const x = i => 2 + i * (width - 4) / (p.length - 1), y = v => height - 3 - (v - min) / span * (height - 6)
  const d = p.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ')
  return <svg className="v2-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
    <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx={x(p.length - 1)} cy={y(p[p.length - 1])} r="3" fill={color} />
  </svg>
}
