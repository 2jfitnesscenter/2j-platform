// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useRef, useState } from 'react'
import { t, nameFor } from '../lib/i18n.js'
import { EXIDX } from '../lib/exercises.js'
import { fmtNum, fmtDate, todayISO } from '../lib/format.js'
import { TIER_COLOR, rankLabel, rankEmblemUrl, RANK_GROUP_NAME } from '../lib/rank.js'
import { badgeAccent, ACCENT_COLOR_VAR, MASTER_BADGE_IMAGE } from '../lib/badges-data.js'
import { capturePng, sharePng } from '../lib/share-image.js'
import { useBurst } from './BadgeCelebrationModal.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// How one derived post-workout event (lib/mi2j.js's postWorkoutEvents) reads — shared by the
// finish summary, the hero celebration, the "you missed this" recap and Home, so an event is
// described the same way everywhere. Real PRs and estimated 1RMs are worded differently on
// purpose: a heaviest set is something you lifted, an e1RM is a calculation.
const exName = id => EXIDX[id] ? nameFor(EXIDX[id]) : id
const load = (w, r, unit) => fmtNum(w) + ' ' + unit + (r ? ' × ' + r : '')

export function describeEvent(ev, unit) {
  const d = ev.data
  switch (ev.type) {
    case 'pr': return {
      kicker: t('New record'), title: exName(d.exId), result: load(d.now.w, d.now.r, unit),
      detail: t('Before: {0}', load(d.prev.w, d.prev.r, unit)), icon: 'trophy', accent: 'var(--yellow)',
    }
    case 'e1rm': return {
      kicker: t('Best estimated 1RM'), title: exName(d.exId), result: 'e1RM ' + fmtNum(d.est) + ' ' + unit,
      detail: t('From {0} · before e1RM {1}', load(d.w, d.r, unit), fmtNum(d.prev) + ' ' + unit), icon: 'chartLine', accent: 'var(--acc)',
    }
    case 'global': return {
      kicker: d.change === 'new' ? t('Overall rank unlocked') : t('New overall rank'), title: t('Overall rank'),
      result: rankLabel(d.next), detail: d.prev ? rankLabel(d.prev) + ' → ' + rankLabel(d.next) : t('Ranked in enough lifts to count'),
      emblem: rankEmblemUrl(d.next.tier, d.next.division), accent: TIER_COLOR[d.next.tier],
    }
    case 'rank': return {
      kicker: d.change === 'tier' ? t('New rank family!') : d.change === 'new' ? t('First rank') : t('New rank!'),
      title: t(RANK_GROUP_NAME[d.group]), result: rankLabel(d.next),
      detail: d.prev ? rankLabel(d.prev) + ' → ' + rankLabel(d.next) : t('Your first rank in this group'),
      emblem: rankEmblemUrl(d.next.tier, d.next.division), accent: TIER_COLOR[d.next.tier],
    }
    case 'lift': return {
      kicker: t('Exercise rank'), title: exName(d.exId), result: rankLabel(d.next),
      detail: rankLabel(d.prev) + ' → ' + rankLabel(d.next), emblem: rankEmblemUrl(d.next.tier, d.next.division), accent: TIER_COLOR[d.next.tier],
    }
    case 'badge': return {
      kicker: t('Achievement unlocked'), title: t(d.badge.title), result: null, detail: t(d.badge.description),
      image: d.badge.image, icon: d.badge.icon, accent: ACCENT_COLOR_VAR[badgeAccent(d.badge)],
    }
    case 'streak': return {
      kicker: t('Consistency'), title: t('{0} weeks in a row', d.weeks), result: null,
      detail: t('Every week you show up counts.'), icon: 'flame', accent: 'var(--orange)',
    }
    default: return { kicker: '', title: '', result: null, detail: '' }
  }
}
export const shareableEvent = ev => ['pr', 'e1rm', 'rank', 'global', 'badge'].includes(ev.type)

function Art({ v, size = 40 }) {
  if (v.emblem) return <img src={v.emblem} alt="" style={{ width: size, height: size, objectFit: 'contain' }} />
  if (v.image) return <img src={v.image} alt="" style={{ width: size, height: size, objectFit: 'contain' }} />
  return <span className="ev-ic" style={{ '--ev': v.accent }}><Icon name={v.icon || 'sparkles'} /></span>
}

// The branded card a member can choose to share: 2J crest, what kind of achievement, the
// emblem or badge art, the name, the result and the date. No bodyweight, health data or
// trainer notes — only what the event itself is.
export function AchievementShareCard({ v, dateLabel, cardRef }) {
  return <div ref={cardRef} className="badge-sharecard" style={{ '--badge-accent': v.accent }}>
    <div className="bsc-brand"><img src={MASTER_BADGE_IMAGE} alt="" crossOrigin="anonymous" /><span>2J Fitness Center</span></div>
    <div className="bsc-kicker">{v.kicker.toUpperCase()}</div>
    {v.emblem || v.image
      ? <img className="bsc-emblem" src={v.emblem || v.image} alt="" crossOrigin="anonymous" />
      : <div className="bsc-icon"><Icon name={v.icon || 'trophy'} /></div>}
    <div className="bsc-title">{v.title}</div>
    {v.result && <div className="bsc-title" style={{ fontSize: 19, marginTop: 6, color: 'var(--badge-accent)' }}>{v.result}</div>}
    <div className="bsc-description">{v.detail}</div>
    <div className="bsc-date">{dateLabel}</div>
    <div className="bsc-footer">2J FITNESS CENTER · {dateLabel}</div>
  </div>
}

// Explicit, one tap at a time — nothing is ever shared or posted on its own.
export function ShareEventButton({ ev, unit, date, variant = 'ghost', label }) {
  const v = describeEvent(ev, unit)
  const ref = useRef(null)
  const [busy, setBusy] = useState(false)
  const dateLabel = fmtDate(date || todayISO(), true)
  const share = async () => {
    if (busy || !ref.current) return
    setBusy(true)
    try { await sharePng(await capturePng(ref.current), `2J-${ev.type}-${date || todayISO()}.png`, v.title, v.kicker + ' · ' + v.title + (v.result ? ' · ' + v.result : '')) }
    catch { /* dismissed or capture unavailable */ }
    finally { setBusy(false) }
  }
  return <>
    <Button variant={variant} icon="upload" disabled={busy} onClick={share}>{label || t('Share')}</Button>
    <div className="sharecard-capture" aria-hidden="true"><AchievementShareCard v={v} dateLabel={dateLabel} cardRef={ref} /></div>
  </>
}

// One compact row per event — the finish summary shows them all in one list instead of a
// chain of modals.
export function EventRow({ ev, unit, onOpen }) {
  const v = describeEvent(ev, unit)
  return <button className={'evrow ev-' + ev.type + (ev.major ? ' major' : '')} onClick={onOpen} disabled={!onOpen}
    aria-label={v.kicker + ': ' + v.title + (v.result ? ', ' + v.result : '')}>
    <span className="evrow-art"><Art v={v} /></span>
    <span className="evrow-m">
      <span className="evrow-k" style={{ color: v.accent }}>{v.kicker}</span>
      <span className={'evrow-t' + (['pr', 'e1rm', 'lift'].includes(ev.type) ? ' capitalize' : '')}>{v.title}{v.result && <b> · {v.result}</b>}</span>
      {v.detail && <span className="evrow-d">{v.detail}</span>}
    </span>
    {onOpen && <Icon name="chevronRight" className="chev" />}
  </button>
}

export function EventsSummary({ events, unit, onOpen }) {
  if (!events.length) return null
  return <div className="evsum" role="list" aria-label={t('Your progress')}>
    <div className="evsum-h">{t('Your progress')}</div>
    {events.map(ev => <div role="listitem" key={ev.id}><EventRow ev={ev} unit={unit} onOpen={onOpen ? () => onOpen(ev) : null} /></div>)}
  </div>
}

// The protagonist moment, kept for what changes a member's standing: a new rank family or the
// overall rank unlocking. The real emblem, a spring entrance and the same light particle burst
// the badge celebration already uses (none of it under prefers-reduced-motion).
export function RankHero({ ev, unit, date, onContinue, onSeeRanks }) {
  const v = describeEvent(ev, unit)
  const particles = useBurst(ev.id)
  return <div className="badgecel rankhero" style={{ '--hero': v.accent }}>
    <div className="badgecel-burst" aria-hidden="true">
      {particles.map(p => <span key={p.i} className={'badgecel-p' + (p.star ? ' star' : '')}
        style={{ '--dx': p.dx + 'px', '--dy': p.dy + 'px', animationDelay: p.delay + 's', width: p.size, height: p.size, background: v.accent }} />)}
    </div>
    <div className="badgecel-eyebrow" style={{ color: v.accent }}>{v.kicker}</div>
    <img src={v.emblem} alt={v.result} className="badgecel-img rankhero-img" />
    <div className="rankhero-group">{v.title}</div>
    <h2 className="badgecel-title" style={{ color: v.accent }}>{v.result}</h2>
    <div className="badgecel-desc">{v.detail}</div>
    <Button variant="primary" onClick={onContinue} style={{ marginTop: 16 }}>{t('Continue')}</Button>
    <div className="evacts">
      <Button variant="plain" icon="shield" onClick={onSeeRanks}>{t('See my ranks')}</Button>
      <ShareEventButton ev={ev} unit={unit} date={date} variant="plain" />
    </div>
  </div>
}

// A single event opened from a summary row: the same art and wording, with sharing.
export function EventDetail({ ev, unit, date, close, onSee }) {
  const v = describeEvent(ev, unit)
  return <div className="badgecel">
    <div className="badgecel-eyebrow" style={{ color: v.accent }}>{v.kicker}</div>
    <div className="evdetail-art"><Art v={v} size={120} /></div>
    <h2 className="badgecel-title">{v.title}</h2>
    {v.result && <div className="evdetail-result" style={{ color: v.accent }}>{v.result}</div>}
    <div className="badgecel-desc">{v.detail}</div>
    {ev.type === 'badge' && <div className="badgecel-date">{fmtDate(ev.data.unlockedAt.slice(0, 10), true)}</div>}
    <Button variant="primary" onClick={close} style={{ marginTop: 16 }}>{t('Close')}</Button>
    <div className="evacts">
      {onSee && <Button variant="plain" onClick={onSee}>{ev.type === 'badge' ? t('See my achievements') : ev.type === 'pr' || ev.type === 'e1rm' ? t('See my records') : t('See my ranks')}</Button>}
      {shareableEvent(ev) && <ShareEventButton ev={ev} unit={unit} date={date} variant="plain" />}
    </div>
  </div>
}
