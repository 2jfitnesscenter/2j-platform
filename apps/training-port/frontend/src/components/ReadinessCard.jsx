import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { STATE_LABEL, STATE_HINT, reasonLine } from '../lib/readiness-view.js'
import Icon from './Icon.jsx'
import { Surface } from './v2.jsx'
import { Button } from './ui.jsx'

/* Today's readiness: one of four states, the real reasons behind it, and — only when fatigue has stayed high across several signals — a deload PROPOSAL the
   member can accept or decline. An accepted deload is a one-week, reversible adjustment applied when sessions are built; the routines are never changed. */
export default function ReadinessCard({ view, onApply, onKeep, onCancel, onDetails, compact = false }) {
  const { readiness: r, proposal, active } = view
  if (!r && !proposal && !active) return null
  const reasons = (r?.reasons || []).map(reasonLine).filter(Boolean).slice(0, compact ? 2 : 3)
  return <Surface className={'v3-rd ' + (r?.state || '')} role="status" aria-label={t('Readiness')}>
    <div className="row between"><div className="v2-eyebrow"><Icon name="heart" /> {t('Today’s readiness')}</div>
      {r?.score != null && <span className="v3-rd-score" aria-label={t('Readiness score')}>{r.score}<small>/100</small></span>}</div>
    {r && <div className="v3-rd-state"><b>{t(STATE_LABEL[r.state])}</b></div>}
    {reasons.length > 0 && <ul className="v3-rd-why">{reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>}
    {r && !proposal && !active && <p className="v3-rd-hint small dim">{t(STATE_HINT[r.state])}</p>}
    {active && <div className="v3-rd-box">
      <b>{t('Deload week until {0}', fmtDate(active.until))}</b>
      <small>{t('About {0} % fewer sets, a little lighter, aim for RIR {1}. Your normal plan comes back afterwards.', Math.round(active.volumeCut * 100), active.rir)}</small>
      <div className="v3-rr-acts"><Button size="sm" variant="plain" onClick={onCancel}>{t('Back to my normal plan')}</Button></div>
    </div>}
    {proposal && <div className="v3-rd-box">
      <b>{t('A lighter week could help')}</b>
      <small>{t('For {0} days: about {1} % fewer sets, loads a little lighter, easier effort (RIR {2}). Your routines are not changed.', proposal.days, Math.round(proposal.volumeCut * 100), proposal.rir)}</small>
      <div className="v3-rr-acts">
        <Button size="sm" variant="primary" icon="check" onClick={onApply}>{t('Apply deload')}</Button>
        <Button size="sm" variant="plain" onClick={onKeep}>{t('Keep my plan')}</Button>
      </div>
    </div>}
    {compact && onDetails && <div className="v3-rr-acts"><Button size="sm" variant="tinted" onClick={onDetails}>{t('See details')}</Button></div>}
  </Surface>
}
