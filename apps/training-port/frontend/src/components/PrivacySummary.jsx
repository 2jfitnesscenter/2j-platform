import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { fetchSocialPreferences } from '../lib/notifications-api.js'
import { privacySummary } from '../lib/privacy-summary.js'
import Icon from './Icon.jsx'
import { Surface } from './v2.jsx'

/* What your friends can see, at a glance, with one tap to change it. Reads the existing preferences; draws nothing until they load (or if they cannot). */
export default function PrivacySummary({ prefs: given }) {
  const nav = useNavigate()
  const [prefs, setPrefs] = useState(given || null)
  useEffect(() => { if (!given) fetchSocialPreferences().then(setPrefs).catch(() => {}) }, [])
  const s = privacySummary(prefs)
  if (!s) return null
  return <Surface className="v3-privacy" aria-label={t('What your friends can see')}>
    <div className="row between"><div className="v2-eyebrow"><Icon name="lock" /> {t('What your friends can see')}</div>
      <button type="button" className="v3-link" onClick={() => nav('/social/preferences')}>{t('Change')}</button></div>
    <div className="v3-privacy-chips">
      <span className="v3-chip">{t('Profile')}: {t(s.audience[s.profile])}</span>
      <span className="v3-chip">{t('Shared activity')}: {t(s.audience[s.activity])}</span>
      {s.items.map(i => <span key={i.key} className={'v3-chip' + (i.on ? ' hab' : '')}>{i.on ? '✓ ' : '— '}{t(i.label)}</span>)}
    </div>
    <div className="small dim">{t('Health, measurements and private notes are never shared.')}</div>
  </Surface>
}
