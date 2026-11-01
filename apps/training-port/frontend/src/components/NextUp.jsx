// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { Thumb } from './Media.jsx'

/* "Next up: Incline press" — discreet, never competes with the current exercise. The mini preview appears only when exercise
   images are enabled; the row simply has no picture otherwise. Tapping it moves to that exercise (same as Next). */
export default function NextUp({ next, images, onGo }) {
  if (!next) return null
  const name = next.names.join(' + ')
  return <button type="button" className="v3-next" onClick={onGo} aria-label={t('Next up: {0}', name)}>
    {images && !next.superset && next.ex && <Thumb ex={next.ex} />}
    <span className="v3-next-copy"><span className="v3-next-k">{t('Next up')}</span><span className="v3-next-n capitalize">{name}</span></span>
    <span className="v3-next-meta">{next.superset ? <Icon name="link" /> : null}{t('{0} sets', next.sets)}</span>
    <Icon name="chevronRight" className="chev" />
  </button>
}
