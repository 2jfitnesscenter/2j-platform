// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, nameFor } from '../lib/i18n.js'
import { lastBW } from '../lib/history.js'
import { musclesOf, MUSCLE_NAME } from '../lib/muscles.js'
import { EXIDX } from '../lib/exercises.js'
import {
  TIERS, DIVISIONS, RANK_LIFTS, RANK_GROUPS, RANK_GROUP_KEYS, RANK_GROUP_NAME,
  liftRatio, rankOfLift, muscleRank, groupRank, globalRank, TIER_COLOR, rankLabel, rankEmblemUrl,
} from '../lib/rank.js'
import { rankSnapshot, nextRankOf, rankProgress } from '../lib/mi2j.js'
import Icon from '../components/Icon.jsx'
import BodyMap from '../components/BodyMap.jsx'
import { Button } from '../components/ui.jsx'
import { bwSheet } from '../sheets.jsx'

function RankBadge({ rank, small }) {
  if (!rank) return <span className="dim small">{t('No data yet')}</span>
  const size = small ? 22 : 28
  return <span className="row" style={{ gap: 6, color: TIER_COLOR[rank.tier], flex: 'none' }}>
    <img src={rankEmblemUrl(rank.tier, rank.division)} alt="" style={{ width: size, height: size, objectFit: 'contain', flex: 'none' }} />
    <span className="small" style={{ fontWeight: 600 }}>{rankLabel(rank)}</span>
  </span>
}

// Also opened straight from Settings ("Rangos") for anyone who wants to read how the system
// works without having logged a single set yet — so this never assumes S/bodyweight exist.
export function RankGuideSheet() {
  return <>
    <h3>{t('How strength rank works')}</h3>
    <h4 className="sec" style={{ marginTop: 0 }}>{t('About')}</h4>
    <div className="small dim" style={{ lineHeight: 1.5, marginBottom: 14 }}>
      {t('Your rank in each lift comes from your best set, weighed against your bodyweight — the same idea powerlifting uses to compare weight classes, so a lighter and a heavier lifter compete fairly. No need to test a true max: your normal working sets are enough.')}
    </div>
    <h4 className="sec">{t('How it’s calculated')}</h4>
    <div className="small dim" style={{ lineHeight: 1.5, marginBottom: 14 }}>
      {t('Exercise ranks that train a muscle combine into that muscle\'s rank, weighing exercises with more sets more heavily. Muscles combine into a group rank (chest, back, shoulders, arms, legs, core), and every group combines into one overall rank — a complete physique outweighs a single strong lift.')}
    </div>
    <h4 className="sec">{t('The 9 tiers')}</h4>
    <div className="small dim" style={{ lineHeight: 1.5, marginBottom: 10 }}>
      {t('From {0} to {1}, each with three divisions — I, II and III. You move up a division, then the next one, before moving into the next tier. {2} is the top, for the very strongest lifts, and has no divisions.', t('Iron'), t('Champion'), t('Symmetric'))}
    </div>
    {/* A vertical list instead of a horizontal strip: nothing to swipe past or cut off at the
        edge, and every tier shows its three divisions (or none, for the top tier) right there —
        the actual answer to "what is each one", not just a name. */}
    <div className="list" style={{ marginBottom: 4 }}>
      {TIERS.map(tier => <div key={tier} className="item">
        <div className="grow"><span className="tt" style={{ color: TIER_COLOR[tier] }}>{t(tier)}</span></div>
        <div className="row" style={{ gap: 5, flex: 'none' }}>
          {tier === 'Symmetric'
            ? <img src={rankEmblemUrl(tier, null)} alt="" style={{ width: 32, height: 32, objectFit: 'contain' }} />
            : DIVISIONS.map(d => <img key={d} src={rankEmblemUrl(tier, d)} alt={d} title={t(tier) + ' ' + d} style={{ width: 28, height: 28, objectFit: 'contain' }} />)}
        </div>
      </div>)}
    </div>
    <h4 className="sec">{t('What you need')}</h4>
    <div className="small dim" style={{ lineHeight: 1.5, marginBottom: 14 }}>
      {t('Log your bodyweight, then log sets for any of {0} curated lifts (bench press, squat, deadlift, overhead press, pull-up, chin-up, dip, row, romanian deadlift, curl, calf raise) — each ranks on its own as soon as it has one. The overall rank needs at least {1} of them.', RANK_LIFTS.length, 6)}
    </div>
    <h4 className="sec">{t('Keep in mind')}</h4>
    <div className="small dim" style={{ lineHeight: 1.5 }}>
      {t('Ranks are checked against published strength standards, not against this gym\'s own members — there aren\'t enough accounts here for a real comparison yet. Treat the tiers as a rough guide and not a certified measurement.')}
    </div>
  </>
}

// Where you are, what it means, what moves you on: the rank of the whole group and how far
// into its division it is (lib/rank.js is continuous underneath, so the bar is a real number),
// the next division, and the lifts that make it up. `progress` is shown only for a ranked group.
function RankProgress({ rank, next, progress }) {
  if (!rank) return null
  return <div className="rk-prog">
    <div className="rk-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}
      aria-label={next ? t('Towards {0}', rankLabel(next)) : t('Top rank')}>
      <i style={{ width: Math.round(progress * 100) + '%', background: TIER_COLOR[rank.tier] }} />
    </div>
    <div className="rk-next">{next ? t('Next: {0}', rankLabel(next)) : t('Top rank')}</div>
  </div>
}

export default function Rank() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const openSheet = useUI(s => s.openSheet)
  const [openGroup, setOpenGroup] = useState(null)
  const [openMuscle, setOpenMuscle] = useState(null)
  const snap = useMemo(() => rankSnapshot(S), [S.workouts, S.bodyweight, S.tests, S.body])

  const bw = lastBW(S)

  const header = <div className="hdr">
    <button className="iconbtn" onClick={() => nav('/mi2j')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
    <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('My ranks')}</h1></div>
    <button className="iconbtn" onClick={() => openSheet(() => <RankGuideSheet />)} aria-label={t('How strength rank works')}><Icon name="info" /></button>
  </div>

  if (!bw) return <div className="narrow">
    {header}
    <div className="card m2-empty">
      <div className="m2-empty-ic"><Icon name="shield" /></div>
      <div className="tt">{t('Log your bodyweight to see your strength rank')}</div>
      <div className="muted small">{t('Ranks compare your best sets with your bodyweight, lift by lift. Your normal working sets are enough.')}</div>
      <Button icon="scale" onClick={() => bwSheet()}>{t('Log my weight')}</Button>
    </div>
  </div>

  const global = snap.global
  const colorOf = slug => { const r = muscleRank(S, slug, snap.lifts); return r ? TIER_COLOR[r.tier] : 'var(--surface-3)' }
  const unranked = snap.lifts.filter(l => !l.rank).map(l => EXIDX[l.id] ? nameFor(EXIDX[l.id]) : l.id)
  const missing = Math.max(0, global.needed - global.rankedCount)

  return <div className="narrow">
    {header}

    <div className="card rk-global" style={!global.locked ? { '--rk': TIER_COLOR[global.tier] } : undefined}>
      {global.locked ? <>
        <div className="rk-lock"><Icon name="lock" /></div>
        <div className="tt" style={{ fontWeight: 700 }}>{t('Overall rank')}</div>
        <div className="muted small">{t('Ranked {0} of {1} exercises', global.rankedCount, RANK_LIFTS.length)}</div>
        <div className="rk-bar" style={{ margin: '10px auto 6px', maxWidth: 260 }} role="progressbar" aria-valuemin={0} aria-valuemax={global.needed} aria-valuenow={global.rankedCount}>
          <i style={{ width: Math.round(global.rankedCount / global.needed * 100) + '%', background: 'var(--acc)' }} />
        </div>
        <div className="small">{t(missing === 1 ? 'Log a mark in 1 more exercise to unlock your overall rank.' : 'Log a mark in {0} more exercises to unlock your overall rank.', missing)}</div>
        {unranked.length > 0 && <div className="rk-chips">{unranked.map(n => <span key={n} className="tag capitalize">{n}</span>)}</div>}
      </> : <>
        <img src={rankEmblemUrl(global.tier, global.division)} alt="" className="rk-emblem" />
        <div className="rk-label" style={{ color: TIER_COLOR[global.tier] }}>{rankLabel(global)}</div>
        <div className="muted small">{t('Overall rank')} · {t('Ranked {0} of {1} exercises', global.rankedCount, RANK_LIFTS.length)}</div>
        <RankProgress rank={global} next={nextRankOf(global)} progress={rankProgress(global)} />
      </>}
    </div>

    <BodyMap colorOf={colorOf} body={S.body} />

    <div style={{ height: 8 }} />
    {snap.groups.map(({ key: g, rank: gr, next, progress, contributing, trainable }) => {
      const isOpen = openGroup === g
      return <div key={g} className="card rk-group" style={{ marginBottom: 10 }}>
        <button className="rk-group-h" onClick={() => { setOpenGroup(isOpen ? null : g); setOpenMuscle(null) }} aria-expanded={isOpen}>
          {gr ? <img src={rankEmblemUrl(gr.tier, gr.division)} alt="" className="rk-group-em" /> : <span className="rk-group-em none"><Icon name="shield" /></span>}
          <span className="rk-group-m">
            <span className="tt">{t(RANK_GROUP_NAME[g])}</span>
            {gr ? <span className="rk-group-l" style={{ color: TIER_COLOR[gr.tier] }}>{rankLabel(gr)}</span>
              : <span className="dim small">{t('No data yet')}</span>}
          </span>
          <Icon name={isOpen ? 'chevronUp' : 'chevronDown'} style={{ fontSize: 14 }} />
        </button>
        <RankProgress rank={gr} next={next} progress={progress} />
        {gr && contributing.length > 0 && <div className="rk-lifts">{contributing.map(l => <span key={l.id} className="capitalize">{EXIDX[l.id] ? nameFor(EXIDX[l.id]) : l.id}</span>)}</div>}
        {!gr && trainable.length > 0 && <div className="small dim" style={{ marginTop: 6 }}>
          {t('Log any of: {0}', trainable.map(id => EXIDX[id] ? nameFor(EXIDX[id]) : id).join(', '))}
        </div>}
        {isOpen && <div style={{ marginTop: 8 }}>
          {RANK_GROUPS[g].map(slug => {
            const mr = muscleRank(S, slug, snap.lifts)
            const mOpen = openMuscle === slug
            const lifts = RANK_LIFTS.filter(l => (musclesOf(EXIDX[l.id]) || {})[slug])
            return <div key={slug} style={{ borderTop: 'var(--hair) solid var(--sep)' }}>
              <button className="row between" style={{ width: '100%', padding: '10px 0' }} onClick={() => setOpenMuscle(mOpen ? null : slug)}>
                <span className="small" style={{ fontWeight: 600 }}>{t(MUSCLE_NAME[slug])}</span>
                <span className="row" style={{ gap: 10 }}>
                  <RankBadge rank={mr} small />
                  {lifts.length > 0 && <Icon name={mOpen ? 'chevronUp' : 'chevronDown'} style={{ fontSize: 12 }} />}
                </span>
              </button>
              {mOpen && (lifts.length ? <div style={{ paddingBottom: 8 }}>
                {lifts.map(l => {
                  const ex = EXIDX[l.id]
                  const lr = rankOfLift(l.id, liftRatio(S, l.id), S.body)
                  return <div key={l.id} className="row between" style={{ padding: '5px 0 5px 10px' }}>
                    <span className="small capitalize">{nameFor(ex)}</span>
                    <RankBadge rank={lr} small />
                  </div>
                })}
              </div> : <div className="small dim" style={{ paddingBottom: 8 }}>{t('No data yet')}</div>)}
            </div>
          })}
        </div>}
      </div>
    })}
    <div style={{ height: 20 }} />
  </div>
}
