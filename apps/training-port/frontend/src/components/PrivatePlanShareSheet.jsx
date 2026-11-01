import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { fetchFriends } from '../lib/friends-api.js'
import { startDirectThread, sendShare } from '../lib/chat-api.js'
import { useUI } from '../store/useUI.js'
import Icon from './Icon.jsx'

const requestKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2, 16)}`

/** Send a routine or program to ONE friend, from the routine or program itself. One sheet, no destinations to pick: nothing is published. */
export default function PrivatePlanShareSheet({ share, title, close }) {
  const toast = useUI(s => s.toast)
  const [friends, setFriends] = useState(null)
  const [busy, setBusy] = useState(null)
  const [query, setQuery] = useState('')
  useEffect(() => { fetchFriends().then(x => setFriends(x.friends || [])).catch(() => setFriends([])) }, [])
  const send = async friend => {
    if (busy) return
    setBusy(friend.id)
    try {
      const thread = await startDirectThread(friend.id)
      await sendShare({ ...share, recipientId: friend.id, threadId: thread.id, idempotencyKey: requestKey() })
      toast(t('Sent to {0}', friend.name))
      close()
    } catch (e) { toast(e.message || t('Could not share this content')); setBusy(null) }
  }
  const shown = (friends || []).filter(f => !query.trim() || f.name.toLowerCase().includes(query.trim().toLowerCase()))
  return <div className="private-share">
    <h3>{t('Send to a friend')}</h3>
    <p className="small muted">{t('{0} — your friend gets their own copy to save or start. Nothing is published.', title)}</p>
    {friends === null ? <div className="muted small">{t('Loading…')}</div>
      : !friends.length ? <div className="empty"><div className="ico"><Icon name="users" /></div>{t('Add a friend to share a moment in chat.')}</div>
        : <>
          {friends.length > 6 && <label className="search"><Icon name="search" /><input className="input" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Search friends')} /></label>}
          <div className="internal-share-friends">{shown.map(f => <button type="button" key={f.id} disabled={!!busy} onClick={() => send(f)}>
            <span className="internal-share-avatar"><Icon name="person" /></span><span>{f.name}</span><Icon name={busy === f.id ? 'clock' : 'chevronRight'} />
          </button>)}</div>
        </>}
  </div>
}
