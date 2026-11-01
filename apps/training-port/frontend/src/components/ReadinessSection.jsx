import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { uxOn } from '../lib/features.js'
import { t } from '../lib/i18n.js'
import { todayISO } from '../lib/format.js'
import { readinessView } from '../lib/readiness-view.js'
import { applyDeload, keepPlan, cancelDeload } from '../lib/fatigue.js'
import ReadinessCard from './ReadinessCard.jsx'

/* The member's readiness card (Home compact, Seguimiento full). Gated like the rest of the recovery features (admin OFF wins). The only writes are the member's
   own choices: accept the proposed deload, keep the plan, or go back to the normal plan — all on S.deload / S.deloadDismissed, never on a routine. */
export default function ReadinessSection({ compact = false }) {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  useStore(s => s.features)
  if (!uxOn(S, 'recovery')) return null
  const today = todayISO()
  const view = readinessView(S, today)
  const toast = m => useUI.getState().toast(m)
  return <ReadinessCard view={view} compact={compact} onDetails={compact ? () => nav('/seguimiento') : null}
    onApply={() => { update(s => { applyDeload(s, today, view.proposal, 'member') }); toast(t('Deload week started')) }}
    onKeep={() => { update(s => { keepPlan(s, today) }); toast(t('Plan kept')) }}
    onCancel={() => { update(s => { cancelDeload(s, today) }); toast(t('Back to your normal plan')) }} />
}
