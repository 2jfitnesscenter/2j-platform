// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Premium Training Programs, staff side. Admin: the whole catalogue (status, featured, order, versions, promote). Trainer: their own programs only
// (create, edit, duplicate, try, archive) — publishing to the catalogue is the admin's decision, and the server enforces it; this screen only hides what would be refused.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { usePremium } from '../lib/premium-api.js'
import { allowedByAdmin } from '../lib/features.js'
import { STATUS_LABEL, SCOPE_LABEL, BADGE_LABEL, LEVEL_KEY, copyOf } from '../lib/premium-text.js'
import { t } from '../lib/i18n.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import PremiumCover from '../components/PremiumCover.jsx'
import { resizeImageFile, uploadImage } from '../lib/media.js'
import './premium.css'

const GOALS = ['hypertrophy', 'strength', 'strength-muscle', 'recomposition', 'conditioning', 'health']
const LEVELS = ['beginner', 'intermediate', 'advanced']
const METHODS = ['percentage-wave', 'weekly-load', 'tiered', 'upper-lower', 'split', 'undulating', 'full-body', 'concurrent', 'conditioning', 'recomposition', 'opposition']
const SOURCES = ['established', 'principles', 'own']
const PROGRESSIONS = ['training-max-cycle', 'weekly-linear', 'double-progression', 'linear', 'tiered', 'undulating', 'none']

function useStaff() {
  const user = useStore(s => s.user)
  const c = usePremium()
  useEffect(() => { c.load(user?.id) }, [user?.id])   // eslint-disable-line react-hooks/exhaustive-deps
  return { c, user, admin: !!user?.admin }
}

export function PremiumManage() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const { c, user, admin } = useStaff()
  const [busy, setBusy] = useState('')
  const rows = c.programs
  const run = async (key, fn, ok) => { setBusy(key); try { await fn(); if (ok) toast(t(ok)) } catch (e) { toast(e.message) } setBusy('') }
  const mine = p => p.scope === 'personal' && p.createdBy === user?.id
  const move = (i, d) => {
    const ids = rows.map(p => p.id); const j = i + d
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    run('order', () => c.reorder(ids))
  }
  const remove = p => confirmSheet({ title: t('Delete this program?'), message: t('Only programs that were never published or started can be deleted. Otherwise archive it.'), confirmText: t('Delete'), danger: true,
    onConfirm: () => run(p.id, () => c.remove(p.id), 'Deleted') })
  const versions = async p => {
    const list = await c.history(p.id)
    openSheet(close => <div className="pm-sheet"><h3>{t('Versions')} · {p.name}</h3>
      {!list.length && <p className="dim small">{t('No earlier versions yet.')}</p>}
      {list.map(v => <div key={v.at} className="pm-mgr-row"><span className="grow"><b>v{v.version}</b><small>{new Date(v.at).toLocaleString()}</small></span>
        {admin && <button className="btn plain" onClick={() => { close(); run(p.id, () => c.restore(p.id, v.at), 'Restored') }}>{t('Restore')}</button>}</div>)}
      <button className="btn plain" onClick={close}>{t('Close')}</button></div>)
  }
  return <main className="pm-page">
    <header className="pm-head"><button className="pm-back" aria-label={t('Back')} onClick={() => nav(admin ? '/admin' : '/trainer')}><Icon name="chevronLeft" /></button>
      <div className="grow"><span className="t2-eyebrow">{admin ? t('ADMINISTRATION') : t('TRAINER')}</span><h1>{t('Premium training programs')}</h1></div>
      <button className="btn primary" onClick={() => nav('/premium/manage/edit/new')}><Icon name="plus" />{t('New')}</button></header>
    {admin && <p className={'pm-note' + (allowedByAdmin('premium') ? '' : ' warn')}><Icon name="info" />{allowedByAdmin('premium')
      ? t('The Premium catalogue is ON for members.') : t('The Premium catalogue is OFF: members cannot start new programs; running ones keep working.')}
      <button className="btn plain" onClick={() => nav('/admin/features')}>{t('Feature switches')}</button></p>}
    {!admin && <p className="pm-note"><Icon name="info" />{t('You create and test your own programs. The administrator decides what reaches the catalogue.')}</p>}
    {c.status === 'loading' && <div className="pm-empty"><b>{t('Loading…')}</b></div>}
    {rows.map((p, i) => {
      const x = copyOf(p, 'es')
      const canEdit = admin || mine(p)
      return <article key={p.id} className="pm-mgr-row" style={{ flexWrap: 'wrap' }}>
        <div className="pm-mgr-thumb"><PremiumCover p={p} ratio="4 / 3" /></div>
        <div className="grow"><b>{x.name}</b>
          <small>{t(SCOPE_LABEL[p.scope] || p.scope)} · {t(STATUS_LABEL[p.status])} · v{p.version} · {t(LEVEL_KEY[p.level])} · {t('{0} days/week', p.daysPerWeek)}
            {p.featured ? ' · ' + t(BADGE_LABEL.featured) : ''}{p.badge && p.badge !== 'featured' ? ' · ' + t(BADGE_LABEL[p.badge]) : ''}{p.usage ? ' · ' + t('{0} started', p.usage.started) : ''}
            {p.legal?.status === 'review' ? ' · ' + t('Legal review pending') : ''}</small></div>
        <div className="pm-mgr-acts">
          <button className="btn plain" onClick={() => nav('/premium/p/' + p.slug)}>{t('Open')}</button>
          {canEdit && <button className="btn plain" onClick={() => nav('/premium/manage/edit/' + p.id)}>{t('Edit')}</button>}
          <button className="btn plain" disabled={busy === p.id} onClick={() => run(p.id, () => c.duplicate(p.id, admin && p.scope !== 'personal'), 'Duplicated')}>{t('Duplicate')}</button>
          {admin && <>
            <button className="btn plain" onClick={() => move(i, -1)} aria-label={t('Move up')}><Icon name="chevronUp" /></button>
            <button className="btn plain" onClick={() => move(i, 1)} aria-label={t('Move down')}><Icon name="chevronDown" /></button>
            {p.scope !== 'personal' && p.status !== 'published' && <button className="btn plain" onClick={() => run(p.id, () => c.setStatus(p.id, 'published'), 'Published')}>{t('Publish')}</button>}
            {p.scope !== 'personal' && p.status === 'published' && <button className="btn plain" onClick={() => run(p.id, () => c.setStatus(p.id, 'hidden'), 'Hidden')}>{t('Hide')}</button>}
            {p.scope !== 'personal' && <button className="btn plain" onClick={() => run(p.id, () => c.feature(p.id, { featured: !p.featured }), 'Saved')}>{p.featured ? t('Unfeature') : t('Feature')}</button>}
            {p.scope === 'personal' && <button className="btn plain" onClick={() => run(p.id, () => c.promote(p.id), 'Promoted to the catalogue as a draft')}>{t('Promote to catalogue')}</button>}
          </>}
          {canEdit && p.status !== 'archived' && <button className="btn plain" onClick={() => run(p.id, () => c.setStatus(p.id, 'archived'), 'Archived')}>{t('Archive')}</button>}
          {canEdit && p.status === 'archived' && <button className="btn plain" onClick={() => run(p.id, () => c.setStatus(p.id, admin ? 'draft' : 'hidden'), 'Saved')}>{t('Restore')}</button>}
          {admin && p.version > 1 && <button className="btn plain" onClick={() => versions(p)}>{t('Versions')}</button>}
          {canEdit && p.scope !== 'official' && <button className="btn plain danger" onClick={() => remove(p)}>{t('Delete')}</button>}
        </div>
      </article>
    })}
  </main>
}

const BLANK = () => ({
  name: '', slug: '', shortDescription: '', longDescription: '', goalTags: ['hypertrophy'], level: 'beginner', daysPerWeek: 1, durationDescription: '',
  methodType: 'full-body', sourceType: 'own', evidenceSummary: '', equipmentRequirements: [], progressionModel: 'double-progression',
  author: { name: '' }, legal: { status: 'none', note: '' }, copy: { howItWorks: [], forWhom: [], notIdealIf: [], tracking: [] },
  programDefinition: { schema: 1, cycleWeeks: 1, weeks: [{ sessions: [{ key: 'day-a', title: 'Day A', blocks: [{ role: 'main', exercise: '0043', scheme: { sets: 3, repsMin: 8, repsMax: 12 } }] }] }] },
})
function CoverEditor({ p, set }) {
  const toast = useUI(s => s.toast)
  const [busy, setBusy] = useState(false)
  const onFile = async e => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setBusy(true)
    try { const id = await uploadImage(await resizeImageFile(file)); set({ coverImage: 'media:' + id, coverImageSource: p.coverImageSource || 'Uploaded by staff' }) }
    catch (err) { toast(err.message) }
    setBusy(false)
  }
  const focal = p.coverFocalPoint || { x: 50, y: 50 }
  const pick = e => { const r = e.currentTarget.getBoundingClientRect(); set({ coverFocalPoint: { x: Math.round((e.clientX - r.left) / r.width * 100), y: Math.round((e.clientY - r.top) / r.height * 100) } }) }
  return <section className="pm-cover-edit" aria-label={t('Cover')}>
    <div className="pm-sub-h">{t('Cover')}</div>
    <div onClick={pick} style={{ position: 'relative', cursor: 'crosshair' }} title={t('Click the picture to set the focal point')}>
      <PremiumCover p={p} ratio="16 / 10" />
      {p.coverImage && <span className="pm-focal" style={{ left: focal.x + '%', top: focal.y + '%' }} />}
    </div>
    <p className="dim small">{p.coverImage ? t('Click the picture to choose which part stays visible when it is cropped.') : t('No cover: members will see the Premium fallback art.')}</p>
    <label className="pm-field"><span>{t('Image URL (https) or app asset')}</span>
      <input className="pm-input" maxLength={420} value={p.coverImage || ''} onChange={e => set({ coverImage: e.target.value.trim() })} placeholder="https://" /></label>
    <div className="pm-actions">
      <label className="pm-ghost" style={{ cursor: 'pointer' }}><Icon name="plus" />{busy ? t('Uploading…') : t('Upload a photo')}<input type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} /></label>
      {p.coverImage && <button type="button" className="pm-ghost" onClick={() => set({ coverImage: '', coverImageAlt: '', coverFocalPoint: null })}>{t('Remove cover')}</button>}
    </div>
    <label className="pm-field"><span>{t('Alt text (describes the picture)')}</span><input className="pm-input" maxLength={200} value={p.coverImageAlt || ''} onChange={e => set({ coverImageAlt: e.target.value })} /></label>
    <label className="pm-field"><span>{t('Source (page where the image comes from)')}</span><input className="pm-input" maxLength={240} value={p.coverImageSource || ''} onChange={e => set({ coverImageSource: e.target.value })} /></label>
    <div className="pm-selects">
      <label className="pm-field"><span>{t('Licence')}</span><input className="pm-input" maxLength={80} value={p.coverImageLicense || ''} onChange={e => set({ coverImageLicense: e.target.value })} /></label>
      <label className="pm-field"><span>{t('Credit shown to members')}</span><input className="pm-input" maxLength={300} value={p.coverImageAttribution || ''} onChange={e => set({ coverImageAttribution: e.target.value })} /></label>
    </div>
  </section>
}
const lines = v => String(v || '').split('\n').map(x => x.trim()).filter(Boolean)

export function PremiumEditor() {
  const nav = useNavigate()
  const { id } = useParams()
  const toast = useUI(s => s.toast)
  const { c, admin } = useStaff()
  const [p, setP] = useState(null)
  const [json, setJson] = useState('')
  const [issues, setIssues] = useState([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (id === 'new') { const b = BLANK(); setP(b); setJson(JSON.stringify(b.programDefinition, null, 2)); return }
    c.detail(id).then(full => { setP(full); setJson(JSON.stringify(full.programDefinition, null, 2)) }).catch(e => toast(e.message))
  }, [id])   // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return <main className="pm-page"><div className="pm-empty"><b>{t('Loading…')}</b></div></main>
  const set = patch => setP(v => ({ ...v, ...patch }))
  const setCopy = (k, text) => set({ copy: { ...p.copy, [k]: lines(text) } })
  const build = () => {
    let def
    try { def = JSON.parse(json) } catch { return { error: t('The program definition is not valid JSON.') } }
    const { usage, setup, scope, status, featured, badge, order, version, createdBy, createdAt, updatedAt, updatedBy, publishedAt, sourceKind, seedChanged, ...rest } = p
    return { program: { ...rest, id: id === 'new' ? undefined : p.id, programDefinition: def } }
  }
  const submit = async dryRun => {
    const b = build(); if (b.error) { toast(b.error); return }
    setBusy(true)
    try {
      const r = await c.save(b.program, dryRun)
      setIssues([])
      toast(dryRun ? t('Valid: this program can be saved.') : t('Saved'))
      if (!dryRun) nav('/premium/manage')
      return r
    } catch (e) { setIssues(e.data?.issues || [e.message]) }
    finally { setBusy(false) }
  }
  const tag = k => set({ goalTags: p.goalTags.includes(k) ? p.goalTags.filter(x => x !== k) : [...p.goalTags, k] })
  const F = ({ label, children }) => <label className="pm-field"><span>{label}</span>{children}</label>
  return <main className="pm-page pm-editor">
    <header className="pm-head"><button className="pm-back" aria-label={t('Back')} onClick={() => nav('/premium/manage')}><Icon name="chevronLeft" /></button><div className="grow"><h1>{id === 'new' ? t('New program') : p.name}</h1></div></header>
    <F label={t('Name')}><input className="input" maxLength={80} value={p.name} onChange={e => set({ name: e.target.value })} /></F>
    <F label={t('Slug (address)')}><input className="input" maxLength={48} value={p.slug} onChange={e => set({ slug: e.target.value })} placeholder={t('generated from the name')} /></F>
    <F label={t('Short description')}><textarea className="input" maxLength={280} value={p.shortDescription} onChange={e => set({ shortDescription: e.target.value })} /></F>
    <F label={t('Long description')}><textarea className="input" maxLength={2400} value={p.longDescription} onChange={e => set({ longDescription: e.target.value })} /></F>
    <div className="pm-sub">{t('Goals')}</div>
    <div className="pm-filters" style={{ flexWrap: 'wrap' }}>{GOALS.map(g => <button key={g} type="button" className={'pm-filter' + (p.goalTags.includes(g) ? ' on' : '')} aria-pressed={p.goalTags.includes(g)} onClick={() => tag(g)}>{g}</button>)}</div>
    <div className="pm-selects">
      <F label={t('Level')}><select className="input" value={p.level} onChange={e => set({ level: e.target.value })}>{LEVELS.map(l => <option key={l} value={l}>{t(LEVEL_KEY[l])}</option>)}</select></F>
      <F label={t('Days per week')}><input className="input" type="number" min="1" max="7" value={p.daysPerWeek} onChange={e => set({ daysPerWeek: Number(e.target.value) })} /></F>
      <F label={t('Method type')}><select className="input" value={p.methodType} onChange={e => set({ methodType: e.target.value })}>{METHODS.map(m => <option key={m} value={m}>{m}</option>)}</select></F>
      <F label={t('Source')}><select className="input" value={p.sourceType} onChange={e => set({ sourceType: e.target.value })}>{SOURCES.map(m => <option key={m} value={m}>{m}</option>)}</select></F>
      <F label={t('Progression')}><select className="input" value={p.progressionModel} onChange={e => set({ progressionModel: e.target.value })}>{PROGRESSIONS.map(m => <option key={m} value={m}>{m}</option>)}</select></F>
      <F label={t('Duration / cycle')}><input className="input" maxLength={80} value={p.durationDescription} onChange={e => set({ durationDescription: e.target.value })} /></F>
    </div>
    <F label={t('Equipment (one per line)')}><textarea className="input" value={(p.equipmentRequirements || []).join('\n')} onChange={e => set({ equipmentRequirements: lines(e.target.value) })} /></F>
    <CoverEditor p={p} set={set} />
    <F label={t('Evidence and origin')}><textarea className="input" maxLength={900} value={p.evidenceSummary} onChange={e => set({ evidenceSummary: e.target.value })} /></F>
    <div className="pm-selects">
      <F label={t('Author / origin')}><input className="input" maxLength={120} value={p.author?.name || ''} onChange={e => set({ author: { ...(p.author || {}), name: e.target.value } })} /></F>
      <F label={t('Work / reference')}><input className="input" maxLength={120} value={p.author?.work || ''} onChange={e => set({ author: { ...(p.author || {}), work: e.target.value } })} /></F>
    </div>
    {admin && <F label={t('Legal review')}><select className="input" value={p.legal?.status || 'none'} onChange={e => set({ legal: { ...(p.legal || {}), status: e.target.value } })}><option value="none">{t('Not needed')}</option><option value="review">{t('Review pending')}</option><option value="cleared">{t('Cleared')}</option></select></F>}
    {[['howItWorks', 'How it works (one per line)'], ['forWhom', 'Who it is for (one per line)'], ['notIdealIf', 'Not ideal if… (one per line)'], ['tracking', 'What 2J tracks (one per line)']].map(([k, label]) =>
      <F key={k} label={t(label)}><textarea className="input" value={(p.copy?.[k] || []).join('\n')} onChange={e => setCopy(k, e.target.value)} /></F>)}
    <F label={t('Program definition (JSON)')}><textarea className="input code" spellCheck={false} value={json} onChange={e => setJson(e.target.value)} /></F>
    {issues.length > 0 && <div className="pm-issues" role="alert"><b>{t('Please fix:')}</b><ul>{issues.map(i => <li key={i}>{i}</li>)}</ul></div>}
    <div className="pm-actions wide"><button className="btn plain" disabled={busy} onClick={() => submit(true)}>{t('Validate')}</button><button className="btn primary" disabled={busy} onClick={() => submit(false)}>{t('Save')}</button></div>
  </main>
}
