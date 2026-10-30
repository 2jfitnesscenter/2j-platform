# A68 — Platform gate for Home Mi evolución

## Estado

- Rama: `agent/codex/2J-A68-HOME-EVOLUTION-GATE`
- Base: `80397367f7ce165fa0dc98d5ca8a7d90006a2592` (main después de integrar el contrato documental #135)
- Estado: implementación preparada para revisión independiente; no fusionada ni desplegada.
- Migración nueva: `0063_member_evolution_consent_audit.sql`; el siguiente prefijo disponible se comprobó contra las migraciones de `main` y las ramas de PR abiertas visibles antes de crearla.

## Contrato implementado

- `GET /api/me/training-summary` mantiene la identidad y el enlace canónicos resueltos en servidor. Antes de invocar el adapter exige una asignación efectiva activa que contenga el derecho `training_access` y la aceptación de la versión activa del consentimiento `home_evolution`.
- Si falta el derecho devuelve `summaryStatus: "blocked", reason: "entitlement_required"`. Si el texto del propietario no está publicado, devuelve `consent_unpublished`; si no se aceptó o fue revocado, devuelve `consent_required` o `consent_revoked`. No se llama a Training en esos casos.
- Home presenta los estados bloqueados como «Sin datos disponibles», sin tratarlos como una caída temporal ni ofrecer reintento.
- El propietario crea, versiona y publica el texto usando el catálogo de consentimientos existente. No se crea texto por defecto. Mi evolución tiene endpoints propios de lectura, aceptación versionada y revocación; las rutas/listas genéricas y los contadores de consentimientos pendientes no pueden sustituir ni clasificar este registro como una aceptación genérica. Tampoco se puede asignar como requisito de reservas/documentos.
- Cada consulta añade un evento append-only con actor de cliente/persona y decisión; no guarda texto del consentimiento ni respuesta de Training. Aceptaciones conservan la versión, hash de contenido, nombre escrito, clave de idempotencia y huella de petición; revocaciones se añaden como eventos, sin reescribir el historial.

## Validación ejecutada

- PostgreSQL sintético desechable recién creado, migraciones desde cero: prueba API enfocada `client-app.test.mjs`, 9/9.
- Suite API completa en base sintética limpia: 432/432.
- `pnpm --filter @2j/admin-web test`: 389/389. La primera ejecución encadenada había tenido un fallo transitorio de carga en `store-photos.test.mjs`; el caso aislado pasó 17/17 y la suite Admin Web completa volvió a pasar.
- `pnpm --filter @2j/client-app test`: 49/49.
- `pnpm typecheck`: 11/11 tareas correctas.
- `pnpm build --force`: 9/9 tareas correctas.
- `git diff --check`: PASS.
- La ejecución encadenada de `pnpm test` no terminó verde como una única ejecución: tras API 432/432, Admin Web falló una vez en el test de tienda indicado. No se afirma un resultado global 961/961 para el estado final.
- Revisión independiente de nivel 2: `PASS WITH P2`; sin defecto concreto en la migración ni en los gates. Observación: el adapter permanece en el transporte 2J-089; este PR no implementa el transporte A68 separado `training-evolution` ni su propósito firmado. No debe usarse como evidencia de que esa integración Búnker ya está completa.

## Límites y siguiente paso

- La respuesta sigue usando el adapter compatible de resumen 2J-089 ya integrado en Platform; no se modificó Búnker ni se cambió su envelope/ruta remota en esta tarea. El transporte separado `training-evolution` con propósito firmado `home_evolution` sigue siendo un trabajo de integración distinto.
- Sin datos de entrenamiento, derechos, consentimiento o identidad disponibles, Home no muestra resumen. No se devuelve información de salud.
- Requiere checks verdes para el SHA exacto antes de fusionar; la revisión independiente ya se realizó con `PASS WITH P2` y la limitación está documentada. No se ejecutaron despliegues ni migraciones sobre bases reales.
- La PR #168 observada en GitHub es de `2j-platform` (Home A67, head `d60ed8cdd3e520b286214ddcc11fc8f2ab012175`), no de Búnker; la PR #168 de `2jfitnessapp` no existe. Avisar al equipo correcto tras integrar este gate.
