// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useMemo } from 'react'
import { t } from '../lib/i18n.js'
import { fmtDur, fmtVol, fmtDate, fmtNum, weekKey, exCount } from '../lib/format.js'
import { setsDone, activeWeek, streakWeeks } from '../lib/history.js'
import { loadOfWorkouts, muscleOptsOf } from '../lib/muscles.js'
import { workoutEnergyView } from '../lib/health-v2.js'
import { fitnessOf, SOURCE_NAME } from '../lib/fitness.js'
import { energyFigure, energySourceText } from './EnergyBadge.jsx'
import { describeEvent, EventsSummary } from './Mi2JEvents.jsx'
import AchievementCard from './AchievementCard.jsx'
import BodyMapPanel from './BodyMapPanel.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'
import { ProgressBar, Stat, CountUp, Pill } from './v2.jsx'

/* Post-workout (Experience V2). Presentation only: it is rendered by sheets.jsx's FinishSummary AFTER the workout has
   been saved, from the saved workout and the events lib/mi2j.js derived — it never writes state and nothing in it can
   delay or block a finish. Every figure is shown only if the data exists (kcal, comparison, muscles, records).
   The celebration (gold ring + short glow) is for a record or a relevant achievement only. */

/** The session before `w` with the same routine (or, without a routine id, the same name); null when there is none. */
export function previousSession(S, w) {
  const before = (S.workouts || []).filter(x => x.id !== w.id && (x.end || 0) <= (w.start || w.end || Infinity))
  const same = before.filter(x => (w.routineId ? x.routineId === w.routineId : x.name === w.name))
  return same.length ? same[same.length - 1] : null
}

/** Volume change vs the previous comparable session, as a whole percent; null when either side has no volume. */
export function volumeDelta(w, prev) {
  if (!prev || !(w.vol > 0) || !(prev.vol > 0)) return null
  return Math.round((w.vol - prev.vol) / prev.vol * 100)
}

const safe = (fn, fallback = null) => { try { return fn() } catch { return fallback } }

export default function PostWorkoutSummary({ w, S, events = [], onOpenEvent, onSeeProgress, onShare, onDone, extra, rating }) {
  const prEvents = events.filter(e => e.type === 'pr')
  const topPr = prEvents[0] || null
  const achievement = events.some(e => e.major || e.type === 'badge')
  const celebrate = !!topPr || achievement
  const prev = useMemo(() => safe(() => previousSession(S, w)), [S.workouts, w])
  const dv = volumeDelta(w, prev)
  // Health is only READ here, after the save: the figure appears if a source has it and never delays anything.
  const energy = useMemo(() => safe(() => workoutEnergyView(w, S)), [w, S])
  const hr = useMemo(() => safe(() => fitnessOf(w)), [w])
  const load = useMemo(() => safe(() => loadOfWorkouts([w], null, muscleOptsOf(S)), {}), [w, S.body])
  const week = useMemo(() => safe(() => ({
    done: (S.workouts || []).filter(x => weekKey(x.d) === weekKey(w.d)).length,
    planned: Object.values(activeWeek(S)).filter(Boolean).length,
  }), { done: 0, planned: 0 }), [S.workouts, S.programs, S.week, S.activeProgramId, w.d])
  const prCard = topPr && safe(() => {
    const d = describeEvent(topPr, S.unit)
    return { title: d.title, value: d.result, subtitle: d.detail, delta: '+' + fmtNum(Math.round((topPr.data.now.w - topPr.data.prev.w) * 10) / 10) + ' ' + S.unit }
  })
  const rest = prCard ? events.filter(e => e.id !== topPr.id) : events
  const dur = w.end > w.start ? fmtDur(w.end - w.start) : null

  const streak = useMemo(() => safe(() => streakWeeks(S), 0), [S.workouts])
  const nEx = (w.entries || []).length

  return <div className="v2-fin v3pw">
    <div className={'v3pw-hero' + (celebrate ? ' gold' : '')}>
      <span className="v3pw-glow" aria-hidden="true" />
      <span className={'v2-fin-check v2-pop' + (celebrate ? ' v2-glow' : '')} aria-hidden="true"><Icon name={celebrate ? 'trophy' : 'check'} /></span>
      <div className="v3pw-eyebrow">{t('Workout complete!')}</div>
      <h3 className="v3pw-name">{w.name}</h3>
      <div className="v2-fin-sub">{fmtDate(w.d, true)}{nEx ? ' · ' + exCount(nEx) : ''}</div>
      {w.src2j && <div className="t2-done-line"><Icon name="checkCircle" />{t('2J workout completed')} · {t(w.src2j.name)}</div>}
      <div className="v3pw-big">
        {dur && <Stat value={dur} label={t('Duration')} />}
        <Stat value={<CountUp value={safe(() => setsDone(w), 0)} />} label={t('Sets')} />
        <Stat value={fmtVol(w.vol, S.unit)} label={t('Volume')}
          delta={dv == null ? null : (dv > 0 ? '+' : '') + dv + '% ' + t('vs last session')} tone={dv == null ? undefined : dv >= 0 ? 'up' : 'down'} />
      </div>
      <div className="v3pw-chips">
        {prEvents.length > 0 && <Pill tone="gold" icon="trophy">{t('PRs')} {prEvents.length}</Pill>}
        {streak >= 1 && <Pill tone="gold" icon="flame">{t(streak === 1 ? '{0} week in a row' : '{0} weeks in a row', streak)}</Pill>}
        {energy && <Pill icon="flame" className="nocap">{energyFigure(energy)} {t('kcal')} · {energySourceText(energy)}</Pill>}
        {hr && hr.avgHr > 0 && <Pill icon="heart" className="nocap">{hr.avgHr} {t('bpm')} · {t(SOURCE_NAME[hr.source] || hr.source)}</Pill>}
      </div>
    </div>

    {prCard && <div className="v2-fin-pr v2-rise"><AchievementCard kind="pr" title={prCard.title} value={prCard.value} subtitle={prCard.subtitle} delta={prCard.delta} date={w.d} /></div>}

    {rest.length > 0 && <div className="v2-fin-events"><EventsSummary events={rest} unit={S.unit} onOpen={onOpenEvent} /></div>}
    {extra}

    {Object.keys(load || {}).length > 0 && <>
      <h4 className="sec">{t('What you just trained')}</h4>
      <div className="card v2-fin-map"><BodyMapPanel load={load} body={S.body} top={3} S={S} /></div>
    </>}

    {(week.planned > 0 || week.done > 0) && <div className="card v2-fin-week">
      <div className="row between"><span className="v2-eyebrow">{t('Your week')}</span>
        <span className="small muted">{week.planned ? t('{0} of {1} workouts', week.done, week.planned) : t(week.done === 1 ? '{0} workout' : '{0} workouts', week.done)}</span></div>
      {week.planned > 0 && <ProgressBar value={week.done / week.planned} label={t('Your week')} />}
    </div>}

    {rating}
    <div className="v2-fin-actions">
      <Button variant="primary" onClick={onDone}>{t('Nice!')}</Button>
      <div className="row" style={{ gap: 8 }}>
        <Button variant="tinted" icon="chartLine" onClick={onSeeProgress}>{t('View progress')}</Button>
        <Button variant="tinted" icon="upload" onClick={onShare}>{t('Share workout')}</Button>
      </div>
    </div>
  </div>
}
