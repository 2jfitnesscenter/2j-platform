# 2J UI PATTERNS

Patrones reutilizables de 2J Platform. Cada pantalla se compone con estos patrones; **no se inventa una variante por página**. Tokens y reglas base: [`2J-DESIGN-SYSTEM-V2.md`](2J-DESIGN-SYSTEM-V2.md). Estructura de pantallas: [`2J-SCREEN-BLUEPRINTS.md`](2J-SCREEN-BLUEPRINTS.md).

**Estado:** propuesta; ningún patrón está implementado como componente compartido (`@2j/ui` solo tiene README). Los patrones **no definen reglas de negocio**: muestran lo que el servidor decide. Donde dependen de una capacidad de 2J-098 aún sin implementar, se indica.

**Convenciones:** los textos de ejemplo son orientativos (copy final por el propietario). `permiso` = el servidor lo impone; la UI solo lo refleja.

---

## 1. Estructura de página

### 1.1 `PageHeader`
**Para qué:** título de página + contexto + acciones.
**Anatomía:** (opcional) migas/volver · **Page title** (24/32, 700) · descripción de una línea (secundaria, ≤ 1 línea) · zona de acciones a la derecha (máx. **1 primaria** + 1–2 secundarias/menú).
**Reglas:**
- Un único *eyebrow* opcional; no se repite en cada pantalla.
- La primaria cambia con el contexto, nunca hay dos primarias.
- En móvil: título arriba, acciones debajo o en menú «⋯»; la primaria queda visible.
**No:** descripciones largas, banners dentro de la cabecera, botones de igual peso.

### 1.2 `SectionHeader`
Título de sección (18/26, 600) + (opcional) texto de ayuda + enlace terciario a la derecha («Ver todo», «Ver periodos»). Separa bloques con `section-gap` 32; no usa líneas ni fondos por defecto.

### 1.3 `Tabs`
Pestañas semánticas (`role="tablist"`), flechas del teclado, seleccionada con subrayado verde 2 px + peso 600, contadores opcionales en chip pequeño. **Un solo componente** (hoy hay tres). Máx. **8** pestañas visibles; el resto, en «Más». En móvil: scroll horizontal controlado de la barra de pestañas (no de tarjetas) o selector.

### 1.4 `CardGrid`
Rejilla auto-ajustable de cards del mismo tipo: mín. 280 px de columna (Pro) / 1–2 columnas (Member). Hueco `card-gap`. Con 0 elementos → `EmptyState`; con carga → skeletons con la misma geometría.

---

## 2. Datos de un vistazo

### 2.1 `MetricStrip`
**Para qué:** 3–4 indicadores **accionables** arriba del Resumen. Solo si llevan a una acción o a una lista.
**`MetricCard`:** etiqueta (12/500, secundaria) · cifra (Display 32, `tabular-nums`) · contexto de una línea («3 con espera») · enlace a la lista filtrada · icono «ⓘ» con «cómo se calcula».
**Candidatas (Resumen profesional):** Clientes activos · Reservas hoy · Ocupación hoy · Pendiente de cobro (según permiso).
**Reglas:**
- Si un indicador no lleva a ninguna acción, **no se muestra**.
- Cada tarjeta es clicable entera (a la lista filtrada).
- Desktop 4 columnas; móvil 2×2.
- Sin gráficos decorativos ni sparklines por defecto.
- «Actualizado hace X» con botón «Actualizar» cuando son agregados (Trainin).

### 2.2 `AttentionList` / `AttentionItem` — «Requiere atención»
**Patrón estándar `Attention / Action Required`** (ADOPT de Trainin + SA). Cada elemento tiene **icono · motivo · objeto · acción**:

| Icono | Motivo | Objeto | Acción |
|---|---|---|---|
| ⚠ (danger) | Pago vencido | María Pérez | **Ver cliente** |
| ⚠ (danger) | Sesión sin entrenador | Funcional · 18:00 | **Asignar** |
| ◷ (warning) | Lista de espera alta | Pilates · 19:00 (7) | Ver sesión |
| 📄 (warning) | Documento pendiente | Carlos Ruiz | Ver documentos |
| ▢ (warning) | Producto sin stock | Proteína 2J · Chocolate | Revisar stock |
| ● (info) | Transferencia pendiente de validar | Ana León · 49 € | **Revisar pago** |

**Reglas:**
- Ordenados por urgencia (danger → warning → info), luego por antigüedad. **Máx. 5 visibles** + «Ver todo (n)».
- Cada elemento es **una línea de dos niveles** (motivo en negrita + objeto secundario) con **una sola acción**, que lleva directamente a donde se resuelve.
- **Vacío explícito:** «Todo al día. Nada requiere tu atención.» (con icono de éxito).
- Solo aparecen elementos para los que el usuario tiene permiso de acción.
- Los criterios de «atención» y sus umbrales son una decisión de producto: **PP-01** (`PRODUCT PROPOSAL FOR JUANJO`, ver el anexo de [`2J-SCREEN-BLUEPRINTS.md`](2J-SCREEN-BLUEPRINTS.md)).
- El mismo componente se reutiliza en el Resumen, en la lista de Clientes («Requiere atención») y en la cabecera del Cliente 360.

### 2.3 `ActivityFeed`
**Para qué:** actividad reciente **útil**, con **motivo y acción** (SA); nunca «Juan actualizó X».
**Elemento:** icono de evento · frase de hecho · consecuencia o contexto · hora relativa · acción opcional.

| Hecho | Consecuencia | Acción |
|---|---|---|
| María canceló Funcional de hoy | Libera 1 plaza | Ver sesión |
| Transferencia pendiente de validar | Ana León · 49 € | Revisar pago |
| Lucía entró en lista de espera | Pilates 19:00 · 3 en cola | Ver sesión |
| Compra registrada | Camiseta 2J · M · 18 € | Ver venta |

**Reglas:** 6 elementos como máximo en Resumen + «Ver toda la actividad» (sección Actividad); agrupar por día; filtrar eventos de baja señal (sin «sesión actualizada» triviales); cada elemento es un enlace.

### 2.4 `EntitlementSummary` y `PlanSummary` (staff y Member)
**La complejidad queda detrás.** Se muestra **Plan, Vigencia, Pago, Periodo actual, Sesiones**, nunca «contrato», «periodo de derecho», «ledger» ni «grant».

```
Plan                 Trimestral · 3 días/semana
Vigencia             15 oct – 14 ene
Pago                 ● Pagado
Periodo actual       1 nov – 30 nov
Sesiones             7 / 13 disponibles   ▓▓▓▓▓░░░░░░
                                          [Ver periodos]
```

- **Sesiones** = cifra grande + barra de relleno + «7 / 13» (nunca solo color).
- **Ver periodos** (terciaria) abre un `DetailDrawer`/acordeón con **Octubre · Noviembre · Diciembre · Enero**, cada uno con rango, sesiones y estado (en curso / pasado / futuro). Los sobrantes de un periodo pasado se muestran como «Caducado», sin posibilidad de traslado.
- **Pago:** chip `PAGADO` · `PENDIENTE · vence 20 oct` · `VENCIDO` (con consecuencia: «No puede reservar nuevas sesiones»).
- **Ilimitado:** «Sesiones: Ilimitadas» (sin barra ni cifras ficticias).
- **Bono:** «Caduca el 9 ene · 10 / 10 sesiones»; si no está pagado: «Se activa cuando se valida el pago».
- Depende de 2J-098E (contratos y periodos). Mientras no exista, muestra el saldo legacy sin «Ver periodos».

---

## 3. Entrada y filtrado

### 3.1 `FilterBar`
Fila bajo la cabecera: **Search** + chips/pills de filtros rápidos + botón **«Filtros (n)»** que abre un popover/panel con el resto. Reglas: máx. 4 filtros visibles en línea; el recuento de activos siempre visible; «Limpiar»; el filtro «Todas» **incluye todo** (por ejemplo, sesiones canceladas) y un filtro propio las aísla; **los contadores usan la misma colección filtrada que la lista**. Filtros persistentes en URL cuando proceda. En móvil, el panel es un *bottom sheet*.

### 3.2 `SearchBar`
Icono + `type="search"`, placeholder descriptivo («Buscar cliente por nombre, correo o teléfono»), limpiar, resultados con *debounce*; la búsqueda global usa `Ctrl/⌘K` y agrupa por tipo.

### 3.3 `StatusChip`
Chip compacto (24 px, pill) con texto (+ icono 16 opcional); mapeo de color por **urgencia** (success / warning / danger / info / neutral) del Design System §12. Nunca una card por estado. Tooltip/ayuda con el «por qué» cuando el estado es derivado (por ejemplo, ACTIVO → «Tiene un plan vigente o una reserva próxima»).

### 3.4 `AdvancedOptions`
«Más opciones» plegable al final del formulario. Detalle en Design System §10.2.

### 3.5 `ImageUploader`
Detalle en Design System §10.3: explica proporción/formato/tamaño/resolución **antes** del error; arrastrar y soltar; vista previa; progreso; la primera es la principal; hasta 6 (2J-098D); reordenar con botones accesibles; texto alternativo por imagen.

### 3.6 `PermissionAwareAction`
Una acción cuyo estado visual refleja el permiso **sin ser la autoridad**.
- **Sin permiso y sin utilidad informativa → no se pinta.**
- **Sin permiso pero útil de entender → deshabilitada con motivo** accesible («Solo un Admin puede cancelar sesiones»).
- Con permiso → normal.
- El servidor sigue rechazando (403/404); la UI maneja el rechazo con un mensaje claro y recarga de capacidades.
- Los *empty states* con CTA aplican la misma regla (sin permiso → sin CTA).
- Los alcances (`own`, `assigned`) se reflejan filtrando y rotulando («Mis sesiones»), recordando que **`Mis sesiones` es un filtro de UX, no seguridad**.

---

## 4. Contenedores y confirmación

### 4.1 `DetailDrawer`
Detalle sin perder el contexto (sesión desde Agenda, vista rápida de cliente). Derecha, 480–560 px, deep-linkable (`#calendar/session/{id}`), cierre claro, foco gestionado. **<1024 px → página completa** con «Volver». Contenido: cabecera (título, chip de estado, acción primaria) → secciones → pie con acciones secundarias.

### 4.2 `ConfirmationModal`
Para acciones de impacto o destructivas. **Enumera los efectos** (principio de TIMP): «Cancelar esta sesión: 6 reservas pasarán a *cancelada por el centro*, se restaurarán 6 sesiones y se avisará a las personas afectadas.» Pide **motivo** cuando el dominio lo exige (cancelaciones de staff — 2J-098A). Botón destructivo final en rojo, cancelar por defecto, sin confirmar con Enter por accidente. Un solo modal de confirmación (hoy hay varios).

### 4.3 `EmptyState`
**Icono suave + título + una frase de causa + CTA** (si hay permiso). Variantes: *primer uso* («Aún no hay productos» + [Crear producto]), *sin resultados* («Ningún cliente coincide con los filtros» + [Limpiar filtros]), *vacío bueno* («Todo al día»), *sin permiso* (mensaje sin CTA), *error de carga* (causa + [Reintentar]). Nunca una caja vacía.

### 4.4 `DataTable`
Ver Design System §15. Patrón de lista comparativa o administrativa; en <768 px se transforma en lista de `ClientCard`/filas.

---

## 5. Cards de dominio

### 5.1 `SessionCard` (Agenda)
**Máximo cuatro datos:** hora · servicio · ocupación · profesional si aporta.

```
┌──────────────────────┐
│ 08:00–09:00          │   hora (12/500)
│ Funcional            │   servicio (14/600)
│ 6 / 10   ▓▓▓▓▓▓░░░░  │   ocupación + relleno = aforo
└──────────────────────┘
```

- **Color = servicio** (barra izquierda de 3 px + tinte suave). **Relleno = aforo** (la barra inferior se llena; al 100 % la card muestra «Lleno»). Sin icono sin etiqueta.
- **Profesional:** se muestra (iniciales/avatar de 20 px + apellido corto) solo cuando la vista mezcla profesionales y hay espacio; en simultáneas con poco ancho, queda en el detalle.
- **Estados:** programada (normal) · en curso (borde verde fino) · llena (relleno completo + texto «Lleno») · en cola (≥1: punto info + «+2 en cola» **dentro** de la card, no pegado como pastilla) · cancelada (neutral, tachada, no cuenta en ocupación) · sin profesional (chip `danger` pequeño).
- **Simultáneas:** tarjetas reales en paralelo; si superan el número visible, las restantes van a una **lista secundaria separada** (decisión aprobada); **no hay pastilla `+1 sesión`** sobre la card; **no hay scroll horizontal** interno.
- **Click:** abre el `DetailDrawer` de la sesión. Toda la card es el objetivo.
- **No muestra:** participantes, cola completa, notas, reglas, derechos, botones.

### 5.2 `ClientCard` / fila de cliente
**Cliente · Estado · Plan · Sesiones · Próxima actividad · Atención · Entrenador (si procede).**

```
[Avatar] María Pérez            ● ACTIVO     Trimestral 3×/sem    7 / 13     Hoy 18:00 Funcional     ⚠ Pago vencido
         Cliente desde 2025      (chip)       hasta 14 ene        ▓▓▓▓░░
```

- Columnas en desktop; en móvil, card de dos líneas (nombre + chip arriba; plan · sesiones · próxima abajo; la atención como chip rojo/ámbar).
- **Atención primero:** orden por atención por defecto en la pestaña «Requiere atención»; el chip de atención lleva el **motivo visible** (`Pago vencido`, `Sin reservas 14 días`, `Documento pendiente`) para que el criterio sea transparente (debilidad de SA).
- El entrenador asignado aparece solo cuando existe esa relación (2J-098C `assigned`).
- Sin email/teléfono en la fila por defecto (datos personales bajo demanda).

### 5.3 `ProductCard` (Tienda)
**Imagen · nombre · precio · estado de stock cuando corresponda.**
- Imagen 1:1 con `object-fit: cover` (Admin) / `contain` sobre fondo `surface-subtle` si el recorte pierde producto; radio `lg`; *skeleton* mientras carga; `loading="lazy"`; ancho/alto reservados (sin saltos de maquetación).
- **Sin foto:** *fallback* elegante — fondo `surface-subtle` con icono de la categoría y las iniciales del producto; nunca una caja vacía.
- Precio: «desde 18,00 €» si hay variantes con precio distinto.
- **Stock (chip):** Admin: «Stock 12» / `POCAS UNIDADES` / `AGOTADO`. Member: solo `POCAS UNIDADES` o `AGOTADO` (sin cifras).
- Admin: añade chip `INACTIVO` y menú «⋯». Member: toda la card abre el detalle.
- Sin carrito ni checkout (la Tienda no es ecommerce).

### 5.4 `PlanCard` (catálogo de planes, Admin)
Nombre · tipo (chip: Mensual · Trimestral · Semestral · Anual · Bono · Puntual · Medio mes) · **precio** · frecuencia («3 días/semana» o «Ilimitado») · para qué servicios aplica · estado. Aviso de configuración incompleta en rojo dentro de la card («Sin servicios vinculados»). La complejidad de contratos/periodos no aparece.

### 5.5 `ServiceCard`
Nombre · área (chip) · duración · aforo · estado · **avisos de configuración** (Trainin): «Sin profesional habitual», «No hay planes vinculados». Resumen de la política en una línea («Cancelación gratuita hasta 4 h antes · tardía consume») cuando 2J-098A exista.

### 5.6 `AttentionCard`, `StatusCard`, `ActionCard`, `InfoCard`
- `AttentionCard`: elemento de `AttentionList` en formato card (cabecera del Cliente 360).
- `StatusCard`: estado derivado + explicación + enlace «Cómo funciona» (p. ej. ACTIVO).
- `ActionCard`: título + descripción + una acción (p. ej. «Completa los datos de la empresa»).
- `InfoCard`: aviso informativo/éxito/advertencia con icono, texto y acción opcional.

---

## 6. Patrones transversales

### 6.1 Barra de guardado
En editores largos (servicio, plan, producto): barra pegada al pie con «Cambios sin guardar» / «Guardado», **Guardar** (primary) y **Descartar** (ghost). Sin cambios inmediatos silenciosos.

### 6.2 Alcance de edición (serie vs ocurrencia)
Botones con alcance explícito (TIMP): **«Solo esta sesión»** · **«Esta y las siguientes»**, con recuento de afectados. Aplica a sesiones de plantilla.

### 6.3 Catálogo de notificaciones (`NotificationCatalog`)
Lista de eventos con **Evento · Descripción · Canal · Activo (switch)**.

| Evento | Descripción | Canal | Activo |
|---|---|---|---|
| Reserva confirmada | Aviso al cliente al reservar | App | ◉ |
| Sesión cancelada por el centro | Aviso a quienes tenían plaza | App | ◉ |
| Plaza liberada | Aviso de promoción desde la cola | App | ◉ |
| Pago próximo a vencer | Aviso interno | Interno | ◉ |

Cada fila con valor predeterminado marcado, descripción en lenguaje natural y agrupación por tema. No se implementa ahora (ya existen ajustes de avisos); la edición del catálogo por el centro es **PP-08**.

### 6.4 «Vista del cliente» (preview segura) — patrón conceptual
Desde el Cliente 360: acción **«Ver como cliente»** (menú «Más» o pestaña). Muestra al profesional **lo que ve ese Member en 2J**.
- **Solo lectura**, claramente enmarcada: franja superior «**Vista del cliente · solo lectura** — no actúas como María» con botón **Salir**.
- **No es suplantación:** no inicia sesión como el Member, no emite credenciales ni sesión de Member; consume los mismos datos con la autoridad del profesional.
- Controles deshabilitados (reservar, cancelar, comprar); formularios inertes.
- Respeta el **permiso** y el **alcance** del profesional; oculta lo que el profesional no podría ver.
- La visualización se **audita** («Vista del cliente abierta por X»).
- Renderizada en un marco de móvil (390 px) para ver la experiencia real.
- **PP-02 — `PRODUCT PROPOSAL FOR JUANJO`** (seguridad/arquitectura): implica endpoints de lectura de «vista Member» autorizados por staff. **No se implementa ahora.**

### 6.5 Zona horaria
Cuando el dispositivo no está en `Atlantic/Canary`, aviso descartable: «Las horas son siempre la hora de Canarias.» Las fechas límite de pago muestran «hasta el 20 oct (23:59, hora de Canarias)».

### 6.6 Estados de carga, vacío y error por patrón
Cada patrón anterior define sus tres estados; ninguna pantalla se entrega sin ellos.
