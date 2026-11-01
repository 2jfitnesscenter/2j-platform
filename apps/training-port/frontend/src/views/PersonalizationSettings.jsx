// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings → Personalisation: its own screen (Settings only carries a compact row). The controls are the existing ones.
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import PersonalizationSection from '../components/PersonalizationSection.jsx'
import Icon from '../components/Icon.jsx'

export default function PersonalizationSettings() {
  const nav = useNavigate()
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('Personalisation')}</h1></div>
    </div>
    <p className="muted small" style={{ margin: '0 4px 12px' }}>{t('Choose what you see in Home and Progress')}</p>
    <PersonalizationSection />
  </div>
}
