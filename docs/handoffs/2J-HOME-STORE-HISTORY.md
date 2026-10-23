# 2J-HOME-STORE-HISTORY

## Estado local

- Rama: `agent/codex/2J-HOME-STORE-HISTORY`.
- Base: `b77e144fb47d5d47bfc6318725f72f73e739903e`.
- Alcance: comprobar el consumo real del catálogo e historial de ventas desde Home y añadir regresión de interfaz. No se añadieron operaciones de compra.

## Real, simulado y pendiente

- **Real en Home:** consulta `GET /api/me/store/catalog` y `GET /api/me/store/purchases`; muestra variantes, precio, disponibilidad y tickets/ventas propios. La consulta está disponible sin cuota, conforme a D31.
- **Prototipo:** la compilación de vista previa usa productos y compras ficticios, exclusivamente con la bandera de preview.
- **No implementado:** compra/solicitud desde Home, pago y gestión de recogida o devolución por parte del cliente. La tienda presenta productos informativos y dirige la gestión al centro.
- **D49 parcial:** el endpoint actual contiene ventas de tienda, pero no un historial económico unificado con pagos de cuotas y facturas. La puerta fiscal sigue cerrada en Platform. No se inventó un endpoint ni se presentan ventas como facturas.
- **Decisión aún conflictiva:** la sección E del registro señala D31 vs D52 para compra online sin cuota. Home no activa compra online en ningún caso mientras faltan pasarela/gestión de pedidos y resolución aplicable.

## Pruebas

- Cliente: 17/17; la prueba nueva valida que Home consume los dos endpoints de Platform, presenta disponibilidad/precio e historial de ventas sin cuota y no envía mutaciones.
- API `store.test.mjs`: 8/8 en PostgreSQL local descartable de QA; cubre catálogo, stock resumido, privacidad del historial y snapshots de venta.
- Typecheck y build de `@2j/client-app`: correctos.
- La UI se probó con respuestas sintéticas contractuales. Persistencia y aislamiento se comprobaron por las pruebas de integración API en base local; no se usó staging ni producción.

## Siguiente

Platform/propietario deben resolver compra online y el conflicto D31/D52 antes de habilitar acciones de pedido. Completar D49 requiere contrato de pagos de cuotas y facturas, sujeto a la puerta fiscal.
