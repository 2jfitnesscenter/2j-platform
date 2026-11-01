// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// 2J Training Protocol — public surface. See rules.js for the arrangement of this folder
// (canonical here, copied verbatim to api/lib/protocol/ by scripts/sync-protocol.mjs).
export * from './rules.js'
export { classify, redundancyKey } from './classify.js'
export { CATALOG } from './catalog.js'
export { prescribe, repRange, unitsOf, roleOf, restDemand, zoneFor, estimateSeconds, roundMinutes, modeOfEntry, workSeconds, REST_DEFAULTS } from './prescribe.js'
export { validateAgainst2JProtocol, failuresForRepair, savePolicy, OVERRIDE_REASON_MIN } from './validator.js'
export { FOCUS, FOCUS_LABEL, GOAL_LABEL, LEVEL_LABEL, TYPE_LABEL, STYLE_LABEL, blockTitle, blockSubtitle, deriveBlockMeta,
  instantiateBlock, pruneBlocks, segmentsOf, filterBlocks, isGuided, TIMING_LIMITS, TIMING_PRESETS, defaultTiming, sanitizeTiming,
  applyTiming, guidedSeconds, blockTypesOf } from './blocks.js'
export { ROUTINE_CATEGORIES, CATEGORY_LABEL, PART_ROLES, ROUTINE_TAGS, TAG_LABEL, BADGES, CURATED_TAGS, routineFacts, gearOf } from './routines.js'
export { MOVEMENTS, MOVEMENT_BY_ID, movementOfPattern, EQUIPMENT, EQUIPMENT_BY_ID, EQUIPMENT_KINDS, EQUIPMENT_OVERRIDE, equipmentIdOf } from './movements.js'
