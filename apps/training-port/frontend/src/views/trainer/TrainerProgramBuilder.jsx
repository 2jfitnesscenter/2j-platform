// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { exCount, DAYN } from '../../lib/format.js'
import { glyphOf, DEFAULT_GLYPH } from '../../lib/glyphs.js'
import { fetchMemberPlan, saveMemberProgram } from '../../lib/trainer-api.js'
import { programVersionsSheet } from '../../sheets.jsx'
import { coverSheet } from '../../components/CoverSheet.jsx'
import { mediaUrl } from '../../lib/media.js'
import { Button } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'

const emptyProgram = () => ({ id: null, name: t('New program'), emoji: DEFAULT_GLYPH, routineIds: [], week: {} })

// Local (non-global-store) equivalents of sheets.jsx's routinePickerSheet/dayAssignSheet —
// those two are hardwired to the trainer's OWN useStore program/routines, which doesn't exist
// here (the program being built lives on the member's plan, fetched via member-plan).
function pickRoutineSheet(options, onPick) {
  useUI.getState().openSheet(close => (
    <>
      <h3>{t('Add a routine')}</h3>
      <div className="list">
        {options.map(r => <div key={r.id} className="item" onClick={() => { close(); onPick(r.id) }}>
          <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
          <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount((r.ex || []).length)}</div></div>
        </div>)}
      </div>
    </>
  ))
}
function dayPickerSheet(day, routines, current, onPick) {
  useUI.getState().openSheet(close => (
    <>
      <h3>{t(DAYN[day])}</h3>
      <div className="list">
        <div className="item" onClick={() => { close(); onPick(null) }}>
          <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="moon" /></span>
          <div className="grow"><div className="tt">{t('Rest day')}</div></div>
          {!current && <Icon name="check" className="accent" />}
        </div>
        {routines.map(r => <div key={r.id} className="item" onClick={() => { close(); onPick(r.id) }}>
          <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
          <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount((r.ex || []).length)}</div></div>
          {current === r.id && <Icon name="check" className="accent" />}
        </div>)}
      </div>
    </>
  ))
}

// Groups a member's already-built routines into a scheduled program. Deliberately doesn't offer
// "create a new routine" inline — that stays on TrainerClientPlan/TrainerRoutineBuilder, so a
// routine is always built once and then optionally grouped here, same separation of concerns
// ProgramEdit.jsx/RoutineEdit.jsx already keep on mobile.
export default function TrainerProgramBuilder() {
  const nav = useNavigate()
  const { memberId, programId } = useParams()
  const toast = useUI(s => s.toast)
  const [allRoutines, setAllRoutines] = useState([])
  const [p, setP] = useState(null)
  const [busy, setBusy] = useState(false)
  const [sync, setSync] = useState(null)

  useEffect(() => {
    fetchMemberPlan(memberId).then(plan => {
      setSync(plan.sync)
      setAllRoutines(plan.routines || [])
      if (programId === 'new') { setP(emptyProgram()); return }
      const found = (plan.programs || []).find(x => x.id === programId)
      if (!found) { toast(t('That program no longer exists.')); nav('/trainer/' + memberId); return }
      setP({ ...found, routineIds: found.routineIds || [], week: found.week || {} })
    }).catch(e => toast(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, programId])

  if (!p) return <div id="trainer-app" />

  const routines = p.routineIds.map(rid => allRoutines.find(r => r.id === rid)).filter(Boolean)
  const loose = allRoutines.filter(r => !p.routineIds.includes(r.id))

  const addExisting = () => pickRoutineSheet(loose, rid => setP(cur => ({ ...cur, routineIds: [...cur.routineIds, rid] })))
  const removeRoutine = rid => setP(cur => ({
    ...cur, routineIds: cur.routineIds.filter(x => x !== rid),
    week: Object.fromEntries(Object.entries(cur.week).filter(([, v]) => v !== rid))
  }))
  const assignDay = day => dayPickerSheet(day, routines, p.week[day], rid => setP(cur => {
    const week = { ...cur.week }
    if (rid) week[day] = rid; else delete week[day]
    return { ...cur, week }
  }))

  const save = async () => {
    if (!p.name.trim()) { toast(t('Give the program a name')); return }
    if (!p.routineIds.length) { toast(t('Add at least one routine first.')); return }
    setBusy(true)
    try {
      const payload = { sync, memberId, name: p.name.trim(), emoji: p.emoji, routineIds: p.routineIds, week: p.week }
      if ('image' in p) payload.image = p.image || null   // the cover rides in the same authorised save; absent = the member's stays
      if (p.id) payload.programId = p.id
      const { programId: savedId, sync: savedSync } = await saveMemberProgram(payload)
      setP(cur => ({ ...cur, id: savedId }))
      setSync(savedSync)
      toast(t('Saved'))
    } catch (e) { toast(e.message) }
    setBusy(false)
  }

  return <div id="trainer-app">
    <div className="trainer-topbar">
      <a className="trainer-back" href={'#/trainer/' + memberId}><Icon name="chevronLeft" />{t('Back')}</a>
      <div style={{ flex: 1, margin: '0 12px', maxWidth: 360 }}>
        <input className="input" value={p.name} style={{ fontWeight: 600, fontSize: 20 }}
          onChange={e => setP(cur => ({ ...cur, name: e.target.value }))} />
      </div>
      <button className="iconbtn" aria-label={t('Change cover')} title={t('Change cover')} style={p.image ? { overflow: 'hidden', padding: 0 } : undefined}
        onClick={() => coverSheet({ image: p.image, name: p.name, onChange: id => setP(cur => ({ ...cur, image: id || null })) })}>
        {p.image ? <img src={mediaUrl(p.image)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="pencil" />}
      </button>
    </div>

    <div className="dim small" style={{ marginBottom: 14, maxWidth: 560 }}>
      {t('Build routines first from the member’s plan screen, then group them here.')}
    </div>

    {routines.length ? <div className="list" style={{ marginBottom: 14, maxWidth: 560 }}>
      {routines.map(r => <div key={r.id} className="item">
        <span className="lrow-i" onClick={() => nav('/trainer/' + memberId + '/r/' + r.id)}><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow" onClick={() => nav('/trainer/' + memberId + '/r/' + r.id)}><div className="tt">{r.name}</div><div className="ss">{exCount((r.ex || []).length)}</div></div>
        <button className="iconbtn" aria-label={t('Remove from program')} onClick={() => removeRoutine(r.id)}><Icon name="xmark" /></button>
      </div>)}
    </div> : <div className="empty" style={{ marginBottom: 14, maxWidth: 560 }}><div className="ico"><Icon name="folder" /></div>{t('No routines in this program yet.')}</div>}

    {routines.length > 0 && <>
      <h4 className="sec">{t('Program schedule')}</h4>
      <div className="list" style={{ display: 'flex', flexDirection: 'column', marginBottom: 14, maxWidth: 560 }}>
        {[1, 2, 3, 4, 5, 6, 0].map(d => {
          const r = routines.find(x => x.id === p.week[d])
          return <div key={d} className="item" onClick={() => assignDay(d)}>
            <div className="grow"><div className="tt">{t(DAYN[d])}</div></div>
            {r ? <span className="tag acc"><Icon name={glyphOf(r.emoji)} />{r.name}</span> : <span className="tag">{t('Rest')}</span>}
            <Icon name="chevronRight" className="chev" />
          </div>
        })}
      </div>
    </>}

    <div className="row" style={{ gap: 8, maxWidth: 560 }}>
      {loose.length > 0 && <Button icon="folder" onClick={addExisting}>{t('Add existing routine')}</Button>}
      {p.id && <Button icon="clock" onClick={() => programVersionsSheet(memberId, p.id)}>{t('Version history')}</Button>}
      <Button variant="primary" disabled={busy} onClick={save} icon="check">{t('Save')}</Button>
    </div>
  </div>
}
