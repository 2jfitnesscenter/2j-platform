# Propuesta: turnos asignados y cobertura del centro

**Estado:** propuesta documental; requiere aprobación del propietario antes de implementar.
**Decisión relacionada:** A45, 25 de octubre de 2026.
**Base examinada:** `origin/main` `519e5c127ed099e84af96d8531fea76c2a7c703b`.

## Conclusión del inventario

Platform ya tiene `staff_schedule_slots`, pero no un modelo específico de turnos de trabajo asignados por fecha.

- `staff_schedule_slots` contiene profesional, día de semana, hora inicial/final y vigencia por fechas (`apps/api/migrations/0008_staff_team_timeclock.sql`; `apps/api/src/schema.ts`).
- El calendario consulta esos tramos para validar disponibilidad del profesional (`apps/api/src/calendar.ts`, `assertProfessionalAvailable`). Son reglas de disponibilidad del calendario; no identifican un turno laboral concreto ni su cobertura real.
- El API de esos tramos (`GET/POST /api/staff/:professionalId/schedule` y archivado) protege la lectura con `staff.schedule.read` y la edición con `staff.schedule.manage` (`apps/api/src/staff.ts`). El permiso actual puede concederse a roles distintos del propietario; por tanto no cumple la decisión de edición exclusiva del propietario.
- El fichaje es otro registro: `staff_timeclock_events` guarda entradas/salidas y `staff_timeclock_corrections` conserva correcciones auditadas (`apps/api/migrations/0008_staff_team_timeclock.sql`, `apps/api/src/staff.ts`). Las asignaciones de turno no deben sustituir ni modificar esos eventos.

## Diseño recomendado

### Horario de apertura del centro

Ubicar la edición en el área existente de Configuración, sección **Centro · Horario de apertura**. Añadir una configuración operativa estructurada, separada de los ajustes económicos:

- Un registro por cada intervalo de apertura semanal: día de semana, hora local de inicio y fin, vigencia desde/hasta y estado.
- Admitir varios intervalos en un día y cambios futuros con fecha efectiva; conservar los valores anteriores en auditoría.
- Interpretar las horas en `Atlantic/Canary`, con cálculo de límites locales que respete cambios de hora. El horario puede ampliarse; no se codifica en la aplicación.
- Solo el propietario puede leer/editar la configuración operativa completa. Cada alta, cambio o archivo registra actor, instante, motivo cuando corresponda y valores anterior/nuevo.

El módulo UI es Configuración; la tabla y API deben ser del dominio de operaciones del centro, no reutilizar `economic_settings`, que contiene parámetros como vencimiento, deuda y fiscalidad.

### Turnos asignados

Para la primera versión, cada fila representa un turno concreto asignado por el propietario a un profesional:

`staff_shift_assignments`

- `id`, `professional_id` (FK restrictiva), `starts_at`, `ends_at` (`timestamptz`), `local_date` derivada en `Atlantic/Canary`, `status` (`scheduled`/`cancelled`), `created_by`, `created_at`, `updated_by`, `updated_at`.
- Rechazar intervalos inválidos y solapamientos para el mismo profesional. No borrar turnos ya referenciados; cancelar o corregir con auditoría.
- Las repeticiones semanales se representan inicialmente como varias asignaciones fechadas y explícitas. No se generan desde clases, reservas ni `staff_schedule_slots`; no se introduce un motor de recurrencia antes de decidir su horizonte y excepciones.
- Registrar en `staff_audit_events` los cambios con snapshot anterior/nuevo y actor. No escribir sobre el ledger de fichajes.

Una posible evolución a plantillas semanales puede plantearse después de probar la operación diaria. La primera versión mantiene fechas y responsables explícitos para que el propietario pueda ampliar o modificar turnos sin que una clase cree obligaciones laborales implícitas.

### Cobertura y alertas

Generar una vista operativa de solo lectura para el propietario que compare:

1. intervalos de apertura configurados;
2. intervalos de turnos asignados;
3. intervalos reales de custodia de caja, derivados de aperturas, cierres y traspasos confirmados.

Mostrar por separado huecos de personal asignado y huecos de custodia de caja dentro del horario abierto. Una caja con traspaso discrepante sigue teniendo titular desde la confirmación de ambas partes; la incidencia de efectivo es visible únicamente al propietario y no bloquea la cobertura.

Las alertas no se derivan de clases y no crean ni corrigen fichajes. La propuesta no define penalizaciones, absentismo ni tolerancias de retraso. Si se añade contraste con fichajes, debe ser una comparación de lectura usando la línea temporal efectiva tras las correcciones; un turno planificado nunca implica que el profesional fichó.

## Permisos y perfiles D124

La autorización se aplica en el servidor; ocultar botones no basta. Se propone añadir capacidades explícitas:

- `center.hours.manage`: leer y modificar horario del centro, solo para el perfil del propietario.
- `staff.shifts.manage`: crear, cambiar y cancelar asignaciones, solo para el perfil del propietario.
- `staff.shifts.read`: el propietario ve todos los turnos; cada profesional puede consultar solo los suyos. No concede lectura de fichajes ni datos personales adicionales.
- `owner.panel.read`: acceso a alertas de cobertura y a discrepancias de caja, solo para el perfil del propietario.

Las capacidades exclusivas del propietario no deben heredarse del comodín Admin ni poder autoconcederse. Al implantarse perfiles configurables D124, las capacidades se asignan al perfil del propietario y el backend valida cada operación. Hasta entonces no se crea una autorización paralela basada en correo, nombre o clase.

## Relación con fichajes D115–D123

- `staff_shift_assignments` representa planificación; `staff_timeclock_events` representa hechos de entrada/salida. Son fuentes distintas y no se fusionan.
- Los fichajes reales siguen siendo hechos del profesional. Las correcciones D123 permanecen como eventos de corrección con motivo, actor, revisión e instante, sin mutar el evento original.
- Nunca se genera una entrada o salida automática al empezar/terminar un turno, al abrir/cerrar caja, ni al detectar un hueco.
- La apertura de caja exige fichaje efectivo vigente. Si el profesional mantiene caja abierta, solo puede salir tras cerrarla o traspasarla a otro profesional ya fichado. La resolución excepcional de una caja olvidada es exclusivamente del propietario, auditada, sin alterar el fichaje y con notificación posterior al profesional (A44).
- El turno esperado no se trata como fichaje; un turno sin presencia no modifica reservas ni caja. Las consecuencias operativas o laborales requieren decisiones separadas.

## Alcance y puerta de aprobación

Este PR no añade código, migraciones ni datos. No implementa turnos, horario de apertura ni alertas. Se solicita aprobar o corregir:

1. usar asignaciones concretas fechadas en V1 y dejar recurrencia automática fuera;
2. separar `staff_shift_assignments` de `staff_schedule_slots`;
3. colocar horario de apertura en Configuración y persistirlo como configuración operativa estructurada;
4. reservar gestión de horarios, turnos y alertas a capacidades explícitas del perfil propietario según D124.

Solo después de esta aprobación se prepararán PRs de implementación con migraciones y pruebas. La secuencia de caja A42–A44 continúa condicionada a que D113 (#97) esté integrado y revisado independientemente.
