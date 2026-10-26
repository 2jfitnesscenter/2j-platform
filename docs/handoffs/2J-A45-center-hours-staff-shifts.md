# Handoff 2J-A45 — horario del centro y turnos

## Estado

Implementación inicial de horario de apertura efectivo, turnos fechados asignados por el propietario y lectura de huecos de cobertura de personal. Work Home encontró en la revisión inicial un P1 en selección de periodos efectivos y un P2 de concurrencia. Ambos están corregidos en el delta local actual: las lecturas aceptan fecha efectiva; una modificación solo sustituye los intervalos de esa fecha y conserva periodos futuros; la prueba de concurrencia mantiene un bloqueo real y verifica que dos solicitudes simultáneas no creen turnos solapados. El PR sigue pendiente de publicación de este delta y re-review independiente; no está fusionado ni desplegado.

## Implementado

- Migración aditiva `0053_center_hours_staff_shifts.sql`; se renumeró después de integrar #115 (0052). Mantiene `Atlantic/Canary` como zona horaria de operación.
- `center_opening_hours` permite varios intervalos semanales por día y cambios con fecha efectiva. Las sustituciones conservan las versiones anteriores, las fechas futuras y registran snapshots anterior/nuevo en `staff_audit_events`.
- `staff_shift_assignments` representa turnos concretos fechados, no disponibilidad de calendario (`staff_schedule_slots`), clases ni fichajes. Los turnos no generan ni corrigen eventos de reloj.
- API owner-only para leer/guardar horario, crear/listar/cancelar turnos y consultar huecos de personal. La comprobación de solapes serializa la escritura por profesional.
- Capacidades explícitas `center.hours.manage`, `staff.shifts.manage`, `staff.shifts.read`; no las concede el comodín Admin. El resolver de identidad configurado mediante `PLATFORM_OWNER_ACTOR_ID` las añade únicamente al actor propietario, igual que `owner.panel.read`.
- Configuración muestra la pestaña «Horario y turnos» con carga, error, reintento, feedback y campos operativos de 44 px.

## Límite conocido: custodia de caja

La cobertura real de caja aparece como `incomplete`: los datos actuales registran apertura/cierre de la sesión, pero todavía no los intervalos de traspaso A39–A44. La API entrega las sesiones registradas y explica la limitación; no declara que una persona cubriese toda la sesión ni genera alertas de custodia incompletas como si fueran hechos. La vista de cobertura sí calcula los huecos de turnos asignados dentro del horario de apertura.

No incluye recurrencia de turnos, reglas laborales, asistencia, alertas basadas en fichajes ni cambios al ledger de caja/fichajes. No ejecuta migraciones en bases reales.

## Validación local

- `pnpm install --frozen-lockfile` completado; dependencias instaladas desde el lockfile.
- Suite completa en PostgreSQL sintético limpio, después de integrar #115: PASS, 829/829 (tokens 6, dominio 34, permisos 11, UI 18, auth 2, audit 3, API 369, Admin 322, Client 45, Staff 7, deploy kit 6).
- `pnpm typecheck`: PASS, 11/11 tareas.
- `pnpm build --force`: PASS, 9/9 tareas.
- API/PostgreSQL sintético después del ajuste: 369/369; tests dirigidos de A45: 4/4 PASS, repetidos sobre la misma base para comprobar que la fixture tolera reuso.
- Admin Web: suite completa PASS, 322/322; tests dirigidos de Configuración: 5/5 PASS.
- `@2j/api db:migrate`: PASS, 51 migraciones checksummed en base sintética limpia; A45 es `0053_center_hours_staff_shifts.sql`, a continuación de #115 (`0052`). No se renumeraron migraciones ya integradas.
- `git diff --check`: PASS en el head candidato.

## Pendiente de cierre

- Push del delta al mismo PR #124, CI exacto del nuevo head y re-review independiente conforme a A57 antes de cualquier decisión de merge.
- Completar el modelo de traspasos de caja A39–A44 antes de afirmar cobertura real de custodia.
