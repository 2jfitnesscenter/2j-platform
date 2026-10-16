# Handoff maestro — 2J Design V2, pilotos 03 · 04 · 05

Permite a otro agente continuar sin releer la conversación. Cubre Agenda (03), Servicios + Planes (04) y Tienda (05). Los pilotos 01 (shell + Resumen) y 02 (Clientes + Cliente 360) ya están **mergeados y aprobados** (`main` @ `7392c47`).

**Regla de todos los pilotos:** funcionalidad existente + Design V2. Sin datos ni acciones inventadas, sin tocar backend, RBAC, API, base de datos ni migraciones. **Ningún PR está mergeado ni autoaprobado.**

## 1. Estado de cada piloto

Los tres PR están **apilados** porque ninguno estaba mergeado al empezar el siguiente: `#50 → main`, `#51 → rama de #50`, `#52 → rama de #51`. Mergear en orden 50, 51, 52 (GitHub reajusta la base al mergear el anterior).

### PILOT-03 — Agenda
| | |
|---|---|
| TASK | `2J-DESIGN-V2-PILOT-03` (`tasks/2J-DESIGN-V2-PILOT-03.md`) |
| BRANCH | `agent/claude/2J-DESIGN-V2-PILOT-03` |
| BASE_SHA | `7392c4709c66cc131d3d3857c1a177e86f31e137` (`origin/main`, incluye PILOT-02) |
| HEAD_SHA | `2c739696355c969c2b5a28266bd18d8281f9b43c` (incluye el endurecimiento de tests de foco; el commit de la Agenda es `bd09b80`) |
| PR | #50 (Draft, base `main`) |
| STATUS | Draft, listo para revisión del propietario |
| FILES_CHANGED | 12 (`calendar-page.tsx`, `agenda-v2.css`, `styles.css`, `main.tsx`, `calendar-v2.test.mjs`, tokens de servicio, `@2j/ui` `SegmentedControl` `disabled`/`title` + `ChevronLeft`, handoff, task) |
| VISUAL_STATUS | `VISUAL_APPROVED=no` |
| FUNCTIONAL_STATUS | `FUNCTIONAL_APPROVED=no` |
| TESTS | admin-web 129 · ui 13 · tokens 5 · client-app 14 · staff-app 7, todos PASS |
| BUILD | PASS |
| CI | PASS (push y pull_request, tras el arreglo de foco `2c73969`) |
| PILOT_URLS | Admin `http://127.0.0.1:5174/#calendar` · Trainer `http://127.0.0.1:5175/#calendar` |
| Handoff / guion | `docs/handoffs/2J-DESIGN-V2-PILOT-03.md` |

- **BUGS_FOUND:** ninguno funcional. 
- **BUGS_FIXED:** —
- **KNOWN_GAPS:** sin URL propia por sesión (`#calendar/session/{id}`; el detalle es un cajón de 40 rem en escritorio y pantalla completa <1024, abierto por estado); eje horario fijo 06:00–22:00; colores de servicio 5 (no 8); diálogos existentes reskineados con su marcado antiguo.
- **DEFERRED_TO_2J098:** nada propio. (PP-03 eje configurable y PP-11 pivote/3 días son propuestas de producto aprobadas como dirección, no de 098.)

### PILOT-04 — Servicios + Planes
| | |
|---|---|
| TASK | `2J-DESIGN-V2-PILOT-04` |
| BRANCH | `agent/claude/2J-DESIGN-V2-PILOT-04` |
| BASE_SHA | `2c739696355c969c2b5a28266bd18d8281f9b43c` (rama de PILOT-03) |
| HEAD_SHA | `c5ae03826ea8b16f8f1633e272c965cac504f610` (merge de 03 sobre el commit de Servicios `0194f7f`) |
| PR | #51 (Draft, base `agent/claude/2J-DESIGN-V2-PILOT-03`) |
| STATUS | Draft, listo para revisión del propietario |
| FILES_CHANGED | 9 (`services-page.tsx`, `services-v2.css`, `styles.css`, `main.tsx`, `services-page.test.mjs`, `services-v2.test.mjs`, icons, handoff, task) |
| VISUAL_STATUS / FUNCTIONAL_STATUS | `no` / `no` |
| TESTS | admin-web 137 · resto igual, PASS |
| BUILD | PASS |
| CI | PASS (push y pull_request) tras corregir una espera de foco en `clients-page.test.mjs` (ver §6) |
| PILOT_URLS | Admin `http://127.0.0.1:5174/#services` · Trainer `http://127.0.0.1:5175/#services` |
| Handoff / guion | `docs/handoffs/2J-DESIGN-V2-PILOT-04.md` |

- **BUGS_FOUND:** `Activar plan` usa `window.confirm` nativo (preexistente).
- **BUGS_FIXED:** —
- **KNOWN_GAPS:** el formulario de servicio solo tiene nombre, área y estado (no existe duración/aforo/ajustes avanzados en el modelo, por tanto no hay «Más opciones»); el formulario de plan conserva su estructura (ya con fieldsets); vista «Planes» solo con permiso comercial.
- **DEFERRED_TO_2J098:** vigencia automática, periodos mensuales, bolsas de sesiones, saldos, expiración y renovación iniciada por el staff. Los planes legacy se muestran **tal cual** («3 accesos / semana», sin derivar 13 sesiones) con una nota neutra de modelo legacy (`data-testid="plan-legacy-note"`, retirar con 2J-098E).

### PILOT-05 — Tienda
| | |
|---|---|
| TASK | `2J-DESIGN-V2-PILOT-05` |
| BRANCH | `agent/claude/2J-DESIGN-V2-PILOT-05` |
| BASE_SHA | `c5ae03826ea8b16f8f1633e272c965cac504f610` (rama de PILOT-04) |
| HEAD_SHA | el de la rama (`git rev-parse agent/claude/2J-DESIGN-V2-PILOT-05`); el commit de código de la Tienda es `091a372`, el merge con 04 y este handoff maestro vienen después (`240f592`) |
| PR | #52 (Draft, base `agent/claude/2J-DESIGN-V2-PILOT-04`) |
| STATUS | Draft, listo para revisión del propietario |
| FILES_CHANGED | 8 en el commit de código (`store-page.tsx`, `modal.tsx`, `store-v2.css`, `styles.css`, `main.tsx`, `store-page.test.mjs`, handoff, task) + este documento |
| VISUAL_STATUS / FUNCTIONAL_STATUS | `no` / `no` |
| TESTS | admin-web 144 · resto igual, PASS |
| BUILD | PASS |
| CI | PASS (push y pull_request) en `240f592`; el commit posterior solo cambia este documento |
| PILOT_URLS | Admin `http://127.0.0.1:5174/#store` (Trainer no tiene Tienda por capacidad) |
| Handoff / guion | `docs/handoffs/2J-DESIGN-V2-PILOT-05.md` |

- **BUGS_FOUND:** edición de producto/variante con `window.prompt` y anulación con `window.confirm` (preexistentes).
- **BUGS_FIXED:** —
- **KNOWN_GAPS:** sin búsqueda/filtros de catálogo (no existían); sin umbral de «pocas unidades» (el dato no existe); Member Tienda sin tocar.
- **DEFERRED_TO_2J098:** `PRODUCT_MEDIA_BACKEND=NOT_IMPLEMENTED` (imágenes y subida, 2J-098D). La tarjeta usa un fallback (icono de categoría + iniciales); la zona `.product-media` es donde irá la imagen.

## 2. Matriz de estado

| Área | Design V2 | Functional validation | Merged | Known gaps | Next dependency |
|---|---|---|---|---|---|
| Resumen | Sí (PILOT-01) | Aprobada por el propietario | Sí | Sin actividad reciente ni identidad de usuario (sin fuente en el API) | Endpoint de sesión; PP-01 |
| Clientes | Sí (PILOT-02) | Aprobada | Sí | Lista sin plan/sesiones/próxima reserva (el API no los trae) | PP-01/PP-06; datos de lista |
| Cliente 360 | Sí (PILOT-02) | Aprobada | Sí | Sin Datos/Compras/notas; sin «Vista del cliente» | PP-02; 2J-098E |
| Agenda | Sí (PILOT-03) | Pendiente del propietario | No (#50) | Sin URL por sesión; eje horario fijo | PP-03 |
| Servicios | Sí (PILOT-04) | Pendiente | No (#51) | Formulario mínimo (modelo sin más campos) | — |
| Planes | Sí (PILOT-04), **legacy** | Pendiente | No (#51) | Modelo legacy, nota visible | **2J-098E** |
| Tienda | Sí (PILOT-05) | Pendiente | No (#52) | Sin imágenes; prompts nativos | 2J-098D |
| Member | **No** (fase posterior, sin empezar) | — | — | `.hub-theme` y 271 hex siguen | Aprobación de todo lo anterior |

## 3. Deuda y capacidades pendientes

**A. UI debt** — Diálogos de Agenda con marcado antiguo reskineado (migrar a `ui-modal`/`Modal`); `window.confirm`/`window.prompt` en Servicios y Tienda; 5 colores de servicio (propuesta de 8); formulario de plan sin reorganizar por secciones; tokens V2 aún acotados a `[data-2j-design="v2"]` (mover a `:root` al migrar Member y `staff-app`); CSS legacy restante en `styles.css` para Economía, Equipo, Noticias, Comunicación, Ajustes de avisos (sin migrar).

**B. Functional bugs** — Ninguno nuevo en estos pilotos. Observación preexistente: un plan con precio base 0 € no puede venderse desde «Añadir cuota» (el importe debe ser > 0). Posible test intermitente en `clients-page.test.mjs` en CI (§6).

**C. Backend capability missing** — Imágenes de producto; identidad/rol de sesión para la barra lateral; fuente de actividad reciente; datos de plan/sesiones/próxima reserva en la lista de clientes; URL de detalle de sesión (frontend); umbral de stock bajo.

**D. Dependencias 2J-098** — 098E: vigencia automática, periodos mensuales, bolsas de sesiones (nov-2026, 21 días L–V, frecuencia 3 → `ROUND_HALF_UP(21×3/5)=13`), grants en ledger, saldo de periodo, expiración, renovación iniciada por el staff (`PLAN_ASSIGNMENT_LEGACY_FLOW=PASS` · `2J098E_PERIOD_ENTITLEMENTS=NOT_IMPLEMENTED`). 098D: media de producto. 098A: política de cancelación visible para el Member (PP-10).

**E. Propuestas de producto futuras** — PP-01/PP-06 (requiere atención), PP-02 (Vista del cliente), PP-03 (eje horario por centro), PP-04 (actividad del cliente), PP-07 (Trainer «Mis sesiones»), PP-10, PP-11a (pivote por profesional); FUTURE/DEFERRED: PP-05, PP-08, PP-09, PP-11b.

## 4. Legacy ≠ final (planes y cuotas)

Nunca presentar el modelo legacy como definitivo. En Cliente 360, Planes y la venta de cuotas la UI muestra los datos almacenados y avisa («La duración definitiva del plan se aplicará con el nuevo modelo de cuotas…»). **No se calcula nada en React** (ni sesiones ni vigencia ni periodos). El catálogo asignable devuelve `basePriceCents` como texto: los precios se normalizan a céntimos enteros y se comparan como enteros (regresión de PILOT-02).

## 5. Cómo continuar

- Revisar con los guiones de cada handoff parcial; decidir `VISUAL_APPROVED` y `FUNCTIONAL_APPROVED` por piloto (todo sigue en `no`).
- Mergear en orden #50 → #51 → #52. Siguiente fase propuesta: **Member V2** (migrar `.hub-theme` a tokens, DD-01/DD-06) y limpieza de UI debt; **no** empezar sin aprobación.
- Arranque local: `pnpm owner:review` (Docker). Si una pantalla sale en blanco: `pnpm owner:review:stop` y repetir (caché de Vite en Windows).
- Convenciones: una TASK por rama `agent/<agente>/<task-id>-<slug>`, commit con trailer de coautoría, PR Draft, sin merge automático; el check de `tokens.css` falla en checkouts Windows con CRLF (en CI no) — regenerar con `node packages/design-tokens/tooling/generate-css.mjs`.

## 6. Nota sobre CI

Las ejecuciones de `push` de #51 y #52 fallaron en `clients-page.test.mjs` (el fichero entero, 36–62 s) mientras las de `pull_request` pasaban. **Causa:** el foco del encabezado del Cliente 360 se aplica dentro de un `requestAnimationFrame`; con los ficheros de test en paralelo y el runner cargado superaba el 1 s por defecto de `waitFor`, y la aserción `assert.equal(document.activeElement, heading)` imprime el árbol DOM completo al fallar, lo que bloqueaba el proceso hasta el SIGTERM. **Arreglo** (commit `2c73969`, en la rama de PILOT-03 y propagado a 04 y 05): comparar por identidad (`assert.ok(a === b)`), 5 s de margen y silenciar `scrollTo` no implementado de jsdom. El código de producto no cambió. Los tests nuevos usan `=== null`/identidad para no volcar nodos DOM.
