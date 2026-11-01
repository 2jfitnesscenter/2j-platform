// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// "Entrena con 2J" management (trainer panel). Trainers: their own guided routines (duplicate an
// official one, edit, delete) — private to them. Admins: also the official catalogue's curation
// (featured, order, badge, active), content edits and collections. A light V1, not a CMS: the
// same DayCanvas and block library the Constructor uses, and the server validates every save.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { useGuided } from '../../lib/guided-api.js'
import { HistoryButton } from './studio/History.jsx'
import { validate } from '../../lib/blocks-api.js'
import { GOALS, LEVELS, GOAL_LABEL, LEVEL_LABEL, CATEGORY_LABEL, ROUTINE_CATEGORIES, instantiateBlock, blockTypesOf, routineFacts } from '../../lib/protocol/index.js'
import { confirmSheet, exercisePicker } from '../../sheets.jsx'
import Library from '../../components/constructor/Library.jsx'
import DayCanvas, { withEx, prescribedEntry, insertInstance } from '../../components/constructor/DayCanvas.jsx'
import { ProtocolReport, ProtocolPill } from '../../components/constructor/parts.jsx'
import { CurateSheet, lookup } from '../../components/train2j/parts.jsx'
import { partName } from '../../lib/train2j.js'
import WorkoutCover from '../../components/WorkoutCover.jsx'
import Icon from '../../components/Icon.jsx'
import { STATUSES, STATUS_LABEL, PURPOSES, PURPOSE_LABEL, statusOf } from '../../lib/studio.js'

const STYLES = ['start', 'tabata', 'hiit', 'circuit', 'interval', 'mobility', 'express', 'core', 'mixed']
const FOCI = [['fullbody', 'Full body'], ['lower', 'Lower body'], ['upper', 'Upper body'], ['core', 'Core'], ['cardio', 'Cardio']]

function Row({ r, children }) {
  return <div className={'g2a-row' + (r.active === false ? ' off' : '')}>
    <WorkoutCover r={r} shape="square" />
    <div className="grow">
      <b>{t(r.name)}</b>
      <small className="num">{t(CATEGORY_LABEL[r.category])} · {t(LEVEL_LABEL[r.level])} · ~{r.estimatedMinutes} min
        {r.featured ? ' · ' + t('Featured {0}', r.featured) : ''}{r.badge ? ' · ' + r.badge : ''}{r.active === false ? ' · ' + t('Inactive') : ''}</small>
    </div>
    <div className="g2a-acts">{children}</div>
  </div>
}

function CollectionSheet({ c, routines, close }) {
  const toast = useUI(s => s.toast)
  const saveCollection = useGuided(s => s.saveCollection)
  const [x, setX] = useState(() => ({ name: '', description: '', style: 'start', order: 0, active: true, routineIds: [], ...(c ? JSON.parse(JSON.stringify(c)) : {}) }))
  const has = id => x.routineIds.includes(id)
  const flip = id => setX(v => ({ ...v, routineIds: has(id) ? v.routineIds.filter(y => y !== id) : [...v.routineIds, id] }))
  const save = async () => { try { await saveCollection(x); toast(t('Saved')); close() } catch (e) { toast(e.message) } }
  return <div className="cx-form">
    <h3>{c ? t(c.name) : t('New collection')}</h3>
    <label className="cx-field"><span>{t('Name')}</span><input className="input" maxLength={60} value={x.name} onChange={e => setX(v => ({ ...v, name: e.target.value }))} /></label>
    <label className="cx-field"><span>{t('Description')}</span><input className="input" maxLength={200} value={x.description || ''} onChange={e => setX(v => ({ ...v, description: e.target.value }))} /></label>
    <div className="cx-form-row">
      <label className="cx-field"><span>{t('Look')}</span><select className="input" value={x.style} onChange={e => setX(v => ({ ...v, style: e.target.value }))}>{STYLES.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
      <label className="cx-field"><span>{t('Order')}</span><input className="input" type="number" min="0" value={x.order} onChange={e => setX(v => ({ ...v, order: Number(e.target.value) }))} /></label>
    </div>
    <label className="cx-check"><input type="checkbox" checked={x.active !== false} onChange={e => setX(v => ({ ...v, active: e.target.checked }))} />{t('Active')}</label>
    <div className="t2-fl">{t('Workouts, in order')}</div>
    <div className="g2a-pick">{routines.map(r => <label key={r.id} className={'g2a-pickrow' + (has(r.id) ? ' on' : '')}>
      <input type="checkbox" checked={has(r.id)} onChange={() => flip(r.id)} />
      <span className="grow">{t(r.name)}</span>{has(r.id) && <b className="num">{x.routineIds.indexOf(r.id) + 1}</b>}</label>)}</div>
    <button className="btn primary" onClick={save}><Icon name="check" />{t('Save')}</button>
  </div>
}

function ProgramCurationSheet({ program, close }) {
  const toast = useUI(s => s.toast)
  const curateProgram = useGuided(s => s.curateProgram)
  const [x, setX] = useState({ name: program.name, description: program.description, active: program.active !== false, featured: !!program.featured })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try { await curateProgram(program.id, x); toast(t('Saved')); close() } catch (e) { toast(e.message) }
    setBusy(false)
  }
  return <div className="cx-form"><h3>{t('Curate program')}</h3>
    <label className="cx-field"><span>{t('Name')}</span><input className="input" maxLength={70} value={x.name} onChange={e => setX(v => ({ ...v, name: e.target.value }))} /></label>
    <label className="cx-field"><span>{t('Description')}</span><textarea className="input" rows={3} maxLength={400} value={x.description} onChange={e => setX(v => ({ ...v, description: e.target.value }))} /></label>
    <label className="cx-check"><input type="checkbox" checked={x.active} onChange={e => setX(v => ({ ...v, active: e.target.checked }))} />{t('Active')}</label>
    <label className="cx-check"><input type="checkbox" checked={x.featured} onChange={e => setX(v => ({ ...v, featured: e.target.checked }))} />{t('Featured')}</label>
    <button className="btn primary" disabled={busy} onClick={save}><Icon name="check" />{t('Save')}</button>
  </div>
}

const StudioAdmin = lazy(() => import('./studio/StudioAdmin.jsx'))

/** Admins get the Studio (lazy); trainers keep their own routines page. */
export default function GuidedAdmin() {
  const admin = useStore(s => !!s.user?.admin)
  return admin ? <Suspense fallback={<div className="cx-shell" role="status" />}><StudioAdmin /></Suspense> : <TrainerGuided />
}

function TrainerGuided() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const openSheet = useUI(s => s.openSheet)
  const toast = useUI(s => s.toast)
  const g = useGuided()
  useEffect(() => { g.load(user?.id, true) }, [user?.id])
  const official = useMemo(() => [...g.routines].sort((a, b) => (a.order ?? 999) - (b.order ?? 999)), [g.routines])
  const act = fn => async () => { try { await fn() } catch (e) { toast(e.message) } }
  const dup = r => act(async () => { const c = await g.duplicate(r.id); toast(t('Copied to your routines')); nav('/trainer/guided/edit/' + c.id) })

  return <div className="cx-shell cx-libpage g2a">
    <header className="cx-top">
      <a className="trainer-back" href="#/trainer"><Icon name="chevronLeft" />{t('Trainer panel')}</a>
      <h1 className="cx-title static">{t('Train with 2J')}</h1>
      <span className="grow" />
      <a className="btn plain" href="#/train2j"><Icon name="play" />{t('Open the library')}</a>
      <button className="btn primary" onClick={() => nav('/trainer/guided/edit/new')}><Icon name="plus" />{t('New guided routine')}</button>
    </header>
    <p className="dim small cx-lead">{t('Official 2J routines are built from official blocks and validated under the 2J protocol. Assigning one gives the member a copy; duplicating one gives you a private routine to edit.')}</p>

    {g.mine.length > 0 && <section className="g2a-sec">
      <h2>{t('Your guided routines')}</h2>
      {g.mine.map(r => <Row key={r.id} r={r}>
        <button className="btn plain" onClick={() => nav('/trainer/guided/edit/' + r.id)}><Icon name="pencil" />{t('Edit')}</button>
        <button className="btn plain danger" onClick={() => confirmSheet({ title: t('Delete this routine?'), message: t('Members who already received it keep their own copy.'), confirmText: t('Delete'), danger: true,
          onConfirm: act(() => g.remove(r.id)) })}><Icon name="trash" /></button>
      </Row>)}
    </section>}

    <section className="g2a-sec">
      <h2>{t('Official 2J routines')} <span className="num dim">{official.length}</span></h2>
      {official.map(r => <Row key={r.id} r={r}>
        <a className="btn plain" href={'#/train2j/r/' + r.id}><Icon name="play" />{t('Preview')}</a>
        <button className="btn plain" onClick={dup(r)}><Icon name="clipboard" />{t('Duplicate')}</button>
        {g.canEdit && <button className="btn plain" onClick={() => openSheet(close => <CurateSheet r={r} close={close} />)}><Icon name="gear" />{t('Feature and order')}</button>}
        {g.canEdit && <button className="btn plain" onClick={() => nav('/trainer/guided/edit/' + r.id)}><Icon name="pencil" />{t('Edit')}</button>}
      </Row>)}
    </section>

    {g.canEdit && <section className="g2a-sec"><h2>{t('Official 2J programs')} <span className="num dim">{g.programs.length}</span></h2>
      {g.programs.map(p => <div key={p.id} className={'g2a-row' + (p.active === false ? ' off' : '')}>
        <WorkoutCover r={{ id: p.id, category: p.cover }} shape="square" />
        <div className="grow"><b>{t(p.name)}</b><small>{t(p.durationLabel)} · {t('{0} sessions/week', p.sessionsPerWeek)}{p.featured ? ' · ' + t('Featured') : ''}{p.active === false ? ' · ' + t('Inactive') : ''}</small></div>
        <div className="g2a-acts"><a className="btn plain" href={'#/train2j/program/' + p.id}><Icon name="play" />{t('Preview')}</a>
          <button className="btn plain" onClick={() => openSheet(close => <ProgramCurationSheet program={p} close={close} />)}><Icon name="gear" />{t('Curate program')}</button></div>
      </div>)}
    </section>}

    {g.canEdit && <section className="g2a-sec">
      <h2>{t('Collections')}<button className="btn plain" style={{ marginLeft: 'auto' }} onClick={() => openSheet(close => <CollectionSheet routines={official} close={close} />, { wide: true })}><Icon name="plus" />{t('New collection')}</button></h2>
      {g.collections.map(c => <div key={c.id} className={'g2a-row' + (c.active === false ? ' off' : '')}>
        <WorkoutCover r={{ id: c.id, style: c.style }} shape="square" />
        <div className="grow"><b>{t(c.name)}</b><small>{t('{0} workouts', c.routineIds.length)} · {t('Order')} {c.order}{c.active === false ? ' · ' + t('Inactive') : ''}</small></div>
        <div className="g2a-acts"><button className="btn plain" onClick={() => openSheet(close => <CollectionSheet c={c} routines={official} close={close} />, { wide: true })}><Icon name="pencil" />{t('Edit')}</button></div>
      </div>)}
    </section>}
  </div>
}

/** Create or edit a guided routine: the Constructor's day canvas plus catalogue metadata. */
export function GuidedEditor() {
  const nav = useNavigate()
  const { id } = useParams()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const g = useGuided()
  const [r, setR] = useState(null)
  const [busy, setBusy] = useState(false)
  const [serverV, setServerV] = useState(null)
  const [libOpen, setLibOpen] = useState(false)
  // Wait for the server's answer: the device copy of the catalogue never holds a trainer's own routines.
  const [fresh, setFresh] = useState(false)
  useEffect(() => { g.load(user?.id, true).finally(() => setFresh(true)) }, [user?.id])
  useEffect(() => {
    if (r || !fresh || g.status !== 'ready') return
    if (id === 'new') { setR({ name: '', subtitle: '', description: '', category: 'circuit', goal: 'general', level: 'intermediate', focus: 'fullbody', ex: [], blocks: [], scope: g.canEdit ? 'official' : 'personal', status: 'draft' }); return }
    const found = g.mine.find(x => x.id === id) || g.routines.find(x => x.id === id)
    if (!found) { toast(t('That routine no longer exists.')); nav('/trainer/guided'); return }
    // Parts carry no stored name in the seed: show them as the catalogue does (Warm-up, Tabata · …).
    const copy = JSON.parse(JSON.stringify(found))
    copy.blocks = (copy.blocks || []).map(b => b.name ? b : { ...b, name: partName(b, t) })
    if (copy.official) copy.status = statusOf(found)
    setR(copy)
  }, [g.status, id, fresh])
  const v = useMemo(() => r ? validate({ kind: 'routine', goal: r.goal, level: r.level, entries: r.ex, blockTypes: blockTypesOf(r.blocks) }) : null, [r])
  const facts = useMemo(() => r ? routineFacts(r, lookup) : null, [r])
  if (!r) return <div className="cx-shell" />
  const ctx = { goal: r.goal, level: r.level }
  const set = patch => setR(x => ({ ...x, ...patch }))
  const addBlock = b => { const inst = instantiateBlock(b, t); set(insertInstance({ ex: r.ex, blocks: r.blocks }, { ...inst, meta: { ...inst.meta, role: 'main' } })); setLibOpen(false) }
  const submit = async () => {
    if (!(r.name || '').trim()) { toast(t('Give the routine a name')); return }
    setBusy(true); setServerV(null)
    try {
      const res = await g.save(r)
      toast(t('Saved')); nav('/trainer/guided/edit/' + res.routine.id, { replace: true }); setR(JSON.parse(JSON.stringify(res.routine)))
    } catch (e) { toast(e.message); if (e.data?.validation) setServerV(e.data.validation) }
    setBusy(false)
  }
  const sel = (k, label, options) => <label className="cx-field"><span>{label}</span>
    <select className="input" value={r[k] || ''} onChange={e => set({ [k]: e.target.value })}>{options}</select></label>
  const day = { ex: r.ex, blocks: r.blocks }
  return <div className="cx-shell">
    <header className="cx-top">
      <a className="trainer-back" href="#/trainer/guided"><Icon name="chevronLeft" />{t('Train with 2J')}</a>
      <input className="cx-title" value={r.name ? t(r.name) : ''} placeholder={t('Routine name')} onChange={e => set({ name: e.target.value })} aria-label={t('Routine name')} />
      {r.official && r.id && <a className="btn plain cx-prev" href={'#/train2j/r/' + r.id}><Icon name="play" />{t('Preview')}</a>}
      <div className="cx-top-meta"><ProtocolPill v={v} /><span className="cx-daystats num">~{facts.minutes} min</span></div>
      <button className="btn primary cx-save" disabled={busy || v?.result === 'FAIL'} onClick={submit}><Icon name="check" />{t('Save')}</button>
    </header>
    <div className={'cx-grid editor'}>
      <main className="cx-main">
        <div className="cx-dayhead"><span className="cx-daystats num">{t('{0} exercises', r.ex.length)} · ~{facts.minutes} min</span><span className="grow" />
          <button className="btn tinted cx-libbtn" onClick={() => setLibOpen(true)}><Icon name="list" />{t('Library')}</button></div>
        <DayCanvas day={day} ctx={ctx} onChange={d => set({ ex: d.ex, blocks: d.blocks })}
          onAddBlock={() => setLibOpen(true)}
          onAddExercise={() => exercisePicker(ex => set(withEx(day, [...r.ex, prescribedEntry(ex, ctx, r.ex.length)])))} />
      </main>
      <aside className="cx-side static">
        <div className="cx-form">
          <label className="cx-field"><span>{t('Subtitle')}</span><input className="input" maxLength={70} value={r.subtitle ? t(r.subtitle) : ''} onChange={e => set({ subtitle: e.target.value })} /></label>
          <label className="cx-field"><span>{t('Description')}</span><textarea className="input" rows={3} maxLength={400} value={r.description ? t(r.description) : ''} onChange={e => set({ description: e.target.value })} /></label>
          <div className="cx-form-row">
            {sel('category', t('Type'), ROUTINE_CATEGORIES.map(c => <option key={c} value={c}>{t(CATEGORY_LABEL[c])}</option>))}
            {sel('focus', t('Focus'), FOCI.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>))}
          </div>
          <div className="cx-form-row">
            {sel('goal', t('Training goal'), GOALS.map(x => <option key={x} value={x}>{t(GOAL_LABEL[x])}</option>))}
            {sel('level', t('Level'), LEVELS.map(x => <option key={x} value={x}>{t(LEVEL_LABEL[x])}</option>))}
          </div>
          {g.canEdit && id === 'new' && <label className="cx-check"><input type="checkbox" checked={r.scope === 'official'} onChange={e => set({ scope: e.target.checked ? 'official' : 'personal' })} />{t('Publish as an official 2J routine')}</label>}
          {(r.official || r.scope === 'official') && <>
            {sel('status', t('State'), STATUSES.map(x => <option key={x} value={x}>{t(STATUS_LABEL[x])}</option>))}
            <div className="cx-form-col">
              <label className="cx-field"><span>{t('Purpose')}</span><select className="input" value={r.purpose || ''} onChange={e => set({ purpose: e.target.value || null })}>
                <option value="">{t('Training session')}</option>{PURPOSES.map(x => <option key={x} value={x}>{t(PURPOSE_LABEL[x])}</option>)}</select></label>
              <label className="cx-field"><span>{t('Cover')}</span><select className="input" value={r.cover || ''} onChange={e => set({ cover: e.target.value || null })}>
                <option value="">{t('Automatic')}</option>{ROUTINE_CATEGORIES.map(c => <option key={c} value={c}>{t(CATEGORY_LABEL[c])}</option>)}</select></label>
            </div>
            {g.canEdit && r.official && id !== 'new' && <HistoryButton id={r.id} />}
            <label className="cx-field"><span>{t('Internal notes (admins only)')}</span><textarea className="input" rows={2} maxLength={300} value={r.notes || ''} onChange={e => set({ notes: e.target.value })} /></label>
          </>}
          {!r.official && <p className="dim small">{t('Your guided routines are private: only you see them, and you can assign them like any other.')}</p>}
        </div>
        <ProtocolReport v={serverV || v} />
        {libOpen && <div className="g2a-lib"><div className="cx-side-h"><h2>{t('Block library')}</h2>
          <button className="cx-icon" aria-label={t('Close')} onClick={() => setLibOpen(false)}><Icon name="xmark" /></button></div>
          <Library onAdd={addBlock} defaults={{ goal: '', level: '' }} /></div>}
      </aside>
    </div>
  </div>
}
