import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { mediaUrl, uploadImage } from '../lib/media.js'
import { COVER_ASPECT, MAX_ZOOM, drawCrop, exportCrop, loadImageFile, panBy } from '../lib/cover-crop.js'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'

/* "Change cover" for a routine or program: pick a picture, frame it (drag + zoom, live preview), save. What is stored is the already-framed small JPEG in
   the existing media store (the item keeps only its id in `image`, as before). Removing it returns to the 2J cover. Nothing else about the item changes. */
const STEP = 0.04

function Framer({ img, onSave, onCancel, busy }) {
  const cv = useRef(null)
  const drag = useRef(null)
  const [f, setF] = useState({ zoom: 1, fx: 0.5, fy: 0.5 })
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height
  useEffect(() => { if (cv.current) drawCrop(cv.current, img, f) }, [img, f])
  const down = e => { drag.current = { x: e.clientX, y: e.clientY, f }; e.currentTarget.setPointerCapture?.(e.pointerId) }
  const move = e => {
    const d = drag.current; if (!d) return
    const pw = cv.current.getBoundingClientRect().width
    setF({ ...d.f, ...panBy({ iw, ih, ...d.f }, e.clientX - d.x, e.clientY - d.y, pw) })
  }
  const up = () => { drag.current = null }
  const key = e => {
    const k = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] }[e.key]
    if (!k) return
    e.preventDefault(); setF(c => ({ ...c, fx: Math.min(1, Math.max(0, c.fx + k[0])), fy: Math.min(1, Math.max(0, c.fy + k[1])) }))
  }
  return <>
    <h3>{t('Frame your cover')}</h3>
    <canvas ref={cv} className="v3-cover-canvas" width={600} height={600 / COVER_ASPECT} tabIndex={0} role="img" aria-label={t('Cover preview. Drag or use the arrow keys to frame it.')}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key} />
    <div className="muted small" style={{ margin: '8px 2px 4px' }}>{t('Drag to frame the picture.')}</div>
    <label className="v3-cover-zoom"><span>{t('Zoom')}</span>
      <input type="range" min="1" max={MAX_ZOOM} step="0.05" value={f.zoom} onChange={e => setF(c => ({ ...c, zoom: Number(e.target.value) }))} aria-label={t('Zoom')} />
    </label>
    <div className="row" style={{ gap: 8, marginTop: 14 }}>
      <Button variant="ghost" disabled={busy} onClick={onCancel} style={{ flex: 1 }}>{t('Cancel')}</Button>
      <Button variant="primary" icon="check" disabled={busy} onClick={() => onSave(f)} style={{ flex: 2 }}>{busy ? t('Saving…') : t('Save cover')}</Button>
    </div>
  </>
}

function CoverSheet({ image, name, onChange, close }) {
  const toast = useUI(s => s.toast)
  const input = useRef(null)
  const [picked, setPicked] = useState(null)     // { img, release }
  const [busy, setBusy] = useState(false)
  useEffect(() => () => picked?.release?.(), [picked])
  const onFile = e => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    loadImageFile(file).then(setPicked).catch(err => toast(t(err.message)))
  }
  const save = frame => {
    setBusy(true)
    let dataUrl
    try { dataUrl = exportCrop(picked.img, frame) } catch (err) { setBusy(false); return toast(t(err.message)) }
    uploadImage(dataUrl).then(id => { setBusy(false); close(); onChange(id); toast(t('Cover updated')) })
      .catch(err => { setBusy(false); toast(err?.message || t('Could not save the cover')) })
  }
  if (picked) return <Framer img={picked.img} busy={busy} onSave={save} onCancel={() => setPicked(null)} />
  return <>
    <h3>{t('Cover')}</h3>
    <div className="v3-cover-now" aria-label={name}>
      {image ? <img src={mediaUrl(image)} alt="" /> : <span className="muted small">{t('2J cover')}</span>}
    </div>
    <input ref={input} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} />
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
      <Button variant="primary" icon="upload" onClick={() => input.current?.click()}>{image ? t('Choose another image') : t('Upload an image')}</Button>
      {image && <Button variant="ghost" onClick={() => { close(); onChange(null); toast(t('Back to the 2J cover')) }}><Icon name="xmark" />{t('Back to the 2J cover')}</Button>}
    </div>
    <div className="muted small" style={{ margin: '10px 2px 0' }}>{t('The photo is stored as a small image, not inside your plan data.')}</div>
  </>
}

/** onChange(id | null): the new image id, or null to go back to the 2J cover. */
export const coverSheet = ({ image, name, onChange }) => useUI.getState().openSheet(close => <CoverSheet image={image} name={name} onChange={onChange} close={close} />)
