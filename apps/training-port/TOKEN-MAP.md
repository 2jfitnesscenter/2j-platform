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
| `#7bd34a`, `#10B981` (acento verde de Búnker) | Acento de marca | `--2j-color-brand` (lima) | Verde de Búnker -> lima de Platform (A77-2) |
| `#04130D` (texto sobre acento verde) | Texto sobre marca | `--2j-color-text-on-brand` | |
| `#1f9d55`, `--green` (estado bueno) | Éxito | `--2j-color-success` | |
| `#d97706`, `#D69E2E`, `#ff9f0a`, `--orange`, `--yellow` | Aviso | `--2j-color-warning` | |
| `#ff453a`, `#EF4444`, `--red` | Peligro | `--2j-color-danger` | |
| `#0a84ff`, `--blue` | Información | `--2j-color-info` | |

Pantallas hechas: `v3-training.css` (post-entreno y héroe de Inicio); `intelligence-today.css`, `train2j-program-home.css`, `composition-goals.css`, `news.css`, `guided-programs.css`, `training-quality-panel.css`, `studio.css` (tanda 5).
Pendiente de decisión por sección: colores de sección de Búnker sin token de Platform (`#d4af37` oro, `#d9b5ff` púrpura, etc.). Pendiente de pantalla: el resto de ficheros.

Pendiente: los 3 ficheros que usan `forwardRef` o APIs de React 19 se revisan antes de compilar con React 18. Lo demás se valida con typecheck y capturas.
