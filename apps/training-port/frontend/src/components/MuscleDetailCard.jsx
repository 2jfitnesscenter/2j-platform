// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from '../lib/i18n.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { MUSCLE_NAME } from '../lib/muscles.js'

/* What the member's own log says about ONE muscle (lib/health-v2.js muscleDetail). Worked / lightly worked / not this
   week / no data are different states and read differently; every figure appears only when it exists and comparisons
   only with a valid base. It describes training load — it is not an injury map and not medical. */
const STATUS = {
  worked: ['Worked this week', 'good'], low: ['Lightly worked', 'warn'], rest: ['Not trained this week', ''], nodata: ['No data yet', ''],
}
const trend = (now, prev, unit) => {
  if (prev == null || now == null) return null
  const d = Math.round((now - prev) * 10) / 10
  return d === 0 ? t('Same as last week') : (d > 0 ? '+' : '−') + fmtNum(Math.abs(d)) + (unit ? ' ' + unit : '') + ' ' + t('vs last week')
}

export default function MuscleDetailCard({ detail, unit = 'kg' }) {
  if (!detail) return null
  const [label, tone] = STATUS[detail.status] || STATUS.nodata
  return <div className="v2-md" role="group" aria-label={t(MUSCLE_NAME[detail.slug])}>
    <div className="v2-md-h"><b>{t(MUSCLE_NAME[detail.slug])}</b><span className={'tag nocap ' + tone}>{t(label)}</span></div>
    {detail.status === 'nodata'
      ? <p className="v2-md-empty">{t('This muscle has not been in a logged session yet.')}</p>
      : <div className="v2-md-grid">
        <div className="v2-stat"><span className="v">{fmtNum(detail.sets || 0)}</span><span className="k">{t('Sets this week')}</span>
          {trend(detail.sets, detail.prevSets) && <span className={'d ' + (detail.sets >= detail.prevSets ? 'up' : 'down')}>{trend(detail.sets, detail.prevSets)}</span>}</div>
        {detail.last && <div className="v2-stat"><span className="v">{fmtDate(detail.last.d)}</span><span className="k">{t('Last session')} · {t('{0} sets', fmtNum(detail.last.sets))}</span></div>}
        {detail.perWeek != null && <div className="v2-stat"><span className="v">{fmtNum(detail.perWeek)}×</span><span className="k">{t('per week, last 4 weeks')}</span></div>}
        {detail.volume != null && <div className="v2-stat"><span className="v">{fmtNum(detail.volume)} {unit}</span><span className="k">{t('Volume of its main lifts')}</span>
          {trend(detail.volume, detail.prevVolume, unit) && <span className="d">{trend(detail.volume, detail.prevVolume, unit)}</span>}</div>}
      </div>}
  </div>
}
