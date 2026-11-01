// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { uxOn } from '../lib/features.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { beep, vibrate } from '../lib/sound.js'
import { fetchThreads } from '../lib/chat-api.js'

const POLL_MS = 15000

// Background poll so a chat reply is noticed even when the recipient is elsewhere in the app,
// not just when Chat itself is open (views/ChatThread.jsx already polls that screen directly).
// Web Push (lib/push.js) covers the app-closed case; this covers app-open-elsewhere — the two
// together are what "some kind of alert" actually needs. Mounted once in App.jsx's Shell, same
// spirit as RestTimer/Modals/Toast.
export default function ChatWatcher() {
  const user = useStore(s => s.user)
  const on = useStore(s => (s.features, uxOn(s.S, 'chat')))   // admin switch + the member's own choice
  const setChatUnread = useUI(s => s.setChatUnread)
  const loc = useLocation()
  const pathRef = useRef(loc.pathname)
  useEffect(() => { pathRef.current = loc.pathname }, [loc.pathname])

  useEffect(() => {
    if (!user || !on) { setChatUnread(0); return }
    let stopped = false
    const seen = new Map()   // threadId -> last-seen unread message timestamp, so a reply is toasted once
    let primed = false       // skip the toast on the very first poll (nothing "new" about existing unreads)
    const poll = () => fetchThreads().then(threads => {
      if (stopped) return
      const unread = threads.filter(th => th.unread)
      setChatUnread(unread.length)
      unread.forEach(th => {
        const at = th.lastMessage?.createdAt || 0
        const prev = seen.get(th.id) || 0
        seen.set(th.id, at)
        if (primed && at > prev && pathRef.current !== '/chat/' + th.id) {
          beep(useStore.getState().S.sound, 740, 0.12); vibrate(30)
          useUI.getState().toast(t('New message: {0}', (th.lastMessage.text || '').slice(0, 60)))
        }
      })
      primed = true
    }).catch(() => {})
    poll()
    const iv = setInterval(poll, POLL_MS)
    return () => { stopped = true; clearInterval(iv) }
  }, [user, on, setChatUnread])

  return null
}
