// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Constructor V2 — Program → Day → Blocks → Exercises, for one member, on a real screen.
//
// Nothing here is a second training model: a day is the member's routine (flat `ex`, what the
// app trains), a program is the member's program (routineIds + week). Blocks are copied in as
// editable instances (lib/protocol/blocks.js), so the library stays intact and the member's plan
// never depends on it. Saving uses the existing trainer endpoints (member-routine/member-program,
// with their Sync V2 receipts). Every change is validated live under the 2J protocol; a FAIL is
// shown and needs an explicit confirmation — the trainer's explicit decisions rank above the
// protocol (docs/TRAINING_PROTOCOL_2J.md), unlike a model's.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import GymProfile from '../../components/GymProfile.jsx'
import TrainingQualityPanel from '../../components/TrainingQualityPanel.jsx'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { DAYN } from '../../lib/format.js'
import { extractCustomDefs } from '../../lib/exercises.js'
import { glyphOf, DEFAULT_GLYPH } from '../../lib/glyphs.js'
import { fetchMemberPlan, fetchTrainerMembers, saveMemberRoutine, saveMemberProgram } from '../../lib/trainer-api.js'
import { useBlocks, validate, pushRecent } from '../../lib/blocks-api.js'
import { RESTRICTION_LABEL, savePolicy, OVERRIDE_REASON_MIN, instantiateBlock, GOALS, LEVELS, GOAL_LABEL, LEVEL_LABEL, RESTRICTIONS, FOCUS, FOCUS_LABEL, PROTOCOL_VERSION, isGuided, blockTypesOf } from '../../lib/protocol/index.js'
import { glyphPicker, confirmSheet, ExercisePicker } from '../../sheets.jsx'
import { exOr } from '../../lib/exercises.js'
import Library from '../../components/constructor/Library.jsx'
import DayCanvas, { insertInstance, insertExerciseAt, prescribedEntry, dayMinutes } from '../../components/constructor/DayCanvas.jsx'
import { ProtocolPill, ProtocolReport } from '../../components/constructor/parts.jsx'
import Suggestions from '../../components/constructor/Suggestions.jsx'
import { issueText } from '../../lib/blocks-api.js'
import Icon from '../../components/Icon.jsx'

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
// Every day's block types in one map (instance ids are unique) — what the validator judges by.
const typesOfDays = days => Object.assign({}, ...(days || []).map(d => blockTypesOf(d.blocks)))
let dayKey = 0
// A new day is unsaved; a day cloned from the member's plan passes dirty: false and stays clean.
const newDay = (name, from = {}) => ({ key: 'd' + (++dayKey), id: null, name, emoji: DEFAULT_GLYPH, ex: [], blocks: [], dirty: true, ...from })

/** A declared restriction is broken: no override here — change the plan or the restriction. */
function BlockedSheet({ issues, close }) {
  return <div className="cx-form">
    <h3>{t('This cannot be saved')}</h3>
    <p className="small">{t('It breaks a restriction declared for this member. Restrictions are never overridden from the builder: remove the exercise, or withdraw the restriction first if it no longer applies.')}</p>
    <ul className="cx-issues fail">{issues.map((i, k) => <li key={k}>{issueText(i)}</li>)}</ul>
    <button className="btn primary" onClick={close}>{t('Back to the builder')}</button>
  </div>
}

/** A methodological FAIL: the trainer may override it, consciously and with a written reason. */
function OverrideSheet({ issues, onConfirm, close }) {
  const [reason, setReason] = useState('')
  const [sure, setSure] = useState(false)
  const ok = reason.trim().length >= OVERRIDE_REASON_MIN && sure
  return <div className="cx-form">
    <h3>{t('Save outside the 2J protocol?')}</h3>
    <p className="small">{t('This does not fit the 2J protocol for the chosen goal and level:')}</p>
    <ul className="cx-issues fail">{issues.map((i, k) => <li key={k}>{issueText(i)}</li>)}</ul>
    <label className="cx-field"><span>{t('Why this plan is right for this member (saved with it)')}</span>
      <textarea className="input" rows={3} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} placeholder={t('e.g. Peaking week agreed with the member; back to normal next week.')} /></label>
    <label className="cx-check"><input type="checkbox" checked={sure} onChange={e => setSure(e.target.checked)} />{t('I understand this is outside the 2J protocol and take responsibility for it.')}</label>
    <button className="btn danger" disabled={!ok} onClick={() => { close(); onConfirm({ reason: reason.trim(), codes: [...new Set(issues.map(i => i.code))] }) }}>{t('Save with override')}</button>
  </div>
}

/** Save-as-block form: name + metadata; the server validates and never stores a FAIL. */
function SaveAsBlockSheet({ entries, meta, ctx, close }) {
  const save = useBlocks(s => s.save)
  const toast = useUI(s => s.toast)
  const [f, setF] = useState({ name: meta?.name || '', goal: meta?.goal || ctx.goal, level: meta?.level || ctx.level, focus: meta?.focus || '', description: '', reason: '' })
  const [busy, setBusy] = useState(false)
  const [v, setV] = useState(null)
  // A guided block (Constructor V2.1) is saved as what it is, pacing included.
  const type = isGuided(meta?.type) ? meta.type : entries.some(e => e.sg) ? 'superset' : entries.every(e => e.min != null && e.speed != null) ? 'cardio' : 'strength'
  const submit = async () => {
    if (!f.name.trim()) { toast(t('Give the block a name')); return }
    setBusy(true); setV(null)
    try {
      await save({ ...f, name: f.name.trim(), type, focus: f.focus || null, ...(isGuided(type) && meta?.timing ? { timing: meta.timing } : {}), ex: entries.map(({ blk, ...e }) => e) })
      toast(t('Saved to your blocks')); close()
    } catch (e) { toast(e.message); if (e.data?.validation) setV(e.data.validation) }
    setBusy(false)
  }
  const field = (k, label, opts) => <label className="cx-field"><span>{label}</span>
    <select className="input" value={f[k]} onChange={e => setF(x => ({ ...x, [k]: e.target.value }))}>{opts}</select></label>
  return <div className="cx-form">
    <h3>{t('Save as block')}</h3>
    <p className="dim small">{t('A personal block in your library. The day keeps its own copy.')}</p>
    <label className="cx-field"><span>{t('Name')}</span><input className="input" maxLength={60} value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} placeholder={t('e.g. Glutes · my Monday')} /></label>
    <div className="cx-form-row">
      {field('goal', t('Training goal'), GOALS.map(g => <option key={g} value={g}>{t(GOAL_LABEL[g])}</option>))}
      {field('level', t('Level'), LEVELS.map(l => <option key={l} value={l}>{t(LEVEL_LABEL[l])}</option>))}
      {field('focus', t('Muscle / pattern'), [<option key="" value="">—</option>, ...FOCUS.map(x => <option key={x} value={x}>{t(FOCUS_LABEL[x])}</option>)])}
    </div>
    <label className="cx-field"><span>{t('Description (optional)')}</span><input className="input" maxLength={300} value={f.description} onChange={e => setF(x => ({ ...x, description: e.target.value }))} /></label>
    <label className="cx-field"><span>{t('Reason for choices outside the preferred zone (optional)')}</span><input className="input" maxLength={300} value={f.reason} onChange={e => setF(x => ({ ...x, reason: e.target.value }))} placeholder={t('e.g. High range chosen for stable isolation.')} /></label>
    {v && <ProtocolReport v={v} dense />}
    <button className="btn primary" disabled={busy} onClick={submit}><Icon name="check" />{t('Save block')}</button>
  </div>
}

/**
 * The program's days as one horizontal strip above the builder: number, name, weekdays taken,
 * exercises/minutes and unsaved state; scrolls sideways when there are many days. The active day
 * is scrolled into view when it changes (e.g. right after "Add day").
 */
export function DayBar({ days, week, active, goal, onPick, onAdd, onToggleWeekday }) {
  const ref = useRef(null)
  useEffect(() => { ref.current?.querySelector('.cx-day.on')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }) }, [active, days.length])
  return <nav className="cx-days cx-daybar" aria-label={t('Days')} ref={ref}>
    {days.map((d, i) => {
      const wds = WEEK_ORDER.filter(wd => week[wd] === d.key)
      return <div key={d.key} className={'cx-day' + (i === active ? ' on' : '')}>
        <button className="cx-day-b" onClick={() => onPick(i)} aria-current={i === active ? 'true' : undefined}>
          <span className="cx-day-n num">{i + 1}</span>
          <span className="cx-day-t">
            <b>{d.name || t('Day')}{wds.length > 0 && <em className="cx-day-wd">{wds.map(wd => t(DAYN[wd]).slice(0, 2)).join(' · ')}</em>}</b>
            <small>{t('{0} exercises', d.ex.length)} · ~{dayMinutes(d.ex, goal, d.blocks)} min{d.dirty ? ' · ' + t('unsaved') : ''}</small>
          </span>
        </button>
        <div className="cx-wk">{WEEK_ORDER.map(wd => <button key={wd} className={'cx-wd' + (wds.includes(wd) ? ' on' : '') + (week[wd] && week[wd] !== d.key ? ' taken' : '')}
          aria-pressed={wds.includes(wd)} title={t(DAYN[wd])} onClick={() => onToggleWeekday(wd, d.key)}>{t(DAYN[wd]).slice(0, 2)}</button>)}</div>
      </div>
    })}
    <button className="cx-day-add" onClick={onAdd}><Icon name="plus" />{t('Add day')}</button>
  </nav>
}

export default function Constructor() {
  const nav = useNavigate()
  const { memberId, kind, id } = useParams()          // kind: 'p' program | 'r' routine
  const S = useStore(s => s.S)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const loadBlocks = useBlocks(s => s.load)
  const libBlocks = useBlocks(s => s.blocks)
  const [member, setMember] = useState(null)
  const [plan, setPlan] = useState(null)             // { sync, routines, programs }
  const [memberEquipment, setMemberEquipment] = useState(null)
  const [p, setP] = useState(null)                   // { id, name, emoji, meta, days, week: {weekday: key} }
  const [active, setActive] = useState(0)
  const [libOpen, setLibOpen] = useState(false)      // block library drawer (narrow screens)
  const [exOpen, setExOpen] = useState(false)        // exercise library drawer (narrow screens)
  const [flash, setFlash] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showReport, setShowReport] = useState(false)

  useEffect(() => {
    loadBlocks()
    fetchTrainerMembers().then(l => setMember(l.find(m => m.id === memberId) || null)).catch(() => {})
    fetchMemberPlan(memberId).then(pl => {
      setPlan(pl)
      setMemberEquipment(pl.gym?.availableEquipment || null)
      const clone = r => newDay(r.name, { id: r.id, emoji: r.emoji || DEFAULT_GLYPH, ex: JSON.parse(JSON.stringify(r.ex || [])), blocks: r.blocks || [], prog: r.prog, dirty: false })
      if (kind === 'r') {
        const r = id !== 'new' ? (pl.routines || []).find(x => x.id === id) : null
        if (id !== 'new' && !r) { toast(t('That routine no longer exists.')); nav('/trainer/' + memberId); return }
        const d = r ? clone(r) : newDay(t('Day {0}', 1))
        setP({ id: null, routineOnly: true, name: d.name, emoji: d.emoji, meta: r?.meta || { goal: 'hypertrophy', level: 'intermediate', restrictions: [] }, days: [d], week: {} })
        return
      }
      const prog = id !== 'new' ? (pl.programs || []).find(x => x.id === id) : null
      if (id !== 'new' && !prog) { toast(t('That program no longer exists.')); nav('/trainer/' + memberId); return }
      const days = prog ? (prog.routineIds || []).map(rid => (pl.routines || []).find(r => r.id === rid)).filter(Boolean).map(clone) : [newDay(t('Day {0}', 1))]
      const week = {}
      if (prog) for (const [wd, rid] of Object.entries(prog.week || {})) { const d = days.find(x => x.id === rid); if (d) week[wd] = d.key }
      const firstMeta = prog?.meta || days.find(d => d.meta)?.meta
      setP({ id: prog?.id || null, name: prog?.name || t('New program'), emoji: prog?.emoji || 'folder', meta: firstMeta || { goal: 'hypertrophy', level: 'intermediate', restrictions: [] }, days, week })
    }).catch(e => toast(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, kind, id])

  const ctx = p ? { goal: p.meta.goal || 'hypertrophy', level: p.meta.level || 'intermediate' } : { goal: 'hypertrophy', level: 'intermediate' }
  const restrictions = p?.meta.restrictions || []
  const day = p?.days[active]

  const dayV = useMemo(() => day ? validate({ kind: 'routine', goal: ctx.goal, level: ctx.level, entries: day.ex, blockTypes: blockTypesOf(day.blocks) }, { restrictions }) : null, [day, ctx.goal, ctx.level, restrictions])
  const weekDays = p ? WEEK_ORDER.map(wd => p.days.find(d => d.key === p.week[wd])).filter(Boolean) : []
  const progV = useMemo(() => p && !p.routineOnly ? validate({ kind: 'program', goal: ctx.goal, level: ctx.level, days: (weekDays.length ? weekDays : p.days).map(d => d.ex), blockTypes: typesOfDays(p.days) }, { restrictions }) : null, [p, ctx.goal, ctx.level])
  const issuesAt = useMemo(() => {
    const m = {}
    for (const i of dayV?.issues || []) if (i.where?.index != null && i.severity !== 'note') m[i.where.index] = m[i.where.index] === 'fail' ? 'fail' : (i.severity === 'fail' ? 'fail' : 'why')
    return m
  }, [dayV])

  // Blocks already copied into this plan are not suggested again.
  const inPlan = useMemo(() => new Set((p?.days || []).flatMap(d => (d.blocks || []).map(b => b.src)).filter(Boolean)), [p])
  const scheduledDays = useMemo(() => WEEK_ORDER.flatMap((weekday, index) => {
    const key = p?.week?.[weekday]
    return key ? [{ day: index, routineKey: key }] : []
  }), [p?.week])

  if (!p) return <div id="trainer-app" />

  const patchDay = next => setP(cur => ({ ...cur, days: cur.days.map((d, i) => i === active ? { ...next, dirty: true } : d) }))
  const setMeta = patch => setP(cur => ({ ...cur, meta: { ...cur.meta, ...patch }, days: cur.days.map(d => ({ ...d, dirty: true })) }))
  const addBlock = b => {
    const inst = instantiateBlock(b, t)
    patchDay(insertInstance(day, inst))
    pushRecent(b.id)
    setFlash(inst.meta.iid); setTimeout(() => setFlash(null), 1400)
    setLibOpen(false)
    toast(t('Block added — every exercise is now editable in this day'))
  }
  // One exercise from the library (Add button, row tap or a drop at `at`), prescribed by the protocol.
  const addExercise = (ex, at = null) => {
    patchDay(insertExerciseAt(day, prescribedEntry(ex, ctx, at ?? day.ex.length), at))
    setExOpen(false)
    toast(t('Exercise added'))
  }
  const onDropExternal = (kind, xid, at) => {
    if (kind === 'block') { const b = libBlocks.find(x => x.id === xid); if (b) addBlock(b) }
    else addExercise(exOr(xid), at)
  }
  // Wide screens show both libraries beside the day: the buttons focus their search. Narrow ones
  // open them as drawers (exercises from the left, blocks from the right).
  const wide = () => window.matchMedia?.('(min-width: 1100px)').matches
  const openLibrary = () => { if (wide()) document.getElementById('cx-lib-search')?.focus(); else { setExOpen(false); setLibOpen(true) } }
  const openExercises = () => { if (wide()) document.getElementById('cx-ex-search')?.focus(); else { setLibOpen(false); setExOpen(true) } }
  const saveAsBlock = (entries, meta) => openSheet(close => <SaveAsBlockSheet entries={entries} meta={meta} ctx={ctx} close={close} />)

  const addDay = () => setP(cur => { const d = newDay(t('Day {0}', cur.days.length + 1)); setActive(cur.days.length); return { ...cur, days: [...cur.days, d] } })
  const dupDay = i => setP(cur => {
    const src = cur.days[i]
    const d = newDay(src.name + ' · ' + t('copy'), { ex: JSON.parse(JSON.stringify(src.ex)), blocks: JSON.parse(JSON.stringify(src.blocks || [])), emoji: src.emoji })
    setActive(cur.days.length)
    return { ...cur, days: [...cur.days, d] }
  })
  const removeDay = i => confirmSheet({
    title: t('Remove this day from the program?'), message: t('Its routine stays on the member’s plan as a loose routine; nothing is deleted.'),
    confirmText: t('Remove'), danger: true,
    onConfirm: () => setP(cur => {
      const key = cur.days[i].key
      const week = Object.fromEntries(Object.entries(cur.week).filter(([, k]) => k !== key))
      setActive(Math.max(0, Math.min(active, cur.days.length - 2)))
      return { ...cur, days: cur.days.filter((_, k) => k !== i), week }
    }),
  })
  const toggleWeekday = (wd, key) => setP(cur => {
    const week = { ...cur.week }
    if (week[wd] === key) delete week[wd]; else week[wd] = key
    return { ...cur, week }
  })

  const doSave = async (override = null) => {
    if (p.days.some(d => !d.ex.length)) { toast(t('Every day needs at least one exercise.')); return }
    setBusy(true)
    try {
      let sync = plan.sync
      const idByKey = {}
      const meta = { goal: ctx.goal, level: ctx.level, restrictions, ...(override ? { override } : {}) }
      for (const d of p.days) {
        if (!d.dirty && d.id) { idByKey[d.key] = d.id; continue }
        const res = await saveMemberRoutine({ sync, memberId, ...(d.id ? { routineId: d.id } : {}), name: (d.name || '').trim() || t('Day'), emoji: d.emoji,
          ex: d.ex, blocks: d.blocks || [], meta, customExDefs: extractCustomDefs(d, S), ...(d.prog ? { prog: d.prog } : {}) })
        sync = res.sync; idByKey[d.key] = res.routineId
      }
      let programId = p.id
      if (!p.routineOnly) {
        const week = Object.fromEntries(Object.entries(p.week).map(([wd, k]) => [wd, idByKey[k]]).filter(([, v]) => v))
        const res = await saveMemberProgram({ sync, memberId, ...(p.id ? { programId: p.id } : {}), name: p.name.trim() || t('Program'), emoji: p.emoji, routineIds: p.days.map(d => idByKey[d.key]), week, meta })
        sync = res.sync; programId = res.programId || programId
      }
      setPlan(pl => ({ ...pl, sync }))
      setP(cur => ({ ...cur, id: programId, days: cur.days.map(d => ({ ...d, id: idByKey[d.key], dirty: false })) }))
      toast(t('Saved'))
      if (id === 'new') nav(`/trainer/${memberId}/build/${kind}/${p.routineOnly ? idByKey[p.days[0].key] : programId}`, { replace: true })
    } catch (e) { toast(e.message) }
    setBusy(false)
  }
  // Manual-save policy (lib/protocol/validator.js savePolicy), over EVERY day, scheduled or not:
  // restrictions block; a methodological FAIL needs a conscious override with a reason. The
  // server enforces the same, so nothing here can be skipped by calling the API directly.
  const save = () => {
    const saveV = validate({ kind: p.routineOnly ? 'routine' : 'program', goal: ctx.goal, level: ctx.level, entries: p.days[0]?.ex || [], days: p.days.map(d => d.ex), blockTypes: typesOfDays(p.days) }, { restrictions })
    const pol = savePolicy(saveV)
    if (pol.blocked.length) openSheet(close => <BlockedSheet issues={pol.blocked} close={close} />)
    else if (pol.needsReason) openSheet(close => <OverrideSheet issues={pol.override} close={close} onConfirm={o => doSave(o)} />)
    else doSave()
  }
  const dirty = p.days.some(d => d.dirty) || !p.id
  const titleValue = p.routineOnly ? day.name : p.name

  return <div className="cx-shell">
    <GymProfile />
    <header className="cx-top">
      <a className="trainer-back" href={'#/trainer/' + memberId}><Icon name="chevronLeft" />{member?.name || t('Member')}</a>
      <button className="cx-glyph" aria-label={t('Pick an icon')} onClick={() => glyphPicker(p.routineOnly ? day.emoji : p.emoji, g => p.routineOnly ? patchDay({ ...day, emoji: g }) : setP(c => ({ ...c, emoji: g })))}><Icon name={glyphOf(p.routineOnly ? day.emoji : p.emoji)} /></button>
      <input className="cx-title" value={titleValue} aria-label={p.routineOnly ? t('Routine name') : t('Program name')}
        onChange={e => p.routineOnly ? patchDay({ ...day, name: e.target.value }) : setP(c => ({ ...c, name: e.target.value }))} />
      <div className="cx-top-meta">
        <select className="cx-chipselect" value={ctx.goal} onChange={e => setMeta({ goal: e.target.value })} aria-label={t('Training goal')}>
          {GOALS.map(g => <option key={g} value={g}>{t(GOAL_LABEL[g])}</option>)}</select>
        <select className="cx-chipselect" value={ctx.level} onChange={e => setMeta({ level: e.target.value })} aria-label={t('Level')}>
          {LEVELS.map(l => <option key={l} value={l}>{t(LEVEL_LABEL[l])}</option>)}</select>
        <ProtocolPill v={progV || dayV} onClick={() => setShowReport(x => !x)} />
      </div>
      <button className={'btn primary cx-save' + (dirty ? ' dirty' : '')} disabled={busy} onClick={save}><Icon name="check" />{busy ? t('Saving…') : t('Save')}</button>
    </header>

    <div className="cx-restr" role="group" aria-label={t('Declared restrictions')}>
      <span className="cx-restr-l"><Icon name="shield" />{t('Restrictions')}</span>
      {RESTRICTIONS.map(r => <button key={r} className={'cx-rchip' + (restrictions.includes(r) ? ' on' : '')} aria-pressed={restrictions.includes(r)}
        onClick={() => setMeta({ restrictions: restrictions.includes(r) ? restrictions.filter(x => x !== r) : [...restrictions, r] })}>{t(RESTRICTION_LABEL[r])}</button>)}
      <span className="cx-restr-hint">{t('Only what was declared. 2J never infers or diagnoses.')}</span>
    </div>

    <TrainingQualityPanel routine={p.routineOnly ? day : null} days={p.routineOnly ? null : p.days} goal={ctx.goal} level={ctx.level} focus={p.meta?.focus} specialization={p.meta?.specialization} restrictions={restrictions}
      availableEquipment={memberEquipment} scheduledDays={p.routineOnly ? null : scheduledDays} />

    {showReport && <div className="cx-reportwrap"><ProtocolReport v={progV || dayV} /></div>}

    {!p.routineOnly && <DayBar days={p.days} week={p.week} active={active} goal={ctx.goal} onPick={setActive} onAdd={addDay} onToggleWeekday={toggleWeekday} />}

    <div className="cx-grid tri">
      <aside className={'cx-side cx-exlib' + (exOpen ? ' open' : '')} aria-label={t('Exercise library')}>
        <div className="cx-side-h">
          <h2>{t('Exercise library')}</h2>
          <button className="cx-icon cx-side-x" aria-label={t('Close')} onClick={() => setExOpen(false)}><Icon name="xmark" /></button>
        </div>
        <p className="cx-side-hint"><Icon name="arrowRight" />{t('Drag onto the day, or tap Add')}</p>
        <ExercisePicker inline searchId="cx-ex-search" close={() => {}} onPick={ex => addExercise(ex)} />
      </aside>

      <main className="cx-main">
        <div className="cx-dayhead">
          {!p.routineOnly && <input className="cx-dayname" value={day.name} onChange={e => patchDay({ ...day, name: e.target.value })} aria-label={t('Day name')} />}
          <span className="cx-daystats num">{t('{0} exercises', day.ex.length)} · {t('{0} sets', day.ex.reduce((a, e) => a + (Number(e.sets) || 1), 0))} · ~{dayMinutes(day.ex, ctx.goal, day.blocks)} min</span>
          <span className="grow" />
          {!p.routineOnly && <>
            <button className="cx-icon" title={t('Duplicate day')} aria-label={t('Duplicate day')} onClick={() => dupDay(active)}><Icon name="clipboard" /></button>
            {p.days.length > 1 && <button className="cx-icon" title={t('Remove day')} aria-label={t('Remove day')} onClick={() => removeDay(active)}><Icon name="trash" /></button>}
          </>}
          {day.ex.length > 0 && <button className="cx-icon" title={t('Save the whole day as a block')} aria-label={t('Save the whole day as a block')} onClick={() => saveAsBlock(day.ex, null)}><Icon name="download" /></button>}
          <button className="btn tinted cx-libbtn" onClick={openExercises}><Icon name="dumbbell" />{t('Exercises')}</button>
          <button className="btn tinted cx-libbtn" onClick={openLibrary}><Icon name="list" />{t('Blocks')}</button>
        </div>
        {(progV || dayV)?.stats?.exercises > 0 && <Suggestions v={progV || dayV} ctx={ctx} days={p.routineOnly ? 1 : (weekDays.length || p.days.filter(d => d.ex.length).length)}
          blocks={libBlocks} inPlan={inPlan} restrictions={restrictions} onAdd={addBlock} program={!p.routineOnly} />}
        <DayCanvas day={day} ctx={ctx} unit={S.unit} sharedNotesFor={memberId} onChange={patchDay} flash={flash} issuesAt={issuesAt}
          onAddBlock={openLibrary} onAddExercise={openExercises} onSaveAsBlock={saveAsBlock} onDropExternal={onDropExternal} />
        <p className="cx-foot dim small">{t('2J Protocol v{0} · validated as you build. Blocks are copied into the day: editing here never changes the library.', PROTOCOL_VERSION)}</p>
      </main>

      <aside className={'cx-side' + (libOpen ? ' open' : '')} aria-label={t('Block library')}>
        <div className="cx-side-h">
          <h2>{t('Block library')}</h2>
          <button className="cx-icon cx-side-x" aria-label={t('Close')} onClick={() => setLibOpen(false)}><Icon name="xmark" /></button>
        </div>
        <Library onAdd={addBlock} defaults={{ goal: '', level: '' }} />
      </aside>
      {(libOpen || exOpen) && <div className="cx-scrim" onClick={() => { setLibOpen(false); setExOpen(false) }} />}
    </div>
  </div>
}
