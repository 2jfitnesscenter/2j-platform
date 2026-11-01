// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Entrena con 2J Studio (admins): routines, programs and collections of the official catalogue —
// states, preview, order, featured, duplication. Content editing opens the routine/program editors;
// everything is validated and persisted by the server, this view only drives it.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../../store/useStore.js'
import { useUI } from '../../../store/useUI.js'
import { t } from '../../../lib/i18n.js'
import { useGuided } from '../../../lib/guided-api.js'
import { CATEGORY_LABEL, LEVEL_LABEL, ROUTINE_CATEGORIES } from '../../../lib/protocol/index.js'
import { statusOf, VISIBILITY_LABEL, filterAdmin, countByStatus, moveId, PURPOSE_LABEL, setVisible } from '../../../lib/studio.js'
import { confirmSheet } from '../../../sheets.jsx'
import WorkoutCover from '../../../components/WorkoutCover.jsx'
import Icon from '../../../components/Icon.jsx'
import { RowMenu, Segmented, Empty, StudioHelp, VisibilityControl } from './parts.jsx'

const HELP_KEY = 'studio_help_v1'
const seen = () => { try { return localStorage.getItem(HELP_KEY) === '1' } catch { return true } }
const markSeen = () => { try { localStorage.setItem(HELP_KEY, '1') } catch { /* private mode */ } }
const STYLES = ['start', 'tabata', 'hiit', 'circuit', 'interval', 'mobility', 'express', 'core', 'mixed', 'strength']

/** Visibility switches: saved at once, one request per row at a time; a refusal shows its reason and changes nothing. */
function useVisibility(g, kind) {
  const toast = useUI(s => s.toast)
  const [pending, setPending] = useState(() => new Set())
  const toggle = item => async on => {
    if (pending.has(item.id)) return
    setPending(p => new Set(p).add(item.id))
    try { await setVisible(g, kind, item, on); toast(on ? t('Visible to members') : t('Hidden')) }
    catch (e) { toast(e.message) }
    setPending(p => { const n = new Set(p); n.delete(item.id); return n })
  }
  return { toggle, busy: id => pending.has(id) }
}

const confirmDelete = (title, message, onConfirm) => confirmSheet({ title, message, confirmText: t('Delete'), danger: true, onConfirm })

function useAct() {
  const toast = useUI(s => s.toast)
  return (fn, ok) => async () => { try { await fn(); if (ok) toast(t(ok)) } catch (e) { toast(e.message) } }
}

function VisibilityChips({ value, onChange, total, counts, drafts = true }) {
  return <div className="st-chips">
    <button className={'chip' + (value === 'all' ? ' on' : '')} onClick={() => onChange('all')}>{t('All')} <span className="num">{total}</span></button>
    {['active', 'hidden', ...(drafts ? ['draft'] : [])].map(k => <button key={k} className={'chip' + (value === k ? ' on' : '')} onClick={() => onChange(k)}>{t(VISIBILITY_LABEL[k])} <span className="num">{counts[k]}</span></button>)}
  </div>
}

/* ------------------------------- routines ------------------------------- */
function RoutinesTab({ g }) {
  const nav = useNavigate()
  const act = useAct()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [category, setCategory] = useState('all')
  const [ordering, setOrdering] = useState(false)
  const [limit, setLimit] = useState(60)
  const sorted = useMemo(() => [...g.routines].sort((a, b) => (a.order ?? 999) - (b.order ?? 999)), [g.routines])
  const counts = useMemo(() => countByStatus(sorted), [sorted])
  const list = useMemo(() => filterAdmin(sorted, { q, status, category }, r => t(r.name)), [sorted, q, status, category])
  const filtered = q || status !== 'all' || category !== 'all'
  const ids = sorted.map(r => r.id)
  const vis = useVisibility(g, 'routine')
  const nextFeatured = Math.max(0, ...sorted.map(r => r.featured || 0)) + 1
  const move = (id, dir) => act(() => g.reorder('routines', moveId(ids, id, dir)))()

  return <>
    <div className="st-tools">
      <input className="input" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t('Search routines')} aria-label={t('Search routines')} />
      <select className="input" value={category} onChange={e => setCategory(e.target.value)} aria-label={t('Type')}>
        <option value="all">{t('All types')}</option>
        {ROUTINE_CATEGORIES.map(c => <option key={c} value={c}>{t(CATEGORY_LABEL[c])}</option>)}
      </select>
      <button className={'btn plain' + (ordering ? ' on' : '')} disabled={filtered} aria-pressed={ordering} onClick={() => setOrdering(!ordering)}
        title={filtered ? t('Clear the filters to reorder') : ''}><Icon name="list" />{t('Reorder')}</button>
    </div>
    <div className="st-chips">
      <button className={'chip' + (status === 'all' ? ' on' : '')} onClick={() => setStatus('all')}>{t('All')} <span className="num">{sorted.length}</span></button>
      {['active', 'hidden', 'draft'].map(s => <button key={s} className={'chip' + (status === s ? ' on' : '')} onClick={() => setStatus(s)}>{t(VISIBILITY_LABEL[s])} <span className="num">{counts[s]}</span></button>)}
    </div>
    <div className="st-list">
      {list.slice(0, ordering ? list.length : limit).map(r => {
        const s = statusOf(r)
        return <article key={r.id} className={'st-row' + (s !== 'active' ? ' dim' : '')}>
          <button className="st-cover" onClick={() => nav('/train2j/r/' + r.id)} aria-label={t('Preview')}><WorkoutCover r={r} shape="square" /></button>
          <div className="grow st-main">
            <b>{t(r.name)}</b>
            <small className="num">{t(CATEGORY_LABEL[r.category])} · {t(LEVEL_LABEL[r.level])} · ~{r.estimatedMinutes} min{r.purpose ? ' · ' + t(PURPOSE_LABEL[r.purpose]) : ''}</small>
          </div>
          {r.featured ? <span className="st-star" title={t('Featured {0}', r.featured)}><Icon name="starFill" /></span> : null}
          <VisibilityControl x={r} name={t(r.name)} busy={vis.busy(r.id)} onToggle={vis.toggle(r)} />
          {ordering
            ? <div className="st-order"><button aria-label={t('Move up')} onClick={() => move(r.id, -1)}><Icon name="arrowUp" /></button><button aria-label={t('Move down')} onClick={() => move(r.id, 1)}><Icon name="arrowDown" /></button></div>
            : <>
              <button className="btn plain st-edit" onClick={() => nav('/trainer/guided/edit/' + r.id)}><Icon name="pencil" />{t('Edit')}</button>
              <RowMenu label={t('Actions for {0}', t(r.name))} items={[
                { label: t('Edit'), onClick: () => nav('/trainer/guided/edit/' + r.id) },
                { label: t('Preview as a member'), onClick: () => nav('/train2j/r/' + r.id) },
                { label: r.featured ? t('Remove from featured') : t('Feature on the home'), onClick: act(() => g.curate(r.id, { featured: r.featured ? null : nextFeatured }), 'Saved') },
                { label: t('Duplicate as a draft'), onClick: act(async () => { const c = await g.duplicateOfficial(r.id); nav('/trainer/guided/edit/' + c.id) }) },
                /^r2jc-/.test(r.id) && { label: t('Delete'), danger: true, onClick: () => confirmDelete(t('Delete this routine?'), t('Members who already received it keep their own copy.'), act(() => g.remove(r.id), 'Deleted')) },
              ]} />
            </>}
        </article>
      })}
      {!list.length && <Empty title={t('No routines match')}>{t('Try another search or clear the filters.')}</Empty>}
      {!ordering && list.length > limit && <button className="btn tinted" onClick={() => setLimit(l => l + 60)}>{t('Show more')} · {list.length - limit}</button>}
    </div>
  </>
}

/* ------------------------------- programs ------------------------------- */
function ProgramsTab({ g }) {
  const nav = useNavigate()
  const act = useAct()
  const [ordering, setOrdering] = useState(false)
  const sorted = useMemo(() => [...g.programs].sort((a, b) => (a.order ?? 999) - (b.order ?? 999)), [g.programs])
  const ids = sorted.map(p => p.id)
  const vis = useVisibility(g, 'program')
  const [pstatus, setPstatus] = useState('all')
  const shownPrograms = useMemo(() => filterAdmin(sorted, { status: pstatus }, p => t(p.name)), [sorted, pstatus])
  const pcounts = useMemo(() => countByStatus(sorted), [sorted])
  return <>
    <div className="st-tools">
      <span className="grow dim small">{t('{0} programs', sorted.length)}</span>
      <button className={'btn plain' + (ordering ? ' on' : '')} aria-pressed={ordering} onClick={() => setOrdering(!ordering)}><Icon name="list" />{t('Reorder')}</button>
      <button className="btn primary" onClick={() => nav('/trainer/guided/program/new')}><Icon name="plus" />{t('New program')}</button>
    </div>
    <VisibilityChips value={pstatus} onChange={setPstatus} total={sorted.length} counts={pcounts} />
    <div className="st-list">
      {shownPrograms.map(p => {
        const s = statusOf(p)
        return <article key={p.id} className={'st-row' + (s !== 'active' ? ' dim' : '')}>
          <button className="st-cover" onClick={() => nav('/train2j/program/' + p.id)} aria-label={t('Preview')}><WorkoutCover r={{ id: p.id, category: p.cover }} shape="square" /></button>
          <div className="grow st-main"><b>{t(p.name)}</b>
            <small className="num">{t(p.durationLabel)} · {t('{0} sessions/week', p.sessionsPerWeek)} · {t(LEVEL_LABEL[p.level])}</small></div>
          {p.featured && <span className="st-star"><Icon name="starFill" /></span>}
          <VisibilityControl x={p} name={t(p.name)} busy={vis.busy(p.id)} onToggle={vis.toggle(p)} />
          {ordering
            ? <div className="st-order"><button aria-label={t('Move up')} onClick={() => act(() => g.reorder('programs', moveId(ids, p.id, -1)))()}><Icon name="arrowUp" /></button>
              <button aria-label={t('Move down')} onClick={() => act(() => g.reorder('programs', moveId(ids, p.id, 1)))()}><Icon name="arrowDown" /></button></div>
            : <>
              <button className="btn plain st-edit" onClick={() => nav('/trainer/guided/program/' + p.id)}><Icon name="pencil" />{t('Edit')}</button>
              <RowMenu label={t('Actions for {0}', t(p.name))} items={[
                { label: t('Edit'), onClick: () => nav('/trainer/guided/program/' + p.id) },
                { label: t('Preview as a member'), onClick: () => nav('/train2j/program/' + p.id) },
                { label: p.featured ? t('Remove from featured') : t('Feature on the home'), onClick: act(() => g.curateProgram(p.id, { featured: !p.featured }), 'Saved') },
                { label: t('Duplicate as a draft'), onClick: act(async () => { const c = await g.duplicateProgram(p.id); nav('/trainer/guided/program/' + c.id) }) },
                !/^g2j-/.test(p.id) && { label: t('Delete'), danger: true, onClick: () => confirmDelete(t('Delete this program?'), t('People who already started it keep their own copy.'), act(() => g.removeProgram(p.id), 'Deleted')) },
              ]} />
            </>}
        </article>
      })}
    </div>
  </>
}

/* ------------------------------ collections ------------------------------ */
export function CollectionEditor({ c, g, close }) {
  const toast = useUI(s => s.toast)
  const [x, setX] = useState(() => ({ name: '', description: '', style: 'start', order: 0, active: true, featured: false, routineIds: [], programIds: [], ...(c ? JSON.parse(JSON.stringify(c)) : {}) }))
  const [find, setFind] = useState('')
  const byId = useMemo(() => new Map(g.routines.map(r => [r.id, r])), [g.routines])
  const results = useMemo(() => find.trim() ? filterAdmin(g.routines.filter(r => !x.routineIds.includes(r.id)), { q: find }, r => t(r.name)).slice(0, 8) : [], [find, g.routines, x.routineIds])
  const set = patch => setX(v => ({ ...v, ...patch }))
  const flipProgram = id => set({ programIds: x.programIds.includes(id) ? x.programIds.filter(y => y !== id) : [...x.programIds, id] })
  const save = async () => {
    if (!x.name.trim()) { toast(t('Give the collection a name')); return }
    try { await g.saveCollection(x); toast(t('Saved')); close() } catch (e) { toast(e.message) }
  }
  const remove = () => confirmSheet({ title: t('Delete this collection?'), message: t('The routines stay in the library; only the grouping goes away.'), confirmText: t('Delete'), danger: true,
    onConfirm: async () => { try { await g.removeCollection(c.id); toast(t('Deleted')); close() } catch (e) { toast(e.message) } } })
  return <div className="cx-form st-coll">
    <h3>{c ? t(c.name) : t('New collection')}</h3>
    <label className="cx-field"><span>{t('Name')}</span><input className="input" maxLength={60} value={t(x.name)} onChange={e => set({ name: e.target.value })} /></label>
    <label className="cx-field"><span>{t('Description')}</span><input className="input" maxLength={200} value={x.description ? t(x.description) : ''} onChange={e => set({ description: e.target.value })} /></label>
    <div className="cx-form-row">
      <label className="cx-field"><span>{t('Look')}</span><select className="input" value={x.style} onChange={e => set({ style: e.target.value })}>{STYLES.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
      <label className="cx-field"><span>{t('Order')}</span><input className="input" type="number" min="0" max="999" value={x.order} onChange={e => set({ order: Number(e.target.value) })} /></label>
    </div>
    <div className="st-checks">
      <label className="cx-check"><input type="checkbox" checked={x.active !== false} onChange={e => set({ active: e.target.checked })} />{t('Visible to members')}</label>
      <label className="cx-check"><input type="checkbox" checked={!!x.featured} onChange={e => set({ featured: e.target.checked })} />{t('Featured')}</label>
    </div>
    <div className="t2-fl">{t('Routines, in order')} <span className="num dim">{x.routineIds.length}</span></div>
    <div className="st-sel">
      {x.routineIds.map((id, i) => { const r = byId.get(id); return <div key={id} className="st-selrow">
        <span className="num dim">{i + 1}</span><span className="grow">{r ? t(r.name) : id}</span>
        <button aria-label={t('Move up')} disabled={!i} onClick={() => set({ routineIds: moveId(x.routineIds, id, -1) })}><Icon name="arrowUp" /></button>
        <button aria-label={t('Move down')} disabled={i === x.routineIds.length - 1} onClick={() => set({ routineIds: moveId(x.routineIds, id, 1) })}><Icon name="arrowDown" /></button>
        <button aria-label={t('Remove')} onClick={() => set({ routineIds: x.routineIds.filter(y => y !== id) })}><Icon name="xmark" /></button>
      </div> })}
      {!x.routineIds.length && <p className="dim small">{t('No routines yet. Search below to add some.')}</p>}
    </div>
    <input className="input" type="search" value={find} onChange={e => setFind(e.target.value)} placeholder={t('Search a routine to add')} aria-label={t('Search a routine to add')} />
    {results.map(r => <button key={r.id} className="st-pick" onClick={() => { set({ routineIds: [...x.routineIds, r.id] }); setFind('') }}>
      <WorkoutCover r={r} shape="square" /><span className="grow"><b>{t(r.name)}</b><small className="num">{t(CATEGORY_LABEL[r.category])} · ~{r.estimatedMinutes} min</small></span><Icon name="plus" /></button>)}
    {g.programs.length > 0 && <>
      <div className="t2-fl">{t('Programs')}</div>
      <div className="g2a-pick">{g.programs.map(p => <label key={p.id} className={'g2a-pickrow' + (x.programIds.includes(p.id) ? ' on' : '')}>
        <input type="checkbox" checked={x.programIds.includes(p.id)} onChange={() => flipProgram(p.id)} /><span className="grow">{t(p.name)}</span></label>)}</div>
    </>}
    <div className="st-formacts">
      {c && !/^c2j-/.test(c.id) && <button className="btn plain danger" onClick={remove}><Icon name="trash" />{t('Delete')}</button>}
      <span className="grow" />
      <button className="btn primary" onClick={save}><Icon name="check" />{t('Save')}</button>
    </div>
  </div>
}

function CollectionsTab({ g }) {
  const openSheet = useUI(s => s.openSheet)
  const act = useAct()
  const [ordering, setOrdering] = useState(false)
  const sorted = useMemo(() => [...g.collections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [g.collections])
  const ids = sorted.map(c => c.id)
  const edit = c => openSheet(close => <CollectionEditor c={c} g={g} close={close} />, { wide: true })
  const vis = useVisibility(g, 'collection')
  const [cstatus, setCstatus] = useState('all')
  const shownCollections = useMemo(() => filterAdmin(sorted, { status: cstatus }, c => t(c.name)), [sorted, cstatus])
  const ccounts = useMemo(() => countByStatus(sorted), [sorted])
  return <>
    <div className="st-tools">
      <span className="grow dim small">{t('{0} collections', sorted.length)}</span>
      <button className={'btn plain' + (ordering ? ' on' : '')} aria-pressed={ordering} onClick={() => setOrdering(!ordering)}><Icon name="list" />{t('Reorder')}</button>
      <button className="btn primary" onClick={() => edit(null)}><Icon name="plus" />{t('New collection')}</button>
    </div>
    <VisibilityChips value={cstatus} onChange={setCstatus} total={sorted.length} counts={ccounts} drafts={false} />
    <div className="st-list">
      {shownCollections.map(c => <article key={c.id} className={'st-row' + (c.active === false ? ' dim' : '')}>
        <button className="st-cover" onClick={() => edit(c)} aria-label={t('Edit')}><WorkoutCover r={{ id: c.id, style: c.style }} shape="square" /></button>
        <div className="grow st-main"><b>{t(c.name)}</b>
          <small className="num">{t('{0} workouts', c.routineIds.length)}{c.programIds?.length ? ' · ' + t('{0} programs', c.programIds.length) : ''}</small></div>
        {c.featured && <span className="st-star"><Icon name="starFill" /></span>}
        <VisibilityControl x={c} name={t(c.name)} busy={vis.busy(c.id)} onToggle={vis.toggle(c)} />
        {ordering
          ? <div className="st-order"><button aria-label={t('Move up')} onClick={() => act(() => g.reorder('collections', moveId(ids, c.id, -1)))()}><Icon name="arrowUp" /></button>
            <button aria-label={t('Move down')} onClick={() => act(() => g.reorder('collections', moveId(ids, c.id, 1)))()}><Icon name="arrowDown" /></button></div>
          : <>
            <button className="btn plain st-edit" onClick={() => edit(c)}><Icon name="pencil" />{t('Edit')}</button>
            <RowMenu label={t('Actions for {0}', t(c.name))} items={[
              { label: t('Edit'), onClick: () => edit(c) },
              !/^c2j-/.test(c.id) && { label: t('Delete'), danger: true, onClick: () => confirmDelete(t('Delete this collection?'), t('The routines stay in the library; only the grouping goes away.'), act(() => g.removeCollection(c.id), 'Deleted')) },
            ]} />
          </>}
      </article>)}
    </div>
  </>
}

/* --------------------------------- shell --------------------------------- */
export default function StudioAdmin() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const g = useGuided()
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('studio_tab') || 'routines' } catch { return 'routines' } })
  const [help, setHelp] = useState(() => !seen())
  useEffect(() => { g.load(user?.id, true) }, [user?.id])
  const pick = k => { setTab(k); try { localStorage.setItem('studio_tab', k) } catch { /* private mode */ } }
  const closeHelp = () => { markSeen(); setHelp(false) }
  const draftCount = [...g.routines, ...g.programs].filter(x => statusOf(x) === 'draft').length
  return <div className="cx-shell st">
    <header className="st-top">
      <a className="trainer-back" href="#/trainer"><Icon name="chevronLeft" />{t('Trainer panel')}</a>
      <div className="st-title"><h1>{t('Train with 2J · Studio')}</h1>
        <p className="dim small">{t('Official routines, programs and collections. Drafts stay private until you publish.')}</p></div>
      <div className="st-top-acts">
        <button className="btn plain" aria-label={t('How the Studio works')} onClick={() => setHelp(h => !h)}><Icon name="info" /></button>
        <a className="btn plain st-hide-sm" href="#/train2j"><Icon name="play" />{t('Open the library')}</a>
        <button className="btn primary" onClick={() => nav('/trainer/guided/edit/new')}><Icon name="plus" />{t('New routine')}</button>
      </div>
    </header>
    {help && <StudioHelp onClose={closeHelp} />}
    <div className="st-bar">
      <Segmented value={tab} onChange={pick} options={[['routines', t('Routines'), g.routines.length], ['programs', t('Programs'), g.programs.length], ['collections', t('Collections'), g.collections.length]]} />
      <a className="btn plain st-qlink" href="#/trainer/library-quality"><Icon name="wrench" />{t('Library quality')}</a>
    </div>
    {draftCount > 0 && <p className="st-note"><Icon name="info" />{t('{0} drafts waiting to be published', draftCount)}</p>}
    {g.status === 'ready'
      ? tab === 'routines' ? <RoutinesTab g={g} /> : tab === 'programs' ? <ProgramsTab g={g} /> : <CollectionsTab g={g} />
      : <div className="st-skel"><div /><div /><div /></div>}
    {g.mine.length > 0 && tab === 'routines' && <section className="st-mine"><h2>{t('Your guided routines')}</h2>
      {g.mine.map(r => <article key={r.id} className="st-row"><WorkoutCover r={r} shape="square" /><div className="grow st-main"><b>{t(r.name)}</b>
        <small className="num">{t(CATEGORY_LABEL[r.category])} · ~{r.estimatedMinutes} min</small></div>
        <button className="btn plain st-edit" onClick={() => nav('/trainer/guided/edit/' + r.id)}><Icon name="pencil" />{t('Edit')}</button></article>)}
    </section>}
  </div>
}
