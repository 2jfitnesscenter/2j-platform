// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Exercise Library quality (admins): find the records that need a curator's eye and fix them in
// place — names, aliases, movement, equipment, Recommended 2J, preferred twin of a duplicate.
// Edits go to the overlay (api/lib/library-admin.js); ids never change and the server refuses
// chains, cycles, other movements and duplicates that active official content still uses.
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../../store/useStore.js'
import { useUI } from '../../../store/useUI.js'
import { t, nameFor } from '../../../lib/i18n.js'
import { EXIDX, gifSrc, imgSrc } from '../../../lib/exercises.js'
import { MOVEMENTS, EQUIPMENT_BY_ID } from '../../../lib/protocol/movements.js'
import { aliasesOf, libraryOverlay, preferredOf } from '../../../lib/library/core.js'
import { QUALITY_FILTERS, FILTER_LABEL, qualityIndex, countsOf, filterQuality, saveLibraryEdit, loadAdminOverlay } from '../../../lib/library-quality.js'
import Icon from '../../../components/Icon.jsx'
import { Empty } from './parts.jsx'

const PAGE = 60

function Panel({ row, rows, onClose, onSaved }) {
  const toast = useUI(s => s.toast)
  const ex = row.ex
  const entry = libraryOverlay()?.entries?.[ex.id] || {}
  const [f, setF] = useState(() => ({
    n: ex.n, es: entry.es || '', aliases: (entry.aliases || []).join(', '), note: entry.note || '',
    movement: row.f?.movement || '', equipment: row.f?.equipment || '', recommended: row.rec, preferredId: row.dep ? preferredOf(ex.id) : '',
  }))
  const [busy, setBusy] = useState(false)
  const twins = useMemo(() => rows.filter(r => r.id !== ex.id && !r.dep && r.f?.movement && r.f.movement === (row.f?.movement || '')).slice(0, 400), [rows, ex.id, row])
  useEffect(() => { setF(v => v) }, [ex.id])
  const set = patch => setF(v => ({ ...v, ...patch }))
  const save = async () => {
    const patch = {}
    if (f.n.trim() !== ex.n) patch.n = f.n.trim()
    if (f.es !== (entry.es || '')) patch.es = f.es.trim() || null
    const aliases = f.aliases.split(',').map(x => x.trim()).filter(Boolean)
    if (aliases.join('|') !== (entry.aliases || []).join('|')) patch.aliases = aliases
    if (f.note !== (entry.note || '')) patch.note = f.note.trim() || null
    if (f.movement !== (row.f?.movement || '')) patch.movement = f.movement
    if (f.equipment !== (row.f?.equipment || '')) patch.equipment = f.equipment || null
    if (f.recommended !== row.rec) patch.recommended = f.recommended
    if (f.preferredId !== (row.dep ? preferredOf(ex.id) : '')) patch.preferredId = f.preferredId || false
    if (!Object.keys(patch).length) { toast(t('Nothing to save')); return }
    setBusy(true)
    try { await saveLibraryEdit({ id: ex.id, patch }); toast(t('Saved')); onSaved() }
    catch (e) { toast(e.data?.errors?.[0] || e.message) }
    setBusy(false)
  }
  const reset = async () => {
    setBusy(true)
    try { await saveLibraryEdit({ id: ex.id, reset: true }); toast(t('Back to the code defaults')); onSaved() } catch (e) { toast(e.message) }
    setBusy(false)
  }
  return <aside className="st-qpanel" aria-label={t('Edit exercise')}>
    <header><div className="grow"><small className="num dim">#{ex.id}</small><h2>{nameFor(ex) || ex.n}</h2></div>
      <button className="cx-icon" aria-label={t('Close')} onClick={onClose}><Icon name="xmark" /></button></header>
    {gifSrc(ex) && <img className="st-qmedia" src={gifSrc(ex)} alt="" loading="lazy" onError={e => { const still = imgSrc(ex); if (still) e.currentTarget.src = still; else e.currentTarget.remove() }} />}
    {row.dupes.length > 0 && <p className="st-warn"><Icon name="info" />{t('Looks like')}: {row.dupes.slice(0, 3).map(d => EXIDX[d]?.n || d).join(' · ')}</p>}
    <div className="cx-form">
      <label className="cx-field"><span>{t('Visible name (English)')}</span><input className="input" maxLength={80} value={f.n} onChange={e => set({ n: e.target.value })} /></label>
      <label className="cx-field"><span>{t('Spanish name')}</span><input className="input" maxLength={80} value={f.es} onChange={e => set({ es: e.target.value })} placeholder={nameFor(ex)} /></label>
      <label className="cx-field"><span>{t('Aliases, separated by commas')}</span><input className="input" value={f.aliases} onChange={e => set({ aliases: e.target.value })} /></label>
      <div className="cx-form-row">
        <label className="cx-field"><span>{t('Movement')}</span><select className="input" value={f.movement} onChange={e => set({ movement: e.target.value })}>
          <option value="">{t('No movement')}</option>{MOVEMENTS.map(m => <option key={m.id} value={m.id}>{t(m.label)}</option>)}</select></label>
        <label className="cx-field"><span>{t('Equipment')}</span><select className="input" value={f.equipment} onChange={e => set({ equipment: e.target.value })}>
          <option value="">{t('Automatic')}</option>{Object.values(EQUIPMENT_BY_ID).map(q => <option key={q.id} value={q.id}>{t(q.label)}</option>)}</select></label>
      </div>
      <label className="cx-check"><input type="checkbox" checked={f.recommended} disabled={!!f.preferredId} onChange={e => set({ recommended: e.target.checked })} />{t('Recommended 2J')}</label>
      <label className="cx-field"><span>{t('Duplicate of (preferred exercise)')}</span><select className="input" value={f.preferredId} onChange={e => set({ preferredId: e.target.value, ...(e.target.value ? { recommended: false } : {}) })}>
        <option value="">{t('Not a duplicate')}</option>
        {f.preferredId && !twins.some(r => r.id === f.preferredId) && <option value={f.preferredId}>{EXIDX[f.preferredId]?.n || f.preferredId}</option>}
        {twins.map(r => <option key={r.id} value={r.id}>{r.ex.n} · #{r.id}</option>)}</select></label>
      <label className="cx-field"><span>{t('Curator note (admins only)')}</span><textarea className="input" rows={2} maxLength={200} value={f.note} onChange={e => set({ note: e.target.value })} /></label>
    </div>
    <div className="st-formacts">
      {libraryOverlay()?.entries?.[ex.id] && <button className="btn plain" disabled={busy} onClick={reset}>{t('Reset to defaults')}</button>}
      <span className="grow" />
      <button className="btn primary" disabled={busy} onClick={save}><Icon name="check" />{t('Save')}</button>
    </div>
  </aside>
}

export default function LibraryQuality() {
  const user = useStore(s => s.user)
  const [rev, setRev] = useState(0)
  const [ready, setReady] = useState(false)
  const [filters, setFilters] = useState([])
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [openId, setOpenId] = useState(null)
  useEffect(() => { loadAdminOverlay().catch(() => {}).finally(() => { setRev(r => r + 1); setReady(true) }) }, [user?.id])
  const rows = useMemo(() => ready ? qualityIndex() : [], [ready, rev])
  const counts = useMemo(() => countsOf(rows), [rows])
  const list = useMemo(() => filterQuality(rows, { filters, q }), [rows, filters, q])
  const open = openId ? rows.find(r => r.id === openId) : null
  const flip = k => { setFilters(f => f.includes(k) ? f.filter(x => x !== k) : [...f, k]); setLimit(PAGE) }
  return <div className={'cx-shell st st-quality' + (open ? ' with-panel' : '')}>
    <header className="st-top">
      <a className="trainer-back" href="#/trainer/guided"><Icon name="chevronLeft" />{t('Studio')}</a>
      <div className="st-title"><h1>{t('Library quality')}</h1>
        <p className="dim small">{t('Fix names, movements and duplicates. Exercise ids never change, so old plans and history keep working.')}</p></div>
    </header>
    <div className="st-qgrid">
      <section className="st-qmain">
        <input className="input" type="search" value={q} onChange={e => { setQ(e.target.value); setLimit(PAGE) }} placeholder={t('Search by name, alias or id')} aria-label={t('Search by name, alias or id')} />
        <div className="st-chips">
          {QUALITY_FILTERS.map(k => <button key={k} className={'chip' + (filters.includes(k) ? ' on' : '')} aria-pressed={filters.includes(k)} onClick={() => flip(k)}>
            {t(FILTER_LABEL[k])} <span className="num">{counts[k] ?? 0}</span></button>)}
        </div>
        <p className="dim small num">{t('{0} exercises', list.length)}</p>
        <div className="st-list">
          {list.slice(0, limit).map(r => <button key={r.id} className={'st-qrow' + (openId === r.id ? ' on' : '')} onClick={() => setOpenId(r.id)}>
            <span className="grow st-main"><b>{nameFor(r.ex) || r.ex.n}</b>
              <small className="num">#{r.id} · {r.f?.movement ? t(MOVEMENTS.find(m => m.id === r.f.movement)?.label || r.f.movement) : t('No movement')} · {r.f?.equipment ? t(EQUIPMENT_BY_ID[r.f.equipment]?.label || r.f.equipment) : '—'}</small></span>
            <span className="st-flags">
              {r.rec && <span className="st-flag good">{t('2J')}</span>}
              {r.dep && <span className="st-flag mute">{t('Deprecated')}</span>}
              {r.flags.has('duplicate') && <span className="st-flag warn">{t('Duplicate?')}</span>}
              {r.flags.has('noMovement') && !r.dep && <span className="st-flag warn">{t('Movement')}</span>}
              {r.flags.has('oddName') && <span className="st-flag warn">{t('Name')}</span>}
            </span>
          </button>)}
          {!list.length && <Empty title={t('Nothing matches')}>{t('Try another filter or search.')}</Empty>}
          {list.length > limit && <button className="btn tinted" onClick={() => setLimit(l => l + PAGE)}>{t('Show more')}</button>}
        </div>
      </section>
      {open && <Panel key={open.id} row={open} rows={rows} onClose={() => setOpenId(null)} onSaved={() => setRev(r => r + 1)} />}
    </div>
  </div>
}
