// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { exOr, extractCustomDefs } from '../../lib/exercises.js'
import { uid } from '../../lib/format.js'
import { t, nameFor } from '../../lib/i18n.js'
import { supersetUnits, cleanupSg, exLine } from '../../lib/history.js'
import { supersetGroupInfo, supersetLabel } from '../../lib/superset-colors.js'
import { Thumb } from '../../components/Media.jsx'
import { coverSheet } from '../../components/CoverSheet.jsx'
import { mediaUrl } from '../../lib/media.js'
import { glyphPicker, exercisePicker, alternativesSheet, exConfigSheet, confirmSheet, exerciseMenuSheet, exerciseNotesSheet, supersetPickerSheet, routineVersionsSheet, ExercisePicker } from '../../sheets.jsx'
import Icon from '../../components/Icon.jsx'
import { glyphOf, DEFAULT_GLYPH } from '../../lib/glyphs.js'
import { Button, SelectRow } from '../../components/ui.jsx'
import { POLICIES_FOR, POLICY_NAME, POLICY_DESC } from '../../lib/progression.js'
import { fetchMemberPlan, saveMemberRoutine } from '../../lib/trainer-api.js'
import TrainingQualityPanel from '../../components/TrainingQualityPanel.jsx'
import SharedExerciseNote from '../../components/SharedExerciseNote.jsx'

const emptyRoutine = () => ({ id: null, name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] })

// Builds or edits ONE routine for a specific member. Same exercise-list/superset logic as
// views/RoutineEdit.jsx (add/reorder/superset link/exercise config are all copied from there
// verbatim — they're pure functions over an ex[] array, agnostic of whose routine it is), but
// operating on local component state instead of the global useStore (which is always the
// TRAINER's own profile, never the member's), and saving explicitly to the server instead of
// the automatic debounced pushState() the rest of the app uses.
export default function TrainerRoutineBuilder() {
  const nav = useNavigate()
  const { memberId, routineId } = useParams()
  // The trainer's OWN state — only used for the weight-unit label and as the source
  // exercisePicker/customExSheet already write into (see extractCustomDefs below).
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const [r, setR] = useState(null)
  const [busy, setBusy] = useState(false)
  const [sync, setSync] = useState(null)
  const [memberEquipment, setMemberEquipment] = useState(null)

  useEffect(() => {

    fetchMemberPlan(memberId).then(plan => {
      setSync(plan.sync)
      setMemberEquipment(plan.gym?.availableEquipment || null)
      if (routineId === 'new') { setR(emptyRoutine()); return }
      const found = (plan.routines || []).find(x => x.id === routineId)
      if (!found) { toast(t('That routine no longer exists.')); nav('/trainer/' + memberId); return }
      setR(found)
    }).catch(e => toast(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, routineId])

  if (!r) return <div id="trainer-app" />

  const edit = fn => setR(cur => { const next = { ...cur, ex: cur.ex.map(e => ({ ...e })) }; fn(next.ex); return next })
  const move = (i, dir) => edit(ex => { const j = i + dir; if (j < 0 || j >= ex.length) return;[ex[i], ex[j]] = [ex[j], ex[i]]; cleanupSg(ex) })
  const toggleLink = i => edit(ex => {
    if (i < 1) return
    const cur = ex[i], prev = ex[i - 1]
    if (cur.sg && prev.sg && cur.sg === prev.sg) delete cur.sg
    else { const gid = prev.sg || ('sg' + uid()); prev.sg = gid; cur.sg = gid }
    cleanupSg(ex)
  })
  const removeAt = i => edit(ex => { ex.splice(i, 1); cleanupSg(ex) })
  const excludeEx = exId => update(s => { if (!(s.excludedEx || []).includes(exId)) (s.excludedEx = s.excludedEx || []).push(exId) })
  const leaveSuperset = i => edit(ex => { delete ex[i].sg; cleanupSg(ex) })
  const joinSuperset = (i, j) => edit(ex => {
    const cur = ex[i]
    const target = ex.splice(j, 1)[0]
    const newI = j < i ? i - 1 : i
    ex.splice(newI + 1, 0, target)
    const gid = cur.sg || ('sg' + uid())
    ex[newI].sg = gid; target.sg = gid
    cleanupSg(ex)
  })

  const menuActions = (ex, e, i) => ({
    onReplace: () => alternativesSheet(ex, newEx => edit(x => { x[i] = { ...x[i], id: newEx.id } })),
    onReplaceExclude: () => alternativesSheet(ex, newEx => {
      edit(x => { x[i] = { ...x[i], id: newEx.id } })
      excludeEx(ex.id)
      toast(t('{0} won’t be suggested again', nameFor(ex)))
    }),
    onProgression: () => exConfigSheet(ex, e, cfg => edit(x => { x[i] = { id: x[i].id, sg: x[i].sg, ...cfg } }), () => removeAt(i), r),
    onSuperset: () => e.sg ? leaveSuperset(i) : supersetPickerSheet(r, i, j => joinSuperset(i, j)),
    onDropsetToggle: () => edit(x => { x[i].dropset = !x[i].dropset }),
    onNotes: () => exerciseNotesSheet(ex, e, note => edit(x => { if (note) x[i].note = note; else delete x[i].note })),
    onRemove: () => removeAt(i),
    onRemoveExclude: () => confirmSheet({
      title: t('Remove and don’t recommend?'), message: t('“{0}” leaves this routine and won’t be suggested to you again.', nameFor(ex)),
      confirmText: t('Remove'), danger: true, onConfirm: () => { removeAt(i); excludeEx(ex.id) }
    }),
  })

  const units = supersetUnits(r.ex)
  const unitFirst = new Set(units.filter(u => u.length > 1).map(u => u[0]))
  const inSS = new Set(units.filter(u => u.length > 1).flat())
  const ssInfo = supersetGroupInfo(r.ex)

  const save = async () => {
    if (!r.name.trim()) { toast(t('Give the routine a name')); return }
    if (!r.ex.length) { toast(t('Add at least one exercise first.')); return }
    setBusy(true)
    try {
      const payload = { sync, memberId, name: r.name.trim(), emoji: r.emoji, ex: r.ex, customExDefs: extractCustomDefs(r, S) }
      if ('image' in r) payload.image = r.image || null   // the cover rides in the same authorised save; absent = the member's stays
      if (r.id) payload.routineId = r.id
      if (r.prog) payload.prog = r.prog
      const { routineId: savedId, sync: savedSync } = await saveMemberRoutine(payload)
      setR(cur => ({ ...cur, id: savedId }))
      setSync(savedSync)
      toast(t('Saved'))
    } catch (e) { toast(e.message) }
    setBusy(false)
  }

  return <div id="trainer-app">
    <div className="trainer-topbar">
      <a className="trainer-back" href={'#/trainer/' + memberId}><Icon name="chevronLeft" />{t('Back')}</a>
      <div style={{ flex: 1, margin: '0 12px', maxWidth: 360 }}>
        <input className="input" value={r.name} style={{ fontWeight: 600, fontSize: 20 }}
          onChange={e => setR(cur => ({ ...cur, name: e.target.value }))} />
      </div>
      <button className="iconbtn" aria-label={t('Pick an icon')}
        onClick={() => glyphPicker(r.emoji, g => setR(cur => ({ ...cur, emoji: g })))}>
        <Icon name={glyphOf(r.emoji)} />
      </button>
      <button className="iconbtn" aria-label={t('Change cover')} title={t('Change cover')} style={r.image ? { overflow: 'hidden', padding: 0 } : undefined}
        onClick={() => coverSheet({ image: r.image, name: r.name, onChange: id => setR(cur => ({ ...cur, image: id || null })) })}>
        {r.image ? <img src={mediaUrl(r.image)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="pencil" />}
      </button>
    </div>

    <div className="builder-layout">
    <div className="builder-main">
    <TrainingQualityPanel routine={r} goal={r.meta?.goal || 'hypertrophy'} level={r.meta?.level} focus={r.meta?.focus} specialization={r.meta?.specialization} restrictions={r.meta?.restrictions || []} availableEquipment={memberEquipment} />
    <div className="sect-b" style={{ marginBottom: 16 }}>
      <SelectRow icon="chartLine" title={t('Progression')} sheetTitle={t('Progression')}
        value={r.prog || 'linear'} onChange={v => setR(cur => ({ ...cur, prog: v }))}
        options={POLICIES_FOR.reps.map(p => ({ value: p, label: t(POLICY_NAME[p]), subtitle: t(POLICY_DESC[p]) }))} />
    </div>

    {r.ex.length ? <div className="list">{r.ex.map((e, i) => {
      const ex = exOr(e.id)
      const linkedPrev = i > 0 && e.sg && r.ex[i - 1].sg === e.sg
      const info = ssInfo[i]
      const ssStyle = info ? { '--ss-color': `var(--${info.token})` } : undefined
      return <div key={i} style={ssStyle}>
        {unitFirst.has(i) && <div className="ss-label"><Icon name="link" />{t('Superset')}</div>}
        <div className={'item' + (inSS.has(i) ? ' in-ss' : '')} onClick={() => {
          exConfigSheet(ex, e, cfg => edit(x => { x[i] = { id: x[i].id, sg: x[i].sg, ...cfg } }), () => removeAt(i), r)
        }}>
          <Thumb ex={ex} />
          <div className="grow">
            <div className="tt capitalize">{info && <span className="ss-badge">{supersetLabel(info)}</span>}{nameFor(ex)}</div>
            <div className="ss">{exLine(e, S.unit)}{e.dropset && <span className="tag acc" style={{ marginLeft: 6 }}>{t('Dropset')}</span>}</div>
            {e.note && <div className="ss">{e.note}</div>}
            <SharedExerciseNote exerciseId={e.id} memberId={memberId} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 'none', alignItems: 'center' }}>
            <button className="iconbtn" aria-label={t('More options')} style={{ width: 32, height: 28, borderRadius: 8, fontSize: 15 }}
              onClick={ev => { ev.stopPropagation(); exerciseMenuSheet(ex, e, menuActions(ex, e, i)) }}><Icon name="moreH" /></button>
            {i > 0 && <button className={'iconbtn' + (linkedPrev ? ' on-ss' : '')} title={t('Superset with exercise above')} style={{ width: 32, height: 28, borderRadius: 8, fontSize: 15 }} onClick={ev => { ev.stopPropagation(); toggleLink(i) }}><Icon name="link" /></button>}
            <div style={{ display: 'flex', gap: 2 }}>
              <button className="iconbtn" aria-label={t('Move up')} style={{ width: 28, height: 24, borderRadius: 7, fontSize: 12 }} onClick={ev => { ev.stopPropagation(); move(i, -1) }}><Icon name="chevronUp" /></button>
              <button className="iconbtn" aria-label={t('Move down')} style={{ width: 28, height: 24, borderRadius: 7, fontSize: 12 }} onClick={ev => { ev.stopPropagation(); move(i, 1) }}><Icon name="chevronDown" /></button>
            </div>
          </div>
        </div>
      </div>
    })}</div> : <div className="empty"><div className="ico"><Icon name="dumbbell" /></div>{t('No exercises yet — pick one from the list on the right.')}</div>}

    <div className="small dim row" style={{ margin: '10px 2px', gap: 5 }}><Icon name="link" style={{ fontSize: 13 }} />{t('Tap the link button on an exercise to superset it with the one above — you’ll do them back-to-back.')}</div>
    </div>

    <div className="builder-side">
      <ExercisePicker close={() => {}} onPick={ex => exConfigSheet(ex, null, cfg => edit(x => { x.push({ id: ex.id, ...cfg }) }), null, r)} />
    </div>
    </div>

    <div style={{ height: 14 }} />
    <div className="row" style={{ gap: 8 }}>
      {r.id && <Button icon="clock" onClick={() => routineVersionsSheet(memberId, r.id)}>{t('Version history')}</Button>}
      <Button variant="primary" disabled={busy} onClick={save} icon="check">{t('Save')}</Button>
    </div>
  </div>
}
