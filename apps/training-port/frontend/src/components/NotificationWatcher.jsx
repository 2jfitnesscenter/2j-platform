import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { fetchNotifications } from '../lib/notifications-api.js'

export default function NotificationWatcher() {
  const user = useStore(s => s.user)
  const setUnread = useUI(s => s.setNotificationUnread)
  useEffect(() => {
    if (!user) { setUnread(0); return }
    let stopped = false
    const poll = () => fetchNotifications().then(r => { if (!stopped) setUnread(r.unread) }).catch(() => {})
    poll(); const timer = setInterval(poll, 30000)
    return () => { stopped = true; clearInterval(timer) }
  }, [user, setUnread])
  return null
}
