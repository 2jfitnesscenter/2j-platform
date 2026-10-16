# Handoff — 2J-DESIGN-V2-PILOT-05 (Tienda profesional)

Tienda profesional en Design System V2 con catálogo visual, inventario en tabla y ventas, **conservando todos los flujos existentes** (alta de producto y variante, stock, venta en el centro con idempotencia, anulación, edición, activación). Sin backend nuevo.

- Base: rama apilada sobre PILOT-04 (`agent/claude/2J-DESIGN-V2-PILOT-04`, PR #51), que a su vez cuelga de PILOT-03 (PR #50). El PR se abre contra la rama de PILOT-04.
- Estado: Draft. `VISUAL_APPROVED=no` · `FUNCTIONAL_APPROVED=no`.

## Qué cambia

| Pieza | Dónde |
|---|---|
| Página (cabecera, pestañas, catálogo, inventario, ventas, diálogos) | `apps/admin-web/src/store-page.tsx` + `store-v2.css` |
| Diálogo reutilizable (foco atrapado, Escape, devuelve el foco) | `apps/admin-web/src/modal.tsx` (visual de `@2j/ui` `ui-modal*`) |
| CSS antiguo de Tienda | −42 líneas en `styles.css` |
| Handlers, endpoints, idempotencia, mensajes | sin cambios (solo se cierra el diálogo tras éxito) |

## Diseño aplicado

- **Pestañas** Catálogo · Inventario · Ventas (`Tabs`). Una sola acción primaria por pestaña: *Añadir producto* / *Registrar stock* / *Nueva venta en el centro* (más *Añadir variante* secundaria en Catálogo).
- **Catálogo = tarjetas de producto** (no tabla): zona visual con **fallback elegante** (icono de categoría + iniciales), categoría, nombre, descripción, precio («desde X» si hay varios), stock en unidades, chips **Inactivo** / **Agotado** y acciones (Editar, Activar/Desactivar, Añadir variante). Variantes plegables con sus acciones.
- **Agotado** solo cuando todas las variantes activas llevan control de stock y están a 0. **No hay umbral de «pocas unidades»**: el dato no existe (no se inventa).
- **Inventario = tabla** (justificada: comparar y administrar): producto, variante, código, precio, stock, estado; en móvil se convierte en lista de tarjetas con etiquetas. Debajo, últimos movimientos de stock.
- **Ventas:** lista con cliente, fecha (hora de Canarias), líneas, estado como chip (*Pagada en el centro* / *Pendiente* / *Anulada*), total y **Anular y devolver stock** (solo ventas completadas, con confirmación).
- Formularios en diálogos compartidos; estados vacío, carga y error con acción (Reintentar / Añadir producto).

## Imágenes

`PRODUCT_MEDIA_BACKEND=NOT_IMPLEMENTED`: el producto del API (`id, category, name, description, active, variants`) no trae imagen y no existe subida (2J-098D). No hay uploader ni imagen falsa; la tarjeta usa el fallback. Cuando exista, la zona `.product-media` es el sitio de la imagen.

## Permisos

Sin cambios. La Tienda solo se muestra con la capacidad `store` (el menú y las rutas ya lo controlan); el Trainer por defecto no la tiene. Member no se toca (el catálogo Member sigue igual).

## Probado

9 tests (sustituyen a los 2 anteriores y conservan su cobertura): catálogo primero y diálogos a demanda; idempotencia de venta (reintento = misma clave, venta nueva = clave nueva); tarjeta con fallback y sin umbrales inventados; crear producto y variante (precio en céntimos); inventario y registro de stock; anulación con confirmación; editar/desactivar; error y vacío; foco del diálogo. Piloto: tarjetas, inventario, diálogo de stock y móvil (sin scroll horizontal) revisados.

## Gaps / UI debt

- Editar producto/variante sigue usando `window.prompt` y anular usa `window.confirm` (flujo preexistente); migrar a diálogos.
- No hay filtros ni búsqueda de catálogo (no existían).
- Sin imágenes (ver arriba), sin umbral de stock bajo, sin cálculo de totales de inventario.
- Member Tienda (catálogo visual para clientes) queda para la fase Member.

## Prueba manual (Juanjo)

1. `pnpm owner:review`; abre http://127.0.0.1:5174/#store (Admin).
2. **Catálogo:** tarjetas con precio y stock; botón verde **Añadir producto**. Abre **Variantes** de una tarjeta; prueba **Editar** y **Desactivar/Activar**.
3. **Añadir producto** → nombre/categoría → crear (diálogo se cierra, aviso verde). **Añadir variante** → producto, nombre, precio (27,50) → crear.
4. **Inventario:** tabla por variante con stock y estado; **Registrar stock** (variante, tipo, unidades, motivo). Ve el movimiento en la lista.
5. **Ventas:** **Nueva venta en el centro** → busca un Member (2+ letras), elige variante, **Añadir línea**, método y estado de pago, **Confirmar venta**. Aparece en la lista; **Anular y devolver stock** pide confirmación y restaura unidades.
6. Responsive: a 768 y 390 el inventario pasa a tarjetas; sin scroll horizontal.

## Revisión final (pulido de Tienda)

- **Terminología:** Catálogo · Inventario · Ventas; «Buscar cliente» (antes «Member»); método «Tarjeta (registro interno)» con la nota «Solo se anota el método; el cobro no se hace desde esta pantalla.»; estados de pago «Pagado en el centro» / «Pendiente» (sin «Planificado», sin pagos online).
- **Catálogo:** tarjeta con fallback intencional (icono de categoría + iniciales, sin imagen inventada), nombre, categoría, precio, stock y chip de estado (Activo / Agotado / Inactivo). `PRODUCT_MEDIA_BACKEND=NOT_IMPLEMENTED` (2J-098D).
- **Inventario:** tabla en escritorio y filas apiladas en móvil (cada celda con su etiqueta); las variantes sin control de stock dicen «Sin control de unidades», nunca 0.
- **Venta:** Cliente → Variante → Unidades → **Añadir al pedido** → **Pedido** (líneas estructuradas + total) → Estado de pago → Método → **Confirmar venta**. El botón deshabilitado explica el motivo («Elige un cliente.», «Añade al menos un producto al pedido.», «Pulsa “Añadir al pedido” para incluir la variante seleccionada (…)»). El stock se valida al añadir, contando lo ya añadido. Una venta nueva siempre empieza vacía. Idempotencia sin cambios (misma clave en reintentos y doble clic).
- **Venta real de prueba en el piloto:** Lucía Díaz · Camiseta 2J · Talla M · 1 · Pendiente · Transferencia → 201, stock 20 → 19, visible en el historial; después se **anuló** desde la propia pantalla (stock 20 de nuevo; la venta queda como «Anulada» en el historial).
- **Responsive verificado** a 1440, 1024, 768 y 390: sin scroll horizontal; catálogo en 2 columnas (1 en móvil), tabla apilada en móvil, modal y Pedido contenidos.
- **Tests:** 22 en `store-page.test.mjs` (pedido vacío, añadir, quitar, dos líneas, fusión de la misma variante, regla de Confirmar venta, stock, venta exitosa que limpia el pedido, cancelar y reabrir, doble clic, inventario sin control, tarjeta, copy en español). Permiso: la navegación de Tienda solo existe con capacidad `store` (tests de `app-shell`).

## Variantes en lote (producto → tallas / formatos / sabores)

**Auditoría del modelo (sin cambios de esquema ni de API).** Variante = `label` (visible, obligatorio), `size` (en la UI ya se llama «Talla o formato», hasta 40 caracteres), `flavor` (80), `priceCents`, `stockTracked`, `sku` (opcional, único). No hay campo `format` y **no hace falta**: el formato de Nutrición va en `size` (estructurado, necesario para elegir Formato → Sabor en la venta sin interpretar texto) y `label` se deriva. No hay endpoint batch ni unicidad por (producto, label): los duplicados se evitan en el frontend. El stock inicial no existe en el alta de variante: se registra con el movimiento real `opening` («Stock inicial») por variante. `NUTRITION_FORMAT_SCHEMA_CHANGE_REQUIRED=no`. (Propuesta futura opcional, no necesaria: columna `format` separada de `size` si algún día se quiere distinguir talla de formato en informes.)

- **Alta de producto** = producto + variantes en un solo formulario. **Merchandising:** «Tipo de variante» (Sin variantes → una variante «Estándar» / Tallas XS–4XL como chips / Variantes personalizadas). **Nutrición:** formatos (150 g … 5 kg + personalizado con unidad g, kg, ml, L, cápsulas, tabletas, sobres, unidades) × sabores opcionales.
- Labels automáticos: ropa «Talla M» (size `M`); nutrición «500 g» o «1 kg · Chocolate» (size = formato, flavor = sabor). SKU sigue vacío (opcional).
- Precio base para todas + precio propio por variante; control de stock y stock inicial por variante. Vista previa «Se crearán N variantes» con tabla editable.
- **Duplicados:** las combinaciones que ya existen (sin importar mayúsculas, acentos ni espacios, y variantes antiguas con solo label) se muestran «Esta variante ya existe.» y no se crean; las tallas existentes aparecen deshabilitadas.
- **Ejecución controlada:** POST existentes en orden, parando en el primer error e informando de lo creado; el producto no se vuelve a crear al reintentar; sin doble envío. Si falla el stock inicial de una variante, se avisa de que se creó y que se registre con «Registrar stock».
- **Añadir variantes** a un producto existente (tarjeta o botón de cabecera) usa el mismo generador.
- **Catálogo:** una tarjeta por producto con «Tallas XS · S · M…» / «Formatos 500 g · 1 kg» y «Sabores …». **Inventario:** agrupado por producto (cabecera con nº de variantes y unidades). Las variantes se muestran en orden natural (XS→4XL; 150 g→5 kg), no alfabético.
- **Venta progresiva:** Producto → Talla (ropa) / Formato → Sabor (nutrición) / Variante (personalizadas) → Unidades. Productos de una sola variante no piden más. El stock se valida por variante.
- Existentes intactas: «Camiseta 2J · Talla M» sigue vendiéndose y las ventas históricas muestran la variante exacta.
- **Prueba en el piloto:** Camiseta QA (8 tallas, stock S5 M10 L8 XL4, 3XL a 20 €) y Proteína QA (500 g/1 kg × Chocolate/Vainilla) creadas desde un formulario; venta mixta de Talla M + 1 kg Chocolate (37,90 €; stock 10→9 y 8→7), anulada después (stock restaurado) y ambos productos QA **desactivados**.
- **Tests:** `store-variants.test.mjs` (23) + ajustes en `store-page.test.mjs`.
