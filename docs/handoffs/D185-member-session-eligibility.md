# Handoff D185 — eligibility in Member session list

## Estado

- Rama nueva: `codex/2J-D185-availability-object`.
- Base: `abd31b89ffc2ce64c9fae167f2226267234b2348`.
- Objetivo: añadir al listado `GET /api/me/sessions` el estado de elegibilidad calculado por Platform, sin llamadas HTTP por tarjeta.
- No se ha fusionado ni desplegado. No se han aplicado migraciones; el cambio no requiere ninguna.

## Implementación

Cada sesión devuelve el objeto aditivo `availability: { status, reason, canJoinWaitlist }`, descrito en `docs/contracts/member-sessions-eligibility-v1.md`. El servidor usa el resolver central de reservas y conserva la semántica existente de reserva y lista de espera. `waitlist_suspended` es derivado y no modifica datos. El ID interno de la entrada de espera se usa solo en servidor para excluir la propia entrada al revalidar elegibilidad y no sale en la respuesta.

Estados cubiertos: `available`, `full`, `booked`, `not_allowed_by_plan`, `waitlisted` y `waitlist_suspended`. La prueba de integración valida los seis estados con una sola petición al endpoint de lista.

## Validación registrada

- La rama nueva reemplaza el stack antiguo de #80 sobre la API integrada por #110. `availability` se mantiene como objeto `{ status, reason, canJoinWaitlist }` tanto en lista como en detalle; no se añade una llamada por sesión ni se exponen IDs de waitlist.
- `waitlist_suspended` causado por restricción de pago conserva `reason: null` para no filtrar el estado económico; motivos no económicos como `service_not_allowed` sí se incluyen.
- PostgreSQL sintético limpio: test focal `client-app.test.mjs` 9/9 PASS; suite API completa 372/372 PASS (0 fallos, 0 omitidos).
- `pnpm typecheck`: 11/11 tareas PASS.
- `pnpm build --force`: 9/9 tareas PASS.
- `git diff --check`: PASS.
- No se añaden migraciones; el test API completo verificó el set existente.
- No hay script `lint` en el package raíz ni en los paquetes de este repositorio.
- CI inicial del SHA antiguo `3ed78d4875a0c10aa078b0e487af366d378584ab`: tests, migraciones sintéticas, typecheck y build PASS; quality FAIL por el advisory preexistente `GHSA-mrhx-c7xc-m3w5` (Zod transitivo). Esta evidencia no verifica la rama nueva.
- Primer intento API antes de compilar dependencias: falló porque el worktree nuevo carecía de `node_modules` y de `packages/domain/dist`; se instalaron las dependencias con `pnpm install --frozen-lockfile` y se compiló el paquete requerido antes de la prueba válida.

## Revisión y coordinación

Falta revisión independiente y CI exacta del head publicado. Work Home y Claude Code deben recibir el contrato tras la integración; no se ha enviado mensaje porque no está integrada. El PR #80 original se cerrará como sustituido solo después de publicar este reemplazo.

No hay cambios en Home, Búnker, `2jfitnessapp`, migraciones, reglas de reserva, pagos, contratos ni otras ramas de integración.
