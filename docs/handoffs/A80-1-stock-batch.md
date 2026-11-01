# A80-1 · Movimientos de inventario en lote

## Alcance

Añade una vía de lote sin retirar el registro individual existente. El lote aplica un tipo y un motivo comunes, filtra variantes por producto/categoría, permite introducir cantidades por fila y pegar TSV/CSV con vista previa y errores por línea. Los lotes se validan completos y se confirman en una transacción; cada movimiento conserva variante, actor, motivo y fecha. Solo «Ajuste» admite una cantidad negativa y el saldo nunca puede quedar por debajo de cero.

## Implementación

- Endpoint: `POST /api/admin/store/inventory/batch-movements`, protegido por `store.inventory.manage`.
- Migración aditiva `0074_store_inventory_batch_movements.sql`; añade los tipos `shrinkage` y `return`, mantiene las restricciones de signo y conserva las acciones de auditoría previas.
- La UI conserva el flujo de una variante y ofrece el modo «Movimiento en lote» con filtros, botones ±1, tabla adaptable y vista previa del pegado.
- La validación de todas las líneas ocurre antes de insertar; un fallo tardío revierte el lote entero.

## Validación

Base local desechable `a80_store_focus`/`a80_api_full`, nunca datos reales. Suite API enfocada de tienda: 15/15. Suite API completa: 459/459. Admin Web completo: 453/453. Typecheck del workspace: 11/11 tareas. Build del workspace: 9/9 tareas (se repetirá tras el ajuste final del endpoint). `git diff --check` limpio.

## Límites

Esta entrega no introduce un importador persistente de hojas ni cambios a ventas. La vista previa es local y el servidor vuelve a validar todas las líneas antes de escribir. Sin despliegue.
