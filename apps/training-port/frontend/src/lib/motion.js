// Motion helpers for Experience V2. Everything animated in JS asks here first; CSS animations are switched
// off by prefers-reduced-motion (index.css + v2.css), JS ones (counters) must do the same.

export const reducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Eased 0→1 progress for a count-up; with reduced motion it is already 1. */
export const easeOut = x => 1 - Math.pow(1 - x, 3)
