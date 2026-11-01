import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { uxOn } from '../lib/features.js'
import { useStore } from '../store/useStore.js'
import { uid } from '../lib/format.js'
import { RoutineCard, ProgramCard, ViewToggle } from '../components/PlanCards.jsx'
import { readViewModes, writeViewMode } from '../lib/view-pref.js'
import { t } from '../lib/i18n.js'
import { loadStarterPlan, planToolsSheet, scanRoutineSheet, celebrateBadges, startFlow, startOfficialRoutine } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { DEFAULT_GLYPH } from '../lib/glyphs.js'
import { coachAvailable } from '../lib/coach.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import Library from './Library.jsx'
import { printRoutines } from '../lib/plan-share.js'
import { evaluateBadgesIn } from '../lib/badges.js'
import { programMeta as programMetaOf } from '../lib/plan-cards.js'

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const update = useStore(s => s.update)
  useStore(s => s.features)
  const coachOn = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE }) && uxOn(S, 'coach')
  // Routines already inside a program are shown there, not loose here too — same routine,
  // one place, never two lists claiming it at once.
  // Settings → General → "Default tab" (S.defaultLibraryTab) only sets where this lands on
  // mount — read once into useState, same as any other "initial value from a setting" — so
  // switching tabs by hand afterward is never fought or reset back.
  const [tab, setTab] = useState(S.defaultLibraryTab || 'programs')
  const grouped = new Set((S.programs || []).flatMap(p => p.routineIds || []))
  const loose = S.routines.filter(r => !grouped.has(r.id))

  // Printing a hand-picked few routines instead of the whole loose list — see the "Select"
  // toggle in the Routines tab below.
  const [modes, setModes] = useState(() => readViewModes(user?.id))
  const setMode = (kind, mode) => setModes(writeViewMode(user?.id, kind, mode))
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const exitSelect = () => { setSelectMode(false); setSelected(new Set()) }
  const toggleSelected = id => setSelected(s => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const printSelected = () => {
    const picked = loose.filter(r => selected.has(r.id))
    printRoutines(picked, user?.name || '', S.unit)
    celebrateBadges(evaluateBadgesIn(update, s => { s.badgeFlags = { ...(s.badgeFlags || {}), sharedRoutine: true } }))
  }
  // Retroactive-friendly (see lib/badges.js's first_favorite) — the flag lives on the routine
  // itself, not a one-way S.badgeFlags entry, so un-favouriting and re-favouriting later never
  // re-triggers the celebration (evaluateBadges only ever unlocks a badge once, never re-locks).
  const toggleFav = (ev, id) => {
    ev.stopPropagation()
    celebrateBadges(evaluateBadgesIn(update, s => {
      const r = s.routines.find(x => x.id === id)
      r.fav = !r.fav
    }))
  }

  // Same routine, new id, never favourited: edits to the copy never touch the original (history keeps pointing at the original id).
  const duplicateRoutine = (ev, r) => {
    ev.stopPropagation()
    const copy = { ...JSON.parse(JSON.stringify(r)), id: uid(), name: r.name + ' ' + t('(copy)'), fav: false }
    update(s => { s.routines.push(copy) })
  }
  // "Continue program": an official 2J program starts its next session through the existing guided flow; a personal one starts its next routine.
  const continueProgram = (ev, p, meta) => {
    ev.stopPropagation()
    if (meta.kind === 'official' && meta.nextSession) {
      const routine = p.routineSnapshots?.[meta.nextSession.routineId]
      if (routine) startOfficialRoutine(routine, { programId: p.id, sessionId: meta.nextSession.sessionId, week: meta.nextSession.weekIndex + 1, day: meta.nextSession.day, routineId: meta.nextSession.routineId })
    } else if (meta.nextRoutine) startFlow(meta.nextRoutine.id)
  }
  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }
  const addProgram = () => {
    const p = { id: uid(), name: t('New program'), emoji: 'folder', routineIds: [] }
    update(s => { s.programs = s.programs || []; s.programs.push(p) })
    nav('/plan/p/' + p.id)
  }

  return <>
    <div className="hdr">
      <div><h1>{t('Library')}</h1><div className="sub">{t('Your weekly routine')}</div></div>
      {selectMode
        ? <button className="iconbtn" onClick={printSelected} disabled={!selected.size} aria-label={t('Print selected ({0})', selected.size)} title={t('Print selected ({0})', selected.size)}><Icon name="download" /></button>
        : <>
          {coachOn && <button className="iconbtn" onClick={() => nav('/coach')} aria-label={t('Coach')} title={t('Coach')}><Icon name="sparkles" /></button>}
          <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
        </>}
    </div>
    <div className="ptabs">
      {[{ value: 'programs', icon: 'calendar', label: t('Programs') },
        { value: 'routines', icon: 'clipboard', label: t('Routines') },
        { value: 'library', icon: 'exercises', label: t('Exercises') }].map(o => (
        <button key={o.value} className={'ptab' + (tab === o.value ? ' on' : '')} onClick={() => setTab(o.value)}>
          <span className="ptab-i"><Icon name={o.icon} /></span>{o.label}
        </button>
      ))}
    </div>
    <div style={{ height: 14 }} />

    {tab === 'programs' ? <>
      <div className="row between v3-sec-row" style={{ marginBottom: 10 }}>
        <div className="row" style={{ gap: 10 }}><h4 className="sec" style={{ margin: 0 }}>{t('Programs')}</h4>
          {(S.programs || []).length > 0 && <ViewToggle value={modes.programs} onChange={m => setMode('programs', m)} />}</div>
        <div className="row v3-sec-acts" style={{ gap: 8 }}>
          <Button size="sm" variant="tinted" icon="plus" onClick={addProgram}>{t('New')}</Button>
        </div>
      </div>
      {(S.programs || []).length ? <div className={modes.programs === 'rows' ? 'v3-list' : 'v3-grid'}>{S.programs.map(p => <ProgramCard key={p.id} p={p} S={S} layout={modes.programs}
        onOpen={() => nav(p.source === 'guided-v2' && p.catalogId ? '/train2j/program/' + p.catalogId : '/plan/p/' + p.id)}
        onContinue={ev => continueProgram(ev, p, programMetaOf(p, S))} />)}</div> : <>
        <div className="empty"><div className="ico"><Icon name="folder" /></div>{t('No programs yet.')}<br />{t('Group a few routines together — a whole split, a block, a phase.')}</div>
        <Button icon="plus" onClick={addProgram}>{t('New program')}</Button>
      </>}
    </> : tab === 'routines' ? <>
      <div className="row between v3-sec-row" style={{ marginBottom: 10 }}>
        <div className="row" style={{ gap: 10 }}><h4 className="sec" style={{ margin: 0 }}>{t('Routines')}</h4>
          {loose.length > 0 && <ViewToggle value={modes.routines} onChange={m => setMode('routines', m)} />}</div>
        <div className="row v3-sec-acts" style={{ gap: 8 }}>
          {loose.length > 0 && (selectMode
            ? <Button size="sm" onClick={exitSelect}>{t('Cancel')}</Button>
            : <Button size="sm" icon="checkCircle" onClick={() => setSelectMode(true)}>{t('Select to print')}</Button>)}
          {!selectMode && <Button size="sm" variant="tinted" icon="scan" onClick={scanRoutineSheet}>{t('Scan')}</Button>}
          <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New')}</Button>
        </div>
      </div>
      {loose.length ? <div className={modes.routines === 'rows' ? 'v3-list' : 'v3-grid'}>{loose.map(r => <RoutineCard key={r.id} r={r} S={S} layout={modes.routines} selecting={selectMode} selected={selected.has(r.id)}
        onOpen={() => selectMode ? toggleSelected(r.id) : nav('/plan/r/' + r.id)}
        onStart={ev => { ev.stopPropagation(); startFlow(r.id) }} onFav={ev => toggleFav(ev, r.id)} onDuplicate={ev => duplicateRoutine(ev, r)} />)}</div> : <>
        <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Create one or load the starter plan.')}</div>
        <Button icon="sparkles" onClick={loadStarterPlan}>{t('Load starter plan (Push / Pull / Legs)')}</Button>
      </>}
    </> : <Library />}
  </>
}
