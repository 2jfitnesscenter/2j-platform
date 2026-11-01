// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { badgeAccent, ACCENT_COLOR_VAR } from '../lib/badges-data.js'
import { MOBILE } from '../lib/mobile.js'
import { capturePng, sharePng } from '../lib/share-image.js'
import { vibrate } from '../lib/sound.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'
import BadgeShareCard from './BadgeShareCard.jsx'

// A dozen-odd little squares/dots flung out from the badge icon on entry — angle + distance
// computed once per badge (useMemo keyed on badge.id, not re-rolled on every re-render), and
// resolved to a pixel dx/dy in JS rather than leaned on CSS trig (cos()/sin() in calc() isn't
// reliable yet across the WebViews this app actually ships in, Capacitor's included).
const PARTICLES = 14
export function useBurst(seedKey) {
  return useMemo(() => Array.from({ length: PARTICLES }, (_, i) => {
    const angle = (i / PARTICLES) * 360 + (Math.random() * 22 - 11)
    const dist = 58 + Math.random() * 46
    const rad = angle * Math.PI / 180
    return {
      i, dx: Math.cos(rad) * dist, dy: Math.sin(rad) * dist,
      delay: Math.random() * 0.16, size: 4 + Math.random() * 5,
      star: i % 3 === 0,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [seedKey])
}

/**
 * One badge's celebration, shown one at a time by sheets.jsx's celebrateBadges even when a
 * workout/import unlocked several — `onAdvance` closes this and opens the next (or nothing,
 * if `remaining` is 0). Never blocks anything: whatever unlocked it was already saved to
 * S.badges before this ever mounts (see doFinishWorkout/doImport in sheets.jsx).
 */
export default function BadgeCelebrationModal({ badge, remaining, onAdvance }) {
  const accent = ACCENT_COLOR_VAR[badgeAccent(badge)]
  const particles = useBurst(badge.id)
  const cardRef = useRef(null)
  const [sharing, setSharing] = useState(false)
  const dateLabel = fmtDate((badge.unlockedAt || todayISO()).slice(0, 10), true)

  // A short, distinct "success" buzz — only on the native app build (a browser tab buzzing a
  // desk phone for a badge would be a strange surprise the web/PWA build never opts into).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (MOBILE) vibrate([0, 40, 60, 90]) }, [badge.id])

  const share = async () => {
    if (sharing || !cardRef.current) return
    setSharing(true)
    try {
      const dataUrl = await capturePng(cardRef.current)
      await sharePng(dataUrl, `2J-Badge-${badge.id}.png`, t(badge.title),
        t('I just unlocked the "{0}" badge in 2J Fitness Center 🏅', t(badge.title)))
    } catch (e) { /* share sheet dismissed, or capture unavailable */ }
    finally { setSharing(false) }
  }

  return (
    <div className="badgecel">
      <div className="badgecel-burst" aria-hidden="true">
        {particles.map(p => (
          <span key={p.i} className={'badgecel-p' + (p.star ? ' star' : '')}
            style={{ '--dx': p.dx + 'px', '--dy': p.dy + 'px', animationDelay: p.delay + 's', width: p.size, height: p.size, background: accent }} />
        ))}
      </div>
      <div className="badgecel-eyebrow" style={{ color: accent }}>{t('NEW BADGE UNLOCKED!')}</div>
      {badge.image ? (
        <img src={badge.image} alt="" className="badgecel-img" style={{ filter: `drop-shadow(0 0 22px ${accent})` }} />
      ) : (
        <div className="badgecel-icon" style={{ '--tint': accent, boxShadow: `0 0 0 3px ${accent}, 0 0 34px 6px color-mix(in srgb, ${accent} 55%, transparent)` }}>
          <Icon name={badge.icon} />
        </div>
      )}
      <h2 className="badgecel-title">{t(badge.title)}</h2>
      <div className="badgecel-desc">{t(badge.description)}</div>
      <div className="badgecel-date">{dateLabel}</div>
      <Button variant="primary" onClick={onAdvance} style={{ marginTop: 18 }}>
        {remaining > 0 ? t('Next badge ({0} more)', remaining) : t('Nice!')}
      </Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" icon="upload" disabled={sharing} onClick={share}>{t('Share achievement')}</Button>
      <div className="sharecard-capture" aria-hidden="true"><BadgeShareCard badge={badge} dateLabel={dateLabel} cardRef={cardRef} /></div>
    </div>
  )
}
