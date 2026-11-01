# A77 — reapertura de caja y lectura de planes

## Estado

Implementación en `codex/A77-cash-reopen-plan-cards`, basada en `origin/main` `d4bd9769b38d5260fc80d1625980d239ea52db87`. Sin despliegues ni migraciones sobre bases reales.

## Cambios

- La migración nueva `0072_cash_multiple_sessions_per_register_day.sql` elimina el índice único que impedía reutilizar una caja el mismo día. Se conserva el índice que impide dos sesiones abiertas simultáneas en el mismo registro.
- Abrir una caja tras cerrar su ciclo crea una sesión nueva. Reabrir un cierre por corrección sigue siendo acción exclusiva del propietario y añade al evento auditado el actor, motivo opcional, fecha, recuento y balance/diferencia anteriores. El ledger anterior no se borra.
- El endpoint de Panel de gestión, protegido por `owner.panel.read`, incluye el historial reciente de aperturas, cierres, reaperturas y traspasos. Solo esa vista recibe diferencias monetarias.
- Las fichas de Sesiones, Vigencia y Servicios usan una cuadrícula completa y adaptable; las palabras no se parten verticalmente.

## Pase de negocio sintético (5 pasos)

1. Dos profesionales sintéticos fichan entrada y abren Búnker y Sala de forma independiente.
2. Se traspasa Búnker con dos recuentos ciegos; ambos profesionales conservan solo sus movimientos propios.
3. Se cierra el ciclo de Búnker y se abre otro en la misma fecha; la API crea otra sesión y mantiene el cierre anterior auditado.
4. El propietario reabre el cierre previo con motivo; el evento guarda el balance anterior y la operación sigue siendo exclusiva de `owner.panel.read`.
5. Se verifica que una segunda apertura simultánea del mismo registro se rechaza, el staff puede fichar salida y solo el propietario ve el historial con diferencias.

Estos pasos se cubren con `cash-registers.test.mjs` y `management-panel.test.mjs` sobre PostgreSQL sintético; no se hizo una prueba manual en staging.

## Verificación

- API/PostgreSQL sintética: **458/458 PASS**.
- Admin Web: **445/445 PASS** en ejecución secuencial; pruebas enfocadas de Panel de gestión y Planes: **23/23 PASS**.
- Typecheck: **11/11 tareas PASS**. Build del monorepo: **9/9 tareas PASS**; build final Admin Web: PASS.
- Numeración de migraciones: **2/2 PASS**; `0072` se aplicó en las bases sintéticas creadas por la suite y quitó el índice diario, conservando el índice de sesión abierta única.
- `pnpm audit --audit-level high`: PASS (2 vulnerabilidades low y 5 moderate, ninguna high). `git diff --check`: PASS.
- No hay migraciones en los PR abiertos consultados, incluido #191. CI/secret scan del SHA publicado: pendiente.
- No se hizo una prueba manual en staging ni un despliegue.
