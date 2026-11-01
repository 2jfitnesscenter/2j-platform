// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Constructor V2 — the block library panel: search, filters, sections, cards and preview.
// Rendered as the builder's right column on desktop and as a drawer on narrow screens; the
// block management page (views/trainer/BlockLibrary.jsx) reuses it full-width.
import { useEffect, useMemo, useState } from 'react'
import { useUI } from '../../store/useUI.js'
import { t, nameFor } from '../../lib/i18n.js'
import { EXIDX } from '../../lib/exercises.js'
import { useBlocks, recentBlocks, validate } from '../../lib/blocks-api.js'
import { filterBlocks, blockTitle, blockSubtitle, FOCUS, FOCUS_LABEL, GOAL_LABEL, LEVEL_LABEL, TYPE_LABEL, GOALS, LEVELS, BLOCK_TYPES } from '../../lib/protocol/index.js'
import { Thumb } from '../Media.jsx'
import Icon from '../Icon.jsx'
import { Switch } from '../ui.jsx'
import { TypeTag, OfficialTag, Prescription, ProtocolReport } from './parts.jsx'
import { timingLine } from '../../lib/guided.js'
import { BLOCK_DRAG_TYPE } from './drag.js'

const DURATIONS = [{ v: '', l: 'Any length' }, { v: '0-20', l: 'Up to 20 min' }, { v: '20-40', l: '20–40 min' }, { v: '40-99', l: 'Over 40 min' }]
const PAGE = 24
// Grid or list — a per-device, per-user convenience (never synced, never a global setting).
const VIEW_KEY = uid => 'cx_lib_view:' + (uid || 'anon')
export const readLibView = uid => { try { return localStorage.getItem(VIEW_KEY(uid)) === 'list' ? 'list' : 'grid' } catch { return 'grid' } }
export const writeLibView = (uid, v) => { try { localStorage.setItem(VIEW_KEY(uid), v === 'list' ? 'list' : 'grid') } catch { /* private mode */ } }
const shortTiming = tm => tm ? `${tm.work}/${tm.rest} s × ${tm.rounds}` : ''
const blockName = b => b.name || `${t(GOAL_LABEL[b.goal] || '')} · ${t(LEVEL_LABEL[b.level] || '')}${b.variant ? ' ' + b.variant : ''}`
// A block that can be added can also be dragged onto the day (Constructor): dataTransfer carries its id.
const dragProps = (b, onAdd) => onAdd && b.active !== false
  ? { draggable: true, onDragStart: ev => { ev.dataTransfer.effectAllowed = 'copy'; ev.dataTransfer.setData(BLOCK_DRAG_TYPE, b.id) } }
  : {}

/** Direct visibility switch of a block (management page only): ON = visible, OFF = hidden. */
export function BlockSwitch({ b, visibility }) {
  if (!visibility?.can(b)) return null
  return <span className="cx-vis" role="group" aria-label={t('Visible to members') + ': ' + blockTitle(b, t)}>
    <Switch checked={b.active !== false} disabled={visibility.busy?.has(b.id)} onChange={on => visibility.toggle(b, on)} />
  </span>
}

export function BlockCard({ b, onPreview, onAdd, fav, onFav, selected, visibility }) {
  return <article className={'cx-card' + (b.active === false ? ' off' : '') + (selected ? ' on' : '')} {...dragProps(b, onAdd)}>
    <button className="cx-card-body" onClick={() => onPreview(b)} aria-label={t('Preview {0}', blockTitle(b, t))}>
      <div className="cx-card-eyebrow">
        <span className="cx-focus">{t(FOCUS_LABEL[b.focus] || '—')}</span>
        {b.type !== 'strength' && <TypeTag type={b.type} compact />}
        {b.active === false && <span className="cx-off">{t('Hidden')}</span>}
      </div>
      <div className="cx-card-title">{blockName(b)}</div>
      {blockSubtitle(b, t) && <div className="cx-card-style">{blockSubtitle(b, t)}</div>}
      <div className="cx-card-meta">
        <span>{t('{0} exercises', b.exerciseCount ?? b.ex.length)}</span>
        <span className="cx-dot" aria-hidden="true" />
        <span className="num">~{b.estimatedMinutes} min</span>
        {b.timing && <><span className="cx-dot" aria-hidden="true" /><span className="num">{shortTiming(b.timing)}</span></>}
      </div>
    </button>
    <div className="cx-card-foot">
      <OfficialTag official={b.official} />
      <span className="grow" />
      <BlockSwitch b={b} visibility={visibility} />
      {onFav && <button className={'cx-star' + (fav ? ' on' : '')} aria-pressed={!!fav} aria-label={fav ? t('Remove from favorites') : t('Add to favorites')} onClick={() => onFav(b, !fav)}>
        <Icon name={fav ? 'starFill' : 'star'} /></button>}
      {onAdd && <button className="cx-add" onClick={() => onAdd(b)}><Icon name="plus" />{t('Add')}</button>}
    </div>
  </article>
}

/**
 * One block as a compact row (list view): name, goal, level, variant, exercises, duration, main
 * equipment, source and the two actions. Narrow panels fold the columns into a second line.
 */
export function BlockRow({ b, onPreview, onAdd, fav, onFav, selected, visibility }) {
  const title = b.name || t(FOCUS_LABEL[b.focus] || '—')
  const eq = (b.equipment || [])[0]
  return <div className={'cx-lrow' + (b.active === false ? ' off' : '') + (selected ? ' on' : '')} role="listitem" {...dragProps(b, onAdd)}>
    <div className="cx-lrow-name">
      <b>{title}{b.type !== 'strength' && <TypeTag type={b.type} compact />}</b>
      <small>{[b.name && t(FOCUS_LABEL[b.focus] || ''), blockSubtitle(b, t), b.timing && shortTiming(b.timing)].filter(Boolean).join(' · ')}{b.active === false && <span className="cx-off">{t('Hidden')}</span>}</small>
    </div>
    <span className="cx-lc goal">{t(GOAL_LABEL[b.goal] || '—')}</span>
    <span className="cx-lc level">{t(LEVEL_LABEL[b.level] || '—')}</span>
    <span className="cx-lc var num" title={t('Variant')}>{b.variant || '—'}</span>
    <span className="cx-lc exn num">{t('{0} ex.', b.exerciseCount ?? b.ex.length)}</span>
    <span className="cx-lc min num">~{b.estimatedMinutes} min</span>
    <span className="cx-lc eq">{eq ? t(eq) : '—'}</span>
    <span className="cx-lc src"><OfficialTag official={b.official} /></span>
    <span className="cx-lrow-meta num">{[t(GOAL_LABEL[b.goal] || ''), t(LEVEL_LABEL[b.level] || '') + (b.variant ? ' ' + b.variant : ''), t('{0} ex.', b.exerciseCount ?? b.ex.length), `~${b.estimatedMinutes} min`, eq && t(eq)].filter(Boolean).join(' · ')}</span>
    <div className="cx-lrow-acts">
      <BlockSwitch b={b} visibility={visibility} />
      {onFav && <button className={'cx-star' + (fav ? ' on' : '')} aria-pressed={!!fav} aria-label={fav ? t('Remove from favorites') : t('Add to favorites')} onClick={() => onFav(b, !fav)}>
        <Icon name={fav ? 'starFill' : 'star'} /></button>}
      <button className="cx-view" onClick={() => onPreview(b)} aria-label={t('Preview {0}', blockTitle(b, t))}>{t('View')}</button>
      {onAdd && <button className="cx-add" onClick={() => onAdd(b)}><Icon name="plus" />{t('Add')}</button>}
    </div>
  </div>
}

/** The "is this the one?" view — everything needed to decide in a few seconds. */
export function BlockPreview({ b, onAdd, actions, close }) {
  const v = useMemo(() => validate({ kind: 'block', goal: b.goal, level: b.level, type: b.type, focus: b.focus, entries: b.ex, protocolVersion: b.protocolVersion }), [b])
  let letter = 0, prevSg = null
  return <div className="cx-preview">
    <div className="cx-preview-h">
      <div className="cx-card-eyebrow"><span className="cx-focus">{t(FOCUS_LABEL[b.focus] || '—')}</span><TypeTag type={b.type} /><OfficialTag official={b.official} /></div>
      <h3>{blockTitle(b, t)}</h3>
      {blockSubtitle(b, t) && <div className="cx-card-style">{blockSubtitle(b, t)}</div>}
      <div className="cx-preview-stats">
        <div><b>{b.ex.length}</b><span>{t('exercises')}</span></div>
        <div><b>~{b.estimatedMinutes}</b><span>{t('minutes')}</span></div>
        <div><b>{b.ex.reduce((a, e) => a + (Number(e.sets) || 1), 0)}</b><span>{t('sets')}</span></div>
      </div>
      {b.timing && <div className="cx-preview-tm num"><Icon name="timer" />{timingLine(b.timing)}</div>}
      {b.description && <p className="cx-preview-desc">{b.description}</p>}
    </div>
    <ol className="cx-preview-list">
      {b.ex.map((e, i) => {
        const ex = EXIDX[e.id]
        if (e.sg && e.sg !== prevSg) letter++
        const ss = e.sg ? String.fromCharCode(64 + letter) + (b.ex.slice(0, i).filter(x => x.sg === e.sg).length + 1) : null
        prevSg = e.sg || null
        return <li key={i} className={e.sg ? 'ss' : ''}>
          {ex ? <Thumb ex={ex} /> : <span className="cx-thumb-ph" />}
          <div className="grow">
            <div className="cx-ex-name capitalize">{ss && <span className="cx-ss">{ss}</span>}{ex ? nameFor(ex) : e.id}</div>
            <Prescription e={e} />
          </div>
        </li>
      })}
    </ol>
    {(b.equipment || []).length > 0 && <div className="cx-preview-eq"><Icon name="dumbbell" />{b.equipment.map(eq => t(eq)).join(' · ')}</div>}
    <ProtocolReport v={v} dense />
    <div className="cx-preview-acts">
      {actions}
      {onAdd && <button className="btn primary" onClick={() => { close?.(); onAdd(b) }}><Icon name="plus" />{t('Add to day')}</button>}
    </div>
  </div>
}

/**
 * @param onAdd(block)  insert into the active day (omitted on the management page)
 * @param extraActions(block, close) → buttons for the preview (management page)
 */
export default function Library({ onAdd, extraActions, defaults = {}, full, visibility }) {
  const { status, blocks, favorites, uid, load, favorite, error } = useBlocks()
  const openSheet = useUI(s => s.openSheet)
  const toast = useUI(s => s.toast)
  const [q, setQ] = useState('')
  const [goal, setGoal] = useState(defaults.goal || '')
  const [level, setLevel] = useState(defaults.level || '')
  const [focus, setFocus] = useState('')
  const [type, setType] = useState('')
  const [dur, setDur] = useState('')
  const [source, setSource] = useState('')
  const [vis, setVis] = useState('')   // '' | 'visible' | 'hidden' (management page)
  const [more, setMore] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  useEffect(() => { load() }, [])
  useEffect(() => { setLimit(PAGE) }, [q, goal, level, focus, type, dur, source, vis])

  const favSet = useMemo(() => new Set(favorites), [favorites])
  const [minM, maxM] = dur ? dur.split('-').map(Number) : [0, 0]
  const list = useMemo(() => filterBlocks(blocks, { q, goal, level, focus, type, source: source === 'fav' ? '' : source, onlyFavorites: source === 'fav', favorites: favSet, uid, minMinutes: minM, maxMinutes: maxM, includeInactive: full }, t),
    [blocks, q, goal, level, focus, type, source, favSet, uid, dur, full])
  const listV = useMemo(() => vis === 'hidden' ? list.filter(b => b.active === false) : vis === 'visible' ? list.filter(b => b.active !== false) : list, [list, vis])
  // A muscle filter shows the blocks built FOR that muscle first, then ones that also train it.
  // A text search ranks blocks whose main muscle matches a word above ones that only train it.
  const norm = x => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const words = norm(q).split(/\s+/).filter(w => w && !/^\d+(min)?$|^min$/.test(w))
  const primary = b => (focus && b.focus === focus ? 2 : 0) + (words.some(w => norm(t(FOCUS_LABEL[b.focus] || '')).includes(w)) ? 1 : 0)
  const sorted = useMemo(() => (focus || words.length) ? [...listV].sort((a, b) => primary(b) - primary(a)) : listV, [listV, focus, q])
  const filtering = q || goal || level || focus || type || dur || source || vis
  const recent = useMemo(() => recentBlocks().map(id => blocks.find(b => b.id === id)).filter(b => b && b.active !== false), [blocks, status])
  const favs = useMemo(() => blocks.filter(b => favSet.has(b.id)), [blocks, favSet])
  const mine = useMemo(() => blocks.filter(b => !b.official && b.createdBy === uid), [blocks, uid])

  const [view, setViewState] = useState(() => readLibView(uid))
  useEffect(() => { setViewState(readLibView(uid)) }, [uid])
  const setView = v => { setViewState(v); writeLibView(uid, v) }
  const preview = b => openSheet(close => <BlockPreview b={b} close={close} onAdd={onAdd} actions={extraActions?.(b, close)} />)
  const onFav = (b, on) => favorite(b.id, on).catch(e => toast(e.message))
  const card = b => view === 'list'
    ? <BlockRow key={b.id} b={b} onPreview={preview} onAdd={onAdd} fav={favSet.has(b.id)} onFav={onFav} visibility={visibility} />
    : <BlockCard key={b.id} b={b} onPreview={preview} onAdd={onAdd} fav={favSet.has(b.id)} onFav={onFav} visibility={visibility} />
  const items = list => view === 'list' ? <div className="cx-list" role="list">{list.map(card)}</div> : <div className="cx-cards">{list.map(card)}</div>
  const section = (title, items_, icon) => items_.length > 0 && <section className="cx-sec">
    <h4 className="cx-sec-h"><Icon name={icon} />{title}<span className="num">{items_.length}</span></h4>
    {items(items_)}
  </section>

  const sel = (value, set, options, label, all) => <label className="cx-select">
    <span className="sr-only">{label}</span>
    <select value={value} onChange={e => set(e.target.value)} aria-label={label} className={value ? 'on' : ''}>
      <option value="">{all}</option>
      {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  </label>

  return <div className={'cx-lib' + (full ? ' full' : '')}>
    <div className="cx-lib-search">
      <Icon name="magnifier" />
      <input id="cx-lib-search" className="input" type="search" placeholder={t('Search: glutes advanced, chest strength, 20 min…')} value={q} onChange={e => setQ(e.target.value)} aria-label={t('Search blocks')} />
    </div>
    <div className="cx-filters">
      {sel(goal, setGoal, GOALS.map(g => ({ v: g, l: t(GOAL_LABEL[g]) })), t('Training goal'), t('Any goal'))}
      {sel(level, setLevel, LEVELS.map(l => ({ v: l, l: t(LEVEL_LABEL[l]) })), t('Level'), t('Any level'))}
      {sel(focus, setFocus, FOCUS.map(f => ({ v: f, l: t(FOCUS_LABEL[f]) })), t('Muscle / pattern'), t('Any muscle'))}
      <button className={'cx-more' + (more ? ' on' : '')} aria-expanded={more} onClick={() => setMore(x => !x)}><Icon name="moreH" />{t('More')}</button>
      <div className="cx-viewtog" role="group" aria-label={t('Library view')}>
        <button className={view === 'grid' ? 'on' : ''} aria-pressed={view === 'grid'} onClick={() => setView('grid')} title={t('Grid')}><Icon name="grid" /><span>{t('Grid')}</span></button>
        <button className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')} title={t('List')}><Icon name="list" /><span>{t('List')}</span></button>
      </div>
    </div>
    {visibility && <div className="cx-visfilter" role="group" aria-label={t('Visibility')}>
      {[['', 'All'], ['visible', 'Visible'], ['hidden', 'Hidden']].map(([k, l]) => <button key={k} className={'chip' + (vis === k ? ' on' : '')} aria-pressed={vis === k} onClick={() => setVis(k)}>{t(l)}</button>)}
    </div>}
    {more && <div className="cx-filters sub">
      {sel(type, setType, BLOCK_TYPES.map(x => ({ v: x, l: t(TYPE_LABEL[x]) })), t('Type'), t('Any type'))}
      {sel(dur, setDur, DURATIONS.slice(1).map(d => ({ v: d.v, l: t(d.l) })), t('Duration'), t('Any length'))}
      {sel(source, setSource, [{ v: 'official', l: t('2J official') }, { v: 'mine', l: t('My blocks') }, { v: 'fav', l: t('Favorites') }], t('Source'), t('All blocks'))}
    </div>}
    {status === 'loading' && <div className="cx-lib-empty">{t('Loading…')}</div>}
    {status === 'error' && <div className="cx-lib-empty">{error} <button className="cx-linkbtn" onClick={() => load(true)}>{t('Try again')}</button></div>}
    {status === 'ready' && (filtering ? <>
      <div className="cx-count num">{t('{0} blocks', listV.length)}{filtering && <button className="cx-linkbtn" onClick={() => { setQ(''); setGoal(''); setLevel(''); setFocus(''); setType(''); setDur(''); setSource('') }}>{t('Clear filters')}</button>}</div>
      {listV.length ? items(sorted.slice(0, limit))
        : <div className="cx-lib-empty"><Icon name="magnifier" />{t('No block matches. Try fewer filters, or build it from exercises and save it as a block.')}</div>}
      {listV.length > limit && <button className="btn plain cx-loadmore" onClick={() => setLimit(l => l + PAGE)}>{t('Show more')}</button>}
    </> : <>
      {section(t('Favorites'), favs, 'starFill')}
      {section(t('Recent'), recent, 'history')}
      {section(t('My blocks'), mine, 'person')}
      {section(t('2J official'), blocks.filter(b => b.official && (full || b.active !== false)).slice(0, limit), 'shield')}
      {blocks.filter(b => b.official).length > limit && <button className="btn plain cx-loadmore" onClick={() => setLimit(l => l + PAGE)}>{t('Show more')}</button>}
    </>)}
  </div>
}
