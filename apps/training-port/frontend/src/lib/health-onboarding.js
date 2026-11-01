// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Health Native Onboarding V1 — the one-time invitation to connect Health Connect, shown inside the Android app right after sign-in.
   Pure decision/flow logic on top of the EXISTING bridge (lib/health-bridge.js): nothing here reads health data, asks for any permission the app
   does not already use (PERMISSIONS), or changes how workouts are written. The "already seen" flag is a device-local preference, per account,
   stored beside the bridge's own keys — it is NOT part of the synced training state and never goes through Sync V2. */
import { getBridge, connectBridge, enableBridge, bridgeState, PERMISSIONS } from './health-bridge.js'

const KEY = uid => 'health_onboarding_v1:' + uid
const read = k => { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return null } }
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true } catch { return false } }

/** Where Android sends people to install or update Health Connect (the supported route; no in-app installer exists). */
export const HEALTH_CONNECT_STORE_URL = 'https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata'
/** What the invitation lists: exactly the permissions the app really reads today, nothing more. */
export const ONBOARDING_CATEGORIES = PERMISSIONS

export const onboardingSeen = uid => !!uid && read(KEY(uid))?.seen === true
export const markOnboardingSeen = (uid, outcome, now = Date.now()) => !!uid && write(KEY(uid), { seen: true, outcome: String(outcome || 'shown'), at: now })
/** Dev/support reset ("resetear expresamente el estado local"). */
export const resetOnboarding = uid => { if (uid) { try { localStorage.removeItem(KEY(uid)) } catch { /* private mode */ } } }

/**
 * Should the invitation appear now? Answers { show, state?, reason }:
 *  - show:true,  state:'ready'          Health Connect is there; the CTA opens the system permission sheet.
 *  - show:true,  state:'granted'        the OS already granted access but 2J has no consent of its own yet; the CTA just turns 2J's consent on.
 *  - show:true,  state:'needs_install'  Health Connect must be installed/updated; the CTA goes to the store (never a dead button).
 *  - show:false, reason:…               not the native Android app · already seen · device cannot run Health Connect ·
 *                                       access granted AND 2J consent already active (nothing left to do) · bridge hiccup (retried next launch).
 * Detecting existing access never prompts: it uses checkPermissions when the shell has it.
 */
export async function evaluateOnboarding({ uid, bridge = getBridge() } = {}) {
  if (!uid) return { show: false, reason: 'no_user' }
  if (!bridge || bridge.platform !== 'android') return { show: false, reason: 'not_native_android' }
  if (onboardingSeen(uid)) return { show: false, reason: 'seen' }
  let avail
  try { avail = await bridge.isAvailable() } catch { return { show: false, reason: 'bridge_error' } }   // transient: not marked, asked again next launch
  if (!avail?.available) {
    if (avail?.reason === 'not_installed') return { show: true, state: 'needs_install' }
    markOnboardingSeen(uid, 'unsupported')
    return { show: false, reason: 'unsupported' }
  }
  if (typeof bridge.checkPermissions === 'function') {
    try {
      const r = await bridge.checkPermissions()
      const granted = (Array.isArray(r?.granted) ? r.granted : []).filter(g => PERMISSIONS.includes(g))
      if (granted.includes('workouts')) {
        if (bridgeState(uid).enabled) { markOnboardingSeen(uid, 'already_connected'); return { show: false, reason: 'already_connected' } }
        return { show: true, state: 'granted' }   // permissions exist but 2J is not connected: invite, no need to reopen Health Connect
      }
    } catch { /* cannot tell: the invitation is harmless, show it */ }
  }
  return { show: true, state: 'ready' }
}

/** "Activar datos de salud": the existing connect flow (system permission sheet). Whatever the answer, the invitation is done. */
export async function acceptOnboarding({ uid, bridge = getBridge(), state = 'ready' } = {}) {
  let r
  try {
    // Access already granted by the OS: only 2J's own consent is missing, so no permission sheet. If anything was revoked meanwhile, fall back to the normal flow.
    if (state === 'granted' && typeof bridge?.checkPermissions === 'function') {
      const now = await bridge.checkPermissions()
      const granted = (Array.isArray(now?.granted) ? now.granted : []).filter(g => PERMISSIONS.includes(g))
      if (granted.includes('workouts')) r = enableBridge({ uid, granted }) ? { status: 'connected', granted } : { status: 'error' }
    }
    if (!r) r = await connectBridge({ uid, bridge })
  } catch { r = { status: 'error' } }
  markOnboardingSeen(uid, r.status)
  return r
}
/** "Ahora no" (or any other way out). */
export const declineOnboarding = uid => markOnboardingSeen(uid, 'declined')
/** needs_install → the store; counts as done (Settings keeps the manual control). */
export function openInstall({ uid, open = url => globalThis.window?.open?.(url, '_blank') } = {}) {
  markOnboardingSeen(uid, 'install_opened')
  open(HEALTH_CONNECT_STORE_URL)
}
