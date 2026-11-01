import { equipmentIdOf } from './protocol/movements.js'

// Derived views over the existing S.tests records; this module owns no persisted state.
const round1 = value => Math.round(value * 10) / 10
const DAY = 86400000
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').slice(0, 10))

function cleanTests(tests) {
  return (Array.isArray(tests) ? tests : [])
    .filter(test => (test?.type === 'vam' || test?.type === 'erg') && validDate(test.d) && Number.isFinite(Number(test.avgSpeed)) && Number(test.avgSpeed) > 0)
    .map(test => ({ ...test, d: String(test.d).slice(0, 10), avgSpeed: round1(Number(test.avgSpeed)) }))
}

export function vamPaceZones(speed) {
  const vam = Number(speed)
  if (!(vam > 0) || !Number.isFinite(vam)) return []
  // Broad coaching cues only. A field VAM test is not a lab measurement of ventilatory thresholds.
  return [
    { key: 'easy', low: 0.6, high: 0.7 },
    { key: 'aerobic', low: 0.7, high: 0.8 },
    { key: 'steady', low: 0.8, high: 0.9 },
    { key: 'interval', low: 0.9, high: 1.0 }
  ].map(zone => {
    const slow = round1(vam * zone.low)
    const fast = round1(vam * zone.high)
    const pace = kmh => Math.round(3600 / kmh)
    return { ...zone, slow, fast, paceFast: pace(fast), paceSlow: pace(slow) }
  })
}

export function cardioTestGroups(tests, now = Date.now()) {
  const valid = cleanTests(tests)
  const keys = ['vam', ...['row', 'bike', 'ski'].filter(type => valid.some(test => test.type === 'erg' && test.ergType === type)).map(type => `erg:${type}`)]
  return keys.map(key => {
    const groupTests = valid.filter(test => key === 'vam' ? test.type === 'vam' : test.type === 'erg' && `erg:${test.ergType}` === key)
      .sort((a, b) => a.d.localeCompare(b.d))
    if (!groupTests.length) return null
    const latest = groupTests.at(-1)
    const previous = groupTests.at(-2) || null
    const best = groupTests.reduce((winner, test) => !winner || test.avgSpeed > winner.avgSpeed ? test : winner, null)
    const ageDays = Math.max(0, Math.floor((now - new Date(`${latest.d}T00:00:00`).getTime()) / DAY))
    const changePct = previous ? Math.round((latest.avgSpeed / previous.avgSpeed - 1) * 1000) / 10 : null
    return {
      key, type: key === 'vam' ? 'vam' : 'erg', ergType: key.startsWith('erg:') ? key.slice(4) : null,
      latest, previous, best, ageDays, reminder: ageDays >= 56,
      changePct, nextGoal: round1(Math.max(latest.avgSpeed, best.avgSpeed) + Math.max(0.1, best.avgSpeed * 0.01)),
      zones: key === 'vam' && Math.abs(Number(latest.durationSec) - 360) <= 15 ? vamPaceZones(latest.avgSpeed) : []
    }
  }).filter(Boolean)
}

// Workout context is advisory only: VAM applies to the existing canonical treadmill category;
// ergometer results are shown as a same-modality reference, never copied into a workout target.
export function cardioWorkoutReference(tests, exercise, targetSpeed) {
  const equipment = equipmentIdOf(exercise)
  const groups = cardioTestGroups(tests)
  if (equipment === 'treadmill') {
    const vam = groups.find(group => group.type === 'vam' && group.zones.length)
    const ratio = Number(targetSpeed) > 0 && vam ? Number(targetSpeed) / vam.latest.avgSpeed : 0
    const zone = vam?.zones.find(item => ratio >= item.low && ratio <= item.high)
    return zone ? { type: 'vam', zone } : null
  }
  const ergType = equipment === 'bike' ? 'bike' : equipment === 'skierg' ? 'ski' : null
  const erg = ergType && groups.find(group => group.ergType === ergType)
  return erg ? { type: 'erg', latest: erg.latest, nextGoal: erg.nextGoal } : null
}

export const formatPace = seconds => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}/km`
}
