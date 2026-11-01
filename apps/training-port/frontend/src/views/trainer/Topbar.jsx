// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'

// The desktop trainer panel's own small header — title + a text "back" link, used by every
// screen under /trainer/:memberId/* instead of the mobile Row/hdr chrome the rest of the app uses.
export default function Topbar({ title, onBack }) {
  return <div className="trainer-topbar">
    <div style={{ flex: 1 }}><h1>{title}</h1></div>
    <a className="trainer-back" href="#" onClick={e => { e.preventDefault(); onBack() }}><Icon name="chevronLeft" />{t('Back')}</a>
  </div>
}
