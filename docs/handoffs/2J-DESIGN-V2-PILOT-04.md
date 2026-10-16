# Handoff — 2J-DESIGN-V2-PILOT-04 (Servicios + Planes)

Espacios, servicios y catálogo de planes en Design System V2, **sin implementar el motor 2J-098E**. Presentación únicamente: endpoints, validaciones, precios, permisos y flujos de creación/activación son los de antes.

- Base: rama apilada sobre `agenda` (`agent/claude/2J-DESIGN-V2-PILOT-03`, PR #50 sin mergear). El PR se abre contra esa rama para que el diff sea solo de este piloto.
- Estado: Draft. `VISUAL_APPROVED=no` · `FUNCTIONAL_APPROVED=no`.

## Qué cambia

| Pieza | Dónde |
|---|---|
| Página (cabecera, selector de vistas, lista de servicios, detalle, espacios, planes) | `apps/admin-web/src/services-page.tsx` + `services-v2.css` |
| Iconos | `Icon` local sustituido por Lucide (mismo API de llamada); sin glifos inline |
| Diálogos (espacio, servicio, plan/versión) | misma lógica, foco y Escape; marcado compartido `ui-modal` (botones, errores, acciones con clases `@2j/ui`) |
| CSS antiguo | −38 líneas en `styles.css` (tabla de planes, vista móvil duplicada, pestañas antiguas) |

## Diseño aplicado

- **Selector de vista** (`SegmentedControl`): Servicios · Áreas · **Planes** (solo con permiso comercial; antes «Cuotas y planes»). Una sola acción primaria por vista (Nuevo servicio / Nuevo espacio / Nuevo plan).
- **Servicios:** lista limpia (una sola, ya no tabla + lista móvil duplicadas) con icono, nombre, espacio y chip de estado (Activo/Borrador). «Sin planes vinculados» solo si es un servicio activo con `planCount = 0` y el usuario tiene permiso comercial (dato real). Detalle con espacio y estado.
- **Formulario de servicio:** nombre, área, estado — es todo lo que existe hoy. No hay duración, aforo ni «ajustes avanzados» en el modelo de servicio, así que no hay «Más opciones» que construir (la capacidad se define por sesión; la duración, en cada sesión/horario).
- **Planes** (por servicio): tarjetas en lenguaje de negocio — plan, tipo, versión, estado, **precio**, **Frecuencia**, **Vigencia**, **Servicios** — con «Detalles» (qué incluye, módulos, versión) y las acciones existentes: **Activar plan** (única acción primaria, solo en borradores), **Crear nueva versión**, **Nuevo plan**. Se evita el vocabulario interno: «Derechos» pasa a «Qué incluye».
- **Precio:** el catálogo llega de la API como texto (`"5000"`); se muestra con `Number(…)/100` y el formulario sigue en céntimos enteros (regresión de PILOT-02 intacta; test con la forma real).
- **Áreas:** tarjetas de área con sus servicios y chip de estado; archivar sigue con su flujo.
- Responsive: una columna por debajo de 1024; selector de vistas desplazable; modales como panel inferior en móvil.

## Legacy ≠ final (2J-098E)

Cada plan expandido y el formulario de plan llevan una nota neutra: *«Este plan usa el modelo de cuotas actual (legacy). La vigencia, la frecuencia y las sesiones del periodo se aplicarán con el nuevo modelo de cuotas.»* (`data-testid="plan-legacy-note"`; retirar con 2J-098E). **No se calcula nada en el frontend:** «3 accesos / semana» se muestra tal cual está almacenado (legacy `period_quota`), sin derivar sesiones mensuales ni periodos. `PLAN_ASSIGNMENT_LEGACY_FLOW=PASS` · `2J098E_PERIOD_ENTITLEMENTS=NOT_IMPLEMENTED`.

## Permisos

Sin cambios (`catalogPricingManage` del shell). Trainer sin permiso comercial: ve Servicios y Áreas, **no** la vista Planes, ni Nuevo servicio/espacio, ni pistas comerciales (test).

## Probado

Tests existentes de Servicios (16) adaptados solo en selectores/copy (tabla → tarjetas, «Planes», nombre accesible del botón de servicio) y 8 nuevos: lista y pista de configuración, selección/búsqueda, tarjetas sin vocabulario interno, sin cálculo de sesiones, activación (única primaria, endpoint real), permisos Trainer/Admin, formulario corto, estados error/vacío. Piloto local: lista, planes, detalles y diálogo de plan revisados en navegador (Admin).

## Gaps / UI debt

- `Activar plan` sigue usando `window.confirm` nativo (preexistente); migrar a `ConfirmationModal`.
- Crear/editar plan: el formulario conserva su estructura (ya agrupada en fieldsets: derechos, módulos); no se rediseñó por secciones.
- Sin «Más opciones» (no hay ajustes avanzados de servicio en el modelo).
- Pendiente de 2J-098E: vigencia automática, periodos mensuales, bolsas de sesiones, saldos, expiración y renovación iniciada por el staff.

## Prueba manual (Juanjo)

1. `pnpm owner:review`; abre http://127.0.0.1:5174/#services (Admin).
2. **Servicios:** lista con estado; busca por nombre y filtra por área; pulsa uno (se abre su detalle). Los activos sin planes muestran «Sin planes vinculados».
3. **Áreas:** tarjetas con servicios; **Nueva área** (diálogo corto).
4. **Nuevo servicio:** solo nombre, área, estado.
5. **Planes:** elige un servicio → tarjetas con precio, Frecuencia, Vigencia y Servicios. **Detalles**: qué incluye, versión, nota legacy. En un borrador, **Activar plan** (pide confirmación).
6. **Nuevo plan:** formulario conservado; ves la nota de modelo actual. Precio 50 € igual al catálogo no pide motivo (en la venta, desde Clientes).
7. **Trainer** (http://127.0.0.1:5175/#services): sin vista Planes ni botones de crear.
8. Responsive a 1024/768/390: una columna, sin scroll horizontal.

## Corrección: lenguaje final 2J en Servicios y Planes

**Terminología.** «Espacios y servicios» pasa a **Servicios** (menú) y la pantalla se titula «Servicios y planes» (Trainer: «Servicios y áreas»). La ubicación interna (El Búnker, La Sala, El Estudio) se llama **Área** en toda la UI: pestaña Áreas, «Nueva área», filtro por Área, «Área» en el detalle del servicio y bajo cada servicio del formulario de planes. Servicio ≠ Área. Solo es copy: `area`, `areaId` y la API no cambian.

**Formulario de plan (cinco bloques):** Datos del plan (nombre, precio, tipo de plan) · Servicios incluidos · Frecuencia / Sesiones (según tipo) · Accesos (Reservas, Búnker / Training, Nutrición, Health, con «Acceso a Búnker: Completo») · Vigencia, y un **Resumen** en lenguaje natural («Mensual · 3 días/semana · Fuerza funcional · 50 €», «Bono · 10 sesiones · Fuerza funcional · 60 €»). Ya no aparecen Derechos incluidos / Derecho N / Límite de sesiones / Cuota por periodo / Alcance de la cuota / Periodo móvil / Periodo de renovación del plan, ni un editor de derechos «avanzado».

- **Bono de sesiones (se guarda de verdad):** número de sesiones, vigencia opcional en días e inicio (compra / primer uso). Payload: un `service_access` **generado por cada servicio seleccionado** (el motor de reservas lo exige) + un `sessions_quota` compartido. El staff no decide ningún «acceso» a mano.
- **Plan recurrente nuevo (bloqueado hasta 2J-098E):** se muestra el formulario final (Frecuencia 1–5 días/semana y Sin límite, tipo de vigencia «Mensual natural»), con el aviso «El nuevo modelo de cuotas recurrentes se habilitará con 2J-098E.» y «Crear borrador» deshabilitado. **No se guarda ni como borrador**: hoy el backend no puede persistir la frecuencia, y guardarlo sin ella o como `period_quota` semanal cambiaría la semántica (la frecuencia semanal **no** es un límite semanal; las sesiones del periodo salen de la duración real del periodo, p. ej. 21 laborables × 3/5 → 13). No se calcula nada en el frontend.
- **Planes existentes (legacy):** se siguen viendo; «Cuota actual» muestra su cuota guardada en lenguaje humano («3 accesos / semana», «Accesos por periodo» en el detalle) y los recurrentes llevan la nota «Este plan usa el modelo anterior de cuotas.». «Crear nueva versión» conserva sus cuotas **tal cual (solo lectura)** y deja cambiar nombre, precio, servicios y accesos; los bonos «simples» (un único `sessions_quota` compartido) se editan en el formulario de bono. Nada se transforma automáticamente.

**Sin cambios:** API, BD, migraciones, motor 2J-098E (periodos, bolsas, ledger, caducidad, renovación). **Tests:** `plans-model.test.mjs` (14: A–H) y ajustes en los de servicios y menú.
