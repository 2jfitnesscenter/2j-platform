// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { MUSCLES, MUSCLE_LABEL } from '../lib/muscle-priority.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Section } from '../components/ui.jsx'

/* Training priorities, on a screen of their own (Profile → Training priorities). Exactly what used to sit unfolded in Profile:
   the same two pickers (up to 2 priority muscles, up to 3 more), saved the same way (S.priorityMuscles / S.secondaryMuscles,
   one a primary excludes it from the other). Only where it lives changed. */
export default function TrainingPriorities() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  return <div className="narrow">
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/profile')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div><h1>{t('Training priorities')}</h1></div></div>
    <Section footer={t('Optional. The quick plan and the AI Coach give these a little more work than the rest.')}>
      <div style={{ padding: '2px 16px 4px' }}>
        <div className="dim small" style={{ marginBottom: 6 }}>{t('What do you want to prioritize? (up to 2)')}</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 7 }}>
          {MUSCLES.map(m => <button key={m} className={'chip' + ((S.priorityMuscles || []).includes(m) ? ' on' : '')}
            onClick={() => update(s => {
              const v = s.priorityMuscles || []
              s.priorityMuscles = v.includes(m) ? v.filter(x => x !== m) : v.length < 2 ? [...v, m] : v
              s.secondaryMuscles = (s.secondaryMuscles || []).filter(x => x !== m)
            })}>{t(MUSCLE_LABEL[m])}</button>)}
        </div>
        <div className="dim small" style={{ margin: '12px 0 6px' }}>{t('Anything else? (up to 3)')}</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 7 }}>
          {MUSCLES.map(m => {
            const isPrimary = (S.priorityMuscles || []).includes(m)
            return <button key={m} className={'chip' + ((S.secondaryMuscles || []).includes(m) ? ' on' : '')}
              disabled={isPrimary} style={isPrimary ? { opacity: .35 } : undefined}
              onClick={() => update(s => {
                const v = s.secondaryMuscles || []
                s.secondaryMuscles = v.includes(m) ? v.filter(x => x !== m) : v.length < 3 ? [...v, m] : v
                s.priorityMuscles = (s.priorityMuscles || []).filter(x => x !== m)
              })}>{t(MUSCLE_LABEL[m])}</button>
          })}
        </div>
      </div>
    </Section>
  </div>
}
