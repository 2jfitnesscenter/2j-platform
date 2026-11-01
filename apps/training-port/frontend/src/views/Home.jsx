import { Fragment, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutine, effectiveRoutineId, activeWeek, streakWeeks } from '../lib/history.js'
import { todayISO, isoOf, weekKey, DAYS, fmtDate } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { dayOverrideSheet, calendarSheet, startFlow, loadStarterPlan, workoutDetailSheet, weekReorderSheet } from '../sheets.jsx'
import './experience.css'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import WorkoutCover from '../components/WorkoutCover.jsx'
import HomeHero from '../components/HomeHero.jsx'
import FollowUpCard from '../components/FollowUpCard.jsx'
import RoutineReviewCard from '../components/RoutineReviewCard.jsx'
import ReadinessSection from '../components/ReadinessSection.jsx'
import { pendingReviews } from '../lib/routine-review.js'
import { useFollowUp } from '../lib/followup-view.js'
import { coachAvailable, hasConsent } from '../lib/coach.js'
import { useCoachStatus } from '../lib/coach-api.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import IntelligenceToday from '../components/IntelligenceToday.jsx'
import NewsBlock from '../components/NewsBlock.jsx'
import { uxOn, configurable } from '../lib/features.js'
import { weekReorderSuggestion } from '../lib/session-adaptation.js'
import { visibleHomeBlocks, homeLayoutOf, HOME_BLOCKS, isHomeOptional } from '../lib/home-blocks.js'
import { setLayout, restoreLayout, guideSeen, markGuideSeen } from '../lib/ux-layout.js'
import LayoutEditor from '../components/LayoutEditor.jsx'
import PersonalizeGuide from '../components/PersonalizeGuide.jsx'
import PremiumHomeCard from '../components/PremiumHomeCard.jsx'

// A job in flight or a proposal waiting is the only reason the Coach interrupts Home. When it
// has nothing to say it renders nothing at all — and it only polls while Home is on screen.
function CoachCard({ nav }) {
  const S = useStore(s => s.S)
  const { job, pending } = useCoachStatus(hasConsent(S))
  if (!hasConsent(S) || (!job && !pending)) return null
  const ready = !!pending
  return <div className="card" style={ready ? { borderColor: 'var(--acc)' } : null}>
    <div className="today-row" onClick={() => nav(ready ? '/coach/proposal' : '/coach')}>
      <div className="row" style={{ gap: 9, minWidth: 0 }}>
        <span className="lrow-i" style={{ background: ready ? 'var(--acc)' : 'var(--orange)' }}><Icon name="sparkles" /></span>
        <div style={{ minWidth: 0 }}>
          <div className="lbl2">{t('Coach')}</div>
          <div className="ttl">{ready
            ? (pending.kind === 'create'
              ? t('Your plan is ready')
              : t(pending.changes?.length === 1 ? '{0} suggestion for you' : '{0} suggestions for you', pending.changes?.length || 0))
            : t('Reading your training…')}</div>
        </div>
      </div>
      {ready ? <span className="tag acc">{t('Review')}</span> : <Icon name="chevronRight" className="chev" />}
    </div>
  </div>
}

// Existing profiles (never personalised) get one discreet invitation; it can be closed for good and the configurator stays
// in Settings → My experience. New profiles do the same choice right after sign-up instead (App.jsx).
function PersonalizeInvite({ nav }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  useStore(s => s.features)
  if (S.ux || S.uxSetup || S.uxInviteDismissed || !configurable().length || !S.onboarded && !S.workouts.length) return null
  return <div className="card ux-invite">
    <button type="button" className="ux-invite-main" onClick={() => nav('/settings/experience')}>
      <span className="lrow-i"><Icon name="sparkles" /></span>
      <span className="grow"><span className="ttl">{t('Personalise your experience')}</span><span className="muted small">{t('Choose what you want to see in 2J — simple or complete.')}</span></span>
      <Icon name="chevronRight" className="chev" />
    </button>
    <button type="button" className="iconbtn ux-invite-x" aria-label={t('Dismiss')} onClick={() => update(s => { s.uxInviteDismissed = true })}><Icon name="xmark" /></button>
  </div>
}

export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const [weekOffset, setWeekOffset] = useState(0)
  const [editing, setEditing] = useState(false)
  const [guide, setGuide] = useState(false)
  const update = useStore(s => s.update)
  const startEditing = () => { setEditing(true); if (!guideSeen(S)) setGuide(true) }
  const closeGuide = () => { setGuide(false); update(s => { markGuideSeen(s) }) }
  const coachOn = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE })
  const reviewNow = pendingReviews(S, todayISO())[0] || null   // a routine due for review (shown only then)
  const followUp = useFollowUp()   // the gym's follow-up schedule; Home only shows it when a review is near or overdue

  const today = new Date()
  const routine = effectiveRoutine(S, todayISO())
  const todayOvr = S.dayPlan[todayISO()] !== undefined
  const reorder = useMemo(() => weekReorderSuggestion(S, todayISO()),
    [S.active, S.dayPlan, S.week, S.programs, S.activeProgramId, S.routines, S.workouts, todayISO()])

  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7)
  const doneDays = new Set(S.workouts.map(w => w.d))
  const strip = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i)
    const iso = isoOf(d)
    const eff = effectiveRoutineId(S, iso), ovr = S.dayPlan[iso] !== undefined, done = doneDays.has(iso)
    const dot = done ? ' done' : ovr && eff ? ' ovr' : eff ? ' plan' : ''
    strip.push(<div key={i} className={'wday' + (iso === todayISO() ? ' today' : '')} onClick={() => dayOverrideSheet(iso)}>
      <div className="lbl">{t(DAYS[d.getDay()])}</div><div className="num">{d.getDate()}</div><div className={'dot' + dot} /></div>)
  }
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
  const wkLabel = weekOffset === 0 ? t('This week') : `${monday.getDate()} ${monday.toLocaleDateString(dateLocale(), { month: 'short' })} – ${sunday.getDate()} ${sunday.toLocaleDateString(dateLocale(), { month: 'short' })}`

  const wThisWeek = S.workouts.filter(w => weekKey(w.d) === weekKey(todayISO())).length
  const plannedPerWeek = Object.values(activeWeek(S)).filter(Boolean).length
  const streak = streakWeeks(S)

  // today's session shown right under the week strip
  const todaysWorkouts = S.workouts.filter(w => w.d === todayISO())
  const doneToday = todaysWorkouts.length > 0
  const onToday = () => {
    if (S.active) nav('/workout')
    else if (doneToday) (todaysWorkouts.length === 1 ? workoutDetailSheet(todaysWorkouts[0]) : calendarSheet(todayISO()))
    else if (routine) startFlow(routine.id)
    else dayOverrideSheet(todayISO())
  }

  // The blocks of Home, in the member's order (the default order is the one Home always had). Each one keeps its own gates.
  const blocks = {
    readiness: () => <ReadinessSection compact />,
    review: () => reviewNow && <RoutineReviewCard compact review={reviewNow} onView={() => nav(reviewNow.kind === 'program' ? '/train2j/program/' + (S.programs || []).find(p => p.id === reviewNow.programId)?.catalogId : '/plan/r/' + reviewNow.routineId)} />,
    followup: () => <FollowUpCard fu={followUp} S={S} nav={nav} compact />,
    news: () => <><NewsBlock /><PersonalizeInvite nav={nav} /></>,
    week: () => <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w - 1)} aria-label={t('Previous week')}><Icon name="chevronLeft" /></button>
        <div className="small muted" style={{ fontWeight: 500 }}>{wkLabel}</div>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w + 1)} aria-label={t('Next week')}><Icon name="chevronRight" /></button>
      </div>
      <div className="week">{strip}</div>
    </div>,
    reorder: () => reorder && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <div className="row" style={{ gap: 10, marginBottom: 8 }}>
        <span className="lrow-i"><Icon name="calendar" /></span>
        <div className="grow"><div className="ttl">{t('Rearrange week')}</div><div className="muted small">{reorder.expressAvailable
          ? t('The full week has no suitable open day for {0}.', reorder.routine.name)
          : t('Move {0} to {1}.', reorder.routine.name, fmtDate(reorder.target))}</div></div>
      </div>
      <Button variant="primary" onClick={() => weekReorderSheet(reorder)}>{reorder.expressAvailable ? t('See Express options') : t('Review week change')}</Button>
    </div>,
    // Entrena con 2J: one discreet way into the official guided routines (no extra tab).
    train2j: () => uxOn(S, 'train2j') && <button className="card tappable t2-promo" onClick={() => nav('/train2j')}>
      <WorkoutCover r={{ id: 'home-promo', category: 'tabata' }} shape="square" />
      <span className="grow">
        <span className="t2-promo-k">{t('Train with 2J')}</span>
        <span className="t2-promo-t">{t('Ready-to-start workouts: Tabata, HIIT, circuits, cardio and mobility.')}</span>
      </span>
      <Icon name="chevronRight" className="chev" />
    </button>,
    premium: () => <PremiumHomeCard />,
    coach: () => coachOn && uxOn(S, 'coach') && <CoachCard nav={nav} />,
    intelligence: () => <IntelligenceToday key={user?.id || 'local'} S={S} user={user} max={1} compact showIntro />,
  }
  return <div className="narrow">
    <div className="pz-row"><button type="button" className={'pz-btn' + (editing ? ' on' : '')} onClick={() => (editing ? setEditing(false) : startEditing())} aria-pressed={editing}><Icon name="pencil" />{t('Personalise')}</button></div>
    <HomeHero S={S} user={user} routine={routine} doneToday={doneToday} rescheduled={todayOvr}
      week={{ done: wThisWeek, planned: plannedPerWeek, streak }} onToday={onToday} onWeek={() => calendarSheet()} now={today} />

    {editing
      ? <section className="pz-panel" aria-label={t('Personalise Home')}>
        <h2>{t('Personalise Home')}</h2>
        <p className="pz-lead">{t('Move, hide or add the blocks of your Home. Nothing is deleted.')}</p>
        <LayoutEditor S={S} catalog={HOME_BLOCKS} layout={homeLayoutOf(S)} canHide={isHomeOptional}
          isDefault={!S.ux?.home} onChange={l => update(s => { setLayout(s, 'home', l) })} onRestore={() => update(s => { restoreLayout(s, 'home') })} />
        <button type="button" className="btn primary pz-done" onClick={() => setEditing(false)}>{t('Done')}</button>
      </section>
      : visibleHomeBlocks(S).map(id => <Fragment key={id}>{blocks[id]()}</Fragment>)}
    {guide && <PersonalizeGuide onClose={closeGuide} />}

    {!S.routines.length && !S.active && (
      <div className="card">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <span className="lrow-i"><Icon name="sparkles" /></span>
          <div className="big" style={{ fontSize: 22 }}>{t('Welcome!')}</div>
        </div>
        <div className="muted small" style={{ marginBottom: 12 }}>{t('Set up your weekly routine to get going — or load a ready-made Push / Pull / Legs plan.')}</div>
        {coachOn && <>
          <Button variant="primary" icon="sparkles" onClick={() => nav(hasConsent(S) ? '/coach/intake' : '/coach')}>{t('Let the Coach build it')}</Button>
          <div style={{ height: 8 }} />
        </>}
        <Button variant={coachOn ? 'plain' : 'primary'} icon="sparkles" onClick={loadStarterPlan}>{t('Load starter plan (PPL)')}</Button>
        <div style={{ height: 8 }} /><Button onClick={() => nav('/plan')}>{t('Build my own plan')}</Button>
      </div>
    )}
  </div>
}
