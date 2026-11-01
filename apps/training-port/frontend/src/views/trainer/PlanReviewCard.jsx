// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { exLine } from '../../lib/history.js'
import { exName } from '../../lib/coach.js'
import { fetchMemberPlan, saveMemberRoutine, saveMemberProgram } from '../../lib/trainer-api.js'
import { applyPendingChoice } from '../../lib/routine-scan.js'
import { Button, Check, Switch } from '../../components/ui.jsx'
import PendingExerciseChoices from '../../components/PendingExerciseChoices.jsx'
import Topbar from './Topbar.jsx'
import { AiProtocolNote } from '../../components/constructor/parts.jsx'

// A proposed plan bundle {name, summary?, basedOn?, routines:[{id,name,emoji,ex,why?}], week,
// customEx, pendingChoices?} — same shape whether it came from the AI-generate job
// (TrainerAIGenerate.jsx, which never has pendingChoices — the AI resolves its own exercise ids)
// or a scanned routine (TrainerScanRoutine.jsx, which can) — reviewed per-routine (include/
// exclude) and saved via the same trainer/member-routine + member-program endpoints either flow
// already used before this was pulled out into its own file.
export default function PlanReviewCard({ memberId, bundle: initialBundle, onBack, onDiscard, onSaved }) {
  const toast = useUI(s => s.toast)
  const [b, setB] = useState(initialBundle)
  const [included, setIncluded] = useState(() => new Set(initialBundle.routines.map(r => r.id)))
  const [schedule, setSchedule] = useState(Object.keys(initialBundle.week || {}).length > 0)
  const [saving, setSaving] = useState(false)
  const toggle = id => setIncluded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const choose = (exId, chosenId) => setB(bundle => applyPendingChoice(bundle, exId, chosenId))

  const save = async () => {
    const picked = b.routines.filter(r => included.has(r.id))
    if (!picked.length) { toast(t('Pick at least one routine')); return }
    setSaving(true)
    try {
      const idMap = {}
      let sync = (await fetchMemberPlan(memberId)).sync
      for (const r of picked) {
        const customExDefs = (b.customEx || []).filter(c => r.ex.some(e => e.id === c.id))
        const res = await saveMemberRoutine({ sync, memberId, name: r.name, emoji: r.emoji, ex: r.ex, customExDefs, prog: r.prog, blocks: r.blocks,
          meta: b.protocol ? { goal: b.protocol.goal, level: b.protocol.level } : undefined })
        idMap[r.id] = res.routineId
        sync = res.sync
      }
      if (schedule && picked.length > 1) {
        const week = {}
        Object.entries(b.week || {}).forEach(([d, rid]) => { if (idMap[rid]) week[d] = idMap[rid] })
        if (Object.keys(week).length) {
          await saveMemberProgram({ sync, memberId, name: b.name, emoji: 'sparkles', routineIds: Object.values(idMap), week })
        }
      }
      await onSaved()
      toast(t('Saved'))
      window.location.hash = '#/trainer/' + memberId
    } catch (e) { toast(e.message || t('Could not save')) }
    setSaving(false)
  }

  return <div id="trainer-app">
    <Topbar title={t('Review the draft')} onBack={onBack} />
    <AiProtocolNote protocol={b.protocol} />

    {!!b.summary && <div className="card"><div className="muted small" style={{ lineHeight: 1.55 }}>{b.summary}</div>
      {!!b.basedOn && <div className="dim small" style={{ marginTop: 8 }}>{b.basedOn}</div>}</div>}

    <PendingExerciseChoices pendingChoices={b.pendingChoices || []} onChoose={choose} />

    {b.routines.map(r => <div key={r.id} className="card" style={!included.has(r.id) ? { opacity: .5 } : undefined}>
      <div className="row between" style={{ marginBottom: 4 }}>
        <div className="row" style={{ gap: 10 }}>
          <Check checked={included.has(r.id)} onChange={() => toggle(r.id)} />
          <h2 style={{ margin: 0 }}>{r.emoji} {r.name}</h2>
        </div>
        <span className="dim small">{t('{0} exercises', r.ex.length)}</span>
      </div>
      {!!r.why && <div className="dim small" style={{ marginBottom: 10, lineHeight: 1.5 }}>{r.why}</div>}
      {r.ex.map((e, i) => <div key={i} style={{ padding: '8px 0', borderTop: i ? '1px solid var(--sep)' : 'none' }}>
        <div className="row between">
          <span className="small capitalize" style={{ fontWeight: 500 }}>{exName(e.id)}</span>
          <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{exLine(e, 'kg')}</span>
        </div>
        {!!e.why && <div className="dim" style={{ fontSize: '.72rem', marginTop: 3, lineHeight: 1.4 }}>{e.why}</div>}
      </div>)}
    </div>)}

    {Object.keys(b.week || {}).length > 0 && <div className="card">
      <div className="row between">
        <div style={{ minWidth: 0 }}>
          <div className="lrow-t">{t('Group into a scheduled program')}</div>
          <div className="lrow-s">{t('Groups the included routines into a new program with the AI’s suggested weekly schedule.')}</div>
        </div>
        <Switch checked={schedule} onChange={setSchedule} />
      </div>
    </div>}

    <div className="row" style={{ gap: 10 }}>
      <Button variant="primary" icon="check" disabled={saving} onClick={save} style={{ flex: 1 }}>{t('Save selected')}</Button>
      <Button danger disabled={saving} onClick={onDiscard}>{t('Discard')}</Button>
    </div>
  </div>
}
