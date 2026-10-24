# Handoff D185 — eligibility in Member session list

## Estado

- Rama: `agent/codex/2J-D185-session-eligibility`.
- Base inicial: `c94830f6aec75904d627795b816f95e84693da2a` (`origin/main` comprobado al iniciar).
- Objetivo: añadir al listado `GET /api/me/sessions` el estado de elegibilidad calculado por Platform, sin llamadas HTTP por tarjeta.
- No se ha fusionado ni desplegado. No se han aplicado migraciones; el cambio no requiere ninguna.

## Implementación

Cada sesión devuelve los campos aditivos `availability` y `availabilityReason`, descritos en `docs/contracts/member-sessions-eligibility-v1.md`. El servidor usa el resolver central de reservas y conserva la semántica existente de reserva y lista de espera. `waitlist_suspended` es derivado y no modifica datos. El ID interno de la entrada de espera se usa solo en servidor para excluir la propia entrada al revalidar elegibilidad y no sale en la respuesta.

Estados cubiertos: `available`, `full`, `booked`, `not_allowed_by_plan`, `waitlisted` y `waitlist_suspended`. La prueba de integración valida los seis estados con una sola petición al endpoint de lista.

## Validación registrada

- API integration: suite completa, 245/245 PASS en PostgreSQL sintético; incluye `client-app.test.mjs` (9/9) y la cobertura de los seis estados.
- Typecheck de monorepo: 11/11 tareas PASS.
- Build de monorepo: 9/9 tareas PASS. En Windows fue necesario regenerar temporalmente `packages/design-tokens/src/tokens.css` por la diferencia de finales de línea del checkout; se restauró y no forma parte del diff.
- `git diff --check`: PASS.
- No hay script `lint` en el package raíz ni en los paquetes de este repositorio.
- CI inicial sobre `3ed78d4875a0c10aa078b0e487af366d378584ab`: `pnpm install`, migraciones sintéticas, typecheck, suite completa, build y secret scan PASS; `quality` termina FAIL únicamente en `pnpm audit --audit-level high` por el advisory existente `GHSA-mrhx-c7xc-m3w5` (Zod transitivo de `apps/api`, versión afectada `<4.6.6`; también informa una vulnerabilidad LOW). El lockfile y las dependencias no se modificaron en esta tarea.
- Primer intento API antes de compilar dependencias: falló porque el worktree nuevo carecía de `node_modules` y de `packages/domain/dist`; se instalaron las dependencias con `pnpm install --frozen-lockfile` y se compiló el paquete requerido antes de la prueba válida.

## Revisión y coordinación

Falta la revisión independiente. La CI tiene bloqueado el gate de auditoría por una vulnerabilidad de dependencia preexistente y ajena a este cambio. Work Home y Claude Code deben recibir el contrato después de integrar el PR, conforme a la petición de producto; todavía no se envió ningún mensaje porque el cambio no está fusionado.

No hay cambios en Home, Búnker, `2jfitnessapp`, migraciones, reglas de reserva, pagos, contratos ni otras ramas de integración.
