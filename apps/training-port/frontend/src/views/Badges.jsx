// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BADGES } from '../lib/badges-data.js'
import { unlockedBadges, closestBadges } from '../lib/mi2j.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { BADGE_CATEGORIES, CATEGORY_LABEL, CATEGORY_ICON, CATEGORY_IMAGE, BADGES_BY_CATEGORY, MASTER_BADGE_IMAGE } from '../lib/badges-data.js'
import { evaluateBadges } from '../lib/badges.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { openSocialShare } from '../lib/open-social-share.jsx'

// The illustrated PNG when a badge/category has one (every category but 'exercises', see
// badges-data.js), falling back to the old SVG icon registry otherwise — one place for that
// choice so BadgeCell/BadgeDetail/CategoryHeader/the category strip don't each repeat it.
function BadgeArt({ image, icon }) {
  return image ? <img src={image} alt="" loading="lazy" /> : <Icon name={icon} />
}

// Tap-to-expand detail — description, and how close you are if it's still locked (the
// percentage the grid cell itself only hints at with a sliver of progress bar).
function BadgeDetail({ b, state, close }) {
  const unlocked = !!state?.unlockedAt
  const pct = Math.round((state?.progress || 0) * 100)
  return <div style={{ textAlign: 'center', padding: '8px 0' }}>
    <span className={'badgecell-i' + (b.image ? ' img' : '') + (unlocked ? ' on' : '')} style={{ width: 84, height: 84, fontSize: 36, margin: '0 auto 14px' }}>
      <BadgeArt image={b.image} icon={b.icon} />
      {!unlocked && <span className="badgecell-lock" style={{ width: 28, height: 28, fontSize: 14 }}><Icon name="lock" /></span>}
    </span>
    <h3 style={{ margin: '0 0 6px' }}>{t(b.title)}</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 16 }}>{t(b.description)}</div>
    {unlocked ? (
      <>
      <div className="tag acc nocap" style={{ display: 'inline-flex' }}>{t('Unlocked {0}', fmtDate(state.unlockedAt.slice(0, 10), true))}</div>
      <div style={{ height: 12 }} /><Button variant="tinted" icon="upload" onClick={() => openSocialShare({ kind: 'achievement', targetId: b.id, title: t(b.title), metric: t('Achievement unlocked'), subtitle: t(b.description), date: fmtDate(state.unlockedAt.slice(0, 10), true) })}>{t('Share')}</Button>
      </>
    ) : (
      <>
        <div className="badgecell-bar" style={{ marginBottom: 6 }}><i style={{ width: pct + '%' }} /></div>
        <div className="dim small">{t('{0}% there', pct)}</div>
      </>
    )}
    <div style={{ height: 16 }} />
    <Button onClick={close}>{t('Close')}</Button>
  </div>
}
const badgeDetailSheet = (b, state) => useUI.getState().openSheet(close => <BadgeDetail b={b} state={state} close={close} />, { kind: 'center' })

function BadgeCell({ b, state }) {
  const unlocked = !!state?.unlockedAt
  const pct = Math.round((state?.progress || 0) * 100)
  return (
    <button className={'badgecell' + (unlocked ? ' on' : '')} onClick={() => badgeDetailSheet(b, state)}>
      <span className={'badgecell-i' + (b.image ? ' img' : '') + (unlocked ? ' on' : '')}>
        <BadgeArt image={b.image} icon={b.icon} />
        {!unlocked && <span className="badgecell-lock"><Icon name="lock" /></span>}
      </span>
      <span className="badgecell-t">{t(b.title)}</span>
      {unlocked
        ? <span className="badgecell-s">{fmtDate(state.unlockedAt.slice(0, 10))}</span>
        : <span className="badgecell-s">{t(b.description)}</span>}
      {!unlocked && pct > 0 && <div className="badgecell-bar"><i style={{ width: pct + '%' }} /></div>}
    </button>
  )
}

// A category's own header — its representative badge (the first one in it, biggest/brightest
// among its siblings — usually the lowest threshold, so it's realistically unlocked early)
// blown up large, plus how many of the category are unlocked so far.
function CategoryHeader({ cat, list, unlockedCount }) {
  const rep = list[0]
  const catImg = CATEGORY_IMAGE[cat]
  // Always full color, unlike a BadgeCell — this is the category's own cover art, not a
  // specific badge's unlock state, so there's no "locked" reading for it to apply here.
  return <div className="card" style={{ textAlign: 'center', marginBottom: 16 }}>
    <span className={'badgecell-i' + (catImg ? ' img on' : '')} style={{ width: 72, height: 72, fontSize: 30, margin: '0 auto 10px' }}>
      <BadgeArt image={catImg} icon={CATEGORY_ICON[cat]} />
    </span>
    <h2 style={{ margin: '0 0 4px' }}>{t(CATEGORY_LABEL[cat])}</h2>
    <div className="muted small">{rep ? t(rep.description) : null}</div>
    <div className="dim small" style={{ marginTop: 6 }}>{t('{0} of {1} unlocked', unlockedCount, list.length)}</div>
  </div>
}

// The gym's own crest — presides over the whole screen, above the category strip and grid,
// not tied to any one member's progress (no lock state, no unlock condition; see
// badges-data.js's MASTER_BADGE_IMAGE comment).
function MasterBadgeHero() {
  return <div className="badgemaster">
    <img src={MASTER_BADGE_IMAGE} alt="" className="badgemaster-img" loading="lazy" />
    <div className="badgemaster-label">{t('2J Fitness Center • Official rank')}</div>
  </div>
}

export default function Badges() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)

  // Catches up an existing profile's history the first time this screen opens — silently
  // (no celebration; see sheets.jsx's celebrateBadges, which only fires from a live finish
  // or a fresh import) — so someone who already had 50 workouts logged before this feature
  // shipped sees them correctly unlocked instead of waiting for their next session.
  useEffect(() => {
    const { badges, newlyUnlocked } = evaluateBadges(S)
    if (newlyUnlocked.length) update(s => { s.badges = badges }, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cats = BADGE_CATEGORIES.filter(c => BADGES_BY_CATEGORY[c].length)
  const [cat, setCat] = useState(cats[0])
  const list = BADGES_BY_CATEGORY[cat] || []
  const unlockedCount = list.filter(b => S.badges?.[b.id]?.unlockedAt).length

  const recent = unlockedBadges(S).slice(0, 3)
  const near = closestBadges(S, 3)
  const total = BADGES.length
  const unlockedTotal = Object.values(S.badges || {}).filter(x => x.unlockedAt).length

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/mi2j')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('My achievements')}</h1></div>
    </div>

    <MasterBadgeHero />

    <div className="card bg-sum">
      <div className="bg-count"><b>{unlockedTotal}</b><span>/ {total}</span></div>
      <div className="muted small">{t('achievements unlocked')}</div>
      <div className="rk-bar" style={{ marginTop: 8 }}><i style={{ width: Math.round(unlockedTotal / total * 100) + '%', background: 'var(--acc)' }} /></div>
    </div>
    {recent.length > 0 && <>
      <h4 className="sec">{t('Unlocked recently')}</h4>
      <div className="badgegrid">{recent.map(({ badge }) => <BadgeCell key={badge.id} b={badge} state={S.badges?.[badge.id]} />)}</div>
    </>}
    {near.length > 0 && <>
      <h4 className="sec">{t('Close to unlocking')}</h4>
      <div className="badgegrid">{near.map(({ badge }) => <BadgeCell key={badge.id} b={badge} state={{ ...(S.badges?.[badge.id] || {}), progress: near.find(x => x.badge.id === badge.id).progress }} />)}</div>
    </>}
    <h4 className="sec">{t('All achievements')}</h4>

    <div className="mstrip">
      {cats.map(c => {
        const n = BADGES_BY_CATEGORY[c].filter(b => S.badges?.[b.id]?.unlockedAt).length
        return (
          <button key={c} className={'mstrip-i' + (cat === c ? ' on' : '')} onClick={() => setCat(c)}>
            <span className="mstrip-photo mstrip-photo-plain"><BadgeArt image={CATEGORY_IMAGE[c]} icon={CATEGORY_ICON[c]} /></span>
            <span className="mstrip-name">{t(CATEGORY_LABEL[c])} ({n}/{BADGES_BY_CATEGORY[c].length})</span>
          </button>
        )
      })}
    </div>
    <div style={{ height: 10 }} />

    <CategoryHeader cat={cat} list={list} unlockedCount={unlockedCount} />

    <div className="badgegrid">
      {list.map(b => <BadgeCell key={b.id} b={b} state={S.badges?.[b.id]} />)}
    </div>
    <div style={{ height: 20 }} />
  </div>
}
