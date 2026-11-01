// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from '../lib/i18n.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { followUpView } from '../lib/followup-view.js'
import Icon from './Icon.jsx'
import { Surface, Stat } from './v2.jsx'
import { Button } from './ui.jsx'

/* The member's follow-up (Seguimiento V2): when the next review is, what was done last time and what changed since, with the one
   action that makes sense. Presentation of the gym's existing schedule — it adds no data and no judgement.
   `compact` (Home) only appears when a review is near or overdue; the full card lives in Health and Progress. */
export const TEMPLATE_NAME = { basic: 'Basic', intermediate: 'Intermediate', pro: 'Pro', custom: 'Custom' }
const WHAT = { basic: 'Weight and waist', intermediate: 'Weight, main tape measurements and body fat', pro: 'Full bioimpedance with segments, plus skinfolds', custom: 'Choose the readings' }

export default function FollowUpCard({ fu, S, nav, compact = false }) {
  const v = followUpView(fu, S)
  if (!v) return null
  if (compact && v.state === 'ok') return null
  const when = v.next
    ? (v.state === 'overdue' ? t('Review overdue by {0} days', -v.daysLeft) : v.daysLeft === 0 ? t('Your review is today') : t('Next review {0}', fmtDate(v.next)))
    : t('Follow-up active')
  const sub = v.state === 'due' && v.daysLeft > 0 ? t('in {0} days', v.daysLeft) : v.state === 'overdue' ? fmtDate(v.next) : null
  const go = () => nav('/measurements')
  if (compact) return <button type="button" className={'v2-surface v2-fu ' + v.state + ' v2-tap'} onClick={() => nav('/health')}>
    <span className="v2-fu-top"><span className="v2-fu-ic"><Icon name="calendar" /></span>
      <span style={{ flex: 1, minWidth: 0 }}><span className="v2-fu-when">{when}</span>{sub && <span className="v2-fu-sub" style={{ display: 'block' }}>{sub}</span>}</span>
      <Icon name="chevronRight" className="chev" /></span>
  </button>
  return <Surface className={'v2-fu ' + v.state} data-private="true" aria-label={t('Follow-up')}>
    <div className="v2-fu-top">
      <span className="v2-fu-ic"><Icon name={v.state === 'overdue' ? 'bell' : 'calendar'} /></span>
      <div style={{ flex: 1, minWidth: 0 }}><div className="v2-fu-when">{when}</div>
        <div className="v2-fu-sub">{sub ? sub + ' · ' : ''}{t(TEMPLATE_NAME[v.template] || 'Basic')} · {t(WHAT[v.template] || WHAT.basic)}</div></div>
    </div>
    {(v.last || v.weight) && <div className="v2-fu-facts">
      {v.last && <Stat value={fmtDate(v.last)} label={t('Last review')} />}
      {v.weight && <Stat value={(v.weight.delta > 0 ? '+' : v.weight.delta < 0 ? '−' : '±') + fmtNum(Math.abs(v.weight.delta)) + ' ' + S.unit} label={t('Weight since the last review')} />}
      {v.days && <Stat value={t('{0} days', v.days)} label={t('Review every')} />}
    </div>}
    <Button variant={v.state === 'ok' ? 'tinted' : 'primary'} icon="scale" onClick={go}>{t('Add a measurement')}</Button>
  </Surface>
}
