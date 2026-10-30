# Handoff — A67: muestra sintética de factura en seed de staging

## Alcance

Extiende el seed sintético ya existente para staging con un único ticket de demostración visible en la ficha económica y descargable como PDF. No modifica el flujo de emisión, no cambia reglas de facturación ni añade migraciones.

La muestra usa una serie y un número separados (`DEMO-1`), cliente, cargo, transferencia, justificante y actores sintéticos. Emisor, cliente, importe y texto son datos de demostración. El snapshot incluye `DOCUMENTO SINTÉTICO DE PRUEBA · NO VÁLIDO FISCALMENTE`; no representa una factura fiscal ni prueba un pago real. Los ajustes editables de facturación siguen vacíos. No se incluyen datos del propietario, textos legales reales, secretos ni datos reales.

La ruta del ejecutable solo incluye la muestra cuando el destino fue validado como staging (`STAGING_SEED=1`, `STAGING_SEED_HOST=2jfit.com`, ejecutor development y base aislada `2j_demo`). El helper exportado para el seed local no acepta una opción que active la muestra: la capability que habilita el ticket es privada al módulo y solo la entrega el CLI después de validar el destino. La prueba ejecuta ese CLI validado contra una base PostgreSQL desechable y verifica además que pasar la antigua opción al helper no crea documentos. La inserción ocurre dentro de la misma transacción y usa IDs fijos; la repetición conserva un solo documento y no vuelve a incrementar la serie. Si detecta una colisión o un borrador huérfano, falla sin apropiarse del número.

## Validación

- La prueba de integración usa una base PostgreSQL desechable con migraciones desde cero.
- Comprueba que el seed local mantiene cero documentos y los ajustes de emisor vacíos.
- Comprueba que solo el CLI con las variables de staging requeridas crea `DEMO-1`, mantiene el pago/justificante sintéticos coherentes, sirve el documento por la API y devuelve un PDF válido.
- Comprueba idempotencia y que el siguiente número de la serie permanece en 2 tras repetir el seed.
- Tras la revisión independiente se retiró la opción pública `includeSyntheticInvoice`; la capability ahora es privada y solo la obtiene el CLI después de validar destino y entorno.
- Prueba focal: 3/3 PASS; suite API: 439/439 PASS en PostgreSQL desechable; `pnpm typecheck`: 11/11; `pnpm build --force`: 9/9; `git diff --check`: PASS.
- No se ejecutó el comando de seed en un servidor ni se aplicaron migraciones a una base real.

## Limitación explícita

La muestra aparece como documento emitido dentro de la interfaz para permitir probar listado y descarga. Su número y su sello de no validez son exclusivamente de demostración. No se debe usar, exportar ni presentar como factura fiscal. La emisión fiscal real permanece sujeta a los campos del propietario y al flujo normal que los valida.
