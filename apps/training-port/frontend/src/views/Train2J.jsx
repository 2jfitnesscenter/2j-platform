// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// "Entrena con 2J" — the member's catalogue of official guided routines. An editorial front page
// (one hero, then rows that only appear when they have something real in them), collections, a
// product-page detail and one "Start" that hands the routine to the existing workout and guided
// runner. No second player, no history of its own: what was done is read from S.workouts.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, nameFor } from '../lib/i18n.js'
import { fmtDate, uid } from '../lib/format.js'
import { EXIDX, isEquipmentUnavailable } from '../lib/exercises.js'
import { useGuided } from '../lib/guided-api.js'
import { favRoutinesOf } from '../lib/routine-favorites.js'
import { filterRoutines, historyStats, recentRoutines, forYou, isNew, memberContext, restrictionIssues, gearKinds, GEAR_LABEL, saveOfficialRoutine } from '../lib/train2j.js'
import { CATEGORY_LABEL, LEVEL_LABEL, GOAL_LABEL, TAG_LABEL, RESTRICTION_LABEL } from '../lib/protocol/index.js'
import { startOfficialRoutine } from '../sheets.jsx'
import { programProgress } from '../lib/guided-programs.js'
import { issueText } from '../lib/blocks-api.js'
import WorkoutCover from '../components/WorkoutCover.jsx'
import GymProfile from '../components/GymProfile.jsx'
import Icon from '../components/Icon.jsx'
import './train2j-program-home.css'
import { gymRoutineCompatibility } from '../lib/gym-profiles.js'
import { RoutineCard, FIT_LABEL, Rail, CollectionTile, PartsTimeline, FiltersSheet, AssignSheet, CurateSheet, Heart, gearText, lookup } from '../components/train2j/parts.jsx'

const QUICK = [
  { key: 'all', label: 'All' },
  { key: 'short', label: 'Under 15 min', f: { duration: 'lt15' } },
  { key: 'mid', label: '15–30 min', f: { duration: '15-30' } },
  { key: 'none', label: 'No equipment', f: { gear: 'none' } },
  { key: 'tabata', label: 'Tabata', f: { category: 'tabata' } },
  { key: 'hiit', label: 'HIIT', f: { category: 'hiit' } },
  { key: 'circuit', label: 'Circuits', f: { category: 'circuit' } },
  { key: 'cardio', label: 'Cardio', f: { category: 'interval' } },
  { key: 'mobility', label: 'Mobility', f: { category: 'mobility' } },
  { key: 'strength', label: 'Strength', f: { category: 'strength' } },
  { key: 'beginner', label: 'Novice', f: { level: 'beginner' } },
]
const EMPTY = { q: '', category: '', duration: '', level: '', gear: '', goal: '' }
const active = f => Object.entries(f).some(([k, v]) => v && k !== 'q') || !!f.q?.trim()
const sameQuick = (f, q) => q.f ? Object.entries(q.f).every(([k, v]) => f[k] === v) && Object.entries(f).filter(([k, v]) => v && k !== 'q').length === Object.keys(q.f).length : !active(f)

function useCatalog() {
  const user = useStore(s => s.user)
  const g = useGuided()
  useEffect(() => { g.load(user?.id) }, [user?.id])
  // The old per-device favourites are folded into the synced state once the catalogue is here (and again when the sync is confirmed).
  const syncStatus = useStore(s => s.syncStatus)
  useEffect(() => { if (g.status === 'ready') g.migrateFavorites() }, [g.status, syncStatus, user?.id])
  return g
}
// On a phone the first screen belongs to what a person does next: search, filters and "For you". The featured workout (the hero) follows them
// there instead of leading the page; wider screens keep it on top.
export function useNarrow(query = '(max-width: 699px)') {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? !!window.matchMedia(query).matches : false)
  const [narrow, setNarrow] = useState(get)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia(query)
    const on = () => setNarrow(!!mq.matches)
    on()
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [query])
  return narrow
}
const daysAgo = d => Math.max(0, Math.round((Date.now() - new Date(d + 'T12:00:00').getTime()) / 86400e3))

function Loading({ status, error, offline }) {
  if (status === 'error') return <div className="t2-state"><Icon name={offline ? 'globe' : 'info'} /><b>{offline ? t('You are offline') : t('The 2J library could not be loaded')}</b>
    <p>{offline ? t('The library appears here once it has been opened with a connection on this device.') : error}</p></div>
  return <div className="t2-state"><div className="t2-skel" /><div className="t2-skel" /></div>
}

/* ============================ landing ============================ */
export default function Train2J() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const openSheet = useUI(s => s.openSheet)
  const { status, error, offline, routines, collections } = useCatalog()
  const programs = useGuided(s => s.programs)
  const [f, setF] = useState(EMPTY)
  const [hero, setHero] = useState(0)
  const narrow = useNarrow()
  const byId = useMemo(() => Object.fromEntries(routines.map(r => [r.id, r])), [routines])
  const stats = useMemo(() => historyStats(S.workouts), [S.workouts])
  const favs = useMemo(() => favRoutinesOf(S), [S.favRoutines])
  const ordered = useMemo(() => [...routines].sort((a, b) => (a.order ?? 999) - (b.order ?? 999)), [routines])
  const featured = useMemo(() => routines.filter(r => r.featured).sort((a, b) => a.featured - b.featured), [routines])
  const results = useMemo(() => active(f) ? filterRoutines(ordered, f, { t, lookup }) : null, [ordered, f])
  const mine = useMemo(() => forYou(routines, S, { lookup }), [routines, S.workouts, S.routines, S.programs])
  const recent = useMemo(() => recentRoutines(S.workouts, byId), [S.workouts, byId])
  const activeProgram = (S.programs || []).find(p => p.id === S.activeProgramId && p.source === 'guided-v2' && p.status === 'active')
  const activeProgramState = activeProgram && programProgress(activeProgram, S.workouts)
  if (status !== 'ready') return <div className="t2 t2-page"><Header /><Loading status={status} error={error} offline={offline} /></div>
  const h = featured[Math.min(hero, featured.length - 1)] || ordered[0]
  const card = (r, extra = {}) => <RoutineCard key={r.id} r={r} stats={stats[r.id]} isNewRoutine={isNew(r, routines)} {...extra} />
  const running = S.active?.src2j ? byId[S.active.src2j.id] : null
  const noGear = ordered.filter(r => (r.tags || []).includes('no-equipment'))
  const favList = ordered.filter(r => favs.has(r.id))
  const heroNode = h && <Hero r={h} featured={featured} index={hero} onIndex={setHero} />

  return <div className="t2 t2-page">
    <GymProfile />
    <Header offline={offline} />
    {!narrow && heroNode}

    <div className="t2-tools">
      <label className="t2-search"><Icon name="magnifier" />
        <input type="search" value={f.q} placeholder={t('Search: tabata, 20 min, no jumps, hips…')} aria-label={t('Search workouts')} onChange={e => setF(x => ({ ...x, q: e.target.value }))} />
      </label>
      <div className="t2-chips" role="toolbar" aria-label={t('Quick filters')}>
        {QUICK.map(q => <button key={q.key} className={'t2-chip' + (sameQuick(f, q) ? ' on' : '')} aria-pressed={sameQuick(f, q)}
          onClick={() => setF(x => q.f ? { ...EMPTY, q: x.q, ...q.f } : { ...EMPTY, q: x.q })}>{t(q.label)}</button>)}
        <button className="t2-chip more" onClick={() => openSheet(close => <FiltersSheet value={f} onApply={setF} close={close} />)}><Icon name="list" />{t('Filters')}</button>
      </div>
    </div>

    {results ? <section className="t2-results">
      <div className="t2-results-h num">{t('{0} workouts', results.length)}<button className="t2-more" onClick={() => setF(EMPTY)}>{t('Clear filters')}</button></div>
      {results.length ? <div className="t2-grid">{results.map(r => card(r))}</div>
        : <div className="t2-state"><Icon name="magnifier" /><b>{t('Nothing matches these filters')}</b><p>{t('Try removing a filter or searching with fewer words.')}</p>
          <button className="btn plain" onClick={() => setF(EMPTY)}>{t('Clear filters')}</button></div>}
    </section> : <>
      {running && <section className="t2-continue">
        <WorkoutCover r={running} shape="square" />
        <div className="grow"><span className="t2-eyebrow">{t('Keep training')}</span><b>{t(running.name)}</b>
          <small>{t('Your workout is still open.')}</small></div>
        <button className="btn primary" onClick={() => nav('/workout')}><Icon name="play" />{t('Continue')}</button>
      </section>}
      {activeProgram && <section className="gp-home-active"><div className="grow"><span className="t2-eyebrow">{t('Continue')}</span><h2>{t(activeProgram.name)}</h2>
        <div className="gp-progress" role="progressbar" aria-label={t('Program progress')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={activeProgramState.percent}><span style={{ width: `${activeProgramState.percent}%` }} /></div>
        <p>{t('Week {0} of {1}', activeProgramState.next ? activeProgramState.next.weekIndex + 1 : activeProgram.weeksCount, activeProgram.weeksCount)} · {t('{0} of {1} sessions', activeProgramState.completed, activeProgramState.total)}</p></div>
        {activeProgramState.next && <button className="btn primary" onClick={() => { const session = activeProgramState.next; const routine = activeProgram.routineSnapshots?.[session.routineId]; if (routine) startOfficialRoutine(routine, { programId: activeProgram.id, sessionId: session.sessionId, week: session.weekIndex + 1, day: session.day, routineId: session.routineId }) }}><Icon name="play" />{t('Continue')}</button>}
      </section>}
      <Rail id="t2-foryou" title={t('For you')} sub={t('From your level, goal, restrictions, favorites and gym — nothing else.')} items={mine}>
        {mine.map(x => card(x.routine, { reasons: x.reasons }))}
      </Rail>
      {narrow && heroNode}
      {programs.length > 0 && <section className="gp-home"><header><div><span className="t2-eyebrow">{t('A PLAN FOR THE NEXT WEEKS')}</span><h2>{t('Guided programs')}</h2></div><button className="t2-more" onClick={() => nav('/train2j/programs')}>{t('See all')}<Icon name="chevronRight" /></button></header>
        <div className="gp-home-cards">{programs.filter(p => p.featured).slice(0, 3).map(p => <button key={p.id} className="gp-home-card" onClick={() => nav('/train2j/program/' + p.id)}><WorkoutCover r={{ id: p.id, category: p.cover || 'circuit' }} shape="wide" /><b>{t(p.name)}</b><small>{t(p.durationLabel)} · {t('{0} sessions/week', p.sessionsPerWeek)}</small></button>)}</div>
      </section>}
      <Rail id="t2-again" title={t('Again?')} items={recent}>
        {recent.map(x => <RoutineCard key={x.routine.id} r={x.routine} stats={stats[x.routine.id]} reasons={[[daysAgo(x.d) === 0 ? 'Done today' : daysAgo(x.d) === 1 ? 'Done yesterday' : 'Done {0} days ago', daysAgo(x.d)]]} />)}
      </Rail>
      <Rail id="t2-colls" title={t('Collections')} items={collections}>
        {collections.map(c => <CollectionTile key={c.id} c={c} count={c.routineIds.length} onOpen={() => nav('/train2j/c/' + c.id)} />)}
      </Rail>
      {collections.map(c => {
        const items = c.routineIds.map(id => byId[id]).filter(Boolean)
        return <Rail key={c.id} id={'t2-' + c.id} title={t(c.name)} sub={t(c.description)} items={items} more={() => nav('/train2j/c/' + c.id)}>
          {items.slice(0, 12).map(r => card(r))}
        </Rail>
      })}
      <Rail id="t2-nogear" title={t('No equipment')} sub={t('Only your body.')} items={noGear}>{noGear.slice(0, 12).map(r => card(r))}</Rail>
      <Rail id="t2-favs" title={t('Your favorites')} items={favList}>{favList.map(r => card(r))}</Rail>
      {!favList.length && <p className="t2-hint"><Icon name="heart" />{t('Tap the heart on a workout to keep it here.')}</p>}
    </>}
  </div>
}

function Header({ offline }) {
  const nav = useNavigate()
  return <header className="t2-head">
    <button className="iconbtn" aria-label={t('Back')} onClick={() => nav(-1)}><Icon name="chevronLeft" /></button>
    <div className="grow">
      <span className="t2-eyebrow">2J Fitness Center</span>
      <h1>{t('Train with 2J')}</h1>
    </div>
    {offline && <span className="t2-offline"><Icon name="globe" />{t('Offline')}</span>}
  </header>
}

function Hero({ r, featured, index, onIndex }) {
  const nav = useNavigate()
  return <section className="t2-hero">
    <WorkoutCover r={r} shape="wide" className="t2-hero-cov">
      <div className="t2-hero-txt">
        <span className="t2-kind">{t(CATEGORY_LABEL[r.category])}</span>
        <h2>{t(r.name)}</h2>
        <p>{t(r.description)}</p>
        <div className="t2-hero-meta num">{r.estimatedMinutes} min · {t(LEVEL_LABEL[r.level])} · {gearText(r)}</div>
        <div className="t2-hero-acts">
          <button className="btn primary" onClick={() => startOfficialRoutine(r)}><Icon name="play" />{t('Start')}</button>
          <button className="btn t2-ghost" onClick={() => nav('/train2j/r/' + r.id)}>{t('See workout')}</button>
        </div>
      </div>
    </WorkoutCover>
    {featured.length > 1 && <div className="t2-hero-dots" role="tablist" aria-label={t('Featured workouts')}>
      {featured.map((x, i) => <button key={x.id} role="tab" aria-selected={i === index} className={i === index ? 'on' : ''} onClick={() => onIndex(i)}
        aria-label={t(x.name)}><WorkoutCover r={x} shape="square" /><span>{t(x.name)}</span></button>)}
    </div>}
  </section>
}

/* ============================ collection ============================ */
export function Train2JCollection() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const { status, error, offline, routines, collections, programs } = useCatalog()
  const stats = useMemo(() => historyStats(S.workouts), [S.workouts])
  if (status !== 'ready') return <div className="t2 t2-page"><Header /><Loading status={status} error={error} offline={offline} /></div>
  const c = collections.find(x => x.id === id)
  if (!c) return <div className="t2 t2-page"><Header /><div className="t2-state"><Icon name="info" /><b>{t('This collection is not available')}</b>
    <button className="btn plain" onClick={() => nav('/train2j')}>{t('Back to Train with 2J')}</button></div></div>
  const items = c.routineIds.map(x => routines.find(r => r.id === x)).filter(Boolean)
  const progs = (c.programIds || []).map(x => programs.find(p => p.id === x)).filter(Boolean)
  return <div className="t2 t2-page">
    <section className="t2-cbanner">
      <WorkoutCover r={{ id: c.id, style: c.style }} shape="wide">
        <button className="iconbtn t2-back" aria-label={t('Back')} onClick={() => nav(-1)}><Icon name="chevronLeft" /></button>
        <div className="t2-cbanner-t">
          <span className="t2-kind">{t('Collection')}</span>
          <h1>{t(c.name)}</h1>
          <p>{t(c.description)}</p>
          <span className="num">{t('{0} workouts', items.length)}</span>
        </div>
      </WorkoutCover>
    </section>
    {progs.length > 0 && <section className="t2-cprogs"><h2>{t('Programs')}</h2>
      <div className="t2-chips">{progs.map(p => <button key={p.id} className="chip" onClick={() => nav('/train2j/program/' + p.id)}>{t(p.name)} · {t(p.durationLabel)}</button>)}</div></section>}
    <div className="t2-grid">{items.map(r => <RoutineCard key={r.id} r={r} stats={stats[r.id]} isNewRoutine={isNew(r, routines)} />)}</div>
  </div>
}

/* ============================ detail ============================ */
export function Train2JDetail() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const openSheet = useUI(s => s.openSheet)
  const toast = useUI(s => s.toast)
  const { status, error, offline, routines, mine, canAssign, canEdit, duplicate, rev } = useCatalog()
  const update = useStore(s => s.update)
  const r = routines.find(x => x.id === id) || mine.find(x => x.id === id)
  const ctx = useMemo(() => memberContext(S), [S.routines, S.programs, S.coach])
  const clash = useMemo(() => r ? restrictionIssues(r, ctx.restrictions, lookup) : [], [r, ctx])
  const st = r ? historyStats(S.workouts)[r.id] : null
  if (status !== 'ready') return <div className="t2 t2-page"><Header /><Loading status={status} error={error} offline={offline} /></div>
  if (!r) return <div className="t2 t2-page"><Header /><div className="t2-state"><Icon name="info" /><b>{t('This workout is not available')}</b>
    <p>{t('It may have been withdrawn from the 2J library.')}</p><button className="btn plain" onClick={() => nav('/train2j')}>{t('Back to Train with 2J')}</button></div></div>
  const gear = gearKinds(r, lookup)
  const fit = gymRoutineCompatibility(S, r)
  const unavailable = [...new Set((r.ex || []).map(e => EXIDX[e.id]?.eq).filter(q => q && isEquipmentUnavailable(q)))]
  const blocked = clash.length > 0
  const saved = (S.routines || []).find(x => x.from2j?.id === r.id)
  const save = () => {
    let result
    update(s => { result = saveOfficialRoutine(s, r, { t, makeId: uid, rev }) })
    toast(result?.ok ? t('Saved to your routines') : result?.reason === 'already-saved' ? t('Already in your routines') : t('Could not save this routine'))
  }
  const dup = async () => { try { const c = await duplicate(r.id); toast(t('Copied to your routines')); nav('/trainer/guided/edit/' + c.id) } catch (e) { toast(e.message) } }

  return <div className="t2 t2-page t2-detail">
    <div className="t2-d-grid">
      <div className="t2-d-cov">
        <WorkoutCover r={r} shape="tall">
          <button className="iconbtn t2-back" aria-label={t('Back')} onClick={() => nav(-1)}><Icon name="chevronLeft" /></button>
          <span className="t2-kind">{t(CATEGORY_LABEL[r.category])}</span>
        </WorkoutCover>
      </div>
      <div className="t2-d-main">
        {r.official && (r.draft || r.active === false) && <div className="t2-preview" role="status"><Icon name="info" /><span>{r.draft ? t('Draft preview — only admins can see this routine.') : t('Hidden routine — only admins can see it.')}</span></div>}
        <h1 className="t2-d-t">{t(r.name)}</h1>
        {r.subtitle && <p className="t2-d-sub">{t(r.subtitle)}</p>}
        <p className="t2-d-desc">{t(r.description)}</p>
        <dl className="t2-facts">
          <div><dt>{t('Duration')}</dt><dd className="num">~{r.estimatedMinutes} min</dd></div>
          <div><dt>{t('Level')}</dt><dd>{t(LEVEL_LABEL[r.level])}</dd></div>
          <div><dt>{t('Training goal')}</dt><dd>{t(GOAL_LABEL[r.goal])}</dd></div>
          <div><dt>{t('Gear')}</dt><dd>{gearText(r)}</dd></div>
        </dl>
        {st?.count > 0 && <p className="t2-d-hist"><Icon name="checkCircle" />{st.count === 1 ? t('You did it once') : t('You did it {0} times', st.count)} · {t('last on {0}', fmtDate(st.last))}</p>}
        {blocked && <div className="t2-warn" role="alert"><Icon name="shield" /><div><b>{t('Not for you right now')}</b>
          <p>{t('It breaks a restriction declared for you ({0}). Ask your trainer for an alternative.', [...new Set(clash.map(i => t(RESTRICTION_LABEL[i.params[1]] || i.params[1])))].join(', '))}</p>
          <ul>{clash.slice(0, 3).map((i, k) => <li key={k}>{issueText(i)}</li>)}</ul></div></div>}
        {unavailable.length > 0 && <div className="t2-warn soft"><Icon name="info" /><p>{t('Some equipment is not available at the gym right now ({0}); those exercises will be skipped.', unavailable.map(q => t(q)).join(', '))}</p></div>}

        <section className={'t2-fitbox ' + fit.level}>
          <h2>{t(FIT_LABEL[fit.level])}</h2>
          {fit.level === 'compatible' ? <p>{t('Everything in this workout works with the equipment of your current place.')}</p>
            : <><p>{t('{0} of {1} exercises need equipment not confirmed here. You can swap them for alternatives while you train.', fit.missing, fit.total)}</p>
              <ul>{fit.missingIds.slice(0, 6).map(id => <li key={id}>{nameFor(EXIDX[id]) || id}</li>)}</ul></>}
        </section>

        <section className="t2-before">
          <h2>{t('Before you start')}</h2>
          <ul>
            <li><Icon name="dumbbell" /><span><b>{t('You need')}</b>{gear.includes('none') ? t('Nothing: just your body') : gear.map(k => t(GEAR_LABEL[k])).join(' · ')}</span></li>
            <li><Icon name="timer" /><span><b>{t('Time')}</b>~{r.estimatedMinutes} min</span></li>
            <li><Icon name="target" /><span><b>{t('Level')}</b>{t(LEVEL_LABEL[r.level])}</span></li>
            {(r.tags || []).includes('low-impact') ? <li><Icon name="checkCircle" /><span><b>{t('Impact')}</b>{t('Low impact')}</span></li>
              : (r.tags || []).includes('no-jumps') ? <li><Icon name="checkCircle" /><span><b>{t('Impact')}</b>{t('No jumps')}</span></li> : null}
          </ul>
        </section>

        <section className="t2-plan">
          <h2>{t('What you will do')}</h2>
          <PartsTimeline r={r} />
          {r.category === 'tabata' && <p className="t2-note">{t('Tabata-format intervals: 20 s of work, 10 s of rest. Named after the format, not a replica of the original laboratory protocol.')}</p>}
          {r.category === 'mobility' && <p className="t2-note">{t('Mobility to move better before or after training. It is not a treatment; if something hurts, stop and tell your trainer.')}</p>}
        </section>

        {(canAssign || canEdit) && <section className="t2-staff">
          <h2>{t('For trainers')}</h2>
          <div className="t2-staff-acts">
            {canAssign && <button className="btn tinted" onClick={() => openSheet(close => <AssignSheet r={r} close={close} />)}><Icon name="users" />{t('Assign to a member')}</button>}
            {canAssign && <button className="btn plain" onClick={dup}><Icon name="clipboard" />{t('Duplicate and edit')}</button>}
            {canEdit && r.official && <button className="btn plain" onClick={() => openSheet(close => <CurateSheet r={r} close={close} />)}><Icon name="gear" />{t('Feature and order')}</button>}
          </div>
        </section>}
      </div>
    </div>
    <div className="t2-cta">
      <Heart id={r.id} className="big" />
      <button className={'btn t2-save' + (saved ? ' on' : '')} disabled={!!saved} aria-label={saved ? t('Already in your routines') : t('Save to my routines')} onClick={save}><Icon name={saved ? 'checkCircle' : 'plus'} />{saved ? t('Saved') : t('Save')}</button>
      <button className="btn primary t2-start" disabled={blocked} onClick={() => startOfficialRoutine(r)}><Icon name="play" />{t('Start')} · ~{r.estimatedMinutes} min</button>
    </div>
  </div>
}
