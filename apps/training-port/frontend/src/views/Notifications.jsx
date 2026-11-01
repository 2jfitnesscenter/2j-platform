import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { fetchNotifications, fetchSocialPreferences, markAllNotificationsRead, markNotificationRead, saveSocialPreferences } from '../lib/notifications-api.js'
import { enablePush, pushSupported, pushPermission } from '../lib/push.js'

const KIND_LABEL = { share: 'shared moment', routine: 'routine', program: 'program', wall: 'mark', topic: 'topic', board: 'post', comment: 'comment', message: 'message', challenge: 'challenge' }
const messageOf = n => ({
  friend_request: t('{0} wants to connect with you', n.actor?.name || t('A member')),
  friend_accepted: t('{0} accepted your friend request', n.actor?.name || t('A member')),
  message: t('New message from {0}', n.actor?.name || t('A member')),
  share: t('{0} shared something with you', n.actor?.name || t('A member')),
  challenge: t('A challenge needs your attention'),
  achievement: t('A new achievement is available'),
  moderation: t('Your {0} was removed for not following the community rules', t(KIND_LABEL[n.target?.id] || 'content'))
}[n.type] || t('Community update'))

export default function Notifications() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const setUnread = useUI(s => s.setNotificationUnread)
  const [items, setItems] = useState(null)
  const [pushOn, setPushOn] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const permission = pushSupported() ? pushPermission() : 'unsupported'
  useEffect(() => { fetchSocialPreferences().then(v => setPushOn(!!v.notifications.push)).catch(() => {}) }, [])
  const load = () => fetchNotifications().then(data => { setItems(data.notifications); setUnread(data.unread) }).catch(e => toast(e.message))
  useEffect(() => { load() }, [])
  const open = async item => {
    try { await markNotificationRead(item.id); await load() } catch (e) { toast(e.message) }
    const path = item.deepLink || '/social'
    nav(path)
  }
  const readAll = async () => { try { await markAllNotificationsRead(); await load() } catch (e) { toast(e.message) } }
  return <main className="narrow">
    <header className="hdr"><div><h1>{t('Notifications')}</h1><div className="sub">{t('Only the updates you chose to receive')}</div></div>
      {!!items?.some(x => !x.readAt) && <Button size="sm" onClick={readAll}>{t('Mark all read')}</Button>}</header>
    {pushSupported() && <section className="card push-card"><div className="row between"><div><div className="tt">{t('Stay in the loop')}</div><div className="ss">{t('Friend requests, messages and content shared directly with you.')}</div></div>
      <Button size="sm" variant={pushOn ? 'tinted' : 'primary'} disabled={pushBusy || (!pushOn && permission === 'denied')} onClick={async () => { setPushBusy(true); try { if (!pushOn) await enablePush(); const prefs = await saveSocialPreferences({ notifications: { push: !pushOn } }); setPushOn(prefs.notifications.push) } catch (e) { toast(e.message) } finally { setPushBusy(false) } }}>{pushOn ? t('Turn off social alerts') : permission === 'denied' ? t('Push blocked in browser') : t('Enable push')}</Button></div>
      <div className="muted small" style={{ marginTop: 8 }}>{permission === 'denied' ? t('Push is blocked by your browser. In-app notifications still work.') : t('You choose first; no permission request happens until you tap Enable push.')}</div></section>}
    {items === null ? <div className="muted small">{t('Loading…')}</div> : items.length ? <div className="list">
      {items.map(item => <button type="button" key={item.id} className="item notification-item" onClick={() => open(item)} aria-label={messageOf(item)}>
        <span className="lrow-i"><Icon name={item.type === 'message' ? 'message' : item.type.startsWith('friend') ? 'users' : item.type === 'moderation' ? 'shield' : 'bell'} /></span>
        <span className="grow"><span className="tt">{messageOf(item)}</span><span className="ss">{new Date(item.createdAt).toLocaleString()}</span></span>
        {!item.readAt && <span className="tag acc">{t('Unread item')}</span>}
      </button>)}
    </div> : <div className="empty"><div className="ico"><Icon name="bell" /></div>{t('You’re all caught up')}<br /><span className="small muted">{t('Friend requests, shared moments and challenge updates will appear here.')}</span></div>}
  </main>
}
