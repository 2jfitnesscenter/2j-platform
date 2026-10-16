# 2J DESIGN SYSTEM V2

Tokens, componentes, estados y reglas de interacción. Parte de [`packages/design-tokens/tokens.json`](../../packages/design-tokens/tokens.json) y del contrato de estados de [`docs/design-system/foundation.md`](../design-system/foundation.md). Dirección y personalidad: [`2J-DESIGN-DIRECTION-V2.md`](2J-DESIGN-DIRECTION-V2.md).

**Estado:** propuesta. Los valores marcados `[PROPUESTA]` requieren **aceptación visual del propietario** antes de aplicarse. Esta fase no modifica `tokens.json`, `tokens.css` ni ninguna hoja de estilos.

## 0. Cómo se relaciona con lo que ya existe

| Elemento existente | Qué hace V2 |
|---|---|
| `tokens.json` (`--2j-*`, claro + oscuro, contraste testeado) | **Se conserva como fuente única.** V2 lista qué valores cambian y qué tokens se añaden. No se crea una segunda paleta. |
| `foundation.md` (contratos de componentes, accesibilidad, movimiento) | **Se conserva como contrato de estados.** V2 lo refina (alturas, radios, jerarquía de botones) y añade lo que falta. |
| `@2j/ui` (solo README: «componentes se implementan en una TASK acotada») | V2 define el contrato visual de esos componentes; **ningún componente se implementa en esta fase**. |
| Verde de marca `#73b52e` / `#578923` | **Se conserva.** |
| Neutros con tinte verde, barra lateral `#172015` | `[PROPUESTA]` neutralizar a grafito (ver §2). |
| Tema `.hub-theme` del Member (esmeralda `#10B981`) | `[PROPUESTA]` retirar y migrar a tokens. Requiere confirmar el verde de marca. |

Nomenclatura: se mantienen los nombres `--2j-*` actuales. Los tokens nuevos siguen la misma convención.

## 1. Principios del sistema

1. **Tokens o nada.** Ni hex, ni px de color/radio/sombra fuera de tokens. Los espacios y tamaños usan la escala.
2. **Semántico antes que literal.** Los componentes usan `--2j-color-text-primary`, no un gris.
3. **Una escala, pocos valores.** Siete tamaños de texto, nueve espaciados, cinco radios, tres sombras.
4. **Tema como override de tokens**, nunca como hoja de estilos paralela.
5. **Estados completos:** default · hover · focus-visible · active · selected · disabled · loading · error.
6. **Accesible por construcción:** foco visible, contraste verificado, objetivos táctiles, `prefers-reduced-motion`.

## 2. Color

### 2.1 Neutros — de «verde apagado» a grafito `[PROPUESTA]`

| Token | Actual (claro) | Propuesto (claro) | Uso |
|---|---|---|---|
| `--2j-color-canvas` | `#f5f7f2` | `#F6F7F6` | Fondo de página (gris muy claro) |
| `--2j-color-surface` | `#ffffff` | `#FFFFFF` | Cards, modales, inputs |
| `--2j-color-surface-subtle` | `#edf1e8` | `#EEF0EE` | Hover de fila, fondo de grupo, chips neutros |
| `--2j-color-border` | `#d6ddcf` | `#E3E6E3` | Borde fino de card y separadores |
| `--2j-color-border-strong` | `#aeb9a4` | `#CDD2CD` | Hover de borde, separadores fuertes |
| `--2j-color-border-input` *(nuevo)* | — | `#868E86` | Borde de inputs/selects/checkbox (≥ 3:1) |
| `--2j-color-text-primary` | `#172015` | `#16181A` | Texto y títulos (grafito) |
| `--2j-color-text-secondary` | `#52604e` | `#566057` | Texto secundario, ayudas, captions |
| `--2j-color-sidebar` | `#172015` | `#17191B` | Barra lateral profesional |
| `--2j-color-sidebar-text` | `#f2f5ee` | `#F2F4F2` | |
| `--2j-color-sidebar-muted` | `#c1cbb9` | `#B5BDB5` | |
| `--2j-color-sidebar-active` | `#2a3625` | `#25292D` | Elemento activo/hover |

**Contrastes comprobados** (WCAG 2.x, calculados):

| Par | Ratio | Resultado |
|---|---|---|
| texto principal `#16181A` sobre canvas / blanco | 16,58 / 17,80 | AAA |
| texto secundario `#566057` sobre blanco / canvas / subtle | 6,55 / 6,10 / 5,72 | AA |
| texto de barra `#F2F4F2` sobre `#17191B` / muted `#B5BDB5` | 15,95 / 9,16 | AAA |
| borde de input `#868E86` sobre blanco | 3,37 | ≥ 3:1 (WCAG 1.4.11) |

Se **elimina el tercer nivel de gris de texto**: no hay «terciario». Placeholder y ayudas usan `text-secondary` (un `#6E776F` sobre canvas queda en 4,32:1 y no cumple 4,5:1).

El borde fino de card (`#E3E6E3`, 1,26:1) es **decorativo**: ninguna información depende de él. Los controles de entrada usan `border-input`.

### 2.2 Verde 2J — acción, selección, éxito de marca

| Token | Valor | Uso | Contraste |
|---|---|---|---|
| `--2j-color-brand` | `#73b52e` *(existente)* | Fondo del botón primario, indicador activo, relleno de selección | sobre grafito 7,10:1 |
| `--2j-color-text-on-brand` | `#14210d` *(existente)* | Texto/icono **sobre** el verde | 6,69:1 |
| `--2j-color-brand-hover` *(nuevo)* | `#66A128` | Hover del primario (texto sigue oscuro) | 5,34:1 con `text-on-brand` |
| `--2j-color-brand-ink` *(nuevo)* | `#3F6A1A` | **Texto verde** sobre fondos claros (enlaces de marca, números positivos de marca) | 6,39:1 sobre blanco |
| `--2j-color-brand-soft` *(nuevo)* | `#EAF4DD` | Fondo de selección, chip «seleccionado», día actual | `brand-ink` sobre `brand-soft`: 5,62:1 |
| `--2j-color-brand-strong` | `#578923` *(existente)* | **Solo** relleno gráfico/borde (nunca texto pequeño) | blanco sobre él: 4,19:1 ✗ |

**Reglas del verde:**
- **Texto blanco nunca va sobre `brand`** (2,51:1) **ni sobre `brand-strong` en tamaño pequeño** (4,19:1). Hoy el hover del botón primario cambia a `brand-strong` con texto blanco: **incumple AA** (Visual Debt VD-A1).
- El verde significa acción primaria, selección, éxito y marca concreta. No se usa en fondos de página, bordes decorativos ni iconos sin función.
- Texto verde sobre claro = `brand-ink`, no `brand-strong`.
- *DESIGN DECISION FOR JUANJO:* confirmar `#73b52e` como verde de marca único (el Member usa hoy `#10B981`).

### 2.3 Colores semánticos (estado) — chip y texto

Cada estado tiene **tres tokens**: relleno suave (`-soft`), tinta de texto/icono (`-ink`) y color de acento (`-solid`, para barras, puntos, bordes). Los `-solid` existentes (`success #26734a`, `warning #865900`, `danger #a83232`, `info #285f91`) se conservan; se añaden `-soft` e `-ink` `[PROPUESTA]`:

| Estado | `-soft` (fondo) | `-ink` (texto/icono) | Ratio texto/fondo |
|---|---|---|---|
| success | `#E3F3EA` | `#1F6B43` | 5,64 |
| warning | `#FFF1CF` | `#7A5200` | 6,17 |
| danger | `#FDE7E5` | `#A12D2D` | 6,06 |
| info | `#E3EFFA` | `#1F5A8C` | 6,21 |
| neutral | `#EEF0EE` | `#4A524B` | 7,05 |

Todo chip incluye **texto o icono además del color**.

### 2.4 Color de servicio `[PROPUESTA]`

**Color = servicio, constante en toda la app** (Agenda, Clientes, Member). Ocho ranuras `--2j-service-{1..8}-accent` (barra/punto, ≥ 3:1 sobre blanco) y `--2j-service-{n}-tint` (relleno suave de tarjeta). El texto de la tarjeta sigue siendo grafito. Tonos orientativos: azul, violeta, turquesa, arena, rosa, índigo, pizarra, cian. **Regla: ningún color de servicio es rojo, ámbar ni verde**, para no confundirse con estados. Hex definitivos al implementar `design-tokens`, con test de contraste. Hoy hay 5 colores (`data-service-color` 0–4) por hash del servicio; V2 pasa a 8 con asignación explícita.

### 2.5 Tema oscuro

`[PROPUESTA]` El tema oscuro **es un override de los mismos tokens** (`[data-theme="dark"]`), no otro sistema. Se conservan los valores oscuros actuales pero neutralizados. En V2.0: Pro solo claro; Member claro/oscuro/sistema sobre tokens. Ver Direction §10.

## 3. Tipografía

Familia: `Inter` con pila del sistema (existente). Sin carga externa. `[PROPUESTA]` auto-alojar Inter variable (licencia OFL) para render coherente entre sistemas (hoy cae a Segoe UI/SF según el dispositivo).

**Siete tamaños** (existente: 12/14/16/18/22/28; V2: 12/14/16/18/24/32/40):

| Rol | Token | Pro (px/línea) | Member (px/línea) | Peso | Tracking | Uso |
|---|---|---|---|---|---|---|
| **Display** | `type-size-display` | 32/40 | 40/44 | 700 | −0,02em | Cifra héroe, saludo, nombre en Cliente 360 |
| **Page title** | `type-size-title` *(nuevo)* | 24/32 | 28/34 | 700 | −0,015em | Título de página |
| **Section title** | `type-size-section` *(nuevo)* | 18/26 | 20/28 | 600 | −0,01em | Título de sección |
| **Card title** | `type-size-card` *(nuevo, = 16)* | 16/24 | 16/24 | 600 | 0 | Título de card, nombre en lista |
| **Body** | `type-size-md/sm` | 14/22 | 16/24 | 400/500 | 0 | Texto base |
| **Secondary** | `type-size-sm` + `text-secondary` | 14/20 | 14/20 | 400 | 0 | Ayudas, metadatos |
| **Caption** | `type-size-xs` | 12/16 | 12/16 | 400/500 | 0 | Fechas cortas, contadores |
| **Label** | `type-size-sm` | 14/20 | 14/20 | 500 | 0 | Etiqueta de campo |

- **Mínimo 12 px.** Se eliminan 9, 10, 11, 13, 15, 17, 19, 20, 21, 23, 25 y 29 px (hoy usados).
- Pesos: **400, 500, 600, 700** (existentes). Nada de 650 ni 800.
- Cifras con `font-variant-numeric: tabular-nums` en ocupación, importes y saldos.
- *Overline/eyebrow* (12 px, 600, mayúsculas, +0,06em): **máximo uno por pantalla** y solo si aporta contexto (hoy se repite en cada título).
- Longitud de línea de lectura ≤ 72 caracteres.

## 4. Espaciado

Escala existente `--2j-space-*`: **4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48** (+ 64 para separaciones de página). Se prohíben valores intermedios (hoy: 3, 5, 6, 7, 9, 10, 11, 13, 14 px en `gap` y 151 combinaciones de `padding`).

| Semántico | Pro | Member |
|---|---|---|
| `--2j-layout-page-x` | 32 (≥1280) · 24 (768–1279) · 16 (<768) | 20 |
| `--2j-layout-section-gap` | 32 | 24 |
| `--2j-layout-card-gap` | 16 | 12 |
| `--2j-card-padding` | 20 (24 en cards grandes) | 16 (20 en cards héroe) |
| `--2j-field-gap` | 16 entre campos · 4 label→control · 4 control→ayuda | igual |
| `--2j-inline-gap` | 8 (12 entre grupos de acciones) | 8 |

## 5. Radios `[PROPUESTA]`

Cinco valores, mapeados por rol. Se mantienen los nombres de los tokens existentes y se **reasignan los valores** (cambio global y deliberado; los componentes que ya usan `var(--2j-radius-*)` lo heredan):

| Token | Actual | Propuesto | Rol |
|---|---|---|---|
| `--2j-radius-xs` *(nuevo)* | — | 6 | Tooltips, tags pequeños |
| `--2j-radius-sm` | 6 | **10** | Inputs, selects, textarea |
| `--2j-radius-md` | 10 | **12** | Botones estándar, cards pequeñas, filas de lista, items de menú |
| `--2j-radius-lg` | 14 | **16** | Cards grandes, paneles, imágenes de producto |
| `--2j-radius-xl` | 18 | **20** | Modales, drawers, bottom sheets |
| `--2j-radius-pill` | 999 | 999 | Chips, botones pill, avatares |

Cards pequeñas: 12–14 → se fija **12**. Botones: 12. Esquema validado contra la propuesta inicial (cards 16, inputs 10–12, botones 12–14, modales 18–20).
Avatares circulares: `border-radius: 50%` solo para imagen de persona. Hoy hay **17 radios distintos** en el Member y 10 en el Admin (ver Visual Debt).

## 6. Bordes y sombras

- **Card normal:** `1px solid var(--2j-color-border)` + fondo `surface` **sin sombra**. Hoy `.panel` lleva borde **y** `elevation-low`.
- **Hover de card interactiva:** borde pasa a `border-strong`; sin elevación.
- **Seleccionado:** borde `brand` 1,5–2 px + fondo `brand-soft` (no solo color: añade check o icono).
- **Foco:** anillo de 2 px `focus` con *offset* de 2 px (hoy 3 px; se admite cualquiera ≥ 2 px).
- **Sombras** solo para elementos flotantes, con color neutro (`rgb(22 24 26)`; hoy verdoso):

| Token | Valor propuesto | Uso |
|---|---|---|
| `--2j-elevation-low` | `0 1px 2px rgb(22 24 26 / 6%)` | Elemento «pegado» elevado (cabecera fija) |
| `--2j-elevation-medium` | `0 8px 24px rgb(22 24 26 / 10%)` | Menú, popover, dropdown |
| `--2j-elevation-high` | `0 20px 48px rgb(22 24 26 / 16%)` | Modal, drawer |

## 7. Tamaños: controles, iconos, contenido, breakpoints, z-index

### 7.1 Altura de control
| Token | Valor | Uso |
|---|---|---|
| `--2j-control-sm` | 36 | Acciones densas de tabla **solo con puntero fino**; con `pointer: coarse` sube a 44 |
| `--2j-control-md` | **44** | Estándar (botón, input, select, chip filtro). Objetivo táctil mínimo |
| `--2j-control-lg` | 52 | Acción primaria del Member |

Hoy: 68 alturas mínimas distintas en el Admin; controles de 36, 40, 42, 44, 46 y 48 px.

### 7.2 Iconos
Una librería, trazo constante: `[PROPUESTA]` **Lucide** (licencia ISC), entregada como componente `Icon` de `@2j/ui` con SVG vendorizados (sin dependencia en tiempo de ejecución). Tamaños **16** (en línea), **20** (por defecto), **24** (navegación y vacíos); trazo 1,75 px; `currentColor`. Sin glifos Unicode como iconos (hoy la navegación usa `⌂ ▦ ◉ ♙ ✉ € ◇ ▣` y un único SVG).

### 7.3 Ancho de contenido
| Token | Valor | Uso |
|---|---|---|
| `--2j-content-max` | 1280 | Contenido Pro (hoy hasta 1700) |
| `--2j-content-reading` | 720 | Texto largo, notas |
| `--2j-content-form` | 560 | Formularios a una columna |
| `--2j-content-member` | 640 | Columna del Member (existente) |
| Modal | 480 · 640 · 880 | Confirmación · formulario · detalle ancho |
| Drawer | 480 · 560 | Detalle compacto · detalle operativo |

### 7.4 Breakpoints (mobile-first, `min-width`)
Hoy: 370, 430, 560, 640, 680, 700, 720, 768, 900, 960, 1120 y 1121.

| Token | Valor | Cambia |
|---|---|---|
| `--2j-bp-sm` | 480 | Móvil grande |
| `--2j-bp-md` | 768 | Tablet |
| `--2j-bp-lg` | 1024 | Desktop compacto (barra lateral en carril) |
| `--2j-bp-xl` | 1280 | Desktop (barra lateral expandida) |

### 7.5 Z-index
`base 0` · `sticky 10` · `dropdown/popover 30` · `drawer 40` · `modal 50` · `toast 60` · `tooltip 70`. (Hoy: 1, 2, 3, 4, 5, 7, 9, 10, 12, 20, 30, 50.)

## 8. Movimiento

Duraciones existentes: `fast 120ms`, `normal 180ms`, `slow 260ms`; easing `cubic-bezier(0.2,0.8,0.2,1)`.

| Uso | Duración | Efecto |
|---|---|---|
| Hover, foco, cambio de estado | 120 | Color, borde |
| Acordeón, tabs, chip | 180 | Altura/opacidad |
| Modal, drawer, bottom sheet | 180–260 | Opacidad + traslación ≤ 16 px |
| Skeleton | 1,2 s | Brillo lento, bucle |
| Toast | 180 entrada / 120 salida | |

**Prohibido:** animaciones decorativas largas, rebotes, parallax, contadores que animan cifras. Con `prefers-reduced-motion: reduce`: sin traslación ni escala; cambios de estado instantáneos o con fundido ≤ 80 ms; skeleton estático. El feedback no depende del movimiento.

## 9. Botones

Una **acción primaria fuerte por zona/pantalla**. El resto, de menor peso.

| Variante | Aspecto | Cuándo |
|---|---|---|
| **Primary** | Fondo `brand`, texto `text-on-brand`, hover `brand-hover` | La acción principal de la zona (máx. 1) |
| **Secondary** | Fondo `surface`, borde `border-strong`, texto `text-primary` | Acción importante no principal |
| **Tertiary** | Sin fondo ni borde, texto `brand-ink`, subrayado al hover | Enlaces de acción en línea («Ver todo») |
| **Ghost** | Sin borde, fondo `surface-subtle` al hover, texto `text-primary` | Acciones de barra y menús |
| **Danger** | Borde y texto `danger-ink` (relleno `danger-solid` **solo en el botón final del modal de confirmación**) | Destructivo |
| **Icon** | 44 × 44 (36 denso), `aria-label` obligatorio | Cerrar, más, filtros |
| **Pill** | Radio pill; filtros, segmentos, chips accionables | Filtros y selección |
| **Menu button** | Botón + chevron que abre un menú | «Nuevo ▾», «Más ▾» ordenado por tema |

- Altura `control-md` (44); `control-lg` (52) para el CTA del Member.
- **No hay *split button*** en V2: las acciones alternativas van en un menú. (Se reevaluará si aparece un caso real.)
- Estados: hover, foco, `active` (sin traslación en Pro), `disabled` (opacidad + `aria-disabled`, nunca solo opacidad), `loading` (spinner + texto estable, ancho constante).
- Un menú «Más» nunca mezcla acciones de distinto riesgo: las **destructivas van separadas al final**, en rojo y con confirmación.
- **Permission-aware:** una acción sin permiso **no se pinta**; si es informativa se muestra deshabilitada con motivo accesible. Nunca un CTA imposible.

## 10. Formularios y campos

Cada campo: **label visible · valor · ayuda (cuando haga falta) · error contextual.** El placeholder **no sustituye** al label.

| Campo | Notas |
|---|---|
| Text input | Altura 44, radio `sm`, borde `border-input`, foco con anillo |
| Select | Select nativo estilizado; en móvil el nativo del sistema |
| Combobox | Búsqueda con lista (`role="combobox"`, `aria-expanded`, navegación con flechas); resultados con texto secundario |
| Date / Time / Date-time | Entrada con teclado + selector; formato `es-ES`; **hora de Canarias** indicada si el dispositivo difiere |
| Textarea | Mín. 3 líneas; contador solo si hay límite |
| Checkbox / Radio | Área de 44 px; etiqueta clicable |
| Switch | Para ajustes que se aplican; etiqueta + descripción; estado con texto («Activado»), no solo posición |
| Segmented | 2–4 opciones excluyentes de longitud corta (Día/Semana) |
| Search | Icono + `type="search"` + limpiar; atajo `Ctrl/⌘K` para búsqueda global |
| Uploader | Ver §10.3 |

### 10.1 Reglas de formulario
1. **Una columna** (`content-form` 560 px). Dos columnas solo para pares cortos (fecha + hora, nombre + apellidos).
2. **Marca de opcionales:** los obligatorios son la norma; se marca **«(opcional)»** en los que no lo son, en lugar de asteriscos por todas partes.
3. **Validación:** al salir del campo y al enviar; en formularios largos, resumen de errores arriba con enlaces. El error **sustituye** a la ayuda y explica causa + salida.
4. **Texto de ayuda** bajo el campo, en lenguaje natural, con el valor por defecto («Por defecto usa el ajuste del servicio»). Reglas con **título + descripción + (predeterminado)**.
5. **Un flujo normal enseña solo los campos normales** y termina con «Más opciones».
6. **Barra de guardado** en editores largos: «Cambios sin guardar» / «Guardado», con Guardar (primary) y Descartar (ghost). Sin cambios inmediatos silenciosos.
7. Acción destructiva dentro del formulario: separada, nunca junto a «Guardar».

### 10.2 `AdvancedOptions` («Más opciones»)
Región plegable al final del formulario, cerrada por defecto; el resumen muestra cuántos valores no predeterminados hay («Recurrencia: semanal · 2 ajustes»). Ejemplo — **Nueva sesión**: Servicio · Profesional · Fecha · Hora · Duración · Aforo; **Más opciones:** recurrencia, notas, ubicación, restricciones, visibilidad, configuración avanzada.

### 10.3 Uploader de imágenes
Explica **antes** del error: proporción recomendada, formatos, tamaño máximo, resolución mínima/recomendada (principio de Trainin). Para producto: cuadrada 1:1, JPG/PNG/WebP, ≤ 8 MB, recomendada 1600 × 1600, mínima 800 × 800 (alineado con 2J-098D). Zona de arrastre + botón «Elegir archivo»; vista previa; progreso; error con causa («El archivo pesa 12 MB; el máximo es 8 MB»); la primera imagen es la principal. Los requisitos reales los impone el servidor.

## 11. Cards

Una sola **base `Card`** con variantes; no se crea una card nueva por página. Superficie `surface`, borde fino, radio `lg` (16) o `md` (12), padding `card-padding`, sin sombra. Variantes y su uso en [`2J-UI-PATTERNS.md`](2J-UI-PATTERNS.md):

| Variante | Resumen |
|---|---|
| `MetricCard` | Cifra grande + etiqueta + (tendencia opcional); enlaza a la lista filtrada |
| `ActionCard` | Título + descripción + una acción |
| `StatusCard` | Estado derivado con explicación («Activo: tiene un plan vigente») |
| `SessionCard` | Mínima: hora · servicio · ocupación · profesional si aporta |
| `ClientCard` | Avatar · nombre · chip de estado · plan · sesiones · atención |
| `ProductCard` | Imagen · nombre · precio · estado de stock |
| `PlanCard` | Nombre · tipo · precio · frecuencia · vigencia |
| `AttentionCard` | Icono · motivo · objeto · acción |
| `EmptyStateCard` | Mensaje + CTA (si hay permiso) |
| `InfoCard` | Aviso informativo/éxito/advertencia con icono |

Interactiva = toda la card es objetivo (enlace/botón) con foco visible y, si tiene acciones internas, no anida controles interactivos.

## 12. Chips y estados

Chips **compactos** (altura 24, radio pill, 12 px, peso 500, icono 16 opcional) para estados. **No se convierte cada estado en una card.**

| Significado | Tokens | Estados de dominio (propuesta de asignación) |
|---|---|---|
| **success** | `success-soft`/`-ink` | ACTIVO · PAGADO · COMPLETADO · CONFIRMADO |
| **warning** | `warning-soft`/`-ink` | PENDIENTE · DOCUMENTO PENDIENTE · POCAS UNIDADES · POR VENCER |
| **danger** | `danger-soft`/`-ink` | VENCIDO · BLOQUEADO · SIN PROFESIONAL · AGOTADO |
| **info** | `info-soft`/`-ink` | EN COLA · LLENO · PLANIFICADO · EN CURSO |
| **neutral** | `neutral-soft`/`-ink` | INACTIVO · CANCELADO · ARCHIVADO · BORRADOR |

Criterio: el color expresa **urgencia, no valor**. `danger` = hay que actuar ya; `warning` = atención pronto; `success` = sano; `info` = información; `neutral` = sin acción. `BLOQUEADO` (por pago) es `danger`, **no** `neutral`; `CANCELADO` es `neutral` con icono y tachado opcional (distinguible de `VENCIDO`).

## 13. Navegación profesional

Shell aprobado: **Resumen · Actividad · Clientes · Mi gimnasio · Equipo · Negocio**. Admin y Trainer comparten shell; el Trainer ve solo lo que su permiso permite (el servidor decide).

| Aspecto | Especificación `[PROPUESTA]` |
|---|---|
| Barra lateral | Grafito (`sidebar`), **264 px** expandida (≥1280), **72 px** en carril (1024–1279 o plegada), oculta con *drawer* (<1024) |
| Marca | «2J» + «Fitness Center»; en carril solo el sello |
| Elemento | Altura 44, radio `md`, icono 20 + etiqueta 14/500 |
| Hover | Fondo `sidebar-active` |
| Activo | Fondo `sidebar-active` + **barra/punto verde** a la izquierda + texto blanco (no solo color) |
| Grupos | «Actividad», «Mi gimnasio», «Negocio» con sus subelementos indentados bajo una línea fina; abren con la ruta activa |
| Carril | Tooltip con la etiqueta; un grupo abre un *flyout* |
| Pie | Bloque de usuario: **avatar · nombre · rol (chip)** y menú (perfil, salir). Hueco reservado para **selector de centro** (oculto mientras haya un único centro) |
| Búsqueda | Campo global arriba del contenido (`Ctrl/⌘K`) |
| Foco | Anillo visible sobre fondo oscuro (contraste ≥ 3:1) |
| Móvil/tablet vertical | Barra superior con menú + inferior de 4 destinos (Resumen · Agenda · Clientes · Más) |

Hoy existen **dos sistemas de barra** (`.sidebar/.nav-item` y `.app-sidebar/.app-nav-item`), con alturas 48 y 44; V2 conserva el segundo.

## 14. Navegación Member

Barra inferior de **cinco** (aprobada, ya implementada): **Inicio · Búnker · Tienda · Perfil · Ajustes**. «Reservar» y «Mis reservas» son flujos dentro de Inicio. Altura 64 + safe-area; icono 24 + etiqueta 12; activo con indicador verde y texto `text-primary`; objetivo ≥ 44 px. Cabecera ligera con avatar, campana de avisos y marca.

## 15. Tablas

Usar **tabla** solo cuando hay comparación, administración, muchos registros o columnas realmente necesarias. **No** para Cliente 360, Tienda Member ni Resumen (cards/secciones).

- Cabecera fija; fila 56 (cómoda) o 44 (densa, puntero fino); sin cebrado; hover `surface-subtle`; seleccionada `brand-soft`.
- Alineación: texto a la izquierda, cifras a la derecha con `tabular-nums`.
- Ordenar con `aria-sort`; la columna principal (nombre) no se oculta.
- **Prioridad de columnas:** al reducir ancho se ocultan primero las secundarias (se mueven al detalle); **por debajo de 768 px la tabla se convierte en lista de cards** (no scroll horizontal por defecto).
- Acciones por fila: una primaria visible + menú «⋯» (con `aria-label`).
- Paginación o «Cargar más» (con recuento); selección múltiple con barra de acciones masivas contextual.
- Estados: cargando (skeleton de filas), vacío (EmptyState), error (ErrorPanel con reintento).

## 16. Modales, drawers, popovers, tooltips, toasts

| Componente | Cuándo | Reglas |
|---|---|---|
| **Modal** | Decisión corta o formulario breve | Radio `xl`, ancho 480/640/880, título visible, `aria-modal`, foco atrapado y devuelto, Escape salvo cambios sin guardar, scrim 40 %; en móvil pasa a *bottom sheet* |
| **ConfirmationModal** | Acción destructiva o de impacto | Enumera **los efectos** («Se cancelarán 6 reservas; se restaurará 1 sesión por reserva»); botón destructivo final en rojo; botón por defecto = cancelar |
| **Drawer (DetailDrawer)** | Detalle sin perder el contexto (sesión, cliente rápido) | Derecha, 480/560, deep-linkable; en <1024 pasa a página completa |
| **Popover / menú** | Opciones, filtros, detalle breve | `elevation-medium`, se cierra con Escape/clic fuera |
| **Tooltip** | Aclarar un icono o una métrica | Solo texto breve; no esencial; accesible por foco; 70 de z-index |
| **Toast** | Confirmación no bloqueante | Anunciado (`role="status"`), ≤ 6 s, sin robar foco; **los errores persisten** hasta entenderse |

Un solo componente de modal (hoy hay 11 variantes de diálogo).

## 17. Estados vacío, error y carga

**Vacío** (siempre explica): qué falta + qué puede hacer.
- Con permiso: «Aún no hay productos» + **[Crear producto]**.
- Sin permiso: «Aún no hay productos.» **sin CTA imposible**.
- Vacío «bueno» (Acción requerida): «Todo al día. Nada requiere tu atención.»

**Error:** causa + salida. Inline en campo; `ErrorPanel` con reintento para fallos de carga; nunca una pantalla en blanco; no exponer claves técnicas ni stack traces. Distinguir sin conexión / sin permiso / no encontrado / fallo del servidor.

**Carga:** *skeleton* con la geometría final (no spinner centrado en listas y cards); spinner solo para acciones breves. Los skeleton no se hacen pasar por contenido accionable. «Actualizado hace X» en agregados.

## 18. Responsive (resumen; detalle por pantalla en los blueprints)

| Rango | Pro (Admin/Trainer) | Member |
|---|---|---|
| **≥ 1280** | Barra expandida, contenido 1280, rejilla de 12 columnas, Agenda Semana | Columna 640 centrada (escritorio) |
| **1024–1279** | Barra en **carril**, rejilla de 12 | igual |
| **768–1023 (tablet)** | Barra en *drawer*; **Agenda Día por defecto** (Semana disponible si el contenedor lo permite); detalle de sesión **a página completa**; tablas → lista de cards; filtros en popover | Columna 640; barra inferior |
| **< 768 (móvil Pro)** | Operaciones básicas: Resumen, Agenda Día, Clientes (lista), Detalle de sesión, Asistencia, Cliente (resumen). Barra inferior de 4 destinos. Sin edición de plantillas ni tablas anchas | **Mobile-first**: cards grandes, CTA 52 px, barra inferior de 5 |

Qué cambia por tamaño, no solo «se apila»: **tabla → lista de cards**, **drawer → página**, **modal → bottom sheet**, **filtros en línea → popover «Filtros (n)»**, **MetricStrip 4 columnas → 2×2**, **barra lateral → carril → drawer**, **Agenda Semana → Día**. La Agenda decide Día/Semana por **ancho del contenedor** (no por el viewport), de modo que con barra expandida no se aprieten tarjetas.

## 19. Accesibilidad

Objetivo: **WCAG 2.2 AA razonable.**
- Contraste: texto ≥ 4,5:1 (grande ≥ 3:1); controles y bordes de input ≥ 3:1; el test de tokens cubre cada par permitido en ambos temas.
- **No depender solo del color:** chips con texto/icono; seleccionado con check/borde; error con icono + texto; relleno de aforo acompañado de «6 / 10».
- **Foco visible** en todo, anillo ≥ 2 px, no tapado por cabeceras fijas.
- **Teclado:** todo operable; tabs con flechas; menús con flechas/Escape; atajos documentados; foco atrapado y devuelto en modal/drawer.
- **Etiquetas:** cada control con label; iconos con `aria-label`; imágenes con `alt` (productos: texto alternativo editable).
- **Táctil:** objetivos ≥ 44 × 44 CSS px en móvil/tablet; separación ≥ 8 px.
- **Movimiento:** `prefers-reduced-motion` respetado (ver §8).
- **Lenguaje:** `lang="es"`, mensajes de error asociados al campo (`aria-describedby`), live regions para toasts y estados de carga.
- **Zoom/reflujo:** usable a 200 % y a 320 px de ancho sin pérdida de funcionalidad.
- Verificar antes de aceptar cualquier pantalla: teclado, lector de pantalla básico, 1440 / 768 / 390, claro y (Member) oscuro.

## 20. Qué cambia de `foundation.md`

| Punto | `foundation.md` (2J-005) | V2 |
|---|---|---|
| Superficies | «jerarquía de superficie y espacio antes que borde o sombra» | **Se mantiene**; se concreta: card = borde fino, sin sombra |
| Radios | sm 6 / md 10 / lg 14 / xl 18 | 6 / 10 / 12 / 16 / 20 (reasignación) |
| Neutros | tinte verde | grafito neutro |
| Botón | primary, secondary, quiet, danger | primary, secondary, tertiary, ghost, danger, icon, pill, menu button |
| Altura táctil | ≥ 44 | ≥ 44 (`control-md`) |
| Densidad | «3–5 bloques en el dashboard» | Se mantiene (MetricStrip + atención + próximas + actividad) |
| Tipografía | 6 tamaños | 7 tamaños (añade title y hero) |
| Tema | claro + oscuro, sin elegir por defecto | Base clara; oscuro como override; Pro solo claro en V2.0 |
| Nuevo | — | `border-input`, `brand-ink/-soft/-hover`, `-soft/-ink` semánticos, service colors, control/content/breakpoint/z-index/icon |

Tras la aceptación visual, el cambio en `tokens.json` y la regeneración de `tokens.css` son una TASK propia con test de contraste (el CI rechaza salida obsoleta).
