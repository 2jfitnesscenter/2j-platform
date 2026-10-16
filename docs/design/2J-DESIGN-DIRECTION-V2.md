# 2J DESIGN DIRECTION V2

Fuente de verdad **visual y de UX** de 2J Platform. La leen Claude, Codex, Gemini o cualquier agente antes de construir o modificar una pantalla.

**Estado:** propuesta para revisión del propietario. **Nada de lo que aquí se describe está aplicado.** La aceptación visual de Juanjo es obligatoria antes de que ningún agente empiece a aplicar el Design System V2.

**Alcance de esta fase:** DISCOVER · AUDIT · DEFINE. No se toca ninguna pantalla, API, regla de negocio, base de datos ni migración. No cambia ninguna regla de 2J-098; donde un patrón visual presupone una capacidad de 098 (periodos de derecho, políticas de cancelación, imágenes de Tienda), se indica con «cuando 098X esté implementado».

## Documentos de esta familia

| Documento | Contenido |
|---|---|
| `2J-DESIGN-DIRECTION-V2.md` (este) | Personalidad, referencias, principios, qué se toma y qué no |
| [`2J-DESIGN-SYSTEM-V2.md`](2J-DESIGN-SYSTEM-V2.md) | Tokens, componentes, estados, formularios, tablas, motion, responsive, accesibilidad |
| [`2J-UI-PATTERNS.md`](2J-UI-PATTERNS.md) | Patrones reutilizables (PageHeader, AttentionList, SessionCard…) |
| [`2J-COMPONENT-INVENTORY.md`](2J-COMPONENT-INVENTORY.md) | Auditoría del código actual: KEEP / REFINE / REPLACE / DEPRECATE / MERGE |
| [`2J-SCREEN-BLUEPRINTS.md`](2J-SCREEN-BLUEPRINTS.md) | 16 blueprints estructurales de pantalla |
| [`2J-VISUAL-DEBT.md`](2J-VISUAL-DEBT.md) | Deuda visual medida y plan CURRENT → TARGET |

Relación con la documentación existente: [`docs/design-system/foundation.md`](../design-system/foundation.md) (2J-005) define el contrato de tokens y de estados de componente, y `packages/design-tokens/tokens.json` es la fuente técnica de los tokens. **V2 no crea una paleta paralela**: parte de esos tokens, indica qué conserva, qué cambia y qué añade. Las secciones de `foundation.md` que V2 matiza se enumeran en el Design System V2.

## 1. Etiquetas que usan estos documentos

| Etiqueta | Significado |
|---|---|
| `[OBSERVADO]` | Visto en el código o la UI actual de `2j-platform` (hechos medidos) |
| `[REFERENCIA]` | Tomado de `2j-product-research` (comparison/PRODUCT_REFERENCE_MATRIX.md y carpetas `research/*`) |
| `[PROPUESTA DISEÑO]` | Decisión visual propuesta; requiere aceptación visual del propietario |
| `PRODUCT PROPOSAL FOR JUANJO` | Mejora que **cambia producto**, no solo diseño. **No se implementa** sin decisión explícita |

La investigación comparativa se usa **como referencia, no como copia**: no se reproduce branding, iconos propietarios, textos literales ni layouts pixel-perfect de ningún producto.

## 2. Personalidad

2J debe sentirse: **premium · limpio · moderno · fitness · profesional · sencillo · rápido de entender · poco saturado.**

Una frase: **«calma operativa con carácter de gimnasio»**. La interfaz está en silencio hasta que algo importa; entonces lo dice con claridad.

| Rasgo | Cómo se expresa | Cómo NO se expresa |
|---|---|---|
| **Premium** | Mucho aire, tipografía firme (títulos en negrita con tracking ajustado), pocas capas, superficies planas con borde fino, imagen y avatar cuidados | Degradados, sombras fuertes, ornamento |
| **Fitness** | Grafito como color de personalidad, números grandes para lo que importa (7 / 13), verde de acción vivo, fotografía de producto y de personas | Cromados, neones, iconografía de mancuernas decorativa |
| **Sencillo** | Una acción primaria por zona, formularios cortos, «Más opciones» para lo avanzado | Barras de botones del mismo peso, menús «Más ▾» cajón de sastre |
| **Profesional** | Estados con significado estable, mensajes que dicen causa y salida, densidad solo donde se opera | Aspecto ERP, aspecto software médico, plantilla genérica de SaaS |

### Lo que 2J no debe parecer
Sobrecargada · llena de tablas · decenas de botones · colores compitiendo · sombras fuertes · bordes por todas partes · widgets innecesarios · información secundaria siempre visible · ERP · software médico · plantilla genérica de SaaS.

## 3. Identidad cromática

Concepto: **blanco · gris muy claro · grafito/negro · verde 2J como acento de acción.**

- **Blanco y gris claro:** tranquilidad y legibilidad (lienzo y superficies).
- **Grafito:** personalidad fitness/premium (navegación lateral, títulos, números clave, cabeceras de Member).
- **Verde 2J:** solo para acción primaria, selección, éxito/estado positivo y elementos concretos de marca. **No se usa en todo.**

Hallazgos de la auditoría que condicionan esta identidad `[OBSERVADO]`:

1. **El verde de marca ya existe como token**: `#73b52e` (brand) y `#578923` (brand-strong), muestreados de la app cliente original (`packages/design-tokens/tokens.json`). V2 **lo conserva**.
2. **La app Member usa un segundo verde.** La clase `.hub-theme` sustituye el token por esmeralda `#10B981` y trae su propia paleta oscura (271 literales hexadecimales, 95 distintos). Hay, hoy, **dos verdes 2J**. → *DESIGN DECISION FOR JUANJO* (**DD-01**): confirmar el verde de marca (V2 propone `#73b52e`) para retirar el segundo sistema. Ver Visual Debt. El índice de decisiones de diseño (DD-01…DD-08) y de propuestas de producto (PP-01…PP-11) está en el anexo de [`2J-SCREEN-BLUEPRINTS.md`](2J-SCREEN-BLUEPRINTS.md).
3. **Los neutros actuales tienen tinte verde** (`#f5f7f2`, `#edf1e8`, bordes `#d6ddcf`, barra lateral `#172015`). La identidad pedida es blanco/gris/grafito + verde acento. V2 propone **neutros realmente neutros** (grafito sin tinte). Es un cambio visual global → requiere aceptación visual.
4. **El blanco sobre verde no pasa contraste** (2,51:1 sobre `#73b52e`; 4,19:1 sobre `#578923`). Hoy el hover del botón primario usa texto blanco sobre `brand-strong`. V2 fija: **texto oscuro sobre verde de acción** y un tono `brand-ink` para texto verde sobre fondos claros.

## 4. Referencias: qué toma 2J de cada producto

Fuente: `comparison/PRODUCT_REFERENCE_MATRIX.md` (research merge `68e6481`) y las carpetas `research/trainin/`, `research/strengthacademy/`, `research/timp/`, `research/harbiz/`. Todo `[REFERENCIA]`, adaptado, nunca copiado.

### 4.1 Trainin → limpieza y claridad (referencia principal de calma)
**Toma (principios):**
- Superficies claras con **esquinas redondeadas** y mucho aire; pocas piezas por pantalla.
- **Formularios cortos** con **ayuda bajo cada campo** y campos obligatorios marcados.
- **Reglas explicadas en lenguaje natural**: cada opción con título, descripción y valor predeterminado.
- **Estados derivados y explicados** (el estado del cliente se entiende y tiene su pantalla «cómo funciona»).
- **Avisos de configuración incompleta en la propia tarjeta** («Sin ubicación», «No hay planes vinculados»).
- **«Acción requerida» con vacío explícito** («Nada requiere tu atención»).
- Ficha de cliente **clara y poco saturada** (cuatro tarjetas de resumen, seis pestañas).
- Estados vacíos con intención (mensaje + CTA) y **uploader que explica proporción/formato/tamaño** antes del error.
- Eje horario de agenda configurable; aviso de zona horaria del negocio.
- Catálogo de notificaciones con interruptor y valor por defecto.

**No toma:** «Cancelar» y «Eliminar cliente» al alcance de un clic sin confirmación; menú «Más ▾» como cajón de sastre; cambios que se aplican inmediatamente sin resumen; borde rojo sin leyenda; idiomas mezclados; asistentes que crean al avanzar; lista de clientes sin señales de atención; inscripción automática en serie para el Member.

### 4.2 Strength Academy → presentación premium y atención priorizada
**Toma:**
- **«Atención primero»**: lista y resumen ordenados por necesidad de atención, con pestaña «Requiere atención» y contadores.
- El **cliente en el centro**: avatar y nombre con tipografía de énfasis, tarjeta con último hito, actividad y próximo evento.
- **Aterrizaje de la ficha por urgencia** (lo que requiere atención, primero).
- **Actividad con motivo y acción** («Responder» en la propia tarjeta).
- **«Vista de atleta»** → «Vista del cliente»: ver, solo lectura, lo que ve el Member.
- **Estado de guardado visible** en editores largos.
- Member **mobile-first**: columna de móvil, barra inferior, **tira semanal**, bandeja «De tu entrenador».
- Cifras importantes tratadas visualmente (7 / 13, no «sesiones restantes: 7»).

**No toma:** capas de onboarding apiladas en el inicio; marketplace/comunidad pública en el inicio del Member; nueve pestañas en la ficha; mezcla de idiomas; «requiere atención» sin criterio visible; enlace de acceso de un solo uso como login.

### 4.3 TIMP → profundidad operativa donde se opera
**Toma:**
- **Un solo canal visual para «lleno»: relleno = aforo.**
- **Color = servicio, constante** (el color nunca cambia de significado).
- **Pivote por profesional** cuando hay paralelismo, en lugar de apretar texto.
- **Mensajes que dicen causa y salida** («Falta añadir profesionales», «Estas sesiones tienen reservas…»).
- **Efectos listados antes de una acción destructiva** (consentimiento informado).
- **Alcance de una edición elegido en el botón** («Solo esta sesión» / «Esta y las siguientes»).
- Ticket de reserva trazable (reservada por / canjeada con / cancelación gratuita hasta).
- Ayuda «cómo se calcula» en cada métrica; acciones de ficha **agrupadas por tema**.

**No toma:** densidad resuelta con texto de 12 px en tarjetas de 73 px; iconos sin etiqueta para acciones críticas (✓ ✗ ⚙); permisos como lista plana; horas muertas pintadas; configurabilidad vacía (≈35 ajustes por servicio).

### 4.4 Harbiz → adherencia y comunicación
**Toma:**
- **Adherencia visible** en la fila/ficha del cliente (cumplimiento, última actividad).
- **Comunicación como parte de la ficha** (mensaje desde el cliente, no en un silo).
- Producto → onboarding (como idea, **sin autoasignar entrenamiento**).

**No toma:** la **cascada de la agenda** que tapa los títulos; cabecera de ficha sin acciones; promoción mezclada con el trabajo; permisos globales.

## 5. Qué sigue siendo únicamente 2J

- **Lógica de negocio propia**, que el diseño explica sin simplificar: identidad ≠ cuota, bolsas de sesiones por periodo, reserva manual y confirmada del Member, bloqueo por impago solo de nuevas reservas, Búnker integrado.
- **Dos audiencias con un mismo sistema**: shell profesional (Admin/Trainer, mismo shell, permisos distintos) y app Member (mobile-first).
- **Búnker** se gobierna por sus propios patrones; Platform no lo rediseña.
- **Zona horaria `Atlantic/Canary`** siempre explícita en agenda y fechas límite.
- **Estados con significado de negocio**: «bloqueado por pago» no equivale a «inactivo»; «lleno» no equivale a «cancelado».

## 6. Principios de diseño

1. **RESUMEN PRIMERO, DETALLE BAJO DEMANDA.** Una pantalla enseña (1) qué pasa, (2) qué importa, (3) qué necesita acción. Lo demás va a modal, drawer, pestaña secundaria, «Ver detalles» o «Más opciones» (progressive disclosure).
2. **Una acción primaria fuerte por zona.** El resto es secundario, terciario o fantasma.
3. **Espacio y borde fino antes que sombra.** Sombras solo para lo que flota.
4. **Un significado, un estilo.** Un color, un chip, una forma = un significado en toda la app.
5. **El estado se explica.** Cada estado derivado dice por qué y qué hacer.
6. **Nunca una caja vacía.** Vacío = qué falta + qué puede hacer el usuario (si no tiene permiso, sin CTA imposible).
7. **El permiso se ve en el diseño.** Lo que no se puede hacer no se pinta como botón activo; el servidor sigue siendo la autoridad.
8. **El frontend no decide.** La UI muestra la razón; el backend decide.
9. **La complejidad técnica queda detrás.** El staff no ve «contrato», «entitlement period», «ledger» ni «grant»: ve «Plan», «Vigencia», «Pago», «Periodo actual», «Sesiones 7 / 13».
10. **Consistencia antes que novedad.** Antes de crear un componente, se reutiliza o se refina uno existente.

## 7. Jerarquía y densidad

| Nivel | Qué muestra | Dónde |
|---|---|---|
| **N1 — Estado** | Qué está pasando ahora (cifras clave, chips) | Cabecera de pantalla / MetricStrip |
| **N2 — Atención** | Qué necesita acción | AttentionList (arriba o a la derecha, nunca enterrado) |
| **N3 — Trabajo** | Listas y tarjetas de la tarea | Cuerpo |
| **N4 — Detalle** | Todo lo demás | Drawer, modal, pestaña, «Ver detalles» |

**Densidad por contexto:**
- **Resumen, Clientes 360, Servicios, Planes, Tienda, Perfil Member:** densidad baja, tarjetas y secciones.
- **Agenda y listas operativas (Admin/Trainer desktop):** densidad media-alta *controlada*: tarjeta de sesión **mínima** (hora, servicio, ocupación, profesional si aporta); todo lo demás al abrir.
- **Móvil:** densidad baja siempre; acciones básicas.

Regla de la tarjeta de sesión: **como máximo cuatro datos** (hora, servicio, `6 / 10`, profesional). No se muestran participantes, cola, reglas, notas ni derechos en la agenda.

## 8. Tono visual y de copy

- Voz: cercana, breve, en **español de España**; verbos de acción («Asignar», «Ver cliente»).
- Sin jerga técnica en la UI profesional (ni «ledger», «grant», «entitlement»).
- Los mensajes de bloqueo o error dicen **causa + salida**: «No se puede reservar: la cuota venció el 20 oct. · Ver pago».
- Números con formato local (`es-ES`), fechas cortas con día de la semana, horas siempre en hora de Canarias.
- Mayúsculas y *eyebrows* decorativos solo si aportan; el estilo actual de «MI GIMNASIO · OPERACIÓN DEL CENTRO» sobre cada título se reduce (ver Visual Debt).

## 9. Diferencia entre Admin/Trainer y Member

| | **Admin / Trainer (shell profesional)** | **Member (app)** |
|---|---|---|
| Sensación | Panel de trabajo, tranquilo, eficiente | **App** de fitness, visual, cercana |
| Plataforma primaria | Desktop (1280+), tablet usable, móvil para operaciones básicas | **Móvil primero** (390), columna 640 en escritorio |
| Navegación | Barra lateral grafito: Resumen · Actividad · Clientes · Mi gimnasio · Equipo · Negocio | Barra inferior de 5: Inicio · Búnker · Tienda · Perfil · Ajustes |
| Superficie | Blanco/gris claro con barra lateral grafito | Tarjetas grandes, cabeceras con personalidad, imagen |
| Densidad | Media (alta solo en agenda/listas) | Baja |
| Acciones | Varias, con jerarquía | Pocas y grandes, una dominante |
| Complejidad | Se expone según permiso | **Nunca se expone la complejidad interna** |
| Tema | **Claro** (base) | Claro por defecto propuesto; oscuro disponible por token |
| Tipografía | Cuerpo 14 px | Cuerpo 16 px, cifras grandes |

Ambos comparten **un solo sistema de tokens** y los mismos patrones base; difieren en escala, densidad y composición, no en lenguaje visual.

## 10. Modo claro / oscuro

No se asume que 2J necesite modo oscuro. Propuesta:

- **El diseño base es claro** (Admin/Trainer y Member).
- Los tokens definen **un tema oscuro como extensión** (ya existe en `tokens.json`); no hay un segundo sistema visual.
- **Pro (Admin/Trainer): solo claro en V2.0.** El oscuro de Pro queda diferido; no se mantiene sin QA.
- **Member:** el ajuste de apariencia ya existe (sistema/claro/oscuro). V2 lo mantiene como selector de tema **sobre los mismos tokens**, y retira el tema `.hub-theme` independiente.
- *PRODUCT PROPOSAL FOR JUANJO:* decidir si el Member arranca en claro (propuesta) o en oscuro por defecto.

## 11. Cómo se revisa un cambio visual contra esta dirección

Checklist para agentes y revisores:

1. ¿Usa solo tokens (sin hex, sin px fuera de escala)?
2. ¿Hay **una** acción primaria por zona?
3. ¿La pantalla enseña resumen primero y mueve el detalle a drawer/modal/pestaña?
4. ¿El estado usa `StatusChip` con texto/icono además de color?
5. ¿Hay estados vacío, carga y error con causa y salida?
6. ¿Los controles táctiles miden ≥ 44 px donde hay táctil?
7. ¿Hay foco visible y navegación por teclado?
8. ¿Se ha comprobado a 1440 / 768 / 390 y con `prefers-reduced-motion`?
9. ¿El permiso se refleja sin ser la autoridad?
10. ¿Se ha pedido (y registrado) la aceptación visual del propietario?
