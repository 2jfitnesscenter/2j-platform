import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { getBridge } from '../lib/health-bridge.js'
import { evaluateOnboarding, acceptOnboarding, declineOnboarding, openInstall, markOnboardingSeen, ONBOARDING_CATEGORIES } from '../lib/health-onboarding.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

const CATEGORY = {
  workouts: { icon: 'dumbbell', label: 'Workouts' },
  steps: { icon: 'figureRun', label: 'Steps' },
  activeCalories: { icon: 'flame', label: 'Active energy' },
  heartRate: { icon: 'heart', label: 'Heart rate' },
}

/* Health Native Onboarding V1 (Android app only): one premium invitation to connect Health Connect, shown once per account and device.
   It lists only what the app really reads; the actual permission request is the existing system sheet. */
export function HealthOnboardingSheet({ uid, state = 'ready', close }) {
  const toast = useUI(s => s.toast)
  const [busy, setBusy] = useState(false)
  const needsInstall = state === 'needs_install'
  const activate = async () => {
    if (busy) return
    if (needsInstall) { openInstall({ uid }); close(); return }
    setBusy(true)
    const r = await acceptOnboarding({ uid, state })
    close()
    if (useStore.getState().user?.id !== uid) return
    if (r.status === 'connected') toast(t('Connected. Nothing is read until you sync.'))
    else if (r.status === 'denied') toast(t('Permission not granted. Nothing was read.'))
    else toast(t('Health is not available on this device'))
  }
  const notNow = () => { declineOnboarding(uid); close() }
  return <div className="v3-hob" role="dialog" aria-labelledby="v3-hob-title">
    <div className="v3-hob-hero" aria-hidden="true"><Icon name="heart" /></div>
    <h3 id="v3-hob-title">{t('Connect your health with 2J')}</h3>
    <p className="v3-hob-lead">{t('2J can use your health data to complete your activity, log workouts and improve your tracking.')}</p>
    {needsInstall
      ? <p className="v3-hob-note">{t('Health Connect needs to be installed or updated on this phone.')}</p>
      : <ul className="v3-hob-cats">{ONBOARDING_CATEGORIES.filter(k => CATEGORY[k]).map(k => <li key={k}><Icon name={CATEGORY[k].icon} /><span>{t(CATEGORY[k].label)}</span></li>)}</ul>}
    <p className="v3-hob-note">{t('You choose what to share, and you can change it any time in Settings → Health & activity.')}</p>
    <div className="v3-hob-acts">
      <Button variant="primary" onClick={activate} disabled={busy}>{needsInstall ? t('Open Health Connect') : t('Activate health data')}</Button>
      <Button variant="plain" onClick={notNow} disabled={busy}>{t('Not now')}</Button>
    </div>
  </div>
}

/** Mounted once in the app shell. Waits until the session is stable (signed in, profile wizards done, not mid-workout), then decides. */
export default function HealthOnboardingGate({ ready, authed, blocked }) {
  const user = useStore(s => s.user)
  const loc = useLocation()
  const asked = useRef(null)
  const stableRoute = !/^\/(workout|bunker|trainer)/.test(loc.pathname)
  useEffect(() => {
    const uid = user?.id
    if (!ready || !authed || !uid || blocked || !stableRoute || asked.current === uid) return
    const bridge = getBridge()
    if (!bridge || bridge.platform !== 'android') return
    let cancelled = false
    const timer = setTimeout(async () => {
      const r = await evaluateOnboarding({ uid, bridge })
      if (cancelled || useStore.getState().user?.id !== uid) return
      asked.current = uid
      if (!r.show) return
      markOnboardingSeen(uid, 'shown')   // once per account and device, even if the sheet is dismissed by tapping outside or the app is closed
      useUI.getState().openSheet(close => <HealthOnboardingSheet uid={uid} state={r.state} close={close} />)
    }, 2000)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [ready, authed, user?.id, blocked, stableRoute])
  return null
}
