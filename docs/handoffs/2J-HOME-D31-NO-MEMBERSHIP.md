# 2J-HOME-D31 — Home sin cuota

## Estado

- Repositorio: `2jfitnesscenter/2j-platform`.
- Rama local: `agent/codex/2J-HOME-D31-no-membership`.
- Base: `3303500272408c246ba9cd6017727af319146588` (D185–D198 verificado).
- Commit de implementación: `f112842eb94b6dc6c28dd91408d4533cd44a1db4`.
- PR: ninguno; rama local para publicación posterior por Claude Code.
- Despliegue: ninguno.

## Implementación

Home consulta el endpoint existente y autenticado por sesión `GET /api/me/membership`. Usa `active` devuelto por Platform como autoridad para habilitar reservas y cargar agenda, y conserva `assignments` para mostrar el historial de cuotas. El tipo contempla `modules[].capabilities`, junto con fecha de cálculo y zona horaria.

Sin cuotas activas, Home mantiene las cinco secciones principales, perfil, noticias, contratos/documentos, buzón, ajustes, tienda informativa y la entrada a Búnker. Oculta los accesos y resumen de reservas, no carga reservas, permisos de reserva, sesiones ni servicios de reserva, y bloquea tanto las vistas directas como enlaces profundos de notificaciones a reservar o Mis reservas. No se activan compras.

## Límites y dependencias

- No se modificó la API Platform, el endpoint de capacidades, el contrato versionado `2J-CAPABILITIES-V2.1`, autenticación, Búnker ni datos reales.
- No se usa el endpoint HMAC interno.
- El endpoint `/api/me/membership` ya entrega `active`, `asOf`, `timezone` y `modules[].capabilities`; Home tipa el contrato y aplica solo el estado `active` para la puerta de reserva. No asigna semántica nueva a capacidades. La adaptación detallada del V2.1 de capacidades para los permisos Búnker queda pendiente de su publicación por Claude Code.
- La entrada Búnker permanece en la navegación, según D40; el acceso operativo y las capacidades deben validarse del lado servidor de Búnker conforme al contrato acordado.
- “Cuotas y saldo” no habilita pagos. La consulta del libro de pagos requiere el contrato API correspondiente si se incorpora en una fase posterior.
- El bloqueo de reserva en Home es experiencia de usuario; Platform sigue siendo responsable de rechazar operaciones no autorizadas.

## Verificación ejecutada

- `pnpm --filter @2j/client-app test`: 16/16.
- `pnpm --filter @2j/client-app typecheck`: correcto.
- `pnpm --filter @2j/client-app build`: correcto.
- `git diff --check`: correcto.
- No existe script `lint` en `apps/client-app/package.json`.
- La prueba D31 usa datos/respuestas sintéticas; no es una prueba contra Platform desplegada.

## Archivos de implementación

- `apps/client-app/src/client-app.tsx`
- `apps/client-app/test/client-app.test.mjs`

## Revisión y siguiente orden

- Revisión independiente y QA: pendientes.
- Mantener la rama local; sin push, merge, PR ni despliegue.
- Siguiente tarea: push cliente contra el contrato Claude Code PR #71. No iniciar hasta revisar el contrato y preparar la integración solo cliente.
- Después: mediciones contra los contratos Platform confirmados.
- La rama `agent/codex/2J-CAPABILITIES-D40-D41` se conserva como referencia intacta, SHA `374c5599fa16621f79929f1a632b82113cf11994`.
