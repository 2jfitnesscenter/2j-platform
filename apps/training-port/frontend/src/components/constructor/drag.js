// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Constructor drag & drop between panels: the exercise library (left) and the block library
// (right) drag an id onto the day canvas. Internal reordering inside the canvas keeps its own
// 'text/plain' drag and never reads these types.
export const EX_DRAG_TYPE = 'application/x-2j-exercise'
export const BLOCK_DRAG_TYPE = 'application/x-2j-block'

/** What an external drag carries: 'ex' | 'block' | null (types are readable during dragover). */
export function dragKindOf(ev) {
  const types = [...(ev?.dataTransfer?.types || [])]
  return types.includes(EX_DRAG_TYPE) ? 'ex' : types.includes(BLOCK_DRAG_TYPE) ? 'block' : null
}
