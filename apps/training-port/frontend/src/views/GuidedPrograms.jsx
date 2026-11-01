// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Guided Programs V2 storefront. Programs only arrange existing guided-routine snapshots and
// the existing Workout/history flow; this view does not execute workouts itself.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { useGuided } from '../lib/guided-api.js'
import { flattenProgramSessions, programProgress, saveGuidedProgram, setGuidedProgramStatus, startGuidedProgram } from '../lib/guided-programs.js'
import { gymRoutineCompatibility } from '../lib/gym-profiles.js'
import { uid } from '../lib/format.js'
import { fetchTrainerMembers, fetchMemberPlan, saveMemberProgram } from '../lib/trainer-api.js'
import { t } from '../lib/i18n.js'
import { LEVEL_LABEL } from '../lib/protocol/index.js'
import { confirmSheet, startOfficialRoutine } from '../sheets.jsx'
import WorkoutCover from '../components/WorkoutCover.jsx'
import Icon from '../components/Icon.jsx'
import IntelligenceToday from '../components/IntelligenceToday.jsx'
import './guided-programs.css'

const STATUS = { active: 'In progress', paused: 'Paused', abandoned: 'Ended', completed: 'Completed' }

function AssignProgramSheet({ program, close }) {
  const toast = useUI(s => s.toast)
  const [members, setMembers] = useState(null)
  const [busy, setBusy] = useState('')
  useEffect(() => { fetchTrainerMembers().then(setMembers).catch(e => toast(e.message)) }, [toast])
  const assign = async member => {
    setBusy(member.id)
    try {
      const plan = await fetchMemberPlan(member.id)
      await saveMemberProgram({ memberId: member.id, guidedProgramId: program.id, sync: plan.sync })
      toast(t('Assigned to {0}', member.name)); close()
    } catch (e) { toast(e.message) }
    setBusy('')
  }
  return <div className="gp-assign"><h3>{t('Assign program')}</h3><p className="dim small">{t('The member gets a snapshot and starts it when they are ready.')}</p>
    <div className="list">{members === null ? <div className="dim small" style={{ padding: 12 }}>{t('Loading…')}</div> : members.map(m => <button key={m.id} className="item" disabled={!!busy} onClick={() => assign(m)}><span className="grow capitalize">{m.name}</span>{busy === m.id ? t('Saving…') : <Icon name="plus" />}</button>)}</div>
  </div>
}

function progressFor(S, p) {
  return p?.source === 'guided-v2' ? programProgress(p, S.workouts) : { total: 0, completed: 0, percent: 0, next: null }
}
function gearState(S, p) {
  const sessions = flattenProgramSessions(p)
  const checks = sessions.map(s => gymRoutineCompatibility(S, p.routines?.[s.routineId]))
  const compatible = checks.filter(x => x.compatible).length
  return { compatible, total: checks.length, kind: compatible === checks.length ? 'Compatible' : compatible ? 'Partially compatible' : 'Requires equipment' }
}
function Label({ icon, children }) { return <span className="gp-label"><Icon name={icon} />{children}</span> }
function programDuration(p) {
  const days = /^(\d+) days$/.exec(p.durationLabel || '')
  return days ? t('{0} days', Number(days[1])) : t('{0} weeks', p.weeksCount)
}
function ProgramCard({ p, status, percent, open }) {
  return <button className="gp-card" onClick={open}>
    <WorkoutCover r={{ id: p.id, category: p.cover || 'circuit' }} shape="wide">
      <span className="gp-cover-mark"><Icon name={p.cover === 'mobility' ? 'stretch' : p.cover === 'interval' ? 'bike' : p.cover === 'hiit' ? 'bolt' : 'sparkles'} /></span>
      {p.featured && <span className="gp-featured">{t('Featured')}</span>}
    </WorkoutCover>
    <span className="gp-card-body"><b>{t(p.name)}</b><small>{programDuration(p)} · {t('{0} sessions/week', p.sessionsPerWeek)}</small>
      {status && <small className="gp-status">{t(STATUS[status] || status)} · {percent}%</small>}
      <span className="gp-open">{t('View plan')} <Icon name="chevronRight" /></span>
    </span>
  </button>
}

export function GuidedProgramCatalog() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const { status, error, offline, programs, load } = useGuided()
  useEffect(() => { load(user?.id) }, [load, user?.id])
  const [help, setHelp] = useState(() => { try { return localStorage.getItem(`guided-programs-intro:v1:${user?.id || 'local'}`) !== 'done' } catch { return true } })
  const active = (S.programs || []).find(p => p.id === S.activeProgramId && p.source === 'guided-v2')
  const activeProgress = active && progressFor(S, active)
  const finishHelp = () => { try { localStorage.setItem(`guided-programs-intro:v1:${user?.id || 'local'}`, 'done') } catch {} setHelp(false) }
  return <main className="gp-page">
    <header className="gp-head"><button className="iconbtn" aria-label={t('Back')} onClick={() => nav('/train2j')}><Icon name="chevronLeft" /></button><div className="grow"><span className="t2-eyebrow">2J FITNESS CENTER</span><h1>{t('Guided programs')}</h1></div>
      <button className="iconbtn" aria-label={t('How programs work')} title={t('How programs work')} onClick={() => setHelp(true)}><Icon name="info" /></button>
    </header>
    {help && <section className="gp-intro" aria-label={t('How programs work')}><div className="gp-intro-top"><b>{t('A plan that moves at your pace')}</b><button className="iconbtn" onClick={finishHelp} aria-label={t('Close')}><Icon name="xmark" /></button></div>
      <div className="gp-steps"><span><i>1</i><b>{t('Pick a goal')}</b></span><span><i>2</i><b>{t('See your weeks')}</b></span><span><i>3</i><b>{t('Train at your pace')}</b></span></div>
      <p>{t('A program organizes sessions. Miss a day? Continue with the next one when you are ready.')}</p><button className="btn primary" onClick={finishHelp}>{t('Got it')}</button>
    </section>}
    {active && <section className="gp-active"><div className="gp-active-top"><Label icon="sparkles">{t('Continue')}</Label><span className="gp-progress-num num">{activeProgress.percent}%</span></div>
      <h2>{t(active.name)}</h2><div className="gp-progress" role="progressbar" aria-label={t('Program progress')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={activeProgress.percent}><span style={{ width: `${activeProgress.percent}%` }} /></div>
      <p>{t('Week {0} of {1}', activeProgress.next ? activeProgress.next.weekIndex + 1 : active.weeksCount, active.weeksCount)} · {t('{0} of {1} sessions', activeProgress.completed, activeProgress.total)}</p>
      {activeProgress.next && <button className="btn primary" onClick={() => startNext(S, active, activeProgress.next)}><Icon name="play" />{t('Continue program')}</button>}
    </section>}
    <section className="gp-section"><div className="gp-section-head"><div><span className="t2-eyebrow">{t('BUILT AROUND YOUR ROUTINES')}</span><h2>{t('Choose your path')}</h2></div><span className="gp-count num">{programs.length}</span></div>
      {status !== 'ready' && <div className="gp-empty" role={status === 'error' ? 'alert' : 'status'}><Icon name={offline ? 'globe' : 'sparkles'} /><b>{status === 'error' ? t('The 2J library could not be loaded') : t('Loading…')}</b><p>{status === 'error' ? error : ''}</p></div>}
      {status === 'ready' && !programs.length && <div className="gp-empty"><Icon name="sparkles" /><b>{t('Programs are not available offline yet')}</b><p>{t('Open this page while connected once to save the catalogue on this device.')}</p></div>}
      {status === 'ready' && programs.length > 0 && <div className="gp-grid">{programs.map(p => {
        const memberProgram = (S.programs || []).find(x => x.source === 'guided-v2' && x.catalogId === p.id && ['active', 'paused', 'assigned'].includes(x.status))
        const prog = memberProgram && progressFor(S, memberProgram)
        return <ProgramCard key={p.id} p={p} status={memberProgram?.status} percent={prog?.percent} open={() => nav(`/train2j/program/${p.id}`)} />
      })}</div>}
    </section>
  </main>
}

function startNext(S, memberProgram, session) {
  const routine = memberProgram.routineSnapshots?.[session.routineId]
  if (!routine) return
  startOfficialRoutine(routine, { programId: memberProgram.id, sessionId: session.sessionId, week: session.weekIndex + 1, day: session.day, routineId: session.routineId })
}

export function GuidedProgramDetail() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const { status, programs, canAssign, load, offline, error, rev } = useGuided()
  useEffect(() => { load(user?.id) }, [load, user?.id])
  const catalog = programs.find(p => p.id === id)
  const memberPrograms = S.programs || []
  const memberProgram = useMemo(() => memberPrograms.find(p => p.source === 'guided-v2' && p.catalogId === id && !['abandoned'].includes(p.status)), [memberPrograms, id])
  if (!catalog && status !== 'ready') return <main className="gp-page"><header className="gp-head"><button className="iconbtn" onClick={() => nav('/train2j/programs')} aria-label={t('Back')}><Icon name="chevronLeft" /></button><h1>{status === 'error' ? t('The 2J library could not be loaded') : t('Loading…')}</h1></header>{status === 'error' && <p role="alert">{offline ? t('You are offline') : error}</p>}</main>
  if (!catalog) return <main className="gp-page"><header className="gp-head"><button className="iconbtn" onClick={() => nav('/train2j/programs')} aria-label={t('Back')}><Icon name="chevronLeft" /></button><h1>{t('Program unavailable')}</h1></header></main>
  const plan = memberProgram || catalog
  const progress = memberProgram && progressFor(S, memberProgram)
  const fit = gearState(S, catalog)
  const sessions = flattenProgramSessions(catalog)
  const canStart = !memberProgram || ['abandoned', 'completed'].includes(memberProgram.status)
  const activate = replaceActive => {
    let result
    update(s => { result = startGuidedProgram(s, catalog, { id: user?.id, makeId: uid, replaceActive }) })
    if (!result?.ok) { toast(t(result?.reason === 'workout-in-progress' ? 'Finish your current workout before starting a program.' : 'Could not start this program.')); return }
    const next = progressFor({ ...S, programs: [...(S.programs || []), result.program] }, result.program).next
    if (next) startNext({ ...S, programs: [...(S.programs || []), result.program] }, result.program, next)
  }
  const save = () => {
    let result
    update(s => { result = saveGuidedProgram(s, catalog, { id: user?.id, makeId: uid, rev }) })
    toast(result?.ok ? t('Saved to your plan — start it whenever you like.') : result?.reason === 'already-saved' ? t('Already in your plan') : t('Could not save this program.'))
  }
  const begin = () => {
    if (S.active) { toast(t('Finish your current workout before starting a program.')); return }
    if (S.activeProgramId && !memberProgram) {
      confirmSheet({ title: t('Switch active program?'), message: t('Your current plan will stay saved. The new program will become active.'), confirmText: t('Start program'), onConfirm: () => activate(true) })
      return
    }
    activate(false)
  }
  const resume = () => {
    let ok = false
    update(s => { ok = setGuidedProgramStatus(s, memberProgram.id, 'active') })
    if (!ok) { toast(t('Finish or pause your other active plan first.')); return }
    const next = progressFor({ ...S, programs: (S.programs || []).map(p => p.id === memberProgram.id ? { ...p, status: 'active' } : p) }, memberProgram).next
    if (next) startNext(S, memberProgram, next)
  }
  const abandon = () => confirmSheet({ title: t('End this program?'), message: t('Your completed workouts stay in history. You can start this plan again later.'), confirmText: t('End program'), danger: true,
    onConfirm: () => update(s => { setGuidedProgramStatus(s, memberProgram.id, 'abandoned') }) })
  return <main className="gp-page gp-detail">
    <header className="gp-head"><button className="iconbtn" aria-label={t('Back')} onClick={() => nav('/train2j/programs')}><Icon name="chevronLeft" /></button><div className="grow"><span className="t2-eyebrow">2J FITNESS CENTER</span><h1>{t(catalog.name)}</h1></div><Label icon="sparkles">{t('Official')}</Label></header>
    {memberProgram?.id === S.activeProgramId && <IntelligenceToday S={S} user={user} max={1} compact types={['PROGRAM_NEXT_SESSION', 'MISSED_SESSION']} />}
    <section className="gp-hero"><WorkoutCover r={{ id: catalog.id, category: catalog.cover }} shape="wide"><span className="gp-hero-orbit" /><div className="gp-hero-title"><span>{t('A plan built for real life')}</span><strong>{programDuration(catalog)}</strong></div></WorkoutCover>
      <p className="gp-desc">{t(catalog.description)}</p>
      <div className="gp-facts"><Label icon="calendar">{t('{0} weeks', catalog.weeksCount)}</Label><Label icon="bolt">{t('{0} sessions/week', catalog.sessionsPerWeek)}</Label><Label icon="target">{t(LEVEL_LABEL[catalog.level])}</Label><Label icon="dumbbell">{catalog.equipment.map(e => t(e)).join(' · ')}</Label></div>
      <div className={'gp-fit ' + (fit.compatible === fit.total ? 'good' : fit.compatible ? 'partial' : 'missing')}><Icon name={fit.compatible === fit.total ? 'checkCircle' : 'info'} /><span><b>{t(fit.kind)}</b><small>{t('{0} of {1} sessions fit your active training place. Other sessions remain available; unavailable exercises follow existing Gym Profile substitutions/skips.', fit.compatible, fit.total)}</small></span></div>
    </section>
    {memberProgram && <section className="gp-active gp-detail-progress"><div className="gp-active-top"><Label icon="chart">{t(STATUS[memberProgram.status] || memberProgram.status)}</Label><span className="gp-progress-num num">{progress.percent}%</span></div><div className="gp-progress" role="progressbar" aria-label={t('Program progress')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress.percent}><span style={{ width: `${progress.percent}%` }} /></div><p>{t('{0} of {1} sessions complete', progress.completed, progress.total)}{progress.next ? ` · ${t('Week {0}', progress.next.weekIndex + 1)}` : ''}</p></section>}
    <section className="gp-section"><div className="gp-section-head"><div><span className="t2-eyebrow">{t('YOUR PLAN')}</span><h2>{t('Week by week')}</h2></div></div>
      <div className="gp-weeks">{catalog.weeks.map((week, wi) => <article className="gp-week" key={wi}><header><span>{t('WEEK')} {wi + 1}</span><b>{t('{0} sessions', week.sessions.length)}</b></header><div>{week.sessions.map((s, di) => { const r = catalog.routines?.[s.routineId]; return <div className="gp-session" key={di}><i>{String(di + 1).padStart(2, '0')}</i><span className="grow"><b>{t(r?.name || 'Session')}</b><small>~{r?.estimatedMinutes || 0} min · {t(LEVEL_LABEL[r?.level || catalog.level])}</small></span><Icon name="chevronRight" /></div> })}</div></article>)}</div>
    </section>
    {catalog.lowImpact && <p className="gp-safety"><Icon name="info" />{t('Move within a comfortable range. Stop if you feel pain and speak with your trainer. This plan is not medical advice.')}</p>}
    <footer className="gp-cta">{memberProgram?.status === 'active' && <button className="btn plain" onClick={() => update(s => { setGuidedProgramStatus(s, memberProgram.id, 'paused') })}>{t('Pause')}</button>}
      {['paused', 'assigned'].includes(memberProgram?.status) && <button className="btn tinted" onClick={resume}>{t(memberProgram.status === 'assigned' ? 'Start program' : 'Resume')}</button>}
      {memberProgram && !['completed', 'abandoned'].includes(memberProgram.status) && <button className="btn plain danger" onClick={abandon}>{t('End')}</button>}
      {memberProgram?.status === 'active' && progress.next && <button className="btn primary" onClick={() => startNext(S, memberProgram, progress.next)}><Icon name="play" />{t('Continue program')}</button>}
      {!memberProgram && <button className="btn plain" onClick={save}><Icon name="plus" />{t('Save for later')}</button>}
      {canStart && <button className="btn primary" onClick={begin}><Icon name="play" />{t('Start program')}</button>}
      {memberProgram?.status === 'completed' && <span className="gp-complete"><Icon name="checkCircle" />{t('Program completed')}</span>}
      {canAssign && <button className="btn plain" onClick={() => openSheet(close => <AssignProgramSheet program={catalog} close={close} />)}><Icon name="users" />{t('Assign')}</button>}
    </footer>
  </main>
}
