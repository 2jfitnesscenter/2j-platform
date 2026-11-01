// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Premium Training Programs, member side: the catalogue, a program's sheet, the activation sheet and the running program's page.
// "Premium" is the name of a catalogue of structured methods, not a paywall. A program that is already running only needs the member's own state
// (its definition is pinned in the snapshot), so hiding a program or switching the catalogue off never reaches it: new activations stop, viewing,
// training and finishing continue.
import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { usePremium } from '../lib/premium-api.js'
import { activate, finish, pause, resume, skip, setTM, nextCycle, runningView, filterCatalog, recommendation, compatibility, premiumState, activePlanOf, setAsidePlan, FILTERS } from '../lib/premium.js'
import { copyOf, labelOfRun, BADGE_LABEL, LEVEL_KEY, GOAL_LABEL, STATUS_LABEL, PROGRESSION_TEXT, REASON_LABEL } from '../lib/premium-text.js'
import { allowedByAdmin } from '../lib/features.js'
import { EXIDX } from '../lib/exercises.js'
import { t } from '../lib/i18n.js'
import { confirmSheet, startPremiumSession } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import PremiumCover from '../components/PremiumCover.jsx'
import './premium.css'

const exName = id => t(EXIDX[id]?.n || id)
const lang = S => S?.lang || 'es'

function Back({ to, label }) {
  const nav = useNavigate()
  return <button className="pm-back" aria-label={label || t('Back')} onClick={() => nav(to)}><Icon name="chevronLeft" /></button>
}

function Badges({ p, rec, staff }) {
  const bits = []
  if (p.badge === 'new') bits.push(<span key="n" className="pm-badge gold">{t(BADGE_LABEL.new)}</span>)
  if (p.featured || p.badge === 'featured') bits.push(<span key="f" className="pm-badge gold">{t(BADGE_LABEL.featured)}</span>)
  if (p.badge === 'recommended' || rec?.recommended) bits.push(<span key="r" className="pm-badge green">{t('Recommended for you')}</span>)
  if (staff && p.status && p.status !== 'published') bits.push(<span key="s" className="pm-badge muted">{t(STATUS_LABEL[p.status])}</span>)
  return bits.length ? <span className="pm-badges">{bits}</span> : null
}

function useCatalog() {
  const user = useStore(s => s.user)
  const c = usePremium()
  useEffect(() => { c.load(user?.id) }, [user?.id])   // eslint-disable-line react-hooks/exhaustive-deps
  return c
}

/** One program, as a large photographic card. One tap opens the sheet: no buttons on the card. */
function ProgramCard({ p, rec, L, staff, wide, eager, onOpen }) {
  const x = copyOf(p, L)
  return <button className={'pm-card' + (wide ? ' wide' : '')} onClick={onOpen} aria-label={x.name}>
    <PremiumCover p={p} ratio={wide ? '16 / 10' : '4 / 3'} eager={eager}>
      <Badges p={p} rec={rec} staff={staff} />
      <span className="pm-card-cap">
        <span className="pm-kicker">{t(GOAL_LABEL[p.goalTags?.[0]] || 'Training')} · {t(LEVEL_KEY[p.level])}</span>
        <b className="pm-card-title">{x.name}</b>
        <span className="pm-card-sub">{p.methodType === 'opposition' ? t('Adaptive long-term plan') : t('{0} days/week', p.daysPerWeek)}</span>
      </span>
    </PremiumCover>
    <span className="pm-card-body">
      <span className="pm-card-desc">{x.shortDescription}</span>
      <span className="pm-tags"><i>{t(GOAL_LABEL[p.goalTags?.[0]] || 'Training')}</i>{p.methodType === 'opposition' ? <i>{t('Adaptive')}</i> : <i>{t('{0} days', p.daysPerWeek)}</i>}<i>{t(LEVEL_KEY[p.level])}</i></span>
    </span>
  </button>
}

export function PremiumCatalog() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const c = useCatalog()
  const [goal, setGoal] = useState('all')
  const [level, setLevel] = useState('all')
  const [days, setDays] = useState('all')
  const active = premiumState(S).active
  const off = !allowedByAdmin('premium') || !c.enabled
  const L = lang(S)
  const published = useMemo(() => c.programs.filter(p => p.status === 'published'), [c.programs])
  const rows = useMemo(() => filterCatalog(S, published, { goal, level, days }), [S, published, goal, level, days])
  const filtering = goal !== 'all' || level !== 'all' || days !== 'all'
  const featured = useMemo(() => filterCatalog(S, published.filter(p => p.featured || p.badge === 'new'), {}), [S, published])
  const forYou = useMemo(() => filterCatalog(S, published, { goal: 'recommended' }).filter(r => !r.p.featured).slice(0, 4), [S, published])
  const open = p => nav('/premium/p/' + p.slug)
  return <main className="pm-page">
    <header className="pm-hero">
      <div className="pm-hero-top"><Back to="/train2j" />
        {c.canAuthor && <button className="pm-ghost" onClick={() => nav('/premium/manage')}><Icon name="gear" />{t('Manage')}</button>}</div>
      <span className="pm-eyebrow"><Icon name="trophy" />2J PREMIUM</span>
      <h1>{t('Premium training')}</h1>
      <p>{t('Train with proven methodologies, adapted to you by 2J.')}</p>
    </header>
    {active && <ActiveCard S={S} L={L} onOpen={() => nav('/premium/active')} />}
    {off && !c.canAuthor
      ? <section className="pm-empty" role="status"><Icon name="info" /><b>{t('Premium programs are not available right now')}</b>
        <p>{active ? t('Your running program keeps working: you can train, pause or finish it.') : t('Come back later — your training is not affected.')}</p></section>
      : <>
        {!filtering && featured.length > 0 && <section className="pm-section" aria-label={t('Featured')}>
          <h2 className="pm-h">{t('Featured')}</h2>
          <div className="pm-rail">{featured.map(({ p, rec }, i) => <ProgramCard key={p.id} p={p} rec={rec} L={L} staff={c.canAuthor} wide eager={i === 0} onOpen={() => open(p)} />)}</div>
        </section>}
        {!filtering && forYou.length > 0 && <section className="pm-section" aria-label={t('Recommended for you')}>
          <h2 className="pm-h">{t('Recommended for you')}</h2>
          <p className="pm-sub">{t('Based on the goal, level and days you told your coach.')}</p>
          <div className="pm-rail">{forYou.map(({ p, rec }) => <ProgramCard key={p.id} p={p} rec={rec} L={L} staff={c.canAuthor} wide onOpen={() => open(p)} />)}</div>
        </section>}
        <section className="pm-section" aria-label={t('Explore all')}>
          <h2 className="pm-h">{t('Explore all')}</h2>
          <div className="pm-filters" role="group" aria-label={t('Filters')}>{FILTERS.map(f => <button key={f.key} className={'pm-filter' + (goal === f.key ? ' on' : '')} aria-pressed={goal === f.key} onClick={() => setGoal(f.key)}>{t(f.label)}</button>)}</div>
          <div className="pm-selects">
            <label><span>{t('Level')}</span><select className="pm-input" value={level} onChange={e => setLevel(e.target.value)}><option value="all">{t('All')}</option>{['beginner', 'intermediate', 'advanced'].map(l => <option key={l} value={l}>{t(LEVEL_KEY[l])}</option>)}</select></label>
            <label><span>{t('Days per week')}</span><select className="pm-input" value={days} onChange={e => setDays(e.target.value)}><option value="all">{t('All')}</option>{[2, 3, 4, 5, 6].map(d => <option key={d} value={d}>{d}</option>)}</select></label>
          </div>
          {c.status === 'loading' && <div className="pm-empty" role="status"><b>{t('Loading…')}</b></div>}
          {c.status === 'error' && <div className="pm-empty" role="alert"><b>{t('The catalogue could not be loaded')}</b><p>{c.error}</p></div>}
          {c.status === 'ready' && !rows.length && <div className="pm-empty"><Icon name="magnifier" /><b>{t('No program matches these filters')}</b></div>}
          <div className="pm-grid">{rows.map(({ p, rec }) => <ProgramCard key={p.id} p={p} rec={rec} L={L} staff={c.canAuthor} onOpen={() => open(p)} />)}</div>
        </section>
      </>}
  </main>
}

function ActiveCard({ S, L, onOpen }) {
  const v = runningView(S)
  if (!v) return null
  const prog = usePremium.getState().programs.find(p => p.id === v.inst.programId)
  const cover = v.inst.snapshot.coverImage ? v.inst.snapshot : prog || {}
  return <button className="pm-active" onClick={onOpen}>
    <PremiumCover p={cover} ratio="21 / 9" className="pm-active-cover"><span className="pm-active-cap">
      <span className="pm-kicker">{t('Your program')}</span><b>{copyOf({ ...v.inst.snapshot, copy: {}, locales: prog?.locales }, L).name}</b>
      <span className="pm-card-sub">{labelOfRun(v.summary).split(' · ').slice(1).map(x => x.replace(/^Cycle (\d+)$/, () => t('Cycle {0}', v.pos.cycle)).replace(/^Week (\d+)\/(\d+)$/, () => t('Week {0}/{1}', v.pos.week, v.pos.weeks))).join(' · ')}</span></span></PremiumCover>
    <span className="pm-active-foot">
      <span className="pm-bar" role="progressbar" aria-label={t('Program progress')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={v.progress.percent}><i style={{ width: v.progress.percent + '%' }} /></span>
      <small>{v.inst.status === 'paused' ? t('Paused') : v.plan ? t('Next: {0}', v.plan.title) : t('Cycle complete')}</small>
      <span className="pm-open">{t('Continue')} <Icon name="chevronRight" /></span></span>
  </button>
}

function Section({ title, children, accordion, open }) {
  if (accordion) return <details className="pm-sec acc" open={open}><summary><span>{title}</span><Icon name="chevronDown" /></summary><div className="pm-sec-body">{children}</div></details>
  return <section className="pm-sec"><h2>{title}</h2><div className="pm-sec-body">{children}</div></section>
}
function Items({ items, icon = 'check' }) {
  if (!items?.length) return null
  return <ul className="pm-list">{items.map((i, k) => <li key={k}><Icon name={icon} />{i}</li>)}</ul>
}

/** Week-by-week structure from the full definition: one line per session with its main work. */
function Structure({ def }) {
  if (!def) return <p className="dim small">{t('Loading…')}</p>
  return <div className="pm-weeks">{def.weeks.map((w, wi) => <div key={wi} className="pm-week">
    <b>{w.label || t('Week {0}', wi + 1)}{w.phase ? ` · ${w.phase}` : ''}</b>
    <ul>{w.sessions.map((s, si) => <li key={si}><span>{s.title}</span><small>{s.blocks.length === 1 ? t('1 exercise') : t('{0} exercises', s.blocks.length)}</small></li>)}</ul></div>)}</div>
}

export function PremiumDetail() {
  const nav = useNavigate()
  const { slug } = useParams()
  const S = useStore(s => s.S)
  const openSheet = useUI(s => s.openSheet)
  const toast = useUI(s => s.toast)
  const c = useCatalog()
  const [full, setFull] = useState(null)
  const [err, setErr] = useState('')
  const summary = c.programs.find(p => p.slug === slug || p.id === slug)
  useEffect(() => {
    if (!summary) return
    usePremium.getState().detail(summary.id).then(setFull).catch(e => setErr(e.message))
  }, [summary?.id])   // eslint-disable-line react-hooks/exhaustive-deps
  if (summary?.methodType === 'opposition') return <Navigate to="/oposiciones" replace />   // the Oposiciones family has its own flow: intake, plan by phases, control tests
  if (!summary) return <main className="pm-page"><header className="pm-hero"><div className="pm-hero-top"><Back to="/premium" /></div><h1>{c.status === 'ready' ? t('Program unavailable') : t('Loading…')}</h1></header></main>
  const L = lang(S)
  const p = full || summary
  const x = copyOf(p, L)
  const rec = recommendation(S, summary)
  const compat = full ? compatibility(S, full) : null
  const running = premiumState(S).active
  const same = running?.programId === summary.id
  const off = !allowedByAdmin('premium') || !c.enabled
  const start = () => {
    if (off) { toast(t('New Premium programs are not available right now')); return }
    if (S.active) { toast(t('Finish your current workout before starting a program.')); return }
    if (!full) { toast(err || t('Loading…')); return }
    openSheet(close => <ActivateSheet program={full} text={x} compat={compat} close={close} onDone={() => { usePremium.getState().started(full.id); nav('/premium/active') }} />)
  }
  const sourceLabel = { established: 'Established, widely used method', principles: 'Built on general training principles', own: '2J Fitness Center own method' }[summary.sourceType]
  const lifts = full?.programDefinition?.lifts || summary.setup?.lifts || []
  return <main className="pm-page pm-detail">
    <PremiumCover p={p} ratio="16 / 11" eager className="pm-detail-cover">
      <div className="pm-hero-top over"><Back to="/premium" /><Badges p={summary} rec={rec} staff={c.canAuthor} /></div>
      <span className="pm-detail-cap">
        <span className="pm-kicker">{t(GOAL_LABEL[summary.goalTags?.[0]] || 'Training')} · {t(LEVEL_KEY[summary.level])}</span>
        <h1>{x.name}</h1>
        <span className="pm-facts"><span><Icon name="calendar" />{t('{0} days/week', summary.daysPerWeek)}</span><span><Icon name="clock" />{x.durationDescription}</span><span><Icon name="target" />{t(LEVEL_KEY[summary.level])}</span></span>
      </span>
    </PremiumCover>
    <div className="pm-detail-body">
      {rec.reasons.includes('too-advanced') && <p className="pm-note warn"><Icon name="info" />{t('This program is above the level you told us. Talk to your trainer before starting it.')}</p>}
      {rec.reasons.includes('more-days') && <p className="pm-note warn"><Icon name="info" />{t('It asks for more days per week than you planned.')}</p>}
      {rec.reasons.includes('restrictions') && <p className="pm-note warn"><Icon name="info" />{t('You have declared restrictions: check this method with your trainer first.')}</p>}
      {compat && !compat.compatible && <p className="pm-note"><Icon name="info" />{t('{0} of {1} exercises need other equipment; you will pick an alternative for them.', compat.missing, compat.total)}</p>}
      <Section title={t('What it is')}><p>{x.longDescription || x.shortDescription}</p></Section>
      <Section title={t('How it works')}><Items items={x.howItWorks} /></Section>
      <Section title={t('Who it is for')}><Items items={x.forWhom} /></Section>
      <Section title={t('How you progress')}><p>{t(PROGRESSION_TEXT[summary.progressionModel] || PROGRESSION_TEXT.none)}</p></Section>
      <Section title={t('What 2J does for you')}><Items items={[t('Calculates your loads for every session.'), t('Keeps your cycle, week and next workout.'), t('Proposes changes at the end of a cycle — you confirm them.')]} /></Section>
      <Section title={t('Tracking')}><Items items={x.tracking} /></Section>
      <Section title={t('Not ideal if…')}><Items items={x.notIdealIf} icon="xmark" /></Section>
      <Section title={t('Weekly structure')} accordion><Structure def={full?.programDefinition} /></Section>
      <Section title={t('Requirements')} accordion>
        <Items items={[...(summary.equipmentRequirements || []).map(e => t(e)), ...lifts.map(l => t('Training Max: {0}', exName(l.exercise)))]} />
      </Section>
      <Section title={t('Evidence and origin')} accordion>
        <p>{x.evidenceSummary}</p>
        <p className="dim small">{sourceLabel ? t(sourceLabel) : ''}{summary.author?.name ? ` · ${summary.author.name}${summary.author.work ? ' — ' + summary.author.work : ''}` : ''}</p>
        <p className="dim small">{t('This describes how the method is built. It is not a promise of results and it is not medical advice.')}</p>
        {summary.sourceType !== 'own' && <p className="dim small">{t('Independent description written by 2J Fitness Center. It is not affiliated with, endorsed by or licensed by the author or the owners of the method name.')}</p>}
        {p.coverImageAttribution && <p className="dim small">{t('Photo')}: {p.coverImageSource ? <a href={p.coverImageSource} target="_blank" rel="noreferrer noopener">{p.coverImageAttribution}</a> : p.coverImageAttribution}</p>}
      </Section>
    </div>
    <footer className="pm-cta">
      {same ? <button className="pm-primary" onClick={() => nav('/premium/active')}><Icon name="play" />{t('Continue program')}</button>
        : <button className="pm-primary" disabled={off && !c.canAuthor} onClick={start}><Icon name="play" />{running ? t('Switch to this program') : t('Start program')}</button>}
    </footer>
    {err && <p role="alert" className="dim small">{err}</p>}
  </main>
}

export function ActivateSheet({ program, text, compat, close, onDone }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const lifts = program.programDefinition.lifts || []
  const unit = S.unit || 'kg'
  const [tm, setTm] = useState({})
  const running = premiumState(S).active
  const plan = activePlanOf(S)
  const ready = lifts.every(l => Number(tm[l.key]) > 0)
  const go = () => {
    update(s => {
      const plan = setAsidePlan(s)                       // the active planning is set aside (kept saved), never deleted
      s.premium = activate(s, program, { tm: Object.fromEntries(lifts.map(l => [l.key, Number(tm[l.key])])), unit })
      if (plan) s.premium.active.replacedPlan = { id: plan.id, name: plan.name, at: Date.now() }
    })
    toast(t('Program started'))
    close(); onDone()
  }
  return <div className="pm-sheet">
    <h3>{t('Start {0}', text.name)}</h3>
    {plan && <div className="pm-replace" role="alert"><Icon name="info" /><div>
      <b>{t('Premium programs use their own periodisation.')}</b>
      <p>{t('If you start this program, it will replace your current active planning ({0}).', plan.name)}</p>
      <p>{t('Your history, completed workouts and saved routines will not be deleted.')}</p></div></div>}
    <ul className="pm-list">
      <li><Icon name="check" />{t('A new program will guide your next sessions: loads, sets and the cycle.')}</li>
      <li><Icon name="check" />{t('Your workouts, records and saved routines are not changed.')}</li>
      {running && <li><Icon name="info" />{t('Your current program ({0}) will be closed and kept in your history.', running.name)}</li>}
      {compat && !compat.compatible && <li><Icon name="info" />{t('{0} of {1} exercises need other equipment.', compat.missing, compat.total)}</li>}
    </ul>
    {lifts.length > 0 && <>
      <div className="pm-sub-h">{t('Your Training Max')}</div>
      <p className="dim small">{t('A weight you could move for several clean reps, not your absolute maximum.')}</p>
      {lifts.map(l => <label key={l.key} className="pm-field"><span>{exName(l.exercise)} ({unit})</span>
        <input className="pm-input" type="number" inputMode="decimal" min="1" value={tm[l.key] ?? ''} onChange={e => setTm(v => ({ ...v, [l.key]: e.target.value }))} /></label>)}
    </>}
    <button className="pm-primary" disabled={!ready} onClick={go}>{plan ? t('Continue') : t('Start program')}</button>
    <button className="pm-ghost full" onClick={close}>{t('Cancel')}</button>
  </div>
}

function TmSheet({ lift, current, unit, close, onSave }) {
  const [v, setV] = useState(current ?? '')
  return <div className="pm-sheet"><h3>{t('Training Max')} · {exName(lift.exercise)}</h3>
    <p className="dim small">{t('Changing it only affects the next sessions. Finished workouts stay as they are.')}</p>
    <label className="pm-field"><span>{unit}</span><input className="pm-input" type="number" inputMode="decimal" min="1" value={v} onChange={e => setV(e.target.value)} /></label>
    <button className="pm-primary" disabled={!(Number(v) > 0)} onClick={() => { onSave(Number(v)); close() }}>{t('Save')}</button></div>
}

function ProposalCard({ v, update }) {
  const [edit, setEdit] = useState({})
  if (!v.proposal) return null
  const entries = Object.entries(v.proposal.proposals)
  const def = v.inst.snapshot.definition
  const unit = v.inst.methodState.unit
  return <section className="pm-sec pm-proposal"><h2>{t('Cycle {0} complete', v.pos.cycle)}</h2><div className="pm-sec-body">
    {entries.length ? <>
      <p>{t('2J proposes a new Training Max. Nothing changes until you confirm.')}</p>
      {entries.map(([k, p]) => { const lift = def.lifts.find(l => l.key === k); return <div key={k} className="pm-prop"><span>{exName(lift.exercise)}</span><b>{p.from} → {p.to} {unit}</b>
        <input className="pm-input" aria-label={t('Your own value')} type="number" inputMode="decimal" placeholder={String(p.to)} value={edit[k] ?? ''} onChange={e => setEdit(x => ({ ...x, [k]: e.target.value }))} /></div> })}
      <div className="pm-actions"><button className="pm-primary" onClick={() => update(s => { s.premium = nextCycle(s, { accept: true, overrides: edit }) })}>{t('Accept and start cycle {0}', v.pos.cycle + 1)}</button>
        <button className="pm-ghost" onClick={() => update(s => { s.premium = nextCycle(s, { accept: false }) })}>{t('Keep my Training Max')}</button></div>
    </> : <div className="pm-actions"><p>{t('Start the next cycle with the same loads.')}</p><button className="pm-primary" onClick={() => update(s => { s.premium = nextCycle(s, { accept: false }) })}>{t('Start cycle {0}', v.pos.cycle + 1)}</button></div>}
  </div></section>
}

export function PremiumActive() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const openSheet = useUI(s => s.openSheet)
  const v = runningView(S)
  const hist = premiumState(S).history
  const cat = usePremium(s => s.programs)
  if (!v) return <main className="pm-page"><header className="pm-hero"><div className="pm-hero-top"><Back to="/premium" /></div><h1>{t('Your Premium program')}</h1></header>
    <section className="pm-empty"><Icon name="trophy" /><b>{t('No Premium program running')}</b><button className="pm-primary" onClick={() => nav('/premium')}>{t('Explore programs')}</button></section>
    <History items={hist} /></main>
  const def = v.inst.snapshot.definition
  const unit = v.inst.methodState.unit
  const paused = v.inst.status === 'paused'
  const live = cat.find(p => p.id === v.inst.programId)
  const endProgram = () => confirmSheet({ title: t('Finish this program?'), message: t('Your workouts, records and history stay. The program moves to your history.'), confirmText: t('Finish program'), danger: true,
    onConfirm: () => update(s => { s.premium = finish(s) }) })
  const skipOne = () => confirmSheet({ title: t('Skip this session?'), message: t('The program moves to the next session. It is recorded as skipped.'), confirmText: t('Skip'), onConfirm: () => update(s => { s.premium = skip(s) }) })
  return <main className="pm-page pm-running">
    <PremiumCover p={v.inst.snapshot.coverImage ? v.inst.snapshot : live || {}} ratio="16 / 8" eager className="pm-detail-cover short">
      <div className="pm-hero-top over"><Back to="/premium" /><span className={'pm-badge ' + (paused ? 'muted' : 'green')}>{paused ? t('Paused') : t('In progress')}</span></div>
      <span className="pm-detail-cap"><span className="pm-kicker">{v.pos.phase ? t(v.pos.phase) : t('Your program')}</span><h1>{v.inst.name}</h1>
        <span className="pm-facts"><span><Icon name="calendar" />{t('Cycle {0} · Week {1}/{2}', v.pos.cycle, v.pos.week, v.pos.weeks)}</span><span>{t('version {0}', v.inst.programVersion)}</span></span></span>
    </PremiumCover>
    <div className="pm-detail-body">
      <div className="pm-prog"><span className="pm-bar" role="progressbar" aria-label={t('Program progress')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={v.progress.percent}><i style={{ width: v.progress.percent + '%' }} /></span>
        <small>{t('{0} of {1} sessions this cycle', v.pos.completedInCycle, v.pos.totalInCycle)}</small></div>
      {v.missing.length > 0 && <p className="pm-note warn"><Icon name="info" />{t('Set the Training Max of every main lift to unlock the next session.')}</p>}
      {v.plan && <section className="pm-sec next"><h2>{t('Next workout')} · {v.plan.title}</h2><div className="pm-sec-body">
        <ul className="pm-plan">{v.plan.blocks.map((b, i) => <li key={i}><b>{exName(b.exercise)}</b>
          <small>{b.kind === 'fixed' ? b.sets.map(s => `${s.w}×${s.r}${s.amrap ? '+' : ''}`).join(' · ') : b.kind === 'cfg' ? `${b.cfg.sets}×${b.cfg.targetRepsMin ? b.cfg.targetRepsMin + '-' + b.cfg.targetRepsMax : b.cfg.reps}` : b.kind === 'conditioning' ? (b.conditioning.min ? b.conditioning.min + ' min' : b.conditioning.sec + ' s') : t('Set the Training Max')}</small>{b.note && <em className="pm-bnote">{t(b.note)}</em>}</li>)}</ul>
        <div className="pm-actions"><button className="pm-primary" disabled={paused || v.missing.length > 0} onClick={startPremiumSession}><Icon name="play" />{t('Start workout')}</button>
          <button className="pm-ghost" disabled={paused} onClick={skipOne}>{t('Skip session')}</button></div></div></section>}
      <ProposalCard v={v} update={update} />
      {(def.lifts || []).length > 0 && <section className="pm-sec"><h2>{t('Training Max')}</h2><div className="pm-sec-body">
        {def.lifts.map(l => <button key={l.key} className="pm-tm" onClick={() => openSheet(close => <TmSheet lift={l} current={v.inst.methodState.tm[l.key]} unit={unit} close={close} onSave={val => update(s => { s.premium = setTM(s, l.key, val) })} />)}>
          <span>{exName(l.exercise)}</span><b>{v.inst.methodState.tm[l.key] ?? '—'} {unit}</b><Icon name="pencil" /></button>)}</div></section>}
      {v.summary.lastAmrap.length > 0 && <section className="pm-sec"><h2>{t('Latest AMRAP sets')}</h2><div className="pm-sec-body"><ul className="pm-list">{v.summary.lastAmrap.map((a, i) => <li key={i}><Icon name="check" />{exName(a.exercise)} · {a.w} {unit} × {a.reps} · {a.d}</li>)}</ul></div></section>}
      <div className="pm-actions wide">
        <button className="pm-ghost" onClick={() => update(s => { s.premium = paused ? resume(s) : pause(s) })}>{paused ? t('Resume') : t('Pause')}</button>
        <button className="pm-ghost" onClick={() => nav('/premium')}>{t('Switch program')}</button>
        <button className="pm-ghost danger" onClick={endProgram}>{t('Finish program')}</button></div>
      <History items={hist} />
    </div>
  </main>
}

function History({ items }) {
  if (!items?.length) return null
  return <section className="pm-sec"><h2>{t('Program history')}</h2><div className="pm-sec-body"><ul className="pm-list">{[...items].reverse().map((h, i) => <li key={i}><Icon name="check" />{h.name} · {t('{0} sessions', h.sessions)} · {t(REASON_LABEL[h.reason] || 'finished')}</li>)}</ul></div></section>
}
