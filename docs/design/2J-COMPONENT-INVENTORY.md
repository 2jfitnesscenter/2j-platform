# 2J COMPONENT INVENTORY

Auditoría de los componentes **existentes** en `2j-platform` y su destino en el Design System V2. Base del trabajo: `main @ 12437b6` (PR #45 fusionado). Solo lectura: no se ha modificado ningún fichero de aplicación.

Documentos relacionados: [`2J-DESIGN-SYSTEM-V2.md`](2J-DESIGN-SYSTEM-V2.md) · [`2J-UI-PATTERNS.md`](2J-UI-PATTERNS.md) · [`2J-VISUAL-DEBT.md`](2J-VISUAL-DEBT.md).

**Veredictos:** `KEEP` se conserva · `REFINE` se mantiene con cambios acotados · `REPLACE` se sustituye por otra solución · `DEPRECATE` se retira · `MERGE` se unifica con otros en un solo componente · `BUILD` no existe y debe crearse.

## 1. Hallazgo principal

**No existe una capa de componentes compartidos.** `[OBSERVADO]`

- `@2j/ui` contiene solo un `README` («los componentes se implementan en una TASK acotada»); **ninguna app lo importa**.
- Cada página es una función React de 1–4 componentes que escribe el marcado y las clases CSS directamente. Los tamaños (líneas de `.tsx`): `staff-app` 1297 · `client-app` 626 (un fichero) · `clients-page` 435 · `communications-page` 414 · `calendar-page` 373 · `services-page` 278.
- La coherencia depende de **clases CSS** en tres hojas independientes: `admin-web` (121 KB, ~1225 reglas, **418 clases distintas**), `client-app` (55 KB, ~500 reglas) y `staff-app` (17 KB, ~137 reglas).
- Solo hay **5 SVG en línea** en las tres apps; los iconos de navegación del Admin son glifos Unicode.

Consecuencia: el «sistema» actual es el CSS y la convención; V2 propone **componentes de `@2j/ui` que encapsulen esas clases**, no un sistema teórico ajeno al código. La migración será pantalla a pantalla, sin reescritura masiva.

## 2. Estado del sistema de tokens

| Elemento | Hallazgo `[OBSERVADO]` | Veredicto |
|---|---|---|
| `packages/design-tokens` (`tokens.json` → `tokens.css`) | Tokens `--2j-*` claros y oscuros, contraste testeado, generación sincronizada en CI | **KEEP** (fuente única) |
| Valores de neutros y radios | Neutros con tinte verde; radios 6/10/14/18 | **REFINE** (ver Design System §2 y §5) |
| Escalas ausentes | No hay tokens de altura de control, ancho de contenido, breakpoints, z-index, tamaño de icono, color de servicio ni `-soft/-ink` semánticos | **BUILD** (añadir) |
| Uso en `admin-web` | 842 usos de `var(--2j-*)` y **1 solo hex** | **KEEP** (modelo a seguir) |
| Uso en `staff-app` | 131 usos de `var(--2j-*)`, 0 hex | **KEEP** |
| Uso en `client-app` | 257 usos de `var(--2j-*)` **y 271 literales hex (95 distintos)** | **REFINE** (migrar a tokens) |
| Tema Member `.hub-theme` | Sobrescribe `brand` por `#10B981` y trae paleta oscura propia (107 apariciones) | **REPLACE** por tokens (tras decidir el verde de marca) |

## 3. Inventario por familia

### 3.1 Shell y navegación

| Componente actual | Dónde | Hallazgo | Veredicto | Destino V2 |
|---|---|---|---|---|
| `.app-sidebar`, `.app-nav-item`, `.app-nav-group`, `.app-subnav` | `admin-web` (`app-shell.tsx`) | Es la barra vigente: grupos Actividad / Mi gimnasio / Negocio; compacto; foco visible | **REFINE** | Barra grafito 264/72, activo con indicador verde, bloque de usuario con avatar+rol, hueco de selector de centro |
| `.sidebar`, `.nav-item`, `.sidebar-footer`, `.main {margin-left:250px}` | `admin-web/styles.css` (≈ líneas 178–195) | **Segundo sistema de barra** (altura 48 vs 44); su uso en TSX es residual | **DEPRECATE** (verificar que no queda referencia antes de borrar) | — |
| Glifos de navegación `⌂ ▦ ◉ ♙ ✉ € ◇ ▣` | `app-shell.tsx` (`navGlyph`) | Caracteres Unicode como iconos; 1 SVG suelto | **REPLACE** | `Icon` (Lucide vendorizado, 20 px, trazo 1,75) |
| Búsqueda global (`.global-search-dialog`, `Ctrl/⌘K`) | `app-shell.tsx` | Funciona; es un diálogo propio | **REFINE** → `CommandPalette` sobre `Modal` | `SearchBar` + resultados agrupados |
| `.bottom-nav`, `.nav-button` (5 destinos) | `client-app` | Coincide con la navegación Member aprobada | **KEEP/REFINE** | Altura 64 + safe-area, indicador verde, tokens |
| Barra inferior / pestañas de `staff-app` | `staff-app` | App móvil de profesional separada (Agenda, Clientes, Mensajes, Equipo, Fichaje, Más), ya basada en tokens | **KEEP** (ver Decisión DD-08) | Adoptar patrones V2 |

### 3.2 Botones

| Componente actual | Hallazgo | Veredicto | Destino V2 |
|---|---|---|---|
| `.button` + `.primary` / `.secondary` (Admin) | Altura 46, radio 10. **Hover primario: fondo `brand-strong` con texto blanco (4,19:1 ✗)** | **REFINE** | `Button` `primary` (hover `brand-hover`, texto oscuro), `secondary`; altura 44 |
| `.button` (Member) | Altura 48, **radio pill**, otro conjunto de reglas | **MERGE** con el Admin | Un `Button`; pill reservado a chips/filtros; CTA Member `size=lg` (52) |
| `.icon-button` | 44 × 44 | **KEEP** | `IconButton` con `aria-label` obligatorio |
| `.text-button` | Botón de texto | **REFINE** | Variante `tertiary` |
| `.today-button`, `.schedule-archive-button`, otros botones puntuales | Variaciones de una sola pantalla | **MERGE** | Variantes del `Button` |
| Botón destructivo | Estilos ad hoc (`danger-text`, `#C05252` literal) | **REFINE** | `danger` (borde/texto), relleno solo en confirmación |
| *Split button* | No existe | — | No se introduce (menú) |

### 3.3 Cards y superficies

| Componente actual | Hallazgo | Veredicto | Destino V2 |
|---|---|---|---|
| `.panel` (+ `.panel-heading`) | Borde **y** `elevation-low`; radio 14 | **REFINE** | `Card` (borde fino, sin sombra, radio 16) |
| `.summary-panel`, `.summary-compact-panel`, `.detail-panel`, `.client-detail-panel`, `.client-section-panel`, `.service-panel`, `.staff-panel`, `.clock-panel`, `.calendar-panel`, `.clients-list-panel` | **≥ 10 variantes** de panel con paddings y cabeceras propios | **MERGE** | `Card` + `SectionHeader` |
| `.service-card`, `.plan-card`, `.client-plan-card`, `.gym-area-card`, `.cash-card`, `.mobile-charge-card`, `.plan-mobile-card` | Cards específicas con CSS propio | **MERGE** → `ServiceCard`, `PlanCard`, `AreaCard`, `ChargeCard` sobre la base `Card` | |
| `.client-summary-cards` (Cliente 360) | Tarjetas de resumen | **REFINE** → `MetricCard`/`PlanSummary` | |
| `.state-panel`, `.error-panel`, `.summary-error`, `.detail-error` | Estados como paneles | **MERGE** → `EmptyState` / `ErrorPanel` | |
| `.welcome` (hero Member) + decoración circular con `box-shadow` doble | Hero con adorno | **REFINE** (conservar la idea de cabecera con personalidad, sin ornamento) | `HeroCard` Member |
| `.today-card`, `.store-category`, `.store-notice` (Member) | Cards con hex propios | **REFINE** (migrar a tokens) | `ActionCard`, `InfoCard` |

### 3.4 Chips y estados

| Componente actual | Hallazgo | Veredicto | Destino V2 |
|---|---|---|---|
| `.badge`, `.local-pill`, `.source-pill`, `.service-chip`, `.status-dot`, `.summary-state`, `.detail-state`, `.module-state`, `.status-published`, `.status-withdrawn`, `.calendar-state` | **≥ 10 formas** de mostrar un estado, con colores y formas distintos | **MERGE** | `StatusChip` (5 significados; texto/icono + color) |
| Asignación de color a estados | Sin mapa común (cada pantalla decide) | **BUILD** | Tabla de urgencia (Design System §12) |

### 3.5 Diálogos y contenedores

| Componente actual | Hallazgo | Veredicto | Destino V2 |
|---|---|---|---|
| `.dialog` + `.plan-dialog`, `.plan-assignment-dialog`, `.plan-action-dialog`, `.archive-dialog`, `.calendar-dialog`, `.session-dialog`, `.staff-dialog`, `.confirmation-dialog`, `.schedule-dialog`, `.global-search-dialog` y sus `*-backdrop` | **11 diálogos** con anchos, paddings, radios y cierre propios | **MERGE** | `Modal`, `ConfirmationModal`, `DetailDrawer`, `BottomSheet` |
| Detalle de sesión (modal en `calendar-page`) | Modal sobre la agenda | **REPLACE** | `DetailDrawer` (≥ 1024) / página (< 1024), con deep-link |
| `.calendar-overflow` + `.calendar-overflow-list` | Lista secundaria de simultáneas (decisión aprobada) | **KEEP** | `OverflowList` |
| Toasts (`.staff-toast`, avisos en línea `.calendar-notice`) | Solo en `staff-app`/algunas pantallas | **BUILD** | `Toast` |

### 3.6 Pestañas y navegación secundaria

| Componente actual | Hallazgo | Veredicto | Destino V2 |
|---|---|---|---|
| `.client-tabs`, `.staff-tabs`, `.gym-view-tabs`, `.calendar-view-switch` | **Cuatro** implementaciones de pestañas/segmentos | **MERGE** | `Tabs` (con flechas, contadores) y `SegmentedControl` |
| `.week-strip` (selector de días) | Tira de días de la agenda | **KEEP/REFINE** | `DayStrip` (Agenda y Member) |

### 3.7 Listas y tablas

| Componente actual | Hallazgo | Veredicto | Destino V2 |
|---|---|---|---|
| `.client-row` / `.client-rows`, `.desktop-list` / `.mobile-list` | Lista de clientes: nombre, estado, fecha; sin señales de atención | **REFINE** | `ClientCard`/fila con plan, sesiones, próxima actividad y atención |
| `.economics-table-wrap` + `.mobile-charge-list` | Tabla en desktop y lista en móvil (patrón correcto) | **KEEP/REFINE** | `DataTable` con transformación a cards |
| `.plan-catalog-table`, `.plan-catalog-row`, `.plan-detail-row` | Tabla de planes | **REFINE** | `DataTable` (comparación = uso correcto de tabla) |
| `.store-product-row`, `.store-variant-row`, `.store-sale-row`, `.store-movement-row` | Cuatro filas de tienda con rejillas propias | **MERGE** | `DataTable` (Admin) + `ProductCard` (catálogo) |
| `.summary-session-row`, `.summary-item-list` | Filas del Resumen | **REFINE** | `SessionRow`/`AttentionItem` |
| `.split-row`, `.template-list`, `.attendee-list`, `.inbox-list`, `.message-list` | Listas puntuales | **MERGE** donde sea posible | `List` / `ListItem` |

### 3.7 bis Agenda

| Componente actual | Hallazgo | Veredicto | Destino V2 |
|---|---|---|---|
| `.week-grid`, `.day-column`, `.calendar-time-axis`, `.overlap-group` | Rejilla de 30 min, agrupación de simultáneas por solape transitivo, eje 06:00–22:00 fijo | **REFINE** | Eje configurable, día actual suave, línea «ahora»; cuadrícula conservada |
| `.session-card` | Compacta (hora, servicio, `n/m`); radio 10; color por hash de servicio | **REFINE** | `SessionCard` (relleno = aforo, 8 colores de servicio, profesional si aporta) |
| `.calendar-toolbar`, `.calendar-view-switch`, `.calendar-filter-bar` | Barra con Día/Semana, hoy, flechas, filtro en `select` | **REFINE** | `FilterBar` + `SegmentedControl` + controles de rango |
| `.today-operational-summary` | Resumen operativo del día encima de la agenda | **REFINE** | `MetricStrip` compacta |

### 3.8 Formularios y campos

| Componente actual | Hallazgo | Veredicto | Destino V2 |
|---|---|---|---|
| `.field-*`, `.store-form`, `.calendar-form-row`, `.staff-form-grid`, `.schedule-editor-form`, `.client-picker` | Disposiciones de formulario por pantalla | **MERGE** | `Field` (label + control + ayuda + error), `FormGrid`, `Combobox` |
| Altura de input/select | Mezcla 40/42/44/46/48 | **REFINE** | `control-md` 44 |
| Ayuda y error | `.field-hint`, `.field-note`, `.field-error`, `.form-error` | **MERGE** | `Field` con `helper` / `error` |
| «Más opciones» | No existe como patrón | **BUILD** | `AdvancedOptions` |
| Uploader | Solo el de comprobantes de transferencia (sin especificación visible) | **BUILD** | `ImageUploader` |
| Barra de guardado | No existe | **BUILD** | `SaveBar` |

### 3.9 Vacíos, carga y error

| Componente actual | Hallazgo | Veredicto | Destino V2 |
|---|---|---|---|
| `.summary-empty`, `.day-empty`, `.calendar-empty`, `.template-day-empty`, `.staff-empty`, `.staff-empty-inline`, `.center-news-empty`, `.today-operational-empty` | **8 vacíos** con estilos propios | **MERGE** | `EmptyState` (explica + CTA si hay permiso) |
| `.error-panel`, `.summary-error`, `.detail-error`, `.form-error`, `.field-error`, `.staff-inline-error`, `.inline-error` | **7 formas** de error | **MERGE** | `ErrorPanel` / error en `Field` |
| `.spinner`, `.staff-loading`, mensajes «Cargando…» | Spinner centrado; sin skeleton | **REFINE** | `Skeleton` con geometría final |

### 3.10 Tipografía y estructura de página

| Componente actual | Hallazgo | Veredicto | Destino V2 |
|---|---|---|---|
| `.page-heading` + `.eyebrow` | Eyebrow uppercase brand-strong (11/12 px) en cada título; título 25–40 px según pantalla | **REFINE** | `PageHeader` (title 24; eyebrow opcional) |
| `.panel-heading`, `.detail-heading` | Cabeceras de panel de 84 px | **MERGE** | `SectionHeader` |
| Tamaños de texto | 25 valores en Admin, 22 en Member, 16 en Staff | **REFINE** | 7 tamaños (Design System §3) |

### 3.11 Client app (Member) — particularidades

| Elemento | Hallazgo | Veredicto |
|---|---|---|
| Catálogo de Tienda | Tarjetas de producto sin imagen; selector de categoría | **REFINE** → `ProductCard` con imagen y *fallback* |
| Inicio | Hero `.welcome`, `.today-card`, acceso a reservar, noticias | **REFINE** (ver Blueprint Member Inicio) |
| Flujo «Reservar» | Selector de servicio, calendario mensual, lista de sesiones | **REFINE** (4 pasos claros) |
| Calendario mensual | `aria-label="Calendario mensual de sesiones"` | **REFINE** (tira semanal + mes) |
| Estilos con hex propios | 271 literales | **REPLACE** por tokens |

## 4. Resumen de veredictos

| Veredicto | Familias |
|---|---|
| **KEEP** | `design-tokens` (fuente), `.icon-button`, `.calendar-overflow`, barra inferior Member, `economics-table-wrap/mobile list`, `staff-app` (base) |
| **REFINE** | Barra lateral vigente, `.button`, `.panel`, `.session-card`, rejilla de agenda, lista de clientes, filas del Resumen, formularios, `page-heading`, hero Member |
| **MERGE** | Paneles (≥10), cards de dominio, chips (≥10), diálogos (11), pestañas (4), vacíos (8), errores (7), filas de tienda (4), botones Member/Admin |
| **REPLACE** | Glifos de navegación, detalle de sesión en modal, tema `.hub-theme` |
| **DEPRECATE** | `.sidebar`/`.nav-item`/`.main` (barra heredada) |
| **BUILD** | `Icon`, `Toast`, `Skeleton`, `AdvancedOptions`, `SaveBar`, `ImageUploader`, `DetailDrawer`, `AttentionList`, `ActivityFeed`, `MetricStrip`, `PermissionAwareAction`, tokens de control/contenido/breakpoint/z-index |

## 5. Secuencia de adopción recomendada (para una fase posterior, tras la aceptación visual)

No se ejecuta en esta fase. Orden sugerido para minimizar riesgo:

1. **Tokens** (`design-tokens`): reasignar radios, neutros y sombras; añadir escalas nuevas; test de contraste. Efecto inmediato en Admin y Staff (ya usan `var(--2j-*)`).
2. **`@2j/ui` base:** `Icon`, `Button`, `StatusChip`, `Field`, `Card`, `EmptyState`, `Skeleton`, `Modal`.
3. **Shell profesional** (barra, cabecera, búsqueda).
4. **Resumen** y **Clientes/Cliente 360** (mayor beneficio visible).
5. **Agenda** (`SessionCard`, `DetailDrawer`, filtros) sin tocar la lógica.
6. **Servicios/Planes/Pagos**, **Tienda** (junto a 2J-098D).
7. **Member:** migrar `.hub-theme` a tokens y recomponer Inicio, Reservar y Tienda.

Cada paso es una TASK con aceptación visual del propietario, sin cambiar reglas de negocio.
