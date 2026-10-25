# Propuesta consolidada: caja, traspasos, recuentos y gastos

**Decisiones confirmadas:** A36–A45, 25 de octubre de 2026.
**Actualización solicitada para aprobación:** A46–A50.
**Referencias:** D96–D98, D110–D115, D111, D123, D124 y A36–A50.
**Estado:** propuesta documental actualizada. Las operaciones de caja posteriores requieren que D113 (#97) esté integrado y revisado independientemente, y que el propietario apruebe esta actualización antes de implementar A46–A50. Este documento no implementa funcionalidad ni autoriza merges o despliegues.

## Apertura y fondo

- Solo un profesional con fichaje de entrada efectivo puede abrir caja.
- La referencia por defecto es **50 €**. Cada día se cuenta y registra el efectivo real; el sistema nunca copia automáticamente el cierre anterior.
- Apertura, traspaso y cierre registran cantidades por denominación. El servidor calcula los totales.
- Denominaciones: monedas de 1, 2, 5, 10, 20 y 50 céntimos, 1 € y 2 €; billetes de 5 €, 10 €, 20 €, 50 €, 100 €, 200 € y 500 €.

## Traspaso de caja

- El profesional saliente y el entrante deben estar fichados. El saliente cuenta y confirma cada denominación; el entrante hace un conteo ciego independiente, sin ver el saldo esperado ni el desglose del saliente.
- Cada traspaso es un movimiento auditable propio. Se completa cuando ambas partes confirman, aunque los totales no coincidan.
- Un descuadre crea una incidencia visible únicamente para el propietario con `owner.panel.read`. No bloquea el cambio de custodio.
- Un profesional no puede fichar la salida mientras tenga una caja abierta, salvo que la cierre o la traspase a otro profesional que ya haya fichado la entrada.

## Conteo ciego y cierre

- Quien cuenta nunca ve el saldo esperado antes de confirmar. Puede introducir y confirmar su propio conteo; durante el traspaso no ve el conteo de la otra parte.
- El total esperado se calcula como fondo real de apertura + cobros en efectivo − devoluciones/anulaciones en efectivo, junto con los movimientos de caja aplicables.
- El cierre registra el conteo real por denominación y conserva el desglose. La diferencia, la explicación obligatoria y la validación administrativa siguen D97.
- Solo después de cerrar la caja el profesional puede fichar la salida.

## Resolución de una caja olvidada abierta

- Solo el propietario puede resolverla. La acción exige motivo y conteo real por denominación, y conserva actor, hora real y auditoría.
- No se modifica, completa ni retrotrae ningún evento de fichaje (D123).
- No se requiere la presencia del profesional; al resolverla se le notifica.

## Vista diaria del propietario

La vista completa requiere `owner.panel.read` y muestra los movimientos del día, desglose por denominación, traspasos, diferencias y estado equilibrado/no equilibrado. El gerente y el personal no reciben las diferencias ni el conjunto diario reservado al propietario. Los profesionales solo introducen y confirman su propio conteo; el saldo esperado permanece oculto durante el conteo ciego.

## Retiros y gastos (actualización A46–A50)

- Se permiten retiros y gastos desde la caja únicamente con un permiso específico, dentro de una sesión abierta.
- Cada movimiento exige tipo y motivo. El justificante o foto es opcional.
- Habrá un ajuste de configuración editable solo por el propietario: **límite por movimiento para aprobación**. No tendrá valor predeterminado; vacío significa que no hay límite. Si el propietario configura un importe, un movimiento superior a ese límite necesita su aprobación antes de afectar el efectivo esperado.
- El efectivo esperado se calcula como: fondo real + cobros en efectivo − devoluciones/anulaciones en efectivo − retiros/gastos aprobados.
- El panel diario del propietario muestra estos movimientos con su historial de auditoría y cualquier aprobación.
- No se recupera el modelo de `CashMovement`/entrada-salida libre. Los movimientos están tipificados, autorizados y ligados al turno.

## Horario, turnos y cobertura (A45)

- El horario de apertura es una configuración editable por el propietario y se puede ampliar; no se codifica en la aplicación. Se ubicará en el módulo existente de Configuración, en «Centro · Horario de apertura». Se recomienda guardarlo como configuración operativa estructurada y auditar cada cambio, separado de parámetros económicos.
- El propietario asigna turnos a cada profesional. No se deducen de clases ni sesiones, que pueden ser alternativas y variables.
- Las alertas comparan horario de apertura, turnos asignados e intervalos reales de custodia de caja. Solo las ve el propietario; nunca crean ni modifican fichajes.
- El inventario de `main` encontró `staff_schedule_slots`: tramos semanales de disponibilidad utilizados por el calendario, no un registro de turnos asignados por fecha. Se preparará una propuesta documental separada para definir ese modelo, su edición por el propietario y su relación con D115–D123 y D124. No se implementarán turnos ni alertas hasta aprobarla.

La configuración del posible límite de gastos pertenece a Configuración operativa con acceso exclusivo del propietario, no al horario del centro ni a la configuración económica/fiscal. Horario de apertura y turnos asignados son datos distintos; la existencia de disponibilidad semanal no sustituye al modelo de turnos.

## Secuencia acordada

Una vez que D113 (#97) esté integrado y revisado independientemente, y aprobada esta propuesta actualizada, los PRs pequeños con pruebas serán:

1. Modelo de conteo por denominación y conteo ciego en apertura y cierre.
2. Movimiento de traspaso con dos conteos ciegos independientes.
3. Vista diaria de caja exclusiva del propietario.
4. Resolución auditada por el propietario de caja olvidada abierta.
5. Gastos/retiros tipificados, con motivo, permiso, sesión abierta y umbral opcional de aprobación del propietario.

El modelo de turnos y las alertas de cobertura tienen una puerta separada: aprobación del documento de diseño de turnos. Ninguno de estos cambios amplía el alcance de D113.

## Límites preservados

- D113 (#97) conserva su alcance: cobros y devoluciones sujetos a caja abierta; validar un justificante de transferencia mantiene la excepción D102.
- Los gastos/retiros siguen los controles tipificados de A46–A50; no se habilitan movimientos genéricos de entrada/salida ni ajustes sin tipo y motivo.
- Se conservan el efectivo real, los conteos y los registros originales; no se inventan valores, eventos ni horas de fichaje.
