# Handoff: fixture temporal de pagos y reservas

## Alcance

Corrección exclusiva del fixture de `apps/api/test/term-payment-booking.integration.test.mjs` para que las sesiones y fechas de contrato se calculen respecto al reloj de ejecución. No cambia lógica de producción, reglas de negocio ni migraciones. Esta rama nueva parte de `origin/main` (`f87818afe474176c6e6ae77cb4d62a7e73fc1adf`) y no incluye commits de PR #50 ni los filtros de calendario.

## Reproducción en origin/main

En PostgreSQL sintético limpio, la prueba original resultó en **6 tests: 3 PASS / 3 FAIL**. Los tres fallos devuelven `session_started` porque las sesiones fijadas al 23-10-2026 a las 12:00 UTC ya habían comenzado al ejecutarse la prueba ese día. Esto confirma un defecto temporal del fixture en `origin/main`, no una regresión de 2J-098E.

## Corrección

Las fechas de inicio de contrato se derivan de la fecha actual; las sesiones se sitúan en el futuro; los límites de vencimiento se calculan en `Atlantic/Canary`. Las pruebas de bolsas usan fechas relativas al inicio del contrato. Se conservan las reglas funcionales y los datos de negocio probados.

## Validación local

- Test original en `origin/main`, DB sintética limpia: **3 PASS / 3 FAIL** (reproducción esperada).
- Test corregido, DB sintética limpia: **6/6 PASS**.
- Suite API completa: **244/244 PASS**.
- `pnpm typecheck`: **11 tareas correctas**.
- `pnpm build --force`: **9 tareas correctas**. En Windows fue necesario regenerar `packages/design-tokens/src/tokens.css` temporalmente porque `core.autocrlf=true` convierte LF a CRLF y el verificador compara bytes; el archivo local original se restauró y no forma parte del diff.
- Lint: el repositorio no define ningún script `lint` en los manifiestos de workspace.
- `git diff --check`: PASS.
- CI de GitHub en el head `b8aac1c756216bb630f9bcf3dc4e1030d0dc595a`: `quality` PASS y `secret scan` PASS. Esta revisión del handoff generará un nuevo head documental; sus checks deberán verificarse después del push.

Las pruebas crean sus propias bases temporales sintéticas y las eliminan en `finally`. Las bases sintéticas de origen usadas para lanzar las suites no contienen datos productivos.

## Fechas de otros tests

Los fixtures de sesiones de `apps/api/test/calendar.test.mjs`, `apps/api/test/communications.test.mjs`, `apps/api/test/client-app.test.mjs`, `apps/admin-web/test/app-shell.test.mjs` y `apps/staff-app/test/staff-app.test.mjs` usan offsets desde `Date.now()`/`new Date()` o un reloj controlado. Los casos de calendario con fechas históricas fijas inyectan explícitamente su fecha de materialización.

Otros fixtures de sesiones futuras fijas, sin dependencia del reloj actual y con horizonte lejano, están en `apps/api/test/staff.test.mjs` (2099-01-05), `apps/api/test/services.test.mjs` (2099-12-10) y `apps/staff-app/test/staff-page.test.mjs` (2099-01-05). El helper de filtros de `apps/admin-web/test/calendar-page.test.mjs` usa sesiones del 2030 y también fija explícitamente el `now` de la aserción. No se modifican por quedar fuera del fallo y de este alcance.

## Stack de calendario

El stack se rebasó localmente, sin publicar, en `C:\Users\juanj\Dev\2J\temp\calendar-stack-rebase`, desde el merge-base `7392c4709c66cc131d3d3857c1a177e86f31e137` hasta el commit de filtros `4690c9c2381ca90657fac55c506b17a54bf69193`, sobre `origin/main` `f87818afe474176c6e6ae77cb4d62a7e73fc1adf`. Contiene ocho commits: los siete commits de agenda (`bd09b800` a `0bf26004`) más `4690c9c2`; el head local final es `10b49265f99799dfcdc5c8f28f9f6f6068173f57`. La rama de este handoff/PR #68 permanece independiente y no incluye esos commits.

Resolución de conflictos de `apps/admin-web/src/calendar-page.tsx`:

1. Al aplicar `bd09b80`, se conservaron los componentes de diseño V2 de PR #50 (`PageHeader`, `Card`, `SegmentedControl` y `Button`) y se reincorporó el eyebrow de `origin/main` (`HOY · ATLANTIC/CANARY`). Para el título del día se mantuvo `dayMonthDate.format`, que evita repetir el nombre del día junto a la etiqueta abreviada.
2. Al aplicar `4690c9c`, se combinaron los filtros nuevos de servicio/profesional con los filtros de sesión, etiquetas de días y navegación de fechas existentes en `origin/main`; se conservaron los controles accesibles de la barra de filtros. El test detectó que `spanishDate.format` duplicaba el día (`Vie vie, 23 oct`), así que se dejó `dayMonthDate.format`.

También hubo un conflicto en `apps/admin-web/test/clients-page.test.mjs` al aplicar `2c73969`: se conservaron tanto el mensaje explícito de la aserción de foco como el timeout de 5 segundos añadido para CI lento.

Verificación local del stack rebasado sobre DB PostgreSQL sintética limpia, usando solo durante la ejecución un overlay temporal del fixture corregido que se restauró al acabar: suite completa PASS; API **246/246**, Admin Web **186/186**, Client App y Staff App PASS. La suite Admin inicial señaló el nombre de día duplicado; tras corregirlo, la suite completa limpia pasó. `pnpm typecheck`: **11/11**. `pnpm build --force`: **9/9**. `git diff --check`: PASS. No hay script `lint` en los manifiestos del repositorio. La rama del stack está limpia, adelantada ocho commits respecto a `origin/main` y no se ha publicado; requiere revisión/autorización antes de push.
