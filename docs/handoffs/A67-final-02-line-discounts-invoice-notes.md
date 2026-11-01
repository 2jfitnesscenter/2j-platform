# A67 — descuentos por línea y nota fiscal

## Alcance

- La venta de planes conserva precio final y motivo por línea, aplicando D257.
- La venta de productos permite descuento por unidad con permiso `catalog.pricing.manage`, motivo obligatorio y precio autoritativo del catálogo.
- Cada línea de producto guarda precio de lista, descuento, motivo e IGIC aplicado; la nota fiscal opcional se conserva en el documento emitido y aparece en factura y ticket.
- No se modifica la lógica fiscal de facturas emitidas ni se añaden flujos de venta de producto facturable.

## Datos y migración

Migración nueva: `0071_sale_line_discounts_invoice_notes.sql`. `0070_cash_previous_day_warning.sql` ya ocupa el prefijo 0070 en `main`; 0071 evita duplicidad. No se cambian migraciones anteriores.

## Validación

PostgreSQL sintético limpio: API 457/457. Admin Web 442/442. Typecheck 11/11 tareas; build 9/9; auditoría de dependencias con el umbral del workflow (`--audit-level high`) pasa. La migración 0071 se aplicó desde cero y el verificador detectó prefijos únicos. El escaneo de secretos y CI exacto quedan en GitHub. No se han ejecutado despliegues ni migraciones en bases reales.

## Recorrido operativo sintético

1. Fichar entrada y abrir caja con el conteo inicial: API cubierto en `cash-registers.test.mjs` y `cash-shift-reason.test.mjs`.
2. Vender un producto sintético con descuento por línea: `store.test.mjs` comprueba permiso, motivo, precio, stock, IGIC y auditoría.
3. Cerrar con conteo ciego y comprobar el movimiento del turno: `cash-registers.test.mjs` y tests D113 de `store.test.mjs`.
4. Cambiar la custodia entre profesionales, después cerrar y fichar salida: `cash-registers.test.mjs` prueba el relevo y ambos fichajes; `cash-shift-reason.test.mjs` prueba el cierre con turno ya fichado fuera.
5. Asignar cuota y reservar sesión: `services.test.mjs` y `calendar.test.mjs` prueban esos flujos con datos sintéticos.

La verificación anterior usa pruebas API automatizadas con PostgreSQL sintético; no se afirma una prueba visual manual del navegador.
