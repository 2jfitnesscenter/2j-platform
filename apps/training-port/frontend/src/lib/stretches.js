// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// A small, self-contained library for the Stretching tab — deliberately separate from EXDB
// (lib/exercises.js): these are held/paced movements with no weight or rep count, driven by a
// countdown per exercise, so none of the strength app's rank/PR/progression machinery applies
// to them. Images are static illustrations Juanjo supplied (public/stretch/), one per movement
// — there is no animated GIF for these, unlike the main exercise library.
//
// `goals` marks which of the three intake-wizard goals a stretch fits (a stretch can fit more
// than one): `strength` (warm-up/mobility before lifting), `recovery` (easing off after a
// session), `mobility` (general suppleness/desk-life stiffness). `area` is the body region(s)
// it targets, used for the "which areas" filter and the exercise-detail chips. `type` is
// `static` (held in place) or `dynamic` (repeated slow reps) — only affects the caution copy
// and how the duration reads ("mantén" vs "repite").

const IMG = 'src_data_illustrations_'
const img = (gender, key) => `/stretch/${IMG}${gender}_${key}.webp`

export const AREAS = [
  'neck', 'shoulders', 'chest', 'upperback', 'lowerback', 'core',
  'hips', 'glutes', 'hamstrings', 'quads', 'calves', 'ankles', 'wrists', 'fullbody'
]
export const AREA_LABEL = {
  neck: 'Cuello', shoulders: 'Hombros', chest: 'Pecho', upperback: 'Espalda alta',
  lowerback: 'Espalda baja', core: 'Core', hips: 'Cadera', glutes: 'Glúteos',
  hamstrings: 'Isquios', quads: 'Cuádriceps', calves: 'Gemelos', ankles: 'Tobillos',
  wrists: 'Muñecas y antebrazos', fullbody: 'Cuerpo completo'
}
export const GOALS = [
  { value: 'strength', label: 'Levantar más peso', sub: 'Calentamiento y movilidad para el gym' },
  { value: 'recovery', label: 'Recuperarte del entreno', sub: 'Estiramientos suaves después de entrenar' },
  { value: 'mobility', label: 'Sentirte más suelto', sub: 'Compensa tanta silla y tanta tensión' }
]
export const LEVELS = [
  { value: 'new', label: 'Principiante', sub: 'Bastante rígido, no me toco los pies' },
  { value: 'mid', label: 'Intermedio', sub: 'Estiro a veces, todavía no es un hábito' },
  { value: 'adv', label: 'Avanzado', sub: 'Mucha movilidad, estirar es un hábito' }
]

export const STRETCHES = [
  { id: '9090stretch', n: '90/90', area: ['hips'], goals: ['recovery', 'mobility'], type: 'static', dur: 45, img: img('female', '9090stretch'),
    steps: ['Siéntate con una pierna doblada 90° delante y la otra 90° al lado, ambas apoyadas en el suelo.', 'Mantén el torso erguido e inclínate ligeramente hacia la pierna delantera.'],
    caution: 'Si la rodilla de atrás protesta, apoya algo blando debajo.' },
  { id: 'anklerocks', n: 'Balanceo de tobillo', area: ['ankles'], goals: ['strength', 'mobility'], type: 'dynamic', dur: 30, img: img('male', 'anklerocks'),
    steps: ['De pie, lleva la rodilla hacia delante sobre el pie manteniendo el talón en el suelo.', 'Balancéate hacia delante y atrás con control, sin que el talón despegue.'] },
  { id: 'armcircles', n: 'Círculos de brazos', area: ['shoulders'], goals: ['strength'], type: 'dynamic', dur: 30, img: img('female', 'armcircles'),
    steps: ['Brazos extendidos a los lados, traza círculos pequeños que van agrandándose.', 'Cambia de sentido a mitad del tiempo.'] },
  { id: 'armswings', n: 'Balanceo de brazos', area: ['shoulders', 'chest'], goals: ['strength'], type: 'dynamic', dur: 30, img: img('female', 'armswings'),
    steps: ['Balancea los brazos cruzándolos delante del pecho y abriéndolos de nuevo.', 'Aumenta el rango poco a poco, sin forzar el hombro.'] },
  { id: 'behindbackshoulderstretch', n: 'Estiramiento de hombro tras la espalda', area: ['shoulders'], goals: ['recovery', 'mobility'], type: 'static', dur: 30, img: img('male', 'behindbackshoulderstretch'),
    steps: ['Lleva un brazo por detrás de la espalda y sujétalo suavemente con la otra mano.', 'Tira poco a poco hacia el lado contrario, hombros relajados.'] },
  { id: 'butterflystretch', n: 'Mariposa', area: ['hips'], goals: ['recovery', 'mobility'], type: 'static', dur: 45, img: img('male', 'butterflystretch'),
    steps: ['Sentado, junta las plantas de los pies y deja caer las rodillas hacia el suelo.', 'Inclina el torso hacia delante manteniendo la espalda larga.'] },
  { id: 'catcow', n: 'Gato-vaca', area: ['lowerback', 'upperback', 'core'], goals: ['strength', 'recovery', 'mobility'], type: 'dynamic', dur: 40, img: img('female', 'catcow'),
    steps: ['A cuatro patas, manos bajo hombros y rodillas bajo caderas.', 'Al inhalar arquea el pecho y el coxis hacia arriba; al exhalar redondea la espalda alta metiendo barbilla y pelvis.'],
    caution: 'Mueve toda la columna, no solo la zona lumbar.' },
  { id: 'chestopener', n: 'Apertura de pecho', area: ['chest', 'shoulders'], goals: ['recovery', 'mobility'], type: 'static', dur: 30, img: img('male', 'chestopener'),
    steps: ['Entrelaza las manos por detrás de la espalda y estira los brazos.', 'Junta los omóplatos y saca pecho suavemente.'] },
  { id: 'childspose', n: 'Postura del niño', area: ['lowerback', 'hips'], goals: ['recovery', 'mobility'], type: 'static', dur: 45, img: img('female', 'childspose'),
    steps: ['De rodillas, siéntate sobre los talones y estira los brazos hacia delante apoyando el pecho cerca del suelo.', 'Respira profundo, dejando que la espalda baja se suelte.'] },
  { id: 'cobrastretch', n: 'Cobra', area: ['core', 'lowerback'], goals: ['recovery', 'mobility'], type: 'static', dur: 30, img: img('female', 'cobrastretch'),
    steps: ['Boca abajo, manos bajo los hombros, eleva el pecho manteniendo la cadera en el suelo.', 'Codos ligeramente flexionados, hombros lejos de las orejas.'],
    caution: 'Sube solo hasta donde la zona lumbar esté cómoda.' },
  { id: 'couchstretch', n: 'Estiramiento del sofá', area: ['quads', 'hips'], goals: ['recovery', 'mobility'], type: 'static', dur: 45, img: img('male', 'couchstretch'),
    steps: ['De rodillas, apoya la espinilla trasera contra una pared o sofá y el pie delantero plano en el suelo.', 'Aprieta el glúteo del lado que estiras y mantén el torso erguido.'],
    caution: 'Ve con calma — es uno de los más intensos de cuádriceps y cadera.' },
  { id: 'crossbodyshoulderstretch', n: 'Estiramiento de hombro cruzado', area: ['shoulders'], goals: ['recovery', 'mobility'], type: 'static', dur: 30, img: img('male', 'crossbodyshoulderstretch'),
    steps: ['Cruza un brazo por delante del pecho.', 'Con la otra mano, presiona suavemente el brazo hacia el cuerpo por encima o debajo del codo.'] },
  { id: 'deadhang', n: 'Colgado pasivo', area: ['shoulders', 'upperback'], goals: ['recovery', 'mobility'], type: 'static', dur: 30, img: img('male', 'deadhang'),
    steps: ['Cuélgate de una barra con los brazos totalmente extendidos.', 'Deja que los hombros y la espalda se relajen con el propio peso del cuerpo.'],
    caution: 'Usa una barra estable y baja con control si notas fatiga en el agarre.' },
  { id: 'deepsquathold', n: 'Sentadilla profunda mantenida', area: ['hips', 'ankles'], goals: ['strength', 'mobility'], type: 'static', dur: 45, img: img('male', 'deepsquathold'),
    steps: ['Baja a una sentadilla completa, talones apoyados y pecho erguido.', 'Usa los codos para abrir las rodillas suavemente hacia fuera si llega bien.'] },
  { id: 'deepsquatpry', n: 'Sentadilla profunda con balanceo', area: ['hips', 'ankles'], goals: ['strength', 'mobility'], type: 'dynamic', dur: 40, img: img('female', 'deepsquatpry'),
    steps: ['Desde la sentadilla profunda, balancea el peso de un lado a otro abriendo cada rodilla por turnos.', 'Mantén los talones en el suelo durante todo el movimiento.'] },
  { id: 'doorwaycheststretch', n: 'Estiramiento de pecho en marco de puerta', area: ['chest'], goals: ['recovery', 'mobility'], type: 'static', dur: 30, img: img('male', 'doorwaycheststretch'),
    steps: ['Apoya el antebrazo en el marco de una puerta, codo a la altura del hombro.', 'Da un paso adelante hasta notar el estiramiento en el pecho.'] },
  { id: 'downwarddogpedals', n: 'Pedaleo en perro boca abajo', area: ['calves', 'hamstrings'], goals: ['strength', 'mobility'], type: 'dynamic', dur: 40, img: img('female', 'downwarddogpedals'),
    steps: ['Desde el perro boca abajo, dobla una rodilla mientras estiras la otra, como pedaleando.', 'Alterna de pierna manteniendo la cadera alta.'] },
  { id: 'dynamic9090', n: '90/90 dinámico', area: ['hips'], goals: ['strength', 'mobility'], type: 'dynamic', dur: 40, img: img('male', 'dynamic9090'),
    steps: ['Desde la posición 90/90, rota las rodillas de un lado al otro por encima del suelo.', 'Mantén el torso lo más vertical posible durante la rotación.'] },
  { id: 'dynamiccheststretch', n: 'Apertura dinámica de pecho', area: ['chest', 'shoulders'], goals: ['strength'], type: 'dynamic', dur: 30, img: img('male', 'dynamiccheststretch'),
    steps: ['Brazos extendidos a los lados, ábrelos hacia atrás y vuelve a cruzarlos delante del pecho.', 'Ritmo controlado, sin tirones.'] },
  { id: 'dynamictoetouch', n: 'Toca la punta del pie dinámico', area: ['hamstrings'], goals: ['strength'], type: 'dynamic', dur: 30, img: img('male', 'dynamictoetouch'),
    steps: ['De pie, baja a tocar los pies con las rodillas casi extendidas y sube de nuevo.', 'Sube con la espalda relajada, vértebra a vértebra.'] },
  { id: 'fingerstretch', n: 'Estiramiento de dedos', area: ['wrists'], goals: ['recovery'], type: 'static', dur: 20, img: img('male', 'fingerstretch'),
    steps: ['Extiende una mano y con la otra tira suavemente de cada dedo hacia atrás.', 'Repite en la otra mano.'] },
  { id: 'forearmflexorstretch', n: 'Estiramiento de flexores del antebrazo', area: ['wrists'], goals: ['recovery'], type: 'static', dur: 25, img: img('male', 'forearmflexorstretch'),
    steps: ['Brazo extendido, palma hacia arriba, tira de los dedos hacia abajo con la otra mano.', 'Mantén el codo estirado sin bloquearlo.'] },
  { id: 'kneelingbackrotationstretch', n: 'Rotación torácica arrodillado', area: ['upperback'], goals: ['mobility'], type: 'dynamic', dur: 40, img: img('female', 'kneelingbackrotationstretch'),
    steps: ['A cuatro patas, lleva una mano detrás de la cabeza y rota el codo hacia el techo.', 'Sigue el movimiento con la mirada y vuelve a cruzarlo por debajo del cuerpo.'] },
  { id: 'kneelinghamstringstretch', n: 'Estiramiento de isquios de rodillas', area: ['hamstrings'], goals: ['recovery', 'mobility'], type: 'static', dur: 30, img: img('male', 'kneelinghamstringstretch'),
    steps: ['De rodillas, adelanta una pierna con el talón en el suelo y los dedos hacia arriba.', 'Siéntate hacia atrás sobre el talón de apoyo, espalda recta.'] },
  { id: 'kneelinghipflexorstretch', n: 'Estiramiento de flexor de cadera de rodillas', area: ['hips'], goals: ['recovery', 'mobility'], type: 'static', dur: 30, img: img('female', 'kneelinghipflexorstretch'),
    steps: ['En zancada baja, la rodilla trasera en el suelo, empuja la cadera hacia delante.', 'Aprieta el glúteo trasero para profundizar el estiramiento.'] },
  { id: 'kneelinglatstretch', n: 'Estiramiento de dorsal de rodillas', area: ['upperback'], goals: ['recovery'], type: 'static', dur: 30, img: img('male', 'kneelinglatstretch'),
    steps: ['De rodillas frente a un apoyo bajo, estira los brazos hacia delante y hunde el pecho hacia el suelo.', 'Deja caer el peso hacia atrás sobre los talones.'] },
  { id: 'kneelingwristflexorstretch', n: 'Estiramiento de muñeca de rodillas', area: ['wrists'], goals: ['recovery'], type: 'static', dur: 20, img: img('female', 'kneelingwristflexorstretch'),
    steps: ['A cuatro patas, gira las manos con los dedos apuntando hacia las rodillas.', 'Balancéate suavemente hacia atrás sin levantar la palma del suelo.'] },
  { id: 'kneetocheststretch', n: 'Rodilla al pecho', area: ['lowerback', 'glutes'], goals: ['recovery'], type: 'static', dur: 30, img: img('male', 'kneetocheststretch'),
    steps: ['Tumbado boca arriba, abraza una rodilla y llévala hacia el pecho.', 'Mantén la otra pierna relajada en el suelo.'] },
  { id: 'kneetowall', n: 'Rodilla a la pared', area: ['calves', 'ankles'], goals: ['strength', 'mobility'], type: 'static', dur: 30, img: img('male', 'kneetowall'),
    steps: ['De pie frente a una pared, lleva la rodilla hacia ella sin despegar el talón.', 'Busca la distancia máxima donde el talón sigue apoyado.'] },
  { id: 'leguphamstringstretch', n: 'Estiramiento de isquios con pierna elevada', area: ['hamstrings'], goals: ['recovery', 'mobility'], type: 'static', dur: 30, img: img('male', 'leguphamstringstretch'),
    steps: ['Tumbado, eleva una pierna estirada sujetándola con las manos o una banda.', 'Mantén la pierna de apoyo relajada en el suelo.'] },
  { id: 'levatorscapulaestretch', n: 'Estiramiento del elevador de la escápula', area: ['neck'], goals: ['recovery'], type: 'static', dur: 25, img: img('male', 'levatorscapulaestretch'),
    steps: ['Gira la cabeza 45° hacia un lado y baja la barbilla hacia la axila.', 'Ayuda suavemente con la mano del mismo lado, sin tirar fuerte.'] },
  { id: 'lungetohamstringrock', n: 'De zancada a isquios', area: ['hips', 'hamstrings'], goals: ['strength', 'mobility'], type: 'dynamic', dur: 40, img: img('female', 'lungetohamstringrock'),
    steps: ['Desde una zancada baja, endereza la pierna delantera y siéntate hacia atrás para estirar el isquio.', 'Vuelve a la zancada baja y repite el balanceo.'] },
  { id: 'openbook', n: 'Libro abierto', area: ['upperback', 'chest'], goals: ['mobility'], type: 'dynamic', dur: 40, img: img('male', 'openbook'),
    steps: ['Tumbado de lado con las rodillas dobladas, abre el brazo de arriba como abriendo un libro.', 'Sigue la mano con la mirada y vuelve a cerrar despacio.'] },
  { id: 'overheadtricepsstretch', n: 'Estiramiento de tríceps por encima de la cabeza', area: ['shoulders'], goals: ['recovery'], type: 'static', dur: 25, img: img('male', 'overheadtricepsstretch'),
    steps: ['Lleva un brazo por detrás de la cabeza con el codo apuntando hacia arriba.', 'Con la otra mano, presiona suavemente el codo hacia abajo.'] },
  { id: 'pigeonstretch', n: 'Paloma', area: ['glutes', 'hips'], goals: ['recovery', 'mobility'], type: 'static', dur: 45, img: img('male', 'pigeonstretch'),
    steps: ['Pierna delantera doblada frente a ti, la trasera extendida hacia atrás.', 'Inclina el torso hacia delante manteniendo la cadera cuadrada.'],
    caution: 'Si la rodilla delantera molesta, abre menos el ángulo.' },
  { id: 'prayerstretch', n: 'Estiramiento de oración', area: ['wrists'], goals: ['recovery'], type: 'static', dur: 20, img: img('female', 'prayerstretch'),
    steps: ['Junta las palmas frente al pecho, dedos hacia arriba.', 'Baja las manos poco a poco manteniéndolas juntas hasta notar el estiramiento.'] },
  { id: 'puppypose', n: 'Postura del cachorro', area: ['shoulders', 'upperback'], goals: ['recovery', 'mobility'], type: 'static', dur: 30, img: img('female', 'puppypose'),
    steps: ['De rodillas, camina con las manos hacia delante dejando la cadera sobre las rodillas.', 'Hunde el pecho hacia el suelo con los brazos bien estirados.'] },
  { id: 'rockingfrog', n: 'Rana con balanceo', area: ['hips'], goals: ['mobility'], type: 'dynamic', dur: 40, img: img('male', 'rockingfrog'),
    steps: ['A cuatro patas, abre bien las rodillas y balancea la cadera hacia atrás y adelante.', 'Mantén los pies en línea con las rodillas durante todo el balanceo.'] },
  { id: 'seatedfigurefour', n: 'Cuatro sentado', area: ['glutes'], goals: ['recovery', 'mobility'], type: 'static', dur: 30, img: img('male', 'seatedfigurefour'),
    steps: ['Sentado, cruza un tobillo sobre la rodilla contraria.', 'Inclina el torso hacia delante manteniendo la espalda recta.'] },
  { id: 'seatedhamstringstretch', n: 'Estiramiento de isquios sentado', area: ['hamstrings'], goals: ['recovery', 'mobility'], type: 'static', dur: 30, img: img('female', 'seatedhamstringstretch'),
    steps: ['Sentado con las piernas extendidas, inclina el torso hacia delante desde la cadera.', 'Mantén la espalda larga en vez de redondearla entera.'] },
  { id: 'seatednecknods', n: 'Asentir sentado', area: ['neck'], goals: ['recovery'], type: 'dynamic', dur: 20, img: img('male', 'seatednecknods'),
    steps: ['Sentado con la espalda recta, asiente lentamente con la cabeza arriba y abajo.', 'Movimiento pequeño y controlado, sin forzar el final del rango.'] },
  { id: 'seatednecksidebends', n: 'Flexión lateral de cuello sentado', area: ['neck'], goals: ['recovery'], type: 'static', dur: 20, img: img('male', 'seatednecksidebends'),
    steps: ['Sentado, inclina la oreja hacia un hombro sin levantar el hombro contrario.', 'Ayuda suavemente con la mano si lo necesitas.'] },
  { id: 'seatedrhomboidstretch', n: 'Estiramiento de romboides sentado', area: ['upperback'], goals: ['recovery'], type: 'static', dur: 25, img: img('male', 'seatedrhomboidstretch'),
    steps: ['Sentado, entrelaza las manos y estira los brazos hacia delante redondeando la espalda alta.', 'Empuja como si alejaras las manos de ti.'] },
  { id: 'seatedstraddle', n: 'Piernas abiertas sentado', area: ['hamstrings', 'hips'], goals: ['recovery', 'mobility'], type: 'static', dur: 40, img: img('male', 'seatedstraddle'),
    steps: ['Sentado con las piernas bien abiertas y extendidas, inclina el torso hacia delante.', 'Reparte el peso entre ambos isquiones.'] },
  { id: 'shoulderpassthrough', n: 'Paso de hombros con palo/banda', area: ['shoulders', 'chest'], goals: ['strength', 'mobility'], type: 'dynamic', dur: 30, img: img('male', 'shoulderpassthrough'),
    steps: ['Sujeta un palo o banda con ambas manos, brazos extendidos delante.', 'Pasa el palo por encima de la cabeza hasta la espalda y vuelve, sin doblar los codos.'],
    caution: 'Empieza con un agarre bien ancho y ciérralo solo si el hombro lo permite.' },
  { id: 'sidelyingcheststretch', n: 'Estiramiento de pecho tumbado de lado', area: ['chest'], goals: ['recovery'], type: 'static', dur: 30, img: img('male', 'sidelyingcheststretch'),
    steps: ['Tumbado de lado, apoya la palma detrás de ti en el suelo.', 'Rota el torso hacia el lado contrario alejándolo de la mano de apoyo.'] },
  { id: 'sidetosidetoetouch', n: 'Toca la punta del pie lateral', area: ['hamstrings', 'core'], goals: ['strength'], type: 'dynamic', dur: 30, img: img('male', 'sidetosidetoetouch'),
    steps: ['De pie con las piernas separadas, alterna tocando cada pie manteniendo las piernas casi extendidas.', 'Deja que la cadera se desplace hacia el lado que tocas.'] },
  { id: 'squattingachillesstretch', n: 'Estiramiento de aquiles en sentadilla', area: ['calves'], goals: ['recovery', 'mobility'], type: 'static', dur: 30, img: img('male', 'squattingachillesstretch'),
    steps: ['En sentadilla profunda, lleva el peso hacia un talón manteniéndolo en el suelo.', 'Mantén el pecho erguido durante el estiramiento.'] },
  { id: 'squattostand', n: 'De sentadilla a de pie', area: ['hamstrings', 'hips'], goals: ['strength', 'mobility'], type: 'dynamic', dur: 30, img: img('male', 'squattostand'),
    steps: ['Desde pie, baja a sujetarte los tobillos con las piernas casi extendidas.', 'Empuja la cadera hacia arriba y adelante hasta quedar de pie, luego repite.'] },
  { id: 'standingcalfstretch', n: 'Estiramiento de gemelo de pie', area: ['calves'], goals: ['recovery'], type: 'static', dur: 30, img: img('male', 'standingcalfstretch'),
    steps: ['Da un paso atrás con una pierna, talón en el suelo y rodilla extendida.', 'Inclina el cuerpo hacia la pared o apoyo manteniendo el talón trasero abajo.'] },
  { id: 'standingforwardfold', n: 'Flexión de pie hacia delante', area: ['hamstrings', 'lowerback'], goals: ['recovery', 'mobility'], type: 'static', dur: 30, img: img('male', 'standingforwardfold'),
    steps: ['De pie, dobla las rodillas ligeramente y deja caer el torso hacia delante.', 'Deja que la cabeza y los brazos cuelguen relajados.'] },
  { id: 'standinghamstringstretch', n: 'Estiramiento de isquios de pie', area: ['hamstrings'], goals: ['recovery'], type: 'static', dur: 30, img: img('male', 'standinghamstringstretch'),
    steps: ['Apoya un talón adelantado sobre un step o escalón, rodilla extendida.', 'Inclina el torso hacia delante desde la cadera, espalda recta.'] },
  { id: 'standinghipflexorstretch', n: 'Estiramiento de flexor de cadera de pie', area: ['hips'], goals: ['recovery', 'mobility'], type: 'static', dur: 30, img: img('male', 'standinghipflexorstretch'),
    steps: ['En zancada larga, empuja la cadera hacia delante manteniendo el torso vertical.', 'Aprieta el glúteo de la pierna trasera.'] },
  { id: 'standingoverheadreach', n: 'Alcance por encima de la cabeza de pie', area: ['fullbody'], goals: ['recovery'], type: 'static', dur: 20, img: img('female', 'standingoverheadreach'),
    steps: ['De pie, entrelaza las manos y estira los brazos por encima de la cabeza.', 'Alárgate hacia arriba y ligeramente hacia un lado, luego el otro.'] },
  { id: 'standingquadstretch', n: 'Estiramiento de cuádriceps de pie', area: ['quads'], goals: ['recovery', 'mobility'], type: 'static', dur: 30, img: img('female', 'standingquadstretch'),
    steps: ['De pie, sujeta un tobillo por detrás y acerca el talón al glúteo.', 'Mantén las rodillas juntas y la cadera empujada ligeramente hacia delante.'],
    caution: 'Apóyate en algo si necesitas equilibrio.' },
  { id: 'supinespinaltwist', n: 'Torsión espinal tumbado', area: ['lowerback', 'core'], goals: ['recovery', 'mobility'], type: 'static', dur: 30, img: img('male', 'supinespinaltwist'),
    steps: ['Tumbado boca arriba, lleva ambas rodillas dobladas hacia un lado.', 'Mantén los hombros pegados al suelo mientras las rodillas caen hacia el lado.'] },
  { id: 'threadtheneedle', n: 'Enhebrar la aguja', area: ['upperback', 'shoulders'], goals: ['mobility'], type: 'dynamic', dur: 40, img: img('female', 'threadtheneedle'),
    steps: ['A cuatro patas, pasa un brazo por debajo del cuerpo hasta apoyar el hombro y la mejilla en el suelo.', 'Vuelve al punto de partida y repite alternando de lado.'] },
  { id: 'uppertrapstretch', n: 'Estiramiento de trapecio superior', area: ['neck'], goals: ['recovery'], type: 'static', dur: 25, img: img('male', 'uppertrapstretch'),
    steps: ['Sentado, sujeta el borde del asiento con una mano.', 'Inclina la cabeza hacia el lado contrario, ayudando suavemente con la otra mano.'] },
  { id: 'wallcheststretch', n: 'Estiramiento de pecho en pared', area: ['chest'], goals: ['recovery'], type: 'static', dur: 30, img: img('male', 'wallcheststretch'),
    steps: ['Apoya el antebrazo en una pared, codo a la altura del hombro.', 'Gira el cuerpo alejándolo de la pared hasta notar el estiramiento.'] },
  { id: 'worldgreateststretch', n: 'El mejor estiramiento del mundo', area: ['fullbody'], goals: ['strength', 'mobility'], type: 'dynamic', dur: 40, img: img('male', 'worldgreateststretch'),
    steps: ['Desde una zancada larga, apoya ambas manos dentro del pie delantero.', 'Rota el torso llevando un brazo hacia el techo, luego vuelve y repite del otro lado.'],
    caution: 'Combina cadera, isquios, torácica y hombro en un único movimiento — ve despacio la primera vez.' },
  { id: 'wristcircles', n: 'Círculos de muñeca', area: ['wrists'], goals: ['recovery'], type: 'dynamic', dur: 20, img: img('female', 'wristcircles'),
    steps: ['Entrelaza los dedos y traza círculos suaves con ambas muñecas.', 'Cambia de sentido a mitad del tiempo.'] },
  { id: 'wristextensorstretch', n: 'Estiramiento de extensores de muñeca', area: ['wrists'], goals: ['recovery'], type: 'static', dur: 20, img: img('female', 'wristextensorstretch'),
    steps: ['Brazo extendido, palma hacia abajo, tira de los dedos hacia ti con la otra mano.', 'Mantén el codo estirado sin bloquearlo.'] }
]

export const STRETCH_IDX = new Map(STRETCHES.map(s => [s.id, s]))
export const stretchOr = id => STRETCH_IDX.get(id) || { id, n: id, area: [], goals: [], type: 'static', dur: 30, img: null, steps: [] }

// Auto-generate a session from the wizard's answers — a handful of stretches that fit the
// chosen goal, biased toward the level (a beginner gets fewer, gentler holds; advanced gets a
// fuller session), covering distinct areas rather than piling onto the same one twice.
export function autoSession(goal, level) {
  const pool = STRETCHES.filter(s => s.goals.includes(goal))
  const n = level === 'new' ? 5 : level === 'adv' ? 8 : 6
  const seen = new Set()
  const picked = []
  // First pass: one per area, in the pool's own order (already a reasonable head-to-toe flow).
  for (const s of pool) {
    if (picked.length >= n) break
    const area = s.area[0]
    if (area && seen.has(area)) continue
    seen.add(area)
    picked.push(s)
  }
  // Still short (a goal with fewer distinct areas than n)? top up from the rest of the pool.
  for (const s of pool) {
    if (picked.length >= n) break
    if (!picked.includes(s)) picked.push(s)
  }
  return picked.map(s => s.id)
}
