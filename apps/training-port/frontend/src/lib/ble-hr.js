// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Live heart rate from a Bluetooth chest strap / armband, through the browser's Web Bluetooth and
// the standard GATT Heart Rate service (0x180D / characteristic 0x2A37) — any sensor that speaks
// the standard works; there is no brand-specific code. EXPERIMENTAL and platform-bound: Chrome
// on Android (browser or installed PWA) and desktop Chrome/Edge expose navigator.bluetooth;
// iPhone/iPad (Safari or any iOS browser) do not, so the feature is simply not offered there.
//
// Privacy: nothing about the device is stored (no id, no name beyond the live session), the
// reading loop never touches the server, and permission is only requested from an explicit tap.
import { create } from 'zustand'
import { hrAccumulator } from './fitness.js'

export const bleSupported = () => typeof navigator !== 'undefined' && !!navigator.bluetooth && typeof navigator.bluetooth.requestDevice === 'function'

// Heart Rate Measurement (0x2A37): flags byte, then the value as uint8 or uint16 (bit 0).
export function parseHeartRate(view) {
  if (!view || view.byteLength < 2) return null
  const flags = view.getUint8(0)
  const bpm = (flags & 0x01) ? (view.byteLength >= 3 ? view.getUint16(1, true) : null) : view.getUint8(1)
  return bpm > 0 && bpm < 255 ? bpm : null
}

// Session state for the UI — ephemeral, never persisted. `status`: idle | connecting | live |
// lost (dropped, can reconnect) | denied | error.
let link = null        // { device, characteristic, handler, onGone }
let acc = null         // hrAccumulator for the current workout
let accFor = null      // the workout id it belongs to
export const useHR = create(() => ({ status: 'idle', bpm: null, name: null, error: null }))

const teardown = () => {
  if (!link) return
  try { link.characteristic?.removeEventListener('characteristicvaluechanged', link.handler) } catch { /* */ }
  try { link.device?.removeEventListener('gattserverdisconnected', link.onGone) } catch { /* */ }
}

async function subscribe(device) {
  const server = await device.gatt.connect()
  const service = await server.getPrimaryService('heart_rate')
  const characteristic = await service.getCharacteristic('heart_rate_measurement')
  const handler = e => {
    const bpm = parseHeartRate(e.target.value)
    if (bpm == null) return
    acc?.add(bpm, Date.now())
    useHR.setState({ bpm, status: 'live' })
  }
  const onGone = () => useHR.setState({ status: 'lost', bpm: null })
  characteristic.addEventListener('characteristicvaluechanged', handler)
  device.addEventListener('gattserverdisconnected', onGone)
  await characteristic.startNotifications()
  link = { device, characteristic, handler, onGone }
}

/** Ask the browser for a heart-rate sensor (its own chooser) and start reading. `workoutId` ties
 *  the running summary to the session it is measuring. */
export async function connectHeartRate(workoutId, maxHr, bt = typeof navigator !== 'undefined' ? navigator.bluetooth : null) {
  if (!bt?.requestDevice) { useHR.setState({ status: 'error', error: 'unsupported' }); return false }
  useHR.setState({ status: 'connecting', error: null })
  try {
    const device = await bt.requestDevice({ filters: [{ services: ['heart_rate'] }] })
    teardown()
    if (accFor !== workoutId) { acc = hrAccumulator(maxHr); accFor = workoutId }
    await subscribe(device)
    useHR.setState({ status: 'live', name: device.name || null })
    return true
  } catch (e) {
    // NotFoundError = the member closed the chooser; SecurityError/NotAllowedError = denied.
    const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError'
    useHR.setState({ status: e?.name === 'NotFoundError' ? 'idle' : denied ? 'denied' : 'error', error: e?.name || 'error', bpm: null })
    return false
  }
}

/** After a drop: reconnect to the same sensor without a new chooser, when the browser allows. */
export async function reconnectHeartRate() {
  const device = link?.device
  if (!device) return false
  useHR.setState({ status: 'connecting' })
  try { teardown(); await subscribe(device); useHR.setState({ status: 'live' }); return true }
  catch { useHR.setState({ status: 'lost' }); return false }
}

export function disconnectHeartRate() {
  teardown()
  try { link?.device?.gatt?.connected && link.device.gatt.disconnect() } catch { /* */ }
  link = null
  useHR.setState({ status: 'idle', bpm: null, name: null })
}

/** At finish: the measured summary for that workout (avg, max, zones computed by 2J), then the
 *  sensor is released. Null when nothing was read for it. */
export function finishHeartRate(workoutId) {
  const result = accFor === workoutId && acc ? acc.result() : null
  acc = null; accFor = null
  disconnectHeartRate()
  return result
}
export const hrSessionActive = workoutId => accFor === workoutId && !!acc
