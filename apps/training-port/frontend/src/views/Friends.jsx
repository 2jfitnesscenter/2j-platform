// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, Avatar } from '../components/ui.jsx'
import { EmptyState, ListSkeleton } from '../components/v2.jsx'
import { addFriendSheet, confirmSheet, celebrateBadges } from '../sheets.jsx'
import { fetchFriends, acceptFriendRequest, declineFriendRequest, cancelFriendRequest, removeFriend, sendFriendRequest, blockFriend, unblockFriend } from '../lib/friends-api.js'
import { evaluateBadgesIn } from '../lib/badges.js'
import { startDirectThread } from '../lib/chat-api.js'
import PrivacySummary from '../components/PrivacySummary.jsx'

export default function Friends() {
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const [data, setData] = useState(null)   // { friends, incoming, outgoing }
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => fetchFriends().then(setData).catch(e => toast(e.message))
  useEffect(() => { load() }, [])

  // Opening a shared invite link (?code=...) lands here and sends the request right away — the
  // link itself was the sharer's consent, the recipient's own accept step is still required.
  useEffect(() => {
    const code = params.get('code')
    if (!code) return
    setParams({}, { replace: true })
    sendFriendRequest({ code }).then(() => { toast(t('Friend request sent')); load() }).catch(e => toast(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const respond = (fn, id, okMsg) => {
    setBusy(true)
    fn(id).then(() => { toast(okMsg); load() }).catch(e => toast(e.message)).finally(() => setBusy(false))
  }

  // Accepting is the one moment a friendship actually starts existing — friends live
  // server-side, not in S (see lib/badges.js's first_friend check), so this is the only chance
  // to record the "has a friend" flag the badge condition reads back.
  const acceptFriend = id => {
    setBusy(true)
    acceptFriendRequest(id).then(() => {
      toast(t('Now you are friends'))
      load()
      celebrateBadges(evaluateBadgesIn(update, s => { s.badgeFlags = { ...(s.badgeFlags || {}), addedFriend: true } }))
    }).catch(e => toast(e.message)).finally(() => setBusy(false))
  }

  if (!data) return <div className="narrow v2-friends"><div className="hdr"><div><h1>{t('Friends')}</h1></div></div><ListSkeleton /></div>

  const nothingYet = !data.friends.length && !data.incoming.length && !data.outgoing.length
  const visibleFriends = data.friends.filter(f => !query.trim() || f.name.toLowerCase().includes(query.trim().toLowerCase()))

  return <div className="narrow v2-friends">
    <div className="hdr">
      <div><h1>{t('Friends')}</h1></div>
      <Button size="sm" onClick={() => addFriendSheet(load)}>{t('Add')}</Button>
    </div>

    {data.friends.length > 0 && <PrivacySummary />}

    {!!data.incoming.length && <>
      <h4 className="sec">{t('Requests')}<span className="v2-badge">{data.incoming.length}</span></h4>
      <div className="list" style={{ marginBottom: 22 }}>
        {data.incoming.map(r => <div key={r.id} className="item v2-req">
          <Avatar name={r.from?.name} size={40} />
          <div className="grow"><div className="tt capitalize">{r.from?.name}</div></div>
          <div className="v2-req-acts">
            <Button variant="primary" disabled={busy} onClick={() => acceptFriend(r.id)}>{t('Accept')}</Button>
            <Button disabled={busy} onClick={() => respond(declineFriendRequest, r.id, t('Request declined'))}>{t('Decline')}</Button>
          </div>
        </div>)}
      </div>
    </>}

    {!!data.outgoing.length && <>
      <h4 className="sec">{t('Sent')}</h4>
      <div className="list" style={{ marginBottom: 22 }}>
        {data.outgoing.map(r => <div key={r.id} className="item">
          <Avatar name={r.to?.name} size={40} />
          <div className="grow"><div className="tt capitalize">{r.to?.name}</div><div className="ss">{t('Pending')}</div></div>
          <Button size="sm" disabled={busy} onClick={() => respond(cancelFriendRequest, r.id, t('Request cancelled'))}>{t('Cancel')}</Button>
        </div>)}
      </div>
    </>}

    {data.friends.length ? (
      <>
      <label className="search" style={{ margin: '4px 0 10px' }}><Icon name="search" /><input className="input" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Search friends')} /></label>
      <div className="list">
        {visibleFriends.map(f => <div key={f.id} className="item">
          <Avatar name={f.name} size={40} />
          <button className="grow friend-profile-link" onClick={() => nav('/social/profile/' + encodeURIComponent(f.id))}><span className="tt capitalize">{f.name}</span><span className="ss">{t('View social profile')}</span></button>
          <button className="iconbtn v2-msg-btn" aria-label={t('Message {0}', f.name)} onClick={() => startDirectThread(f.id).then(th => nav('/chat/' + th.id)).catch(e => toast(e.message))}><Icon name="message" /></button>
          <button className="iconbtn" aria-label={t('Block {0}', f.name)} onClick={() => confirmSheet({ title: t('Block {0}?', f.name), message: t('This also removes the friendship and stops direct messages.'), confirmText: t('Block'), danger: true, onConfirm: () => blockFriend(f.id).then(load).catch(e => toast(e.message)) })}><Icon name="ban" /></button>
          <button className="iconbtn" aria-label={t('Remove friend')} onClick={() => confirmSheet({
            title: t('Remove {0}?', f.name), confirmText: t('Remove'), danger: true,
            onConfirm: () => respond(removeFriend, f.id, t('Friend removed'))
          })}><Icon name="xmark" /></button>
        </div>)}
        {!visibleFriends.length && <div className="empty">{t('No match')}</div>}
      </div>
      </>
    ) : nothingYet && (
      <div className="card">
        <EmptyState icon="users" title={t('Share activity')} action={<Button variant="primary" onClick={() => addFriendSheet(load)}>{t('Invite a friend')}</Button>}>
          <div className="muted small" style={{ marginBottom: 14 }}>{t('Invite friends to share workouts, get inspired and stay motivated.')}</div>
        </EmptyState>
      </div>
    )}
    {!!data.blocked?.length && <><h4 className="sec" style={{ marginTop: 24 }}>{t('Blocked')}</h4><div className="list">{data.blocked.map(f => <div key={f.id} className="item"><Avatar name={f.name} size={38} /><div className="grow"><div className="tt capitalize">{f.name}</div></div><Button size="sm" onClick={() => unblockFriend(f.id).then(load).catch(e => toast(e.message))}>{t('Unblock')}</Button></div>)}</div></>}
  </div>
}
