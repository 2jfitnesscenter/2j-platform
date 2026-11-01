// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared pieces of the Entrena con 2J Studio: status pill, row menu, searchable routine picker and
// the three-step first-use guide (reopenable from the header).
import { useMemo, useState } from 'react'
import { t } from '../../../lib/i18n.js'
import { statusOf, STATUS_LABEL, filterAdmin } from '../../../lib/studio.js'
import { CATEGORY_LABEL, LEVEL_LABEL } from '../../../lib/protocol/index.js'
import WorkoutCover from '../../../components/WorkoutCover.jsx'
import { Switch } from '../../../components/ui.jsx'
import Icon from '../../../components/Icon.jsx'
import './studio.css'

export function StatusPill({ x }) {
  const s = statusOf(x)
  return <span className={'st-pill ' + s}><i />{t(STATUS_LABEL[s])}</span>
}

/** Direct visibility control of a row: ON = visible to members, OFF = hidden. A hidden or draft row also shows its chip. */
export function VisibilityControl({ x, onToggle, busy, name }) {
  const on = statusOf(x) === 'active'
  return <span className="st-vis">
    {!on && <StatusPill x={x} />}
    <span className="st-vis-sw" role="group" aria-label={t('Visible to members') + ': ' + name}>
      <Switch checked={on} disabled={busy} onChange={onToggle} />
    </span>
  </span>
}

/** A quiet "…" menu: native <details>, so it is keyboard- and screen-reader-friendly for free. */
export function RowMenu({ items, label }) {
  const shown = items.filter(Boolean)
  if (!shown.length) return null
  return <details className="st-menu" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false }}>
    <summary aria-label={label || t('More')}><Icon name="moreH" /></summary>
    <div className="st-menu-pop" role="menu">
      {shown.map((it, i) => <button key={i} role="menuitem" className={it.danger ? 'danger' : ''}
        onClick={e => { e.currentTarget.closest('details').open = false; it.onClick() }}>{it.label}</button>)}
    </div>
  </details>
}

export function Segmented({ value, onChange, options }) {
  return <div className="st-seg" role="tablist">
    {options.map(([k, label, n]) => <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>
      {label}{n != null && <span className="num">{n}</span>}</button>)}
  </div>
}

export function Empty({ icon = 'magnifier', title, children }) {
  return <div className="st-empty"><Icon name={icon} /><b>{title}</b>{children && <p>{children}</p>}</div>
}

/** Searchable list of official routines; `onPick(routine)` closes the sheet. */
export function RoutinePicker({ routines, close, onPick, exclude = [] }) {
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('all')
  const list = useMemo(() => filterAdmin(routines.filter(r => !exclude.includes(r.id)), { q, category }, r => t(r.name)).slice(0, 80), [routines, q, category, exclude])
  const cats = [...new Set(routines.map(r => r.category))]
  return <div className="st-picker">
    <h3>{t('Choose a routine')}</h3>
    <input className="input" autoFocus type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t('Search routines')} aria-label={t('Search routines')} />
    <div className="st-chips">
      <button className={'chip' + (category === 'all' ? ' on' : '')} onClick={() => setCategory('all')}>{t('All')}</button>
      {cats.map(c => <button key={c} className={'chip' + (category === c ? ' on' : '')} onClick={() => setCategory(c)}>{t(CATEGORY_LABEL[c])}</button>)}
    </div>
    <div className="st-picker-list">
      {list.map(r => <button key={r.id} className="st-pick" onClick={() => { onPick(r); close() }}>
        <WorkoutCover r={r} shape="square" />
        <span className="grow"><b>{t(r.name)}</b><small className="num">{t(CATEGORY_LABEL[r.category])} · {t(LEVEL_LABEL[r.level])} · ~{r.estimatedMinutes} min</small></span>
        <StatusPill x={r} />
      </button>)}
      {!list.length && <Empty title={t('No routines match')} />}
    </div>
  </div>
}

const STEPS = [
  ['Build and check', 'Every routine is made of official blocks and validated by the 2J protocol before it can go live. Errors tell you what to fix.', 'dumbbell'],
  ['Draft, preview, publish', 'New and duplicated content starts as a draft only admins see. Preview it exactly as a member would, then publish it. Hide it any time: people who already started keep their own copy.', 'play'],
  ['Programs and collections', 'Programs chain routines week by week. Collections group routines and programs on the library home. Order and featured decide what members see first.', 'folder'],
]

export function StudioHelp({ onClose }) {
  const [i, setI] = useState(0)
  const [title, text, icon] = STEPS[i]
  return <section className="st-help" aria-label={t('How the Studio works')}>
    <div className="st-help-ic"><Icon name={icon} /></div>
    <div className="grow">
      <small className="num">{i + 1} / {STEPS.length}</small>
      <h2>{t(title)}</h2>
      <p>{t(text)}</p>
      <div className="st-help-acts">
        {i > 0 && <button className="btn plain" onClick={() => setI(i - 1)}>{t('Back')}</button>}
        {i < STEPS.length - 1 ? <button className="btn tinted" onClick={() => setI(i + 1)}>{t('Next')}</button> : <button className="btn primary" onClick={onClose}>{t('Got it')}</button>}
        <button className="btn plain" onClick={onClose}>{t('Skip')}</button>
      </div>
    </div>
  </section>
}
