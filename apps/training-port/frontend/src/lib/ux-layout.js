// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Writing the member's layout choices (Home, Progress) and the "personalisation guide seen" flag into S.ux, from anywhere (Home, Progress, Settings). One place, pure
// functions over a draft state: they keep the rest of S.ux (the member's feature choices) intact, store nothing when a layout equals its default, and never touch data.
import { makeUx, currentUses } from './features.js'
import { homeChoice, HOME_BLOCKS } from './home-blocks.js'
import { progressChoice, PROGRESS_CARDS } from './progress-cards.js'

const base = S => (S.ux && typeof S.ux === 'object' ? S.ux : makeUx(currentUses(S), Date.now()))
const put = (S, key, value) => {
  const ux = { ...base(S) }
  if (value === undefined) delete ux[key]; else ux[key] = value
  S.ux = ux
}

/** Stores (or clears, when it is the default) the layout of 'home' or 'progress'. `layout` = { order, hidden }. */
export function setLayout(S, which, layout) {
  put(S, which, which === 'home' ? homeChoice(layout.order, layout.hidden) : progressChoice(layout.order, layout.hidden))
}
/** Back to the default layout of one page: the stored choice is removed. */
export const restoreLayout = (S, which) => { if (S.ux?.[which] !== undefined) put(S, which, undefined) }

export const CATALOGUES = { home: HOME_BLOCKS, progress: PROGRESS_CARDS }

/** The first-time guide of the personalisation mode: seen once, remembered in the profile (so it does not come back on another device), and re-armable from Settings. */
export const guideSeen = S => !!S?.ux?.guide?.seen
export const markGuideSeen = S => put(S, 'guide', { seen: Date.now() })
export const resetGuide = S => { if (S.ux?.guide !== undefined) put(S, 'guide', undefined) }
