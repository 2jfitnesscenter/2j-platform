# Handoff maestro — 2J Design V2, pilotos 03 · 04 · 05

Permite a otro agente continuar sin releer la conversación. Cubre Agenda (03), Servicios + Planes (04) y Tienda (05). Los pilotos 01 (shell + Resumen) y 02 (Clientes + Cliente 360) ya están **mergeados y aprobados** (`main` @ `7392c47`).

**Regla de todos los pilotos:** funcionalidad existente + Design V2. Sin datos ni acciones inventadas, sin tocar RBAC, base de datos ni migraciones. **Ningún PR está mergeado ni autoaprobado; los tres siguen en Draft.** Cambios de backend de toda la pila: la corrección de `GET /api/calendar/sessions/:id/booking-eligibility` en #50 (ver PILOT-03) y, en #52, las **fotos de producto** (migración `0033_store_product_media`, `ObjectStorage`, endpoints multipart y `@fastify/multipart`; ver PILOT-05).

## 1. Estado de cada piloto

Los tres PR están **apilados** porque ninguno estaba mergeado al empezar el siguiente: `#50 → main`, `#51 → rama de #50`, `#52 → rama de #51`. Mergear en orden 50, 51, 52 (GitHub reajusta la base al mergear el anterior).

### PILOT-03 — Agenda
| | |
|---|---|
| TASK | `2J-DESIGN-V2-PILOT-03` (`tasks/2J-DESIGN-V2-PILOT-03.md`) |
| BRANCH | `agent/claude/2J-DESIGN-V2-PILOT-03` |
| BASE_SHA | `7392c4709c66cc131d3d3857c1a177e86f31e137` (`origin/main`, incluye PILOT-02) |
| HEAD_SHA | `0bf260048f459a4669a1b334e5a02aec1cf87e4a` |
| PR | #50 (Draft, base `main`) |
| STATUS | Draft, técnicamente listo; pendiente del propietario |
| VISUAL_STATUS / FUNCTIONAL_STATUS | `no` / `no` |
| TESTS | admin-web 254 · API 207 (suite de la pila completa) · ui 13 · tokens 5 · client-app 14 · staff-app 7 · API calendario (35 en BD limpia), todos PASS |
| BUILD / CI | PASS / PASS (push y pull_request) |
| PILOT_URLS | Admin `http://127.0.0.1:5174/#calendar` · Trainer `http://127.0.0.1:5175/#calendar` |
| Handoff / guion | `docs/handoffs/2J-DESIGN-V2-PILOT-03.md` |

- **BUGS_FOUND / FIXED (tras la prueba del propietario):**
  1. *Crear sesión* fallaba con «No se pudo completar la operación»: el API respondía 400 `validation_error` (`availabilityReason` vacío) y la UI no lo mapeaba. Ahora la excepción de disponibilidad es bajo demanda (409 `professional_availability_confirmation_required` → bloque con motivo obligatorio de ≥3 caracteres) y los errores usan códigos reales.
  2. *Capacidad contradictoria* («0 ocupadas / 8 disponibles» y «sesión completa»): bug **preexistente de backend** en `calendar.ts` (vista previa de elegibilidad): con denegación temprana por `session_started` la capacidad era `null` y se contaba como completa. Corregido en origen (solo se considera completa si la capacidad se leyó) con tests de regresión en API y UI.
  3. *Configurar horarios* rediseñado: lista + formulario + vista previa de solo lectura (sin creación por clic en cuadrícula), multidía vía `POST /api/calendar/templates/batch`, límite 50 aplicado antes de añadir, solapes lado a lado, columnas recortadas. 36 tests nuevos.
- **KNOWN_GAPS:** sin URL propia por sesión; eje horario fijo 06:00–22:00 (se amplía solo si una plantilla cae fuera); 5 colores de servicio (no 8); el resto de diálogos de Agenda conservan su marcado antiguo reskineado; las plantillas existentes no se editan (no hay PATCH): solo duplicar o archivar.
- **DEFERRED_TO_2J098:** nada propio.

### PILOT-04 — Servicios + Planes
| | |
|---|---|
| TASK | `2J-DESIGN-V2-PILOT-04` |
| BRANCH | `agent/claude/2J-DESIGN-V2-PILOT-04` |
| BASE_SHA | `0bf260048f459a4669a1b334e5a02aec1cf87e4a` (rama de PILOT-03) |
| HEAD_SHA | `b7015f1dfd437a07d3aad486ccc8266af118294e` |
| PR | #51 (Draft, base `agent/claude/2J-DESIGN-V2-PILOT-03`) |
| STATUS | Draft, técnicamente listo; pendiente del propietario |
| VISUAL_STATUS / FUNCTIONAL_STATUS | `no` / `no` |
| TESTS / BUILD / CI | PASS / PASS / PASS |
| PILOT_URLS | Admin `http://127.0.0.1:5174/#services` · Trainer `http://127.0.0.1:5175/#services` |
| Handoff / guion | `docs/handoffs/2J-DESIGN-V2-PILOT-04.md` |

- **Lenguaje final 2J (corrección posterior a la prueba):** «Espacios» → **Áreas** (ubicación) y la sección se llama **Servicios** (Servicio ≠ Área; solo copy, `area`/`areaId` intactos). El formulario de plan se reorganizó en Datos · Servicios · Frecuencia/Sesiones · Accesos · Vigencia + resumen en lenguaje natural, sin vocabulario de derechos/cuotas.
- **Bono de sesiones:** se guarda de verdad (un `service_access` generado por servicio + un `sessions_quota` compartido, vigencia opcional). **Plan recurrente nuevo:** formulario final visible (frecuencia 1–5 días/semana y Sin límite, «Mensual natural») pero **bloqueado** hasta 2J-098E; no se guarda ni como borrador (guardarlo sin la frecuencia, o como cuota semanal, falsearía la semántica). **Planes legacy:** se ven en lenguaje humano con la nota «Este plan usa el modelo anterior de cuotas.»; «Crear nueva versión» conserva sus cuotas en solo lectura.
- **BUGS_FOUND:** `Activar plan` usa `window.confirm` nativo (preexistente).
- **KNOWN_GAPS:** el formulario de servicio solo tiene nombre, área y estado (el modelo no tiene más campos); vista «Planes» solo con permiso comercial.
- **DEFERRED_TO_2J098:** vigencia automática, periodos mensuales, bolsas de sesiones (frecuencia → sesiones del periodo, p. ej. 21 laborables × 3/5 → 13), saldos, expiración y renovación iniciada por el staff. Nada de esto se calcula en el frontend. Retirar la nota legacy (`data-testid="plan-legacy-note"`) y el bloqueo del plan recurrente con 2J-098E.

### PILOT-05 — Tienda
| | |
|---|---|
| TASK | `2J-DESIGN-V2-PILOT-05` |
| BRANCH | `agent/claude/2J-DESIGN-V2-PILOT-05` |
| BASE_SHA | `b7015f1dfd437a07d3aad486ccc8266af118294e` (rama de PILOT-04) |
| HEAD_SHA | el último commit de **código** es el de «variantes en lote» (`git log --oneline -3`); después solo cambia documentación. Ver `git rev-parse agent/claude/2J-DESIGN-V2-PILOT-05` |
| PR | #52 (Draft, base `agent/claude/2J-DESIGN-V2-PILOT-04`) |
| STATUS | Draft, técnicamente listo; pendiente del propietario |
| VISUAL_STATUS / FUNCTIONAL_STATUS | `no` / `no` |
| TESTS / BUILD / CI | admin-web 254 · API 207 PASS / PASS / PASS |
| PILOT_URLS | Admin `http://127.0.0.1:5174/#store` (Trainer no tiene Tienda por capacidad) |
| Handoff / guion | `docs/handoffs/2J-DESIGN-V2-PILOT-05.md` |

- **BUGS_FOUND / FIXED (tras la prueba del propietario y la revisión final):** la venta era confusa (botón «Añadir línea» sin pedido visible ni motivo del botón gris) → «Añadir al pedido», sección **Pedido** con líneas estructuradas (producto · variante · cantidad · subtotal · Quitar) y total, validación de variante/unidades/stock (contando lo ya añadido) y motivos de «Confirmar venta» deshabilitado. Al abrir una venta nueva ya no se arrastra el cliente ni el pedido de una venta cancelada. «Member» → «Cliente»; «Tarjeta (registro interno)»; «Sin control de unidades» en vez de 0. Edición de producto/variante con `window.prompt` y anulación con `window.confirm` siguen siendo preexistentes.
- **Variantes en lote (posterior):** alta de producto con tallas XS–4XL o formatos × sabores en un formulario, venta progresiva Producto → Talla/Formato → Sabor, inventario agrupado. Sin cambios de esquema/API (formato en `size`, label derivado). Ver el handoff de Tienda.
- **Fotos de producto (posterior):** 2J-098D mínimo implementado a nivel de producto (hasta 6, la primera es la principal, multipart, almacenamiento local detrás de `ObjectStorage`). `PRODUCT_MEDIA_BACKEND=IMPLEMENTED`. Sin optimización de imágenes ni CDN ni fotos por variante.
- **KNOWN_GAPS:** sin búsqueda/filtros de catálogo (no existían); sin umbral de «pocas unidades» (el dato no existe); Member Tienda sin tocar.
- **DEFERRED_TO_2J098:** `PRODUCT_MEDIA_BACKEND=IMPLEMENTED` a nivel de producto (ver arriba). Pendiente de 098D completo: optimización/miniaturas, proveedor S3 y lectura autenticada de imágenes en producción.

## 2. Matriz de estado

| Área | Design V2 | Functional validation | Merged | Known gaps | Next dependency |
|---|---|---|---|---|---|
| Resumen | Sí (PILOT-01) | Aprobada por el propietario | Sí | Sin actividad reciente ni identidad de usuario (sin fuente en el API) | Endpoint de sesión; PP-01 |
| Clientes | Sí (PILOT-02) | Aprobada | Sí | Lista sin plan/sesiones/próxima reserva (el API no los trae) | PP-01/PP-06; datos de lista |
| Cliente 360 | Sí (PILOT-02) | Aprobada | Sí | Sin Datos/Compras/notas; sin «Vista del cliente» | PP-02; 2J-098E |
| Agenda | Sí (PILOT-03), con Configurar horarios rediseñado | Pendiente del propietario | No (#50) | Sin URL por sesión; eje horario fijo | PP-03 |
| Servicios y Áreas | Sí (PILOT-04), lenguaje final | Pendiente | No (#51) | Formulario de servicio mínimo (modelo sin más campos) | — |
| Planes | Sí (PILOT-04): bonos operativos; recurrente nuevo **bloqueado**; existentes legacy | Pendiente | No (#51) | Recurrente nuevo no se puede crear | **2J-098E** |
| Tienda | Sí (PILOT-05) | Pendiente | No (#52) | Sin imágenes (fallback); prompts nativos | 2J-098D |
| Member | **No** (fase posterior, sin empezar) | — | — | `.hub-theme` y 271 hex siguen | Aprobación de todo lo anterior |

## 3. Deuda y capacidades pendientes

**A. UI debt** — Diálogos de Agenda con marcado antiguo reskineado (migrar a `ui-modal`/`Modal`); `window.confirm`/`window.prompt` en Servicios y Tienda; 5 colores de servicio (propuesta de 8); tokens V2 aún acotados a `[data-2j-design="v2"]` (mover a `:root` al migrar Member y `staff-app`); CSS legacy restante en `styles.css` para Economía, Equipo, Noticias, Comunicación, Ajustes de avisos (sin migrar).

**B. Functional bugs** — Los hallados en la prueba del propietario están corregidos (ver cada piloto). Observación preexistente: un plan con precio base 0 € no puede venderse desde «Añadir cuota» (el importe debe ser > 0). Posible test intermitente en `clients-page.test.mjs` en CI (§6).

**C. Backend capability missing** — Imágenes de producto; identidad/rol de sesión para la barra lateral; fuente de actividad reciente; datos de plan/sesiones/próxima reserva en la lista de clientes; URL de detalle de sesión (frontend); umbral de stock bajo.

**D. Dependencias 2J-098** — 098E: vigencia automática, periodos mensuales, bolsas de sesiones (nov-2026, 21 días L–V, frecuencia 3 → `ROUND_HALF_UP(21×3/5)=13`), grants en ledger, saldo de periodo, expiración, renovación iniciada por el staff (`PLAN_ASSIGNMENT_LEGACY_FLOW=PASS` · `2J098E_PERIOD_ENTITLEMENTS=NOT_IMPLEMENTED`). 098D: media de producto. 098A: política de cancelación visible para el Member (PP-10).

**E. Propuestas de producto futuras** — PP-01/PP-06 (requiere atención), PP-02 (Vista del cliente), PP-03 (eje horario por centro), PP-04 (actividad del cliente), PP-07 (Trainer «Mis sesiones»), PP-10, PP-11a (pivote por profesional); FUTURE/DEFERRED: PP-05, PP-08, PP-09, PP-11b.

## 4. Legacy ≠ final (planes y cuotas)

Nunca presentar el modelo legacy como definitivo. En Cliente 360, Planes y la venta de cuotas la UI muestra los datos almacenados y avisa («Este plan usa el modelo anterior de cuotas.»). Los **planes recurrentes nuevos no se pueden crear** hasta 2J-098E (la frecuencia semanal no es un límite semanal; no se mapea a `period_quota`). **No se calcula nada en React** (ni sesiones ni vigencia ni periodos). El catálogo asignable devuelve `basePriceCents` como texto: los precios se normalizan a céntimos enteros y se comparan como enteros (regresión de PILOT-02).

## 5. Cómo continuar

- Revisar con los guiones de cada handoff parcial; decidir `VISUAL_APPROVED` y `FUNCTIONAL_APPROVED` por piloto (todo sigue en `no`).
- Mergear en orden #50 → #51 → #52 (los tres siguen en Draft; no se han marcado Ready). Siguiente fase propuesta: **Member V2** (migrar `.hub-theme` a tokens, DD-01/DD-06) y limpieza de UI debt; **no** empezar sin aprobación.
- Arranque local: `pnpm owner:review` (Docker). Si una pantalla sale en blanco: `pnpm owner:review:stop` y repetir (caché de Vite en Windows).
- Convenciones: una TASK por rama `agent/<agente>/<task-id>-<slug>`, commit con trailer de coautoría, PR Draft, sin merge automático; el check de `tokens.css` falla en checkouts Windows con CRLF (en CI no) — regenerar con `node packages/design-tokens/tooling/generate-css.mjs`.

## 6. Nota sobre CI

Las ejecuciones de `push` de #51 y #52 fallaron en `clients-page.test.mjs` (el fichero entero, 36–62 s) mientras las de `pull_request` pasaban. **Causa:** el foco del encabezado del Cliente 360 se aplica dentro de un `requestAnimationFrame`; con los ficheros de test en paralelo y el runner cargado superaba el 1 s por defecto de `waitFor`, y la aserción `assert.equal(document.activeElement, heading)` imprime el árbol DOM completo al fallar, lo que bloqueaba el proceso hasta el SIGTERM. **Arreglo** (commit `2c73969`, en la rama de PILOT-03 y propagado a 04 y 05): comparar por identidad (`assert.ok(a === b)`), 5 s de margen y silenciar `scrollTo` no implementado de jsdom. El código de producto no cambió. Los tests nuevos usan `=== null`/identidad para no volcar nodos DOM.
