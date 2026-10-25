# Handoff — 2J-CASH-D113

## Objetivo

Aplicar D113 en las rutas de cobro ya existentes: cualquier cobro confirmado requiere un turno de caja abierto y queda vinculado a ese turno. No cambia la autoridad económica de Platform ni crea movimientos manuales de caja.

## Alcance de esta entrega

- Cobros de cargos, pagos iniciales de asignaciones y validación de justificantes requieren caja abierta, cualquiera que sea el método de pago.
- Las ventas POS pagadas requieren turno abierto y quedan asociadas a `economic_cash_sessions`; las ventas en efectivo se incluyen en el efectivo esperado del cierre.
- La API mantiene el rechazo transaccional si no hay turno. Los reintentos idempotentes de una operación ya confirmada conservan su respuesta.
- Se añaden pruebas de API/PostgreSQL y una comprobación de la restricción de Store.
- El fixture E2E de Platform abre una caja sintética antes de registrar los pagos de sus escenarios; no modifica el repo ni el runtime de Búnker.

## Límites conocidos

Esta PR no completa la experiencia de caja. La pantalla Admin existente sigue siendo parcial; falta la operación de caja en Staff, conteo ciego de apertura/cierre, explicación obligatoria de diferencias, validación de Admin, cambio de turno D112, aviso de salida D114 e informe diario completo. Esas piezas requieren entregas separadas. No se adoptan `CashMovement`, entradas/salidas manuales ni gastos (D98).

La migración `0046_store_sales_cash_session.sql` es código pendiente de revisión; no se ha aplicado a ninguna base de datos real.

## Validación

Base local: `519e5c127ed099e84af96d8531fea76c2a7c703b`.

- Suite completa: 632/632 PASS — design-tokens 6, domain 34, permissions 9, ui 18, auth 2, audit 3, API/PostgreSQL 316, Admin Web 186, Client App 45, Staff App 7, deploy-kit 6.
- API/PostgreSQL ejecutada en una base sintética nueva; migraciones verificadas: 46/46 con checksum.
- Typecheck: 11/11 tareas PASS.
- Build forzado: 9/9 tareas PASS.
- `pnpm audit --audit-level high`: PASS (10 avisos detectados: 6 bajos y 4 moderados; ninguno de severidad alta según el umbral ejecutado).
- `git diff --check`: PASS.
- Este cambio no se ha desplegado y no se ha aplicado ninguna migración a una base real.

El lint no se ejecutó: el repositorio no define un script raíz de lint y su workflow `quality` tampoco lo ejecuta. Tras publicar, registrar aquí los checks de CI del SHA exacto; eso no implica despliegue ni aprobación de producción.
