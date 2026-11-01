// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from '../lib/i18n.js'
import { unitsProgress } from '../lib/training-v3.js'
import { Ring } from './v2.jsx'

/* Where you are in the session, at a glance: a ring with the sets done, "Exercise 3 / 7", and one dot per exercise
   (a superset is one dot). Dots show done / current / pending and jump to that exercise (the same `cur` the Prev / Next
   buttons move). Presentation only — it reads the session and calls `onGo`. */
export default function WorkoutProgress({ entries, units, unitIdx, done, total, onGo, superset }) {
  const dots = unitsProgress(entries, units)
  const frac = total ? done / total : 0
  return <section className="v3-prog" aria-label={t('Workout progress')}>
    <Ring value={total ? frac : null} size={54} stroke={6} color="var(--acc)" label={t('{0} sets', done + '/' + total)}>
      <span className="v3-prog-pct">{total ? Math.round(frac * 100) : 0}<small>%</small></span>
    </Ring>
    <div className="v3-prog-main">
      <div className="v3-prog-k">{superset ? t('Superset {0} / {1}', unitIdx + 1, units.length) : t('Exercise {0} / {1}', unitIdx + 1, units.length)}</div>
      <div className="v3-prog-sets"><b>{done}</b><span>/ {total} {t('sets')}</span></div>
      {units.length > 1 && <div className="v3-dots" role="tablist" aria-label={t('Exercises')}>
        {dots.map((d, i) => <button key={i} type="button" role="tab" aria-selected={i === unitIdx}
          aria-label={t('Exercise {0} / {1}', i + 1, units.length) + (d.done ? ' · ' + t('done') : '')}
          className={'v3-dot' + (d.done ? ' done' : '') + (i === unitIdx ? ' cur' : '') + (d.superset ? ' ss' : '')} onClick={() => onGo(i)} />)}
      </div>}
    </div>
  </section>
}
