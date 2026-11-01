import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import Icon from '../components/Icon.jsx'
import { Button, Segmented } from '../components/ui.jsx'
import { fetchSocialPreferences, saveSocialPreferences } from '../lib/notifications-api.js'

export default function SocialPreferences() {
  const toast = useUI(s => s.toast)
  const [value, setValue] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { fetchSocialPreferences().then(setValue).catch(e => toast(e.message)) }, [])
  const setPrivacy = (key, next) => setValue(v => ({ ...v, privacy: { ...v.privacy, [key]: next } }))
  const setNotifications = (key, next) => setValue(v => ({ ...v, notifications: { ...v.notifications, [key]: next } }))
  const save = async () => { setBusy(true); try { setValue(await saveSocialPreferences(value)); toast(t('Saved')) } catch (e) { toast(e.message) } finally { setBusy(false) } }
  if (!value) return <main className="narrow"><div className="hdr"><h1>{t('Your privacy')}</h1></div></main>
  const visibility = [{ value: 'private', label: t('Private') }, { value: 'friends', label: t('Friends') }, { value: 'community', label: t('Community') }]
  const activity = [{ value: 'nobody', label: t('Nobody') }, { value: 'friends', label: t('Friends') }, { value: 'community', label: t('Community') }]
  const toggle = (label, key) => <label className="item social-pref-row" key={key}><span className="grow">{t(label)}</span><input type="checkbox" checked={!!value.privacy[key]} onChange={e => setPrivacy(key, e.target.checked)} /></label>
  const notice = (label, key) => <label className="item social-pref-row" key={key}><span className="grow">{t(label)}</span><input type="checkbox" checked={!!value.notifications[key]} onChange={e => setNotifications(key, e.target.checked)} /></label>
  return <main className="narrow">
    <header className="hdr"><div><h1>{t('Your privacy')}</h1><div className="sub">{t('Choose what your friends can see')}</div></div><Icon name="lock" /></header>
    <section className="card social-pref-card social-privacy-intro"><div className="privacy-intro-mark"><Icon name="lock" /></div><div><h3>{t('You decide what people see')}</h3><div className="muted small">{t('Your health data, measurements, trainer notes and restrictions stay private. These settings control only your social profile and shared moments.')}</div></div></section>
    <section className="card social-pref-card"><h3>{t('Profile')}</h3><div className="muted small">{t('Health, measurements and private notes are never shown here.')}</div>
      <p className="small">{t('Who can see your profile')}</p><Segmented options={visibility} value={value.privacy.profile} onChange={v => setPrivacy('profile', v)} />
      <p className="small">{t('Who can see shared activity')}</p><Segmented options={activity} value={value.privacy.activity} onChange={v => setPrivacy('activity', v)} />
    </section>
    <section className="card social-pref-card"><h3>{t('Shared content')}</h3><div className="list">{[['Personal records','prs'],['Achievements','achievements'],['Routines','routines'],['Workouts','workouts'],['Challenges','challenges']].map(([label,key]) => toggle(label,key))}</div></section>
    <section className="card social-pref-card"><h3>{t('Notifications')}</h3><div className="list">{[['Friend requests','friendRequests'],['Messages','messages'],['Shared content','shares'],['Challenges','challenges'],['Achievements','achievements']].map(([label,key]) => notice(label,key))}</div></section>
    <Button variant="primary" disabled={busy} onClick={save}>{t('Save')}</Button>
    <div className="muted small" style={{ marginTop: 10 }}>{t('These choices never expose health measurements or change your training data.')}</div>
  </main>
}
