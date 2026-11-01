// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Muscle-priority taxonomy — collected once at registration (and editable later from Settings
// or, for a member, from the Admin panel), used to personalize both the quick PPL plan
// (starter.js's buildPlan — which routine gets the extra day on a 4-6 day split) and the AI
// Coach (api/coach/payload.js + prompts/create.md — which gets more volume). Deliberately a
// short, recognizable list rather than the exercise library's own bp/tg taxonomy, and a
// separate list from lib/muscles.js's 18-muscle body-map taxonomy (that one's slugs — e.g.
// 'gluteal', 'quadriceps' — exist to match what the body map SVG can shade; this one's — e.g.
// 'glutes', 'quads' — exist to be a short, friendly picker at registration).
export const MUSCLES = ['quads', 'glutes', 'hamstrings', 'calves', 'chest', 'back', 'shoulders', 'biceps', 'triceps', 'abs']
// Labels are picked to reuse existing translations where they already exist (the body-map
// taxonomy in lib/muscles.js, the exercise library's body-part filter) — 'back' stays
// lowercase deliberately: the capitalized 'Back' key is already the navigation button's text
// ("go back"), and reusing it here would show "Atrás" in this picker instead of "Espalda".
export const MUSCLE_LABEL = {
  quads: 'Quads', glutes: 'Glutes', hamstrings: 'Hamstrings', calves: 'Calves',
  chest: 'Chest', back: 'back', shoulders: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps', abs: 'Abs'
}
