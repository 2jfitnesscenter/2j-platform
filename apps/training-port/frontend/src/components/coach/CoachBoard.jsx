// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { fmtDate } from '../../lib/format.js'
import { mediaUrl } from '../../lib/media.js'
import { fetchBoard, goalName, signalText, agoText, inText, LEVEL } from '../../lib/coach-followup.js'
import Icon from '../Icon.jsx'
import { Surface, Pill, ListSkeleton, EmptyState } from '../v2.jsx'
import { Button, Avatar } from '../ui.jsx'
import { runLabel } from '../../lib/premium-text.js'
import './coach-followup.css'

/* Seguimiento (staff): who needs attention, why, and what changed — in one request. The server computes this for all active centre members. */
const TABS = [['attention', 'Need attention'], ['upcoming', 'Upcoming reviews'], ['stable', 'Stable follow-up']]

function Metric({ label, value, sub }) {
  return <div className="cf-m"><span className="k">{label}</span><span className="v">{value}</span>{sub && <span className="s">{sub}</span>}</div>
}

export function MemberCard({ r, open }) {
  const lv = LEVEL[r.level] || LEVEL.normal
  const goal = goalName(r.goal)
  const a = r.adherence
  const top = r.signals[0]
  return <Surface className={'cf-card ' + r.level} as="article" aria-label={r.name}>
    <div className="cf-card-top">
      <Avatar name={r.name} size={44} image={r.avatar ? mediaUrl(r.avatar) : null} />
      <div className="cf-who">
        <div className="tt capitalize">{r.name}</div>
        <div className="small dim">{goal || t('No goal set')}{r.goal.priority === 'high' && ' · ' + t('High priority')}</div>
        {r.opposition && <div className="small dim cf-premium-line"><Icon name="flag" /> {r.opposition.name} · {t('{0} weeks left', r.opposition.weeksLeft)}{r.opposition.review ? ' · ' + t('Review') : ''}</div>}
        {r.premium && <div className="small dim cf-premium-line"><Icon name="trophy" /> {runLabel(r.premium)}{r.premium.status === 'paused' ? ' · ' + t('Paused') : ''}</div>}
      </div>
      <Pill tone={lv.tone === 'acc' ? 'acc' : undefined} className={'cf-lv ' + r.level}><i className="dot" aria-hidden="true" />{t(lv.word)}</Pill>
    </div>
    {top ? <p className="cf-why">{signalText(top)}{r.signalCount > 1 && <small> · {t('+{0} more', r.signalCount - 1)}</small>}</p>
      : <p className="cf-why calm">{t(r.lastWorkout ? 'Nothing to review right now.' : 'No workouts yet.')}</p>}
    <div className="cf-metrics">
      <Metric label={t('Adherence')} value={a.pct28 != null ? a.pct28 + '%' : '—'} sub={a.planned28 ? t('{0} of {1} sessions', a.done28, a.planned28) : a.done28 ? t('{0} sessions', a.done28) : null} />
      <Metric label={t('Last session')} value={r.daysSince != null ? agoText(r.daysSince) : '—'} />
      <Metric label={t('Next review')} value={r.nextReview ? fmtDate(r.nextReview) : '—'} sub={r.reviewIn == null ? null : r.reviewIn < 0 ? t('Overdue') : r.reviewIn <= 7 ? inText(r.reviewIn) : null} />
    </div>
    <div className="cf-acts">
      {r.flagged && <Pill icon="flag" className="nocap">{t('Marked')}</Pill>}
      <Button size="sm" variant="primary" icon="chartLine" onClick={() => open(r.id)}>{t('View follow-up')}</Button>
    </div>
  </Surface>
}

/** The first tab with someone in it: attention, then upcoming reviews, then stable. */
export const defaultTab = d => (d.counts.attention ? 'attention' : d.counts.upcoming ? 'upcoming' : 'stable')

/** The tiles and the cards (pure: the data comes from the loader below, so it renders the same in tests). */
export function BoardBody({ d, shown, q = '', onTab = () => {}, onQuery = () => {}, open = () => {} }) {
  const total = d.counts.attention + d.counts.upcoming + d.counts.stable
  const list = (() => {
    const rows = d[shown] || []
    const s = q.trim().toLowerCase()
    return s ? rows.filter(r => r.name.toLowerCase().includes(s)) : rows
  })()
  return <>
      <div className="cf-tiles" role="tablist" aria-label={t('Follow-up')}>
        {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={shown === k} className={'cf-tile ' + k + (shown === k ? ' on' : '')} onClick={() => onTab(k)}>
          <b>{d.counts[k]}</b><span>{t(label)}</span></button>)}
      </div>
      {total > 8 && <input className="input cf-search" type="search" aria-label={t('Search a member…')} placeholder={t('Search a member…')} value={q} onChange={e => onQuery(e.target.value)} />}
      {total === 0 ? <EmptyState icon="users" title={t('No members yet')}>
        <div className="muted small">{t('Members appear here once they join.')}</div></EmptyState>
        : list.length === 0 ? <EmptyState icon="checkCircle" title={t(shown === 'attention' ? 'Nobody needs attention' : shown === 'upcoming' ? 'No reviews in the next 7 days' : 'Nobody here yet')} />
          : <div className="cf-grid">{list.map(r => <MemberCard key={r.id} r={r} open={open} />)}</div>}
  </>
}

export default function CoachBoard({ base, back, title }) {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [d, setD] = useState(null)
  const [tab, setTab] = useState(null)
  const [q, setQ] = useState('')
  useEffect(() => { fetchBoard().then(setD).catch(e => { toast(e.message || t('Failed to load')); setD({ counts: { attention: 0, upcoming: 0, stable: 0 }, attention: [], upcoming: [], stable: [], assigned: 0, error: true }) }) }, [])
  return <div className="cf-wrap">
    <div className="hdr">
      {back && <button className="iconbtn" onClick={() => nav(back)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>}
      <div style={{ flex: 1, marginLeft: back ? 8 : 0 }}><h1>{title || t('Follow-up')}</h1><div className="sub">{t('Who needs attention today, and why')}</div></div>
    </div>
    {!d ? <ListSkeleton rows={3} /> : <BoardBody d={d} shown={tab || defaultTab(d)} q={q} onTab={setTab} onQuery={setQ} open={id => nav(base + '/' + id)} />}
  </div>
}
