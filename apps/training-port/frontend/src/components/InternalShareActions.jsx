import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { fetchFriends } from '../lib/friends-api.js'
import { startDirectThread, sendShare } from '../lib/chat-api.js'
import { createSocialShare } from '../lib/social-api.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'

export default function InternalShareActions({ target }) {
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [friends, setFriends] = useState(null)
  const [busy, setBusy] = useState(false)
  const [include, setInclude] = useState([])   // optional numbers of a shared workout; nothing is added unless ticked
  const toggle = key => setInclude(list => (list.includes(key) ? list.filter(k => k !== key) : [...list, key]))
  const extra = target?.kind === 'workout' && include.length ? { include } : {}
  useEffect(() => { fetchFriends().then(x => setFriends(x.friends || [])).catch(() => setFriends([])) }, [])
  const community = async () => {
    if (busy) return
    setBusy(true)
    try { await createSocialShare({ ...target, ...extra, idempotencyKey: requestKey() }); toast(t('Shared with the Community')) }
    catch (e) { toast(e.message || t('This content is private in your settings')) }
    finally { setBusy(false) }
  }
  const direct = async friend => {
    if (busy) return
    setBusy(true)
    try {
      const thread = await startDirectThread(friend.id)
      await sendShare({ ...target, ...extra, recipientId: friend.id, threadId: thread.id, idempotencyKey: requestKey() })
      toast(t('Shared in chat with {0}', friend.name))
    } catch (e) { toast(e.message || t('Could not share this content')) }
    finally { setBusy(false) }
  }
  if (!target?.kind || !target?.targetId) return null
  return <section className="internal-share-actions" aria-label={t('Share inside 2J')}>
    <div className="internal-share-heading"><span><Icon name="users" /></span><div><strong>{t('Share inside 2J')}</strong><small>{t('You choose where this moment goes.')}</small></div></div>
    {target.kind === 'workout' && <fieldset className="internal-share-include">
      <legend>{t('Add details (optional)')}</legend>
      <div>{[['duration', 'Duration'], ['volume', 'Volume'], ['prs', 'Records'], ['cardio', 'Cardio']].map(([key, label]) => <label key={key}><input type="checkbox" checked={include.includes(key)} onChange={() => toggle(key)} />{t(label)}</label>)}</div>
      <small>{t('Body weight, health and notes are never included.')}</small>
    </fieldset>}
    <Button variant="tinted" disabled={busy} icon="users" onClick={community}>{t('Community')}</Button>
    <div className="internal-share-friends-label">{t('Send to a friend')}</div>
    {friends === null ? <div className="muted small">{t('Loading…')}</div> : friends.length
      ? <div className="internal-share-friends">{friends.slice(0, 8).map(friend => <button type="button" key={friend.id} disabled={busy} onClick={() => direct(friend)}><span className="internal-share-avatar"><Icon name="person" /></span><span>{friend.name}</span><Icon name="chevronRight" /></button>)}</div>
      : <div className="muted small">{t('Add a friend to share a moment in chat.')}</div>}
    <div className="internal-share-note">{t('Shared details are rechecked against your privacy settings each time they are opened.')}</div>
  </section>
}
const requestKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2, 16)}`
