// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { forwardRef } from 'react'
import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import Icon from './Icon.jsx'

/* A graphic card for one record, achievement or badge — 2J branding, the thing achieved, its value, the improvement
   and the date. Self-contained and theme-independent on purpose (fixed graphite/emerald/gold, no blur, no external
   fonts) so html-to-image exports look exactly like the screen. Reused today by the post-workout summary; built so
   Social V2 and any share/export can render it without changes (it takes plain props, not store state).
     kind  'pr' | 'achievement' → gold (a record / milestone)    'badge' → emerald (a collectible)
   Gold is reserved for kind pr / achievement. */
const AchievementCard = forwardRef(function AchievementCard({ kind = 'pr', title, subtitle, value, delta, date, icon, image, kicker, className = '' }, ref) {
  const gold = kind === 'pr' || kind === 'achievement'
  const label = kicker || (kind === 'pr' ? t('New record') : kind === 'achievement' ? t('Achievement unlocked') : t('Badge'))
  return <div ref={ref} className={'v2-ach ' + (gold ? 'gold ' : 'emerald ') + className} role="group" aria-label={`${label}: ${title}${value ? ' — ' + value : ''}`}>
    <div className="v2-ach-top">
      <span className="v2-ach-brand"><img src="/brand/logo-mark.png" alt="" crossOrigin="anonymous" />2J FITNESS</span>
      <span className="v2-ach-kind">{label}</span>
    </div>
    <div className="v2-ach-medal">{image ? <img src={image} alt="" crossOrigin="anonymous" /> : <Icon name={icon || (gold ? 'trophy' : 'medal')} />}</div>
    <div className="v2-ach-title">{title}</div>
    {subtitle && <div className="v2-ach-sub">{subtitle}</div>}
    {value && <div className="v2-ach-value">{value}</div>}
    {delta && <div className="v2-ach-delta"><Icon name="arrowUp" />{delta}</div>}
    {date && <div className="v2-ach-date">{fmtDate(date, true)}</div>}
  </div>
})
export default AchievementCard
