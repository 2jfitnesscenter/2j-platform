# Handoff — facturas y tickets en PDF (A64–A66)

Nivel 2 (datos económicos y personales, migración, permisos): necesita **una revisión independiente** de otro agente antes de fusionar. Migración **0061** (comprobada contra todos los PR abiertos: 0060 está en #153).

## Qué hace
- **Ajustes de facturación** (`economic_invoice_settings`, todo vacío al nacer, A65): emisor (nombre, NIF, dirección, CP, localidad, provincia), IGIC por defecto (3 %), serie por defecto, pie y texto legal, logo. `GET/PUT /api/economics/invoice-settings`; sin esos datos no se emite y la respuesta dice qué falta.
- **Logo** (`PUT/DELETE/GET /api/economics/invoice-settings/logo`): PNG, JPG o SVG ≤ 512 KB; el tipo se decide por los bytes; el SVG se rechaza con scripts, `foreignObject`, enlaces o imágenes externas, entidades o `on*=`. Se guarda en almacenamiento privado con clave por contenido (`invoice-logos/<sha256>.<ext>`), nunca en Git; la clave no sale al navegador.
- **Emisión** (`POST /api/economics/invoice-drafts/:id/issue` y el atajo `POST /api/economics/charges/:id/invoice`): numeración correlativa **sin huecos** (se toma el número dentro de la misma transacción; un intento rechazado no consume número), instantánea inmutable del emisor (incluido el logo), cliente, líneas, formas de pago y totales con **desglose de IGIC por tipo**. Un documento emitido no se puede modificar ni borrar (trigger existente).
- **Rectificativa** (`POST /api/economics/documents/:id/rectify`): documento nuevo con número nuevo, importes en negativo, referencia y motivo; una sola por factura; no se rectifica una rectificativa.
- **PDF** (`GET /api/economics/documents/:id/pdf?variant=a4|ticket`): A4 vertical sobre blanco, grafito con acento lima `#A4D65E`, Inter embebida (ñ, acentos y €), logo a la izquierda (o nombre del negocio si no hay), cabecera de tabla repetida en cada página, desglose por tipo de IGIC, pie y texto legal; los campos vacíos no se imprimen. Ticket compacto de 80 mm.
- **Pantallas**: Configuración → **Facturación** (datos, serie nueva, IGIC, pie, logo); botón **Factura y ticket** en los movimientos recientes de **Resumen** (solo con `billing.read-tax`), en Pagos y en la pestaña Pagos de la ficha del cliente (descargar, imprimir, ticket, emitir, rectificar). Resumen devuelve únicamente el `chargeId` necesario dentro del bloque que ya exige lectura de economía y clientes; la API de documentos vuelve a comprobar permiso.
- Permisos por perfil: lectura/descarga `billing.read-tax`; configurar, emitir y rectificar `billing.invoices.manage`.
- Se retira la puerta cerrada de `issue` (devolvía 423); el resto de la política fiscal (retención de documentos) queda como estaba.

## Pruebas (datos sintéticos únicamente)
- API contra PostgreSQL descartable en base nueva: `invoicing.test.mjs` 8/8 (PDF válido y paginación, ticket, numeración sin huecos, IGIC por tipo, inmutabilidad, snapshot del logo, rectificativa, permisos, logos no válidos) + `services.test.mjs` (paridad Drizzle/SQL) + `reports.test.mjs`.
- admin-web: `invoice-ui.test.mjs` 7/7, acceso desde Resumen con permiso concedido/denegado, ajustes, Pagos, clientes, a11y; typecheck API y web.
- Imágenes renderizadas del PDF sintético: no se suben al repositorio; se entregan aparte.

## Pendiente / límites
- Textos con texto SVG dentro del logo necesitan que el SVG lleve el texto convertido en trazados.
- Informes Excel D109 (hoja de facturas) y el resumen por IGIC del trimestre: fuera de este PR.
- No se ha desplegado nada ni se ha ejecutado la migración en ninguna base real.
