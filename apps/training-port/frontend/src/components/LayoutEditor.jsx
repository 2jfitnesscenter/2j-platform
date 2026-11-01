// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The one editor of a page layout (Home, Progress): the blocks that are shown (move up / down, hide), the blocks that are available (add), and "restore the default
// layout". It works on { order, hidden } and reports every change straight away; where that is stored is the caller's business (lib/ux-layout.js). A block the gym or the
// member switched off as a feature is not offered, so there is never a row that does nothing; a block that is not `optional` can be moved but not hidden.
import { t } from '../lib/i18n.js'
import { allowedByAdmin, currentUses } from '../lib/features.js'
import Icon from './Icon.jsx'
import '../views/experience.css'
import './layout-editor.css'

export default function LayoutEditor({ S, catalog, layout, onChange, onRestore, isDefault, canHide = () => true, compact = false }) {
  const uses = currentUses(S)
  const offered = c => !c.feature || (uses[c.feature] !== false && allowedByAdmin(c.feature))
  const byId = id => catalog.find(c => c.id === id)
  const shown = layout.order.filter(id => byId(id) && offered(byId(id)) && !layout.hidden.includes(id))
  const available = layout.order.filter(id => byId(id) && offered(byId(id)) && layout.hidden.includes(id))
  const move = (id, dir) => {
    const a = shown.indexOf(id), b = a + dir
    if (a < 0 || b < 0 || b >= shown.length) return
    const order = [...layout.order]
    const pa = order.indexOf(shown[a]), pb = order.indexOf(shown[b]);
    [order[pa], order[pb]] = [order[pb], order[pa]]
    onChange({ ...layout, order })
  }
  const hide = id => onChange({ ...layout, hidden: [...layout.hidden, id] })
  const add = id => onChange({ ...layout, hidden: layout.hidden.filter(h => h !== id) })
  return <div className={'le' + (compact ? ' compact' : '')}>
    <div className="le-sub">{t('Shown')}</div>
    <div className="ux-pc">
      {shown.map((id, i) => {
        const c = byId(id), label = t(c.label)
        return <div key={id} className="ux-pc-row">
          <span className="ux-ico"><Icon name={c.icon} /></span>
          <span className="ux-pc-t">{label}</span>
          <button type="button" className="iconbtn ux-pc-mv" disabled={i === 0} onClick={() => move(id, -1)} aria-label={t('Move up: {0}', label)}><Icon name="arrowUp" /></button>
          <button type="button" className="iconbtn ux-pc-mv" disabled={i === shown.length - 1} onClick={() => move(id, 1)} aria-label={t('Move down: {0}', label)}><Icon name="arrowDown" /></button>
          {!canHide(id)
            ? <span className="le-fixed">{t('Always shown')}</span>
            : <button type="button" className="le-btn" onClick={() => hide(id)} aria-label={t('Hide: {0}', label)}><Icon name="minus" />{t('Hide')}</button>}
        </div>
      })}
      {!shown.length && <div className="dim small le-empty">{t('Nothing is shown. Add a block below.')}</div>}
    </div>
    {available.length > 0 && <>
      <div className="le-sub">{t('Available to add')}</div>
      <div className="ux-pc">
        {available.map(id => {
          const c = byId(id), label = t(c.label)
          return <div key={id} className="ux-pc-row off">
            <span className="ux-ico"><Icon name={c.icon} /></span>
            <span className="ux-pc-t">{label}</span>
            <button type="button" className="le-btn add" onClick={() => add(id)} aria-label={t('Add: {0}', label)}><Icon name="plus" />{t('Add')}</button>
          </div>
        })}
      </div>
    </>}
    <button type="button" className="le-restore" onClick={onRestore} disabled={isDefault}><Icon name="reset" />{t('Restore default layout')}</button>
  </div>
}
