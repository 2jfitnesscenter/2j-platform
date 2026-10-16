# Handoff — 2J-DESIGN-V2-PILOT-01 (Professional shell + Resumen)

Primera aplicación **real y acotada** del Design System V2 ([`docs/design/`](../design/2J-DESIGN-SYSTEM-V2.md)), para que el propietario la vea en el navegador y la apruebe **antes** de extender el sistema a otras pantallas.

- Estado: Draft. `VISUAL_APPROVED=no` hasta que Juanjo abra el piloto y lo apruebe.
- No es un rediseño global. No toca Member, `staff-app`, backend, RBAC, API ni migraciones.

## Qué se implementó

| Pieza | Dónde | Notas |
|---|---|---|
| Capa de tokens V2 | `packages/design-tokens/tokens.json` (`v2`) → `src/tokens.css` | Misma fuente única. Se aplica solo bajo `[data-2j-design="v2"]`; los valores `:root` actuales (Member, `staff-app`, resto de Admin) no cambian. Un solo verde `#73b52e`. Texto oscuro sobre el verde de acción; texto verde = `brand-ink`. Test de contraste de todos los pares V2. |
| Inter autoalojada | `packages/design-tokens/fonts/` (+ licencia OFL) | `Inter Variable`, solo latin y latin-ext. Sin CDN. El nombre de familia distinto evita que otras pantallas cambien de fuente. |
| Lucide | `@2j/ui` (`icons`, `Icon`) | Única superficie de iconos. 16/20/24, trazo 1,75. |
| Componentes base | `packages/ui` | `Button` (primary / secondary / ghost; con `href` renderiza enlace; loading, disabled), `IconButton` (`label` obligatorio), `Card` + `CardHeader`, `StatusChip` (success / warning / danger / info / neutral, siempre texto + icono), `PageHeader`. Primitivo añadido: `Icon` (tamaño y trazo únicos). |
| Shell profesional | `apps/admin-web/src/app-shell.tsx`, `shell-v2.css` | Barra grafito, indicador verde en la ruta activa, iconos Lucide, mismos 6 destinos y mismas capacidades. |
| Resumen | `apps/admin-web/src/command-center.tsx`, `summary-v2.css` | PageHeader → métricas → Requiere atención + Próximas sesiones → Equipo ahora. |

## Comportamiento responsive del shell (documentado)

| Ancho | Shell |
|---|---|
| ≥ 1280 | Barra expandida (264 px). El usuario puede plegarla a carril (se recuerda). |
| 1024–1279 | Carril de 72 px automático; los grupos abren en *flyout* con el icono como disparador. |
| < 1024 | Barra superior con botón de menú; la navegación es un *drawer* (rol `dialog`, foco atrapado, Escape y scrim lo cierran, el foco vuelve al botón). **No hay navegación inferior profesional** (DD-08: la experiencia móvil profesional es `staff-app`). |

La tarjeta de sesión y la fila de atención se reorganizan según el **ancho de su tarjeta** (container query), no del viewport. Las métricas pasan a 2×2 por debajo de 1024.

## Datos reales y capacidades pendientes

El Resumen solo muestra lo que `/api/dashboard/command-center` y `/api/session/capabilities` ya entregan. No se creó ningún endpoint ni regla.

- **Requiere atención:** une las incidencias y bandejas existentes (`attention`, pendientes, mensajes sin leer), ordenadas por urgencia (presentación). Vacío: «Nada requiere tu atención.» **PP-01 no está implementado**: no hay señales derivadas ni umbrales.
- **Métricas:** Reservas hoy, Ocupación hoy (solo con aforo > 0), Pendiente de cobro (solo con permiso de facturación) y Clientes activos (solo con permiso de clientes y dato). Ninguna cifra inventada.
- **Actividad reciente:** *capability pending*. No existe una fuente de actividad en el API; el bloque se omite.
- **Avatar / nombre / rol en la barra:** *capability pending*. `/api/session/capabilities` no devuelve identidad ni rol; no se inventó. Requiere un endpoint de sesión (otra TASK).
- **Selector de centro:** no se añadió.
- Se conserva «Equipo ahora» (datos reales del pulso del equipo, con permiso). Se retiró del Resumen el bloque «Pendiente de gestión» (su dato pasa a la métrica «Pendiente de cobro»); el estado de caja sigue en Economía.

## Decisiones tomadas dentro del piloto

- **Alcance de los tokens:** los valores V2 de los tokens ya existentes (neutros, radios, escala de texto, sombras) se aplican por subárbol (`data-2j-design="v2"`) en la barra lateral, la barra superior y el `<main>` del Resumen. Mover la capa a `:root` es un cambio posterior, cuando se migren Member y `staff-app`.
- **Lucide como dependencia de `@2j/ui`** (en lugar de SVG vendorizados que proponía el documento): tree-shakable, licencia ISC, y la superficie de iconos queda en un único fichero (`icons.ts`).
- Las pantallas de Admin que aún no se migran (Clientes, Agenda…) se ven con el shell nuevo y su aspecto anterior; es intencionado.
- Se retiró del CSS antiguo de `styles.css` solo lo que el shell y el Resumen reemplazan (166 líneas de selectores `.app-*`, `.summary-*` del Resumen, `.command-center`).

## Cómo verlo (PILOT local)

```
pnpm owner:review        # Admin 127.0.0.1:5174, Trainer 127.0.0.1:5175, Member 127.0.0.1:5173
pnpm owner:review:stop
```

Requiere Docker Desktop. Los puertos reales quedan en `%LOCALAPPDATA%\2J\owner-visual-review-097y\runtime.json`. No es producción.

## Verificación técnica

`pnpm typecheck`, `pnpm build`, tests de `design-tokens`, `ui`, `admin-web`, `client-app` y `staff-app` en verde. Comprobado en navegador a 1440, 1024, 768 y 390 px (Admin y Trainer). Las capturas no sustituyen la revisión del propietario.

## Pendiente

Aprobación visual del propietario (`VISUAL_APPROVED=no`). No empezar Clientes, Cliente 360, Agenda, Servicios, Planes, Tienda ni Member hasta recibir su feedback.
