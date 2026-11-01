// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The short visual guide shown the FIRST time a member enters the personalisation mode (Home or Progress). Five cards, one idea each; closing it — by finishing or by
// skipping — remembers it in the profile (S.ux.guide), so it never comes back by itself. Settings → Personalisation can re-arm it.
import { useState } from 'react'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import './layout-editor.css'

export const GUIDE_STEPS = [
  { icon: 'arrowUp', title: 'You can move the blocks', text: 'Use the arrows to put first what you use most.' },
  { icon: 'minus', title: 'You can hide what you do not want', text: 'Hiding a block never deletes anything: your data and your programs stay.' },
  { icon: 'plus', title: 'You can add other blocks', text: 'Everything that is not on the screen is listed under "Available to add".' },
  { icon: 'reset', title: 'You can change it whenever you want', text: 'And "Restore default layout" puts everything back the way it came.' },
  { icon: 'gear', title: 'You can also do it from Settings', text: 'Settings → Personalisation has the same controls, and can show this guide again.' },
]

export default function PersonalizeGuide({ onClose }) {
  const [i, setI] = useState(0)
  const s = GUIDE_STEPS[i], last = i === GUIDE_STEPS.length - 1
  return <div className="pg-back" role="dialog" aria-modal="true" aria-label={t('Personalisation guide')}>
    <div className="pg">
      <div className="pg-art" aria-hidden="true"><Icon name={s.icon} /></div>
      <span className="pg-step">{t('Step {0} of {1}', i + 1, GUIDE_STEPS.length)}</span>
      <h3>{t(s.title)}</h3>
      <p>{t(s.text)}</p>
      <div className="pg-dots" aria-hidden="true">{GUIDE_STEPS.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</div>
      <div className="pg-acts">
        {!last && <button type="button" onClick={onClose}>{t('Skip')}</button>}
        <button type="button" className="go" onClick={() => (last ? onClose() : setI(i + 1))}>{last ? t('Got it') : t('Next')}</button>
      </div>
    </div>
  </div>
}
