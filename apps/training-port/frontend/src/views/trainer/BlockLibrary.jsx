// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Block library management (trainer panel): browse the official 2J library and personal
// blocks, preview, duplicate, edit, activate/deactivate, delete — and the block editor.
// Permissions are the server's (lib/blocks-store.js): trainers manage their own blocks; only
// admins edit/deactivate official ones. Deleting never breaks a routine — routines hold copies.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { useBlocks, validate } from '../../lib/blocks-api.js'
import { GOALS, LEVELS, GOAL_LABEL, LEVEL_LABEL, FOCUS, FOCUS_LABEL, BLOCK_TYPES, TYPE_LABEL, BLOCK_TYPES_READY, STYLE_LABEL, blockTitle } from '../../lib/protocol/index.js'
import { confirmSheet, exercisePicker } from '../../sheets.jsx'
import Library from '../../components/constructor/Library.jsx'
import DayCanvas, { withEx, prescribedEntry, dayMinutes } from '../../components/constructor/DayCanvas.jsx'
import { ProtocolReport, ProtocolPill } from '../../components/constructor/parts.jsx'
import Icon from '../../components/Icon.jsx'

export default function BlockLibrary() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const { canEditOfficial, uid, duplicate, setActive, remove } = useBlocks()
  const canEdit = b => b.official ? canEditOfficial : b.createdBy === uid
  // Visibility is a switch on the card, saved at once (the "…" actions are for edit / duplicate / delete).
  const [busy, setBusy] = useState(() => new Set())
  const visibility = { can: canEdit, busy, toggle: async (b, on) => {
    if (busy.has(b.id)) return
    setBusy(p => new Set(p).add(b.id))
    try { await setActive(b.id, on); toast(on ? t('Visible to members') : t('Hidden')) } catch (e) { toast(e.message) }
    setBusy(p => { const n = new Set(p); n.delete(b.id); return n })
  } }
  const extra = (b, close) => <>
    <button className="btn plain" onClick={async () => { try { const c = await duplicate(b.id); close(); toast(t('Copied to your blocks')); nav('/trainer/blocks/edit/' + c.id) } catch (e) { toast(e.message) } }}><Icon name="clipboard" />{t('Duplicate')}</button>
    {canEdit(b) && <button className="btn plain" onClick={() => { close(); nav('/trainer/blocks/edit/' + b.id) }}><Icon name="pencil" />{t('Edit')}</button>}
    {canEdit(b) && !(b.official && b.seedVersion) && <button className="btn plain danger" onClick={() => { close(); confirmSheet({
      title: t('Delete this block?'), message: t('Routines that already used it keep their own copy — nothing that was assigned changes.'), confirmText: t('Delete'), danger: true,
      onConfirm: () => remove(b.id).then(() => toast(t('Block deleted'))).catch(e => toast(e.message)) }) }}><Icon name="trash" />{t('Delete')}</button>}
  </>
  return <div className="cx-shell cx-libpage">
    <header className="cx-top">
      <a className="trainer-back" href="#/trainer"><Icon name="chevronLeft" />{t('Trainer panel')}</a>
      <h1 className="cx-title static">{t('Block library')}</h1>
      <span className="grow" />
      <button className="btn primary" onClick={() => nav('/trainer/blocks/edit/new')}><Icon name="plus" />{t('New block')}</button>
    </header>
    <p className="dim small cx-lead">{t('Official 2J blocks follow the 2J Training Protocol v1.0. Duplicate one to make it yours; your blocks are only visible to you.')}</p>
    <Library full extraActions={extra} visibility={visibility} />
  </div>
}

export function BlockEditor() {
  const nav = useNavigate()
  const { blockId } = useParams()
  const toast = useUI(s => s.toast)
  const { status, blocks, load, save, canEditOfficial } = useBlocks()
  const [b, setB] = useState(null)
  const [busy, setBusy] = useState(false)
  const [serverV, setServerV] = useState(null)
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (b || status !== 'ready') return
    if (blockId === 'new') { setB({ name: '', goal: 'hypertrophy', level: 'intermediate', focus: 'glutes', type: 'strength', style: '', description: '', reason: '', ex: [], scope: 'personal' }); return }
    const found = blocks.find(x => x.id === blockId)
    if (!found) { toast(t('That block no longer exists.')); nav('/trainer/blocks'); return }
    setB(JSON.parse(JSON.stringify(found)))
  }, [status, blockId])
  const v = useMemo(() => b ? validate({ kind: 'block', goal: b.goal, level: b.level, type: b.type, focus: b.focus, entries: b.ex, reasons: b.reason ? { reps_outside_preferred: b.reason, rest_outside_preferred: b.reason, redundant_pair: b.reason, rpe10_share: b.reason } : {} }, { official: !!(b.official || b.scope === 'official') }) : null, [b])
  if (!b) return <div className="cx-shell" />
  const ctx = { goal: b.goal, level: b.level }
  const day = { ex: b.ex, blocks: [] }
  const set = patch => setB(x => ({ ...x, ...patch }))
  const official = !!(b.official || b.scope === 'official')
  const submit = async () => {
    if (!official && !(b.name || '').trim()) { toast(t('Give the block a name')); return }
    if (!b.ex.length) { toast(t('Add at least one exercise first.')); return }
    setBusy(true); setServerV(null)
    try {
      const r = await save({ ...b, ex: b.ex.map(({ blk, ...e }) => e) })
      toast(t('Saved')); nav('/trainer/blocks/edit/' + r.block.id, { replace: true }); setB(JSON.parse(JSON.stringify(r.block)))
    } catch (e) { toast(e.message); if (e.data?.validation) setServerV(e.data.validation) }
    setBusy(false)
  }
  const sel = (k, label, options) => <label className="cx-field"><span>{label}</span>
    <select className="input" value={b[k] || ''} onChange={e => set({ [k]: e.target.value })}>{options}</select></label>
  return <div className="cx-shell">
    <header className="cx-top">
      <a className="trainer-back" href="#/trainer/blocks"><Icon name="chevronLeft" />{t('Block library')}</a>
      <input className="cx-title" value={b.name || ''} placeholder={blockTitle({ ...b, name: null }, t)} onChange={e => set({ name: e.target.value })} aria-label={t('Block name')} />
      <div className="cx-top-meta"><ProtocolPill v={v} /></div>
      <button className="btn primary cx-save" disabled={busy || v?.result === 'FAIL'} onClick={submit}><Icon name="check" />{t('Save block')}</button>
    </header>
    <div className="cx-grid editor">
      <main className="cx-main">
        <div className="cx-dayhead"><span className="cx-daystats num">{t('{0} exercises', b.ex.length)} · ~{dayMinutes(b.ex, b.goal)} min</span></div>
        <DayCanvas day={day} ctx={ctx} onChange={d => set({ ex: d.ex })}
          onAddBlock={null}
          onAddExercise={() => exercisePicker(ex => set({ ex: withEx(day, [...b.ex, prescribedEntry(ex, ctx, b.ex.length)]).ex }))} />
      </main>
      <aside className="cx-side static">
        <div className="cx-form">
          <div className="cx-form-row">
            {sel('goal', t('Training goal'), GOALS.map(g => <option key={g} value={g}>{t(GOAL_LABEL[g])}</option>))}
            {sel('level', t('Level'), LEVELS.map(l => <option key={l} value={l}>{t(LEVEL_LABEL[l])}</option>))}
          </div>
          <div className="cx-form-row">
            {sel('focus', t('Muscle / pattern'), FOCUS.map(f => <option key={f} value={f}>{t(FOCUS_LABEL[f])}</option>))}
            {sel('type', t('Type'), BLOCK_TYPES.map(x => <option key={x} value={x}>{t(TYPE_LABEL[x])}{BLOCK_TYPES_READY.includes(x) ? '' : ' · ' + t('coming soon')}</option>))}
          </div>
          <div className="cx-form-row">
            {sel('style', t('Style'), [<option key="" value="">—</option>, ...Object.keys(STYLE_LABEL).map(s => <option key={s} value={s}>{t(STYLE_LABEL[s])}</option>)])}
            {official && sel('variant', t('Variant'), [<option key="" value="">—</option>, ...['A', 'B', 'C', 'D'].map(x => <option key={x} value={x}>{x}</option>)])}
          </div>
          <label className="cx-field"><span>{t('Description (optional)')}</span><textarea className="input" rows={2} maxLength={300} value={b.description || ''} onChange={e => set({ description: e.target.value })} /></label>
          <label className="cx-field"><span>{t('Reason for choices outside the preferred zone (optional)')}</span><input className="input" maxLength={300} value={b.reason || ''} onChange={e => set({ reason: e.target.value })} placeholder={t('e.g. High range chosen for stable isolation.')} /></label>
          {canEditOfficial && !b.id && <label className="cx-check"><input type="checkbox" checked={b.scope === 'official'} onChange={e => set({ scope: e.target.checked ? 'official' : 'personal' })} />{t('Publish as an official 2J block')}</label>}
          {b.official && b.seedChanged && <div className="cx-note">{t('The base library has a newer version of this block. Your edited version is kept.')}</div>}
        </div>
        <ProtocolReport v={serverV || v} />
      </aside>
    </div>
  </div>
}
