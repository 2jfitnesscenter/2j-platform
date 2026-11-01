// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from '../lib/i18n.js'
import { nav } from '../lib/nav.js'
import Icon from './Icon.jsx'
import { Ring } from './v2.jsx'
import { Button } from './ui.jsx'

/* What a Home indicator is made of — opened by tapping its ring. States the source of the figure in plain language and
   says what it is NOT. Presentational: it receives the indicator object lib/indicators.js built. */
export default function IndicatorDetail({ i, close }) {
  const where = i.key === 'training' ? '/stats' : '/health'
  const time = i.at ? new Date(i.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null
  return <div className="v2-ind">
    <div className="v2-ind-head">
      <Ring value={i.value} size={72} stroke={7} color={i.color} icon={i.icon} label={`${t(i.label)}: ${i.text}`} />
      <div><div className="v2-eyebrow">{t(i.label)}</div><div className="v2-ind-fig">{i.text}{i.unit ? <small> {t(i.unit)}</small> : null}</div></div>
    </div>
    <p className="v2-ind-basis">{t(i.basis, i.platform || '')}</p>
    {time && <p className="v2-ind-meta"><Icon name="clock" />{t('Last read at {0}', time)}</p>}
    {i.value == null && <p className="v2-ind-meta"><Icon name="info" />{t('This ring shows the figure only — there is no percentage because there is no target behind it.')}</p>}
    <p className="v2-ind-meta"><Icon name="shield" />{t('Visual information, not a diagnosis. It stays private to you.')}</p>
    <Button variant="tinted" onClick={() => { close(); nav(where) }}>{i.key === 'training' ? t('View progress') : t('Open Health')}</Button>
  </div>
}
