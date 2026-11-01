// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Turns one planned Premium session (lib/premium-model.js planSession) into the entries of a normal workout. Percentage blocks keep the loads the method
// decided; app-driven blocks (a scheme without a percentage) and conditioning go through the same prescription engine as any routine, so progression,
// previous results and deloads behave exactly as everywhere else. Nothing here writes state.
import { buildRoutineEntries } from './progression.js'
import { warmupSets } from './history.js'

const isMain = b => b.role === 'main'

export function premiumEntries(S, plan, { unit = 'kg', warmups = true } = {}) {
  const cfgBlocks = plan.blocks.filter(b => b.kind === 'cfg' || b.kind === 'conditioning')
  const routine = { id: 'premium', name: plan.title, ex: cfgBlocks.map(b => b.kind === 'cfg' ? b.cfg : conditioningCfg(b)) }
  const built = buildRoutineEntries(S, routine)
  const byId = new Map()
  for (const e of built) { const q = byId.get(e.id) || []; q.push(e); byId.set(e.id, q) }
  const out = []
  for (const b of plan.blocks) {
    if (b.kind === 'blocked') continue
    if (b.kind === 'fixed') {
      const work = b.sets.map(s => ({ w: s.w, r: s.r, done: false, ...(s.amrap ? { amrap: true } : {}) }))
      const top = Math.max(0, ...b.sets.map(s => s.w))
      const warm = warmups && b.warmup && isMain(b) ? warmupSets(top, unit) : []
      out.push({ id: b.exercise, target: { sets: work.length, reps: b.sets[0]?.r || 5 }, plan: { auto: 'premium', premium: true, why: b.why }, sets: [...warm, ...work] })
      continue
    }
    const e = byId.get(b.exercise)?.shift()
    if (e) out.push(e)
  }
  return out
}

function conditioningCfg(b) {
  const c = b.conditioning || {}
  return c.sec > 0
    ? { id: b.exercise, sets: 1, mode: 'time', sec: c.sec, ...(b.rest ? { rest: b.rest } : {}) }
    : { id: b.exercise, sets: 1, mode: 'cardio', min: c.min || 20, ...(c.speed ? { speed: c.speed } : {}) }
}
