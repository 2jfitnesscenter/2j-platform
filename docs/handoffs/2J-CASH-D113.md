# Handoff — 2J-CASH-D113

## Estado de este PR

Este PR cierra D113: cualquier cobro confirmado, devolución/anulación económica o venta POS pagada debe pertenecer a una caja abierta del día operativo actual. No incluye el diseño posterior de caja ni lo habilita. La base de datos es la última barrera aunque una ruta de aplicación tuviera un defecto.

### Implementado en esta rama

- Pagos, reembolsos, ventas POS pagadas, cobros iniciales de planes, anulaciones de ventas POS y ajustes de caja validan y enlazan una sesión de caja abierta de hoy.
- Anular una venta POS crea un movimiento inmutable vinculado a la sesión. Un cierre incluye el cobro y su devolución como movimientos separados y su neto efectivo. Sin caja válida, la anulación se rechaza y no cambia venta, stock ni auditoría.
- Una caja abierta de una fecha anterior bloquea cobros, apertura de otro turno y cierre ordinario. La respuesta indica que solo el propietario debe resolver la caja anterior. No se inventan horas ni eventos de fichaje (D123); la resolución auditada por propietario sigue pendiente.
- La migración `0047_cash_session_integrity.sql` protege pagos y devoluciones directamente en PostgreSQL. El `cash_session_id` nulo se permite únicamente para una transferencia validada, separada del cobro y plenamente atribuible al justificante, según D102. También protege las ventas/anulaciones POS.
- El Command Center conserva campos nulos legítimos y oculta solo `differenceCents` a quien no tenga `owner.panel.read`.
- Se retiraron las dos exclusiones basadas en el nombre del test. Hay cobertura de concurrencia cobro/cierre y pruebas en PostgreSQL desechable.

## Límite actual de `owner.panel.read` y D111

El permiso existe como capacidad explícita del contexto. El resolver de producción configurado en esta aplicación no asigna actualmente esa capacidad: el resolver predeterminado falla cerrado y las pruebas la inyectan de forma explícita. Por tanto, el acceso de propietario aún no es operable desde identidad real. **Propuesta, pendiente de implementación y revisión:** derivar el permiso solo de un vínculo de identidad de propietario único, explícito, auditable y provisionado fuera de la petición; nunca de rol `admin`, email, nombre, cabecera ni claim controlable por el cliente. Hasta que exista esa fuente autoritativa, nadie lo recibe en producción.

**D111 todavía NO está implementado.** La respuesta limita la exposición de la diferencia, pero el flujo actual no es un recuento ciego: el personal puede conocer el esperado antes del recuento. La afirmación de “diferencia exclusiva del propietario” es incompleta como control operativo hasta implementar D111 y validar el acceso del propietario.

## Decisiones A36–A50 diferidas

Después de integrar y revisar #97, se harán PR pequeños, con pruebas, para:

1. Apertura con fichaje previo, importes de apertura/cierre por denominación y recuento ciego en apertura, traspaso y cierre.
2. Traspaso entre dos profesionales fichados: conteos ciegos independientes; se completa tras ambas confirmaciones; una diferencia genera una incidencia visible solo a `owner.panel.read`, sin bloquear el traspaso.
3. Fondo de referencia de 50 €, siempre con recuento real y sin copiar automáticamente el cierre anterior.
4. Resolución de caja olvidada solo por el propietario, auditada, con motivo y recuento real, sin cambiar fichajes ni requerir presencia; notificar después al profesional.
5. Retiros y gastos permitidos bajo permiso específico y turno abierto, con tipo y motivo obligatorios. Recibo/foto opcional. Límite por movimiento configurable por el propietario, sin valor predeterminado; vacío significa sin límite y superar el valor configurado requiere aprobación del propietario. Efectivo esperado: fondo + cobros en efectivo − devoluciones/anulaciones en efectivo − retiros/gastos.
6. Vista diaria exclusiva del propietario con movimientos, denominaciones, traspasos, gastos y estado de cuadre.
7. Horario de apertura editable por el propietario; turnos de profesionales asignados por el propietario (no inferidos de clases). Las alertas de cobertura compararán horario, turnos asignados y custodia real, solo informativas para el propietario.

Ya se comprobó que `staff_schedule_slots` es disponibilidad semanal para agenda, no turnos de trabajo asignados por fecha. La propuesta de turnos/cobertura es documental y separada (PR #100); no implementar modelo ni alertas hasta aprobación del propietario. La actualización de diseño de caja de #98 debe recibir aprobación para A46–A50 antes de ejecutar esos cambios.

## Límites que permanecen

- D102: validar un justificante de transferencia no requiere turno; su asiento de pago validado mantiene `cash_session_id = NULL` por diseño.
- No hay gastos/retiros implementados en D113. La antigua regla contra movimientos manuales no debe interpretarse para anular la decisión posterior A46–A50, que aprueba gastos con controles específicos.
- No se han implementado D97, D111, traspasos, turnos asignados, cobertura, resolución del propietario, pantalla nueva de caja ni emisión de notificaciones por caja olvidada.
- Sin merge, deploy ni migraciones en bases reales.

## Validación de esta iteración

Con PostgreSQL sintético desechable y migraciones desde cero, `pnpm test` terminó **640/640 PASS**: design tokens 6, domain 34, permissions 10, UI 18, auth 2, audit 3, API/PostgreSQL 322, Admin 187, Client 45, Staff 7 y deploy-kit 6. La API incluye migración 0047, excepción D102, guardias DB, anulaciones POS, turno anterior y carrera cobro/cierre. `pnpm typecheck` pasó **11/11 tareas**; `pnpm build --force`, **9/9**; `pnpm audit --audit-level high` no encontró vulnerabilidades altas o críticas y sí reportó 10 bajas/moderadas; `git diff --check` pasó. Falta CI del head que se publicará en este PR.

PR #97 sigue abierto y no fusionado. No se ha hecho deploy ni se ha aplicado una migración a una base real.
