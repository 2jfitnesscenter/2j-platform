# 2J Parity — detalle de sesión (fila 7)

## Alcance

Backend/API únicamente; no se modifican `admin-web` ni `staff-app`.

## Rutas existentes verificadas

- `GET /api/calendar/week`: sesiones y conteos de aforo/espera.
- `GET /api/calendar/sessions/:sessionId/attendees`: asistentes y lista de espera, sin metadatos completos.
- `GET /api/calendar/sessions/:sessionId/booking-eligibility?clientId=...`: previsualización actual por cliente; no es un snapshot histórico.
- Las rutas de reserva manual, espera, asistencia, edición de aforo y cancelación ya existen y se mantienen.

## Delta de esta fila

- `GET /api/calendar/sessions/:sessionId` compone metadatos, aforo, asistentes, lista de espera, historial de eventos e información de notas en una lectura consistente. El historial solo expone acción, recurso, fecha y etiqueta del actor; nunca devuelve `calendar_audit_events.details`, que puede contener motivos libres o identificadores internos.
- Los datos identificables de asistentes solo se devuelven con `clients.read`; las notas requieren `communication.internal_notes.read`.
- `POST /api/calendar/sessions/:sessionId/notes` requiere `communication.internal_notes.write`; notas append-only y creación auditada.
- El detalle declara `appliedRules.available=false` porque no se guarda un snapshot de las reglas de elegibilidad aplicadas en el momento de cada reserva. No se reconstruye ni inventa semántica histórica.
- Migración `0056_calendar_session_detail.sql`; su número se comprobó contra las ramas de PR abiertas inmediatamente antes de crearla: #124 usa 0053 y #125 usa 0054; main tenía 0055. La comprobación de CI/PR debe repetirse antes de publicar.

## Validación local

- PostgreSQL sintético desechable, migraciones desde cero.
- Tests focales de detalle/notas y privacidad del historial: 4/4 PASS.
- Tras el ajuste de privacidad, `apps/api/test/calendar.test.mjs`: 38/38 PASS (PostgreSQL sintético limpio).
- Suite API completa: 375/375 PASS, 0 omitidos; incluye verificación de migraciones y numeración.
- Suite API completa 375/375 fue ejecutada antes del ajuste final de privacidad; no se repitió para este delta. El cambio final sí se verificó con la suite focal completa de calendario.
- Typecheck del monorepo tras el ajuste: 11/11 tareas PASS.
- Build del monorepo tras el ajuste, ejecución secuencial: 9/9 tareas PASS.
- `git diff --check`: PASS tras el ajuste.

No se han modificado pantallas. No se ha publicado el cambio ni ejecutado migraciones fuera de PostgreSQL local sintético. La revisión independiente sigue pendiente.
