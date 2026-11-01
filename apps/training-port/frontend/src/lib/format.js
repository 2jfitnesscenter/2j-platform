// Formatting + date helpers (ported from the vanilla app, unit taken from the store where needed).
import { dateLocale, t } from './i18n.js'
export const todayISO = () => {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
export const isoOf = d =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')

export const DAYN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// First letter of up to the first two words of a name — the initials shown in an avatar circle
// (Profile's identity card, friend rows, the invite sheet).
export function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase()
}
// Dates in the app deliberately coexist in two shapes: calendar-only values (`YYYY-MM-DD`)
// for workouts/bodyweight, and real timestamps for server-created Social content. Older data
// can also contain an ISO timestamp or a numeric timestamp serialized as a string. Keep the
// calendar-only value at local noon (so timezone conversion cannot move it to the previous day),
// but parse every timestamp as the instant it actually represents.
export function dateValue(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof value !== 'string' || !value.trim()) return null
  const raw = value.trim()
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(raw + 'T12:00:00')
    : /^\d{10,16}$/.test(raw)
      ? new Date(Number(raw))
      : new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}
export const dateSortValue = value => dateValue(value)?.getTime() || 0
export function fmtDate(value, long) {
  const d = dateValue(value)
  if (!d) return '—'
  return d.toLocaleDateString(dateLocale(), long ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' })
}
export function fmtDur(ms) {
  const m = Math.floor(ms / 60000)
  return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min'
}
// Imported history has no clock — an unknown duration is left out rather than shown as "0 min".
export const durPart = ms => (ms >= 60000 ? [fmtDur(ms)] : [])
// Numbers follow the UI language, like the dates above — a hardcoded locale put Swiss
// apostrophes ("7'535 kg") in front of every user, in every language.
// A number that is not a finite number (missing or corrupt data) is never printed as "NaN": it reads as "—". Nothing is invented (no 0).
export const fmtNum = n => (Number.isFinite(Number(n)) ? (Math.round(n * 10) / 10).toLocaleString(dateLocale()) : '—')
// Volume stays in the profile's unit throughout: the old shorthand turned anything over
// 10 000 into "t", which is wrong for a pound profile and made one list mix "18.8t" with
// "7'535 kg" — two numbers you can't compare at a glance.
export const fmtVol = (v, unit) => (Number.isFinite(v) ? fmtNum(v) + ' ' + unit : '—')
// Plural forms are not automatic when the English string is the key.
export const exCount = n => t(n === 1 ? '{0} exercise' : '{0} exercises', n)
export const routineCount = n => t(n === 1 ? '{0} routine' : '{0} routines', n)
export const daysPerWeekLabel = n => t(n === 1 ? '{0} day/week' : '{0} days/week', n)
export const sessionsPerWeekLabel = n => t(n === 1 ? '{0} session/week' : '{0} sessions/week', n)
export const weeksLabel = n => t(n === 1 ? '{0} week' : '{0} weeks', n)
export const supersetCount = n => t(n === 1 ? '{0} superset' : '{0} supersets', n)
export const unavailableCount = n => t(n === 1 ? '{0} exercise unavailable now' : '{0} exercises unavailable now', n)
export const daysScheduledCount = n => t(n === 1 ? '{0} day scheduled' : '{0} days scheduled', n)

// Same computation as api/coach/payload.js's ageFrom — duplicated there for the same reason as
// every other admin/api overlap: the admin page and the api server share no build step.
export function ageFrom(birthDate) {
  if (!birthDate) return null
  const b = new Date(birthDate)
  if (Number.isNaN(b.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - b.getFullYear()
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age--
  return age >= 0 && age < 130 ? age : null
}

export function weekKey(d) {
  const dt = new Date(d + 'T12:00:00')
  const day = (dt.getDay() + 6) % 7
  dt.setDate(dt.getDate() - day + 3)
  const jan4 = new Date(dt.getFullYear(), 0, 4)
  const week = 1 + Math.round(((dt - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7)
  return dt.getFullYear() + '-' + week
}

export const localTZ = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
export const ACCENTS = {
  lime: '#73b52e', grey: '#5E6263', black: '#3a3a3c', sky: '#0a84ff', red: '#ff453a', violet: '#bf5af2',
  orange: '#ff9f0a', yellow: '#ffd60a', teal: '#40c8e0', indigo: '#5e5ce6', pink: '#ff375f'
}

// Liquid glass is part of the look for everyone (it used to be a Settings switch with two dials). Old saved values — glass off, odd
// opacity/blur — are left in the profile but ignored, so nobody can end up stuck on an unreadable or flat setting.
export const LIQUID_GLASS = { on: true, opacity: 35, blur: 45 }
