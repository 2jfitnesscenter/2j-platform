export const PWA_INSTALL_DISMISSAL_KEY = '2j_pwa_install_dismissed_until'
export const PWA_INSTALL_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

let deferredPrompt = null
let installed = false
const listeners = new Set()
let attachedWindow = null
let detachListeners = null

const snapshot = () => ({ promptAvailable: !!deferredPrompt, installed })
let currentSnapshot = snapshot()
const publish = () => { currentSnapshot = snapshot(); listeners.forEach(listener => listener()) }
const browserStorage = () => { try { return globalThis.localStorage } catch { return null } }

/** Capture the browser's one-shot prompt at startup, before the Home screen mounts. */
export function initPwaInstallEvents(target = globalThis.window) {
  if (!target?.addEventListener) return () => {}
  if (attachedWindow === target) return detachListeners || (() => {})
  detachListeners?.()
  attachedWindow = target
  const onBeforeInstallPrompt = event => {
    event.preventDefault?.()
    if (installed) return
    deferredPrompt = event
    publish()
  }
  const onAppInstalled = () => {
    installed = true
    deferredPrompt = null
    publish()
  }
  target.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  target.addEventListener('appinstalled', onAppInstalled)
  detachListeners = () => {
    target.removeEventListener?.('beforeinstallprompt', onBeforeInstallPrompt)
    target.removeEventListener?.('appinstalled', onAppInstalled)
    if (attachedWindow === target) attachedWindow = null
    detachListeners = null
  }
  return detachListeners
}

export const subscribePwaInstall = listener => { listeners.add(listener); return () => listeners.delete(listener) }
export const getPwaInstallSnapshot = () => currentSnapshot

export async function promptPwaInstall() {
  const event = deferredPrompt
  if (!event || typeof event.prompt !== 'function') return 'unavailable'
  deferredPrompt = null // the browser event can only be consumed once
  publish()
  try {
    await event.prompt()
    const choice = await event.userChoice
    if (choice?.outcome === 'accepted') {
      installed = true
      publish()
      return 'accepted'
    }
    return choice?.outcome === 'dismissed' ? 'dismissed' : 'unavailable'
  } catch {
    // Installation is optional; a browser failure must never affect the app.
    return 'unavailable'
  }
}

export function isStandalone(win = globalThis.window, nav = globalThis.navigator) {
  try { return !!win?.matchMedia?.('(display-mode: standalone)')?.matches || nav?.standalone === true }
  catch { return nav?.standalone === true }
}

export function isIOSDevice(nav = globalThis.navigator) {
  const ua = String(nav?.userAgent || '')
  const platform = String(nav?.platform || '')
  return /iPad|iPhone|iPod/i.test(ua) || (platform === 'MacIntel' && Number(nav?.maxTouchPoints) > 1)
}

/** Select conservative, browser-specific manual installation guidance. */
export function getPwaInstallGuide({ ios = false, userAgent = '' } = {}) {
  const ua = String(userAgent)
  if (ios) return /Safari/i.test(ua) && !/(CriOS|FxiOS|EdgiOS|OPiOS)/i.test(ua) ? 'ios-safari' : 'ios'
  if (/Android/i.test(ua)) {
    if (/EdgA/i.test(ua)) return 'android-edge'
    if (/SamsungBrowser/i.test(ua)) return 'android'
    if (/(Chrome|Chromium)/i.test(ua) && !/OPR/i.test(ua)) return 'android-chrome'
    return 'android'
  }
  if (/Edg\//i.test(ua)) return 'desktop-edge'
  if (/(Chrome|Chromium)/i.test(ua) && !/OPR/i.test(ua)) return 'desktop-chrome'
  return 'generic'
}

export function readInstallDismissedUntil(storage = browserStorage()) {
  try {
    const value = Number(storage?.getItem(PWA_INSTALL_DISMISSAL_KEY) || 0)
    return Number.isFinite(value) ? value : 0
  } catch { return 0 }
}

export function dismissPwaInstall(storage = browserStorage(), now = Date.now()) {
  const until = now + PWA_INSTALL_COOLDOWN_MS
  try { storage?.setItem(PWA_INSTALL_DISMISSAL_KEY, String(until)) } catch { /* storage can be disabled */ }
  return until
}

export function getPwaInstallMode({ nativeBuild = false, standalone = false, ios = false, promptAvailable = false, installed: alreadyInstalled = false, cooldown = false, activeWorkout = false } = {}) {
  if (nativeBuild || standalone || alreadyInstalled || cooldown || activeWorkout) return null
  if (promptAvailable) return 'prompt'
  return 'guide'
}

export function resetPwaInstallStateForTests() {
  deferredPrompt = null
  installed = false
  currentSnapshot = snapshot()
  listeners.forEach(listener => listener())
}
