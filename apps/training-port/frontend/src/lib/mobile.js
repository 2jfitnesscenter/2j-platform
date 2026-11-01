// Mobile build (VITE_MOBILE=1) — the standalone app-store version (Capacitor native shell).
//
// There is no backend: nothing to sign in to, everything lives on the phone. Unlike guest
// mode in a browser, this is the user's only copy of their training log, so it can't depend
// on WebView localStorage alone (iOS evicts that under storage pressure). Every persist()
// therefore also lands in a JSON file in the app's private data directory, and boot()
// restores from it. The workout reminder uses native local notifications scheduled per
// planned weekday — no server involved, unlike Web Push in the self-hosted version.
//
// Like the demo build, MOBILE is replaced at build time, so all of this folds away in
// web bundles; the Capacitor plugins are only ever imported behind it.
import { t } from './i18n.js'

export const MOBILE = import.meta.env.VITE_MOBILE === '1'

const FILE = 'opengym-state.json'

export async function nativeLoad() {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const r = await Filesystem.readFile({ path: FILE, directory: Directory.Data, encoding: Encoding.UTF8 })
    return JSON.parse(r.data)
  } catch (e) { return null }   // first launch, or unreadable — localStorage copy takes over
}

export async function nativeSave(state) {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    await Filesystem.writeFile({ path: FILE, directory: Directory.Data, data: JSON.stringify(state), encoding: Encoding.UTF8 })
  } catch (e) { /* keep the localStorage copy */ }
}

// (Re)schedule the workout-day reminder: one repeating notification per weekday that has a
// routine in the weekly plan. Cheap enough to run after any state change — the plan or the
// reminder time may just have been edited. `interactive` gates the OS permission prompt to
// the Settings toggle; a background resync never pops a dialog.
export async function syncReminder(S, interactive = false) {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({ notifications: [0, 1, 2, 3, 4, 5, 6].map(d => ({ id: 100 + d })) }).catch(() => {})
    const r = S.reminder
    if (!r?.on) return true
    let perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted' && interactive) perm = await LocalNotifications.requestPermissions()
    if (perm.display !== 'granted') return false
    const [hour, minute] = (r.time || '08:00').split(':').map(Number)
    const notifications = Object.entries(S.week || {})
      .filter(([, rid]) => rid && (S.routines || []).some(x => x.id === rid))
      .map(([day, rid]) => ({
        id: 100 + Number(day),
        title: t('Workout day'),
        body: t('{0} is on the plan today — let’s go!', S.routines.find(x => x.id === rid).name),
        // Capacitor weekdays are 1 (Sunday) … 7 (Saturday); S.week uses getDay() 0…6.
        schedule: { on: { weekday: Number(day) + 1, hour, minute }, allowWhileIdle: true },
      }))
    if (notifications.length) await LocalNotifications.schedule({ notifications })
    return true
  } catch (e) { return false }
}

// (Re)schedule the "time for a new scan" nudge — a single one-shot notification fired the day
// the member's own chosen cadence (15/30 days, Settings → General) elapses since their last
// bioimpedance scan, unlike the weekday-repeating schedule above. `daysSince` is
// lib/measurements.js's daysSinceBioimpedance(S) — computed by the caller rather than
// imported here, so this file stays decoupled from the measurements domain the way
// syncReminder above only ever reads S.week/S.routines. Re-run after any state change (a scan
// just got logged, the toggle or cadence changed) the same way syncReminder is, via the same
// debounced persist — cheap, and it's what keeps the scheduled date correct.
export async function syncBioimpedanceReminder(S, daysSince, interactive = false) {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({ notifications: [{ id: 150 }] }).catch(() => {})
    if (S.enableBioimpedanceReminder === false || daysSince === null) return true
    const cadence = S.bioimpedanceReminderDays || 15
    if (daysSince >= cadence) return true   // already overdue — Home's own banner covers "right now"
    let perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted' && interactive) perm = await LocalNotifications.requestPermissions()
    if (perm.display !== 'granted') return false
    const fireAt = new Date(Date.now() + (cadence - daysSince) * 86400000)
    fireAt.setHours(9, 0, 0, 0)
    await LocalNotifications.schedule({
      notifications: [{
        id: 150,
        title: t('Time for a new scan'),
        body: t('It’s been {0} days since your last body-composition measurement — tap to log a new one.', cadence),
        schedule: { at: fireAt, allowWhileIdle: true },
      }],
    })
    return true
  } catch (e) { return false }
}

// WKWebView can't do blob-URL downloads, so the backup goes out through the OS share sheet
// (Files, AirDrop, mail, …) from a temp file instead.
export async function shareExport(json, filename) {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')
  const w = await Filesystem.writeFile({ path: filename, directory: Directory.Cache, data: json, encoding: Encoding.UTF8 })
  await Share.share({ title: filename, url: w.uri })
}

// Same temp-file-then-OS-share-sheet trick as shareExport, for a generated PNG (the workout
// share card) instead of a JSON backup. `base64Png` is html-to-image's own data URL with the
// "data:image/png;base64," prefix already stripped by the caller — Filesystem.writeFile with
// no `encoding` writes its `data` as raw base64 bytes rather than UTF-8 text.
export async function shareImage(base64Png, filename) {
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')
  const w = await Filesystem.writeFile({ path: filename, directory: Directory.Cache, data: base64Png })
  await Share.share({ title: filename, url: w.uri })
}

// A plain-text share (the badge unlock celebration's "Share achievement" button — nothing to
// write to a temp file for, unlike shareExport). Three tiers, each falling through to the
// next when it isn't available: the native OS share sheet on the app build, the Web Share API
// on a browser that has it (most mobile browsers do), or the clipboard as a last resort —
// callers that want to say so should toast on a resolved `false`.
export async function shareText(text) {
  if (MOBILE) { const { Share } = await import('@capacitor/share'); await Share.share({ text }); return true }
  if (navigator.share) { await navigator.share({ text }); return true }
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return false }
  throw new Error('not supported')
}
