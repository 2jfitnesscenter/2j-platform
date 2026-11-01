// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { t, dateLocale } from '../lib/i18n.js'
import { CHANGELOG } from '../lib/changelog.js'

// Opened from Settings' footer — a short, no-explanations version history. See lib/changelog.js
// for why the first entry has no version number.
export function ChangelogSheet() {
  return <>
    <h3>{t('Version history')}</h3>
    {CHANGELOG.map((v, i) => <div key={v.version || 'dev'} style={{ marginTop: i ? 18 : 0 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="tt" style={{ fontWeight: 700 }}>{v.version || t('In progress')}</span>
        {v.date && <span className="dim small">
          {new Date(v.date).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>}
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.55 }}>
        {v.items.map((it, j) => <li key={j} className="small dim">{t(it)}</li>)}
      </ul>
    </div>)}
  </>
}
