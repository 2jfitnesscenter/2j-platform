# 2J VISUAL DEBT

Lista de **deuda visual medida** en `2j-platform` (`main @ 12437b6`) y el informe **CURRENT → TARGET** por pantalla. Es la base para priorizar la adopción del Design System V2 en una fase posterior. No se ha cambiado ninguna pantalla.

Relacionados: [`2J-DESIGN-DIRECTION-V2.md`](2J-DESIGN-DIRECTION-V2.md) · [`2J-DESIGN-SYSTEM-V2.md`](2J-DESIGN-SYSTEM-V2.md) · [`2J-COMPONENT-INVENTORY.md`](2J-COMPONENT-INVENTORY.md) · [`2J-SCREEN-BLUEPRINTS.md`](2J-SCREEN-BLUEPRINTS.md).

**Método y límites.** Análisis estático (expresiones regulares sobre `apps/*/src/styles.css`), lectura del código TSX y cálculo de contrastes WCAG con la fórmula estándar. Los recuentos son **aproximados** (no resuelven la cascada ni el CSS efectivo en pantalla). No se ha hecho revisión visual en navegador en esta fase. Donde algo exige comprobación en pantalla, se marca *(verificar)*.

---

## 1. Medidas por aplicación

| Métrica | `admin-web` | `client-app` (Member) | `staff-app` |
|---|---|---|---|
| Tamaño de `styles.css` | 121 KB (~1225 reglas) | 55 KB (~500) | 17 KB (~137) |
| Clases CSS distintas | **418** | n/d | n/d |
| Usos de `var(--2j-*)` | **842** | 257 | 131 |
| Literales hexadecimales | **1** (`#C05252`) | **271 (95 distintos)** | 0 |
| Tamaños de fuente distintos | **25** | **22** | 16 |
| Usos de fuente < 12 px (9–11 px) | 28 | 29 | 14 |
| Radios distintos | 10 (incl. `2px`, `50%`) | **17** (10, 12, 13, 14, 17, 18, 22, 24, 99, 999 px, `50%`…) | 8 |
| `box-shadow` (usos / distintos) | 10 / 6 | **18 / 13** | 1 / 1 |
| `min-height` distintos | **68** | 32 | 15 |
| `padding` distintos | **151** | 48 | 27 |
| `gap` distintos | 28 | 19 | 13 |
| Breakpoints distintos | 12 (370–1121 px) | 4 | 2 |
| Valores de `z-index` distintos | 11 | 5 | 1 |
| `<img>` en la UI | 0 | 0 | — |
| SVG en línea | 3 | 2 | — |

**Lectura:** el Admin y el Staff están **sobre tokens** (casi sin hex), pero con una escala de tipografía, alturas y espaciados mucho más amplia que la declarada. El Member está **fuera del sistema de tokens en color** y con más variación de radios y sombras.

---

## 2. Lista de deuda visual

Severidad: **Alta** (afecta accesibilidad, identidad o cohesión global) · **Media** (inconsistencia visible) · **Baja** (limpieza). *Fase* = momento de resolverla en la adopción (ver Component Inventory §5).

### A. Accesibilidad y contraste

| ID | Deuda | Evidencia | Sev. | Fase |
|---|---|---|---|---|
| VD-A1 | **El hover del botón primario usa texto blanco sobre `brand-strong`** (4,19:1; AA exige 4,5:1) | `.button.primary:hover { background: brand-strong; color: surface }` | Alta | Tokens/Button |
| VD-A2 | **Texto pequeño en `brand-strong` sobre blanco** (4,19:1): los *eyebrows* («MI GIMNASIO · …», «CENTRO DE OPERACIONES») usan ese color a 11–12 px en mayúsculas | `.eyebrow { color: brand-strong }`; `foundation.md` ya dice que `brandStrong` no es superficie de texto | Alta | Tokens |
| VD-A3 | **Bordes de control con poco contraste**: `border-strong` actual `#AEB9A4` sobre blanco = 2,04:1 (WCAG 1.4.11 pide 3:1 para identificar el control); `border` `#D6DDCF` = 1,39:1 | Cálculo | Media | Tokens (`border-input`) |
| VD-A4 | **Esmeralda `#10B981` sobre blanco = 2,54:1** en el tema del Member *(verificar dónde se usa como texto/gráfico sobre claro)* | `.hub-theme` y variante `[data-2j-appearance="light"]` | Alta | Member |
| VD-A5 | **Texto de 9–11 px** (71 usos en las tres apps) | Recuento | Media | Tipografía |
| VD-A6 | Estados solo por color o forma ambigua *(verificar por pantalla)*: bordes de color (cancelada), puntos de estado sin texto | `.status-dot`, `.session-card.cancelled` | Media | StatusChip |

### B. Identidad y color

| ID | Deuda | Evidencia | Sev. | Fase |
|---|---|---|---|---|
| VD-B1 | **Dos verdes de marca**: `#73b52e` (tokens, Admin/Staff) y `#10B981` (Member `.hub-theme`) | `tokens.json` vs `client-app/styles.css` líneas ~190–209 | **Alta** | Decisión DD-01 |
| VD-B2 | **Segundo sistema visual en el Member**: `.hub-theme` (107 apariciones), paleta oscura propia, 271 hex | `client-app/styles.css` | **Alta** | Member |
| VD-B3 | **Neutros con tinte verde** (`#f5f7f2`, `#edf1e8`, `#d6ddcf`, `#172015`) frente a la identidad blanco/gris/grafito + verde acento | `tokens.json` | Media | DD-02 |
| VD-B4 | Barra lateral verde oscuro (`#172015`) en lugar de grafito | `--2j-color-sidebar` | Media | DD-07 |
| VD-B5 | **Color de servicio por hash a 5 tonos** (`data-service-color` 0–4): colisiones probables al crecer el catálogo | `serviceColorIndex` en `calendar-page.tsx` | Media | Agenda |
| VD-B6 | Hex literal `#C05252` en el Admin fuera de tokens | `admin-web/styles.css` | Baja | Tokens |

### C. Tipografía

| ID | Deuda | Evidencia | Sev. | Fase |
|---|---|---|---|---|
| VD-C1 | **25 tamaños de fuente en el Admin** (13 px ×86, 12 px ×81, 14 ×49, 11 ×21, 18, 16, 17, 20…) frente a la escala declarada de 6 | Recuento | Alta | Tipografía |
| VD-C2 | **Títulos con tamaños distintos por pantalla** (`clamp(27px,4vw,38px)`, `clamp(30px,3vw,40px)`, `clamp(17px,1.8vw,22px)`…) | `font-size` de títulos en `admin-web/styles.css` | Media | PageHeader |
| VD-C3 | **Inter no se distribuye**: la pila empieza por `Inter` pero cae a Segoe UI / SF según el dispositivo | `--2j-type-font-family` | Media | DD-05 |
| VD-C4 | *Eyebrows* en mayúsculas repetidos en casi todos los títulos | `.eyebrow` | Baja | PageHeader |
| VD-C5 | **El nombre técnico de la zona horaria se enseña al usuario** («HOY · ATLANTIC/CANARY», «AGENDA · ATLANTIC/CANARY») | `command-center.tsx`, `calendar-page.tsx` | Baja | Copy |

### D. Forma, borde, sombra

| ID | Deuda | Evidencia | Sev. | Fase |
|---|---|---|---|---|
| VD-D1 | **Radios sin sistema**: 17 distintos en el Member, 10 en el Admin | Recuento | Alta | Tokens (DD-03) |
| VD-D2 | **Botón con radio distinto**: Admin 10 px; Member pill | `.button` en cada hoja | Media | Button |
| VD-D3 | **Card con borde *y* sombra** (`.panel`: borde + `elevation-low`), contrario a «borde fino sin sombra» | `.panel` | Media | Card |
| VD-D4 | **Sombras decorativas** en el Member (13 distintas; anillos concéntricos en `.welcome::after`) | `client-app/styles.css` | Media | Member |
| VD-D5 | Sombras de elevación **teñidas de verde** (`rgb(16 24 12 / …)`) | `tokens.json` | Baja | Tokens |

### E. Tamaños y espaciado

| ID | Deuda | Evidencia | Sev. | Fase |
|---|---|---|---|---|
| VD-E1 | **68 alturas mínimas distintas** en el Admin; controles de 36, 40, 42, 44, 46 y 48 px | Recuento | Alta | Control sizes |
| VD-E2 | **151 combinaciones de `padding`**; `gap` de 3, 5, 6, 7, 9, 10, 11, 13, 14 px fuera de la escala de 4/8/12/16… | Recuento | Media | Spacing |
| VD-E3 | **Doce breakpoints** distintos + un `matchMedia(max-width:1120px)` duplicado en JS | `@media` varios; `calendar-page.tsx` | Media | Breakpoints |
| VD-E4 | `z-index` de 1 a 50 sin escala (11 valores) | Recuento | Baja | Z-index |
| VD-E5 | **Ancho de contenido hasta 1700 px** (`.main { max-width:1700px }`) | `admin-web/styles.css` | Baja | Layout |

### F. Componentes duplicados

| ID | Deuda | Evidencia | Sev. | Fase |
|---|---|---|---|---|
| VD-F1 | **11 variantes de diálogo** (`dialog`, `plan-dialog`, `plan-assignment-dialog`, `plan-action-dialog`, `archive-dialog`, `calendar-dialog`, `session-dialog`, `staff-dialog`, `confirmation-dialog`, `schedule-dialog`, `global-search-dialog`) | Clases CSS | Alta | Modal |
| VD-F2 | **≥ 10 variantes de panel** y ≥ 7 cards de dominio con CSS propio | Clases CSS | Alta | Card |
| VD-F3 | **≥ 10 formas de chip de estado** (`badge`, `local-pill`, `source-pill`, `service-chip`, `status-dot`, `summary-state`, `detail-state`, `module-state`, `status-published`, `status-withdrawn`, `calendar-state`) sin mapa común de color | Clases CSS | Alta | StatusChip |
| VD-F4 | **4 implementaciones de pestañas/segmentos** | `client-tabs`, `staff-tabs`, `gym-view-tabs`, `calendar-view-switch` | Media | Tabs |
| VD-F5 | **8 estados vacíos y 7 estados de error** con estilos propios | Clases CSS | Media | EmptyState |
| VD-F6 | **Dos sistemas de barra lateral** (`.sidebar/.nav-item` y `.app-sidebar/.app-nav-item`) con alturas 48 y 44 | `styles.css` | Media | Shell |
| VD-F7 | **4 filas de tienda** con rejillas propias | `store-*-row` | Baja | DataTable |
| VD-F8 | **Dos UIs de profesional**: el shell `admin-web` y la app `staff-app` (móvil), con componentes y CSS independientes | `apps/*` | Media | DD-08 |
| VD-F9 | **Sin capa de componentes**: `@2j/ui` no se importa en ninguna app; las páginas son funciones de 1–4 componentes | Búsqueda de imports | Alta | `@2j/ui` |

### G. Iconografía

| ID | Deuda | Evidencia | Sev. | Fase |
|---|---|---|---|---|
| VD-G1 | **Glifos Unicode como iconos de navegación** (`⌂ ▦ ◉ ♙ ✉ € ◇ ▣`) y solo 5 SVG en línea en las tres apps | `navGlyph` | Alta | Icon (DD-04) |
| VD-G2 | Iconos de otros estilos (flechas `↗`, `‹ ›`, `⋯`) como texto | `command-center.tsx`, `calendar-page.tsx` | Baja | Icon |

### H. Patrones ausentes

| ID | Deuda | Sev. |
|---|---|---|
| VD-H1 | No hay **skeletons** (solo spinner y «Cargando…») | Media |
| VD-H2 | No hay **toast** compartido, ni **barra de guardado**, ni patrón **«Más opciones»** | Media |
| VD-H3 | No hay **uploader** con requisitos explicados (solo el de comprobantes) | Media |
| VD-H4 | La lista de **Clientes** no prioriza atención ni muestra plan/sesiones/próxima actividad (confirmar en pantalla) | Media |
| VD-H5 | El **Resumen** reparte la atención en varios paneles («Necesitan atención», «Pendientes», «Pulso operativo», «Pendiente de gestión») bajo una «Agenda de hoy» protagonista | Media |
| VD-H6 | **Tienda sin imágenes**: 0 `<img>` en Admin y Member | Alta (depende de 098D) |

### I. Agenda (deuda heredada de #45, ya registrada)

| ID | Deuda | Sev. |
|---|---|---|
| VD-I1 | Eje horario fijo 06:00–22:00: una sesión fuera de ese tramo se coloca en la fila límite *(deuda L1 de la revisión de #45)* | Media |
| VD-I2 | Decisión Día/Semana por viewport (1120 px) y no por contenedor | Media |
| VD-I3 | Agrupación de simultáneas por solape transitivo: las tarjetas de un grupo no reflejan su hora exacta | Baja |

---

## 3. Informe CURRENT → TARGET

Solo lo verificado en código; lo no verificado se marca *(verificar)*.

| Pantalla | CURRENT | TARGET |
|---|---|---|
| **Navegación Pro** | Barra verde oscuro con grupos; iconos Unicode; dos sistemas de CSS; sin bloque de usuario visible en la barra *(verificar)* | Barra grafito 264/72, iconos de una librería, activo con indicador verde, bloque de usuario (avatar · nombre · rol), hueco de selector de centro |
| **Resumen** | 5 paneles; la «Agenda de hoy» domina; 2 *eyebrows*; botón «Actualizar» | `MetricStrip` accionable + **Requiere atención** + Próximas sesiones + Actividad con motivo y acción; vacío explícito |
| **Agenda** | Tarjeta ya mínima tras #45; simultáneas reales con lista secundaria; filtro con `select`; detalle en modal; eje fijo | Conserva la dirección; añade relleno = aforo, «Lleno», profesional si aporta, 8 colores de servicio, línea «ahora», eje configurable, detalle en drawer con URL, filtro «Todas» que incluye canceladas |
| **Detalle de sesión** | Modal sobre la agenda | `DetailDrawer` (≥1024) / página (<1024), acción primaria que cambia con el momento, pestañas Reservas · En cola · Historial, alcance de edición en el botón |
| **Clientes (lista)** | Lista de filas con nombre y estado *(verificar columnas)* | Orden «atención primero», pestañas con contadores, columnas Estado · Plan · Sesiones · Próxima actividad · Atención · Entrenador, motivo de atención visible |
| **Cliente 360** | Pestañas por capacidad (Resumen · Cuotas · Reservas · Pagos · Documentos · Mensajes · Seguimiento · Historial); resumen con estado, nº de reservas, próxima reserva y cuota activa | Cabecera con avatar, estado derivado, «cliente desde», plan, acción primaria por permiso y **cuatro hechos clave** (sesiones, pago, próxima reserva, alertas); «Plan y derechos» con periodos; «Datos» y «Compras»; «Ver como cliente» (PP-02) |
| **Servicios** | «Espacios y servicios»: espacios, servicios y diálogos de alta | `ServiceCard` con avisos de configuración incompleta; edición en página con reglas en lenguaje natural y barra de guardado |
| **Planes** | Catálogo en tabla y diálogos de alta/asignación | `PlanCard` por tipo; tabla opcional; el modelo técnico queda oculto; vista previa en lenguaje natural |
| **Pagos** | «Pagos y caja»: cargos, nuevo cargo, registrar pago | Resumen arriba, historial debajo; estados Pendiente / Vencido / Pagado (+ Planificado si el producto lo define); consecuencia del vencimiento visible |
| **Tienda Admin** | Acciones desplegables «＋» (producto, variante, stock, venta) y filas de producto, actividad y movimientos | Catálogo de `ProductCard` con imagen, pestañas Catálogo · Inventario · Ventas, acción primaria única, página de producto con uploader |
| **Tienda Member** | Catálogo por categorías **sin imagen** | `ProductCard` grande con foto y *fallback* elegante; detalle con galería; sin checkout |
| **Member Inicio** | Hero «Hola, …», próxima reserva, «Reservar clase», noticias; fondo y verde propios del tema del hub | Hero grafito sin ornamento, tira semanal, próxima reserva con política visible, CTA 52 px, tarjeta de plan (sesiones del periodo), aviso de pago informativo |
| **Member Reservar** | Selector de servicio, calendario mensual, lista de sesiones, confirmación | Cuatro pasos explícitos con reglas visibles antes de confirmar y motivo claro cuando no se puede reservar |
| **Member Perfil** | Tus cuotas, tus compras, servicios asociados, contratos y certificados, mensajes y avisos | Cards enlazadas; plan con «Ver mis periodos»; identidad visible sin cuota |
| **Formularios** | Disposiciones por pantalla; alturas 40–48; ayudas y errores con clases distintas | `Field` único (label · valor · ayuda · error), una columna, «(opcional)», «Más opciones», barra de guardado |
| **Diálogos** | 11 variantes | `Modal`, `ConfirmationModal` (efectos listados), `DetailDrawer`, `BottomSheet` |
| **Estados** | 8 vacíos / 7 errores / spinner | `EmptyState` (causa + CTA según permiso), `ErrorPanel`, `Skeleton` |
| **Tokens** | Neutros verdes, radios 6/10/14/18, 6 tamaños de texto, dos verdes | Neutros grafito, radios 6/10/12/16/20, 7 tamaños, un verde, escalas de control/contenido/breakpoint/z-index |

---

## 4. Prioridad sugerida de saneamiento

1. **VD-A1, A2, A3** (accesibilidad de color) — se resuelven en los tokens y el botón primario; riesgo bajo y beneficio inmediato.
2. **VD-B1, B2, F9, G1** (un solo verde, tokens en el Member, capa de componentes, iconos) — requieren aceptación visual (DD-01/DD-04) y marcan el resto.
3. **VD-C1, D1, E1, E2, F1–F5** (escalas y duplicados) — se absorben al introducir `@2j/ui` pantalla a pantalla.
4. **VD-H4, H5, H6** (Clientes, Resumen, imágenes de Tienda) — son las mejoras de producto visibles de mayor impacto.
5. **VD-I1–I3** (agenda) — junto a 2J-098B.
6. El resto, como limpieza al tocar cada pantalla.

La adopción es **incremental y reversible**: cada paso es una TASK acotada, con aceptación visual del propietario, sin tocar reglas de negocio.
