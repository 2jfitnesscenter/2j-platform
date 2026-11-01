// The card renderer accepts only this allow-list. Names, dates and metrics are supplied by the
// specific share action; health or profile objects can never be spread into a render payload.
import { t } from './i18n.js'
const clean = (value, max) => String(value || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max)
export function socialCardPayload(kind, value = {}) {
  const types = new Set(['routine', 'program', 'record', 'challenge', 'workout', 'achievement', 'streak'])
  if (!types.has(kind)) throw new Error('Unsupported social share type')
  const items = (Array.isArray(value.items) ? value.items : []).slice(0, 12).map(x => clean(x, 40)).filter(Boolean)
  const facts = (Array.isArray(value.facts) ? value.facts : []).slice(0, 4).map(x => clean(x, 30)).filter(Boolean)
  return Object.freeze({
    kind,
    title: clean(value.title, 80),
    subtitle: clean(value.subtitle, 100),
    metric: clean(value.metric, 80),
    date: clean(value.date, 40),
    // A program card lists its routines and a few facts; nothing else can ride along.
    ...(items.length ? { items } : {}),
    ...(facts.length ? { facts } : {})
  })
}

/** The optional numbers a member added to a shared workout, as short labels. Only the four known keys are ever read. */
export function extrasText(extras) {
  if (!extras || typeof extras !== 'object') return []
  const out = []
  if (Number.isFinite(extras.duration)) out.push(t('{0} min', extras.duration))
  if (Number.isFinite(extras.volume)) out.push(t('{0} {1} lifted', extras.volume.toLocaleString(), extras.unit === 'lb' ? 'lb' : 'kg'))
  if (Number.isFinite(extras.prs)) out.push(extras.prs === 1 ? t('1 record') : t('{0} records', extras.prs))
  if (Number.isFinite(extras.cardio)) out.push(t('{0} min cardio', extras.cardio))
  return out
}
