// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from '../lib/i18n.js'
import { fmtSec } from '../lib/history.js'
import { fmtNum } from '../lib/format.js'
import Icon from './Icon.jsx'
import { Pill } from './v2.jsx'

/* The facts of an exercise in the workout, in one hierarchy (Experience V2): what it is (equipment · muscle group), what
   to do (sets × reps — the one big figure), how hard (RPE / RIR) and how long to rest, plus the member's last load and
   best. Shared by the full and the one-set-at-a-time workout views so the two cannot drift apart. Presentational:
   `target` is the same string the workout already builds ("3 × 10 reps · RIR 2"); nothing here touches workout state. */
export default function ExerciseMeta({ ex, cardio, target, rest, best, unit, lastText }) {
  const [main, ...more] = String(target || '').split(' · ')
  const effort = more.join(' · ')
  const muscle = ex.tg || ex.bp
  return <div className="v2-xm">
    {(cardio || ex.eq || muscle) && <div className="v2-xm-tags">
      {cardio && <Pill tone="acc" icon="figureRun">{t('Cardio')}</Pill>}
      {ex.eq && <Pill icon="machine" className="capitalize">{t(ex.eq)}</Pill>}
      {muscle && <Pill icon="target" className="capitalize">{t(muscle)}</Pill>}
    </div>}
    <div className="v2-xm-facts">
      <div className="v2-xm-main"><Icon name="target" /><span>{main}</span></div>
      {effort && <div className="v2-xm-f"><span className="k">{t('Effort')}</span><span className="v">{effort}</span></div>}
      {rest > 0 && <div className="v2-xm-f"><span className="k">{t('Rest')}</span><span className="v">{fmtSec(rest)}</span></div>}
      {lastText && <div className="v2-xm-f"><span className="k">{t('Last time')}</span><span className="v">{lastText}</span></div>}
      {best > 0 && <div className="v2-xm-f"><span className="k">{t('Best:').replace(/:$/, '')}</span><span className="v">{fmtNum(best)} {unit}</span></div>}
    </div>
  </div>
}
