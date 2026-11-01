import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import SsoLanding from './views/SsoLanding.jsx'
import { isSsoLanding } from './lib/sso-landing.js'
import { MOBILE } from './lib/mobile.js'
import { nav } from './lib/nav.js'
import { loadStartupLanguage } from './lib/i18n.js'
import { useStore } from './store/useStore.js'
import { initPwaInstallEvents } from './lib/pwa-install.js'
import './index.css'
import './v2.css'
import './v2-screens.css'
import './v2-social.css'
import './v3-training.css'
import './v3-progress.css'
import './v3-library.css'

// Capture the browser's one-shot installation event at app startup, even before Home mounts.
if (!MOBILE) initPwaInstallEvents(window)

// The store synchronously restores gym_state_v1 from localStorage. Load its locale pack
// before React's first render so users never see the English source strings flash on boot.
async function startApp() {
  await loadStartupLanguage(useStore.getState().S)
  // /sso is the landing for "Open Búnker with your 2J account"; it runs before the app so the one-time code in the URL fragment is consumed first.
  const Root = !MOBILE && isSsoLanding(window.location) ? SsoLanding : App
  createRoot(document.getElementById('root')).render(<StrictMode><Root /></StrictMode>)
}
startApp()

// Not in the mobile build: the native shell already serves everything from disk.
if (!MOBILE && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {})
  // A notification tap on an already-open tab can't navigate itself (focusing a client
  // doesn't change its route) — the SW posts the target hash back here instead.
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'nav' && e.data.url) nav(e.data.url.replace(/^\.?#?/, '') || '/')
  })
}
