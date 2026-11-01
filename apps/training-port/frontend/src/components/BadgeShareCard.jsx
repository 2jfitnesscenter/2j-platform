// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from '../lib/i18n.js'
import { badgeAccent, ACCENT_COLOR_VAR, MASTER_BADGE_IMAGE } from '../lib/badges-data.js'
import Icon from './Icon.jsx'

export default function BadgeShareCard({ badge, dateLabel, cardRef }) {
  const accent = ACCENT_COLOR_VAR[badgeAccent(badge)]
  return <div ref={cardRef} className="badge-sharecard" style={{ '--badge-accent': accent }}>
    <div className="bsc-brand">
      <img src={MASTER_BADGE_IMAGE} alt="" crossOrigin="anonymous" />
      <span>{t('2J Fitness Center')}</span>
    </div>
    <div className="bsc-kicker">{t('NEW BADGE UNLOCKED!')}</div>
    {badge.image
      ? <img className="bsc-emblem" src={badge.image} alt="" crossOrigin="anonymous" />
      : <div className="bsc-icon"><Icon name={badge.icon} /></div>}
    <div className="bsc-title">{t(badge.title)}</div>
    <div className="bsc-description">{t(badge.description)}</div>
    <div className="bsc-date">{dateLabel}</div>
    <div className="bsc-footer">2J FITNESS CENTER · {dateLabel}</div>
  </div>
}
