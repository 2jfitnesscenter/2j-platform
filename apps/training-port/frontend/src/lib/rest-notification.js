// Local Android rest alerts are only a delivery mechanism for the existing JS timer.
// They carry no workout metadata and never create a second countdown or sync record.
import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { t } from './i18n.js'

export const REST_NOTIFICATION_ID = 20261006

export function isAndroidNative() {
  try {
    const cap = window.Capacitor || Capacitor
    return cap.isNativePlatform?.() === true && cap.getPlatform?.() === 'android'
  } catch { return false }
}

export function createRestNotificationController({ plugin, isAndroid = () => false, translate = t }) {
  let queue = Promise.resolve()
  const serial = operation => {
    const result = queue.then(operation, operation)
    queue = result.catch(() => {})
    return result
  }

  return {
    requestPermission() {
      if (!isAndroid()) return Promise.resolve(true)
      return serial(async () => {
        const current = await plugin.checkPermissions()
        const state = current?.display
        if (state === 'granted') return true
        const next = await plugin.requestPermissions()
        return next?.display === 'granted'
      }).catch(() => false)
    },
    schedule(endAt) {
      if (!isAndroid()) return Promise.resolve(false)
      return serial(async () => {
        await plugin.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] })
        if (!Number.isFinite(endAt) || endAt <= Date.now()) return false
        const permission = await plugin.checkPermissions()
        if (permission?.display !== 'granted') return false
        await plugin.schedule({ notifications: [{
          id: REST_NOTIFICATION_ID,
          title: translate('Rest finished'),
          body: translate('Next set'),
          autoCancel: true,
          schedule: { at: new Date(endAt), allowWhileIdle: true },
        }] })
        return true
      }).catch(() => false)
    },
    cancel() {
      if (!isAndroid()) return Promise.resolve(false)
      return serial(async () => {
        await plugin.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] })
        return true
      }).catch(() => false)
    },
  }
}

const controller = createRestNotificationController({
  plugin: LocalNotifications,
  isAndroid: isAndroidNative,
})

export const requestRestNotificationPermission = () => controller.requestPermission()
export const scheduleRestNotification = endAt => controller.schedule(endAt)
export const cancelRestNotification = () => controller.cancel()
