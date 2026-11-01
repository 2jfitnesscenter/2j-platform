// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { Fragment, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { TextField } from '../components/ui.jsx'
import { ListSkeleton } from '../components/v2.jsx'
import { dateLocale } from '../lib/i18n.js'
import { fetchMessages, sendMessage, setThreadStatus } from '../lib/chat-api.js'
import CommunityShareCard from '../components/CommunityShareCard.jsx'
import ReportContentButton from '../components/ReportContentButton.jsx'

// No websocket infra anywhere in this app — poll while the thread is actually on screen,
// cleared on unmount, same "browse-on-open" spirit as the rest of Social/Chat's REST-only API.
const POLL_MS = 4000

export default function ChatThread() {
  const { id } = useParams()
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const trainer = !!user?.trainer
  const [thread, setThread] = useState(null)
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)   // the last send did not go through: the text stays in the box and can be retried
  const [online, setOnline] = useState(navigator.onLine)
  const bottomRef = useRef(null)

  const held = useRef({ list: [], rev: 0 })   // what the screen holds, for the polling cursor
  const load = () => fetchMessages(id, { after: held.current.list.at(-1)?.id || '', rev: held.current.rev }).then(d => {
    setThread(d.thread)
    const have = new Set(held.current.list.map(m => m.id))
    const list = d.full ? d.messages : [...held.current.list, ...d.messages.filter(m => !have.has(m.id))]
    held.current = { list, rev: d.rev || 0 }
    if (d.full || d.messages.length) setMessages(list)
  }).catch(e => { if (navigator.onLine) toast(e.message) })
  useEffect(() => {
    held.current = { list: [], rev: 0 }
    load()
    const iv = setInterval(load, POLL_MS)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  useEffect(() => { const on = () => setOnline(true); const off = () => setOnline(false); window.addEventListener('online', on); window.addEventListener('offline', off); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) } }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length])

  const send = () => {
    const msg = text.trim()
    if (!msg) return
    setBusy(true)
    setFailed(false)
    sendMessage(id, msg).then(() => { setText(current => current === msg ? '' : current); return load() }).catch(e => { setFailed(true); toast(e.message) }).finally(() => setBusy(false))
  }
  const toggleStatus = () => setThreadStatus(id, thread.status === 'open' ? 'closed' : 'open').then(load).catch(e => toast(e.message))

  if (!thread) return <div className="narrow v2-chat"><div className="hdr">
    <button className="iconbtn" onClick={() => nav('/chat')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
  </div><ListSkeleton rows={2} /></div>

  return <div className="narrow v2-chat" style={{ display: 'flex', flexDirection: 'column', minHeight: '78vh' }}>
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/chat')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ fontSize: 22 }} className="capitalize">{thread.kind === 'direct' ? thread.memberName : trainer ? thread.memberName : t('Trainers')}</h1></div>
      {trainer && thread.kind !== 'direct' && <button className="iconbtn" aria-label={t('Toggle status')} onClick={toggleStatus}>
        <Icon name={thread.status === 'open' ? 'checkCircle' : 'reset'} />
      </button>}
    </div>

    <div className="chat-stream" role="log" aria-live="polite">
      {!messages.length && <div className="empty"><div className="ico"><Icon name="message" /></div>{t('No messages yet')}</div>}
      {messages.map((m, i) => {
        const mine = m.authorId === user?.id
        const day = m.createdAt ? new Date(m.createdAt).toDateString() : ''
        const sep = day && (i === 0 || new Date(messages[i - 1].createdAt).toDateString() !== day)
          ? <div key={'d' + m.id} className="chat-day">{new Date(m.createdAt).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' })}</div> : null
        if (m.type === 'share') return <Fragment key={m.id}>{sep}<article className={'chat-share-bubble' + (mine ? ' mine' : '')}>
          {m.share ? <><div className="chat-share-caption">{m.share.private ? (m.share.kind === 'program' ? (mine ? t('You sent a program') : t('{0} sent you a program', thread.memberName)) : (mine ? t('You sent a routine') : t('{0} sent you a routine', thread.memberName))) : mine ? t('You shared a training moment') : t('{0} shared a training moment', thread.memberName)}</div><button className="chat-share-open" onClick={() => nav('/social/share/' + m.share.id)}><CommunityShareCard data={{ kind: m.share.kind, ...m.share.card }} /></button><div className="chat-share-foot"><ReportContentButton targetType="share" targetId={m.share.id} /></div></>
            : <div className="chat-share-unavailable"><Icon name="lock" /><span>{t('This shared moment is no longer available')}</span></div>}
        </article></Fragment>
        if (m.type === 'removed') return <Fragment key={m.id}>{sep}<div className={'chat-msg removed ' + (mine ? 'mine' : 'theirs')}>{t('This message was removed')}</div></Fragment>
        return <Fragment key={m.id}>{sep}<div className={'chat-msg ' + (mine ? 'mine' : 'theirs')}>{m.text}<div className="chat-meta">{!mine && <ReportContentButton icon targetType="message" targetId={id + ':' + m.id} />}{m.createdAt && <time className="chat-time" dateTime={new Date(m.createdAt).toISOString()}>{new Date(m.createdAt).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })}</time>}</div></div></Fragment>
      })}
      <div ref={bottomRef} />
    </div>

    {failed && <div className="chat-failed" role="alert"><span>{t('Your message was not sent.')}</span><button type="button" className="v3-link" disabled={busy || !online} onClick={send}>{t('Retry')}</button></div>}
    {!online && <div className="offline-note" role="status">{t('You’re offline. Messages are not sent until you reconnect.')}</div>}
    {thread.status === 'closed' ? (
      <div className="dim small" style={{ textAlign: 'center', padding: '14px 0' }}>{t('This conversation is closed.')}</div>
    ) : (
      <div className="chat-composer v2-glass">
        <TextField placeholder={t('Type your message…')} value={text}
          onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send() }} />
        <button className="send" disabled={busy || !online || !text.trim()} onClick={send} aria-label={t('Send')}>
          <Icon name="send" />
        </button>
      </div>
    )}
  </div>
}
