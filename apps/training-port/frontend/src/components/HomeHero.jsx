// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useMemo } from 'react'
import { t, dateLocale } from '../lib/i18n.js'
import { exCount, fmtVol } from '../lib/format.js'
import { setsDone, setsDoneActive } from '../lib/history.js'
import { nextPlannedSession, justFinished, recentRecord } from '../lib/home-alive.js'
import { glyphOf } from '../lib/glyphs.js'
import { homeIndicators } from '../lib/indicators.js'
import Icon from './Icon.jsx'
import { Pill, ProgressBar, Ring } from './v2.jsx'
import IndicatorDetail from './IndicatorDetail.jsx'
import { useUI } from '../store/useUI.js'

/* Home's hero (Experience V2): greeting, today's session with its real facts, ONE primary action and the week's
   progress — compact, so the rest of Home (news, week strip, Train with 2J, Coach…) keeps its place.
   Everything shown comes from what Home already derives; nothing here changes how a workout starts (`onToday` is
   the same handler the old "Today" row had). With nothing planned there is no empty card: the rest-day line and a
   contextual action; with no routines at all, only the greeting (the welcome card below offers the set-up paths). */

// Minutes of this routine's recent sessions (real data); null when it has never been trained — no invented estimate.
export function typicalMinutes(S, routineId) {
  const ds = (S.workouts || []).filter(w => w.routineId === routineId && w.end > w.start).slice(-3).map(w => (w.end - w.start) / 60000)
  if (!ds.length) return null
  const m = Math.round(ds.reduce((a, b) => a + b, 0) / ds.length)
  return m >= 5 && m <= 240 ? m : null
}

export default function HomeHero({ S, user, routine, doneToday, rescheduled, week, onToday, onWeek, now = new Date() }) {
  const active = S.active
  const program = S.activeProgramId ? (S.programs || []).find(p => p.id === S.activeProgramId && !['paused', 'abandoned', 'completed'].includes(p.status)) : null
  const minutes = routine ? typicalMinutes(S, routine.id) : null
  const hasPlan = !!(S.routines || []).length
  const indicators = useMemo(() => homeIndicators(S, user?.id), [S, user?.id])
  const cta = active ? { label: t('Resume workout'), icon: 'timer' }
    : doneToday ? { label: t('View today’s workout'), icon: 'check', ghost: true }
    : routine ? { label: t('Start workout'), icon: 'play' }
    : { label: t('Plan a workout'), icon: 'plus', ghost: true }
  const title = active ? active.name : routine ? routine.name : null
  // Home Alive: what to lead with right now — all derived from the session in progress, the log and the plan (nothing stored).
  const safe = (fn, d = null) => { try { return fn() } catch { return d } }
  const live = active ? safe(() => ({ done: setsDoneActive(active), total: active.entries.reduce((n, e) => n + e.sets.length, 0) })) : null
  const fresh = !active && doneToday ? safe(() => justFinished(S)) : null
  const record = !active ? safe(() => recentRecord(S)) : null
  const upNext = !active && !routine && !doneToday ? safe(() => nextPlannedSession(S, now)) : null
  const frac = week.planned ? Math.min(1, week.done / week.planned) : 0

  return <section className="v2-hero" aria-label={t('Today')}>
    <div className="v2-hero-bg" aria-hidden="true" />
    <div className="v2-hero-head">
      <div className="min0">
        <h1>{user ? t('Hi {0}', user.name) : '2J Fitness'}</h1>
        <div className="sub">{now.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      </div>
    </div>

    {record && <div className="v3h-pr" role="status"><Icon name="trophy" /><div><div className="v3h-pr-k">{t('New record')}</div><div className="v3h-pr-v">{record.title} <small>· {record.value}</small></div></div></div>}

    {hasPlan && <div className="v2-hero-today">
      <div className="v2-eyebrow">{active ? t('In progress') : doneToday ? t('Done today') : t('Today')}</div>
      {title
        ? <div className="v2-hero-title"><span className="v2-hero-ico"><Icon name={active ? 'timer' : routine ? glyphOf(routine.emoji) : 'check'} /></span><span className="min0">{title}</span></div>
        : <div className="v2-hero-title rest"><span className="v2-hero-ico"><Icon name="moon" /></span><span>{t('Rest day')}</span></div>}
      {live && live.total > 0 && <div className="v3h-live" role="group" aria-label={t('Workout progress')}>
        <div className="v3h-live-row"><b>{live.done}<small> / {live.total}</small></b><span>{Math.round(live.done / live.total * 100)}% · {t('sets')}</span></div>
        <ProgressBar value={live.done / live.total} label={t('Workout progress')} />
      </div>}
      {fresh && <div className="v3h-recap"><Pill tone="acc" icon="check">{t('{0} sets', safe(() => setsDone(fresh), 0))}</Pill>{fresh.vol > 0 && <Pill icon="dumbbell">{fmtVol(fresh.vol, S.unit)}</Pill>}</div>}
      {upNext && <div className="v3h-next"><Icon name="calendar" /><span>{t('Next session')} · {upNext.date.toLocaleDateString(dateLocale(), { weekday: 'long' })} · <b>{upNext.routine.name}</b></span></div>}
      {(routine || active) && <div className="v2-hero-meta">
        {routine && <Pill icon="dumbbell">{exCount((routine.ex || []).length)}</Pill>}
        {minutes && <Pill icon="clock">{t('{0} min', minutes)}</Pill>}
        {program && <Pill tone="acc" icon="calendar" className="nocap">{program.name}</Pill>}
        {rescheduled && <Pill>{t('rescheduled')}</Pill>}
      </div>}
      <button type="button" className={'v2-cta' + (cta.ghost ? ' ghost' : '')} onClick={onToday}><Icon name={cta.icon} />{cta.label}</button>
    </div>}

    {(week.planned > 0 || week.done > 0) && <button type="button" className="v2-hero-week v2-tap" onClick={onWeek} aria-label={t('Your week')}>
      <div className="row between">
        <span className="v2-eyebrow">{t('Your week')}</span>
        <span className="v2-hero-weekv">{week.planned ? t('{0} of {1} workouts', week.done, week.planned) : t(week.done === 1 ? '{0} workout' : '{0} workouts', week.done)}</span>
      </div>
      {week.planned > 0 && <ProgressBar value={frac} label={t('Your week')} />}
      {/* constancy, never a scolding: a streak that ended simply starts again */}
      <span className="v2-hero-streak"><Icon name="flame" />{week.streak >= 1 ? t(week.streak === 1 ? '{0} week in a row' : '{0} weeks in a row', week.streak) : t('A new streak starts with your next workout')}</span>
    </button>}

    {indicators.length > 0 && <div className="v2-hero-rings" role="list" aria-label={t('Activity indicators')}>
      {indicators.map(i => <button key={i.key} type="button" role="listitem" className="v2-hero-ring v2-tap"
        onClick={() => useUI.getState().openSheet(close => <IndicatorDetail i={i} close={close} />)}>
        <Ring value={i.value} size={58} stroke={6} color={i.color} icon={i.icon} label={`${t(i.label)}: ${i.text}${i.unit ? ' ' + t(i.unit) : ''}`} />
        <span className="v">{i.text}</span><span className="k">{t(i.label)}</span>
      </button>)}
    </div>}
  </section>
}
