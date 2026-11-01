// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Administration → Oposiciones: the profile catalogue. Create, edit, version, publish, hide and archive the official profiles (tests, minimum marks, scoring, official
// source and date). A change of tests, marks, scoring or source is saved as a NEW VERSION: the previous one is kept and a member's plan keeps the version it was built on.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { useOpposition } from '../lib/opposition-api.js'
import * as model from '../lib/opposition-model.js'
import { BODY_LABEL, CAP_LABEL, STATUS_PROFILE, DIFF_LABEL, KIND_LABEL } from '../lib/opposition-text.js'
import { fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import './premium.css'
import './opposition.css'

function useAdmin() {
  const user = useStore(s => s.user)
  const c = useOpposition()
  useEffect(() => { c.load(user?.id) }, [user?.id])   // eslint-disable-line react-hooks/exhaustive-deps
  return { c, admin: !!user?.admin, user }
}

export function OppositionManage() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const { c, admin } = useAdmin()
  const [busy, setBusy] = useState('')
  const run = async (key, fn, ok) => { setBusy(key); try { await fn(); if (ok) toast(t(ok)) } catch (e) { toast(e.message) } setBusy('') }
  const versions = async p => {
    const list = await c.history(p.id)
    openSheet(close => <div className="pm-sheet"><h3>{t('Versions')} · {p.name}</h3>
      <p className="dim small">{t('Current')}: v{p.version} · {fmtDate(p.source.date)} · {p.source.reference}</p>
      {!list.length && <p className="dim small">{t('No earlier versions yet.')}</p>}
      {list.map(v => <div key={v.at} className="pm-mgr-row"><span className="grow"><b>v{v.version}</b><small>{new Date(v.at).toLocaleString()} · {v.sourceDate ? fmtDate(v.sourceDate) : '—'} · {v.reference || ''}</small></span></div>)}
      <button className="pm-ghost full" onClick={close}>{t('Close')}</button></div>)
  }
  const remove = p => confirmSheet({ title: t('Delete this profile?'), message: t('Only profiles that were never published or used can be deleted. Otherwise archive it.'), confirmText: t('Delete'), danger: true,
    onConfirm: () => run(p.id, () => c.remove(p.id), 'Deleted') })
  if (!admin) return <main className="pm-page"><header className="pm-hero"><h1>{t('Only administrators manage the profiles')}</h1></header></main>
  return <main className="pm-page op-page">
    <header className="pm-hero"><div className="pm-hero-top"><button className="pm-back" aria-label={t('Back')} onClick={() => nav('/admin')}><Icon name="chevronLeft" /></button>
      <button className="pm-primary" onClick={() => nav('/oposiciones/manage/edit/new')}><Icon name="plus" />{t('New')}</button></div>
      <span className="pm-eyebrow">{t('ADMINISTRATION')}</span><h1>{t('Oposiciones')}</h1>
      <p>{t('Official profiles: tests, minimum marks and the source of each convocatoria. A changed convocatoria is a new version; running plans keep theirs.')}</p></header>
    <p className="pm-note"><Icon name="info" />{t('Members only see a profile once it is published, and only if the Oposiciones program is published in the Premium catalogue.')}</p>
    {c.status === 'loading' && <div className="pm-empty" role="status"><b>{t('Loading…')}</b></div>}
    <div className="op-admin-list">{c.profiles.map(p => <article key={p.id} className="op-admin-row" aria-label={p.name}>
      <div className="top"><div><b>{p.name}</b><br /><small>{t(BODY_LABEL[p.body] || 'Other')} · v{p.version} · {t(STATUS_PROFILE[p.status])}</small></div>
        <span className={'pm-badge ' + (p.status === 'published' ? 'green' : 'muted')}>{t(STATUS_PROFILE[p.status])}</span></div>
      <small>{t('Official source')}: {p.source.publication} · {p.source.reference} · {fmtDate(p.source.date)}</small>
      <small>{p.tests.length} {t('tests')} · {t('plans started')}: {p.usage?.started || 0}</small>
      <div className="op-admin-actions">
        <button className="pm-ghost" onClick={() => nav('/oposiciones/manage/edit/' + p.id)}><Icon name="pencil" />{t('Edit')}</button>
        {p.status !== 'published' && p.status !== 'archived' && <button className="pm-primary" disabled={busy === p.id} onClick={() => run(p.id, () => c.setStatus(p.id, 'published'), 'Published')}>{t('Publish')}</button>}
        {p.status === 'published' && <button className="pm-ghost" disabled={busy === p.id} onClick={() => run(p.id, () => c.setStatus(p.id, 'hidden'), 'Hidden')}>{t('Hide')}</button>}
        {p.status !== 'archived' && <button className="pm-ghost" disabled={busy === p.id} onClick={() => run(p.id, () => c.setStatus(p.id, 'archived'), 'Archived')}>{t('Archive')}</button>}
        {p.status === 'archived' && <button className="pm-ghost" disabled={busy === p.id} onClick={() => run(p.id, () => c.setStatus(p.id, 'draft'), 'Restored')}>{t('Restore')}</button>}
        <button className="pm-ghost" onClick={() => versions(p)}>{t('Versions')}</button>
        {p.sourceKind === 'custom' && <button className="pm-ghost danger" onClick={() => remove(p)}>{t('Delete')}</button>}
      </div></article>)}</div>
  </main>
}

/* ------------------------------------------------------------------------------------------------ editor */
const marksToText = marks => Object.entries(marks || {}).map(([k, s]) => `${k}: ${model.formatScale(s)}`).join('\n')
function textToMarks(text) {
  const out = {}
  for (const line of String(text || '').split('\n').map(x => x.trim()).filter(Boolean)) {
    const i = line.indexOf(':')
    if (i < 1) return null
    const scale = model.parseScale(line.slice(i + 1))
    if (!scale) return null
    out[line.slice(0, i).trim()] = scale
  }
  return Object.keys(out).length ? out : null
}
const bandsToText = b => (b || []).map(x => `${x.id}: ${x.label}: ${x.from}-${x.to}`).join('\n')
function textToBands(text) {
  const rows = String(text || '').split('\n').map(x => x.trim()).filter(Boolean).map(l => { const m = /^([a-z0-9]{1,8})\s*:\s*(.+?)\s*:\s*(\d+)\s*-\s*(\d+)$/.exec(l); return m ? { id: m[1], label: m[2], from: Number(m[3]), to: Number(m[4]) } : null })
  return rows.length && rows.every(Boolean) ? rows : null
}
const BLANK = () => ({
  name: '', slug: '', body: 'bomberos', organism: '', convocatoria: { title: '', plazas: null, year: new Date().getFullYear(), reference: '' },
  source: { kind: 'official', organism: '', document: '', publication: '', date: '', reference: '' }, validFrom: '', validUntil: '',
  scoring: { model: 'points', maxPoints: 10, minPoints: 5, referencePoints: 5, rule: { kind: 'all-min' } }, categories: { bySex: true, ageBands: null },
  tests: [], notes: [], askBeforeStart: ['organism', 'convocatoria'],
})
const F = ({ label, children }) => <label className="pm-field"><span>{label}</span>{children}</label>
const BLANK_TEST = () => ({ id: '', name: '', capacity: 'endurance', movement: 'run', kind: 'time', unit: 's', description: '', marks: { m: [], f: [] } })

export function OppositionEditor() {
  const nav = useNavigate()
  const { id } = useParams()
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const { c, admin } = useAdmin()
  const [p, setP] = useState(null)
  const [texts, setTexts] = useState({})
  const [issues, setIssues] = useState([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (id === 'new') { setP(BLANK()); return }
    c.detail(id).then(full => { setP({ ...full, tests: full.tests.map(x => ({ ...x, _marks: marksToText(x.marks) })) }); setTexts({ __bands: bandsToText(full.categories.ageBands), __notes: (full.notes || []).join('\n') }) }).catch(e => setIssues([e.message]))
  }, [id])   // eslint-disable-line react-hooks/exhaustive-deps
  if (!admin) return <main className="pm-page"><header className="pm-hero"><h1>{t('Only administrators manage the profiles')}</h1></header></main>
  if (!p) return <main className="pm-page"><header className="pm-hero"><h1>{issues[0] || t('Loading…')}</h1></header></main>
  const set = patch => setP(v => ({ ...v, ...patch }))
  const setIn = (key, patch) => setP(v => ({ ...v, [key]: { ...v[key], ...patch } }))
  const setTest = (i, patch) => setP(v => ({ ...v, tests: v.tests.map((x, j) => (j === i ? { ...x, ...patch } : x)) }))
  const build = () => {
    const bands = texts.__bands?.trim() ? textToBands(texts.__bands) : null
    if (texts.__bands?.trim() && !bands) { setIssues([t('Age bands: one per line as id: label: from-to (e.g. u35: Under 35: 0-34)')]); return null }
    const tests = []
    for (const x of p.tests) {
      const marks = textToMarks(x._marks ?? marksToText(x.marks))
      if (!marks) { setIssues([t('Marks of "{0}": one line per category as key: points=value, … (e.g. m: 5=8, 6=10)', x.name || x.id)]); return null }
      const { _marks, ...clean } = x
      tests.push({ ...clean, marks, distanceM: x.distanceM === '' ? undefined : x.distanceM, durationS: x.durationS === '' ? undefined : x.durationS })
    }
    return { ...p, tests, categories: { bySex: !!p.categories.bySex, ageBands: bands }, notes: String(texts.__notes ?? (p.notes || []).join('\n')).split('\n').map(x => x.trim()).filter(Boolean), validFrom: p.validFrom || null, validUntil: p.validUntil || null }
  }
  const save = async () => {
    const out = build(); if (!out) return
    setBusy(true); setIssues([])
    try {
      const dry = await useOpposition.getState().save(out, true)
      const go = async () => { const r = await useOpposition.getState().save(out); toast(r.newVersion ? t('Saved as version {0}', r.profile.version) : t('Saved')); nav('/oposiciones/manage') }
      if (dry.newVersion) openSheet(close => <div className="pm-sheet"><h3>{t('This creates a new version')}</h3>
        <p className="dim small">{t('Running plans keep the version they were built on; members are offered the new one and decide.')}</p>
        <ul className="op-changes">{dry.changes.map((d, i) => <li key={i}><Icon name="info" />{t(DIFF_LABEL[d.kind])}{d.test ? ': ' + d.test : ''}</li>)}</ul>
        <button className="pm-primary" onClick={() => { close(); go() }}>{t('Save new version')}</button><button className="pm-ghost full" onClick={close}>{t('Cancel')}</button></div>)
      else await go()
    } catch (e) { setIssues(e.data?.issues || [e.message]) }
    setBusy(false)
  }
  return <main className="pm-page op-page op-edit">
    <header className="pm-hero"><div className="pm-hero-top"><button className="pm-back" aria-label={t('Back')} onClick={() => nav('/oposiciones/manage')}><Icon name="chevronLeft" /></button></div>
      <h1>{id === 'new' ? t('New profile') : p.name}</h1>{id !== 'new' && <p>v{p.version} · {t(STATUS_PROFILE[p.status])}</p>}</header>
    {issues.length > 0 && <div className="op-issues" role="alert"><b>{t('Please fix:')}</b><ul>{issues.map(i => <li key={i}>{i}</li>)}</ul></div>}
    <section className="pm-sec"><h2>{t('The exam')}</h2><div className="pm-sec-body">
      <F label={t('Name')}><input className="pm-input" value={p.name} maxLength={120} onChange={e => set({ name: e.target.value })} /></F>
      <F label={t('Body')}><select className="pm-input" value={p.body} onChange={e => set({ body: e.target.value })}>{model.BODIES.map(b => <option key={b} value={b}>{t(BODY_LABEL[b])}</option>)}</select></F>
      <F label={t('Organism')}><input className="pm-input" value={p.organism} maxLength={160} onChange={e => set({ organism: e.target.value })} /></F>
      <F label={t('Convocatoria')}><input className="pm-input" value={p.convocatoria?.title || ''} maxLength={200} onChange={e => setIn('convocatoria', { title: e.target.value })} /></F>
      <F label={t('Convocatoria reference')}><input className="pm-input" value={p.convocatoria?.reference || ''} maxLength={300} onChange={e => setIn('convocatoria', { reference: e.target.value })} /></F>
      <div className="op-grid"><F label={t('Plazas')}><input className="pm-input" type="number" value={p.convocatoria?.plazas ?? ''} onChange={e => setIn('convocatoria', { plazas: e.target.value === '' ? null : Number(e.target.value) })} /></F>
        <F label={t('Year')}><input className="pm-input" type="number" value={p.convocatoria?.year ?? ''} onChange={e => setIn('convocatoria', { year: e.target.value === '' ? null : Number(e.target.value) })} /></F></div>
    </div></section>
    <section className="pm-sec"><h2>{t('Official source')}</h2><div className="pm-sec-body">
      <p className="dim small">{t('Only official publications (BOE, BOC, BOP or the organism itself). Blogs and academies are never a source.')}</p>
      <F label={t('Issuing organism')}><input className="pm-input" value={p.source.organism} maxLength={200} onChange={e => setIn('source', { organism: e.target.value })} /></F>
      <F label={t('Document')}><input className="pm-input" value={p.source.document || ''} maxLength={300} onChange={e => setIn('source', { document: e.target.value })} /></F>
      <F label={t('Publication')}><input className="pm-input" value={p.source.publication || ''} maxLength={200} onChange={e => setIn('source', { publication: e.target.value })} /></F>
      <F label={t('Reference (BOE-A-…, BOC-A-…, BOP nº …)')}><input className="pm-input" value={p.source.reference} maxLength={300} onChange={e => setIn('source', { reference: e.target.value })} /></F>
      <div className="op-grid"><F label={t('Source date')}><input className="pm-input" type="date" value={p.source.date} onChange={e => setIn('source', { date: e.target.value })} /></F>
        <F label={t('Valid from')}><input className="pm-input" type="date" value={p.validFrom || ''} onChange={e => set({ validFrom: e.target.value })} /></F>
        <F label={t('Valid until')}><input className="pm-input" type="date" value={p.validUntil || ''} onChange={e => set({ validUntil: e.target.value })} /></F></div>
    </div></section>
    <section className="pm-sec"><h2>{t('Scoring and categories')}</h2><div className="pm-sec-body">
      <div className="op-grid"><F label={t('Scoring')}><select className="pm-input" value={p.scoring.model} onChange={e => setIn('scoring', { model: e.target.value })}><option value="points">{t('Points')}</option><option value="pass-fail">{t('Pass / fail')}</option></select></F>
        <F label={t('Pass rule')}><select className="pm-input" value={p.scoring.rule?.kind} onChange={e => setIn('scoring', { rule: { ...p.scoring.rule, kind: e.target.value } })}><option value="all-min">{t('Every test at its minimum')}</option><option value="average">{t('Average of the tests')}</option></select></F>
        {p.scoring.rule?.kind === 'average' && <F label={t('Minimum average')}><input className="pm-input" type="number" value={p.scoring.rule.min ?? ''} onChange={e => setIn('scoring', { rule: { ...p.scoring.rule, min: Number(e.target.value) } })} /></F>}
        <F label={t('Minimum points')}><input className="pm-input" type="number" value={p.scoring.minPoints ?? ''} onChange={e => setIn('scoring', { minPoints: Number(e.target.value) })} /></F>
        <F label={t('Reference points')}><input className="pm-input" type="number" value={p.scoring.referencePoints ?? ''} onChange={e => setIn('scoring', { referencePoints: Number(e.target.value) })} /></F></div>
      <label className="op-check"><input type="checkbox" checked={!!p.categories.bySex} onChange={e => setIn('categories', { bySex: e.target.checked })} />{t('The marks depend on sex')}</label>
      <F label={t('Age bands (optional)')}><textarea className="pm-input" value={texts.__bands ?? bandsToText(p.categories.ageBands)} onChange={e => setTexts(v => ({ ...v, __bands: e.target.value }))} placeholder="u35: Under 35: 0-34" /></F>
      <F label={t('Ask the member before starting')}><span className="op-chips">{['organism', 'convocatoria', 'testVersion'].map(k => <button type="button" key={k} className={'op-chip' + (p.askBeforeStart?.includes(k) ? ' on' : '')} aria-pressed={!!p.askBeforeStart?.includes(k)} onClick={() => set({ askBeforeStart: p.askBeforeStart?.includes(k) ? p.askBeforeStart.filter(x => x !== k) : [...(p.askBeforeStart || []), k] })}>{k}</button>)}</span></F>
      <F label={t('Notes (one per line)')}><textarea className="pm-input" value={texts.__notes ?? (p.notes || []).join('\n')} onChange={e => setTexts(v => ({ ...v, __notes: e.target.value }))} /></F>
    </div></section>
    <section className="pm-sec"><h2>{t('Tests')}</h2><div className="pm-sec-body">
      {p.tests.map((x, i) => <div key={i} className="op-test">
        <div className="op-grid">
          <F label={t('Id')}><input className="pm-input" value={x.id} maxLength={32} onChange={e => setTest(i, { id: e.target.value })} /></F>
          <F label={t('Name')}><input className="pm-input" value={x.name} maxLength={100} onChange={e => setTest(i, { name: e.target.value })} /></F>
          <F label={t('Capacity')}><select className="pm-input" value={x.capacity} onChange={e => setTest(i, { capacity: e.target.value })}>{model.CAPACITIES.map(k => <option key={k} value={k}>{t(CAP_LABEL[k])}</option>)}</select></F>
          <F label={t('Movement')}><select className="pm-input" value={x.movement} onChange={e => setTest(i, { movement: e.target.value })}>{model.MOVEMENTS.map(k => <option key={k} value={k}>{k}</option>)}</select></F>
          <F label={t('Kind')}><select className="pm-input" value={x.kind} onChange={e => setTest(i, { kind: e.target.value })}>{Object.keys(model.KINDS).map(k => <option key={k} value={k}>{t(KIND_LABEL[k])}</option>)}</select></F>
          <F label={t('Unit')}><input className="pm-input" value={x.unit} maxLength={12} onChange={e => setTest(i, { unit: e.target.value })} /></F>
          <F label={t('Distance (m)')}><input className="pm-input" type="number" value={x.distanceM ?? ''} onChange={e => setTest(i, { distanceM: e.target.value === '' ? '' : Number(e.target.value) })} /></F>
          <F label={t('Duration (s)')}><input className="pm-input" type="number" value={x.durationS ?? ''} onChange={e => setTest(i, { durationS: e.target.value === '' ? '' : Number(e.target.value) })} /></F>
          <F label={t('Only for')}><select className="pm-input" value={(x.only || []).join('') || 'both'} onChange={e => setTest(i, { only: e.target.value === 'both' ? undefined : [e.target.value] })}><option value="both">{t('Everyone')}</option><option value="m">{t('Male')}</option><option value="f">{t('Female')}</option></select></F>
        </div>
        <F label={t('Description')}><textarea className="pm-input" value={x.description || ''} maxLength={700} onChange={e => setTest(i, { description: e.target.value })} /></F>
        <F label={t('Marks: one line per category as key: points=value, …')}><textarea className="pm-input op-scale" value={x._marks ?? marksToText(x.marks)} onChange={e => setTest(i, { _marks: e.target.value })} /></F>
        <button className="pm-ghost danger" onClick={() => setP(v => ({ ...v, tests: v.tests.filter((_, j) => j !== i) }))}>{t('Remove test')}</button>
      </div>)}
      <button className="pm-ghost" onClick={() => setP(v => ({ ...v, tests: [...v.tests, BLANK_TEST()] }))}><Icon name="plus" />{t('Add test')}</button>
    </div></section>
    <div className="pm-actions"><button className="pm-primary" disabled={busy} onClick={save}>{t('Save')}</button></div>
  </main>
}
