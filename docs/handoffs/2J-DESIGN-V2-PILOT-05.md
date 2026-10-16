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
