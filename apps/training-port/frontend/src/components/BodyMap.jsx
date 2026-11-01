import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MUSCLES, INERT, MUSCLE_NAME, levelsOf } from '../lib/muscles.js'
import { t } from '../lib/i18n.js'

// Front and back views of a body, each muscle shaded by how hard it was worked.
//
// The five shade steps are the same ones the activity heatmap uses (.hm-c.l0…l4), so
// "more accent = more training" means one thing everywhere in the app rather than two.
//
// The geometry is ~90 KB and only some screens show a map, so it is fetched on first
// render instead of riding along in the main bundle. Until it lands the component
// renders nothing but keeps its height, so nothing below it jumps on arrival.

let CACHE = null                                  // shared across every mounted map
let PENDING = null

// Exported so other screens that want the same real body geometry (Measurements' segmental
// diagram, say) share this one cache/fetch instead of a second 90 KB import of their own.
export function useBodyPaths() {
  const [paths, setPaths] = useState(CACHE)
  useEffect(() => {
    if (CACHE) return
    let alive = true
    PENDING = PENDING || import('../lib/body-paths.js').then(m => (CACHE = m.default))
    PENDING.then(p => { if (alive) setPaths(p) }).catch(() => {})
    return () => { alive = false }
  }, [])
  return paths
}

// Which single view best shows each muscle on its own — used only by MuscleIcon below.
// A handful of muscles (triceps, deltoids, calves, adductors, trapezius, forearm) are
// drawn in both views; the map picks whichever side reads most like "that muscle" at a
// glance, matching how the full BodyMap above already draws them isn't relevant since
// MuscleIcon shows one muscle in isolation, not a shaded whole body.
const VIEW_FOR = {
  trapezius: 'back', deltoids: 'front', chest: 'front', 'upper-back': 'back',
  serratus: 'front', biceps: 'front', triceps: 'back', forearm: 'front',
  abs: 'front', obliques: 'front', 'lower-back': 'back', gluteal: 'back',
  quadriceps: 'front', hamstring: 'back', adductors: 'front', 'hip-flexors': 'front',
  calves: 'back', tibialis: 'front',
}

function View({ view, levels, onMuscle, selected, colorOf }) {
  return (
    <svg className="bm-v" viewBox={view.vb} role="img">
      {INERT.map(slug => (view.p[slug] || []).map((d, i) =>
        <path key={slug + i} className="bm-sil" d={d} />))}
      {MUSCLES.map(slug => (view.p[slug] || []).map((d, i) => {
        const color = colorOf ? colorOf(slug) : null
        return <path
          key={slug + i}
          className={'bm-m' + (color ? '' : ' l' + (levels[slug] || 0)) + (selected === slug ? ' sel' : '')}
          style={color ? { fill: color } : undefined}
          d={d}
          onClick={onMuscle ? () => onMuscle(slug) : undefined}
        >
          <title>{t(MUSCLE_NAME[slug])}</title>
        </path>
      }))}
    </svg>
  )
}

/**
 * <BodyMap load={{ chest: 12, … }} body="male" />
 * `load` is effective sets per muscle (see lib/muscles.js); shading is relative to
 * the hardest-worked muscle in that same load, so it always reads as a balance.
 *
 * <BodyMap colorOf={slug => 'var(--green)'} body="male" />
 * `colorOf`, when given, paints each muscle that exact colour instead of the relative
 * load shading — for a map where the colour already means something absolute (like
 * Recovery's red/orange/green), not "worked harder than its neighbour".
 */
export default function BodyMap({ load = {}, body = 'male', onMuscle, selected, className = '', highlightSelected = false, colorOf }) {
  const paths = useBodyPaths()
  const levels = levelsOf(load)
  const g = paths && (paths[body] || paths.male)
  return (
    <div className={'bodymap ' + className + (highlightSelected ? ' bm-lit' : '')}>
      {g ? <>
        <View view={g.front} levels={levels} onMuscle={onMuscle} selected={selected} colorOf={colorOf} />
        <View view={g.back} levels={levels} onMuscle={onMuscle} selected={selected} colorOf={colorOf} />
      </> : <div className="bm-ph" aria-hidden="true" />}
    </div>
  )
}

/**
 * <MuscleIcon slug="triceps" body="male" />
 * A single small silhouette with just that one muscle lit up and everything else left
 * at the plain untrained shade — for a "this routine hits: triceps 44%" chip, where a
 * full two-view shaded BodyMap would be both too much detail and too big to fit.
 */
export function MuscleIcon({ slug, body = 'male', className = '' }) {
  const paths = useBodyPaths()
  const g = paths && (paths[body] || paths.male)
  const view = g && g[VIEW_FOR[slug] || 'front']
  const svgRef = useRef(null)
  const [crop, setCrop] = useState(null)
  // The full body-part view (head to toe) leaves the target muscle a tiny fraction of a
  // 64px icon — cropping to just its own bounding box (padded a bit) is what makes a
  // chest or triceps actually readable at that size. getBBox() ignores viewBox, so this
  // only zooms the same paths in rather than re-laying anything out.
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const els = svg.querySelectorAll('.bm-mini-hi')
    if (!els.length) { setCrop(null); return }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    els.forEach(p => {
      const b = p.getBBox()
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y)
      x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height)
    })
    const pad = Math.max(x1 - x0, y1 - y0) * 0.4 || 10
    setCrop(`${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`)
  }, [view, slug])
  if (!view) return <div className={'bm-mini-ph ' + className} aria-hidden="true" />
  return (
    <svg ref={svgRef} className={'bm-mini ' + className} viewBox={crop || view.vb} role="img" aria-label={t(MUSCLE_NAME[slug])}>
      {INERT.map(s => (view.p[s] || []).map((d, i) => <path key={s + i} className="bm-sil" d={d} />))}
      {MUSCLES.map(s => (view.p[s] || []).map((d, i) =>
        <path key={s + i} className={'bm-m' + (s === slug ? ' bm-mini-hi' : '')} d={d} />))}
    </svg>
  )
}

export function BodyMapLegend() {
  return <div className="hm-legend">
    {t('Less')} <div className="hm-c l0" /><div className="hm-c l1" /><div className="hm-c l2" />
    <div className="hm-c l3" /><div className="hm-c l4" /> {t('More')}
  </div>
}
