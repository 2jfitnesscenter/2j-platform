import { useEffect, useState, useSyncExternalStore } from 'react'
import { useUI } from '../store/useUI.js'
import { MOBILE } from '../lib/mobile.js'
import PwaInstallBanner from './PwaInstallBanner.jsx'
import {
  dismissPwaInstall, getPwaInstallGuide, getPwaInstallMode, getPwaInstallSnapshot, isIOSDevice, isStandalone,
  promptPwaInstall, readInstallDismissedUntil, subscribePwaInstall,
} from '../lib/pwa-install.js'

export default function InstallPrompt() {
  const installState = useSyncExternalStore(subscribePwaInstall, getPwaInstallSnapshot, getPwaInstallSnapshot)
  const timer = useUI(s => s.timer)
  const work = useUI(s => s.work)
  const [dismissedUntil, setDismissedUntil] = useState(() => readInstallDismissedUntil())
  const [instructionsOpen, setInstructionsOpen] = useState(false)

  useEffect(() => {
    const remaining = dismissedUntil - Date.now()
    if (remaining <= 0) return undefined
    const timerId = setTimeout(() => setDismissedUntil(0), remaining)
    return () => clearTimeout(timerId)
  }, [dismissedUntil])

  const mode = getPwaInstallMode({
    nativeBuild: MOBILE,
    standalone: isStandalone(),
    ios: isIOSDevice() && !installState.promptAvailable,
    promptAvailable: installState.promptAvailable,
    installed: installState.installed,
    cooldown: dismissedUntil > Date.now(),
    activeWorkout: !!timer || !!work,
  })
  const guide = getPwaInstallGuide({ ios: isIOSDevice(), userAgent: globalThis.navigator?.userAgent || '' })
  const nowNot = () => setDismissedUntil(dismissPwaInstall())

  return <PwaInstallBanner
    mode={mode}
    guide={guide}
    instructionsOpen={instructionsOpen}
    onInstall={() => { void promptPwaInstall() }}
    onHowToInstall={() => setInstructionsOpen(open => !open)}
    onNowNot={nowNot}
    onCloseInstructions={() => setInstructionsOpen(false)}
  />
}
