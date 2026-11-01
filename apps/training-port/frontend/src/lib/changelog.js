// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// A short, in-app version history — condensed from CHANGELOG.md (the full, prose version kept
// in the repo for GitHub) down to one line per change, no explanations. Item strings go through
// t() wherever they're rendered, same as every other UI string, so translators can pick them up;
// a version's own `date` is a plain ISO string formatted with the viewer's locale at render time.
//
// The 'dev' entry has no version number on purpose: it's everything shipped on top of v1.2.3
// that hasn't been tagged as a release yet, listed so "what changed recently" has an honest
// answer even before that's a formal version — update it as things land, and fold it into a new
// numbered entry (with today's date) once a release is actually cut.
export const CHANGELOG = [
  {
    version: null, date: null,
    items: [
      'Train for your public-service exam: a long-term plan built from the official tests and minimum marks of your convocatoria',
      '17 new Premium programs ready for your gym to publish, and an Actions screen with Premium and Train with 2J',
      'Home starts clean — Calendar and Premium — and you choose what to see, in Home and in Progress',
      '2J Story: a shareable picture of your week or month — weight is never included unless you choose it',
      'Progress opens with your week or month at a glance, compared with the same stretch of the previous one',
      'My 2J is now your athlete passport: records with their evolution and achievements grouped by what matters',
      'Simpler Settings: liquid glass for everyone, a compact accent colour picker and Advanced behind one entry',
      'Training V3: session progress, next exercise, grouped supersets and quick RPE/RIR',
      'A premium post-workout summary, and a Home that adapts to your day',
      'Experience V2: a new visual layer, Health overview, Social and follow-up redesigned',
      'Personalise 2J: choose what you want to see, from just training to the full analysis — and your gym can switch modules off',
      'A simpler Home, with recovery, body weight and deeper analysis in Progress',
      'News and notices from 2J on Home, managed by the gym team',
      'Health on Android: read your workouts and daily activity and send your 2J workouts to Health Connect, without ever counting calories twice',
      '2J exercises: the recommended catalogue grouped by movement, with the full library one tap away',
      'Search exercises by name, movement, muscle or equipment, in Spanish or English',
      'Swapping an exercise shows similar variants of the same movement first, with the reason',
      'Favourite exercises, and duplicates tidied without touching your history',
      'Settings → Legal & credits: the original openGym project, this fork, the license and the source code',
      'Train with 2J: 39 official guided workouts — Tabata, HIIT, circuits, intervals, mobility and more',
      'Start a 2J workout in one tap: it runs with the guided timer and never changes your plan',
      'Search, quick filters, collections, favourites and a “For you” row that explains itself',
      'Trainers can assign a 2J workout to a member or duplicate it and edit their own version',
      'The official block library now has 155 blocks',
      'Guided blocks: circuits, intervals, HIIT, Tabata and mobility run with a timer inside your workout',
      'The block library can switch between a grid and a compact list',
      '2J suggestions point out areas with little direct work and offer compatible blocks',
      'Barbell hip thrust is now in the exercise library under its own name',
      'The Bunker uses the rest your trainer prescribed, with a ring that matches it',
      'Body composition now lives only in Profile → Health / Measurements',
      'Constructor V2 for trainers: build programs by day and block, then edit every exercise',
      'An official library of 118 blocks built and validated under the 2J Training Protocol v1.0',
      'Every routine, block and AI plan is checked against the 2J protocol, with the reason when it steps outside',
      'The trainer’s rest per exercise and the planned 2J effort now show in your workout',
      'Health: “Your physical evolution” — real readings with their source, ranges from 1 month to all time, and A/B comparisons',
      'Tap an arm, the trunk or a leg to see its segmental evolution',
      'An optional pre-workout check-in: energy, sleep, fatigue and discomfort in a few taps',
      'Calories, heart rate and zones on your workouts, only from real sources: Apple Health export, WHOOP and Bluetooth sensors',
      'Live heart rate from a Bluetooth chest strap while training (experimental)',
      'Gym follow-up: assessment templates, review schedule and a factual summary for staff',
      'Mi 2J: your sporting identity — ranks, achievements, records and constancy in one place',
      'After a workout: one summary of your records, new ranks and achievements, with a celebration when you reach a new rank family',
      'Workout V2: choose a Simple view (one exercise, big and clean) or a Detailed one (every set at a glance)',
      'A new 2J keypad for weight, reps and RPE, stepping with the gym’s real dumbbells, plates and machines',
      '“Plates” right on barbell sets: what to load on each side, remembering the bar you use',
      'Progression assistant: before each exercise, a recommendation with its reason and confidence — you decide',
      'Progression always prescribes loads your equipment can actually make',
      'Rest timer: pause and resume, and choose the end alert, sound and vibration',
      'Trainer notes and exercise tips shown apart; images and tips can be turned off',
      'A visual training guide before your first workout, also available in Settings → Training',
      'Train without internet: the workout is kept on the device and syncs exactly once when back online',
      'A discreet connection indicator: offline, syncing, all synced',
      'Smarter "Replace exercise": ranked alternatives instead of a flat list, with equipment filters',
      'Training zones: %1RM/RPE-based intensity zones, shown per set and as a weekly/monthly volume chart',
      'An interactive barbell plate calculator — 9 bar types, edit the target weight, apply it to a set',
      'Muscle recovery: size-aware recovery windows and effort-weighted fatigue, with a time-to-ready estimate',
      '3D badge artwork and a 2J master crest on the Badges screen',
      'Program day cards show each day’s full exercise breakdown, not just the routine name',
      'A badges/achievement system, with a festive unlock celebration',
      'Segmented body-fat and muscle-mass tracking (per limb/trunk), with a %/kg toggle',
      'Strength rank system, with a per-lift, per-muscle-group and overall rank',
      'A staff badge on trainer/admin profiles and their posts',
      'Stretching: an auto-planned or self-picked stretch-only session',
      'Social: trainer-created challenges and private (optionally published) exercise goals',
      'A desktop panel for trainers to build client routines, with optional AI-generated plans',
      'Per-exercise and full-plan PDF export',
      'Profile photo upload',
      'Liquid-glass appearance option, with adjustable opacity and blur',
      'Self-service "lost passkey" recovery, admin-assisted',
      'First + last name required when creating a profile',
      'Health data (workout history, body weight, measurements) encrypted at rest',
      'A batch of smaller fixes across warm-up sets, layout on iOS and accessibility text sizes'
    ]
  },
  {
    version: 'v1.3.0', date: '2026-09-21',
    items: [
      'Superset colors and labels (A1/A2, B1/B2…), consistent on screen and in print',
      'Adaptive print density — a 2-day routine fits one page, a 5-day plan around two',
      'CSV import: Gravl format support, more conservative superset grouping',
      'A separate, isolated AI profile for machine/report/routine scanning and CSV matching',
      'CSV import: a review screen for exercise matches, with optional AI suggestions',
      'Equipment availability — mark gear temporarily out of service, matching exercises are skipped when a workout starts',
      'AI Coach: a direct OpenAI option, alongside Claude and Gemini',
      'Trainer notes on a routine exercise, shown during training and in print',
      'Routine/program version history for trainer-assigned plans',
      '"Show previous sessions" — an exercise’s last three real sessions, on demand',
      'Routine/program rows show a quick summary — exercises, supersets, days, unavailable count',
      'Fixed: a finished or discarded training session could keep reappearing',
      'Fixed: minimizing at the Bunker to let someone else train could strand your own session'
    ]
  },
  {
    version: 'v1.2.3', date: '2026-07-31',
    items: [
      'Keep the screen awake during a workout',
      'Rest timer: a −15s button, redesigned layout',
      'Settings reorganized by what each setting actually affects',
      'Effort per set (RIR or RPE), optional',
      'Effort ratings now come through when importing from another app'
    ]
  },
  {
    version: 'v1.2.2', date: '2026-07-25',
    items: [
      'Timed sets (planks, holds) as an alternative to reps',
      'A progression rule per routine — linear, Greyskull LP, double progression, or none',
      'An estimated one-rep max for every exercise',
      'Share or print a plan',
      'A standalone mobile app (Android APK)',
      'Import history from FitNotes, Strong, Hevy or Apple Health',
      'Fixed: a shared plan naming an unknown exercise could take the app down',
      'Fixed: unit conversion on import applied per file instead of per row'
    ]
  },
  {
    version: 'v1.2.1', date: '2026-07-23',
    items: [
      'A muscle map (front/back body diagram) in Stats, the routine editor and the finish screen',
      'A browser-only live demo, no install needed',
      'Fixed: finishing a workout from its last exercise could blank the app'
    ]
  },
  {
    version: 'v1.2.0', date: '2026-07-23',
    items: [
      'A full visual redesign — new design system, hand-drawn icon set, new tab bar',
      'Home rebuilt around today’s plan',
      'Chart fixes: dark-mode visibility, hover tooltip positioning'
    ]
  },
  {
    version: 'v1.1.3', date: '2026-07-22',
    items: [
      'Admin dashboard (opt-in): user overview, live "training now", disable accounts, invite-only signup',
      'Filter exercises by equipment',
      'Minimize the exercise animation during a workout',
      'Fixed: the rest timer could freeze at 0:01'
    ]
  },
  {
    version: 'v1.1.2', date: '2026-07-22',
    items: [
      'Custom exercises — create, edit and delete your own',
      '12 UI languages, with translated exercise instructions',
      'Fixed: decimal comma input, and the exercise-config sheet overflowing on narrow phones'
    ]
  },
  {
    version: 'v1.1.1', date: '2026-07-21',
    items: [
      'Reliability fixes for push notifications: correct timezone, faster delivery, save-on-background'
    ]
  },
  {
    version: 'v1.1.0', date: '2026-07-21',
    items: [
      'Prebuilt Docker images',
      'Push notifications: rest-timer-over alert and a daily workout reminder',
      'Fixed: the rest timer stalling when the app was backgrounded'
    ]
  },
  {
    version: 'v1.0.0', date: '2026-07-20',
    items: [
      'First release: body-weight tracking, routine planner, guided workouts',
      'Supersets and cardio logging',
      'Passkey login with per-profile data synced across devices',
      'Light/dark themes with 8 accent colors',
      'JSON export/import, guest mode, installable PWA'
    ]
  }
]
