// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Constructor V2 — one day as a canvas of blocks. The day is still a plain routine: a flat
// `ex` list (what Workout, Bunker, Sync and Progressive Overload read, unchanged) plus optional
// `blocks` labels; entries carry `blk` = the instance they belong to. Loose entries (old
// routines, or exercises added one by one) are simply the segments with no block.
import { useState } from 'react'
import { useUI } from '../../store/useUI.js'
import { t, nameFor } from '../../lib/i18n.js'
import { GymCompatibility } from '../GymProfile.jsx'
import { exOr, EXIDX } from '../../lib/exercises.js'
import { cleanupSg } from '../../lib/history.js'
import { uid } from '../../lib/format.js'
import { supersetGroupInfo, supersetLabel } from '../../lib/superset-colors.js'
import { segmentsOf, pruneBlocks, estimateSeconds, roundMinutes, classify, prescribe, restDemand, REST_DEFAULTS, GOAL_LABEL, LEVEL_LABEL, STYLE_LABEL, modeOfEntry, blockTitle,
  isGuided, sanitizeTiming, defaultTiming, applyTiming, guidedSeconds, TIMING_PRESETS, TYPE_LABEL, PROTOCOL_VERSION } from '../../lib/protocol/index.js'
import { timingLine } from '../../lib/guided.js'
import { lookup } from '../../lib/blocks-api.js'
import { alternativesSheet, exConfigSheet, exerciseNotesSheet } from '../../sheets.jsx'
import { Thumb } from '../Media.jsx'
import { Stepper } from '../ui.jsx'
import Icon from '../Icon.jsx'
import { TypeTag, Prescription, rpeOf, restLabel } from './parts.jsx'
import { EX_DRAG_TYPE, BLOCK_DRAG_TYPE, dragKindOf } from './drag.js'
import SharedExerciseNote from '../SharedExerciseNote.jsx'

const KEEP = ['blk', 'rpe', 'rest', 'role', 'note', 'why', 'sg']
const restOf = (e, goal) => e.rest ?? REST_DEFAULTS[restDemand(classify(e.id, lookup), goal, e.role)]
// A guided segment lasts what its timing says; everything else keeps the protocol's estimate.
const segSeconds = (entries, meta, goal) => meta && isGuided(meta.type) ? guidedSeconds(entries, meta.timing, meta.type) : estimateSeconds(entries, e => restOf(e, goal))
export const dayMinutes = (ex, goal, blocks) => roundMinutes(segmentsOf({ ex: ex || [], blocks }).reduce((a, s) => a + segSeconds(s.idx.map(i => ex[i]), s.meta, goal), 0))
export const guidedName = (type, tm) => tm?.preset === 'tabata' ? 'Tabata' : TYPE_LABEL[type] || type

// ── pure day operations (exported for tests) ──────────────────────────────────────────────
export const withEx = (day, ex) => { cleanupSg(ex); const next = { ...day, ex }; next.blocks = pruneBlocks(next); return next }
export function moveEntry(day, from, to, blk) {
  const ex = day.ex.map(e => ({ ...e }))
  const [e] = ex.splice(from, 1)
  const at = to > from ? to - 1 : to
  if (blk) e.blk = blk; else delete e.blk
  ex.splice(Math.max(0, Math.min(ex.length, at)), 0, e)
  return withEx(day, ex)
}
export function moveSegment(day, segIdx, toSegIdx) {
  const segs = segmentsOf(day)
  if (toSegIdx < 0 || toSegIdx >= segs.length || toSegIdx === segIdx) return day
  const order = segs.map((_, i) => i)
  const [s] = order.splice(segIdx, 1)
  order.splice(toSegIdx, 0, s)
  return withEx(day, order.flatMap(i => segs[i].idx.map(k => ({ ...day.ex[k] }))))
}
export const removeSegment = (day, seg) => withEx(day, day.ex.filter((_, i) => !seg.idx.includes(i)).map(e => ({ ...e })))
export const ungroupSegment = (day, seg) => withEx(day, day.ex.map((e, i) => { const c = { ...e }; if (seg.idx.includes(i)) delete c.blk; return c }))
/**
 * One exercise entry into the day: at index `at` (joining the block of the entry it lands on,
 * like a manual reorder), or appended as a loose exercise when `at` is null.
 */
export function insertExerciseAt(day, entry, at = null) {
  const ex = day.ex.map(e => ({ ...e }))
  const e = { ...entry }
  delete e.blk; delete e.sg
  if (at == null || at < 0 || at >= ex.length) ex.push(e)
  else { if (ex[at].blk) e.blk = ex[at].blk; ex.splice(at, 0, e) }
  return withEx(day, ex)
}
export function insertInstance(day, inst) {
  return withEx({ ...day, blocks: [...(day.blocks || []), inst.meta] }, [...day.ex.map(e => ({ ...e })), ...inst.ex])
}
/**
 * Make a segment a guided block (Constructor V2.1), or retime one: loose exercises get a block
 * instance of their own; the entries are shaped to the timing (rounds = sets, timed bouts) and
 * superset links inside it are dropped — a guided block already sets the order.
 */
export function setSegmentTiming(day, seg, type, timing, name) {
  const tm = sanitizeTiming(timing, type)
  if (!tm) return day
  const ex = day.ex.map(e => ({ ...e }))
  let blocks = [...(day.blocks || [])]
  let iid = seg.blk
  if (!iid) {
    iid = 'k' + uid()
    blocks.push({ iid, src: null, name: name || null, type, goal: null, level: null, focus: null, variant: null, style: null, v: PROTOCOL_VERSION })
    seg.idx.forEach(k => { ex[k].blk = iid })
  }
  const shaped = applyTiming(seg.idx.map(k => ex[k]), type, tm)
  seg.idx.forEach((k, j) => { ex[k] = shaped[j]; delete ex[k].sg })
  blocks = blocks.map(b => b.iid === iid ? { ...b, type, timing: tm } : b)
  return withEx({ ...day, blocks }, ex)
}
/** Back to plain sets: the block keeps its exercises (and label), without pacing. */
export function clearSegmentTiming(day, seg) {
  if (!seg.blk) return day
  return withEx({ ...day, blocks: (day.blocks || []).map(b => { if (b.iid !== seg.blk) return b; const c = { ...b, type: 'strength' }; delete c.timing; return c }) }, day.ex.map(e => ({ ...e })))
}

export function toggleLink(day, i) {
  const ex = day.ex.map(e => ({ ...e }))
  const cur = ex[i], prev = ex[i - 1]
  if (!prev || (prev.blk || null) !== (cur.blk || null)) return day
  if (cur.sg && prev.sg && cur.sg === prev.sg) delete cur.sg
  else { const g = prev.sg || ('sg' + uid()); prev.sg = g; cur.sg = g }
  return withEx(day, ex)
}

// ── prescription editor ───────────────────────────────────────────────────────────────────
const RESTS = [45, 60, 75, 90, 120, 150, 180, 240]
function PrescriptionSheet({ e, ctx, onSave, onMore, close, guided }) {
  const [c, setC] = useState(() => ({ ...e }))
  const mode = modeOfEntry(c)
  const sets = Math.max(1, Number(c.sets) || 1)
  const rpe = Array.from({ length: sets }, (_, i) => rpeOf(c)[i] ?? null)
  const setRpe = (i, v) => setC(x => { const r = Array.from({ length: sets }, (_, k) => rpeOf(x)[k] ?? rpe[k] ?? 8); r[i] = v; return { ...x, rpe: r } })
  const setSets = n => setC(x => { const k = Math.max(1, Math.min(10, Math.round(n) || 1)); const r = rpeOf(x); return { ...x, sets: k, ...(r.length ? { rpe: Array.from({ length: k }, (_, i) => r[i] ?? r[r.length - 1]) } : {}) } })
  const lo = c.targetRepsMin ?? c.repsMin ?? c.reps ?? 10, hi = c.targetRepsMax ?? c.reps ?? 10
  const setRange = (a, b) => setC(x => ({ ...x, targetRepsMin: Math.max(1, a), targetRepsMax: Math.max(a, b), reps: Math.max(a, b), ...(x.prog === 'double' ? { repsMin: Math.max(1, a) } : {}) }))
  const auto = () => setC(x => ({ ...x, ...prescribe(classify(x.id, lookup), { goal: ctx.goal, level: ctx.level, role: x.role || null }) }))
  const ex = exOr(e.id)
  return <div className="cx-rxsheet">
    <h3 className="capitalize">{nameFor(ex)}</h3>
    <div className="cx-rxsheet-grid">
      <Stepper label={t('Sets')} value={sets} step={1} decimal={false} onChange={setSets} />
      {mode === 'reps' && <>
        <Stepper label={t('Reps min')} value={lo} step={1} decimal={false} onChange={v => setRange(v, Math.max(v, hi))} />
        <Stepper label={t('Reps max')} value={hi} step={1} decimal={false} onChange={v => setRange(Math.min(lo, v), v)} />
      </>}
      {mode === 'time' && <Stepper label={t('Seconds')} value={c.sec || 45} step={5} decimal={false} onChange={v => setC(x => ({ ...x, sec: v }))} />}
      {mode === 'cardio' && <Stepper label={t('Minutes')} value={c.min || 20} step={1} decimal={false} onChange={v => setC(x => ({ ...x, min: v }))} />}
    </div>
    {mode !== 'cardio' && <>
      <div className="cx-rxsheet-l">{t('Effort per set')} <span className="dim">{t('2J scale: 4 comfortable · 6 a bit hard · 8 hard · 10 maximum')}</span></div>
      <div className="cx-rpe-row">{rpe.map((v, i) => <div key={i} className="cx-rpe-set">
        <span className="num">{i + 1}</span>
        {[4, 6, 8, 10].map(n => <button key={n} className={'cx-rpe-b r' + n + (v === n ? ' on' : '')} aria-pressed={v === n} aria-label={t('Set {0}: RPE {1}', i + 1, n)} onClick={() => setRpe(i, n)}>{n}</button>)}
      </div>)}</div>
      {guided ? <p className="dim small">{t('Rest comes from the block’s guided timing.')}</p> : <>
      <div className="cx-rxsheet-l">{t('Rest after the set')}</div>
      <div className="cx-chips">
        {RESTS.map(s => <button key={s} className={'chip' + (c.rest === s ? ' on' : '')} aria-pressed={c.rest === s} onClick={() => setC(x => ({ ...x, rest: s }))}>{restLabel(s)}</button>)}
        <button className={'chip' + (c.rest == null ? ' on' : '')} onClick={() => setC(x => { const y = { ...x }; delete y.rest; return y })}>{t('Member setting')}</button>
      </div></>}
    </>}
    <div className="cx-rxsheet-acts">
      <button className="btn plain" onClick={auto}><Icon name="sparkles" />{t('Prescribe with the 2J protocol')}</button>
      <button className="btn plain" onClick={() => { close(); onMore() }}><Icon name="gear" />{t('More settings')}</button>
      <button className="btn primary" onClick={() => { close(); onSave(c) }}><Icon name="check" />{t('Save')}</button>
    </div>
  </div>
}

function RowMenu({ e, close, onReplace, onNotes, onMore, onRemove, onVideo }) {
  const act = fn => () => { close(); fn() }
  return <div className="cx-menu">
    <h3 className="capitalize">{nameFor(exOr(e.id))}</h3>
    <button onClick={act(onReplace)}><Icon name="shuffle" />{t('Replace exercise')}</button>
    <button onClick={act(onNotes)}><Icon name="clipboard" />{e.note ? t('Edit routine note') : t('Add a routine note')}</button>
    <button onClick={act(onMore)}><Icon name="gear" />{t('Mode, weight and progression')}</button>
    {onVideo && <button onClick={act(onVideo)}><Icon name="play" />{t('Video and instructions')}</button>}
    <button className="danger" onClick={act(onRemove)}><Icon name="trash" />{t('Remove from the day')}</button>
  </div>
}

// ── guided timing (Constructor V2.1) ──────────────────────────────────────────────────────
const GUIDED_CHOICES = [
  { key: 'circuit', type: 'circuit', icon: 'intervals', label: 'Circuit', desc: 'One exercise after another, by time or reps, for several rounds.' },
  { key: 'hiit', type: 'hiit', icon: 'bolt', label: 'HIIT', desc: 'Hard work bouts with short, fixed rests.' },
  { key: 'tabata', type: 'hiit', preset: 'tabata', icon: 'bolt', label: 'Tabata', desc: '20 s on, 10 s off, 8 rounds to start — every number stays editable.' },
  { key: 'interval', type: 'interval', icon: 'timer', label: 'Intervals', desc: 'Work and recovery at set times, usually on a machine.' },
  { key: 'mobility', type: 'mobility', icon: 'stretch', label: 'Mobility', desc: 'Hold each position for its time, then the next.' },
]
const choiceOf = (type, tm) => GUIDED_CHOICES.find(c => c.type === type && (c.preset || null) === (tm?.preset || null)) || GUIDED_CHOICES[0]

function TimingSheet({ seg, entries, onSave, onClear, close }) {
  const meta = seg.meta
  const start = isGuided(meta?.type) ? meta.type : 'circuit'
  const [choice, setChoice] = useState(() => choiceOf(start, meta?.timing).key)
  const [tm, setTm] = useState(() => sanitizeTiming(meta?.timing, start) || defaultTiming(start))
  const c = GUIDED_CHOICES.find(x => x.key === choice)
  const pick = next => {
    setChoice(next.key)
    setTm(cur => {
      const base = { ...defaultTiming(next.type), prep: cur.prep }
      return next.preset ? { ...base, ...TIMING_PRESETS[next.preset], preset: next.preset } : base
    })
  }
  // Editing a number keeps the Tabata label only while it still is 20/10 × 8.
  const setK = (k, v) => setTm(cur => {
    const n = { ...cur, [k]: v }
    if (n.preset === 'tabata' && !(n.work === 20 && n.rest === 10 && n.rounds === 8)) delete n.preset
    return n
  })
  const clean = sanitizeTiming(tm, c.type)
  const shaped = applyTiming(entries, c.type, clean)
  const mins = roundMinutes(guidedSeconds(shaped, clean, c.type))
  const reps = c.type === 'circuit' && entries.some(e => modeOfEntry(e) !== 'time')
  return <div className="cx-form cx-timing">
    <h3>{t('Guided block')}</h3>
    <p className="dim small">{t('The member runs it with a timer: get ready, work, rest, next — round after round. The exercises stay editable in the day.')}</p>
    <div className="cx-tchoices" role="radiogroup" aria-label={t('Format')}>
      {GUIDED_CHOICES.map(x => <button key={x.key} role="radio" aria-checked={choice === x.key} className={'cx-tchoice' + (choice === x.key ? ' on' : '')} onClick={() => pick(x)}>
        <Icon name={x.icon} /><b>{t(x.label)}</b><small>{t(x.desc)}</small></button>)}
    </div>
    <div className="cx-rxsheet-grid cx-tgrid">
      <Stepper label={t('Get ready (s)')} value={tm.prep} step={5} decimal={false} onChange={v => setK('prep', v)} />
      <Stepper label={reps ? t('Work per timed exercise (s)') : t('Work (s)')} value={tm.work} step={5} decimal={false} onChange={v => setK('work', v)} />
      <Stepper label={t('Rest after each (s)')} value={tm.rest} step={5} decimal={false} onChange={v => setK('rest', v)} />
      <Stepper label={t('Rounds')} value={tm.rounds} step={1} decimal={false} onChange={v => setK('rounds', v)} />
      {tm.rounds > 1 && <Stepper label={t('Rest between rounds (s)')} value={tm.roundRest} step={15} decimal={false} onChange={v => setK('roundRest', v)} />}
    </div>
    {reps && <p className="dim small">{t('Exercises prescribed in reps keep their reps: the member taps Done when finished.')}</p>}
    <div className="cx-tsum num"><Icon name="timer" />{timingLine(clean)} · ~{mins} min</div>
    <div className="cx-rxsheet-acts">
      {onClear && <button className="btn plain" onClick={() => { close(); onClear() }}>{t('Back to normal sets')}</button>}
      <button className="btn primary" onClick={() => { close(); onSave(c.type, clean, t(c.label)) }}><Icon name="check" />{t('Apply')}</button>
    </div>
  </div>
}

/**
 * @param day       { name, ex, blocks }
 * @param ctx       { goal, level }
 * @param onChange  (nextDay) => void
 * @param onAddBlock, onAddExercise   open the library / the exercise picker
 * @param onSaveAsBlock (entries, meta) => void
 * @param onDropExternal (kind: 'ex'|'block', id, at: index|null) => void — a drag from the
 *        exercise or block library (components/constructor/drag.js); omitted = no external drops
 */
export default function DayCanvas({ day, ctx, unit, sharedNotesFor, onChange, onAddBlock, onAddExercise, onSaveAsBlock, onDropExternal, flash, issuesAt = {} }) {
  const openSheet = useUI(s => s.openSheet)
  const [drag, setDrag] = useState(null)        // { kind:'ex', i } | { kind:'seg', s }
  const [over, setOver] = useState(null)        // drop target key
  const segs = segmentsOf(day)
  const ss = supersetGroupInfo(day.ex)
  const set = next => onChange(next)

  const editRx = i => {
    const e = day.ex[i]
    const more = () => exConfigSheet(exOr(e.id), e, cfg => set(withEx(day, day.ex.map((x, k) => k !== i ? { ...x } : { ...Object.fromEntries(KEEP.filter(f => x[f] != null).map(f => [f, x[f]])), id: x.id, ...cfg }))), () => set(withEx(day, day.ex.filter((_, k) => k !== i).map(x => ({ ...x })))), day)
    const guided = isGuided(segs.find(s => s.idx.includes(i))?.meta?.type)
    openSheet(close => <PrescriptionSheet e={e} ctx={ctx} close={close} onMore={more} guided={guided}
      onSave={c => set(withEx(day, day.ex.map((x, k) => k !== i ? { ...x } : c)))} />)
  }
  const rowMenu = i => {
    const e = day.ex[i]
    openSheet(close => <RowMenu e={e} close={close}
      onReplace={() => alternativesSheet(exOr(e.id), n => set(withEx(day, day.ex.map((x, k) => k !== i ? { ...x } : { ...x, id: n.id }))))}
      onNotes={() => exerciseNotesSheet(exOr(e.id), e, note => set(withEx(day, day.ex.map((x, k) => { if (k !== i) return { ...x }; const y = { ...x }; if (note) y.note = note; else delete y.note; return y }))))}
      onMore={() => exConfigSheet(exOr(e.id), e, cfg => set(withEx(day, day.ex.map((x, k) => k !== i ? { ...x } : { ...Object.fromEntries(KEEP.filter(f => x[f] != null).map(f => [f, x[f]])), id: x.id, ...cfg }))), null, day)}
      onRemove={() => set(withEx(day, day.ex.filter((_, k) => k !== i).map(x => ({ ...x }))))} />)
  }
  const editTiming = seg => openSheet(close => <TimingSheet seg={seg} entries={seg.idx.map(k => day.ex[k])} close={close}
    onSave={(type, timing, name) => set(setSegmentTiming(day, seg, type, timing, name))}
    onClear={isGuided(seg.meta?.type) ? () => set(clearSegmentTiming(day, seg)) : null} />)
  const segMenu = (seg, si) => openSheet(close => <div className="cx-menu">
    <h3>{seg.meta?.name || t('Exercises')}</h3>
    <button onClick={() => { close(); editTiming(seg) }}><Icon name="timer" />{isGuided(seg.meta?.type) ? t('Guided timing') : t('Run as a guided block')}</button>
    {onSaveAsBlock && <button onClick={() => { close(); onSaveAsBlock(seg.idx.map(k => day.ex[k]), seg.meta) }}><Icon name="download" />{t('Save as block')}</button>}
    <button disabled={si === 0} onClick={() => { close(); set(moveSegment(day, si, si - 1)) }}><Icon name="arrowUp" />{t('Move block up')}</button>
    <button disabled={si === segs.length - 1} onClick={() => { close(); set(moveSegment(day, si, si + 1)) }}><Icon name="arrowDown" />{t('Move block down')}</button>
    {seg.blk && <button onClick={() => { close(); set(ungroupSegment(day, seg)) }}><Icon name="list" />{t('Keep exercises, drop the block label')}</button>}
    <button className="danger" onClick={() => { close(); set(removeSegment(day, seg)) }}><Icon name="trash" />{t('Remove these exercises')}</button>
  </div>)

  // native drag & drop — no dependency; buttons remain the accessible path
  const onDrop = (kind, target) => ev => {
    ev.preventDefault(); setOver(null)
    if (!drag) return
    if (drag.kind === 'ex' && kind === 'ex') set(moveEntry(day, drag.i, target.i, target.blk))
    else if (drag.kind === 'ex' && kind === 'seg-end') set(moveEntry(day, drag.i, target.end, target.blk))
    else if (drag.kind === 'seg' && (kind === 'seg' || kind === 'seg-end')) set(moveSegment(day, drag.s, target.s))
    setDrag(null)
  }
  const dragOver = key => ev => { ev.preventDefault(); if (over !== key) setOver(key) }
  // Drags from the libraries: an exercise lands before the row it is dropped on (or at the end),
  // a block is always appended as a new segment — the same result as its "Add" button.
  const ext = !!onDropExternal
  const extOver = key => ev => { const k = dragKindOf(ev); if (!k || (key !== 'ext' && k !== 'ex')) return; ev.preventDefault(); ev.stopPropagation(); ev.dataTransfer.dropEffect = 'copy'; if (over !== key) setOver(key) }
  const extDrop = at => ev => {
    const k = dragKindOf(ev)
    if (!k || (at != null && k !== 'ex')) return
    ev.preventDefault(); ev.stopPropagation(); setOver(null)
    const id = ev.dataTransfer.getData(k === 'ex' ? EX_DRAG_TYPE : BLOCK_DRAG_TYPE)
    if (id) onDropExternal(k, id, k === 'ex' ? at : null)
  }
  const extLeave = ev => { if (!ev.currentTarget.contains(ev.relatedTarget)) setOver(null) }
  const canvasDnd = ext ? { onDragOver: extOver('ext'), onDrop: extDrop(null), onDragLeave: extLeave } : {}

  if (!day.ex.length) return <div className={'cx-empty' + (over === 'ext' ? ' drop' : '')} {...canvasDnd}>
    <div className="cx-empty-ico"><Icon name="plus" /></div>
    <h3>{t('Start this day')}</h3>
    <p>{t('Add a 2J block to have a full prescription in one tap, or build it exercise by exercise.')}</p>
    {ext && <p className="cx-drophint">{t('Or drag an exercise or a block here')}</p>}
    <div className="cx-empty-acts">
      {onAddBlock && <button className="btn primary" onClick={onAddBlock}><Icon name="list" />{t('Add block')}</button>}
      <button className="btn plain" onClick={onAddExercise}><Icon name="dumbbell" />{t('Add exercise')}</button>
    </div>
  </div>

  return <div className={'cx-canvas' + (over === 'ext' ? ' drop' : '')} onDragEnd={() => { setDrag(null); setOver(null) }} {...canvasDnd}>
    {segs.map((seg, si) => {
      const entries = seg.idx.map(k => day.ex[k])
      const meta = seg.meta
      const guided = isGuided(meta?.type)
      const mins = roundMinutes(segSeconds(entries, meta, ctx.goal))
      const key = 'seg' + si
      return <section key={(seg.blk || 'loose') + si}
        className={'cx-block' + (seg.blk ? '' : ' loose') + (flash && seg.blk === flash ? ' cx-flash' : '') + (over === key ? ' drop' : '') + (drag?.kind === 'seg' && drag.s === si ? ' dragging' : '')}
        onDragOver={drag?.kind === 'seg' ? dragOver(key) : undefined} onDrop={drag?.kind === 'seg' ? onDrop('seg', { s: si }) : undefined}>
        <header className="cx-block-h">
          <span className="cx-grip" draggable onDragStart={ev => { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', 'seg'); setDrag({ kind: 'seg', s: si }) }} title={t('Drag to reorder')} aria-hidden="true" />
          <TypeTag type={meta?.type || (entries.some(e => e.sg) ? 'superset' : 'strength')} compact />
          <div className="cx-block-t">
            <div className="cx-block-name">{meta?.name || (seg.blk ? t('Block') : t('Exercises'))}</div>
            {guided && <button className="cx-tline num" onClick={() => editTiming(seg)} aria-label={t('Guided timing')}>
              <Icon name="timer" /><b>{t(guidedName(meta.type, meta.timing))}</b>{timingLine(meta.timing)}</button>}
            {meta && <div className="cx-block-sub">
              {[meta.goal && t(GOAL_LABEL[meta.goal]), meta.level && t(LEVEL_LABEL[meta.level]), meta.style && t(STYLE_LABEL[meta.style] || meta.style)].filter(Boolean).join(' · ')}
              {meta.src && <span className="cx-from">{meta.src.startsWith('off-') ? t('from the 2J library') : t('from your blocks')}</span>}
            </div>}
          </div>
          <span className="cx-block-min num">~{mins} min</span>
          <button className="cx-icon" aria-label={t('Block options')} onClick={() => segMenu(seg, si)}><Icon name="moreH" /></button>
        </header>
        <ol className="cx-rows">
          {seg.idx.map((i, pos) => {
            const e = day.ex[i], ex = EXIDX[e.id] || exOr(e.id), info = ss[i]
            const canLink = pos > 0
            const linked = canLink && e.sg && day.ex[i - 1].sg === e.sg
            const rk = 'ex' + i
            const bad = issuesAt[i]
            return <li key={i} className={'cx-row' + (info ? ' ss' : '') + (info && info.pos === 1 ? ' ss-first' : '') + (info && info.pos === info.size ? ' ss-last' : '') + (over === rk ? ' drop' : '') + (drag?.kind === 'ex' && drag.i === i ? ' dragging' : '') + (bad ? ' ' + bad : '')}
              style={info ? { '--ss': `var(--${info.token})` } : undefined}
              draggable onDragStart={ev => { ev.stopPropagation(); ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', 'ex'); setDrag({ kind: 'ex', i }) }}
              onDragOver={drag?.kind === 'ex' ? dragOver(rk) : ext ? extOver(rk) : undefined} onDrop={drag?.kind === 'ex' ? onDrop('ex', { i, blk: e.blk }) : ext ? extDrop(i) : undefined}>
              {canLink && <button className={'cx-link' + (linked ? ' on' : '')} aria-pressed={!!linked} title={linked ? t('Unlink superset') : t('Superset with the exercise above')} onClick={() => set(toggleLink(day, i))}><Icon name="link" /></button>}
              <span className="cx-grip sm" aria-hidden="true" />
              <span className="cx-n num">{info ? <b className="cx-ss">{supersetLabel(info)}</b> : pos + 1}</span>
              <Thumb ex={ex} />
              <div className="cx-row-main">
                <div className="cx-ex-name capitalize">{nameFor(ex)}</div>
                <GymCompatibility ex={ex} />
                {e.note && <div className="cx-row-note">{e.note}</div>}
                {sharedNotesFor && <SharedExerciseNote exerciseId={e.id} memberId={sharedNotesFor} />}
              </div>
              <Prescription e={e} onClick={() => editRx(i)} />
              <div className="cx-row-acts">
                <button className="cx-icon sm" aria-label={t('Move up')} disabled={i === 0} onClick={() => set(moveEntry(day, i, i - 1, day.ex[i - 1]?.blk))}><Icon name="chevronUp" /></button>
                <button className="cx-icon sm" aria-label={t('Move down')} disabled={i === day.ex.length - 1} onClick={() => set(moveEntry(day, i, i + 2, day.ex[i + 1]?.blk))}><Icon name="chevronDown" /></button>
                <button className="cx-icon sm" aria-label={t('More options')} onClick={() => rowMenu(i)}><Icon name="moreH" /></button>
              </div>
            </li>
          })}
          {drag?.kind === 'ex' && <li className={'cx-dropend' + (over === 'end' + si ? ' drop' : '')} onDragOver={dragOver('end' + si)} onDrop={onDrop('seg-end', { end: seg.idx[seg.idx.length - 1] + 1, blk: seg.blk, s: si })}>{t('Drop here')}</li>}
        </ol>
      </section>
    })}
    <div className={'cx-canvas-add' + (onAddBlock ? '' : ' one')}>
      {onAddBlock && <button className="cx-addbig" onClick={onAddBlock}><Icon name="list" /><span><b>{t('Add block')}</b><small>{t('Official 2J or your own')}</small></span></button>}
      <button className="cx-addbig" onClick={onAddExercise}><Icon name="dumbbell" /><span><b>{t('Add exercise')}</b><small>{t('Prescribed by the 2J protocol')}</small></span></button>
    </div>
  </div>
}

/** A default, protocol-prescribed entry for one exercise picked from the library. */
export function prescribedEntry(ex, ctx, position = 0) {
  const c = classify(ex.id, lookup)
  if (c.cardio) return { id: ex.id, sets: 1, min: 20, speed: 8 }
  return { id: ex.id, ...prescribe(c, { goal: ctx.goal, level: ctx.level, position }) }
}
export { blockTitle }
