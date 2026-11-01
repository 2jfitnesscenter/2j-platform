// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { forwardRef } from 'react'
import { t, dateLocale } from '../lib/i18n.js'
import { fmtNum, fmtDate } from '../lib/format.js'
import Icon from './Icon.jsx'

/* The 2J Story card (9:16): a week or a month as a poster, not a report. Plain props in (lib/story.js decides WHAT shows, from
   real data only), fixed palette and no blur so the exported PNG equals the screen. Gold appears only on records, streaks and
   achievements. Weight appears only when the member explicitly chose to include it. */
const STAT_LABEL = { minutes: 'min trained', volume: 'Volume', sets: 'Sets', prs: 'PRs', streak: 'week streak' }

const StoryCard = forwardRef(function StoryCard({ story, className = '' }, ref) {
  if (!story || story.empty) return null
  const { range, period } = story
  const label = period === 'week'
    ? `${fmtDate(range.from)} – ${fmtDate(range.to)}`
    : new Date(range.from + 'T12:00:00').toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' })
  return <div ref={ref} className={'v3-story ' + className} data-period={period}>
    <div className="v3-story-top">
      <span className="v3-story-brand"><img src="/brand/logo-mark.png" alt="" crossOrigin="anonymous" />2J FITNESS</span>
      <span className="v3-story-period">{t(period === 'week' ? 'My week' : 'My month')}</span>
    </div>
    <div className="v3-story-range">{label.charAt(0).toUpperCase() + label.slice(1)}</div>

    <div className="v3-story-hero">
      <span className="v3-story-num">{story.hero.value}</span>
      <span className="v3-story-lbl">{t(story.hero.value === 1 ? 'workout' : 'workouts')}</span>
      {story.hero.prev != null && story.hero.value !== story.hero.prev && <span className="v3-story-vs">{story.hero.value > story.hero.prev ? '+' : '−'}{Math.abs(story.hero.value - story.hero.prev)} {t(period === 'week' ? 'vs last week' : 'vs last month')}</span>}
    </div>

    {story.stats.length > 0 && <div className={'v3-story-stats n' + story.stats.length}>
      {story.stats.map(s => <div key={s.key} className={'v3-story-stat' + (s.gold ? ' gold' : '')}>
        <b>{fmtNum(s.v)}{s.unit ? <small> {s.unit}</small> : null}</b>
        <span>{t(STAT_LABEL[s.key])}{s.delta != null ? ` · ${s.delta > 0 ? '+' : ''}${s.delta}%` : ''}</span>
      </div>)}
    </div>}

    {story.highlight && <div className={'v3-story-hl' + (story.highlight.gold ? ' gold' : '')}>
      <Icon name={story.highlight.gold ? 'trophy' : 'sparkles'} />
      <span><b className="capitalize">{story.highlight.title}</b>{story.highlight.value ? ' · ' + story.highlight.value : ''}</span>
    </div>}

    {story.muscles.length > 0 && <div className="v3-story-muscles">{story.muscles.map(m => <span key={m.slug} className="capitalize">{t(m.name)}</span>)}</div>}
    {story.program && <div className="v3-story-prog"><Icon name="calendar" />{story.program}</div>}
    {story.body && <div className="v3-story-body"><Icon name="scale" />{t('Weight')} {(story.body.delta > 0 ? '+' : story.body.delta < 0 ? '−' : '±') + fmtNum(Math.abs(story.body.delta))} {story.body.unit}</div>}

    <div className="v3-story-foot"><span>2J · KEEP MOVING</span></div>
  </div>
})
export default StoryCard
