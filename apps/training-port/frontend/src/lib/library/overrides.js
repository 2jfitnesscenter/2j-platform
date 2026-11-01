// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Exercise Library V2 — the 2J layer over the upstream exercise dataset. Versioned in code,
// checked by scripts/check-exercise-library.mjs. Nothing here changes an id, deletes a record or
// touches history: it only adds what the dataset cannot say about itself.
//
// Every decision below has evidence recorded next to it (the dataset's own images and names were
// compared). "Not sure" stays out: a possible duplicate is reported by the audit, not deprecated.

export const LIBRARY_VERSION = 1

/**
 * Real duplicates (class A in docs/EXERCISE_LIBRARY_V2.md): the same exercise filmed twice.
 * deprecated id → preferred id. The deprecated id keeps working everywhere (history, PRs, old
 * routines, imports); it is only hidden from normal search and new selections, and an import
 * that resolves to it is filed under the preferred id instead.
 */
export const DEPRECATED = {
  '1731': '0296', // dumbbell close grip press = close-grip press on a flat bench, other camera
  '0108': '1372', // barbell standing (leg) calf raise, toes elevated, other camera
  '0382': '1654', // dumbbell reverse-grip biceps curl, standing, identical frames
  '1680': '0422', // one-arm curl over an incline bench, other camera
  '2800': '2799', // same seated barbell leg raise, female model
  '2801': '2802', // same captain's-chair twisted leg raise, female model
  '1461': '0043', // barbell full squat (back pov) — a camera angle of 0043
  '1462': '0043', // barbell full squat (side pov)
  '1463': '0739', // sled 45° leg press (side pov)
  '1464': '0739', // sled 45° leg press (back pov)
  '1765': '0437', // dumbbell upright row (back pov)
  '0312': '0313', // identical dataset steps, implement, movement and target: hammer curl v. 2
  '0395': '0396', // identical dataset steps, implement, movement and target: seated lateral raise v. 2
  '2318': '0869', // identical dataset steps, implement, movement and target: lever shoulder press v. 3
  // Quality pass (Entrena con 2J Admin sprint). The remaining "v. N" groups were compared step by
  // step: same name once "v. N" is removed, same implement, same target, and the SAME execution
  // sequence — only the wording of the dataset's instructions differs (no other grip, angle, setup
  // or range). The images are not in the repository, so a pair whose steps differ in any
  // execution detail stays a reviewed variant below instead. The preferred id is the curated or
  // lower-numbered record; none of these twins is used by an official block or routine.
  '0077': '0078', // barbell rear lunge v. 2 — identical five steps, wording of step 1 only
  '0119': '0120', // barbell upright row v. 2 — same grip, width and path (steps 96 % identical)
  '0121': '0120', // barbell upright row v. 3 — same as above
  '0287': '2137', // dumbbell Arnold press v. 2 — steps 100 % identical in content ("end up facing")
  '1657': '0298', // dumbbell cross-body hammer curl v. 2 — same path to the opposite shoulder
  '2136': '0299', // dumbbell Cuban press v. 2 — same press and rotation sequence
  '0360': '0361', // dumbbell one-arm shoulder press v. 2 — same four steps
  '1479': '1299', // lever incline chest press v. 2 — same setup; only "do not lock the elbows" added
  '0309': '0310', // dumbbell front raise v. 2 — same raise to shoulder height (dataset secondary muscle differs)
  '0513': '0514', // jump squat v. 2 — same squat and jump; arm swing mentioned in one only
  '0658': '0659', // wall push-up v. 2 — same stance, hands on the wall at shoulder height
  '2371': '0846', // weighted Russian twist v. 2 — same seated lean and twist
}

/**
 * Recommended 2J = the curated catalogue (lib/protocol/catalog.js — what the official blocks are
 * built from) plus this controlled extension: common gym staples with a correct name, a clear
 * movement and a real image. Kept short on purpose; the master library stays one tap away.
 */
export const EXTRA_RECOMMENDED = [
  '0576', // plate-loaded chest press (the weight-stack one, 0577, is curated)
  '0033', '0301', // decline bench press — barbell, dumbbells
  '0770', // Smith machine squat
  '0117', // sumo deadlift
  '0095', // barbell shrug
  '0162', // cable front raise
  '0673', '0818', // machine lat pulldown (reverse grip), parallel-grip pulldown
  '0979', // band Pallof press
  '0226', // cable standing crunch
  '0684', '3666', '2138', '2141', '2331', '2311', '0798', // cardio machines used in 2J sessions
  '2142', // SkiErg: in the gym's equipment list, used by the SkiErg intervals
  '0128', // battling ropes: clear conditioning intervals
  '0500', // isometric wipers: clear core rotation
  '1362', // sphinx: simple floor mobility
]

/** Movement where the dataset's body part / target is misleading (ergometers filed under chest/arms). */
export const MOVEMENT_OVERRIDE = {
  '2139': 'cardio', '2142': 'cardio',
  '1408': 'hip_thrust', // band hip lift: steps describe a glute bridge
  '0128': 'conditioning', '2271': 'conditioning', '3552': 'conditioning', '1354': 'conditioning', '2459': 'conditioning',
  '1017': 'rear_delt', '0191': 'rear_delt', '3542': 'rear_delt', '3541': 'rear_delt', '0341': 'rear_delt',
  '0050': 'front_raise', '0759': 'front_raise',
  '0325': 'vertical_push', '0328': 'vertical_push', // incline 'raise' instructions actually press overhead
  '0332': 'lateral_raise', '0408': 'lateral_raise', '0844': 'lateral_raise',
  '0863': 'shoulder_rotation', '0339': 'knee_flexion', '0628': 'hip_abduction', '0624': 'squat',
  '0466': 'vertical_pull', '0680': 'vertical_pull',
  '1418': 'mobility', '1582': 'mobility', '1587': 'mobility', '2203': 'mobility', '2209': 'mobility', '1362': 'mobility', '1364': 'mobility', '1366': 'mobility',
  '0500': 'core_rotation', '1416': 'core_rotation', '3669': 'core_rotation',
  '1297': 'chest_fly', '0555': 'core_flexion', '0730': 'lunge', '3433': 'core_anti_extension',
  '1302': 'horizontal_push', '1303': 'horizontal_push', '1304': 'horizontal_push', '1305': 'horizontal_push',
  // Quality pass: exercises that had no canonical movement, assigned only where the dataset's own
  // steps (and the Spanish name) agree on the job. Levers and skin-the-cat (skills),
  // the two band hip rotations (steps contradict the name), balance board, "around the world",
  // "elevator", "London bridge", "pirate", "breeding", the exercise-ball arm lift and the assisted
  // prone hamstring (steps describe a curl, the name a stretch) stay unclassified on purpose.
  '0376': 'lateral_raise',   // "raise your arms out to the sides until parallel to the floor"
  '0415': 'lateral_raise',   // alternating raise "to the side … parallel to the ground"
  '3546': 'vertical_push',   // seated alternating press "up overhead"
  '0720': 'vertical_pull',   // chin-up variant: "bringing your chin towards the bar"
  '1689': 'horizontal_push', // both phases of the steps are push-up repetitions
  '1338': 'mobility',        // "until you feel a stretch in your back muscles"; Spanish name says stretch
  '1355': 'mobility',        // one-arm lat stretch against a wall; Spanish name says stretch
  '1312': 'conditioning',    // medicine-ball push, release, then run to catch it
  '0548': 'olympic',         // explosive hip drive and high pull (a weightlifting pull)
  // Training Quality V2 data pass. The five muscle-ups: target lats, and every set of steps pulls the chest to the bar from a
  // dead hang (the dip-like transition on top is the second phase), so they count as a vertical pull. A hybrid skill, filed by its primary job.
  '0558': 'vertical_pull', '0631': 'vertical_pull', '1401': 'vertical_pull', '3286': 'vertical_pull', '3312': 'vertical_pull',
  // Triceps kickbacks were filed as hip extension (the name rule matched "kickback" first). Target muscle, Spanish name
  // ("patada de tríceps") and steps ("extend your arms straight back, squeezing your triceps") all say elbow extension.
  '0860': 'elbow_extension', '0333': 'elbow_extension', '0354': 'elbow_extension', '0394': 'elbow_extension', '0398': 'elbow_extension',
  '0420': 'elbow_extension', '1728': 'elbow_extension', '1730': 'elbow_extension', '1734': 'elbow_extension', '1739': 'elbow_extension', '1742': 'elbow_extension',
}

/**
 * Search and import aliases — the words members and other apps actually use, Spanish first.
 * Each alias must point to exactly one id (the check fails on an alias shared by two ids).
 * Import matching already has the English vocabulary (lib/import-csv.js ALIAS_EX); these add
 * the Spanish one and the names an exercise had before a 2J correction.
 */
export const ALIASES = {
  '0025': ['press banca', 'press de banca', 'press plano'],
  '0047': ['press inclinado', 'press banca inclinado'],
  '0033': ['press declinado', 'press banca declinado'],
  '0289': ['press con mancuernas', 'press banca con mancuernas'],
  '0043': ['sentadilla', 'sentadilla trasera', 'sentadilla con barra'],
  '0042': ['sentadilla frontal'],
  '1760': ['sentadilla goblet', 'goblet'],
  '0743': ['sentadilla hack', 'hack squat', 'hack'],
  // Gym names for the dataset's own "lever …" machines (checked against each exercise's name and steps)
  '0596': ['pec deck', 'peck deck', 'contractora', 'maquina mariposa'],      // lever seated fly
  '0602': ['pec deck inverso', 'reverse pec deck', 'contractora inversa'],    // lever seated reverse fly
  '2286': ['maquina de gluteo', 'glute machine'],                           // lever hip extension: seated machine, glutes and hamstrings push the footplate back
  '0383': ['pajaros'],                                                        // dumbbell reverse fly
  '0739': ['prensa', 'prensa de piernas', 'prensa 45', 'prensa inclinada', 'sled 45в° leg press'],
  '0738': ['sled 45в° calf press'],
  '0740': ['sled 45в° leg wide press'],
  '0032': ['peso muerto'],
  '0085': ['peso muerto rumano', 'rumano'],
  '0117': ['peso muerto sumo'],
  '0058': ['hip thrust con barra', 'empuje de cadera'],
  '1409': ['puente de gluteos', 'puente de gluteo con barra'],
  '0652': ['dominadas', 'dominada prona'],
  '1326': ['dominadas supinas', 'chin up'],
  '0198': ['jalon', 'jalon al pecho', 'jalon polea', 'lat pulldown'],
  '0027': ['remo con barra'],
  '0292': ['remo con mancuerna', 'remo a una mano'],
  '0861': ['remo en polea', 'remo gironda', 'remo sentado en polea'],
  '1350': ['remo en maquina'],
  '0091': ['press militar'],
  '0405': ['press de hombro con mancuernas'],
  '0334': ['elevaciones laterales', 'laterales'],
  '0294': ['curl de biceps', 'curl con mancuernas'],
  '0031': ['curl con barra'],
  '0313': ['curl martillo'],
  '0201': ['extension de triceps en polea', 'jalon de triceps'],
  '0251': ['fondos', 'fondos en paralelas'],
  '0586': ['curl femoral'],
  '0585': ['extension de cuadriceps', 'extensiones de pierna'],
  '0336': ['zancadas', 'zancada'],
  '1372': ['elevacion de gemelos'],
  '0308': ['aperturas'],
  '0274': ['abdominales', 'crunch'],
  '0095': ['encogimientos'],
  '0684': ['run (equipment)', 'correr en cinta', 'cinta'],
  '3666': ['caminar en cinta', 'cinta inclinada'],
  '2138': ['bici', 'bicicleta', 'bici estatica'],
  '2141': ['eliptica'],
  '2311': ['escaladora', 'stepmill'],
  '0128': ['cuerdas de batalla'],
  '0500': ['limpiaparabrisas isometricos'],
  '1362': ['postura de la esfinge'],
  // Quality pass: words members use for the exercises the guided sessions are built from.
  '0662': ['flexiones', 'flexion de brazos', 'push up', 'lagartijas'],
  '0630': ['escaladores', 'mountain climbers'],
  '1160': ['burpees'],
  '3360': ['bear crawl', 'arrastre del oso'],
  '1471': ['gusano', 'caminata de manos', 'inchworm walkout'],
  '2142': ['skierg', 'esqui ergometro'],
  '1604': ['world greatest stretch', 'zancada con rotacion'],
  '1585': ['zancada del corredor'],
  '0276': ['bicho muerto'],
  '1403': ['estiramiento de cuello'],
  '0716': ['estiramiento de cuello con mano'],
}

export const aliasCountOf = id => (ALIASES[id] || []).length

/**
 * Display-name corrections: typos in the upstream English name. `n` replaces the English name
 * (everywhere the app reads `ex.n`); `es` would replace the Spanish one. The dataset record is
 * never edited. The "(male)/(female)" model label some upstream names end with is removed
 * programmatically (core.js) wherever the shorter name stays unique.
 */
export const NAME_OVERRIDE = {
  '1512': { n: 'all fours quad stretch' },  // "squad" in the dataset
  '1418': { n: 'hug knees to chest' },       // "keens" in the dataset
}

/**
 * Pairs that share a name in the dataset but are different exercises (class B), checked against
 * the dataset's images — kept as separate variants and renamed apart in the data itself.
 * The audit marks them "reviewed" instead of "possible duplicate".
 */
export const REVIEWED_VARIANTS = [
  ['0576', '0577'], // plate-loaded vs weight-stack chest press
  ['0454', '1628'], // spider curl lying on an incline bench vs standing on a stand
  ['0655', '0656'], // push-up hands on the ball vs feet on the ball
  ['0088', '1371'], // seated calf raise flat vs toes elevated
  ['0763', '1394'], // Smith calf raise, bar on back on a step vs bar in front
  ['0746', '0767'], // Smith shrug behind vs in front
  ['0697', '1766'], // nordic curl anchored on a machine vs on a bench (class C: kept, not deprecated)
  ['0098', '0097'], // stationary wide squat vs lateral step into a squat (dataset instructions)
  ['0318', '0317'], // upper arms supported on incline bench vs arms free
  ['1471', '3698'], // hands walk out and back vs travelling with feet towards hands
  ['1452', '3760'], // separate crunch machine setups, only second has secured feet
  // Quality pass — pairs compared step by step whose execution differs in a way the steps state, so
  // they are NOT merged (class B/C: different grip, setup or cue; class D: ambiguous). Kept apart.
  ['0126', '0125'], // barbell wrist curl: rolls the bar to the fingertips vs wrists hanging off the thighs, hands shoulder-width
  ['0305', '0304'], // decline-bench shrug: arms hang vs palms facing and shoulder blades squeezed together
  ['0343', '0342'], // one-arm lying press: palm forward vs palm towards the feet, elbow close to the body
  ['0499', '0497'], // inverted row: free bar or suspension trainer vs bar on a Smith machine, narrower grip
  ['0580', '1439'], // gripless shrug machine: palms inwards vs overhand bars, back against the pad
  ['0592', '1614'], // lever preacher curl: plain pad vs chest-supported seat, wider underhand grip
  ['0603', '0869'], // lever shoulder press: straight up vs "upward and forward" path — possibly another machine
]
