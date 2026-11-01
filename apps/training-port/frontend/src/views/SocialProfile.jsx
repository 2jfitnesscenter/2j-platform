import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import Icon from '../components/Icon.jsx'
import { Avatar, Button } from '../components/ui.jsx'
import { fetchSocialProfile } from '../lib/friends-api.js'
import { startDirectThread } from '../lib/chat-api.js'
import { mediaUrl } from '../lib/media.js'

export default function SocialProfile() {
  const { id } = useParams()
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState(false)
  useEffect(() => { let live = true; fetchSocialProfile(id).then(p => { if (live) setProfile(p) }).catch(() => { if (live) setError(true) }); return () => { live = false } }, [id])
  if (error) return <main className="narrow"><header className="hdr"><button className="iconbtn" onClick={() => nav('/friends')} aria-label={t('Back')}><Icon name="chevronLeft" /></button><h1>{t('Profile unavailable')}</h1></header><div className="empty"><div className="ico"><Icon name="lock" /></div>{t('This profile is private or no longer available.')}</div></main>
  if (!profile) return <main className="narrow"><div className="hdr"><h1>{t('Social profile')}</h1></div><div className="muted small">{t('Loading…')}</div></main>
  return <main className="narrow">
    <header className="hdr"><button className="iconbtn" onClick={() => nav('/friends')} aria-label={t('Back')}><Icon name="chevronLeft" /></button><h1>{t('Social profile')}</h1></header>
    <section className="social-profile-hero card"><Avatar name={profile.name} image={profile.avatar ? mediaUrl(profile.avatar) : null} size={76} /><h2 className="capitalize">{profile.name}</h2><span className="tag"><Icon name="users" />{t('Friend')}</span>
      {profile.isFriend && <Button variant="primary" icon="message" onClick={() => startDirectThread(profile.id).then(thread => nav('/chat/' + thread.id)).catch(e => toast(e.message))}>{t('Message')}</Button>}
    </section>
    <div className="muted small social-profile-private-note"><Icon name="lock" /> {t('Health, measurements and private notes are never shown here.')}</div>
  </main>
}
