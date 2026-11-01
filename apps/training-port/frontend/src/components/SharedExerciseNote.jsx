// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { NOTE_MAX, saveNote, useExerciseNote } from '../lib/exercise-notes.js'
import Icon from './Icon.jsx'

// The note shared by the member and the staff for ONE exercise (not tied to a routine). Empty = a single quiet "Note" link; with text = the text itself,
// tap to edit. `memberId` is only passed by staff (their view of that member); the member's own screens omit it.
export default function SharedExerciseNote({ exerciseId, memberId }) {
  const { note } = useExerciseNote(memberId, exerciseId)
  const toast = useUI(s => s.toast)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const stop = e => e.stopPropagation()

  const open = () => { setDraft(note?.text || ''); setEditing(true) }
  const commit = async text => {
    setBusy(true)
    try { await saveNote(memberId, exerciseId, text); setEditing(false) } catch (e) { toast(e.message) }
    setBusy(false)
  }

  if (!editing) {
    return <div className="sx-note" onClick={stop}>
      {note
        ? <button type="button" className="sx-note-text" onClick={open} aria-label={t('Edit note')}><Icon name="clipboard" /><span>{note.text}</span></button>
        : <button type="button" className="sx-note-add" onClick={open}><Icon name="plus" />{t('Note')}</button>}
    </div>
  }
  return <div className="sx-note editing" onClick={stop}>
    <textarea className="input" rows={2} maxLength={NOTE_MAX} autoFocus value={draft} aria-label={t('Note')}
      placeholder={t('Setup, cues, anything you want to remember for this exercise')} onChange={e => setDraft(e.target.value)} />
    <div className="sx-note-actions">
      <button type="button" className="btn primary sm" disabled={busy} onClick={() => commit(draft)}>{t('Save')}</button>
      {note && <button type="button" className="btn plain danger sm" disabled={busy} onClick={() => commit('')}>{t('Delete')}</button>}
      <button type="button" className="btn plain sm" disabled={busy} onClick={() => setEditing(false)}>{t('Cancel')}</button>
    </div>
  </div>
}
