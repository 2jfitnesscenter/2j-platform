// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The words for a Training Quality finding. lib/routine-structure.js decides (code + params + evidence, no prose);
// this only phrases it, in the member's language, in three separate layers: the fact (what the plan contains),
// the interpretation (what that may mean — tagged heuristic or inference when it is not a plain fact) and a
// suggestion that only ever asks the trainer to check, never to change.
import { t, nameFor } from './i18n.js'
import { EXIDX } from './exercises.js'
import { groupLabel, equipmentLabel } from './library/index.js'

/** The pattern families, as the panel and the findings name them. */
export const PATTERN_LABEL = {
  horizontal_push: 'Horizontal press', vertical_push: 'Overhead press', horizontal_pull: 'Row', vertical_pull: 'Pulldown & pull-up',
  knee_dominant: 'Knee-dominant', hip_dominant: 'Hip-dominant', core: 'Core', conditioning: 'Conditioning', power: 'Clean, snatch & thruster', carry: 'Carry',
}
const patternName = k => t(PATTERN_LABEL[k] || k)
const groupsText = list => (list || []).map(g => `${t(groupLabel(g.group) || g.group)} ${g.sets}`).join(', ')
const exName = id => { const ex = EXIDX[id]; return ex ? nameFor(ex) : id }

/** How sure the interpretation is, as a short label. A plain fact needs no label. */
export const evidenceTagLabel = type => (type === 'heuristic' ? t('Rule of thumb') : type === 'inference' ? t('Inference') : '')

/** { fact, interpretation, suggestion } for a finding — each already translated; an empty string when a layer does not apply. */
export function findingTexts(f) {
  const p = f?.params || {}
  switch (f?.code) {
    case 'push_without_pull': return {
      fact: t('{0} push sets and no pull sets in the plan.', p.pushSets),
      interpretation: t('With no pulling at all, the back and rear shoulders get no direct work from this plan.'),
      suggestion: t('Check whether a row or a pulldown fits the goal and the available equipment.') }
    case 'pull_direction_missing': return {
      fact: t('{0} sets of {1} and none of {2}.', p.sets, patternName(p.present), patternName(p.absent)),
      interpretation: t('The pulling comes from one direction only.'),
      suggestion: t('Check whether that is intentional before changing it.') }
    case 'knee_without_hip': return {
      fact: t('{0} sets of knee-dominant work and none of hip-dominant work.', p.kneeSets),
      interpretation: t('Hip-dominant work often complements knee-dominant work for these goals.'),
      suggestion: t('Check whether this choice is intentional for the goal of the routine.') }
    case 'push_heavy': return {
      fact: t('{0}% of the upper-body sets are pushes ({1} push, {2} pull).', p.percent, p.pushSets, p.pullSets),
      interpretation: t('Most of the upper-body volume is concentrated in pushing.'),
      suggestion: t('Worth checking whether that is intentional for this goal.') }
    case 'pull_heavy': return {
      fact: t('{0}% of the upper-body sets are pulls ({1} push, {2} pull).', p.percent, p.pushSets, p.pullSets),
      interpretation: t('Most of the upper-body volume is concentrated in pulling.'),
      suggestion: t('Worth checking whether that is intentional for this goal.') }
    case 'pattern_concentration': return {
      fact: t('{0}% of the sets go to one pattern: {1} ({2} sets).', p.percent, patternName(p.pattern), p.sets),
      interpretation: t('The volume is concentrated in a single movement pattern.'),
      suggestion: t('Check whether the rest of the week covers what the goal needs.') }
    case 'volume_above_reference': return {
      fact: t('Above the reference range ({0}–{1} direct sets a week): {2}.', p.range?.[0], p.range?.[1], groupsText(p.groups)),
      interpretation: t('The range is a rule of thumb for {0} hypertrophy programs, not a limit.', t(p.level === 'beginner' ? 'beginner' : p.level === 'advanced' ? 'advanced' : 'intermediate')),
      suggestion: t('Consider whether that volume fits how the member recovers.') }
    case 'volume_below_reference': return {
      fact: t('Below the reference range ({0}–{1} direct sets a week): {2}.', p.range?.[0], p.range?.[1], groupsText(p.groups)),
      interpretation: t('The range is a rule of thumb for {0} hypertrophy programs, not a limit.', t(p.level === 'beginner' ? 'beginner' : p.level === 'advanced' ? 'advanced' : 'intermediate')),
      suggestion: t('Check whether these muscles are meant to be a priority.') }
    case 'equipment_missing': return {
      fact: t('{0} needs equipment the active profile does not include ({1}).', exName(p.exerciseId), t(equipmentLabel(p.required) || p.required || '')),
      interpretation: '',
      suggestion: t('Review a compatible variant before saving.') }
    case 'deprecated_exercise': return {
      fact: t('{0} has a preferred replacement in the library: {1}.', exName(p.exerciseId), exName(p.preferredId)),
      interpretation: '',
      suggestion: t('Review the preferred option from the library.') }
    case 'redundancy': return {
      fact: t('{0}: {1} exercises with a very similar stimulus.', p.day, p.count),
      interpretation: t('The library files them under the same pattern and the same side.'),
      suggestion: t('Check that each variant has a different job; anchored exercises are kept.') }
    case 'unclassified_exercises': return {
      fact: t('{0} exercises have too little library data to be analysed.', p.count),
      interpretation: t('They are left out of the counts; no pattern or equipment is assumed.'),
      suggestion: '' }
    case 'consecutive_days': return {
      fact: t('Movements repeat on consecutive days: {0}.', (p.movements || []).map(m => t(m.replace(/_/g, ' '))).join(', ')),
      interpretation: t('Recovery between those sessions may be short.'),
      suggestion: t('Consider rest and the priorities of the program before changing the order.') }
    case 'omitted_recently': return {
      fact: t('{0} planned exercises are missing from most of the recent sessions.', p.count),
      interpretation: t('The period reviewed may not be representative.'),
      suggestion: t('Confirm first that the period reviewed is representative.') }
    default: return { fact: '', interpretation: '', suggestion: '' }
  }
}

/** The one-line form lists use: the fact alone. */
export const findingLine = f => findingTexts(f).fact

/** Why no reference range is shown, as a short note (empty when one is). */
export const referenceNote = reference => {
  if (!reference || reference.applicable) return ''
  if (reference.reason === 'single-day') return t('A reference range needs a whole week of routines.')
  if (reference.reason === 'goal') return t('Reference ranges only apply to hypertrophy programs.')
  if (reference.reason === 'level') return t('Set the level to compare with a reference range.')
  return ''
}
