// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { recoveryColor } from '../lib/recovery.js'

// A round 0-100% progress ring — no existing chart component does circular progress, this is
// the one place recovery needs it (Home's card + the /recovery detail screen).
export default function RecoveryRing({ value, size = 72, stroke = 8 }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, value))
  const color = recoveryColor(v)
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
    <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
    <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
      strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} strokeLinecap="round"
      transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset .4s var(--ease)' }} />
    <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize={size * 0.26} fontWeight="700" fill="var(--label)">{v}%</text>
  </svg>
}
