// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t, nameFor } from '../lib/i18n.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { EXIDX } from '../lib/exercises.js'
import { mediaUrl } from '../lib/media.js'
import { TIER_COLOR, rankLabel, rankEmblemUrl, RANK_GROUP_NAME, RANK_LIFTS } from '../lib/rank.js'
import { BADGES, badgeAccent } from '../lib/badges-data.js'
import { rankSnapshot, personalRecords, unlockedBadges, closestBadges } from '../lib/mi2j.js'
import { streakWeeks } from '../lib/history.js'
import Icon from '../components/Icon.jsx'
import { Avatar, Button } from '../components/ui.jsx'
import { openSocialShare } from '../lib/open-social-share.jsx'
import IntelligenceToday from '../components/IntelligenceToday.jsx'
import { Pill, Stat, CountUp } from '../components/v2.jsx'
import { uxOn } from '../lib/features.js'
import { openStory } from '../components/StorySheet.jsx'

// The carnet: who this member is inside 2J, at a glance. Everything is derived (lib/mi2j.js).
export function Carnet({ S, user, snap, onRanks, compact }) {
  const g = snap.global
  const streak = streakWeeks(S)
  const records = compact ? null : personalRecords(S).length
  // Compact (inside Profile's own entry button): no second identity block — the Profile header
  // already shows the photo and name — and no nested button.
  const RankTag = compact ? 'span' : 'button'
  const rankTag = <RankTag className="carnet-rank" onClick={compact ? undefined : onRanks} aria-label={t('Overall rank') + ': ' + (g.locked ? t('locked') : rankLabel(g))}>
    {g.locked
      ? <><span className="carnet-lock"><Icon name="lock" /><b>{g.rankedCount}/{g.needed}</b></span><span className="carnet-rl">{t('Overall rank')}</span></>
      : <><img src={rankEmblemUrl(g.tier, g.division)} alt="" /><span className="carnet-rl" style={{ color: TIER_COLOR[g.tier] }}>{rankLabel(g)}</span></>}
  </RankTag>
  return <div className={'carnet' + (compact ? ' compact' : '')} style={!g.locked ? { '--carnet': TIER_COLOR[g.tier] } : undefined}>
    {compact ? <div className="carnet-top">{rankTag}</div> : <div className="carnet-top">
      <Avatar name={user?.name || t('Guest')} size={58} image={user?.avatar ? mediaUrl(user.avatar) : null} />
      <div className="carnet-id">
        <div className="carnet-kicker">2J Fitness Center</div>
        <div className="carnet-name">{user?.name || t('Guest')}</div>
        {user?.created && <div className="carnet-since">{t('Member since {0}', fmtDate(user.created.slice(0, 10)))}</div>}
      </div>
      {rankTag}
    </div>}
    <div className="carnet-stats">
      <div><b><Icon name="flame" />{streak}</b><span>{t(streak === 1 ? 'week in a row' : 'weeks in a row')}</span></div>
      <div><b>{S.workouts.length}</b><span>{t('workouts')}</span></div>
      {records != null ? <div><b>{records}</b><span>{t('lifts with a record')}</span></div>
        : <div><b>{snap.rankedCount}/{RANK_LIFTS.length}</b><span>{t('lifts ranked')}</span></div>}
    </div>
  </div>
}

/* Mi 2J V2 — the athlete passport: who this member is inside 2J (identity, standing, constancy, records, achievements). Everything is
   derived from the log (lib/mi2j.js); nothing here invents a level, a score or an achievement. Parts that have no data are simply
   not drawn — a new member sees an identity card and an invitation, an advanced one a full passport. */
export function AthleteHero({ S, user, snap, records, unlockedCount, streak, onRanks }) {
  const g = snap.global
  const tier = !g.locked ? TIER_COLOR[g.tier] : null
  return <section className="v3-pass" style={tier ? { '--tier': tier } : undefined} aria-label={t('Athlete passport')}>
    <div className="v3-pass-bg" aria-hidden="true" />
    <div className="v3-pass-top">
      <span className="v3-pass-k">2J FITNESS CENTER · {t('ATHLETE')}</span>
      {streak >= 1 && <Pill tone="gold" icon="flame">{t(streak === 1 ? '{0} week in a row' : '{0} weeks in a row', streak)}</Pill>}
    </div>
    <div className="v3-pass-id">
      <Avatar name={user?.name || t('Guest')} size={72} image={user?.avatar ? mediaUrl(user.avatar) : null} />
      <div className="v3-pass-who">
        <div className="v3-pass-name">{user?.name || t('Guest')}</div>
        {user?.created && <div className="v3-pass-since">{t('Member since {0}', fmtDate(user.created.slice(0, 10)))}</div>}
      </div>
      {!g.locked && <button type="button" className="v3-pass-rank" onClick={onRanks} aria-label={t('Overall rank') + ': ' + rankLabel(g)}>
        <img src={rankEmblemUrl(g.tier, g.division)} alt="" /><span style={{ color: tier }}>{rankLabel(g)}</span>
      </button>}
    </div>
    {g.locked && <button type="button" className="v3-pass-lock" onClick={onRanks}><Icon name="lock" /><span>{t('Overall rank')} · <b>{g.rankedCount}/{g.needed}</b> {t('lifts ranked')}</span><Icon name="chevronRight" className="chev" /></button>}
    <div className="v3-pass-stats">
      <Stat value={<CountUp value={S.workouts.length} />} label={t('workouts')} />
      {records > 0 && <Stat value={<CountUp value={records} />} label={t('lifts with a record')} tone="gold" />}
      {unlockedCount > 0 && <Stat value={<CountUp value={unlockedCount} />} label={t('achievements')} tone="gold" />}
    </div>
  </section>
}

export default function Mi2J() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const streak = streakWeeks(S)
  // One derivation per history change, not per render.
  const snap = useMemo(() => rankSnapshot(S), [S.workouts, S.bodyweight, S.tests, S.body])
  const records = useMemo(() => personalRecords(S), [S.workouts])
  const unlocked = unlockedBadges(S)
  const near = useMemo(() => closestBadges(S, 2), [S.workouts, S.badges, S.bodyweight])
  const empty = !S.workouts.length
  const byRecent = [...unlocked].sort((a, b) => (a.unlockedAt < b.unlockedAt ? 1 : -1))
  const recent = byRecent.slice(0, 3)
  const special = byRecent.filter(x => badgeAccent(x.badge) === 'gold' && !recent.includes(x)).slice(0, 3)   // the last badge of each category: the rare ones

  const tiles = [
    { to: '/rank', icon: 'shield', title: t('My ranks'), sub: snap.hasBW ? t('{0} of {1} groups ranked', snap.groups.filter(g => g.rank).length, snap.groups.length) : t('Log your bodyweight to start'), art: !snap.global.locked ? rankEmblemUrl(snap.global.tier, snap.global.division) : null },
    { to: '/badges', icon: 'sparkles', title: t('My achievements'), sub: t('{0} of {1} unlocked', unlocked.length, BADGES.length), art: unlocked[0]?.badge.image },
    { to: '/records', icon: 'trophy', title: t('My records'), sub: records.length ? t('{0} exercises', records.length) : t('After your first sessions') },
    { to: '/stats', icon: 'chartLine', title: t('Progress'), sub: t('Charts and history') },
    ...(uxOn(S, 'health') || (S.checkins || []).length ? [{ to: '/seguimiento', icon: 'target', title: t('My follow-up'), sub: t('Goal, reviews and check-ins') }] : []),
  ]
  const badgeBtn = ({ badge, unlockedAt }, extra = '') => <button key={badge.id} className={'m2-badge on' + extra} onClick={() => nav('/badges')}>
    {badge.image ? <img src={badge.image} alt="" /> : <Icon name={badge.icon} />}
    <span className="m2-badge-t">{t(badge.title)}</span>
    <span className="m2-badge-s">{fmtDate(unlockedAt.slice(0, 10))}</span>
  </button>

  return <div className="narrow mi2j v3-mi2j">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/profile')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('My 2J')}</h1></div>
    </div>

    <AthleteHero S={S} user={user} snap={snap} records={records.length} unlockedCount={unlocked.length} streak={streak} onRanks={() => nav('/rank')} />
    {!empty && <div className="v3-pass-acts">
      <Button variant="primary" icon="upload" onClick={() => openStory('month')}>{t('Create my 2J Story')}</Button>
      {streak > 0 && <Button variant="tinted" icon="flame" onClick={() => openSocialShare({ kind: 'streak', targetId: String(streak), title: t('My training streak'), metric: t('{0} weeks in a row', streak), subtitle: t('Consistency in motion'), date: new Date().toISOString().slice(0, 10) })}>{t('Share streak')}</Button>}
    </div>}
    <IntelligenceToday S={S} user={user} max={1} compact types={['PR_RECENT', 'PLATEAU', 'ADHERENCE_GOOD']} />

    {empty ? <div className="card m2-empty">
      <div className="m2-empty-ic"><Icon name="figureStrength" /></div>
      <div className="tt">{t('Your journey starts here')}</div>
      <div className="muted small">{t('Your records, ranks and achievements will appear here as you train.')}</div>
      <Button variant="primary" icon="play" onClick={() => nav('/workout')}>{t('Start training')}</Button>
    </div> : <>
      {snap.groups.some(g => g.rank) && <>
        <h4 className="sec">{t('My ranks')}</h4>
        <div className="m2-ranks" role="list">
          {snap.groups.filter(g => g.rank).map(g => <button role="listitem" key={g.key} className="m2-rank" onClick={() => nav('/rank')}
            aria-label={t(RANK_GROUP_NAME[g.key]) + ': ' + rankLabel(g.rank)}>
            <img src={rankEmblemUrl(g.rank.tier, g.rank.division)} alt="" />
            <span className="m2-rank-g">{t(RANK_GROUP_NAME[g.key])}</span>
            <span className="m2-rank-l" style={{ color: TIER_COLOR[g.rank.tier] }}>{rankLabel(g.rank)}</span>
          </button>)}
        </div>
      </>}

      {records.length > 0 && <>
        <div className="row between v3-sec-row"><h4 className="sec">{t('Latest records')}</h4><button className="v3-link" onClick={() => nav('/records')}>{t('See all')} ({records.length})</button></div>
        <div className="v3-recs">
          {records.slice(0, 3).map((r, i) => <button key={r.id} className={'v3-rec' + (i === 0 ? ' top' : '')} onClick={() => nav('/records')}>
            <span className="v3-rec-ic"><Icon name="trophy" /></span>
            <span className="v3-rec-main"><span className="v3-rec-n capitalize">{EXIDX[r.id] ? nameFor(EXIDX[r.id]) : r.id}</span>
              <span className="v3-rec-d">{fmtDate(r.best.d)}{r.previous ? ' · ' + t('before {0}', fmtNum(r.previous.w) + ' ' + S.unit) : ''}</span></span>
            <span className="v3-rec-v">{fmtNum(r.best.w)}<small> {S.unit} × {r.best.r}</small></span>
          </button>)}
        </div>
      </>}

      {(recent.length > 0 || special.length > 0 || near.length > 0) && <>
        <div className="row between v3-sec-row"><h4 className="sec">{t('Achievements')}</h4><button className="v3-link" onClick={() => nav('/badges')}>{t('See all')} ({unlocked.length})</button></div>
        {recent.length > 0 && <><div className="v3-sub">{t('Recent')}</div><div className="m2-badges">{recent.map(x => badgeBtn(x))}</div></>}
        {special.length > 0 && <><div className="v3-sub gold">{t('Special')}</div><div className="m2-badges">{special.map(x => badgeBtn(x, ' gold'))}</div></>}
        {near.length > 0 && <><div className="v3-sub">{t('Almost there')}</div><div className="m2-badges">
          {near.map(({ badge, progress }) => <button key={badge.id} className="m2-badge" onClick={() => nav('/badges')}>
            {badge.image ? <img src={badge.image} alt="" /> : <Icon name={badge.icon} />}
            <span className="m2-badge-t">{t(badge.title)}</span>
            <span className="v3-near" role="img" aria-label={Math.round(progress * 100) + '%'}><i style={{ width: Math.round(progress * 100) + '%' }} /></span>
            <span className="m2-badge-s">{t('{0}% there', Math.round(progress * 100))}</span>
          </button>)}
        </div></>}
      </>}
    </>}

    <h4 className="sec">{t('Explore')}</h4>
    <div className="m2-tiles">
      {tiles.map(x => <button key={x.to} className="m2-tile" onClick={() => nav(x.to)}>
        <span className="m2-art">{x.art ? <img src={x.art} alt="" /> : <Icon name={x.icon} />}</span>
        <span className="m2-t">{x.title}</span>
        <span className="m2-s">{x.sub}</span>
      </button>)}
    </div>
    <div style={{ height: 20 }} />
  </div>
}
