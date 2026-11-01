// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Official news / notices on Home (server: api/lib/news-store.js). Pure helpers: which notices are
// visible now, and a tiny parser for the text format — **bold**, line breaks and [label](https://link).
// The parser returns plain data that React renders as nodes: nothing here ever produces HTML.

export const DEFAULT_ACCENT = '#7bd34a'
export const ACCENT_PRESETS = ['#7bd34a', '#34c759', '#0a84ff', '#ff9f0a', '#ff453a', '#bf5af2']
const HEX = /^#[0-9a-fA-F]{6}$/

export const safeAccent = c => (HEX.test(String(c || '')) ? String(c).toLowerCase() : DEFAULT_ACCENT)

/** Active, already published and not expired. */
export const isVisible = (n, now = Date.now()) =>
  !!n && n.active === true && (!n.publishAt || n.publishAt <= now) && (!n.expiresAt || n.expiresAt > now)

/** The notices to show, by `order` (then creation). */
export const visibleNews = (list, now = Date.now()) =>
  (Array.isArray(list) ? list : []).filter(n => isVisible(n, now)).sort((a, b) => (a.order - b.order) || (a.createdAt - b.createdAt))

/** Why a notice is (not) showing — for the admin list. */
export function newsStatus(n, now = Date.now()) {
  if (!n.active) return 'inactive'
  if (n.publishAt && n.publishAt > now) return 'scheduled'
  if (n.expiresAt && n.expiresAt <= now) return 'expired'
  return 'live'
}

const INLINE = /\*\*([^*\n]+?)\*\*|\[([^\]\n]+?)\]\((https?:\/\/[^\s)]+)\)/g

/** One line → [{ type: 'text'|'bold'|'link', text, href? }]. Only http(s) links become links. */
export function parseLine(line) {
  const out = []
  let last = 0, m
  INLINE.lastIndex = 0
  while ((m = INLINE.exec(line))) {
    if (m.index > last) out.push({ type: 'text', text: line.slice(last, m.index) })
    if (m[1] !== undefined) out.push({ type: 'bold', text: m[1] })
    else out.push({ type: 'link', text: m[2], href: m[3] })
    last = m.index + m[0].length
  }
  if (last < line.length) out.push({ type: 'text', text: line.slice(last) })
  return out
}

/** Whole text → array of lines (empty lines keep their place as a spacer). */
export const parseNewsText = text => String(text ?? '').split('\n').map(parseLine)

/** ms → value for <input type="datetime-local"> (local time), and back. */
export const toLocalInput = ms => {
  if (!ms) return ''
  const d = new Date(ms), p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
export const fromLocalInput = v => { const n = v ? new Date(v).getTime() : NaN; return Number.isFinite(n) ? n : null }
