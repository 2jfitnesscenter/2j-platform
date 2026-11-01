// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { zoneForVolume, ZONE_META } from '../lib/rp-volume.js'

// Weekly Volume Zones' segmented bar (lib/rp-volume.js) — one block per set up to a muscle
// group's MRV ceiling, coloured by whichever of the five zones that position falls into. Blocks
// past what's actually been done stay at low opacity, so the bar reads as "how far in am I" as
// much as "which zone am I in right now" — the same two facts the header line spells out in
// words for anyone who can't tell blue from green at a glance.
//
// Shared by three call sites — Workout.jsx's live per-exercise bar (this week, updates as sets
// are checked), the calibration screen's reactive preview (whatever landmarks are being edited,
// against the real current count), and the volume analytics screen (a past week or a monthly
// average, read-only). None of that context lives here; a caller just hands over the count and
// the landmarks to render against.
export default function RpVolumeBar({ groupName, sets, landmarks }) {
  const zone = zoneForVolume(sets, landmarks)
  const meta = ZONE_META[zone]
  const blocks = Array.from({ length: landmarks.mrvMax }, (_, i) => ZONE_META[zoneForVolume(i + 1, landmarks)].color)
  return (
    <div className="rpbar-wrap">
      <div className="rpbar-hd">
        <span className="rpbar-name">{groupName}</span>
        <span className="rpbar-zone" style={{ color: meta.color }}>{t(meta.label)} · {fmtNum(sets)}/{landmarks.mrvMax}</span>
      </div>
      <div className="rpbar">
        {blocks.map((c, i) => <i key={i} className={'rpbar-b' + (i < sets ? ' on' : '')} style={{ '--zc': c }} />)}
      </div>
    </div>
  )
}
