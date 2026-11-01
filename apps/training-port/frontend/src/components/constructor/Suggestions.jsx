// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// "Sugerencias 2J" — a discreet strip in the builder with blocks that could balance the program
// (lib/block-suggest.js). Suggest → preview → add; nothing is ever changed on its own. Hidden with
// one tap (remembered on this device) and reopened from a small chip.
import { useMemo, useState } from 'react'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { validate } from '../../lib/blocks-api.js'
import { suggestBlocks } from '../../lib/block-suggest.js'
import { unavailableEquipmentList } from '../../lib/exercises.js'
import Icon from '../Icon.jsx'
import { BlockCard, BlockPreview } from './Library.jsx'

const HIDE_KEY = 'cx_suggest_hidden'
const readHidden = () => { try { return localStorage.getItem(HIDE_KEY) === '1' } catch { return false } }
const GROUP = { glutes: 'Glutes', hamstrings: 'Hamstrings', quads: 'Quads', chest: 'Chest', back: 'Back muscles', shoulders: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps', calves: 'Calves', abs: 'Core' }

/**
 * @param v         the program's (or routine's) protocol verdict — its stats.weeklySets are reused
 * @param ctx       { goal, level }
 * @param days      trained days counted in `v`
 * @param blocks    the library (useBlocks)
 * @param inPlan    Set of block ids already copied into the plan (not suggested again)
 * @param restrictions declared restrictions — blocks that FAIL them are never offered
 * @param onAdd(block) insert into the active day (the builder's own addBlock)
 */
export default function Suggestions({ v, ctx, days, blocks, inPlan, restrictions, onAdd, program }) {
  const openSheet = useUI(s => s.openSheet)
  const [hidden, setHidden] = useState(readHidden)
  const list = useMemo(() => suggestBlocks({
    weeklySets: v?.stats?.weeklySets || {}, goal: ctx.goal, level: ctx.level, blocks, days, exclude: inPlan,
    unavailableEq: unavailableEquipmentList(),
    validate: b => validate({ kind: 'block', goal: b.goal, level: b.level, type: b.type, focus: b.focus, entries: b.ex }, { restrictions }),
  }), [v, ctx.goal, ctx.level, blocks, days, inPlan, restrictions])
  if (!list.length) return null
  const hide = h => { setHidden(h); try { if (h) localStorage.setItem(HIDE_KEY, '1'); else localStorage.removeItem(HIDE_KEY) } catch { /* private mode */ } }
  if (hidden) return <button className="cx-sugg-chip" onClick={() => hide(false)}><Icon name="sparkles" />{t('2J suggestions')}<span className="num">{list.length}</span></button>

  const where = program ? t('in this program') : t('in this routine')
  const reason = s => s.status === 'none' ? t('No direct work {0}', where) : t('Little direct presence {0}', where)
  const detail = s => Object.entries(s.sets).map(([g, n]) => `${t(GROUP[g] || g)} ${n}`).join(' · ')
    + ' ' + t('direct sets/week') + (s.envelope ? ' · ' + t('2J reference {0}', `${s.envelope[0]}–${s.envelope[1]}`) : '')
  const open = s => openSheet(close => <div className="cx-sugg-sheet">
    <h3>{t(s.label)}</h3>
    <p className="dim small">{reason(s)} — {detail(s)}. {t('Blocks that fit the goal, level and restrictions of this plan:')}</p>
    <div className="cx-cards">{s.blocks.map(b => <BlockCard key={b.id} b={b}
      onPreview={x => openSheet(c2 => <BlockPreview b={x} close={() => { c2(); close() }} onAdd={onAdd} />)}
      onAdd={x => { close(); onAdd(x) }} />)}</div>
  </div>, { wide: true })

  return <section className="cx-sugg" aria-label={t('2J suggestions')}>
    <header className="cx-sugg-h">
      <Icon name="sparkles" />
      <div className="grow"><b>{t('2J suggestions')}</b><span>{t('Ideas to balance the program — nothing changes unless you add it.')}</span></div>
      <button className="cx-icon sm" aria-label={t('Hide suggestions')} title={t('Hide suggestions')} onClick={() => hide(true)}><Icon name="xmark" /></button>
    </header>
    <ul className="cx-sugg-list">
      {list.map(s => <li key={s.key} className={'cx-sugg-row ' + s.status}>
        <div className="grow">
          <b>{t(s.label)}</b>
          <span>{reason(s)}</span>
          <small className="num">{detail(s)}</small>
        </div>
        <button className="btn plain cx-sugg-go" onClick={() => open(s)}>{t('See blocks')}<Icon name="chevronRight" /></button>
      </li>)}
    </ul>
    <p className="cx-sugg-note">{t('Counts direct sets only: indirect work is not estimated, so treat these as suggestions, not gaps.')}</p>
  </section>
}
