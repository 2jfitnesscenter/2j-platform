import { useEffect, useState } from 'react'
import { imgSrc, gifSrc } from '../lib/exercises.js'
import { useStore } from '../store/useStore.js'
import { t, nameFor } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// Big autoplaying animation; tap toggles to the still frame. `compact` shrinks it (superset cards).
// Custom exercises have no media — the animation stays blank by design (issue #11).
// `minimizable` (workout view) adds a persistent minimize/expand control so the animation stops
// eating the screen; the chosen size is saved to settings and carries across exercises and
// future workouts (issue #12).
export default function Media({ ex, id, compact, minimizable }) {
  const [playing, setPlaying] = useState(true)
  const [gifFailed, setGifFailed] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)
  const gifSize = useStore(s => s.S.gifSize)
  const update = useStore(s => s.update)
  useEffect(() => { setGifFailed(false); setImgFailed(false); setPlaying(true) }, [ex?.id])
  const useGif = playing && !!ex?.gif && !gifFailed
  const src = useGif ? gifSrc(ex) : !imgFailed ? imgSrc(ex) : null
  const mini = minimizable && gifSize === 'mini'
  const toggleSize = e => { e.stopPropagation(); update(s => { s.gifSize = mini ? 'full' : 'mini' }) }
  if (!src) return <div className={'exmedia exmedia-fallback' + (compact ? ' compact' : '') + (mini ? ' mini' : '')} id={id} role="img" aria-label={t('No image available')}><Icon name="dumbbell" /><span>{nameFor(ex)}</span></div>
  return (
    <div className={'exmedia' + (compact ? ' compact' : '') + (mini ? ' mini' : '')} id={id} onClick={() => setPlaying(p => !p)}>
      <img decoding="async" src={src} alt={nameFor(ex)} onError={() => useGif ? setGifFailed(true) : setImgFailed(true)} />
      {minimizable && (
        <button className="giftoggle" onClick={toggleSize}>
          <Icon name={mini ? 'expand' : 'minimize'} />{mini ? t('Expand') : t('Minimize')}
        </button>
      )}
      {!mini && (
        <span className="gifhint">
          <Icon name={playing ? 'pause' : 'play'} />{playing ? t('tap to pause') : t('tap to play')}
        </span>
      )}
    </div>
  )
}

export function Thumb({ ex }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [ex?.id])
  const src = imgSrc(ex)
  if (!src || failed) return <div className="thumb thumb-x"><Icon name="dumbbell" /></div>
  return <img className="thumb" loading="lazy" decoding="async" src={src} alt="" onError={() => setFailed(true)} />
}
