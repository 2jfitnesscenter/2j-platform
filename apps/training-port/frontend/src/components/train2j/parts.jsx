// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// "Entrena con 2J" — shared pieces: routine card, rail, collection tile, the "what you will do"
// timeline, the filters sheet and the trainer's assign sheet. Styles: .t2-* in index.css.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { useStore } from '../../store/useStore.js'
import { gymRoutineCompatibility } from '../../lib/gym-profiles.js'
import { t, nameFor } from '../../lib/i18n.js'
import { EXIDX } from '../../lib/exercises.js'
import { useGuided } from '../../lib/guided-api.js'
import { toggleRoutineFav } from '../../lib/routine-favorites.js'
import { gearKinds, GEAR_LABEL, partName, routineSnapshot, restrictionIssues, memberContext, DURATIONS } from '../../lib/train2j.js'
import { timingLine } from '../../lib/guided.js'
import { CATEGORY_LABEL, LEVEL_LABEL, GOAL_LABEL, TAG_LABEL, ROUTINE_CATEGORIES, LEVELS } from '../../lib/protocol/index.js'
import { fetchTrainerMembers, fetchMemberPlan, saveMemberRoutine } from '../../lib/trainer-api.js'
import { Prescription } from '../constructor/parts.jsx'
import { Thumb } from '../Media.jsx'
import Icon from '../Icon.jsx'
import WorkoutCover from '../WorkoutCover.jsx'

export const lookup = id => EXIDX[id] || null
const BADGE_LABEL = { new: 'NEW', featured: 'Featured', express: 'Express', 'no-equipment': 'No equipment', 'no-jumps': 'No jumps' }

/** "No equipment" / "Machines" / "Dumbbells · Cardio machines" */
export const gearText = r => gearKinds(r, lookup).map(k => t(GEAR_LABEL[k])).join(' · ')
/** Up to two labels worth a glance: the admin's badge or NEW, then one real trait. */
export function cardBadges(r, { isNewRoutine } = {}) {
  const out = []
  if (r.badge) out.push({ key: r.badge, label: BADGE_LABEL[r.badge], strong: true })
  else if (isNewRoutine) out.push({ key: 'new', label: 'NEW', strong: true })
  const trait = ['express', 'no-jumps', 'low-impact'].find(k => (r.tags || []).includes(k) && !out.some(o => o.key === k))
  if (trait) out.push({ key: trait, label: TAG_LABEL[trait] })
  return out.slice(0, 2)
}

export function Heart({ id, className = '' }) {
  const on = useStore(s => (s.S.favRoutines || []).includes(id))
  const update = useStore(s => s.update)
  const toggle = routineId => update(s => { toggleRoutineFav(s, routineId) })
  const [pop, setPop] = useState(false)
  return <button className={'t2-heart' + (on ? ' on' : '') + (pop ? ' pop' : '') + ' ' + className} aria-pressed={on}
    aria-label={on ? t('Remove from favorites') : t('Add to favorites')}
    onClick={e => { e.stopPropagation(); e.preventDefault(); toggle(id); setPop(true); setTimeout(() => setPop(false), 380) }}>
    <Icon name="heart" />
  </button>
}

export const FIT_LABEL = { compatible: 'Compatible with this place', partial: 'Partially compatible', requires: 'Needs other equipment' }

/** The catalogue card: artwork with type and time, then name and a quiet meta line. */
export function RoutineCard({ r, stats, isNewRoutine, reasons, onOpen, wide }) {
  const gymState = useStore(s => s.S)
  useStore(s => s.gymProfileRevision)
  const gymMatch = gymRoutineCompatibility(gymState, r)
  const nav = useNavigate()
  const open = onOpen || (() => nav('/train2j/r/' + r.id))
  const badges = cardBadges(r, { isNewRoutine })
  return <article className={'t2-card' + (wide ? ' wide' : '') + (r.active === false ? ' off' : '')}>
    <button className="t2-card-hit" onClick={open} aria-label={t('Open {0}', t(r.name))}>
      <WorkoutCover r={r} shape={wide ? 'wide' : 'card'}>
        <span className="t2-kind">{t(CATEGORY_LABEL[r.category])}</span>
        <span className="t2-min num">{r.estimatedMinutes} min</span>
      </WorkoutCover>
      <div className="t2-card-b">
        <h3 className="t2-card-t">{t(r.name)}</h3>
        <div className="t2-card-m">{t(LEVEL_LABEL[r.level])} · {gearText(r)}</div>
        <div className={'small t2-fit ' + gymMatch.level}>{t(FIT_LABEL[gymMatch.level])}</div>
        {(badges.length > 0 || stats?.count > 0 || reasons) && <div className="t2-card-f">
          {reasons ? reasons.slice(0, 3).map(([k, ...p], i) => <span key={i} className="t2-why">{t(k, ...p.map(v => typeof v === 'string' ? t(v).toLowerCase() : v))}</span>)
            : badges.map(b => <span key={b.key} className={'t2-badge' + (b.strong ? ' strong' : '')}>{t(b.label)}</span>)}
          {stats?.count > 0 && <span className="t2-done"><Icon name="check" />{stats.count === 1 ? t('Completed') : t('{0} times', stats.count)}</span>}
        </div>}
      </div>
    </button>
    <Heart id={r.id} />
  </article>
}

/** A titled horizontal row; renders nothing without content. */
export function Rail({ title, sub, items, more, children, id }) {
  if (!items?.length) return null
  return <section className="t2-rail" aria-labelledby={id}>
    <header className="t2-rail-h">
      <div><h2 id={id}>{title}</h2>{sub && <p>{sub}</p>}</div>
      {more && <button className="t2-more" onClick={more}>{t('See all')}<Icon name="chevronRight" /></button>}
    </header>
    <div className="t2-rail-s">{children}</div>
  </section>
}

export function CollectionTile({ c, count, onOpen }) {
  return <button className="t2-coll" onClick={onOpen}>
    <WorkoutCover r={{ id: c.id, style: c.style }} shape="wide">
      <span className="t2-coll-k">{t('Collection')}</span>
    </WorkoutCover>
    <div className="t2-coll-b">
      <h3>{t(c.name)}</h3>
      <p>{t(c.description)}</p>
      <span className="t2-coll-n num">{t('{0} workouts', count)}<Icon name="chevronRight" /></span>
    </div>
  </button>
}

/** "What you will do": each part with its format, pace and length; exercises on demand. */
export function PartsTimeline({ r }) {
  const [open, setOpen] = useState(null)
  const parts = r.parts || []
  const blockByIid = Object.fromEntries((r.blocks || []).map(b => [b.iid, b]))
  const entriesOf = iid => (r.ex || []).filter(e => e.blk === iid)
  return <ol className="t2-parts">
    {parts.map((p, i) => {
      const b = blockByIid[p.iid] || { role: p.role, type: p.type, timing: p.timing }
      const ex = entriesOf(p.iid)
      const isOpen = open === i
      return <li key={i} className={'t2-part ' + p.role}>
        <button className="t2-part-h" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : i)}>
          <span className="t2-part-dot" aria-hidden="true" />
          <span className="t2-part-t">
            <b>{partName(b, t)}</b>
            <small className="num">{p.timing ? timingLine(p.timing) : t('{0} exercises', p.exercises)}</small>
          </span>
          <span className="t2-part-min num">~{p.minutes} min</span>
          <Icon name={isOpen ? 'chevronUp' : 'chevronDown'} />
        </button>
        {isOpen && <ul className="t2-part-ex">{ex.map((e, k) => {
          const x = EXIDX[e.id]
          return <li key={k}>{x ? <Thumb ex={x} /> : <span className="thumb" />}<span className="capitalize">{x ? nameFor(x) : e.id}</span><Prescription e={e} /></li>
        })}</ul>}
      </li>
    })}
  </ol>
}

const CHIP_DUR = [['lt15', 'Under 15 min'], ['15-30', '15–30 min'], ['gt30', 'Over 30 min']]
/** Secondary filters, in a sheet — the quick chips cover the common cases. */
// The goals the catalogue really has sessions for (each routine carries one; "beginner" is a level, not a goal).
const GOAL_FILTERS = ['hypertrophy', 'strength', 'endurance', 'general']
export function FiltersSheet({ value, onApply, close }) {
  const [f, setF] = useState(value)
  const chip = (k, v, label) => <button key={String(v)} className={'chip' + (f[k] === v ? ' on' : '')} aria-pressed={f[k] === v}
    onClick={() => setF(x => ({ ...x, [k]: x[k] === v ? '' : v }))}>{label}</button>
  return <div className="t2-filters">
    <h3>{t('Filters')}</h3>
    <div className="t2-fl">{t('Type')}</div>
    <div className="cx-chips">{ROUTINE_CATEGORIES.map(c => chip('category', c, t(CATEGORY_LABEL[c])))}</div>
    <div className="t2-fl">{t('Duration')}</div>
    <div className="cx-chips">{CHIP_DUR.map(([v, l]) => chip('duration', v, t(l)))}</div>
    <div className="t2-fl">{t('Goal')}</div>
    <div className="cx-chips">{GOAL_FILTERS.map(g => chip('goal', g, t(GOAL_LABEL[g])))}</div>
    <div className="t2-fl">{t('Level')}</div>
    <div className="cx-chips">{LEVELS.map(l => chip('level', l, t(LEVEL_LABEL[l])))}</div>
    <div className="t2-fl">{t('Gear')}</div>
    <div className="cx-chips">{Object.keys(GEAR_LABEL).map(g => chip('gear', g, t(GEAR_LABEL[g])))}</div>
    <div className="t2-fl-acts">
      <button className="btn plain" onClick={() => setF({ q: f.q })}>{t('Clear filters')}</button>
      <button className="btn primary" onClick={() => { onApply(f); close() }}>{t('Show results')}</button>
    </div>
  </div>
}
export { DURATIONS }

/**
 * Trainer: copy a routine into a member's plan through the existing member-routine endpoint. The
 * member's declared restrictions travel with it, so the server's policy blocks a conflict.
 */
export function AssignSheet({ r, close }) {
  const toast = useUI(s => s.toast)
  const [members, setMembers] = useState(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(null)
  useEffect(() => { fetchTrainerMembers().then(setMembers).catch(e => toast(e.message)) }, [])
  const list = useMemo(() => (members || []).filter(m => m.name.toLowerCase().includes(q.trim().toLowerCase())), [members, q])
  const assign = async m => {
    setBusy(m.id)
    try {
      const plan = await fetchMemberPlan(m.id)
      const restrictions = memberContext({ routines: plan.routines, programs: plan.programs, activeProgramId: plan.activeProgramId }).restrictions
      const clash = restrictionIssues(r, restrictions, lookup)
      if (clash.length) { toast(t('It breaks a restriction declared for {0}. Choose another routine or review the restriction.', m.name)); setBusy(null); return }
      const snap = routineSnapshot(r, t)
      await saveMemberRoutine({ sync: plan.sync, memberId: m.id, name: snap.name, emoji: snap.emoji, ex: snap.ex, blocks: snap.blocks,
        meta: { goal: r.goal, level: r.level, restrictions }, customExDefs: [] })
      toast(t('Assigned to {0}', m.name))
      close()
    } catch (e) { toast(e.message) }
    setBusy(null)
  }
  return <div className="t2-assign">
    <h3>{t('Assign to a member')}</h3>
    <p className="dim small">{t('The member receives a copy in their routines. Changing the official routine later never changes theirs.')}</p>
    <input className="input" placeholder={t('Search a member…')} value={q} onChange={e => setQ(e.target.value)} />
    <div className="list">{members === null ? <div className="dim small" style={{ padding: 12 }}>{t('Loading…')}</div>
      : list.map(m => <button key={m.id} className="item" disabled={!!busy} onClick={() => assign(m)}>
        <span className="grow capitalize">{m.name}</span>{busy === m.id ? <span className="dim small">{t('Saving…')}</span> : <Icon name="plus" />}
      </button>)}</div>
  </div>
}

/** Admin: curation of one official routine (featured, order, badge, active). No content editing here. */
export function CurateSheet({ r, close }) {
  const toast = useUI(s => s.toast)
  const { curate, setActive } = useGuided()
  const [featured, setFeatured] = useState(r.featured || '')
  const [order, setOrder] = useState(r.order ?? '')
  const [badge, setBadge] = useState(r.badge || '')
  const save = async () => {
    try {
      await curate(r.id, { featured: featured ? Number(featured) : null, order: order === '' ? null : Number(order), badge: badge || null })
      toast(t('Saved')); close()
    } catch (e) { toast(e.message) }
  }
  return <div className="cx-form">
    <h3>{t(r.name)}</h3>
    <label className="cx-field"><span>{t('Featured position (empty = not featured)')}</span><input className="input" type="number" min="1" max="9" value={featured} onChange={e => setFeatured(e.target.value)} /></label>
    <label className="cx-field"><span>{t('Order in the catalogue')}</span><input className="input" type="number" min="0" value={order} onChange={e => setOrder(e.target.value)} /></label>
    <label className="cx-field"><span>{t('Badge')}</span><select className="input" value={badge} onChange={e => setBadge(e.target.value)}>
      <option value="">—</option>{Object.entries(BADGE_LABEL).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></label>
    <div className="cx-rxsheet-acts">
      <button className="btn plain" onClick={async () => { try { await setActive(r.id, r.active === false); close() } catch (e) { toast(e.message) } }}>
        {r.active === false ? t('Activate') : t('Deactivate')}</button>
      <button className="btn primary" onClick={save}><Icon name="check" />{t('Save')}</button>
    </div>
  </div>
}

export const useLookupUser = () => useStore(s => s.user)
