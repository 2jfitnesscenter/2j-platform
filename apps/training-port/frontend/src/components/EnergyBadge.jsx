// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'

/* Where a calorie figure comes from, in one line (presentation of lib/health-v2.js#energyPresentation):
     463 kcal · Samsung Health · Health Connect      (measured, the app is stored)
     463 kcal · Device / Health Connect              (measured, provider not stored — never guessed)
     463 kcal · Aggregated data · Health Connect     (the health store's own total)
     ≈235 kcal · 2J estimate (165–305)               (the only kind with ≈)
   Plain props only, so Social V2 can reuse it for something the member explicitly chooses to share. */
export function energySourceText(p) {
  if (!p) return ''
  if (p.kind === 'estimated') return t('2J estimate') + (p.range ? ` (${p.range[0]}–${p.range[1]})` : '')
  if (p.kind === 'aggregate') return t('Aggregated data') + (p.detail ? ' · ' + p.detail : '')
  return p.source ? t(p.source) + (p.detail ? ' / ' + p.detail : '') : p.detail
}
export const energyFigure = p => p ? (p.approx ? '≈' : '') + fmtNum(p.kcal) : ''

export default function EnergyBadge({ energy, className = '' }) {
  if (!energy) return null
  return <span className={'v2-en ' + energy.kind + ' ' + className}>
    <b>{energyFigure(energy)} kcal</b><span>{energySourceText(energy)}</span>
  </span>
}
