// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Cover framing: a routine/program cover is drawn wide (about 2:1) in cards and heroes, so the member frames the picture once, here, and what is stored
// is already that crop (a small JPEG in the existing media store, referenced by id — never base64 in the state).
export const COVER_ASPECT = 2
export const COVER_OUT = { w: 1000, h: 500 }
export const MAX_ZOOM = 3
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

/** Source rectangle of the crop: the largest COVER_ASPECT window inside the image, shrunk by `zoom`, placed by fx/fy (0..1 across the free range). */
export function cropRect({ iw, ih, zoom = 1, fx = 0.5, fy = 0.5 }) {
  if (!(iw > 0) || !(ih > 0)) return null
  const z = clamp(Number(zoom) || 1, 1, MAX_ZOOM)
  let sw = iw, sh = iw / COVER_ASPECT
  if (sh > ih) { sh = ih; sw = ih * COVER_ASPECT }
  sw /= z; sh /= z
  return { sx: (iw - sw) * clamp(fx, 0, 1), sy: (ih - sh) * clamp(fy, 0, 1), sw, sh }
}

/** New fx/fy after dragging the preview by (dx, dy) CSS pixels over a preview `pw` pixels wide: the picture follows the finger. */
export function panBy({ iw, ih, zoom, fx, fy }, dx, dy, pw) {
  const r = cropRect({ iw, ih, zoom, fx, fy })
  if (!r || !(pw > 0)) return { fx, fy }
  const k = r.sw / pw                          // source pixels per preview pixel
  const freeX = iw - r.sw, freeY = ih - r.sh
  return {
    fx: freeX > 0.5 ? clamp(fx - (dx * k) / freeX, 0, 1) : fx,
    fy: freeY > 0.5 ? clamp(fy - (dy * k) / freeY, 0, 1) : fy,
  }
}

/** Draws the crop onto `canvas` (any size with the cover aspect). */
export function drawCrop(canvas, img, frame) {
  const r = cropRect({ iw: img.naturalWidth || img.width, ih: img.naturalHeight || img.height, ...frame })
  if (!r) return false
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#0B0F12'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, canvas.width, canvas.height)
  return true
}

/** The final JPEG data URL (only ever sent to the upload endpoint, then discarded). */
export function exportCrop(img, frame) {
  const canvas = document.createElement('canvas')
  canvas.width = COVER_OUT.w; canvas.height = COVER_OUT.h
  if (!drawCrop(canvas, img, frame)) throw new Error('could not read that image')
  return canvas.toDataURL('image/jpeg', 0.86)
}

export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type || '')) return reject(new Error('could not read that file'))
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve({ img, release: () => URL.revokeObjectURL(url) })
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('could not read that image')) }
    img.src = url
  })
}
