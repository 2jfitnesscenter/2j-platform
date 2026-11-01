// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useMemo, useState } from 'react'
import { t } from '../lib/i18n.js'
import { fmtNum, fmtVol } from '../lib/format.js'
import { periodSummary } from '../lib/progress-v3.js'
import { uxOn } from '../lib/features.js'
import { describeEvent } from './Mi2JEvents.jsx'
import Icon from './Icon.jsx'
import { Pill, Stat, CountUp } from './v2.jsx'
import { Segmented, Button } from './ui.jsx'

/* Progress V3 cover: the period in one look — how many sessions (against the previous period only when that exists), what was
   trained, what was earned. Everything is optional and appears only with real data; weight needs the member's own switch
   (admin ∧ member 'bodyweight') and two weigh-ins inside the period. No scores, no "better / worse" verdicts. */
export default function ProgressCover({ S, onStory }) {
  const [period, setPeriod] = useState('month')
  const p = useMemo(() => periodSummary(S, period), [S.workouts, S.bodyweight, S.badges, S.unit, period])
  const vs = p.prevWorkouts == null ? null : p.workouts - p.prevWorkouts
  const volDelta = p.volume && p.prevVolume ? Math.round((p.volume - p.prevVolume) / p.prevVolume * 100) : null
  const showWeight = uxOn(S, 'bodyweight') && p.weight
  const adv = p.advance ? describeEvent(p.advance, S.unit) : null
  return <section className="v3-cover" aria-label={t('Your progress')}>
    <div className="v3-cover-top">
      <span className="v2-eyebrow">{t('Your progress')}</span>
      <Segmented className="seg-inline v3-cover-seg" value={period} onChange={setPeriod}
        options={[{ value: 'week', label: t('Week') }, { value: 'month', label: t('Month') }]} />
    </div>

    {p.empty
      ? <div className="v3-cover-empty">
        <div className="v3-cover-big"><span className="v2-num">0</span><span className="v3-cover-lbl">{t(period === 'week' ? 'No workouts yet this week' : 'No workouts yet this month')}</span></div>
        {p.streak >= 1 && <Pill tone="gold" icon="flame">{t(p.streak === 1 ? '{0} week in a row' : '{0} weeks in a row', p.streak)}</Pill>}
      </div>
      : <>
        <div className="v3-cover-big">
          <CountUp value={p.workouts} /><span className="v3-cover-lbl">{t(p.workouts === 1 ? 'workout' : 'workouts')}</span>
          {vs != null && <span className={'v3-cover-vs' + (vs > 0 ? ' up' : '')}>{vs === 0 ? t('Same as {0}', period === 'week' ? t('last week') : t('last month')) : (vs > 0 ? '+' : '−') + Math.abs(vs) + ' ' + t(period === 'week' ? 'vs last week' : 'vs last month')}</span>}
        </div>
        <div className="v3-cover-stats">
          {p.minutes > 0 && <Stat value={<CountUp value={p.minutes} />} label={t('min trained')} />}
          {p.volume > 0 && <Stat value={fmtVol(Math.round(p.volume), S.unit)} label={t('Volume')} delta={volDelta == null ? null : (volDelta > 0 ? '+' : '') + volDelta + '%'} tone={volDelta == null ? undefined : volDelta >= 0 ? 'up' : 'down'} />}
          {p.prs > 0 && <Stat value={<CountUp value={p.prs} />} label={t('PRs')} tone="gold" />}
          {p.streak >= 1 && <Stat value={<CountUp value={p.streak} />} label={t(p.streak === 1 ? 'week in a row' : 'weeks in a row')} tone="gold" />}
          {p.perWeek != null && <Stat value={fmtNum(p.perWeek)} label={t('per week')} />}
        </div>
        {(p.muscles.length > 0 || showWeight) && <div className="v3-cover-chips">
          {p.muscles.map(m => <Pill key={m.slug} tone="acc" icon="target" className="capitalize">{t(m.name)}</Pill>)}
          {showWeight && <Pill icon="scale" className="nocap">{t('Weight')} {(p.weight.delta > 0 ? '+' : p.weight.delta < 0 ? '−' : '±') + fmtNum(Math.abs(p.weight.delta))} {S.unit}</Pill>}
        </div>}
        {adv && <div className="v3-cover-adv"><Icon name={adv.icon || 'trophy'} /><span><b className="capitalize">{adv.title}</b>{adv.result ? ' · ' + adv.result : ''}</span></div>}
      </>}
    {!p.empty && onStory && <Button variant="tinted" icon="upload" className="v3-cover-cta" onClick={() => onStory(period)}>{t('Create my 2J Story')}</Button>}
  </section>
}
