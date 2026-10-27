# Diseño A58 — dos cajas físicas y accesos rápidos en Resumen

**Estado:** propuesta de diseño; sin cambios funcionales.
**Base verificada:** `origin/main` en `5e1d6b26079228aa13c5f32e37cd75199e7c1a7b` (27-10-2026).
**Decisión:** adenda A58 y aclaración directa de Juanjo en esta tarea.

## Alcance

En la franja de accesos rápidos de Resumen, después de **Enviar mensaje**, añadir:

1. **Fichar entrada/salida**: un solo control cuyo texto/acción depende del último estado efectivo del propio fichaje; utiliza la API de Fichaje existente.
2. **Abrir caja**: elige **Búnker** o **Sala**, pide recuento de apertura por denominaciones y propone 50 EUR como referencia; siempre se guarda el recuento real.
3. **Cerrar caja**: solo para la caja que custodia la persona; pide el recuento ciego por denominaciones y nunca muestra antes el importe esperado.

Los tres accesos se declaran desde el servidor según capacidades y usan la convención actual de enlaces profundos (por ejemplo, `#timeclock?intent=toggle`, `#economics?intent=open-cash` y `#economics?intent=close-cash`). La pantalla destino consume el intent una vez y reutiliza las APIs existentes o sus extensiones mínimas; no se considera correcto simular éxito desde el cliente. La API vuelve a validar todos los permisos y el estado al ejecutar.

Al abrir una caja, la respuesta y el formulario solo contienen el registro elegido y el recuento de apertura que introduce el custodio. No se consulta ni precarga el último cierre, su recuento, el esperado o la diferencia (D111). Los 50 EUR son solo referencia informativa, nunca un valor copiado.

El backend actual construye seis acciones y las limita con `.slice(0, 6)` en `apps/api/src/dashboard.ts`; la implementación deberá retirar ese límite o elevarlo a nueve y conservar el orden A58. La interfaz debe admitir las nueve acciones sin ocultar las tres nuevas.

## Modelo propuesto

### Registro físico

Crear `economic_cash_registers` como catálogo pequeño, estable y no editable por operadores:

- `id` UUID;
- `code` único e inmutable: `bunker` / `sala`;
- `name`: `Búnker` / `Sala`;
- `active`, `created_at`.

La migración inserta exactamente esos dos registros de forma idempotente. No se permite borrar un registro con historia.

### Jornada por caja

`economic_cash_sessions` pasa a representar la jornada de una caja física, no la caja global del centro. Añadir `register_id` FK y usarlo para:

- permitir una sesión abierta por registro;
- permitir Búnker y Sala abiertas a la vez;
- permitir como máximo una sesión por registro y día local;
- mantener las cuentas de apertura, expectativa, cierre y diferencia separadas por registro.

El índice global actual `economic_cash_one_open_session` se sustituye por unicidad parcial de sesión abierta por `register_id`. El `cash_session_id` ya presente en `economic_transactions`, `economic_cash_adjustments`, `store_sales` y `store_sale_cash_movements` determina el registro mediante la sesión; así todos los cobros, pagos, reembolsos, anulaciones, gastos y retiradas mantienen una dimensión de registro sin duplicar claves. Las transferencias bancarias validadas sin caja siguen respetando D102.

**Historia anterior:** las sesiones ya existentes se conservan con `register_id = NULL` porque no hay dato que permita atribuirlas con seguridad a Búnker o Sala. No se asigna retrospectivamente una caja por suposición. El informe las presenta como histórico sin clasificar; un turno abierto heredado exige resolución del propietario antes de nuevas operaciones, conforme al comportamiento de D113/A44.

Una sesión abierta heredada con `register_id = NULL` es una barrera global: ninguna apertura nueva ni movimiento económico podrá continuar hasta su resolución por el propietario. La apertura y los guards de movimiento serializan la comprobación con un bloqueo transaccional común, por lo que el índice parcial por registro no deja escapar el caso nulo. La resolución owner-only exige motivo y recuento real por denominaciones; cierra conservando `register_id = NULL`, audita y notifica al entrenador, y no crea ni corrige eventos de fichaje. Se devuelve un error explícito de “caja anterior sin asignar pendiente de resolución”.

### Custodia y traspaso

Añadir intervalos de custodia vinculados a sesión y profesional, con actor y marcas temporales auditables. Restricciones únicas parciales garantizan:

- una sola persona custodio activo por sesión/registro;
- una sola caja activa por persona.

La apertura exige fichaje activo de la persona. El traspaso es por registro, exige que el receptor esté fichado, conserva el historial de ambas personas y captura dos recuentos independientes por denominaciones. Se completa cuando ambos confirman; un descuadre queda como incidencia no bloqueante visible únicamente a `owner.panel.read`. Un traspaso no altera los importes del ledger ni el historial de fichajes.

Mientras una persona tenga una custodia activa, la API de fichaje rechaza su `clock_out`. Primero debe cerrar la caja o completar el traspaso a otra persona fichada; al confirmar cualquiera de esas operaciones se libera su intervalo de custodia. La comprobación y el cierre/traspaso bloquean las mismas filas para impedir una carrera que deje una salida registrada con la caja aún en su poder. Esta regla no inserta ni modifica horas de fichaje.

El cierre ciego almacena `counted_denominations`; el valor esperado y la diferencia solo se devuelven a `owner.panel.read`. Los recuentos de apertura, traspaso y cierre usan las 15 denominaciones validadas ya definidas en `apps/api/migrations/0048_cash_denominations.sql`.

### Regla de una caja por persona

La aclaración directa de esta tarea confirma el default que el fichero A58 adjunto aún describe como pendiente de confirmar: una persona solo custodia una caja a la vez; las dos cajas pueden estar abiertas simultáneamente si tienen custodios distintos; los traspasos se realizan caja por caja.

## Gastos y retiradas (A47/A49/A50)

Los gastos y retiradas se registran como movimientos tipados asociados a la sesión abierta del registro que custodia el actor. Requieren el permiso específico de movimiento de caja, tipo explícito, motivo obligatorio y estado de fichaje/custodia válido. El justificante/foto es opcional y su ausencia nunca bloquea el movimiento (A49).

El propietario puede configurar un límite opcional por movimiento. Su valor inicial es `NULL` (sin límite); no se inventa un valor por defecto. Si hay límite y un movimiento lo supera, se crea como solicitud pendiente y no afecta al efectivo esperado hasta aprobación explícita del propietario; aprobar/rechazar queda auditado. Para estos tipos, el esperado se calcula como: fondo de apertura + cobros en efectivo − devoluciones/anulaciones en efectivo − gastos y retiradas aprobados. Los movimientos no monetarios del POS y pagos con tarjeta mantienen la trazabilidad del turno, pero no se suman/restan del efectivo físico.

## Lectura, permisos e informes

- `billing.cash.manage`: abrir/cerrar la caja que custodia el actor, sujeto a fichaje y a estado vigente.
- Un permiso específico de movimiento de caja (propuesta: `billing.cash.adjust`) autoriza crear gastos/retiradas; el permiso actual de caja no se amplía implícitamente para este fin.
- Fichaje: usar el permiso existente `timeclock.self` (y autorización server-side de la identidad propia).
- `owner.panel.read`: única capacidad que recibe importes esperados, diferencias, descuadres de traspaso y resumen global de diferencias.
- Roles de gestión, recepción y Trainer no reciben diferencias por defecto; no se amplía el rol `admin` ni se filtran diferencias en respuestas compartidas.

La privacidad se aplica en el servidor a cada endpoint antes de leer/proyectar movimientos o calcular totales, y no se limita a ocultar controles en la UI:

- Con `owner.panel.read`, el endpoint owner-only devuelve todos los movimientos del día, el total combinado y los subtotales separados para Búnker y Sala, incluidos esperados, recuentos, diferencias e incidencias. Solo este permiso puede leer datos de ambas cajas o un filtro `register=all`.
- El resto de actores solo puede consultar su registro operativo por permiso y custodia, y únicamente sus propias operaciones (`actor_id`/autoría server-side). El filtro es doble: `register_id` permitido y actor autenticado. No reciben movimientos de custodios anteriores/alternativos del mismo registro, ni de otro registro. Para un traspaso solo reciben su propio recuento y confirmación, nunca el conteo de la contraparte.
- Staff no recibe agregados de recaudación diaria/semanal, subtotal del registro, total combinado, diferencias, esperado, recuentos de cierre ni descuadres. Los listados, exportaciones, informes, contadores, paginación y cursores se filtran por actor y registro antes de calcularlos; no se calcula un agregado global para luego ocultar campos.
- Consultar explícitamente un registro ajeno o el movimiento de otro custodio se deniega server-side. `/cash/registers` puede devolver el código/nombre y disponibilidad, más la propia custodia del actor, pero no quién custodia otra caja ni sus movimientos/importes/recuentos; nunca expone cierres previos a no propietarios.

Los informes owner-only suman las dos cajas para el total diario y conservan siempre `register_id/code` para filtrar o desglosar Búnker y Sala. Una transferencia bancaria validada sin sesión sigue respetando D102 y nunca se clasifica como efectivo de un registro.

## Migración y orden

**Candidata:** `apps/api/migrations/0055_cash_registers.sql`.

Comprobación hecha el 27-10-2026:

- `origin/main`: última migración `0052_reactivate_archived_plans.sql`;
- PR #124 abierta: `0053_center_hours_staff_shifts.sql`;
- PR #125 abierta: `0054_staff_passkey_sessions.sql`;
- revisión completa de los árboles de las 16 PR abiertas y de `origin/main`: no se encontró otra migración `0055_*.sql`.

La migración 0055 es una reserva de diseño, no se ha creado ni aplicado. Antes de implementarla se volverá a consultar `main`, PR #124/#125 y cualquier PR nueva. Se implementará después de que las migraciones 0053 y 0054 se integren o se acuerde su numeración final. Debe ser aditiva, preservando las sesiones históricas sin registro y sin tocar datos reales en este trabajo.

Orden de operaciones: crear catálogo y seed; añadir FK nullable para compatibilidad histórica; retirar la unicidad global y crear índices por registro; crear custodia/traspaso; asegurar que todos los nuevos writes requieren un registro mediante sesión válida. Cualquier sesión abierta heredada se resuelve con el procedimiento de propietario antes de aceptar cobros en las nuevas cajas.

## Secuencia de implementación posterior

1. Migración y modelo de dos registros, sesiones y custodia; reglas de apertura por fichaje y exclusión de doble custodia.
2. Traspasos por caja con recuentos independientes, doble confirmación e incidencia owner-only.
3. APIs y validaciones de cobros, devoluciones, POS, gastos/retiradas, cierre y D113 por sesión/registro; conservar D102.
4. Resumen owner-only total + desglose por caja; actualizar informes.
5. Los tres accesos de Resumen, deep links, permisos, estados y pruebas de navegación/operación.

Cada paso tendrá pruebas de concurrencia, aislamiento por registro, permisos, sesión anterior, transferencia bancaria, inmutabilidad y auditoría. La revisión independiente de Work Home o Work Búnker debe ocurrir antes de cualquier merge.

## No incluido

Este PR solo propone el diseño. No modifica código, migraciones, permisos, pantallas, datos, staging ni producción. No implementa turnos asignados ni alertas de cobertura A45, fiscalidad, nuevos métodos de pago o cambios a las reglas aprobadas D113/D111/A37–A50.
