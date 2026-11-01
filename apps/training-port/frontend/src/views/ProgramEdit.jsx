// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { ProgramHero } from '../components/DetailHeroes.jsx'
import { coverSheet } from '../components/CoverSheet.jsx'
import { useNavigate, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { uid, exCount, routineCount, DAYN, fmtDate } from '../lib/format.js'
import { t, nameFor } from '../lib/i18n.js'
import { glyphPicker, confirmSheet, routinePickerSheet, dayAssignSheet, dayMenuSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'
import { Button, Switch } from '../components/ui.jsx'
import { mediaUrl } from '../lib/media.js'
import { printProgram } from '../lib/plan-share.js'
import { programShare } from '../lib/shared-plans.js'
import { openPrivatePlanShare } from '../lib/open-private-share.jsx'
import { exOr } from '../lib/exercises.js'

// A program is a named folder of routine ids — see useStore.js's DEF.programs comment. This
// screen is the folder's contents: add an existing loose routine to it, build a new one
// straight into it, or take one back out (the routine itself is never touched either way).
export default function ProgramEdit() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const update = useStore(s => s.update)
  const p = (S.programs || []).find(x => x.id === id)
  useEffect(() => { if (!p) nav('/plan') }, [!!p])
  if (!p) return null

  const routines = (p.routineIds || []).map(rid => S.routines.find(r => r.id === rid)).filter(Boolean)
  const grouped = new Set((S.programs || []).flatMap(pr => pr.routineIds || []))
  const loose = S.routines.filter(r => !grouped.has(r.id))

  const patch = fn => update(s => { fn(s.programs.find(x => x.id === id)) })
  const rename = v => patch(pr => { pr.name = v })

  const addNew = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => {
      s.routines.push(r)
      s.programs.find(x => x.id === id).routineIds.push(r.id)
    })
    nav('/plan/r/' + r.id)
  }
  const addExisting = () => routinePickerSheet(loose, rid => patch(pr => {
    pr.routineIds = pr.routineIds || []
    if (!pr.routineIds.includes(rid)) pr.routineIds.push(rid)
  }))
  const removeFromProgram = rid => patch(pr => { pr.routineIds = (pr.routineIds || []).filter(x => x !== rid) })

  const deleteProgram = () => confirmSheet({
    title: t('Delete program?'),
    message: t('“{0}” will be removed — its routines stay, just no longer grouped together.', p.name),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => {
      update(s => {
        s.programs = s.programs.filter(x => x.id !== id)
        if (s.activeProgramId === id) s.activeProgramId = null
      })
      nav('/plan')
    }
  })

  return <>
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/plan')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 className="capitalize">{p.name}</h1><div className="sub">{routineCount(routines.length)}</div></div>
      <button className="iconbtn" aria-label={t('Send to a friend')} title={t('Send to a friend')} disabled={!routines.some(r => r.ex && r.ex.length)}
        onClick={() => openPrivatePlanShare(programShare(S, p), p.name)}><Icon name="send" /></button>
      <button className="iconbtn" aria-label={t('Print program')} title={t('Print program')} disabled={!routines.some(r => r.ex && r.ex.length)}
        onClick={() => printProgram(p, routines, user?.name || '', S.unit)}><Icon name="download" /></button>
    </div>

    {p.fromShare && <p className="rcv-origin"><Icon name="users" />{t('Sent by {0}', p.fromShare.senderLabel)} · {fmtDate(new Date(p.fromShare.createdAt).toISOString().slice(0, 10))}</p>}
    <ProgramHero p={p} S={S} onCover={() => coverSheet({ image: p.image, name: p.name, onChange: imgId => patch(pr => { if (imgId) pr.image = imgId; else delete pr.image }) })} />

    <div className="row" style={{ gap: 10, marginBottom: 16 }}>
      <button style={{ width: 52, height: 52, borderRadius: 14, fontSize: 26, flex: 'none', overflow: 'hidden', border: 'none', padding: 0 }}
        className={p.image ? '' : 'lrow-i'}
        onClick={() => glyphPicker(p.emoji, g => patch(pr => { pr.emoji = g }), { image: p.image, onImage: id => patch(pr => { pr.image = id }) })}>
        {p.image ? <img src={mediaUrl(p.image)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name={glyphOf(p.emoji)} />}
      </button>
      <input className="input" style={{ flex: 1 }} value={p.name} maxLength={40} onChange={e => rename(e.target.value)} placeholder={t('Program name')} />
    </div>

    <div className="item" style={{ marginBottom: 16 }}>
      <div className="grow"><div className="tt">{t('Active program this week')}</div><div className="ss">{t('Its own schedule below drives Home — only one program can be active at a time.')}</div></div>
      <Switch checked={S.activeProgramId === id} onChange={v => update(s => { s.activeProgramId = v ? id : null })} />
    </div>

    {routines.length ? <div className="list" style={{ marginBottom: 14 }}>
      {routines.map(r => <div key={r.id} className="item">
        {r.image
          ? <img src={mediaUrl(r.image)} alt="" style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'cover', flex: 'none' }} onClick={() => nav('/plan/r/' + r.id)} />
          : <span className="lrow-i" onClick={() => nav('/plan/r/' + r.id)}><Icon name={glyphOf(r.emoji)} /></span>}
        <div className="grow" onClick={() => nav('/plan/r/' + r.id)}><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <button className="iconbtn" aria-label={t('Remove from program')} onClick={() => removeFromProgram(r.id)}><Icon name="xmark" /></button>
      </div>)}
    </div> : <div className="empty" style={{ marginBottom: 14 }}><div className="ico"><Icon name="folder" /></div>{t('No routines in this program yet.')}</div>}

    {routines.length > 0 && <>
      <h4 className="sec">{t('Program schedule')}</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
        {[1, 2, 3, 4, 5, 6, 0].map(d => {
          const r = routines.find(x => x.id === (p.week || {})[d])
          return <div key={d} className="card daycard" onClick={() => r ? nav('/plan/r/' + r.id) : dayAssignSheet(d, id)}>
            <div className="row between" style={{ marginBottom: 8 }}>
              <div className="grow">
                <div className="tt" style={{ fontWeight: 600 }}>{t(DAYN[d])}</div>
                {r && <div className="ss">{r.name}</div>}
              </div>
              <button className="iconbtn" aria-label={t('More options')} title={t('More options')}
                onClick={ev => { ev.stopPropagation(); dayMenuSheet(d, id, r) }}><Icon name="moreH" /></button>
            </div>
            {r ? (
              r.ex.length ? <div className="daycard-exlist">
                {r.ex.map((e, i) => {
                  const ex = exOr(e.id)
                  return <div key={i} className="daycard-exrow">
                    <span className="daycard-exname capitalize">{nameFor(ex)}{ex.eq && <span className="dim"> ({t(ex.eq)})</span>}</span>
                    <span className="daycard-exsets">×{e.sets || 1}</span>
                  </div>
                })}
              </div> : <div className="dim small">{t('No exercises programmed yet.')}</div>
            ) : <div className="dim small">{t('Rest day')}</div>}
          </div>
        })}
      </div>
    </>}

    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <Button icon="plus" onClick={addNew}>{t('New routine')}</Button>
      {loose.length > 0 && <Button icon="folder" onClick={addExisting}>{t('Add existing routine')}</Button>}
    </div>
    <div style={{ height: 14 }} />
    <Button variant="danger" onClick={deleteProgram}>{t('Delete program')}</Button>
  </>
}
