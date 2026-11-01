// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The kept versions of one official routine, program or collection (admins only): the last ten the item had before an edit, each with what it
// held, and a way to put one back. Restoring goes through the normal validated save, so a version that no longer holds is refused with the usual reason.
import { useEffect, useState } from 'react'
import { useUI } from '../../../store/useUI.js'
import { t, dateLocale } from '../../../lib/i18n.js'
import { useGuided } from '../../../lib/guided-api.js'
import { confirmSheet } from '../../../sheets.jsx'
import Icon from '../../../components/Icon.jsx'
import { STATUS_LABEL } from '../../../lib/studio.js'

const when = iso => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' }) }
export const versionLine = v => [
  v.name || null,
  v.exercises != null ? t('{0} exercises', v.exercises) : v.weeks != null ? t('{0} weeks', v.weeks) : v.routines != null ? t('{0} workouts', v.routines) : null,
  t(STATUS_LABEL[v.status] || v.status),
].filter(Boolean).join(' · ')

export function HistorySheet({ id, close }) {
  const g = useGuided()
  const toast = useUI(s => s.toast)
  const [versions, setVersions] = useState(null)
  useEffect(() => { g.history(id).then(setVersions).catch(() => setVersions([])) }, [id])
  const restore = v => confirmSheet({
    title: t('Restore this version?'), message: t('The current content is kept as a version too, so you can come back to it.'), confirmText: t('Restore'),
    onConfirm: async () => {
      try { await g.restore(id, v.at); toast(t('Version restored')); close(); window.location.reload() }   // the editor re-reads the item it was opened on
      catch (e) { toast(e.message || t('Could not restore this version')) }
    },
  })
  return <>
    <h3>{t('Version history')}</h3>
    <p className="muted small">{t('The last ten versions this item had before an edit. Featuring, order and badges are not versions.')}</p>
    {versions === null && <div className="muted small">{t('Loading…')}</div>}
    {versions && !versions.length && <div className="muted small">{t('No earlier versions yet — a version is kept the first time this item is edited.')}</div>}
    {versions && versions.map(v => <div className="row between" key={v.at} style={{ padding: '8px 0', gap: 10, alignItems: 'center' }}>
      <span style={{ minWidth: 0 }}><b className="small">{when(v.at)}</b><br /><span className="muted small">{versionLine(v)}</span></span>
      <button className="btn plain" onClick={() => restore(v)}>{t('Restore')}</button>
    </div>)}
  </>
}

export function HistoryButton({ id }) {
  const openSheet = useUI(s => s.openSheet)
  if (!id) return null
  return <button className="btn plain" onClick={() => openSheet(close => <HistorySheet id={id} close={close} />)}><Icon name="history" />{t('Version history')}</button>
}
