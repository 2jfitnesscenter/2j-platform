import { t } from '../lib/i18n.js'
import { reviewReasons } from '../lib/routine-review-text.js'
import Icon from './Icon.jsx'
import { Surface } from './v2.jsx'
import { Button } from './ui.jsx'

/* Member notice: "this routine is worth a look" and why, from their own logged numbers. Calm tone, one action — see the routine. Only staff can close the review
   (from the staff Seguimiento / Needs attention), so the member cannot dismiss it. Nothing here changes the routine. */
export default function RoutineReviewCard({ review, onView, compact = false }) {
  const why = reviewReasons(review, compact ? 1 : 3)
  const label = t(review.kind === 'program' ? 'Program review' : 'Routine review')
  return <Surface className="v3-rr" role="status" aria-label={label}>
    <div className="v2-eyebrow"><Icon name="clipboard" /> {label}</div>
    <div className="v3-rr-t"><b>{review.name}</b><small>{review.kind === 'program' ? t('Week {0} with this program', review.week) : t('Week {0} with this routine', review.week)}</small></div>
    {why.length > 0 && <ul className="v3-rr-why">{why.map((w, i) => <li key={i}>{w}</li>)}</ul>}
    <div className="v3-rr-acts">
      <Button size="sm" variant="tinted" icon="clipboard" onClick={onView}>{t('View routine')}</Button>
    </div>
  </Surface>
}
