# Handoff — 2J-CASH-D113

## Estado de este PR

Este PR cierra D113 y añade el recuento ciego D111 solicitado para cerrar la revisión: cualquier cobro confirmado, devolución/anulación económica o venta POS pagada debe pertenecer a una caja abierta del día operativo actual. Apertura y cierre registran el recuento real por denominación y el servidor calcula los totales. No implementa handover, gastos ni el panel diario completo.

### Implementado en esta rama

- Pagos, reembolsos, ventas POS pagadas, cobros iniciales de planes, anulaciones de ventas POS y ajustes de caja validan y enlazan una sesión de caja abierta de hoy.
- Anular una venta POS crea un movimiento inmutable vinculado a la sesión. Un cierre incluye el cobro y su devolución como movimientos separados y su neto efectivo. Sin caja válida, la anulación se rechaza y no cambia venta, stock ni auditoría.
- Una caja abierta de una fecha anterior bloquea cobros, apertura de otro turno y cierre ordinario. La respuesta indica que solo el propietario debe resolver la caja anterior. No se inventan horas ni eventos de fichaje (D123); la resolución auditada por propietario sigue pendiente.
- La migración `0047_cash_session_integrity.sql` protege pagos y devoluciones directamente en PostgreSQL. El `cash_session_id` nulo se permite únicamente para una transferencia validada, separada del cobro y plenamente atribuible al justificante, según D102. También protege las ventas/anulaciones POS.
- El Command Center conserva campos nulos legítimos y oculta solo `differenceCents` a quien no tenga `owner.panel.read`.
- Se retiraron las dos exclusiones basadas en el nombre del test. Hay cobertura de concurrencia cobro/cierre y pruebas en PostgreSQL desechable.
- Apertura y cierre requieren cantidades enteras para las 15 denominaciones de euro. PostgreSQL conserva los desglose JSON junto a los totales en céntimos; la auditoría de apertura/cierre conserva ambos desgloses.
- La fixture sintética de la E2E Home–Platform–Búnker abre su caja enviando las 15 denominaciones en cero; no se cambió código ni datos de Búnker.
- Las respuestas de `/api/economics/cash/today`, cierre y Command Center no entregan al cajero el esperado ni los componentes que permitirían reconstruirlo. El esperado y la diferencia solo se devuelven al contexto con `owner.panel.read`.

## Asignación de `owner.panel.read` y estado de D111

El servidor admite `ownerActorId` como configuración de confianza y añade `owner.panel.read` solo si el `actorId` devuelto por el resolver autenticado coincide exactamente. En la entrada de proceso se configura mediante `PLATFORM_OWNER_ACTOR_ID`; nunca se toma de una cabecera, parámetro, email, nombre ni rol. Si no se configura o no hay un resolver autenticado que produzca ese actor, falla cerrado. El ejecutable actual mantiene su resolver predeterminado sin identidad de producción: la asignación queda preparada y probada, pero aún no es operable en producción hasta conectar la identidad real del propietario y configurar su subject estable. No se fija aquí el identificador del propietario.

**D111 queda cubierto para apertura y cierre:** se exige el recuento completo por denominaciones y el personal no recibe el efectivo esperado ni sus componentes antes de confirmar. El handover requiere su PR posterior y todavía no existe. La diferencia de cierre sigue protegida por `owner.panel.read`.

## Decisiones A36–A47 y alcance posterior

Después de integrar y revisar #97, se harán PR pequeños, con pruebas, para:

1. Apertura ligada a fichaje previo. El recuento por denominación de apertura/cierre y la ceguera previa al cierre ya están en esta rama; queda el conteo ciego del handover.
2. Traspaso entre dos profesionales fichados: conteos ciegos independientes; se completa tras ambas confirmaciones; una diferencia genera una incidencia visible solo a `owner.panel.read`, sin bloquear el traspaso.
3. Fondo de referencia de 50 €, siempre con recuento real y sin copiar automáticamente el cierre anterior.
4. Resolución de caja olvidada solo por el propietario, auditada, con motivo y recuento real, sin cambiar fichajes ni requerir presencia; notificar después al profesional.
5. Retiros y gastos permitidos bajo permiso específico y turno abierto, con tipo y motivo obligatorios. Recibo/foto opcional. Límite por movimiento configurable por el propietario, sin valor predeterminado; vacío significa sin límite y superar el valor configurado requiere aprobación del propietario. Efectivo esperado: fondo + cobros en efectivo − devoluciones/anulaciones en efectivo − retiros/gastos.
6. Vista diaria exclusiva del propietario con movimientos, denominaciones, traspasos, gastos y estado de cuadre.
7. Horario de apertura editable por el propietario; turnos de profesionales asignados por el propietario (no inferidos de clases). Las alertas de cobertura compararán horario, turnos asignados y custodia real, solo informativas para el propietario.

Ya se comprobó que `staff_schedule_slots` es disponibilidad semanal para agenda, no turnos de trabajo asignados por fecha. La propuesta de turnos/cobertura es documental y separada (PR #100); no implementar modelo ni alertas hasta aprobación del propietario. El diseño de caja #98 actualizado cubre A38–A44 y A47, aprobados por el propietario; su implementación queda posterior a integrar y revisar #97.

## Límites que permanecen

- D102: validar un justificante de transferencia no requiere turno; su asiento de pago validado mantiene `cash_session_id = NULL` por diseño.
- No hay gastos/retiros implementados en D113. La antigua regla contra movimientos manuales no debe interpretarse para anular la decisión posterior A46–A50, que aprueba gastos con controles específicos.
- No se han implementado D97, traspasos, turnos asignados, cobertura, resolución de caja olvidada, pantalla diaria del propietario ni notificaciones por caja olvidada.
- `PLATFORM_OWNER_ACTOR_ID` no sustituye a la autenticación: para una instalación real, el runtime debe proporcionar un `AuthorizationContext` autenticado con el actor estable configurado. El default actual sigue anónimo/fail-closed.
- Las sesiones anteriores a 0048 conservan `opening_denominations`/`counted_denominations` como `NULL`; la migración no inventa desglose retrospectivo. Las ventas POS anteriores a 0046 tampoco se reasignan a una caja sin evidencia histórica. La compatibilidad se verifica solo con PostgreSQL sintético, nunca con una base real.
- Sin merge, deploy ni migraciones en bases reales.

## Validación local del delta

- PostgreSQL desechable local: 48/48 migraciones verificadas desde cero; se añadió `0048_cash_denominations.sql`.
- Tests centrados en caja, tienda y Command Center: 128/128.
- Suite completa ejecutada desde base limpia: 642/642 (API 323, Admin Web 188, Client App 45, Staff App 7, paquetes y deploy kit 79).
- Typecheck: 11/11 tareas; build forzado: 9/9 tareas.
- `git diff --check`: PASS.
- `pnpm audit --audit-level high`: PASS; el informe local lista 10 vulnerabilidades de severidad baja/moderada (6 low, 4 moderate), ninguna alcanza el umbral de CI.
- CI exacto del nuevo head y secret scan están pendientes de push; no reutilizar la evidencia del head anterior `c86e89e`.
- La primera E2E posterior a D111 detectó que su fixture seguía usando `openingCents`; se corrigió para usar `openingDenominations`. La E2E debe confirmarse de nuevo en el CI del head final.
- No se ha aplicado migración a una base real.

PR #97 sigue abierto y no fusionado. No se ha hecho deploy ni se ha aplicado una migración a una base real.
