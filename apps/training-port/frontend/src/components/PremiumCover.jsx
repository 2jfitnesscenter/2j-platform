// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The cover of a Premium program. The box keeps its aspect ratio (no layout shift), the picture loads lazily and decodes off the main thread, and a program
// without a picture — or one whose picture fails to load — shows the Premium fallback art instead of a broken image.
import { useEffect, useState } from 'react'
import { coverSrc } from '../lib/premium-text.js'

export default function PremiumCover({ p, ratio = '4 / 3', eager = false, children, className = '' }) {
  const src = coverSrc(p)
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])
  const f = p?.coverFocalPoint
  const show = src && !failed
  return <div className={'pm-cover ' + className} style={{ aspectRatio: ratio }} data-fallback={show ? undefined : 'true'}>
    {show
      ? <img src={src} alt={p.coverImageAlt || ''} loading={eager ? 'eager' : 'lazy'} decoding="async" fetchPriority={eager ? 'high' : 'auto'} draggable="false"
        style={f ? { objectPosition: `${f.x}% ${f.y}%` } : undefined} onError={() => setFailed(true)} />
      : <span className="pm-cover-art" aria-hidden="true"><i /><i /><i /></span>}
    <span className="pm-cover-shade" aria-hidden="true" />
    {children}
  </div>
}
