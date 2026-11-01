// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { uxOn } from '../lib/features.js'
import { buildStory } from '../lib/story.js'
import { capturePng, downloadPng, sharePng } from '../lib/share-image.js'
import StoryCard from './StoryCard.jsx'
import Icon from './Icon.jsx'
import { Button, Segmented, Switch } from './ui.jsx'

/* 2J Story sheet: pick week or month, see the card, share / save it with the app's existing image export (capturePng,
   sharePng). Weight is OFF by default and only offered when the member's own weigh-ins exist and weight tracking is enabled
   (admin ∧ member); Health data is never part of the story. */
export function StorySheet({ initialPeriod = 'month', close }) {
  const S = useStore(s => s.S)
  const toast = useUI(s => s.toast)
  const [period, setPeriod] = useState(initialPeriod)
  const [body, setBody] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  const [fit, setFit] = useState({ k: 1, h: null })
  const story = useMemo(() => buildStory(S, period, { includeBody: body }), [S.workouts, S.bodyweight, S.badges, S.unit, period, body])
  // The whole card is always visible in the preview: scaled down (on the wrapper, never the card, so the exported PNG is untouched).
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return
    const h = el.offsetHeight, avail = Math.max(300, Math.min(window.innerHeight * 0.5, 560))
    const k = Math.min(1, avail / h)
    setFit(f => (f.k === k && f.h === h * k ? f : { k, h: Math.round(h * k) }))
  }, [story, period, body])
  const canBody = uxOn(S, 'bodyweight') && story.canIncludeBody
  const file = `2J-Story-${period}-${story.range?.from || ''}.png`
  const run = async fn => {
    if (busy || !ref.current) return
    setBusy(true)
    try { await fn(await capturePng(ref.current)) } catch (e) { if (e?.name !== 'AbortError') toast(t("Couldn't create the image")) } finally { setBusy(false) }
  }
  return <div className="v3-story-sheet">
    <header className="row between"><div><h3>{t('2J Story')}</h3><div className="small muted">{t('A picture of your training, ready to share')}</div></div>
      <button className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button></header>
    <Segmented value={period} onChange={setPeriod} options={[{ value: 'week', label: t('Week') }, { value: 'month', label: t('Month') }]} />
    {story.empty
      ? <div className="v3-story-none"><Icon name="figureStrength" /><p>{t(period === 'week' ? 'No workouts yet this week' : 'No workouts yet this month')}</p></div>
      : <div className="v3-story-preview" style={fit.h ? { height: fit.h } : undefined}><div className="v3-story-fit" style={{ transform: `scale(${fit.k})` }}><StoryCard story={story} ref={ref} /></div></div>}
    {canBody && !story.empty && <label className="v3-story-opt">
      <span><b>{t('Include my weight change')}</b><small>{t('Off by default. Nothing else about your health is ever included.')}</small></span>
      <Switch checked={body} onChange={setBody} />
    </label>}
    {!story.empty && <>
      <div className="small muted" style={{ margin: '4px 0 10px' }}>{t('This card contains only what you see on it.')}</div>
      <div className="row" style={{ gap: 8 }}>
        <Button variant="primary" icon="upload" disabled={busy} onClick={() => run(d => sharePng(d, file, t('My 2J Story')))}>{t('Share')}</Button>
        <Button variant="tinted" icon="download" disabled={busy} onClick={() => run(async d => downloadPng(d, file))}>{t('Save')}</Button>
      </div>
    </>}
  </div>
}

export const openStory = (initialPeriod = 'month') => useUI.getState().openSheet(close => <StorySheet initialPeriod={initialPeriod} close={close} />)
