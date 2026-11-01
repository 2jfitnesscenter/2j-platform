// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Bunker.jsx's own local, per-device map of "which members THIS exact kiosk instance already
// has a valid bunker token for" — { [uid]: { token, name, exp } }, kept in React state, never
// persisted to localStorage (a shared physical kiosk is exactly the wrong place to leave a
// readable credential for whoever left it minimized — see Bunker.jsx's own doc comment for the
// full rationale). Extracted here, not inline, purely so it's unit-testable: this project's
// vitest has no DOM environment, so a component-level test of the actual tap-to-resume click
// isn't possible, but the pure "what survives a board refresh" rule is.
//
// A credential survives a board refresh only if its member's card is still on the board (still
// checked in — minimizing never removes a card from the board, see api/bunker/routes.js's own
// comment on why there is no minimize endpoint) OR they are the currently open panel (a board
// reconciliation must never interrupt an actively-training session just because of a timing
// gap between two polls). Anyone whose card disappeared for any other reason — finished,
// admin force-closed, timed out idle (api/bunker/store.js's IDLE_TTL) — loses their local
// credential; the next tap on that name, if it ever reappears, asks for the PIN again.
export function purgeStaleCredentials(credentials, board, activeUid) {
  const present = new Set(board.map(s => s.uid))
  const active = new Set(Array.isArray(activeUid) ? activeUid : (activeUid ? [activeUid] : []))
  let changed = false
  const next = {}
  for (const uid of Object.keys(credentials)) {
    if (active.has(uid) || present.has(uid)) next[uid] = credentials[uid]
    else changed = true
  }
  return changed ? next : credentials
}
