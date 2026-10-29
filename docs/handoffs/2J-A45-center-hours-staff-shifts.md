# Handoff 2J-A45 — horario del centro y turnos

## Estado

Implementación inicial de horario de apertura efectivo, turnos fechados asignados por el propietario y lectura de huecos de cobertura de personal. Work Home revisó el head `0f516edab22f051ab34fff77be02562b539719c7` y encontró un P1 en la serialización de horas y un P2 de cobertura al inactivar/archivar profesionales. Ambos están corregidos en el delta local actual; por el P1, se solicitará una única re-review del nuevo SHA. El PR no está fusionado ni desplegado.

## Implementado

- Migración aditiva `0053_center_hours_staff_shifts.sql`; se renumeró después de integrar #115 (0052). Mantiene `Atlantic/Canary` como zona horaria de operación.
- `center_opening_hours` permite varios intervalos semanales por día y cambios con fecha efectiva. Las sustituciones conservan las versiones anteriores, las fechas futuras y registran snapshots anterior/nuevo en `staff_audit_events`.
- `staff_shift_assignments` representa turnos concretos fechados, no disponibilidad de calendario (`staff_schedule_slots`), clases ni fichajes. Los turnos no generan ni corrigen eventos de reloj.
- API owner-only para leer/guardar horario, crear/listar/cancelar turnos y consultar huecos de personal. La comprobación de solapes serializa la escritura por profesional.
- Capacidades explícitas `center.hours.manage`, `staff.shifts.manage`, `staff.shifts.read`; no las concede el comodín Admin. El resolver de identidad configurado mediante `PLATFORM_OWNER_ACTOR_ID` las añade únicamente al actor propietario, igual que `owner.panel.read`.
- Configuración muestra la pestaña «Horario y turnos» con carga, error, reintento, feedback y campos operativos de 44 px.
- La API devuelve horas como `HH:mm`, el formato aceptado por el formulario y el validador al guardar; lectura y guardado redondo están cubiertos por prueba.
- Inactivar o archivar un profesional con turnos futuros programados devuelve `future_calendar_items_exist`; la consulta de cobertura omite profesionales no activos como defensa adicional.

## Límite conocido: custodia de caja

La cobertura real de caja aparece como `incomplete`: los datos actuales registran apertura/cierre de la sesión, pero todavía no los intervalos de traspaso A39–A44. La API entrega las sesiones registradas y explica la limitación; no declara que una persona cubriese toda la sesión ni genera alertas de custodia incompletas como si fueran hechos. La vista de cobertura sí calcula los huecos de turnos asignados dentro del horario de apertura.

No incluye recurrencia de turnos, reglas laborales, asistencia, alertas basadas en fichajes ni cambios al ledger de caja/fichajes. No ejecuta migraciones en bases reales.

## Validación local

- `pnpm install --frozen-lockfile` completado; dependencias instaladas desde el lockfile.
- `pnpm test` en PostgreSQL sintético limpio, tras integrar `origin/main`: PASS, 886/886 (tokens 6, dominio 34, permisos 11, UI 18, auth 2, audit 3, API 399, Admin 355, Client 45, Staff 7, deploy kit 6).
- `pnpm typecheck`: PASS, 11/11 tareas.
- `pnpm build --force`: PASS, 9/9 tareas.
- Migraciones checksummed verificadas por la suite API sobre base sintética limpia; A45 sigue siendo `0053_center_hours_staff_shifts.sql`. No se aplicaron migraciones a ninguna base real.
- `git diff --check`: PASS tras resolver conflictos con `origin/main`.

## Pendiente de cierre

- Push del delta y sincronización con `origin/main` al mismo PR #124; falta CI del SHA exacto y una re-review independiente, permitida porque la primera revisión encontró un P1. No fusionar hasta cerrar ambos.
- Completar el modelo de traspasos de caja A39–A44 antes de afirmar cobertura real de custodia.
