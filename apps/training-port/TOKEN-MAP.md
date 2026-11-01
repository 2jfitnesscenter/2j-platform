# Mapeo de tokens: Búnker -> Platform (A85)

Regla: se conserva la jerarquía (fondo, superficie, texto, acento, estado), no el tono. Colores de Platform (grafito y lima #A4D65E). Estructura y experiencia idénticas al Búnker actual.

| Variable de Búnker | Token de Platform | Nota |
|---|---|---|
| `--bg`, `--bg-el` | `--2j-color-canvas` | Fondo de página |
| `--surface`, `--surface-2`, `--surface-3` | `--2j-color-surface`, `--2j-color-surface-raised`, `--2j-color-surface-subtle` | Escala de superficies |
| `--label`, `--label-2`, `--label-3`, `--label-4` | `--2j-color-text-primary`, `--2j-color-text-secondary` | Texto por jerarquía |
| `--sep`, `--sep-op` | `--2j-color-border` | Separadores |
| `--acc` | `--2j-color-brand` | Acento principal (verde de Búnker -> lima) |
| `--acc-soft` | `--2j-color-brand-soft` | Fondo suave del acento |
| `--acc-2` | `--2j-color-brand-strong` | Acento secundario |
| `--on-acc` | `--2j-color-brand-ink` | Texto sobre el acento |
| `--v2-glass-bg`, `--v2-glass-line`, `--v2-glass-blur` | `--2j-color-glass-fill`, `--2j-color-glass-edge`, `--2j-color-glass-blur` | Cristal líquido |
| `--v2-card`, `--v2-card-line` | `--2j-color-surface-raised`, `--2j-color-border` | Tarjetas |
| `--v2-gold*`, `--purple`, `--blue`, `--teal`, `--orange`, `--yellow`, `--pink`, `--indigo`, `--brown`, `--grey` | `--2j-color-service1`..`service5` (según sección) | Colores por sección de Búnker, mapeados a los servicios de Platform; si no hay equivalente, `--2j-color-info` |
| `--red` | `--2j-color-danger` | Peligro |
| `--icon-stroke` | Se conserva | Trazo de iconos (A85: iconos idénticos) |
| `--v2-fast`, `--v2-ease`, `--fast`, `--ease` | `--2j-motion-fast`, `--2j-motion-easing` | Movimiento |

## Colores fijos (paso 1 de la hoja de ruta)

| Valor fijo en CSS | Rol | Token de Platform | Nota |
|---|---|---|---|
| `#fff` como texto sobre superficie oscura | Texto sobre héroe oscuro | `--2j-color-sidebar-text` | Oscuro en ambos temas; `--2j-color-text-primary` cambiaría a oscuro en claro |
| `#08090a` (fondo del héroe) | Superficie oscura | `--2j-color-sidebar` | |
| `rgba(255,255,255,a)` (texto, bordes, fondos) | Veladura clara sobre oscuro | `color-mix(in srgb, var(--2j-color-sidebar-text) a%, transparent)` | Conserva el alfa exacto del original |

| `rgba(0,0,0,a)` (sombras) | Sombra neutra | `color-mix(in srgb, var(--2j-color-sidebar) a%, transparent)` | Grafito de Platform en ambos temas; el alfa se conserva |
| `#fff` como superficie (fondo de medio) | Superficie | `--2j-color-surface` | Cambia con el tema |
| `#7bd34a` (acento verde de noticias) | Acento de marca | `--2j-color-brand` (lima) | Verde lima de Búnker -> lima de Platform (A77-2) |
| `#10B981` (esmeralda) | Pendiente | Sin token; ver pendientes | Tanda 5 lo mapeó a lima en `studio.css` (`--st-em`); queda por decidir (ver pendientes) |
| `#04130D` (texto sobre acento verde) | Texto sobre marca | `--2j-color-text-on-brand` | |
| `#1f9d55`, `--green` (estado bueno) | Éxito | `--2j-color-success` | |
| `#d97706`, `#D69E2E`, `#ff9f0a`, `--orange`, `--yellow` | Aviso | `--2j-color-warning` | |
| `#ff453a`, `#EF4444`, `--red` | Peligro | `--2j-color-danger` | |
| `#0a84ff`, `--blue` | Información | `--2j-color-info` | |

Pantallas hechas: `v3-training.css` (post-entreno y héroe de Inicio); `intelligence-today.css`, `train2j-program-home.css`, `composition-goals.css`, `news.css`, `guided-programs.css`, `training-quality-panel.css`, `studio.css` (tanda 5).
Tanda 6a (`layout-editor.css`, `actions-sheet.css`, `v2-screens.css`): superficies y textos oscuros a tokens de sidebar; `#9FB0AA` a `--2j-color-sidebar-muted`.

### Pendientes (sin token de Platform; no se sustituyen)

- **Oro de sección:** `#D9B45B`, `#d9b45b`, `#d4af37`, `rgba(217,180,91,a)`, tinta dorada `#231a02`.
- **Esmeralda de sección:** `#10B981`, `#34D399`, `#2fd18b`, `rgba(16,185,129,a)`, `rgba(52,211,153,a)`. Pendiente de decisión: si el esmeralda de Búnker debe pasar a lima (como en `studio.css`) o conservarse como color de sección.
- **Texto oscuro sobre verde:** `#04140E`, `rgba(4,20,14,a)`.
- **Púrpura de sección:** `#d9b5ff`.
- **Oro de sección (tanda 6):** `#e8bb4c`, `#f3cf74`, `#f6d68a`, `#f0c866`, `#f2c04b`, `#f6db93`, `#ebd9a8`, `#e5c877`, `#d9c890`, `#a97c10`, `#b8902f`, `rgba(232,187,76,a)`, `rgba(242,192,75,a)`, `rgba(200,140,30,a)`.
- **Esmeralda de sección (tanda 6):** `#2fd18b`, `#2fbf8f`, `#0f8f5c`, `#6fe3b0`, `#7ef0bf`, `#4fe0a3`, `#a7f0d2`, `#bff2db`, `#c9f7e3`, `rgba(47,209,139,a)`, `rgba(16,185,129,a)`, `rgba(52,211,153,a)`, `rgba(15,143,92,a)`.
- **Texto y fondo oscuro de sección (tanda 6):** `#241a04`, `#1a1405`, `#211b10`, `#17130b`, `#0f0d08`, `#04130d`.
- **Gris medio sin rol claro:** `rgba(127,127,127,.4)` (usado en `v3-progress.css`).

Tanda 6 (`v3-library.css`, `v2-social.css`, `v2.css`, `v3-progress.css`, `views/opposition.css`, `views/premium.css`): cristal claro (`#fff 84%`) a `--2j-color-surface`; `#ff9f0a`, `#ff453a`, `#0a84ff` y sus variables de Búnker a `warning`, `danger`, `info`; `#f87171`, `#fca5a5` a `danger`; `#7dd3fc`, `#bde8fd` a `info`; `rgba(248,113,113,a)` y `rgba(125,211,252,a)` con alfa a `danger` e `info`.

Pendiente de pantalla: `index.css` (582 colores), no tocado por decisión de alcance.

Pendiente: los 3 ficheros que usan `forwardRef` o APIs de React 19 se revisan antes de compilar con React 18. Lo demás se valida con typecheck y capturas.
