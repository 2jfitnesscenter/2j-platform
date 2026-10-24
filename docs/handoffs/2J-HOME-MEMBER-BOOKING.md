# 2J-HOME-MEMBER-BOOKING — handoff a Work Platform y Claude Code

## Estado verificado

- Repositorio: `2jfitnesscenter/2j-platform`.
- Rama: `agent/codex/2J-HOME-MEMBER-BOOKING`.
- Revisión verificada de Platform: `f87818afe474176c6e6ae77cb4d62a7e73fc1adf` (`origin/main`, PR locales #61–#63).
- HEAD de integración previo a este handoff: `7ac5afe8222a34699913ad9d278bddf363842ce6`.
- Base Home preservada: rama visual `agent/codex/2J-HOME-VISUAL-UNIFICATION`, implementación `88b71635ffe3e39c79906a25362312cb34dcb9f3`, con los cinco commits locales de esa entrega conservados en la ascendencia. No se reescribieron ni se sobrescribieron.
- No hubo cambios de código en Platform API, Admin Web, Staff App, Búnker, base real, SSO, DNS o infraestructura durante esta tarea. El merge de `origin/main` incorpora los commits de Platform ya presentes localmente.

La referencia externa PR #65 no se consultó: `AGENTS.md` prohíbe llamadas a proveedores. La copia Git local contiene la rama y sus commits, pero no una referencia `refs/pull/65`; por ello no se afirma el estado remoto de esa PR.

## Flujo de miembro existente y comprobado

El recorrido ya estaba implementado en Home/2J-092 y se conserva:

1. Inicio abre el selector de actividad y los horarios publicados.
2. Home pide al servidor el detalle y la elegibilidad de la sesión.
3. El cliente elige explícitamente una o más sesiones y confirma cada mutación individualmente.
4. Home envía la clave `Idempotency-Key` y Platform vuelve a evaluar el permiso, la cuota, el saldo, el periodo, la deuda, los documentos, los conflictos y el aforo dentro del motor central.
5. `Mis reservas` lee de nuevo la lista desde Platform.
6. Para cancelar, Home obtiene primero la vista previa del servidor y muestra su resumen; solo después de la confirmación del miembro envía la cancelación.
7. El resultado y el historial se vuelven a leer desde Platform. La lista de espera permanece como acción separada y explícita.

El piloto real de navegador se ejecutó con María González, una identidad sintética local, contra una instancia PostgreSQL desechable en `127.0.0.1:55439`. La reserva de Acondicionamiento del 26 de octubre de 2026 a las 17:00 pasó a `reserved`; Home la mostró en “Mis reservas”. Tras la vista previa autorizada, se canceló y quedó como `cancelled`; al recargar la página la cancelación seguía en el historial y ya no figuraba entre las próximas. La consulta SQL de la base sintética confirmó el estado y la hora local Atlantic/Canary. No se usaron datos de clientes reales.

La demostración quedó abierta en `http://127.0.0.1:5189/`. API de piloto local: `127.0.0.1:8819`. Cuenta/código: `2j-member-a-local`; es solo la credencial sintética local definida por el piloto. No se debe reutilizar ni publicar.

## Contrato reutilizado — no hace falta API nueva para este flujo

- `GET /api/me/booking-access`: estado del piloto de reservas del miembro.
- `GET /api/me/booking-services`: servicios que tienen sesiones futuras publicadas visibles para esa identidad.
- `GET /api/me/sessions?from=YYYY-MM-DD&to=YYYY-MM-DD`: sesiones publicables del intervalo acotado.
- `GET /api/me/sessions/:sessionId`: detalle y elegibilidad autoritativa de la sesión.
- `POST /api/me/sessions/:sessionId/reservations`: reserva explícita e idempotente; opcionalmente recibe `entitlementAssignmentId` cuando el servidor devuelve alternativas.
- `GET /api/me/bookings`: reservas y lista de espera propias.
- `GET /api/me/bookings/:reservationId/cancellation-preview`: política y resultado esperado de cancelación.
- `PATCH /api/me/bookings/:reservationId/cancel`: mutación de cancelación idempotente y limitada al miembro autenticado.

La interfaz no calcula derechos, saldo, aforo ni políticas. La referencia de las cuotas de término y el bloqueo por pago se actualizó en Platform #61–#63; los errores de elegibilidad se traducen desde los códigos existentes del servidor. Para una cuota impagada que ya bloquea reservas, el motor devuelve `debt_restriction`. Una vista previa no envía operaciones.

## Límite para Work Platform

No se detectó contrato de reserva/cancelación ausente para completar este recorrido. Antes de habilitar clientes reales sí sigue pendiente el contrato y despliegue de identidad productiva y la autorización de cohortes; el login disponible es un piloto solo de desarrollo/pruebas. No activar SSO, passkeys ni vinculación de Búnker desde Home en esta fase. Mantener `home.2jfitnesscenter.com` en modo sintético hasta aprobar ese trabajo por separado.

La regla vigente contra reservas recurrentes automáticas de cliente se respeta: las clases se seleccionan manualmente y cada sesión se confirma explícitamente. La política de cancelación procede siempre del preview de Platform.

## Pruebas realizadas en esta revisión

- `pnpm --filter @2j/client-app test`: **15/15**, incluida navegación, selección explícita, reintento idempotente, estado de reserva, actualización de próxima reserva y cancelación con actualización del historial.
- `member-pilot-seed.test.mjs` sobre PostgreSQL 17 nuevo y desechable: **1/1**. Verificó login sintético, elegibilidad, persistencia de reserva, repetición con misma clave, consumo/restauración y persistencia/cancelación; incluye auditoría y notificaciones.
- `term-payment-access.test.mjs`: **6/6**.
- `term-payment-booking.integration.test.mjs`: **3/6** en la fecha de revisión. Tres pruebas que crean una sesión fija para `2026-10-23T12:00:00Z` fallan con `session_started` porque esa hora ya había pasado; las tres pruebas restantes pasan. Es deriva temporal de la fixture de Platform, no un contrato que Home haya inventado. Work Platform debe hacer que la fecha de sesión de esa fixture sea futura/dinámica y volver a ejecutar la suite. No se modificó código API ni tests de Platform en esta rama.
- `pnpm build`: **9/9 tareas**.
- `pnpm typecheck`: **11/11 tareas**.
- Navegador local: HTTP 200, login sintético, carga de horarios, reserva, listado, preview de cancelación, cancelación y comprobación tras recarga.
- Las pruebas de navegador se hicieron en navegador de escritorio contra Home; no equivalen a prueba en teléfono físico.

La primera ejecución del lanzador estándar detectó que el volumen antiguo `2j-platform-084-pilot` tiene un checksum distinto para `0029_member_booking_pilot_cohort.sql`. El verificador detuvo el inicio antes de sembrar datos. No se alteró ni se corrigió ninguna migración histórica. Se dejó ese contenedor parado y se repitieron las pruebas de aceptación en otra base desechable, limpia y aislada.

## Instrucciones

- Work Platform: conservar los contratos anteriores; antes de abrir cohortes reales, publicar identity/session estable y revisar que #61–#63 permanezcan en la rama de integración. No crear un segundo motor de reservas para Home.
- Work Platform: corregir la fixture horaria de `apps/api/test/term-payment-booking.integration.test.mjs` (sesión de prueba ya iniciada al 23-10-2026) y repetir las seis pruebas de integración.
- Claude Code: revisión independiente del flujo y accesibilidad móvil en este HEAD; confirmar que el estilo mantiene el tema visual aprobado y que el CTA de Búnker no se convierte en SSO.
- No push, merge o despliegue en esta tarea.
