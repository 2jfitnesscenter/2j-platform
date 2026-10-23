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
- CI de GitHub en el head de implementación `51dd00b7958fb7cdc4c52a5f3c4c373cdaa9e347`: `quality` PASS y `secret scan` PASS. Esta nota solo actualiza documentación; los checks del nuevo head se verificarán tras publicarla.

Las pruebas crean sus propias bases temporales sintéticas y las eliminan en `finally`. Las bases sintéticas de origen usadas para lanzar las suites no contienen datos productivos.

## Fechas de otros tests

Los fixtures de sesiones de `apps/api/test/calendar.test.mjs`, `apps/api/test/communications.test.mjs`, `apps/api/test/client-app.test.mjs`, `apps/admin-web/test/app-shell.test.mjs` y `apps/staff-app/test/staff-app.test.mjs` usan offsets desde `Date.now()`/`new Date()` o un reloj controlado. Los casos de calendario con fechas históricas fijas inyectan explícitamente su fecha de materialización.

Otros fixtures de sesiones futuras fijas, sin dependencia del reloj actual y con horizonte lejano, están en `apps/api/test/staff.test.mjs` (2099-01-05), `apps/api/test/services.test.mjs` (2099-12-10) y `apps/staff-app/test/staff-page.test.mjs` (2099-01-05). El helper de filtros de `apps/admin-web/test/calendar-page.test.mjs` usa sesiones del 2030 y también fija explícitamente el `now` de la aserción. No se modifican por quedar fuera del fallo y de este alcance.

## Stack de calendario

El rebase del stack de agenda de PR #50 y el commit `4690c9c2` de filtros se está realizando en una rama/worktree separado sobre el `origin/main` actualizado. La rama de este handoff permanece independiente y no contiene esos commits. El stack no se publicará sin autorización.

