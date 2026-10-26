# Handoff 2J-A45 — horario del centro y turnos

## Estado

Implementación inicial de horario de apertura efectivo, turnos fechados asignados por el propietario y lectura de huecos de cobertura de personal. Este PR queda pendiente de CI y re-review independiente; no está fusionado ni desplegado.

## Implementado

- Migración aditiva `0051_center_hours_staff_shifts.sql`; mantiene `Atlantic/Canary` como zona horaria de operación.
- `center_opening_hours` permite varios intervalos semanales por día y cambios con fecha efectiva. Las sustituciones conservan las versiones anteriores y registran snapshots anterior/nuevo en `staff_audit_events`.
- `staff_shift_assignments` representa turnos concretos fechados, no disponibilidad de calendario (`staff_schedule_slots`), clases ni fichajes. Los turnos no generan ni corrigen eventos de reloj.
- API owner-only para leer/guardar horario, crear/listar/cancelar turnos y consultar huecos de personal. La comprobación de solapes serializa la escritura por profesional.
- Capacidades explícitas `center.hours.manage`, `staff.shifts.manage`, `staff.shifts.read`; no las concede el comodín Admin. El resolver de identidad configurado mediante `PLATFORM_OWNER_ACTOR_ID` las añade únicamente al actor propietario, igual que `owner.panel.read`.
- Configuración muestra la pestaña «Horario y turnos» con carga, error, reintento, feedback y campos operativos de 44 px.

## Límite conocido: custodia de caja

La cobertura real de caja aparece como `incomplete`: los datos actuales registran apertura/cierre de la sesión, pero todavía no los intervalos de traspaso A39–A44. La API entrega las sesiones registradas y explica la limitación; no declara que una persona cubriese toda la sesión ni genera alertas de custodia incompletas como si fueran hechos. La vista de cobertura sí calcula los huecos de turnos asignados dentro del horario de apertura.

No incluye recurrencia de turnos, reglas laborales, asistencia, alertas basadas en fichajes ni cambios al ledger de caja/fichajes. No ejecuta migraciones en bases reales.

## Validación local

- `pnpm install --frozen-lockfile` completado; dependencias instaladas desde el lockfile.
- `pnpm typecheck`: PASS, 11/11 tareas.
- `pnpm build --force`: PASS, 9/9 tareas.
- `@2j/permissions`: PASS, 11/11.
- Admin Web: PASS, 318/318.
- API PostgreSQL sintético: suite completa PASS, 366/366 (0 fallos, 0 omitidos), ejecutada tras el ajuste de auditoría. Tests dirigidos de A45: 2/2 PASS.
- Admin Web: suite completa PASS, 318/318; test dirigido de Configuración: 5/5 PASS.
- `@2j/api db:migrate`: PASS, 50 migraciones checksummed, incluida `0051_center_hours_staff_shifts.sql` (el prefijo 0049 sigue libre; no se renumeraron migraciones previas).
- `git diff --check`: PASS en el head candidato.

## Pendiente de cierre

- CI exacto del nuevo head y re-review independiente conforme a A57 antes de cualquier decisión de merge.
- Completar el modelo de traspasos de caja A39–A44 antes de afirmar cobertura real de custodia.
