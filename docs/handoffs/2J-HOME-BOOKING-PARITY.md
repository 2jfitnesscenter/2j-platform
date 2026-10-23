# Handoff 2J-HOME-BOOKING-PARITY

## Estado verificado

- Repositorio: `2jfitnesscenter/2j-platform`.
- Rama local: `agent/codex/2J-HOME-BOOKING-PARITY`.
- HEAD actual de implementación: `20e8c2e12aab826b943167eac5541fe5d10eae26`.
- Commits de esta línea: `e60c399` (flujo de reserva y cancelación), `c0c7b71` (handoff anterior), `20e8c2e` (D185–D198).
- Draft PR: ninguno; la rama queda local para que Claude Code la publique según la instrucción del propietario.
- Estado del worktree al cerrar: limpio.
- Sin cambios en Platform API/contratos, capacidades, Búnker, base de datos, producción ni infraestructura.

## D185–D198

| Decisión | Estado | Verificación / límite |
|---|---|---|
| D185 | Parcial | Tarjeta compacta: hora y estado disponible/completa/reservada/en espera, sin aforo ni número de lista. El listado `GET /api/me/sessions` no entrega elegibilidad de cuota; por tanto, “no permitida por tu cuota” solo puede mostrarse al abrir el detalle. Añadir esa elegibilidad al listado requiere trabajo del propietario de Platform y queda fuera de esta rama. |
| D186 | Implementado | La ventana consulta `GET /api/me/sessions/:sessionId` y presenta servicio, fecha, hora, entrenador, duración y aforo disponible/total, con reservar, cancelar o salir de espera según estado. |
| D187 | Implementado | `POST /api/me/sessions/:sessionId/reservations`; solo tras respuesta satisfactoria cierra el detalle y anuncia brevemente “Reserva realizada correctamente”. La clave de idempotencia se conserva ante respuesta perdida y se reutiliza al reintentar. |
| D188 | Implementado previamente | La cancelación consulta `GET /api/me/bookings/:id/cancellation-preview`, confirma el resumen calculado por Platform y muta mediante `PATCH /api/me/bookings/:id/cancel`. |
| D189 | Implementado | Mis reservas tiene únicamente las pestañas Próximas e Historial. |
| D190 | Implementado | Listas por fecha/hora; Próximas en orden ascendente e Historial en orden descendente, con servicio, fecha/hora y estado. |
| D191 | Implementado previamente | Acceso desde Inicio (próxima reserva) y Perfil; no se añade pestaña inferior. |
| D192 | Implementado previamente | Inicio muestra la próxima reserva, acceso a Mis reservas y cancelación con confirmación. |
| D193 | Implementado previamente | Inicio oculta la tarjeta si no hay reserva futura; Perfil conserva Mis reservas. |
| D194 | Implementado con validación del servidor | Una sesión completa muestra “Lista de espera” en la propia tarjeta. La app consulta `GET /api/me/sessions/:sessionId` antes de confirmar; solo continúa si el servidor devuelve `canJoinWaitlist`. La mutación queda protegida por Platform. |
| D195 | Implementado | Confirmación expresa informa de que la lista no garantiza plaza. Se crea con `POST /api/me/sessions/:sessionId/waitlist`; luego aparece confirmación breve. |
| D196 | Implementado | Las entradas activas de espera aparecen en Próximas con estado En lista de espera; solo existen dos pestañas. |
| D197 | Implementado | Salir requiere confirmación; el texto aclara que no es una cancelación de clase y que no tiene penalización. Usa `PATCH /api/me/waitlist/:id/cancel`. |
| D198 | Implementado | No se expone la posición de cola. |

## Cambios del último commit

- Tarjetas compactas con solo hora y disponibilidad, sin aforo/ocupación o tamaño de cola.
- Acción individual de reserva y aviso breve tras la persistencia confirmada por Platform.
- Acción de lista de espera desde la tarjeta completa, con comprobación de elegibilidad del detalle y confirmación previa.
- Mis reservas combina reservas y lista de espera en Próximas, separa Historial y añade interacción accesible con flechas izquierda/derecha.
- Pruebas de reserva, reintento idempotente, espera, cancelación, historial y navegación por teclado actualizadas.

## Contratos existentes reutilizados

- `GET /api/me/booking-services`
- `GET /api/me/sessions?from=&to=&serviceId=`
- `GET /api/me/sessions/:sessionId`
- `POST /api/me/sessions/:sessionId/reservations`
- `POST /api/me/sessions/:sessionId/waitlist`
- `GET /api/me/bookings`
- `GET /api/me/bookings/:reservationId/cancellation-preview`
- `PATCH /api/me/bookings/:id/cancel`
- `PATCH /api/me/waitlist/:id/cancel`

No se utiliza el endpoint HMAC interno. No se modifica el contrato versionado 2J-CAPABILITIES-V2.1 ni el endpoint Platform de capacidades. La rama `agent/codex/2J-CAPABILITIES-D40-D41` permanece solo como referencia independiente.

## Pruebas y calidad

- `pnpm --filter @2j/client-app test`: 15/15.
- `pnpm --filter @2j/client-app typecheck`: correcto.
- `pnpm --filter @2j/client-app build`: correcto.
- `git diff --check`: correcto antes de los commits.
- Lint: no ejecutado; `apps/client-app/package.json` no tiene script `lint`.
- Las pruebas de interfaz usan respuestas sintéticas; no son una demostración contra una instancia real de Platform.

## Secuencia siguiente

1. D31 — Home sin cuota (Home no calculará derechos).
2. Push del lado cliente, coordinado con el contrato de Claude Code PR #71.
3. Mediciones, después de confirmar sus contratos de Platform.
4. Resolver con Platform la elegibilidad por cuota que falta en `GET /api/me/sessions`, necesaria para mostrar en la tarjeta “no permitida por tu cuota”.

## Revisión y publicación

- Sin push, merge, Draft PR ni despliegue.
- Revisión y QA independientes: pendientes.
- Ninguna operación contra clientes o datos reales.
