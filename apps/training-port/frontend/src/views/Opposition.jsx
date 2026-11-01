// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Entrena tus Oposiciones, member side: choose the exam (an official profile), a short intake, the plan by phases (6/12/18/24 months), the running plan with
// the member's level per capacity, marks against the official minimum, the control week and the proposal for the next block. The training itself runs on the
// Premium engine (the member's session page is /premium/active); everything here is state in S.opposition, pinned to the profile version it was built on.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { useOpposition } from '../lib/opposition-api.js'
import { usePremium } from '../lib/premium-api.js'
import { activePlanOf, setAsidePlan, premiumState } from '../lib/premium.js'
import * as model from '../lib/opposition-model.js'
import * as op from '../lib/opposition.js'
import { keyOf } from '../lib/premium-model.js'
import { CAP_LABEL, QUALITY_LABEL, PHASE_LABEL, STATUS_LABEL, LEVEL_LABEL, BODY_LABEL, AMBITION_LABEL, AMBITION_HINT, REASON_LABEL, RESTRICTION_LABEL, EQUIPMENT_LABEL, EXP_LABEL, FATIGUE_LABEL, DIFF_LABEL } from '../lib/opposition-text.js'
import { allowedByAdmin } from '../lib/features.js'
import { fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import PremiumCover from '../components/PremiumCover.jsx'
import './premium.css'
import './opposition.css'

const OPPOSITION_COVER = { coverImage: op.COVER.image, coverImageAlt: op.COVER.alt, coverFocalPoint: op.COVER.focal }

function Back({ to }) {
  const nav = useNavigate()
  return <button className="pm-back" aria-label={t('Back')} onClick={() => nav(to)}><Icon name="chevronLeft" /></button>
}
const Chip = ({ on, children, onClick, disabled }) => <button type="button" className={'op-chip' + (on ? ' on' : '')} aria-pressed={!!on} disabled={disabled} onClick={onClick}>{children}</button>
const StatusPill = ({ s }) => <span className={'op-status ' + s}>{t(STATUS_LABEL[s] || 'No mark yet')}</span>
const LevelPill = ({ l, estimated }) => <span className={'op-level ' + l}>{t(LEVEL_LABEL[l])}{estimated ? ' · ' + t('estimated') : ''}</span>

/** The hub: with a plan, the plan; without one, the choice of exam. */
export function OppositionHub() {
  const user = useStore(s => s.user)
  const S = useStore(s => s.S)
  const cat = useOpposition()
  const premium = usePremium()
  useEffect(() => { cat.load(user?.id); premium.load(user?.id) }, [user?.id])   // eslint-disable-line react-hooks/exhaustive-deps
  const view = op.planView(S)
  if (view) return <OppositionActive view={view} cat={cat} />
  const entry = premium.programs.find(p => p.slug === op.OPPOSITION_SLUG)
  const staff = cat.canEdit || premium.canAuthor
  const available = allowedByAdmin('premium') && cat.enabled && premium.enabled && (!!entry || staff)
  return <OppositionIntro cat={cat} available={available} loading={cat.status === 'loading' || premium.status === 'loading'} staff={staff} />
}

function OppositionIntro({ cat, available, loading, staff }) {
  const nav = useNavigate()
  const [pick, setPick] = useState(null)
  const published = cat.profiles.filter(p => p.status === 'published' || staff)
  if (pick) return <OppositionWizard summary={pick} close={() => setPick(null)} />
  return <main className="pm-page op-page">
    <PremiumCover p={OPPOSITION_COVER} ratio="16 / 9" eager className="pm-detail-cover short">
      <div className="pm-hero-top over"><Back to="/premium" />{staff && <button className="pm-ghost" onClick={() => nav('/oposiciones/manage')}><Icon name="gear" />{t('Manage')}</button>}</div>
      <span className="pm-detail-cap"><span className="pm-kicker">2J PREMIUM</span><h1>{t('Train for your public-service exam')}</h1></span>
    </PremiumCover>
    <div className="pm-detail-body">
      <p className="op-lead">{t('A full physical-preparation plan — strength, power, speed, endurance and more — built to pass the physical tests of your exam. The official tests and marks only set your starting point, your targets and your checkpoints.')}</p>
      {loading && <div className="pm-empty" role="status"><b>{t('Loading…')}</b></div>}
      {!loading && !available && <section className="pm-empty" role="status"><Icon name="info" /><b>{t('Not available yet')}</b><p>{t('Your gym has not opened this plan yet. Come back later — your training is not affected.')}</p></section>}
      {!loading && available && published.length === 0 && <section className="pm-empty" role="status"><Icon name="info" /><b>{t('No exam is published yet')}</b><p>{t('Ask your trainer to add the official tests of your convocatoria. Nothing is invented: a plan needs the real tests and marks.')}</p></section>}
      {available && published.length > 0 && <section className="pm-sec"><h2>{t('Choose your exam')}</h2><div className="pm-sec-body op-list">
        {published.map(p => <button key={p.id} className="op-profile" onClick={() => setPick(p)}>
          <span className="op-profile-top"><b>{p.name}</b>{p.status !== 'published' && <span className="pm-badge muted">{t('Hidden')}</span>}</span>
          <small>{t(BODY_LABEL[p.body] || 'Other')} · {p.organism}</small>
          <small className="dim">{t('Official source')}: {p.source.reference} · {fmtDate(p.source.date)}</small>
          <span className="op-tags">{p.tests.map(x => <i key={x.id}>{x.name.split(' · ')[0]}</i>)}</span>
        </button>)}
        <p className="dim small">{t('Another organism or convocatoria? Each one has its own tests. Ask your trainer to add it: the plan always follows the official profile.')}</p>
      </div></section>}
    </div>
  </main>
}

/* ------------------------------------------------------------------------------------------------ the intake */
const DAYS = [2, 3, 4, 5, 6]
const MINUTES = [30, 45, 60, 75, 90, 120]

export function OppositionWizard({ summary, close, initialProfile = null }) {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const user = useStore(s => s.user)
  const cat = useOpposition()
  const [profile, setProfile] = useState(initialProfile)
  const [err, setErr] = useState('')
  const [step, setStep] = useState(0)
  const [f, setF] = useState({ organism: '', convocatoria: '', testVersion: '', sex: null, age: '', yearsTraining: 1, selfLevel: 'beginner', runningExp: 'some', swimmingExp: 'some', days: 4, minutes: 60, equipment: { gym: true, track: true, pool: true, bar: true, weights: true }, restrictions: [], examDate: '', months: null, ambition: 'pass', marks: {} })
  useEffect(() => { if (!initialProfile) cat.detail(summary.id).then(setProfile).catch(e => setErr(e.message)) }, [summary.id])   // eslint-disable-line react-hooks/exhaustive-deps
  const set = patch => setF(v => ({ ...v, ...patch }))
  const intake = useMemo(() => model.sanitizeIntake({ ...f, age: f.age === '' ? null : Number(f.age), days: f.days, minutes: f.minutes }), [f])
  if (err) return <main className="pm-page op-page"><header className="pm-hero"><div className="pm-hero-top"><Back to="/premium" /></div><h1>{t('Program unavailable')}</h1></header><p className="pm-note warn"><Icon name="info" />{err}</p></main>
  if (!profile) return <main className="pm-page op-page"><header className="pm-hero"><div className="pm-hero-top"><Back to="/premium" /></div><h1>{t('Loading…')}</h1></header></main>

  const needsSex = model.needsSex(profile), needsAge = model.needsAge(profile)
  const cats = model.categoryOf(profile, { sex: intake.sex, age: intake.age })
  const tests = cats ? model.testsFor(profile, cats) : profile.tests
  const now = Date.now()
  const months = f.months || model.horizonFor(f.examDate, now) || null
  const marks = Object.fromEntries(tests.map(x => [x.id, op.parseMark(f.marks[x.id], x.kind)]).filter(([, v]) => v != null))
  const asks = profile.askBeforeStart || []
  const missing = model.missingForPlan(profile, intake, f.examDate || null, months)
  const steps = ['exam', 'you', 'time', 'date', 'marks', 'summary']
  const stepKey = steps[step]
  const stepOk = { exam: !(asks.includes('organism') && !f.organism.trim()) && !(asks.includes('convocatoria') && !f.convocatoria.trim()), you: (!needsSex || !!f.sex) && (!needsAge || (f.age !== '' && Number(f.age) >= 16)), time: true, date: !!months, marks: true, summary: !missing.length }[stepKey]
  const levels = cats ? model.levelsOf(profile, cats, marks, f.selfLevel) : null
  const preview = cats && !missing.length ? model.newPlan({ profile, intake, marks, examDate: f.examDate || null, months, ambition: f.ambition, now, id: 'preview' }) : null
  const replaced = activePlanOf(S)
  const running = premiumState(S).active

  const create = () => {
    const r = op.startPlan(S, { profile, intake, marks, examDate: f.examDate || null, months, ambition: f.ambition, now })
    if (r.error) { toast(t('The plan could not be created: some data is missing')); return }
    update(s => { setAsidePlan(s); s.opposition = r.opposition; s.premium = r.premium })
    useOpposition.getState().started(profile.id)
    toast(t('Your plan is ready'))
    nav('/oposiciones', { replace: true })
  }
  const back = () => (step === 0 ? close() : setStep(step - 1))
  return <main className="pm-page op-page">
    <header className="pm-hero"><div className="pm-hero-top"><button className="pm-back" aria-label={t('Back')} onClick={back}><Icon name="chevronLeft" /></button><span className="op-step">{t('Step {0} of {1}', step + 1, steps.length)}</span></div>
      <h1>{profile.name}</h1></header>
    <div className="pm-bar op-stepbar" role="progressbar" aria-valuemin="0" aria-valuemax={steps.length} aria-valuenow={step + 1}><i style={{ width: ((step + 1) / steps.length * 100) + '%' }} /></div>

    {stepKey === 'exam' && <section className="pm-sec"><h2>{t('Your exam')}</h2><div className="pm-sec-body">
      <ul className="op-facts">
        <li><span>{t('Organism')}</span><b>{profile.organism}</b></li>
        <li><span>{t('Convocatoria')}</span><b>{profile.convocatoria?.title}</b></li>
        <li><span>{t('Official source')}</span><b>{profile.source.publication} · {profile.source.reference}</b></li>
        <li><span>{t('Source date')}</span><b>{fmtDate(profile.source.date)} · {t('version {0}', profile.version)}</b></li>
      </ul>
      {profile.validUntil && profile.validUntil < new Date().toISOString().slice(0, 10) && <p className="pm-note warn"><Icon name="info" />{t('This profile was valid until {0}: check the bases of your current convocatoria.', fmtDate(profile.validUntil))}</p>}
      <p className="op-warn"><Icon name="info" />{t('Each convocatoria can change the tests or the marks. Check the official bases of yours: if they differ from this profile, ask your trainer to update it.')}</p>
      {asks.includes('organism') && <label className="pm-field"><span>{t('Which organism is your exam for?')}</span><input className="pm-input" value={f.organism} maxLength={160} onChange={e => set({ organism: e.target.value })} placeholder={profile.organism} /></label>}
      {asks.includes('convocatoria') && <label className="pm-field"><span>{t('Which convocatoria or year?')}</span><input className="pm-input" value={f.convocatoria} maxLength={200} onChange={e => set({ convocatoria: e.target.value })} /></label>}
      {asks.includes('testVersion') && <label className="pm-field"><span>{t('Version of the tests (if you know it)')}</span><input className="pm-input" value={f.testVersion} maxLength={80} onChange={e => set({ testVersion: e.target.value })} /></label>}
      {asks.includes('organism') && f.organism.trim() && !profile.organism.toLowerCase().includes(f.organism.trim().toLowerCase().slice(0, 12)) && <p className="pm-note warn"><Icon name="info" />{t('This profile belongs to {0}. If your organism uses different tests, ask your trainer to add its profile before you start.', profile.organism)}</p>}
      <h3 className="op-h3">{t('Tests of this exam')}</h3>
      <ul className="op-tests">{profile.tests.map(x => <li key={x.id}><b>{x.name}</b><small>{x.description}</small>{x.notes && <small className="dim">{x.notes}</small>}</li>)}</ul>
      {profile.notes?.map((n, i) => <p key={i} className="dim small">{n}</p>)}
    </div></section>}

    {stepKey === 'you' && <section className="pm-sec"><h2>{t('About you')}</h2><div className="pm-sec-body">
      {needsSex && <div className="pm-field"><span>{t('Sex (the official marks depend on it)')}</span><div className="op-chips">{['m', 'f'].map(x => <Chip key={x} on={f.sex === x} onClick={() => set({ sex: x })}>{x === 'm' ? t('Male') : t('Female')}</Chip>)}</div></div>}
      {needsAge && <label className="pm-field"><span>{t('Age (the official marks depend on it)')}</span><input className="pm-input" type="number" inputMode="numeric" min="16" max="70" value={f.age} onChange={e => set({ age: e.target.value })} /></label>}
      {!needsSex && !needsAge && <p className="dim small">{t('The marks of this exam do not depend on your sex or age, so we do not ask for them.')}</p>}
      <label className="pm-field"><span>{t('Years training regularly')}</span><input className="pm-input" type="number" inputMode="decimal" min="0" max="60" value={f.yearsTraining} onChange={e => set({ yearsTraining: e.target.value })} /></label>
      <div className="pm-field"><span>{t('How do you rate your level overall?')}</span><div className="op-chips">{model.LEVELS.map(l => <Chip key={l} on={f.selfLevel === l} onClick={() => set({ selfLevel: l })}>{t(LEVEL_LABEL[l])}</Chip>)}</div><small className="dim">{t('Only used for what you cannot measure yet: your marks decide your level.')}</small></div>
      <div className="pm-field"><span>{t('Running experience')}</span><div className="op-chips">{['none', 'some', 'regular'].map(x => <Chip key={x} on={f.runningExp === x} onClick={() => set({ runningExp: x })}>{t(EXP_LABEL[x])}</Chip>)}</div></div>
      {profile.tests.some(x => x.capacity === 'swim') && <div className="pm-field"><span>{t('Swimming experience')}</span><div className="op-chips">{['none', 'some', 'regular'].map(x => <Chip key={x} on={f.swimmingExp === x} onClick={() => set({ swimmingExp: x })}>{t(EXP_LABEL[x])}</Chip>)}</div></div>}
    </div></section>}

    {stepKey === 'time' && <section className="pm-sec"><h2>{t('Your time and equipment')}</h2><div className="pm-sec-body">
      <div className="pm-field"><span>{t('Days per week you can train')}</span><div className="op-chips">{DAYS.map(d => <Chip key={d} on={f.days === d} onClick={() => set({ days: d })}>{d}</Chip>)}</div></div>
      <div className="pm-field"><span>{t('Minutes per session')}</span><div className="op-chips">{MINUTES.map(m => <Chip key={m} on={f.minutes === m} onClick={() => set({ minutes: m })}>{m}</Chip>)}</div></div>
      <div className="pm-field"><span>{t('What do you have access to?')}</span><div className="op-chips">{Object.keys(EQUIPMENT_LABEL).map(k => <Chip key={k} on={f.equipment[k]} onClick={() => set({ equipment: { ...f.equipment, [k]: !f.equipment[k] } })}>{t(EQUIPMENT_LABEL[k])}</Chip>)}</div></div>
      <div className="pm-field"><span>{t('Injuries or areas to protect')}</span><div className="op-chips">{model.RESTRICTIONS.map(k => <Chip key={k} on={f.restrictions.includes(k)} onClick={() => set({ restrictions: f.restrictions.includes(k) ? f.restrictions.filter(x => x !== k) : [...f.restrictions, k] })}>{t(RESTRICTION_LABEL[k])}</Chip>)}</div>
        <small className="dim">{t('The plan avoids the exercises that load these areas. It does not replace a medical opinion.')}</small></div>
    </div></section>}

    {stepKey === 'date' && <section className="pm-sec"><h2>{t('Your exam date')}</h2><div className="pm-sec-body">
      <label className="pm-field"><span>{t('Exam date (if you know it)')}</span><input className="pm-input" type="date" min={new Date().toISOString().slice(0, 10)} value={f.examDate} onChange={e => set({ examDate: e.target.value, months: null })} /></label>
      <div className="pm-field"><span>{t('How long do you want to prepare?')}</span><div className="op-chips">{model.HORIZONS.map(h => <Chip key={h} on={months === h} onClick={() => set({ months: h })}>{t('{0} months', h)}</Chip>)}</div>
        <small className="dim">{f.examDate ? t('With an exam date, the plan lasts until that day: {0} weeks.', model.totalWeeks(months, f.examDate, now)) : t('Without a date, the plan lasts the months you choose.')}</small></div>
      <div className="pm-field"><span>{t('Your goal')}</span><div className="op-chips">{model.AMBITIONS.map(a => <Chip key={a} on={f.ambition === a} onClick={() => set({ ambition: a })}>{t(AMBITION_LABEL[a])}</Chip>)}</div><small className="dim">{t(AMBITION_HINT[f.ambition])}</small></div>
    </div></section>}

    {stepKey === 'marks' && <section className="pm-sec"><h2>{t('Your current marks')}</h2><div className="pm-sec-body">
      <p className="dim small">{t('Enter your best recent mark in each test. Leave it empty if you do not know it: nothing is invented, and your first control week will measure it.')}</p>
      {cats ? tests.map(x => {
        const sc = model.scoreMark(profile, x, cats, marks[x.id])
        const scale = x.marks[cats] || x.marks['*'] || []
        return <label key={x.id} className="pm-field op-mark"><span>{x.name}</span>
          <input className="pm-input" inputMode={x.kind === 'time' && x.unit === 's' && (x.distanceM || 0) >= 400 ? 'text' : 'decimal'} value={f.marks[x.id] ?? ''} placeholder={x.kind === 'time' && (x.distanceM || 0) >= 400 ? t('e.g. 3:24') : t('unit: {0}', x.unit)} onChange={e => set({ marks: { ...f.marks, [x.id]: e.target.value } })} />
          <small className="dim">{t('Official minimum')}: {scale.length ? op.formatMark(x, scale[0].v) : '—'}{sc ? ` · ${sc.passed ? t('you meet it') : t('below the minimum')}${profile.scoring.model === 'points' ? ` · ${sc.points} ${t('points')}` : ''}` : ''}</small></label>
      }) : <p className="pm-note warn"><Icon name="info" />{t('Go back and tell us your sex and age first: the official marks depend on them.')}</p>}
    </div></section>}

    {stepKey === 'summary' && <section className="pm-sec"><h2>{t('Your plan')}</h2><div className="pm-sec-body">
      {missing.length > 0 && <p className="pm-note warn"><Icon name="info" />{t('Some data is missing: {0}.', missing.map(k => ({ sex: t('sex'), age: t('age'), horizon: t('how long you want to prepare'), organism: t('organism'), convocatoria: t('convocatoria') }[k] || k)).join(', '))}</p>}
      {levels && <><h3 className="op-h3">{t('Your starting level')}</h3>
        <div className="op-levels">{Object.entries(levels.byCapacity).map(([c, x]) => <div key={c}><span>{t(CAP_LABEL[c])}</span><LevelPill l={x.level} estimated={x.estimated} /></div>)}</div>
        <p className="dim small">{levels.global.estimated ? t('We have no marks yet, so these levels are an estimate from what you told us. The first control week will measure them.') : t('Calculated from your marks, test by test.')}</p></>}
      {cats && <><h3 className="op-h3">{t('What we will train')}</h3><div className="op-focus">{model.qualitiesOf(profile, cats).map(q => <i key={q}>{t(QUALITY_LABEL[q])}</i>)}</div>
        <p className="dim small">{t('The marks only set your starting point and targets: the plan is real gym, track and conditioning work for each of these.')}</p></>}
      {preview?.plan && <><h3 className="op-h3">{t('Phases')}</h3><Phases plan={preview.plan} week={1} /></>}
      <ul className="op-facts"><li><span>{t('Length')}</span><b>{preview?.plan ? t('{0} weeks', preview.plan.weeksTotal) : '—'}</b></li><li><span>{t('Training')}</span><b>{t('{0} days · {1} min', f.days, f.minutes)}</b></li><li><span>{t('Control tests')}</span><b>{t('Every 5 weeks')}</b></li></ul>
      {replaced && <div className="pm-replace" role="alert"><Icon name="info" /><div><b>{t('Premium programs use their own periodisation.')}</b><p>{t('If you start this program, it will replace your current active planning ({0}).', replaced.name)}</p><p>{t('Your history, completed workouts and saved routines will not be deleted.')}</p></div></div>}
      {running && !String(running.programId).startsWith('opposition-') && <p className="pm-note"><Icon name="info" />{t('Your current program ({0}) will be closed and kept in your history.', running.name)}</p>}
      <p className="dim small">{t('Nothing changes by itself: at every control you review a proposal and confirm it.')}</p>
    </div></section>}

    <div className="op-nav">
      {stepKey !== 'summary'
        ? <button className="pm-primary" disabled={!stepOk} onClick={() => setStep(step + 1)}>{t('Continue')}</button>
        : <button className="pm-primary" disabled={!stepOk} onClick={create}>{replaced ? t('Continue') : t('Create my plan')}</button>}
    </div>
  </main>
}

/* ------------------------------------------------------------------------------------------------ the running plan */
function Phases({ plan, week }) {
  const total = plan.weeksTotal
  return <div className="op-phases">
    <div className="op-phasebar" role="img" aria-label={t('Plan phases')}>{plan.phases.filter(p => p.weeks > 0).map(p => <i key={p.phase} className={p.phase + (week >= p.from && week <= p.to ? ' now' : '')} style={{ flexGrow: p.weeks }} title={t(PHASE_LABEL[p.phase])} />)}
      <b className="op-marker" style={{ left: Math.min(98, Math.max(0, (week - 0.5) / total * 100)) + '%' }} /></div>
    <ul className="op-phaselist">{plan.phases.filter(p => p.weeks > 0).map(p => <li key={p.phase} className={week >= p.from && week <= p.to ? 'now' : ''}><i className={p.phase} /><span>{t(PHASE_LABEL[p.phase])}</span><small>{t('{0} weeks', p.weeks)}</small></li>)}</ul>
  </div>
}

function OppositionActive({ view, cat }) {
  const nav = useNavigate()
  const update = useStore(s => s.update)
  const S = useStore(s => s.S)
  const openSheet = useUI(s => s.openSheet)
  const { plan, summary } = view
  const profile = plan.profile
  const tests = model.testsFor(profile, plan.category)
  const newer = op.newerVersion(plan, cat.profiles)
  const last = plan.evaluations[plan.evaluations.length - 1] || null
  const next = view.inst && view.pos?.session ? view.pos.session.title : null
  const qualities = model.qualitiesOf(profile, plan.category)
  const wk = view.inst ? view.inst.snapshot.definition.weeks[(view.pos?.week || 1) - 1] : null
  const weekSessions = (wk?.sessions || []).map((x, i) => ({ key: x.key, title: x.title, blocks: x.blocks.length, done: !!view.pos?.doneKeys?.has(keyOf(view.pos.cycle, view.pos.week, i)), next: view.pos?.index === i }))
  const end = () => confirmSheet({ title: t('End this plan?'), message: t('Your workouts, records and history stay. The plan moves to your history.'), confirmText: t('End plan'), danger: true,
    onConfirm: () => update(s => { const r = op.endPlan(s); s.opposition = r.opposition; s.premium = r.premium }) })
  const again = () => update(s => { s.opposition = op.reproposeNext(s) })
  const restart = () => { const r = op.resumeBlock(useStore.getState().S, {}); if (!r.error) update(s => { s.premium = r.premium }) }
  return <main className="pm-page op-page op-running">
    <PremiumCover p={OPPOSITION_COVER} ratio="16 / 10" eager className="pm-detail-cover short">
      <div className="pm-hero-top over"><Back to="/premium" /><span className={'pm-badge ' + (view.finished ? 'muted' : 'green')}>{t(PHASE_LABEL[view.controlWeek ? 'control' : view.phase])}</span></div>
      <span className="pm-detail-cap"><span className="pm-kicker">{t('Your plan')}</span><h1>{profile.name}</h1>
        <span className="pm-facts"><span><Icon name="calendar" />{plan.examDate ? t('Exam {0}', fmtDate(plan.examDate)) : t('{0} months', plan.months)}</span><span>{t('{0} weeks left', view.weeksLeft)}</span></span></span>
    </PremiumCover>
    <div className="pm-detail-body">
      {newer && <section className="op-banner" role="status"><Icon name="info" /><div><b>{t('There is a new version of this convocatoria')}</b><p>{t('Your plan keeps using version {0} until you decide. Review what changed first.', plan.profileVersion)}</p></div>
        <button className="pm-ghost" onClick={() => openSheet(close => <VersionSheet plan={plan} newer={newer} close={close} />)}>{t('Review changes')}</button></section>}

      {!view.finished && <section className="pm-sec next"><h2>{view.canEvaluate ? t('Control week') : view.blockDone ? t('Block completed') : t('This week')}</h2><div className="pm-sec-body">
        <p className="op-phase-line"><b>{t(PHASE_LABEL[view.controlWeek ? 'control' : view.phase])}</b> · {t('Week {0} of {1} · block {2}', Math.min(view.calendarWeek, plan.weeksTotal), plan.weeksTotal, plan.blockIndex + 1)}</p>
        <div className="op-focus" aria-label={t('What we are training')}>{qualities.map(q => <i key={q}>{t(QUALITY_LABEL[q])}</i>)}</div>
        {weekSessions.length > 0 && <ul className="op-week-list">{weekSessions.map((x, i) => <li key={x.key} className={(x.done ? 'done ' : '') + (x.next ? 'next' : '')}>
          <Icon name={x.done ? 'checkCircle' : 'dot'} /><span><b>{x.title}</b><small>{t('{0} exercises', x.blocks)}</small></span>{x.next && <em>{t('Next')}</em>}</li>)}</ul>}
        {view.inst && <div className="pm-prog"><span className="pm-bar" role="progressbar" aria-label={t('Program progress')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(view.pos.finished * 100 / view.pos.totalInCycle)}><i style={{ width: Math.round(view.pos.finished * 100 / view.pos.totalInCycle) + '%' }} /></span>
          <small>{t('{0} of {1} sessions this cycle', view.pos.completedInCycle, view.pos.totalInCycle)}</small></div>}
        {view.noBlock && <p className="pm-note warn"><Icon name="info" />{t('This plan has no block running. Prepare the next one below.')}</p>}
        <div className="pm-actions">
          {view.inst && !view.blockDone && <button className="pm-primary" onClick={() => nav('/premium/active')}><Icon name="play" />{next ? t('Start: {0}', next) : t('Go to my training')}</button>}
          {view.noBlock && <button className="pm-primary" onClick={restart}><Icon name="play" />{t('Restart this block')}</button>}
          {view.canEvaluate && <button className="pm-primary alt" onClick={() => openSheet(close => <EvaluationSheet view={view} close={close} />)}><Icon name="target" />{t('Record my control marks')}</button>}
        </div></div></section>}

      {plan.proposal && <ProposalCard view={view} />}
      {!plan.proposal && (view.blockDone || view.noBlock) && last && <section className="pm-sec"><h2>{t('Next block')}</h2><div className="pm-sec-body"><p className="dim small">{t('You have recorded your control. Prepare the next block when you are ready.')}</p>
        <button className="pm-primary" onClick={again}>{t('Prepare the next block')}</button></div></section>}

      <section className="pm-sec"><h2>{t('Phase and evolution')}</h2><div className="pm-sec-body"><Phases plan={plan} week={Math.min(view.calendarWeek, plan.weeksTotal)} />
        <div className="op-levels"><div className="global"><span>{t('Overall')}</span><LevelPill l={plan.levels.global.level} estimated={plan.levels.global.estimated} /></div>
          {Object.entries(plan.levels.byCapacity).map(([c, x]) => <div key={c}><span>{t(CAP_LABEL[c])}</span><LevelPill l={x.level} estimated={x.estimated} /></div>)}</div>
        {plan.levels.global.estimated && <p className="dim small">{t('Some levels are estimated: record your marks in the control week to measure them.')}</p>}
        {plan.evaluations.length > 0 && <p className="dim small">{t('Controls done')}: {plan.evaluations.length}</p>}</div></section>

      <details className="pm-sec op-details"><summary><h2>{t('Tests and marks')}</h2><small>{t('Your marks against the official minimum and your target')}</small></summary><div className="pm-sec-body">
        <ul className="op-marks">{tests.map(x => {
          const s = summary.tests.find(y => y.id === x.id)
          const st = last?.perTest?.[x.id]?.status || (s?.mark == null ? 'no-data' : null)
          return <li key={x.id}><div className="op-mark-head"><b>{x.name}</b>{st && <StatusPill s={st} />}</div>
            <div className="op-mark-row"><span><small>{t('Now')}</small>{op.formatMark(x, s?.mark)}</span><span><small>{t('Minimum')}</small>{op.formatMark(x, s?.minimum)}</span><span><small>{t('Target')}</small>{op.formatMark(x, s?.target)}</span>{s?.initial != null && s.mark !== s.initial && <span><small>{t('Start')}</small>{op.formatMark(x, s.initial)}</span>}</div>
            {s?.points != null && profile.scoring.model === 'points' && <small className="dim">{s.points} {t('points')}</small>}</li>
        })}</ul>
        {last && <p className="dim small">{t('Last control')}: {fmtDate(new Date(last.at).toISOString().slice(0, 10))}{last.overall.average != null && profile.scoring.rule.kind === 'average' ? ` · ${t('average')} ${last.overall.average}` : ''}</p>}
        {last?.needsReview && <p className="pm-note warn"><Icon name="info" />{t('Your trainer will review this plan.')}</p>}
        <h3 className="op-h3">{t('Official source')}</h3><ul className="op-facts">
          <li><span>{t('Organism')}</span><b>{profile.organism}</b></li><li><span>{t('Convocatoria')}</span><b>{profile.convocatoria?.title}</b></li>
          <li><span>{t('Publication')}</span><b>{profile.source.publication}</b></li><li><span>{t('Reference')}</span><b>{profile.source.reference}</b></li>
          <li><span>{t('Source date')}</span><b>{fmtDate(profile.source.date)} · {t('version {0}', plan.profileVersion)}</b></li></ul>
        {profile.notes?.map((n, i) => <p key={i} className="dim small">{n}</p>)}</div></details>

      <div className="pm-actions wide"><button className="pm-ghost danger" onClick={end}>{t('End plan')}</button></div>
      <History items={op.oppositionState(S).history} />
    </div>
  </main>
}

function History({ items }) {
  if (!items.length) return null
  return <section className="pm-sec"><h2>{t('Previous plans')}</h2><div className="pm-sec-body"><ul className="pm-list">{items.slice().reverse().map(h => <li key={h.id}><Icon name="check" />{h.name} · {t('version {0}', h.profileVersion)} · {fmtDate(new Date(h.startedAt).toISOString().slice(0, 10))}</li>)}</ul></div></section>
}

function ProposalCard({ view }) {
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const { plan } = view
  const p = plan.proposal
  const confirm = () => {
    const r = op.confirmProposal(useStore.getState().S, {})
    if (r.error) return
    update(s => { s.opposition = r.opposition; s.premium = r.premium })
    toast(t('Next block started'))
  }
  const phaseOf = k => t(PHASE_LABEL[k])
  return <section className="pm-sec proposal"><h2>{t('Proposal for the next block')}</h2><div className="pm-sec-body">
    <p className="dim small">{t('Based on your control. Nothing changes until you confirm.')}</p>
    <ul className="op-changes">
      {p.changes.length === 0 && <li><Icon name="check" />{t('Keep the same structure: you are progressing as planned.')}</li>}
      {p.changes.map((c, i) => <li key={i}><Icon name={c.kind === 'review' ? 'flag' : c.kind === 'volume' ? (c.pct < 0 ? 'arrowDown' : 'arrowUp') : 'target'} />{
        c.kind === 'volume' ? t(c.pct < 0 ? 'Less volume ({0}%) {1}' : 'More volume (+{0}%) {1}', Math.abs(c.pct), t(REASON_LABEL[c.reason]))
          : c.kind === 'focus' ? t('More work on: {0}', t(CAP_LABEL[c.capacity]))
            : c.kind === 'phase' ? t('The plan moves from {0} to {1}', phaseOf(c.from), phaseOf(c.to))
              : t('A trainer will review this plan')}</li>)}
    </ul>
    <div className="pm-actions"><button className="pm-primary" onClick={confirm}>{t('Start the next block')}</button>
      <button className="pm-ghost" onClick={() => openSheet(close => <BlockPreview plan={plan} close={close} />)}>{t('Preview')}</button>
      <button className="pm-ghost" onClick={() => update(s => { s.opposition = op.dismissProposal(s) })}>{t('Not now')}</button></div>
  </div></section>
}

function BlockPreview({ plan, close }) {
  const block = op.proposedBlock(plan)
  return <div className="pm-sheet"><h3>{t('Next block')}</h3>
    {block.definition.weeks.map((w, i) => <div key={i} className="op-week"><b>{t(PHASE_LABEL[w.phase] || 'Base')} · {t('Week {0}', i + 1)}</b>
      <ul className="pm-list">{w.sessions.map(s => <li key={s.key}><Icon name="check" />{s.title}</li>)}</ul></div>)}
    <button className="pm-ghost full" onClick={close}>{t('Close')}</button></div>
}

function EvaluationSheet({ view, close }) {
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const { plan } = view
  const tests = model.testsFor(plan.profile, plan.category)
  const [vals, setVals] = useState({})
  const [fatigue, setFatigue] = useState('normal')
  const [pain, setPain] = useState(false)
  const results = Object.fromEntries(tests.map(x => [x.id, op.parseMark(vals[x.id], x.kind)]).filter(([, v]) => v != null))
  const save = () => {
    const r = op.submitEvaluation(useStore.getState().S, results, { fatigue, pain })
    if (r.error) { toast(t('Enter at least one mark')); return }
    update(s => { s.opposition = r.opposition })
    toast(t('Control recorded'))
    close()
  }
  return <div className="pm-sheet"><h3>{t('Control marks')}</h3>
    <p className="dim small">{t('Enter the marks you got in your control week. Leave a test empty if you did not do it: it keeps the previous mark and is not scored.')}</p>
    {tests.map(x => <label key={x.id} className="pm-field"><span>{x.name}</span>
      <input className="pm-input" value={vals[x.id] ?? ''} placeholder={plan.marks[x.id] != null ? t('Last: {0}', op.formatMark(x, plan.marks[x.id])) : x.kind === 'time' && (x.distanceM || 0) >= 400 ? t('e.g. 3:24') : x.unit} onChange={e => setVals(v => ({ ...v, [x.id]: e.target.value }))} inputMode="text" /></label>)}
    <div className="pm-field"><span>{t('How recovered do you feel?')}</span><div className="op-chips">{['low', 'normal', 'high'].map(k => <Chip key={k} on={fatigue === k} onClick={() => setFatigue(k)}>{t(FATIGUE_LABEL[k])}</Chip>)}</div></div>
    <label className="op-check"><input type="checkbox" checked={pain} onChange={e => setPain(e.target.checked)} />{t('I felt pain or an injury during the block')}</label>
    <button className="pm-primary" disabled={!Object.keys(results).length} onClick={save}>{t('Save control')}</button>
    <button className="pm-ghost full" onClick={close}>{t('Cancel')}</button></div>
}

function VersionSheet({ plan, newer, close }) {
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const [full, setFull] = useState(null)
  useEffect(() => { useOpposition.getState().detail(newer.id).then(setFull).catch(() => setFull(false)) }, [newer.id])
  const diff = full ? model.diffProfiles(plan.profile, full) : []
  const move = () => { update(s => { s.opposition = op.moveToVersion(s, full) }); toast(t('Plan updated to the new version')); close() }
  return <div className="pm-sheet"><h3>{t('New version of the convocatoria')}</h3>
    {full === null && <p className="dim small">{t('Loading…')}</p>}
    {full === false && <p className="pm-note warn"><Icon name="info" />{t('The new version could not be loaded. Try again later.')}</p>}
    {full && <><p className="dim small">{t('Version {0} → {1} · source {2}', plan.profileVersion, full.version, fmtDate(full.source.date))}</p>
      <ul className="op-changes">{diff.map((d, i) => <li key={i}><Icon name="info" />{t(DIFF_LABEL[d.kind])}{d.test ? ': ' + (full.tests.find(x => x.id === d.test)?.name || plan.profile.tests.find(x => x.id === d.test)?.name || d.test) : ''}</li>)}</ul>
      <p className="dim small">{t('If you update, your marks are kept, the levels and targets are recalculated and the next block uses the new tests. Your previous version stays in your history.')}</p>
      <button className="pm-primary" onClick={move}>{t('Update my plan')}</button></>}
    <button className="pm-ghost full" onClick={close}>{t('Keep my current version')}</button></div>
}
