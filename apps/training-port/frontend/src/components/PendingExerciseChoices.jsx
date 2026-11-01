// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from '../lib/i18n.js'

// A scanned exercise name that was close to more than one library exercise — matchExercise()
// deliberately refuses to guess between them (see lib/import-csv.js's matchExerciseCandidates)
// rather than silently filing years of training under the wrong lift. Shown on both routine-scan
// review screens (the member's own, and the trainer panel's) so a human makes that one call
// instead — picking a candidate swaps it in everywhere that exercise appears in the routine;
// "None of these" just leaves it as the custom exercise it would have been anyway.
export default function PendingExerciseChoices({ pendingChoices, onChoose }) {
  if (!pendingChoices.length) return null
  return <>
    <h4 className="sec">{t('Did you mean one of these?')}</h4>
    {pendingChoices.map(p => <div key={p.exId} style={{ marginBottom: 14 }}>
      <div className="small dim capitalize" style={{ marginBottom: 6 }}>{p.name}</div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 7 }}>
        {p.candidates.map(c => <button key={c.id} className="chip capitalize" onClick={() => onChoose(p.exId, c.id)}>{c.n}</button>)}
        <button className="chip dim" onClick={() => onChoose(p.exId, null)}>{t('None of these')}</button>
      </div>
    </div>)}
  </>
}
