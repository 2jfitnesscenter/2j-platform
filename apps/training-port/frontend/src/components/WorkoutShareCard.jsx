// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import BodyMap from './BodyMap.jsx'

// The card's minimum CSS size at each aspect. Content may grow beyond this height; the shared
// capture helper measures scrollHeight so long sessions remain complete in the exported image.
// pixelRatio 4 keeps the 270px preview at a 1080px export width.
export const CARD_SIZE = { story: { w: 270, h: 480 }, square: { w: 270, h: 270 } }

/**
 * <WorkoutShareCard data={buildShareCardData(...)} aspect="story" cardRef={ref} />
 * Pure presentation — `data` is the plain object share-card.js already computed, nothing here
 * touches the store. Pinned to its own dark palette (see .sharecard in index.css) so the
 * exported PNG looks the same regardless of the viewer's own light/dark setting.
 */
export default function WorkoutShareCard({ data, aspect, cardRef }) {
  const size = CARD_SIZE[aspect]
  return (
    <div ref={cardRef} className="sharecard" data-aspect={aspect} style={{ width: size.w, minHeight: size.h }}>
      <div className="sc-top">
        <img src={data.crest} alt="" className="sc-crest" crossOrigin="anonymous" />
        <div className="sc-brand">{t('2J Fitness Center')}</div>
      </div>

      {data.badges.length > 0 && <div className="sc-badges">
        <div className="sc-badge-row">
          {data.badges.map(b => <img key={b.id} src={b.image} alt="" className="sc-badge" crossOrigin="anonymous" />)}
        </div>
        <span className="sc-badges-label">
          {data.badges.length === 1 ? t('New badge') : t('{0} new badges', data.badges.length)}
        </span>
      </div>}

      <div className="sc-title">{data.routineName}</div>
      <div className="sc-date">{data.dateLabel}</div>

      {aspect === 'story' && <div className="sc-map">
        <BodyMap load={data.muscleLoad} body={data.body} />
      </div>}

      <div className="sc-stats">
        <div className="sc-tile"><span className="sc-tile-l">{t('Volume')}</span><span className="sc-tile-v">{data.volume}</span></div>
        <div className="sc-tile"><span className="sc-tile-l">{t('Duration')}</span><span className="sc-tile-v">{data.duration}</span></div>
        <div className="sc-tile"><span className="sc-tile-l">{t('Sets')}</span><span className="sc-tile-v">{data.sets} <i>· {data.totalReps} {t('reps')}</i></span></div>
        <div className="sc-tile"><span className="sc-tile-l">{t('PRs')}</span><span className="sc-tile-v">{data.prCount || '—'}</span></div>
      </div>

      {data.lifts.length > 0 && <div className="sc-lifts">
        {data.lifts.map(l => <div key={l.id} className={'sc-lift' + (l.isPR ? ' pr' : '')}>
          {l.isPR && <Icon name="trophy" />}
          <span className="sc-lift-n">{l.name}</span>
          <span className="sc-lift-v">{l.w}×{l.r}</span>
        </div>)}
      </div>}

      <div className="sc-footer">
        <span>{data.dateLabel}</span>
        <span className="sc-footer-dot">·</span>
        <span>{t('2J Fitness Center')}</span>
      </div>
    </div>
  )
}
