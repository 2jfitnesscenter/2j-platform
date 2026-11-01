// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { altValueOf, canonicalFromAlt } from '../lib/measurements.js'

/**
 * One field in the bioimpedance entry forms (sheets.jsx's BioimpedanceScanSheet, Admin.jsx's
 * staff version) — `value`/`onChange` are always in the measurement's CANONICAL unit (what
 * actually gets saved to S.measurements), same contract every other field in those forms
 * already has. This one additionally supports typing directly in the section's chosen alt
 * unit (the %/kg toggle, `unitMode`) and shows the other unit as a live "≈" suggestion —
 * both read through the same lib/measurements.js conversion the segment diagram and charts do,
 * so nothing can disagree about what a toggle position means.
 *
 * Keeps its own local text rather than re-deriving it from `value` on every render: converting
 * on a round trip through rounding on every keystroke would make typing feel like it's
 * fighting you (type "1", see "1.0" reappear with the cursor reset). It only resyncs when
 * `unitMode` itself flips (converting whatever's already typed into the new unit) or when the
 * caller forces a remount via `key` (e.g. after an AI scan replaces the values wholesale).
 */
export default function MeasurementField({ m, value, onChange, bodyweightKg, unitMode }) {
  const showAlt = !!(m.altUnit && unitMode === 'alt')
  const activeUnit = showAlt ? m.altUnit : m.unit
  const toDisplay = canon => {
    if (canon === '' || canon == null) return ''
    if (!showAlt) return String(canon)
    const alt = altValueOf(m, canon, bodyweightKg)
    return alt == null ? '' : String(alt)
  }
  const [text, setText] = useState(() => toDisplay(value))
  // The section's toggle just flipped — reflect the same underlying value in the new unit
  // instead of leaving stale text (or a blank field) behind.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setText(toDisplay(value)) }, [showAlt])
  // Typed in alt mode before bodyweight was known (canonicalFromAlt had nothing to convert
  // against, so nothing committed yet) — once bodyweight shows up elsewhere on the same form,
  // retry converting whatever's still sitting in the box instead of leaving it stranded.
  useEffect(() => {
    if (showAlt && text !== '') {
      const canon = canonicalFromAlt(m, text, bodyweightKg)
      if (canon != null) onChange(String(canon))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyweightKg])

  const commit = raw => {
    setText(raw)
    if (raw === '') { onChange(''); return }
    if (!showAlt) { onChange(raw); return }
    const canon = canonicalFromAlt(m, raw, bodyweightKg)
    if (canon != null) onChange(String(canon))
    // else: left uncommitted until bodyweight is known (see the retry effect above) — the
    // typed text still shows, it just isn't saved to canonical yet.
  }
  const suggestion = value !== '' && value != null && m.altUnit
    ? (showAlt ? Number(value) : altValueOf(m, value, bodyweightKg))
    : null

  return (
    <div style={{ marginBottom: 10 }}>
      <div className="dim small row between" style={{ marginBottom: 4 }}>
        <span>{t(m.label)}</span>
        {m.altUnit && <span className="dim" style={{ fontSize: 11 }}>{activeUnit}</span>}
      </div>
      <input type="number" inputMode="decimal" className="input" step={m.step}
        placeholder={activeUnit ? `— ${activeUnit}` : '—'} value={text} onChange={e => commit(e.target.value)} />
      {suggestion != null && (
        <div className="dim small" style={{ marginTop: 3 }}>≈ {fmtNum(suggestion)} {showAlt ? m.unit : m.altUnit}</div>
      )}
    </div>
  )
}
