// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, Avatar } from '../components/ui.jsx'
import { ListSkeleton } from '../components/v2.jsx'
import { fetchThreads } from '../lib/chat-api.js'
import { newConversationSheet } from '../sheets.jsx'

export default function Chat() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [threads, setThreads] = useState(null)
  const trainer = !!user?.trainer

  const load = () => fetchThreads().then(setThreads).catch(e => toast(e.message))
  useEffect(() => { load() }, [])

  const startNew = () => newConversationSheet(thread => { load(); nav('/chat/' + thread.id) })

  return <div className="narrow v2-chat">
    <div className="hdr"><div><h1>{t('Conversations')}</h1></div></div>
    <div className="muted small" style={{ marginBottom: 16 }}>{t('See open and closed conversations, or start a new one.')}</div>

    {!trainer && <><Button variant="primary" icon="pencil" onClick={startNew}>{t('Start a new conversation')}</Button><div style={{ height: 20 }} /></>}

    {threads === null ? <ListSkeleton /> : threads.length ? (
      <div className="list">
        {threads.map(th => <div key={th.id} className={'item' + (th.unread ? ' v2-chat-unread' : '')} onClick={() => nav('/chat/' + th.id)}>
          <Avatar name={th.kind === 'direct' || trainer ? th.memberName : t('Trainers')} size={40} />
          <div className="grow">
            <div className="tt capitalize">{th.kind === 'direct' ? th.memberName : trainer ? th.memberName : t('Trainers')}</div>
            <div className="ss">{th.lastMessage ? th.lastMessage.text : t('No messages yet')}</div>
          </div>
          {th.lastMessage?.createdAt && <span className="v2-chat-time">{new Date(th.lastMessage.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span>}
          {th.unread && <span aria-label={t('Unread messages')} role="img" className="v2-unread-dot" />}
          <span className={'tag' + (th.status === 'open' ? ' acc' : '')}>{th.status === 'open' ? t('Open') : t('Closed')}</span>
          <Icon name="chevronRight" className="chev" />
        </div>)}
      </div>
    ) : (
      <div className="empty"><div className="ico"><Icon name="personCircle" /></div>{t('No conversations yet')}</div>
    )}
  </div>
}
