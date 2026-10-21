# 2J-098 MASTER

Documento maestro del EPIC 2J-098 de 2J Platform. Es la única fuente que un agente (Claude, Codex, Gemini u otro) debe leer antes de empezar cualquier task del EPIC. Sustituye a las versiones de diseño previas (v1 y v2 de la conversación de arquitectura).

Jerarquía de autoridad del repo (ver `AGENTS.md`): instrucción actual de Juanjo > `DECISIONS_2J.md` (repo `2j-product-research`) > `RULES.md` > TASK > ADR > código. Este documento recoge decisiones del propietario y las concreta técnicamente; no las sustituye.

---

## STATUS

- Estado: **diseño consolidado v3.2. 2J-098E en integración local aislada.**
- Fecha: 2026-10-21.
- Historial: **v3.1** corrige dos consecuencias de v3 por decisión del propietario: (1) la mensualidad natural ordinaria siempre empieza el día 1 y no se asigna una vez empezado el mes (decisión T-04); (2) el fin de contrato se calcula con la función de dominio explícita `calculateContractEnd` con semántica de fin de mes (decisión T-05), sin depender de aritmética `date + interval`.
- Alcance de este documento: especificación completa de 098-0, B (agenda/waitlist/concurrencia), A (cancelaciones/no-show), C (RBAC granular), D (Tienda con imágenes) y E (cuotas/pagos/derechos).
- Cada PR del EPIC requiere revisión independiente de SHA exacto y, si hay UI visible, aceptación visual manual del propietario. Las aprobaciones de revisión y QA solo se registran cuando realmente se han hecho.
- Decisiones abiertas restantes: ver `REMAINING OPEN DECISIONS` (solo dependencias externas; ninguna bloquea 098-0).
- La integración de 2J-098E aprobada el 2026-10-21 concreta la recurrencia mensual y el prorrateo por activación tardía. Sus reglas prevalecen sobre las secciones anteriores que describían renovación exclusivamente manual, ausencia de recurrencia automática o ausencia de prorrateo de sesiones.

## 2J-098E INTEGRATION DECISIONS (2026-10-21)

This section is the current owner-approved addendum for monthly session quotas. It supersedes conflicting earlier wording in this master for this scope only.

- **Recurrence is separate from a period.** A monthly quota assignment has an explicit recurrence setting, ON or OFF, controlled by an administrator or an authorized Trainer. The setting is audited; changing it never rewrites periods or ledger history.
- **ON:** when the current period ends, the system may materialize at most one immediate next period, idempotently. The next period starts pending payment and has provisional operational access through local day 10 inclusive. It does not backfill older periods when recurrence is enabled again.
- **OFF:** the current period ends normally and no later period is materialized. A next period already created before OFF remains intact; it is not deleted or rewritten.
- **Payment remains a separate manual action.** Materializing a period does not create an economic charge or debt. Staff must create/link its charge and an authorized staff member must validate settlement. This preserves P-15's prohibition on automatic financial obligations.
- **Provisional access:** for a recurring period pending validated payment, access remains provisional through 23:59:59 on the 10th in `Atlantic/Canary`. At 00:00 on the 11th, unpaid operational access is blocked. Identity, account, routines, progress and history remain available; payment regularization and center contact remain available.
- **Late activation:** after full payment validation, the frozen session bag is calculated only from the effective local activation date through the period end, inclusive: `ROUND_HALF_UP(weekdays Monday-Friday × weekly_frequency / 5)`. Holidays are not removed. Earlier dates are excluded. The bag snapshot is never recalculated.
- **Provisional reservations:** they remain confirmed during the 1–10 grace window and count against the prorated bag when payment is validated. If those confirmed reservations exceed the prorated quantity, the period ledger may remain negative; history is preserved, no booking is removed, and the period cannot accept another reservation while its available balance is zero or negative. No penalty or debt is inferred from this condition.
- **Period bags are independent.** Consumption and restoration refer to the originating period. Unused balance expires with that period; no rollover or borrowing is allowed. Existing `period_quota` keeps its current calendar/rolling cap semantics and is not converted into a session bag.
- For this opt-in model, `weekly_frequency` belongs to the versioned `sessions_quota` plan right. Existing rights keep it `NULL` and retain legacy behavior. The first period is initialized explicitly; later periods are materialized by the worker. The worker creates no charge. Staff creates and links the charge manually, and an authorized payment validation freezes the period bag.
- **Five distinct concepts remain:** recurrence controls future period generation; a period is a date-bounded instance; a payment is a manually created/validated economic event; a bag is a frozen quantity with period-scoped ledger entries; access rights are a server-derived permission to operate.

Examples:

1. A paid recurring November period ends 30/11. With recurrence ON, one pending December period (01/12–31/12) can be generated. No December charge is created automatically.
2. If recurrence is OFF before the next materialization, November ends without a December period. If December was already generated, switching OFF keeps it and does not generate January.
3. A pending recurring November period allows provisional operational access through 10/11 23:59:59 Canary; at 11/11 00:00 an unvalidated payment blocks new operational booking.
4. If full payment is validated on 17/11 for a period ending 30/11, the bag counts only weekdays 17/11–30/11 at the frozen weekly frequency. Holidays do not affect the count.
5. November's remaining sessions expire on 30/11. December's bag cannot satisfy a November reservation or receive a November restoration.

**Integration scope:** provisional excess is recorded as a negative period balance under the approved rule above. The initial period setup, recurrence change, charge link and period state are exposed through Platform APIs; no frontend calculation or Home/Búnker integration is part of this task.

### 2J-098E implementation status (local branch)

- Migration `0033_assignment_entitlement_periods.sql` adds the opt-in versioned weekly frequency, append-only recurrence and period facts, payment-link/validation events, and a period foreign key on ledger/reservation-right records. No existing ledger entry or `period_quota` row is rewritten.
- The effective entitlement API and reservation eligibility derive access from the matching period and its validated-payment history. Recurring periods are materialized by the local Platform worker; charge creation remains a separate staff action. No frontend, Home, Búnker, Training, or 2jfitnessapp calculation was added.
- First-period initialization is an explicit Platform API operation. This integration does not provide an Admin screen for initializing periods or creating/linking later charges; the existing authorized payment flow validates a linked charge and freezes the bag.
- Verified locally on a disposable PostgreSQL database. This status describes the isolated implementation branch only; it is not a merge or production acceptance.

## BASELINE

- Repo: `2jfitnesscenter/2j-platform`. Base de diseño: `main @ 12437b6513f6c4672b9d5aa424ab8e79c395229d` (PR #45 mergeado). Migraciones existentes: `0001`–`0032`. La siguiente libre es `0033` (la numeración definitiva se asigna al mergear; los PRs paralelos se rebasan).
- Stack: Fastify 5, postgres.js, esquema Drizzle espejo, zod, pnpm/turbo, Node 24, PostgreSQL 17, migraciones con checksum, CI "Quality and security".

Hechos del repo que condicionan este diseño (verificados leyendo `main`):

| # | Hecho | Fuente |
|---|---|---|
| F-1 | `plan_rights` tiene `service_access`, `sessions_quota` (cantidad fija, saldo por **ledger**) y `period_quota` (cuota por `week`/`month`/`plan_period`). Una cuota "N días/semana" hoy se modela como `period_quota` semanal y `booking-eligibility.ts` la aplica como **tope por periodo**. | `0001_initial.sql`, `booking-eligibility.ts` |
| F-2 | `client_plan_assignments` es inmutable (trigger `client_plan_assignment_immutable`), con un `charge_id` NOT NULL y `starts_on`/`ends_on`. Renovar y cambiar plan crean **otra** asignación y un evento en la anterior. | `0016`, `0017`, `client-plans.ts` |
| F-3 | `client_entitlement_ledger` es append-only con tipos `grant`, `consume`, `restore`, `adjustment`, `expire`, clave de idempotencia única y FK `(assignment_id, client_id)`. | `0017` |
| F-4 | Consumo y restauración de derechos están atados a `sessions_quota` (`storeReservationRights`, `restoreReservationEntitlements` en `calendar.ts`). Reservar bloquea fila de sesión y fila de cliente. | `calendar.ts` |
| F-5 | Hoy el `grant` de un bono (`session_pack`) se inserta al crear la asignación ("Saldo inicial del bono"), antes de validar el pago. Verificado leyendo el código. Con el modelo nuevo, esto cambia solo para planes con término (`pack`/`one_off`); el legacy no cambia. | `client-plans.ts` (~línea 127) |
| F-6 | `economic_settings` ya tiene `due_day` (10) y `debt_blocks_new_reservations` (false). `economic_charges.due_on` es inmutable; el estado de pago se deriva de transacciones inmutables. `debtBlocksNewBooking` compara `due_on < hoy` en `Atlantic/Canary`. | `0006`, `0007`, `calendar.ts` |
| F-7 | `services.cancellation_window_minutes` (0) y `late_cancellation_policy` (`restore`) existen. `calendar_reservations` tiene `cancelled_at`/`cancelled_by`, sin motivo ni consecuencia. | `0019` |
| F-8 | La auditoría está fragmentada por dominio y varias tablas validan `action` con una lista cerrada en un CHECK (`calendar_audit_events` reescrito en varias migraciones). La outbox y `notifications` tienen `event_type`/`type` y un regex de `deeplink` cerrados. | `0004`…`0025`, `0020` |
| F-9 | No hay autenticación real de staff: `server.ts` solo admite `LOCAL_DEMO_ROLE` (loopback, `NODE_ENV=development`). | `server.ts` |
| F-10 | Los comprobantes de transferencia guardan el binario en PostgreSQL (`bytea`, ≤2 MB). La arquitectura documentada dice que los binarios van a object storage. | `0006`, `docs/architecture/domain/backend-architecture.md` |
| F-11 | `GET /api/me/sessions` ejecuta `materializeCalendarTemplates` (escritura) con un advisory lock global. | `client-app.ts`, `calendar-materializer.ts` |
| F-12 | La invariante "un profesional no se solapa" solo está en las rutas manuales (crear/editar sesión/editar ocurrencia), con advisory lock por profesional. Materializador y alta de plantillas no la comprueban contra sesiones manuales. | `calendar.ts`, `calendar-materializer.ts` |
| F-13 | El Trainer actual tiene, entre otros, `billing.debt.override`, `billing.validate_transfer`, `health.read`, `training.read`, `scheduling.override_capacity`; sin alcance por recurso. `AuthorizationContext` ya admite `deniedPermissions`. | `packages/permissions/src/index.ts` |

## PRODUCT PRINCIPLES

1. **Identidad ≠ cuota.** La persona, el perfil y el historial persisten aunque deje de pagar. Nunca se borran por impago.
2. **Reservas de Member siempre manuales:** servicio → calendario → sesión concreta → confirmación explícita. Nunca reservas recurrentes automáticas para Member.
3. **Admin y Trainer comparten shell profesional, pero no permisos.** La seguridad se impone siempre en servidor; el frontend solo refleja capacidades.
4. **Agenda aprobada visualmente:** Resumen compacto, Día/Semana, simultáneas como tarjetas reales, sin pastilla `+1 sesión`, sin scroll horizontal interno, detalle separado. No se rediseña salvo lo que exija una capacidad nueva.
5. **Sin migraciones destructivas.** No se borra historia, perfiles ni ledger.
6. **Zona horaria de negocio: `Atlantic/Canary`.** Nunca la del servidor.
7. **Tests no sustituyen la aceptación visual del propietario.**

## APPROVED OWNER DECISIONS

Todas cerradas. No se vuelven a preguntar ni se reinterpretan.

### Pagos y acceso

| ID | Decisión |
|---|---|
| P-01 | **Día 10 = último día para pagar.** El bloqueo empieza el día 11 a las 00:00 `Atlantic/Canary`. |
| P-02 | Plazo de **5 días naturales completos** desde la asignación, sin contar el día de asignación (asignada 15/10 → límite 20/10 → bloqueo 21/10 00:00). Aplica a las altas con periodo parcial en el mes actual (planes de rango parcial, p. ej. «Medio Mes») y a los planes largos. Una mensualidad natural ordinaria no se asigna una vez empezado el mes (T-04), por lo que no llega a esta regla. |
| P-03 | El pago es válido hasta 23:59:59 del día límite en `Atlantic/Canary`. |
| P-04 | **Bono:** no usa la regla del día 10. Debe estar pagado/validado para generar derechos consumibles. Su **vigencia empieza al validarse el pago** (no en la asignación) y dura su periodo propio (60/90/120 días…). El `grant` de ledger se produce, idempotente, al validar el pago. |
| P-05 | El bloqueo por impago **no cancela reservas ya confirmadas**; solo impide crear **nuevas** reservas con el derecho afectado. |
| P-06 | Sin rollover: las sesiones no usadas de un periodo caducan al terminar ese periodo. Bonos: duran hasta su caducidad propia. |
| P-07 | Planes y asignaciones nuevos pueden usar el modelo de contratos/periodos. Las asignaciones heredadas mantienen comportamiento legacy hasta renovación o migración controlada. Rollout con feature flags. |
| P-08 | **Trimestral / semestral / anual** se calculan desde su fecha de inicio con la función de dominio `calculateContractEnd` (T-05): 15/10 → 14/01, 14/04 y 14/10 del año siguiente. **Mensual** usa mes natural (1.º → último día, T-04). |
| P-09 | **Puntual** es un derecho/servicio concreto; no se convierte en mensualidad. Debe estar **pagado/validado antes** de generar o usar el derecho (sin día 10, sin deuda posterior normal). |
| P-10 | Un pago parcial **no desbloquea**. Hace falta el importe requerido completo validado. El fraccionamiento real será otro modelo. |
| P-11 | Al validarse el pago completo, la **reactivación es automática**. El override manual es solo para excepciones (p. ej. reservar con deuda vigente) y registra actor, motivo, fecha, vigencia y revocación. |
| P-12 | El impago bloquea **nuevas reservas del derecho afectado**. No bloquea login, perfil, historial, mensajes ni navegación. Búnker se rige por sus derechos propios; el bloqueo económico genérico no se le aplica hasta definir su modelo de acceso. |
| P-13 | **Trimestral / semestral / anual:** un único cargo inicial, sin fraccionamiento ni cuotas mensuales internas. Plazo de pago = asignación + 5 días naturales completos (bloqueo 00:00 del día siguiente al límite). No usan la regla del día 10. |
| P-14 | **Medio mes:** plan con periodo definido (no son obligatoriamente 1–15 / 16–fin; p. ej. 15/10–31/10). Precio, frecuencia y periodo propios. Sin prorrateo automático. Plazo = asignación + 5 días naturales. |
| P-15 | **Renovación:** la inicia el **staff**. No hay renovación económica automática ni cargos/deudas generados sin intervención humana. El diseño debe permitir después una "renovación en lote" (preparar → revisar → confirmar). |

### Cuotas, sesiones y contratos

| ID | Decisión |
|---|---|
| S-01 | La **frecuencia semanal es un parámetro comercial** para calcular la bolsa de sesiones del periodo. **No es un tope semanal**: el cliente usa las sesiones libremente dentro del periodo. |
| S-02 | `sesiones = ROUND_HALF_UP(días_lunes_a_viernes_del_periodo × frecuencia_semanal / 5)`. |
| S-03 | No se descuentan festivos ni cierres. Las compensaciones por cierre serían una acción operativa distinta. |
| S-04 | La bolsa queda **congelada** al generarse (snapshot). Las reservas nunca la recalculan. Cambiar la configuración del plan no modifica derechos ya generados. |
| S-05 | **Sin prorrateo automático.** Precio y número de sesiones están separados (el precio lo define el plan/producto; las sesiones, la fórmula). |
| S-06 | Cada mes genera un periodo nuevo con su propia bolsa y auditoría; sin trasladar sobrantes. |
| S-07 | Frecuencia configurable: **1, 2, 3, 4 o 5** días/semana. **"Ilimitado" no es 5 días/semana**: es otra modalidad de derecho, sin bolsa calculada. |
| S-08 | **Sin rollover en ningún caso, tampoco dentro de contratos largos.** Un subperiodo que termina con sesiones disponibles las pierde. |
| T-01 | **Un contrato/asignación puede contener varias bolsas mensuales independientes.** Ejemplo: trimestral 15/10–14/01 = un plan, una asignación, un cargo, **cuatro** bolsas (15/10–31/10, 01/11–30/11, 01/12–31/12, 01/01–14/01). |
| T-02 | Cada subperiodo calcula sus propios días L–V, aplica la fórmula, tiene su snapshot, su `grant`, y caduca al terminar. Prohibido "tengo 40 sesiones del trimestre y uso 30 en octubre". |
| T-03 | Cambio de plan: sin traslado automático, sin prorrateo, sin combinar bolsas. Se cierra el derecho anterior según la operación, el saldo restante puede expirar, el plan nuevo genera su estructura, y cualquier compensación es un `adjustment` manual auditado. |
| T-04 | **Mensualidad natural ordinaria:** su periodo es del día 1 al último día del mes y **siempre se inicia el día 1** (puede asignarse por adelantado: asignada el 20/10 «Mensual noviembre» → 01/11–30/11, que no es un alta parcial de octubre). Si un cliente entra con el mes ya empezado y se le quiere dar un periodo parcial, se usa un **producto específico** definido por 2J («Medio Mes · 2 días/semana», «Medio Mes · 3 días/semana» u otro plan de rango parcial) con su precio explícito. No hay prorrateo automático, no se generan derechos de días anteriores al alta y no se genera una bolsa mensual completa a quien entra con el mes avanzado. |
| T-05 | **Fin de contrato por aniversario contractual**, mediante la función de dominio explícita `calculateContractEnd(startDate, termMonths)` (ver CONTRACT MODEL). Si el inicio no es el último día de su mes: el contrato termina el día anterior al mismo día ordinal `N` meses después (15/10 + 3 → 14/01; 01/10 + 3 → 31/12). Si el inicio **es** el último día de su mes: semántica fin de mes, el contrato termina el último día del mes de destino (31/01 + 3 → 30/04; 30/11 + 3 → último día de febrero; 31/08 + 6 → último día de febrero; año bisiesto incluido). Prohibido depender de `date + interval − 1 día`. |

### Cancelaciones

| ID | Decisión |
|---|---|
| C-01 | Member no puede cancelar tras el inicio de la sesión: error de dominio `session_started`. No hay restauración por "cancelación tardía" tras el inicio. |
| C-02 | Staff autorizado sí puede corregir/cancelar una reserva tras el inicio por incidencia operativa, con **motivo, actor y consecuencia explícita**. Nunca restaura automáticamente. |
| C-03 | Sesión completa ya iniciada: cancelable por staff autorizado con incidencia real y motivo. Las reservas `attended` **no** se devuelven automáticamente; los casos excepcionales requieren override explícito y auditado. |
| C-04 | La política que ve el Member al reservar queda como **snapshot de la reserva**; cambios posteriores de política no la alteran. |
| C-05 | Si el centro cambia fecha/hora de una sesión, el Member puede cancelar sin penalización aunque la ventana normal haya expirado (marca técnica `center_rescheduled`, distinta de la cancelación tardía). |
| C-06 | Política general por defecto: cancelación permitida; ventana 4 h; tardía consume; no-show consume; cancelación por el centro restaura; el servicio hereda o sobrescribe; staff siempre registra motivo; `other` exige texto. **Los servicios existentes conservan su política actual** (herencia progresiva). |
| C-07 | Motivos: `member_request`, `client_illness`, `booking_error`, `trainer_incident`, `center_incident`, `capacity_adjustment`, `duplicate`, `other`. No se envían notas internas sensibles al Member. |

### RBAC, Tienda, Agenda

| ID | Decisión |
|---|---|
| R-01 | RBAC = **Permiso** (qué) + **Alcance** (sobre qué: `all`, `own`, `assigned`), siempre en servidor. El Admin configura qué puede hacer cada Trainer. `Mis sesiones` es UX, no seguridad. |
| R-02 | **"Mis clientes" = asignación explícita del cliente al Trainer.** No se deriva de clases dadas, reservas recientes ni historial. Modelo compatible con entrenador principal y secundarios. El alcance `assigned` se basa en esa relación. |
| R-03 | **Permisos no delegables a Trainer:** gestión de roles/permisos; creación, eliminación o promoción de Admin; configuración crítica de autenticación; configuración crítica de seguridad; auditoría global sensible; configuración fiscal/contable crítica; configuración de infraestructura; gestión del proveedor de identidad. |
| R-04 | **Plantilla inicial del Trainer = exactamente el comportamiento efectivo actual.** Sin ampliar ni recortar. Un golden test demuestra que sin configuración granular el comportamiento es el actual. |
| R-05 | No activar RBAC granular en producción hasta existir autenticación real de staff (flag apagado). No bloquea el diseño ni la construcción. |
| D-01 | Binarios de imágenes fuera de PostgreSQL; abstracción `ObjectStorage` con adaptador local y adaptador compatible con S3; metadatos en PostgreSQL; EXIF eliminado; productos antiguos sin imagen siguen funcionando. Sin ecommerce ni checkout. |
| D-02 | Imágenes **por producto** (no por variante; las variantes de un producto comparten imágenes). La arquitectura queda preparada para una futura extensión por variante, sin implementarla. |
| D-03 | **Máximo 6 imágenes por producto:** 1 principal + hasta 5 secundarias. |
| D-04 | El proveedor/hosting concreto de storage de producción **no** se cierra; no bloquea D. |
| B-01 | Restricción global de solape de profesional (spike de `EXCLUDE USING gist` antes de comprometer migración); materializador fuera del `GET` Member; worker con `job_runs`; servicio único de waitlist; promoción al aumentar capacidad; avisos al cambiar hora/profesional; versión de sesión; booking gate común. |
| B-02 | **Solapes históricos: no se corrigen automáticamente.** B-1 genera un informe READ ONLY, propone resoluciones, espera decisión humana, se corrige con operaciones explícitas y solo después se activa la restricción. La migración nunca mueve ni borra sesiones. |

## DOMAIN MODEL

Siete conceptos separados. No mezclar duración comercial del contrato con el periodo mensual de consumo.

| Concepto | Qué es | Dónde vive | Cardinalidad |
|---|---|---|---|
| **Plan / Plan version** | Plantilla comercial congelada (tipo de contrato, derechos, frecuencia, reglas de plazo) | `plans`, `plan_versions`, `plan_rights` (+ columnas nuevas) | 1 plan : N versiones |
| **Assignment** | Compra/contrato del cliente. Inmutable. | `client_plan_assignments` (+ eventos) | 1 por compra |
| **Contract term** | Duración comercial del contrato y reglas de pago congeladas | `assignment_contract_terms` (nueva) | **1:1** con la asignación |
| **Entitlement period** | Subperiodo mensual de consumo, con su bolsa congelada | `assignment_entitlement_periods` (nueva) | **N:1** con la asignación (por derecho) |
| **Entitlement ledger** | Movimientos de sesiones (grant/consume/restore/expire/adjustment) | `client_entitlement_ledger` (+ `entitlement_period_id`) | N por periodo |
| **Charge / Payment** | Obligación económica y su cobro | `economic_charges`, `economic_transactions` | **1 cargo por asignación** |
| **Access gate** | ¿Puede crear una **nueva** reserva? | Función derivada + overrides + eventos | evaluado por reserva |

Reglas estructurales:

1. **Un contrato largo NO es una bolsa única.** El contrato es uno; las bolsas son varias, una por entitlement period.
2. **El plazo de pago es `economic_charges.due_on`** (inmutable, ya existente). No hay un segundo campo de fecha límite; `assignment_contract_terms` guarda la instantánea de la regla usada, no otra fecha.
3. **El estado de acceso se deriva** (fecha límite + estado de pago del ledger económico + overrides). Los eventos son rastro de auditoría; el bloqueo no depende de que un job esté vivo.
4. **Precio ≠ derecho.** El precio vive en el plan/asignación/cargo; el número de sesiones lo calcula la fórmula.

## CONTRACT MODEL

`plan_versions.term_kind` define el tipo de contrato. `NULL` = plan legacy (sin término).

| `term_kind` | Contrato (inicio → fin) | Periodos de derecho | Cargos | Plazo de pago (`due_on`) | Bolsa |
|---|---|---|---|---|---|
| `natural_month` | **Siempre** 1.º del mes → último día del mes (`contract_start` es día 1) | 1 (el mes) | 1 | **Regla mensual** `monthly_day10_v1` | `weekday_ratio_v1` o ilimitado |
| `custom_range` (medio mes y similares) | Rango definido al asignar, dentro de los límites del plan (`max_span_days`); nunca antes de la fecha de asignación | Troceo mensual del rango | 1 | **+5 días** `grace_from_assignment_v1` | `weekday_ratio_v1` o ilimitado |
| `rolling_months` (3, 6, 12) | `inicio` → `calculateContractEnd(inicio, N)`; nunca antes de la fecha de asignación | Troceo mensual del contrato | 1 (único) | **+5 días** `grace_from_assignment_v1` | `weekday_ratio_v1` o ilimitado |
| `pack` (bono) | Sin contrato fijo hasta validar el pago | 1, creado al validar el pago | 1 | Informativo (ver abajo); acceso por activación `on_payment_v1` | cantidad fija (`fixed_v1`) |
| `one_off` (puntual) | Igual que `pack` | 1, creado al validar el pago | 1 | Igual que `pack` | cantidad fija (`fixed_v1`) |

Notas:

- **Mensualidad natural (T-04):** su `contract_start` es siempre el día 1 del mes de servicio. Una mensualidad natural **solo puede asignarse antes de que el mes empiece o el propio día 1**; asignarla con el mes ya empezado se rechaza (`natural_month_already_started`) y la interfaz propone un plan de rango parcial («Medio Mes · …») definido por 2J. Si el día 1 es festivo o domingo, se asigna por adelantado. No hay prorrateo ni bolsa mensual completa por altas avanzadas el mes.
- **Ningún contrato genera derechos de días anteriores al alta:** `contract_start ≥ fecha local de asignación` para `custom_range` y `rolling_months`; para `natural_month`, `contract_start` es el día 1 del mes de servicio, que es ≥ fecha de asignación por la regla anterior. Asignaciones retroactivas quedan fuera del EPIC.
- **Regla mensual** (`monthly_day10_v1`, solo `natural_month`), con `A` = fecha local de asignación, `S` = primer día del mes de servicio, `due_day` = 10 (en `economic_settings`):
  - `A < S` (asignada por adelantado) → `due_on = día due_day del mes de S` (asignada el 20/10 «Mensual noviembre» → 10/11).
  - `A = S` (asignada el propio día 1) → `due_on = día due_day` (el 10).
  - `A > S` → rechazado (`natural_month_already_started`).
- **`grace_from_assignment_v1`** (`custom_range`, `rolling_months`): `due_on = A + grace_days` (`grace_days` = 5 en `economic_settings`; el día de asignación no cuenta: 15/10 → 20/10; 28/10 → 02/11). Aquí se materializa el caso «alta con el mes ya empezado» del plazo de 5 días (P-02, P-14).
- **Bono y puntual:** el acceso no depende de `due_on`; no existe periodo ni `grant` hasta validar el pago. El cargo exige un `due_on` (NOT NULL), que se fija en `A + grace_days` solo como dato informativo para los listados de impagos.
- Bloqueo efectivo desde `(due_on + 1 día) 00:00` en `Atlantic/Canary`; el pago sigue siendo válido hasta `23:59:59` de `due_on`.
- **Frecuencia ilimitada** es ortogonal a `term_kind` (ver ENTITLEMENT PERIOD MODEL).

### `calculateContractEnd(startDate, termMonths)` (T-05)

Función de dominio pura, determinista, solo con `date` (sin zonas horarias ni instantes UTC) y con una gemela SQL `IMMUTABLE` (`contract_end_v1`) usada en un CHECK de `assignment_contract_terms` para `rolling_months`. Dominio de entrada: `termMonths` entero positivo (los planes usan 3, 6 y 12).

Reglas, con `T` = mes `termMonths` después del mes de `startDate`:

1. **El inicio NO es el último día de su mes (aniversario ordinal):** `aniversario = (T, día(startDate))`; si `T` no tiene ese día, el aniversario se recorta al último día de `T`. `fin = aniversario − 1 día`.
2. **El inicio ES el último día de su mes (semántica fin de mes):** `fin = último día de T`.

| Inicio | Meses | Fin | Regla |
|---|---|---|---|
| 15/10/2026 | 3 | 14/01/2027 | 1 |
| 01/10/2026 | 3 | 31/12/2026 | 1 |
| 15/10/2026 | 6 | 14/04/2027 | 1 |
| 15/10/2026 | 12 | 14/10/2027 | 1 |
| 31/01/2027 | 3 | 30/04/2027 | 2 |
| 30/11/2026 | 3 | 28/02/2027 | 2 (año no bisiesto) |
| 30/11/2027 | 3 | 29/02/2028 | 2 (año bisiesto) |
| 31/08/2026 | 6 | 28/02/2027 | 2 |
| 31/08/2027 | 6 | 29/02/2028 | 2 (año bisiesto) |
| 28/02/2027 | 12 | 29/02/2028 | 2 (28/02/2027 es fin de mes) |
| 29/11/2026 | 3 | 27/02/2027 | 1, aniversario recortado (28/02) — caso límite documentado |

Invariantes (verificadas por fuerza bruta sobre 2026–2031 con N = 3, 6 y 12):

- `fin > inicio` y la función es **no decreciente** respecto a `inicio`.
- `fin + 1 día` es el inicio natural del siguiente contrato (la renovación empieza ahí): el aniversario en la regla 1 y el **día 1** del mes siguiente al destino en la regla 2.
- Si `inicio` es fin de mes, `fin` es fin de mes.
- Sin dependencia de zona horaria ni de `date + interval`.

**Orden obligatorio:** primero se determinan `contract_start` y `contract_end` (mes natural para `natural_month`, rango explícito para `custom_range`, `calculateContractEnd` para `rolling_months`) y **solo después** se trocea el contrato en periodos de derecho.

## ENTITLEMENT PERIOD MODEL

### Tablas (propuestas; nombres sujetos a revisión en el PR)

**`assignment_contract_terms`** (1:1, inmutable)
- `assignment_id` PK/FK → `client_plan_assignments(id)`.
- `term_kind`, `contract_start date`, `contract_end date` (NULL en `pack`/`one_off`), `term_months`, `payment_rule`, `payment_block` (`enforce|off`), `deadline_computation jsonb` (regla, fecha de asignación, entradas, `due_on` resultante), `assigned_local_date date`.
- Invariantes (CHECK y triggers): `contract_end >= contract_start`; `contract_start/contract_end` coherentes con `assignment.starts_on/ends_on`; coherencia por `term_kind`; `natural_month` ⇒ `contract_start` es día 1 y `contract_end` es el último día de ese mes; `rolling_months` ⇒ `contract_end = contract_end_v1(contract_start, term_months)` (gemela SQL de `calculateContractEnd`); `custom_range` y `rolling_months` ⇒ `contract_start ≥ assigned_local_date`; para `natural_month`, la asignación no puede ser posterior a `contract_start`.

**`assignment_entitlement_periods`** (N por asignación y derecho, inmutable)
- `id` PK; `assignment_id` FK; `right_id` FK → `plan_rights(id)`; `period_index smallint`; `period_start date`; `period_end date` (NULL solo con `fixed_v1` sin vigencia).
- `entitlement_mode`: `quota` | `unlimited`.
- Para `quota` con `weekday_ratio_v1`: `weekdays_in_period`, `weekly_frequency`, `formula_id`, `sessions_granted`. Para `fixed_v1`: `sessions_granted` = cantidad del derecho; `weekdays_in_period` y `weekly_frequency` NULL. Para `unlimited`: todos NULL.
- CHECK: `sessions_granted = ((2·weekdays_in_period·weekly_frequency + 5) / 10)` (división entera) cuando `formula_id = 'weekday_ratio_v1'`, y `weekdays_in_period = entitlement_weekdays(period_start, period_end)`. Funciones SQL `IMMUTABLE` gemelas de las del dominio.
- Únicos: `UNIQUE(assignment_id, right_id, period_index)`; `UNIQUE(id, assignment_id)` (para FK compuestas). Trigger: **sin solape** de `[period_start, period_end]` por `(assignment_id, right_id)` (E-1 no depende de `btree_gist`; si B-1 adopta la extensión se puede sustituir por `EXCLUDE`).
- Sin `UPDATE` ni `DELETE` (triggers).

**Ledger y reservas**
- `client_entitlement_ledger.entitlement_period_id uuid NULL` con FK compuesta `(entitlement_period_id, assignment_id)` → periodos. Índice por periodo. `UNIQUE(entitlement_period_id) WHERE entry_type='grant'`.
- `calendar_reservation_rights.entitlement_period_id uuid NULL` (misma FK compuesta). Es lo que permite restaurar **en el mismo periodo**.
- Legacy: `entitlement_period_id IS NULL`; el saldo legacy sigue siendo por `(assignment_id, right_key)`.

### Troceo determinista del contrato

`splitContractIntoMonthlyEntitlementPeriods(contractStart, contractEnd)` (función pura, solo `date`, sin zonas horarias). Se invoca **después** de determinar `contract_start` y `contract_end` (ver `calculateContractEnd` en CONTRACT MODEL); el troceo no recalcula nunca el fin del contrato:

1. Primer tramo: `contractStart` → `min(último día de su mes, contractEnd)`.
2. Meses naturales completos intermedios.
3. Último tramo parcial hasta `contractEnd`, si procede.
4. Un contrato dentro de un único mes devuelve un único tramo. Los tramos son contiguos, sin huecos ni solapes.

Salidas esperadas: trimestral 15/10→14/01 = **4** tramos; semestral 15/10→14/04 = **7**; anual 15/10→14/10 (año siguiente) = **13**.

### Selección determinista del periodo (booking gate)

Para una sesión con fecha local `D` (en `Atlantic/Canary`):

1. Asignaciones candidatas: las del cliente que cubren el servicio y están activas, no pausadas, no canceladas y no cambiadas (lógica actual).
2. Asignación **legacy** (sin término): lógica actual sin cambios.
3. Asignación **con término**: el periodo `P` del derecho de cuota tal que `P.period_start ≤ D ≤ P.period_end`. Es único por el invariante de no solape.
   - `D` anterior al primer periodo → `entitlement_not_started`; posterior al último → `entitlement_expired`; hueco inesperado → `entitlement_period_missing` (se deniega y se registra como incidencia de integridad).
   - `quota`: saldo de **ese** periodo ≤ 0 → `entitlement_exhausted`, **aunque otro subperiodo tenga sesiones**.
   - `unlimited`: sin comprobación de saldo.
4. Varias asignaciones elegibles → se mantiene el flujo actual de selección (`entitlement_selection_required`).
5. Reservar con hoy anterior al inicio de un subperiodo futuro **está permitido** si el contrato ya empezó: consume solo de la bolsa del periodo de la sesión.

Ejemplo (consume de su periodo): reserva de la sesión del 10/11 consume **solo** del periodo 01/11–30/11. No puede consumir saldo de octubre ni de diciembre.

### Modalidad ilimitada

- Es una modalidad del derecho: `plan_rights.quantity_rule = 'unlimited'` sobre un derecho de cuota. No lleva `weekly_frequency`, `quantity` ni cantidad ficticia.
- Tiene contrato, pago y gate de acceso, y puede caducar y bloquearse por impago.
- Genera **un único** periodo `unlimited` que cubre todo el contrato (no hay bolsa que trocear ni caducar).
- No hay `grant`/`expire` en el ledger. Las reservas siguen enlazadas a su periodo y derecho a través de `calendar_reservation_rights` (con `ledger_entry_id` NULL).
- Ausencia de cuota ≠ ilimitado: la modalidad debe ser **explícita**; en planes con término, un plan sin regla de cantidad se rechaza al crearlo.

### Bono y puntual

- Al crear la asignación **no** hay periodo ni `grant`.
- Al validarse el pago (coordinador, misma transacción, idempotente): se crea el periodo único `[V, V + valid_days − 1]` con `V` = fecha local de Canarias de la validación (`period_end` NULL si el plan no define vigencia) y el `grant` de la cantidad fija.
- Mientras tanto el gate devuelve `payment_pending`.
- Convención de duración: `valid_days` cuenta el día de inicio (90 días desde 12/10 → fin 09/01). El modelo legacy (`addLocalDays`) trata `anchor + valid_days` como último día válido (un día más); el legacy no cambia. Ver `CONSECUENCIAS DE LAS DECISIONES`.

## SESSION CALCULATION

- `weekdaysInRange(start, end)`: número de días de lunes a viernes entre dos fechas, ambas incluidas, sobre `date` de Canarias, por aritmética de fechas (semanas completas × 5 + resto). Sin festivos (S-03).
- `sessionsForPeriod(weekdays, frequency) = ⌊(2 · weekdays · frequency + 5) / 10⌋`, equivalente exacto a `ROUND_HALF_UP(weekdays × frequency / 5)` sin coma flotante.
- `weekly_frequency ∈ {1,2,3,4,5}` (CHECK).
- **Empates .5:** con frecuencia entera `weekdays × frequency / 5` solo produce decimales .0, .2, .4, .6, .8; el .5 es inalcanzable. La función de redondeo genérica `roundHalfUp(numerador, denominador)` se prueba por separado ((5,2)→3, (7,2)→4, (1,2)→1).
- Cada subperiodo se redondea de forma **independiente**; la suma de bolsas puede diferir del redondeo del total (consecuencia aceptada).
- Si el resultado es 0, la asignación se rechaza (`bag_empty`): el ledger no admite cantidades nulas.
- La bolsa se calcula **una vez**, al crear la asignación, y se congela. Reservar nunca recalcula.

Tabla de referencia (3 días/semana):

| L–V del periodo | Cálculo | Sesiones |
|---|---|---|
| 20 | 20×3/5 = 12,0 | 12 |
| 21 | 21×3/5 = 12,6 | 13 |
| 22 | 22×3/5 = 13,2 | 13 |
| 23 | 23×3/5 = 13,8 | 14 |

Calendario real: octubre 2026 = 22 L–V, noviembre 2026 = 21, diciembre 2026 = 23, febrero 2027 = 20, enero 2027 = 21 (empieza viernes), febrero 2028 (bisiesto) = 21.

### Ejemplo contrato → periodos (trimestral, 3 días/semana, 15/10/2026–14/01/2027)

| Periodo | Rango | L–V | Cálculo | Bolsa |
|---|---|---|---|---|
| P1 | 15/10–31/10/2026 | 12 | 12×3/5 = 7,2 | **7** |
| P2 | 01/11–30/11/2026 | 21 | 21×3/5 = 12,6 | **13** |
| P3 | 01/12–31/12/2026 | 23 | 23×3/5 = 13,8 | **14** |
| P4 | 01/01–14/01/2027 | 10 | 10×3/5 = 6,0 | **6** |

Un contrato, un cargo, cuatro bolsas (total 40, **no** utilizable como una sola). Reserva del 10/11 → consume de P2. Si P2 está agotada → `entitlement_exhausted` aunque P3 tenga saldo.

## LEDGER MODEL

El ledger sigue siendo la única fuente de saldo; nunca se actualiza un saldo con `UPDATE`.

- **Grant:** uno por periodo `quota`, en la misma transacción que crea la asignación (o al validar el pago en `pack`/`one_off`). Clave de idempotencia determinista (UUID por nombre) a partir de `term-grant:{assignment_id}:{period_id}:{right_id}`. Cantidad = `sessions_granted`.
- **Consume (−1):** al reservar o promocionar desde waitlist, con `entitlement_period_id` = periodo de la sesión. Se registra también en `calendar_reservation_rights.entitlement_period_id`.
- **Restore (+1):** vuelve al **mismo periodo** (se localiza vía `calendar_reservation_rights`). Si hoy (Canarias) es posterior a `period_end`, en la misma transacción se inserta además un `expire` de esa unidad (clave `term-expire-restore:{reservation_id}`): un periodo cerrado nunca recupera saldo usable, y una restauración de noviembre nunca se convierte en sesión de diciembre.
- **Tardía/no-show que consume:** sin movimiento (la unidad ya está consumida).
- **Expire:** al terminar el periodo, el barrido inserta `expire` por el saldo restante (clave `term-expire:{period_id}`). La caducidad es además **perezosa y autoritativa**: el gate niega reservas con `D > period_end` sin depender del barrido.
- **Cambio de plan / cancelación de asignación:** `expire` del saldo de **todos** los periodos con saldo, incluidos futuros (clave `term-expire-change:{period_id}`), con motivo; compensación solo vía `adjustment` manual auditado.
- **No negatividad:** trigger `DEFERRABLE` en el ledger para entradas con periodo que verifica `SUM(periodo) ≥ 0` bajo bloqueo de la fila del periodo. La serialización normal ya la da el bloqueo de la fila del cliente al reservar.
- **Legacy:** entradas con `entitlement_period_id NULL` se leen como hasta ahora.
- Un servicio único `ReservationEntitlementService` (`consumeForReservation`, `restoreForReservation`, `expirePeriod`) centraliza estas operaciones; se introduce en A-2 y E-3 lo hace consciente de periodos.

## PAYMENT MODEL

### Cálculo y estado

- `due_on` del cargo = último día en que se puede pagar (inclusive). Bloqueo desde `(due_on + 1) 00:00` en `Atlantic/Canary`. El 25/10/2026 (fin del horario de verano) dura 25 horas y se prueba explícitamente.
- Pagado = importe neto validado ≥ importe del cargo (transacciones − reembolsos, del ledger económico existente). Un pago parcial no cambia el estado de acceso (P-10). Cargo `exempt`: nunca bloqueado. Si un pago validado se reembolsa, el cargo vuelve a estar impagado y el acceso se recalcula.
- **Estado de acceso (derivado) por asignación con término:**
  `bloqueado = payment_block='enforce' ∧ cargo no saldado ∧ hoy_canarias > due_on ∧ sin override vigente`.
  Aplica al **contrato entero** (todos sus periodos). Para `pack`/`one_off`: `permitido ⇔ existe periodo activado`.
- **Reactivación automática** (P-11): al saldarse el cargo la derivación devuelve "permitido"; no hay estado que invertir. El coordinador de pagos escribe `block_cleared` en la misma transacción que valida el pago.

### Piezas

- **Overrides** (`assignment_access_overrides`): actor, motivo obligatorio, `valid_from`, `valid_until` (o `single_booking`), `revoked_at/by`. Como máximo uno vigente por asignación. Absorbe el actual `overrideDebt` por reserva para asignaciones con término. Permiso propio (no delegable por defecto a Trainer).
- **Eventos** (`assignment_access_events`, append-only): `block_applied` (con `effective_at` calculado aunque el barrido se retrase y `recorded_at` real), `block_cleared`, `override_granted`, `override_revoked`. Cubre "registrar cuándo se aplicó y cuándo se retiró".
- **Coordinador de liquidación** (`onChargeSettled`, aplicación, misma transacción que la validación de pago): activa `pack`/`one_off` (periodo + grant) y registra `block_cleared`. Idempotente.
- **Barrido diario** (E-4): registra `block_applied` una sola vez por ciclo y emite avisos internos. No es necesario para que el bloqueo funcione.
- **Deuda legacy:** `debtBlocksNewBooking` (flag global, `due_on < hoy`) **excluye** los cargos ligados a asignaciones con término, que se evalúan por derecho. Si no, un cargo largo vencido bloquearía además productos distintos. Invariante probada en E-3.
- **Configuración:** `economic_settings.due_day` (10) y nuevo `grace_days` (5). `payment_block` por versión de plan ("bloqueo configurable por producto/plan"), `enforce` por defecto.
- **Notificaciones:** avisos internos de impago; la comunicación al cliente podrá añadirse después. Member ve un banner informativo con fecha límite; nunca se le bloquea la app.

## BOOKING GATE

`evaluateBookingGate(tx, entrada)` es la **única autoridad** para: crear reserva, unirse a la waitlist, promocionar desde la waitlist y previews relevantes.

- `entrada`: cliente, sesión (o servicio + `startsAt`), `intent` (`reserve | waitlist_join | waitlist_promote | preview`), actor, overrides solicitados, reloj.
- Salida: `{ allowed, reasons[{code, overridable, requiredPermission, details}], selectedEntitlement (asignación + derecho + periodo), alternatives, capacity, policyPreview, waitlistAllowed }`.
- **Etapas en orden fijo; los motivos se acumulan:** sesión (cancelada, iniciada, individual de otro cliente) → cliente activo → servicio y área activos → derecho (validez, periodo, saldo, cuota legacy) → pago (modelo nuevo o legacy) → documentos → conflicto de horario del propio cliente → capacidad.
- **Códigos:** `no_entitlement`, `service_not_allowed`, `entitlement_not_started`, `entitlement_expired`, `entitlement_exhausted`, `entitlement_paused`, `entitlement_cancelled`, `entitlement_period_missing`, `payment_pending`, `payment_overdue`, `documents_missing`, `session_started`, `session_full`, `booking_conflict`, `client_inactive`, `permission_denied`. Los códigos actuales (`overdue_balance_blocks_booking`, `required_documents_pending`…) se mantienen como alias durante una versión de API.
- **Comportamiento conservado:** `waitlist_join` ignora deuda y documentos (se evalúan al promocionar). La promoción reevalúa todo en la transacción.
- El frontend muestra la razón; el backend decide.
- **Modo sombra** (`booking.gate.v2`): durante B-0 el gate nuevo corre junto al código actual, se comparan resultados en logs y se sirve el actual hasta cero divergencias en la batería de caracterización.

## CANCELLATION MODEL

- **Política** `{ windowMinutes, lateConsequence: restore|consume, noShowConsequence: consume|restore, source: service|center }`, resuelta por una función pura `resolvePolicy(servicio)`. Se usa igual en preview, cancelación y no-show.
- **Defaults** (C-06) en `center_booking_policy` (singleton, con `version`): ventana 4 h, tardía `consume`, no-show `consume`, cancelación por el centro `restore`. Aplican solo a servicios en `inherit`.
- **Servicios existentes:** `services.cancellation_policy_mode = 'custom'` con sus valores actuales (0 min / `restore`). Los servicios nuevos nacen en `inherit`.
- **Snapshot (C-04):** `calendar_reservations.policy_snapshot jsonb` = política vigente al confirmar (origen, ventana, consecuencias, `policy_version`, `captured_at`). El preview devuelve un `policyHash`; si cambia entre preview y confirmación → `409 policy_changed` con el preview nuevo. **Reservas legacy sin snapshot:** se evalúan con la política **actual** de su servicio (comportamiento de hoy); no se hace backfill, porque no se puede saber qué aceptó el cliente.
- **Matriz de consecuencia:**

| Quién / cuándo | Resultado |
|---|---|
| Member, antes del inicio, dentro de ventana | `restore` |
| Member, antes del inicio, fuera de ventana (tardía) | según snapshot (`consume` por defecto): estado `cancelled_late` |
| Member, tras el inicio | `409 session_started` (C-01) |
| Member, sesión movida por el centro, antes del inicio | `restore` con `consequence_source='center_rescheduled'` (C-05) |
| Staff, individual, antes del inicio | consecuencia por política, con override Admin autorizado y motivo |
| Staff, individual, tras el inicio | motivo + **consecuencia explícita obligatoria**; sin restauración automática (C-02) |
| Centro cancela sesión completa | `restore` a todas, **excepto** `attended`, que solo se tratan con override auditado (C-03) |
| No-show | según `noShowConsequence` del snapshot (`consume` por defecto) |

- **`center_rescheduled` (C-05):** cuando se cambia `starts_at` o duración de una sesión con reservas, `calendar_reservation_session_changes` guarda una fila por reserva afectada (`change_kind='center_rescheduled'`, hora antigua y nueva). Mientras la sesión no haya empezado, la cancelación del Member usa esa exención; no se mezcla con la cancelación tardía. Cambiar solo de profesional no activa la exención.
- **Registro:** `calendar_reservation_cancellations` (append-only): motivo (C-07), `reason_text` interno, snapshot aplicado, consecuencia aplicada, fuente (`policy | admin_override | center_rescheduled`), actor, ledger asociado, clave de idempotencia. Correcciones posteriores en `calendar_reservation_consequence_adjustments` (nunca se muta el registro original).
- **Staff siempre registra motivo; `other` exige texto.** El Member solo recibe un texto neutro mapeado desde el código; nunca `reason_text`.
- **API compatible:** `PATCH …/cancel` acepta cuerpo opcional `{ reasonCode, reasonText, consequence, overrideReason }`; sin cuerpo se comporta como hoy. El motivo pasa a obligatorio para staff con el flag `cancellation.reason_required` cuando la UI esté desplegada.
- Un único `GET …/cancellation-preview` para Member y staff.
- Cualquier restauración respeta el modelo de periodos (ver LEDGER MODEL).

## WAITLIST MODEL

- **Servicio único** `promoteWaitlist(tx, sesión, disparador)` invocado por: cancelación de reserva, aumento de capacidad y liberación de plaza por staff. No hay un segundo proceso de promoción.
- **Promoción automática inmediata y orden FIFO** (comportamiento actual, se conserva). Una entrada no elegible se omite, se audita con motivo y sigue esperando.
- **Elegibilidad:** el gate con `intent='waitlist_promote'`, incluida la selección de periodo en el momento de promocionar.
- **Una sola promoción por entrada** bajo concurrencia: bloqueo de la fila de sesión + `UPDATE … WHERE status='waiting'` + unicidad de `promoted_reservation_id`.
- **Por qué no se promocionó:** `last_evaluation_reason` y `last_evaluated_at` en la entrada de waitlist, visibles al staff.
- Cancelar tras el inicio o marcar no-show no promueve.
- Cambios de sesión: aumento de capacidad promueve; reducción por debajo de la ocupación sigue bloqueada; un cambio de hora no invalida entradas (se reevalúan al promocionar).

## CONCURRENCY MODEL

- **Orden de bloqueo:** fila de sesión → fila de cliente → fila de asignación/periodo. Todas las rutas que mutan reservas respetan este orden.
- **Solape de profesional:** `EXCLUDE USING gist (professional_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (status='scheduled' AND professional_id IS NOT NULL)` con `ends_at` columna generada inmutable; **sujeto a spike** (B-1). La comprobación previa de aplicación se conserva solo para avisos y overrides de disponibilidad; el conflicto de solape no se puede sobrescribir. `23P01` → `professional_session_conflict`; `40P01` se reintenta una vez.
- **Aviso:** `ON CONFLICT DO NOTHING` del materializador absorbe también violaciones de exclusión; el materializador cuenta ocurrencias esperadas frente a insertadas y registra `template.occurrence_conflict`.
- **Versión de sesión:** `calendar_sessions.version` con `If-Match` para evitar actualizaciones perdidas entre dos miembros del staff y como clave de deduplicación de avisos.
- **Jobs:** `job_runs` + un único worker con `pg_try_advisory_lock` (ejecución única).
- **Idempotencia obligatoria** en reserva, cancelación, promoción (estructural), materialización (estructural), grants/expiraciones (claves deterministas), overrides, validación de pago, venta/reverso y subida de imágenes.

## MATERIALIZATION MODEL

- Worker programado (cada ~15 min y al arrancar con puesta al día), sobre el proceso del worker de notificaciones ya existente. Horizonte móvil de 90 días. Idempotente por el índice único de ocurrencia por plantilla.
- Materialización inmediata también al crear o editar una plantilla (ruta de administración).
- `job_runs`: `job_name`, ventana, `started_at`, `finished_at`, `status`, `created_count`, `skipped_conflicts`, `error_code`.
- `GET /api/me/sessions` queda como **lectura pura** y devuelve `materializedThrough`.
- Rollout: flag `calendar.materialize_on_read` activo hasta verificar el worker (conviven sin problema por idempotencia); luego se apaga.
- Observabilidad: última ejecución correcta, retraso, conflictos; alerta si `ahora − última correcta > 2 intervalos`.
- DST: la ocurrencia se calcula con fecha y hora **locales**; la hora local inexistente (primavera) se resuelve hacia delante y la repetida (otoño) a la primera ocurrencia.

## RBAC MODEL

- **Permiso:** clave `dominio.recurso.acción` en un registro con metadatos (dominio, descripción, `sensitive`, `delegable`, `dependsOn`, alcances admitidos). El catálogo `knownPermissions` actual se convierte en este registro.
- **Alcance:** `all`, `own` (recursos de mi profesional: sus sesiones y lo que cuelga de ellas) y `assigned` (mis clientes). Sin expresiones booleanas libres.
- **"Mis clientes" (R-02):** tabla `client_trainer_assignments` (`client_id`, `professional_id`, `role` `primary|secondary`, `assigned_by`, `assigned_at`, `ended_at`). Como máximo un principal activo por cliente; secundarios ilimitados. `assigned` = existe asignación activa del profesional actuante. Permiso propio para asignar clientes.
- **Concesiones y denegaciones:** efectivo = rol base ∪ plantilla ∪ concesiones del actor, menos denegaciones. **Deny siempre gana.** Entre varias concesiones del mismo permiso prevalece el alcance más amplio, salvo deny explícito.
- **Plantillas:** conjuntos con nombre; se **copian** al asignar (editar una plantilla no cambia a nadie retroactivamente). Las plantillas de sistema se siembran desde el mapa estático actual.
- **Plantilla Trainer (R-04):** exactamente el comportamiento efectivo actual. Golden test: los permisos efectivos de los cuatro roles sin configuración granular son idénticos a hoy.
- **No delegables (R-03):** marcados `delegable:false` en el registro; el servidor rechaza concederlos a Trainer. Protección de último Admin y contra auto-escalada. C-1 produce la clasificación explícita de cada clave existente en estas categorías; la revisión del PR la confirma.
- **Enforcement:** `can()` sigue para capacidades; `scopeOf(ctx, permiso)` y constructores de predicado SQL por recurso para listados y mutaciones (comprobación de alcance **dentro** de la misma transacción: sin TOCTOU). Fuera de alcance: 404 en lecturas, 403 en mutaciones de un recurso conocido.
- **Doble lectura:** sin entradas en BD el resultado es el mapa estático actual. Flag `rbac.granular.enabled`, apagado por defecto.
- **Carga:** política por petición (consulta indexada pequeña); el cambio en caliente se aplica en la siguiente petición. Nada de permisos embebidos en tokens.
- **Manifiesto de rutas:** un test enumera las rutas de Fastify y exige que cada una declare su permiso.
- **Capacidades al frontend:** `GET /api/session/capabilities` devuelve permisos efectivos con alcance; la UI solo refleja.
- **Auditoría:** diff antes/después, actor y motivo en la auditoría compartida (dominio `rbac`). Los rechazos de autorización van a log estructurado.
- **Activación (R-05):** el motor, el esquema y la UI se construyen y prueban con el resolver actual, pero el flag no se enciende en producción hasta tener autenticación real de staff. Un Trainer sin profesional vinculado con alcance `own` no ve nada (falla cerrado).

## STORE MEDIA MODEL

- **Puerto `ObjectStorage`** con adaptador de disco local (desarrollo y, si el despliegue es un único servidor, opción de producción) y adaptador compatible con S3. Selección por entorno. PostgreSQL guarda solo metadatos (D-01). El proveedor de producción queda sin cerrar (D-04).
- **Tablas:** `media_assets` (`id`, `kind`, `storage_key`, `sha256`, `content_type`, `width`, `height`, `bytes`, `status`, creado/borrado por y cuándo), `media_asset_variants` (`thumb 320`, `card 640`, `detail 1280`, WebP) y `store_product_images` (`product_id`, `asset_id`, `position smallint CHECK BETWEEN 1 AND 6`, `alt_text`, `deleted_at`). **`position = 1` es la imagen principal**: 1 principal + hasta 5 secundarias queda garantizado por construcción (D-03). Único `(product_id, position)` entre las vivas.
- **Por producto (D-02):** las variantes comparten imágenes. Una futura extensión por variante usaría una tabla distinta; no se deja ninguna columna provisional.
- **Subida:** multipart ≤ 8 MB, solo `store.catalog.manage`; formato por bytes mágicos (JPEG/PNG/WebP; SVG rechazado); límite de píxeles; orientación automática; EXIF eliminado; reencodado a variantes WebP; concurrencia de procesado limitada; `Idempotency-Key` + `sha256` por producto. Blobs con clave por contenido.
- **Operaciones:** reemplazo = asset nuevo + intercambio atómico de posición; borrado lógico; barrido de blobs huérfanos a los 30 días con `job_runs`.
- **Servir:** a través de la API autenticada con ETag por hash de contenido y caché privada; `X-Content-Type-Options: nosniff`.
- **Fallback:** producto sin imágenes → `images: []` y marcador por categoría en el cliente. Sin backfill.
- **Spike obligatorio (D-1):** dependencia nativa de procesado (por ejemplo `sharp`) en Windows, Docker y CI.
- Deuda declarada: los comprobantes de transferencia en `bytea` pueden migrar a este mismo puerto más adelante (fuera del EPIC).

## AUDIT / EVENT MODEL

- **Se mantienen las tablas de auditoría por dominio** (ya tienen triggers de inmutabilidad y consultas).
- **Sobre de auditoría común** (contrato TypeScript + helper de test): actor, tipo de actor, acción, recurso, `correlation_id`/`request_id`, motivo, antes/después mínimos, fecha.
- **Tabla compartida `platform_domain_audit_events`** (098-0) para los dominios nuevos (política de reservas, RBAC, anulaciones/eventos de acceso de pago, medios) con `domain` y `action` validados por **regex** y por el catálogo en código, no por lista cerrada en CHECK. Append-only, con guarda de TRUNCATE.
- **Vista de solo lectura `audit_timeline`** (cuando haya consumidores) que une las tablas existentes y la nueva.
- **Outbox solo para notificaciones.** En 098-0 se relajan los CHECK de `domain_events_outbox.event_type` y `notifications.type` (y el regex de `deeplink`) a formato + registro en código.
- No se migran ni reescriben registros históricos.

| Qué | Dónde |
|---|---|
| Cancelaciones, no-show, ajustes de consecuencia | `calendar_reservation_cancellations` + `calendar_audit_events` |
| Cambios de política del centro | auditoría compartida (`booking_policy`) |
| Cambios de permisos | auditoría compartida (`rbac`) |
| Cambios de sesión y waitlist | `calendar_audit_events` |
| Pagos | `economic_audit_events` (existente) |
| Bloqueos/overrides de acceso | `assignment_access_events` + auditoría compartida (`payments`) |
| Ventas y reversos | `store_audit_events` |
| Imágenes | auditoría compartida (`media`) |

## TIMEZONE MODEL

- Instantes en `timestamptz`; fechas de negocio como `date` en `Atlantic/Canary`. Nunca la zona del servidor.
- Un único `Clock` en TypeScript con la fecha local de Canarias calculada con `Intl`. Las reglas de negocio reciben `hoy` como parámetro; los tests inyectan el reloj. SQL de reglas recibe `hoy` por parámetro, no usa `now()` implícito.
- **Fin de día** = inicio del día siguiente local: `(d + 1)::timestamp AT TIME ZONE 'Atlantic/Canary'`.
- Troceo de contratos, recuento de L–V, plazos y periodos: solo aritmética de `date`, nunca instantes UTC.
- **No usar `timestamptz + interval 'N hours'`** para horas locales (el seed lo hace en la sesión 201 y se desplaza una hora en el cambio de hora).
- El driver devuelve `date` como `Date` de JS: en 098-0 se configura el tipo `date` (OID 1082) para devolver texto `YYYY-MM-DD` tras revisar los usos existentes.
- Cambios de hora en Canarias: 29/03/2026 y 25/10/2026 (días de 23 y 25 horas) son casos de test obligatorios.

## FEATURE FLAGS

Todos apagados por defecto, documentados en el handoff de su PR, y con rollback verificado.

| Flag | Task |
|---|---|
| `booking.gate.v2` (modo sombra → servir) | B-0 |
| `calendar.materializer_worker` · `calendar.materialize_on_read` (encendido hasta verificar el worker) | B-2 |
| `booking_policy.inherit_enabled` · `cancellation.policy_snapshot` | A-1 |
| `cancellation.reason_required` · `cancellation.center_rescheduled_exemption` | A-2 |
| `rbac.granular.enabled` | C-1 / C-2 |
| `store.images.enabled` | D |
| `payments.term_plans.creation_enabled` | E-1 / E-2 |
| `payments.term_model.enabled` (gate por periodos) · `payments.access_gate.enforce` | E-3 |
| `payments.sweeper.enabled` | E-4 |

La presencia de credenciales o configuración nunca enciende un flag.

## MIGRATION STRATEGY

- Expandir y contraer; solo aditivas y hacia delante. Sin borrados ni reescrituras de historia, personas ni ledger.
- Cada PR lleva sus migraciones y un **test de migración** sobre una base con filas heredadas (patrón de `0024`).
- Numeración asignada al mergear; los PRs paralelos se rebasan.
- Pre-vuelo de datos con informes de solo lectura fuera de las migraciones antes de cualquier restricción nueva.
- Las migraciones no mueven ni borran sesiones, reservas ni movimientos.

| PR | Contenido de migración |
|---|---|
| 098-0 | `platform_domain_audit_events`; relajar CHECK de outbox/notifications |
| B-1b | `btree_gist`, `ends_at` generado, EXCLUDE (con pre-comprobación que **falla** si quedan solapes) |
| B-2 | `job_runs` |
| B-3 | `calendar_sessions.version`, `calendar_reservation_session_changes`, columnas de evaluación de waitlist |
| A-1 | `center_booking_policy`, `services.cancellation_policy_mode` (+ override de no-show), `calendar_reservations.policy_snapshot` |
| A-2 / A-3 | `calendar_reservation_cancellations`, `calendar_reservation_consequence_adjustments`, ampliar acciones de auditoría |
| C-1 | `staff_permission_policies`, `staff_policy_entries`, `staff_actor_policies`, `client_trainer_assignments` |
| D-1 | `media_assets`, `media_asset_variants`, `store_product_images` |
| E-1 | Columnas en `plan_versions` (`term_kind`, `term_months`, `max_span_days`, `payment_rule`, `payment_block`) y `plan_rights` (`weekly_frequency`, `quantity_rule`); relajar CHECK de `plan_versions.kind` y de `plan_rights`; `assignment_contract_terms`; `assignment_entitlement_periods`; `entitlement_period_id` en ledger y `calendar_reservation_rights`; funciones SQL inmutables (`entitlement_weekdays`, `entitlement_sessions_v1`, `contract_end_v1`); `economic_settings.grace_days` |
| E-3 | `assignment_access_overrides`, `assignment_access_events`, vista `economic_charge_balances` |

Cardinalidades E: asignación 1:1 contrato; asignación 1:N periodos (por derecho); periodo 1:N ledger; asignación 1:1 cargo; reserva N:1 periodo (vía `calendar_reservation_rights`).

Rollback: apagar el flag devuelve el comportamiento anterior; las tablas y columnas añadidas permanecen. Ninguna migración tiene `down` destructivo.

## BACKWARD COMPATIBILITY

- **Doble lectura, sin doble escritura.** Gate: modelo nuevo si hay término; regla global actual si no. Cancelación: snapshot si existe; política actual del servicio si no. RBAC: mapa estático si no hay política.
- **Planes:** solo las versiones nuevas con `term_kind` generan contratos y periodos. Los planes y asignaciones existentes no se tocan; su `period_quota` semanal sigue siendo un tope. En planes con término está prohibido el `period_quota` semanal; la UI rotula la frecuencia como "para calcular la bolsa del periodo, no es un límite semanal".
- **Códigos de motivo:** los antiguos se mantienen como alias durante una versión de API.
- **APIs:** campos nuevos solo aditivos (`contract`, `currentPeriod`, `periods[]` en las respuestas de derechos).
- **Asignaciones legacy:** conversión explícita, guiada y nunca retroactiva (E-5).
- **Reservas existentes:** nunca se cancelan por impago, cambio de plan ni cambio de política.

## IMPLEMENTATION ORDER

Cadena serial del núcleo de calendario (todas tocan `calendar.ts` o las rutas de reserva/cancelación):

`098-0 → B-0 → B-1b → B-3 → A-1 → A-2 → A-3 → E-3a → E-3b`

Carriles paralelos (archivos distintos):

- **B-1a** (informe de solapes, solo lectura) y **B-2** (job runner + materializador): tras 098-0.
- **C-1** (motor RBAC, esquema, UI Admin): tras 098-0. **C-2** (enforcement por dominios) tras E-3b; **C-3** al cierre.
- **D-1 → D-2 → D-3** (Tienda): tras 098-0, aislado.
- **E-1** (reglas puras + esquema): tras 098-0. **E-2** (creación de contratos/periodos/grants, renovación, cambio de plan, activación de bonos): tras E-1.
- **E-4** (barrido, caducidad, avisos, UI): tras E-3b y B-2. **E-5** (conversión de heredados): al final.

Si dos PRs deben tocar las mismas funciones (restauración de derechos), el segundo espera a que el primero esté mergeado. A-2 introduce `ReservationEntitlementService`; E-3a lo hace consciente de periodos.

## DEPENDENCY GRAPH

```
098-0 ─┬─► B-0 ─► B-1b ─► B-3 ─► A-1 ─► A-2 ─► A-3 ─► E-3a ─► E-3b ─► C-2 ─► C-3
       │            ▲ (B-1a informe + decisión humana)         │         │
       ├─► B-1a ────┘                                          ▼         │
       ├─► B-2 ───────────────────────────────────────────► E-4 ◄────────┘
       ├─► C-1 ───────────────────────────────────────────────► C-2
       ├─► D-1 ─► D-2 ─► D-3
       └─► E-1 ─► E-2 ─────────────────────────► E-3a
                                        E-4 ─► E-5

Externas: proveedor de identidad de staff → activar C en producción
          hosting de almacenamiento     → adaptador de producción de D
```

## TASK / PR BREAKDOWN

Cada task tiene su fichero en `tasks/` con alcance, invariantes, migración, flags, tests, aceptación manual, riesgos y definición de hecho. Un PR por task (o por subpaso a/b donde se indica). Objetivo orientativo: PRs revisables en una sesión (< ~800 líneas de lógica sin contar tests/migraciones).

| Task | Título | Subpasos | Depende de |
|---|---|---|---|
| `2J-098-0` | Cimientos (reloj, auditoría compartida, eventos, utilidades de test) | — | — |
| `2J-098B-0` | Booking gate (refactor en modo sombra) | — | 098-0 |
| `2J-098B-1` | Solape de profesional | **a)** informe READ ONLY y herramienta de resolución; **b)** restricción fuerte tras decisión humana | 098-0 (a); B-0 (b) |
| `2J-098B-2` | Job runner y materializador | — | 098-0 |
| `2J-098B-3` | Waitlist, versión de sesión y avisos | — | B-0, B-1b |
| `2J-098A-1` | Política general, herencia y snapshot | — | B-3 |
| `2J-098A-2` | Cancelación con motivo y consecuencia (+ `center_rescheduled`) | — | A-1 |
| `2J-098A-3` | No-show y comportamiento tras el inicio | — | A-2 |
| `2J-098C-1` | Motor RBAC, esquema y UI Admin | — | 098-0 |
| `2J-098C-2` | Enforcement por dominios | — | E-3b |
| `2J-098C-3` | Cierre: manifiesto de rutas y documentación | — | C-2 |
| `2J-098D-1` | Puerto de almacenamiento, metadatos y spike | — | 098-0 |
| `2J-098D-2` | Subida, variantes y API | — | D-1 |
| `2J-098D-3` | UI Admin/Member y limpieza de huérfanos | — | D-2 (limpieza: B-2) |
| `2J-098E-1` | Reglas puras y esquema de contratos/periodos | — | 098-0 |
| `2J-098E-2` | Creación de contratos, periodos y grants; renovación, cambio de plan; activación de bonos | — | E-1 |
| `2J-098E-3` | Gate por periodos y por pago | **a)** consumo/restauración/expiración por periodo; **b)** gate de pago, overrides, reactivación | B-0, A-3 (a); E-2 (a); E-3a (b) |
| `2J-098E-4` | Barrido, caducidad, avisos y pantallas | — | E-3b, B-2 |
| `2J-098E-5` | Conversión de heredados | — | E-4 |

Futuro (fuera del EPIC, el diseño lo permite): renovación en lote (preparar → revisar → confirmar) sobre la función pura de preparación de renovación de E-2.

## TEST STRATEGY

Capas: unitarios de reglas puras; API sobre PostgreSQL real con base limpia; concurrencia (barrera); golden de RBAC; tests de migración con datos heredados; seed con reloj inyectable; UI en jsdom; aceptación manual con el propietario.

Utilidades comunes (098-0): reloj inyectable, ayudante de concurrencia con barrera, base de datos limpia por suite, fábricas de datos.

### Casos obligatorios de cuotas

**Fórmula** (3 días/semana salvo indicación): 20 L–V → 12; 21 → 13; 22 → 13; 23 → 14. Con 1/2/4 días y 20 L–V → 4/8/16. `roundHalfUp(5,2)=3`, `(7,2)=4`, `(1,2)=1`; prueba de que con frecuencia entera no hay .5.
**Periodos:** mes que empieza en lunes (feb. 2027 = 20), en viernes (ene. 2027 = 21), febrero de 28 y de 29 días (2028 = 21), paso de año, meses con 20/21/22/23 L–V.
**Trimestral 15/10–14/01:** cuatro periodos (7/13/14/6); cada uno con su snapshot y su grant; reserva del 10/11 consume noviembre; saldo de octubre no usable en noviembre; saldo de noviembre no usable en diciembre; `entitlement_exhausted` en diciembre aunque quede saldo en otro periodo; restore vuelve al mismo periodo; restore tras cerrar el periodo = restore + expire; ninguna reserva recalcula la bolsa.
**Semestral / anual:** troceo correcto (7 y 13 tramos), con el contrato determinado antes del troceo.
**`calculateContractEnd`** (obligatorios): 15/10 + 3m → 14/01; 01/10 + 3m → 31/12; 31/01 + 3m → 30/04; 30/11 + 3m → 28/02 en año no bisiesto; 30/11 + 3m → 29/02 cuando corresponda (inicio 30/11/2027); 31/08 + 6m → último día de febrero (28/02/2027 y 29/02/2028); 15/10 + 6m → 14/04; 15/10 + 12m → 14/10; 28/02/2027 + 12m → 29/02/2028; caso límite 29/11/2026 + 3m → 27/02/2027. Invariantes por barrido de fechas: `fin > inicio`, no decreciente, `fin + 1` es el inicio del siguiente contrato (día 1 si el inicio era fin de mes). La gemela SQL `contract_end_v1` da los mismos resultados y el CHECK rechaza contratos incoherentes.
**Medio mes (`custom_range`):** rangos arbitrarios con 11 y 12 L–V a 2/semana (4 y 5); rango que cruza meses; rango que empieza antes de la fecha de asignación, rechazado.
**Mensual natural:** `contract_start` siempre día 1; asignada el 20/10 «Mensual noviembre» → 01/11–30/11 (21 L–V → 13 sesiones a 3/semana); asignada el día 1 → válida; asignada con el mes ya empezado (por ejemplo el 15/10 «Mensual octubre») → rechazada con `natural_month_already_started`; no se genera ninguna bolsa parcial ni completa; renovación mensual = nueva asignación, cargo, contrato y bolsa; sin rollover (el sobrante caduca con `expire`).
**Snapshot:** cambiar el plan después no modifica periodos ya generados.
**Ilimitado:** sin cuota ni `weekly_frequency`; el gate funciona; el impago bloquea nuevas reservas; sin error por ausencia de frecuencia; un periodo único.
**Bono/puntual:** sin grant ni periodo antes de validar; grant idempotente al validar; vigencia desde la validación (asignado 10/10, validado 12/10 → desde 12/10); `payment_pending` antes.
**Plazos:** mensual natural asignada por adelantado (20/10 para noviembre) → 10/11; asignada el propio día 1 → día 10; asignada con el mes ya empezado → rechazada; medio mes y planes largos: asignado 15/10 → límite 20/10 con bloqueo 21/10 00:00, asignado 28/10 → 02/11, asignado el 5, el 10 o el 11 → asignación + 5 días; trimestral/semestral/anual → +5; 25/10/2026 (25 h); pago parcial sin efecto; pago a las 23:59:59 válido; pago completo reactiva solo; reembolso vuelve a bloquear; override con vigencia y revocación.
**Deuda legacy:** el cargo de una asignación con término no activa `debtBlocksNewBooking`.

### Resto del EPIC

Cancelaciones (dentro/fuera de plazo, tras inicio, no-show, override, doble cancelación, Member+staff simultáneos, `policy_changed`, reserva legacy sin snapshot, sesión movida frente a tardía normal, sesión completa con `attended`); waitlist (cancelación + promoción concurrente, aumento de capacidad, dos promociones simultáneas, entrada no elegible auditada); solapes (dos POST, PATCH contra POST, intercambio de profesionales, plantilla contra manual); RBAC (matriz ruta × rol × política, deny gana, alcance `own`/`assigned`, cambio en caliente, golden, último Admin, no delegables); imágenes (formato falso, bomba de píxeles, EXIF, reemplazo atómico, máximo de 6, permisos).

## OBSERVABILITY

- Logs estructurados con `request_id`: `booking.denied {reasons[]}`, `waitlist.promotion_skipped {reason}`, `access.block_applied`, `rbac.denied {permission, scope}`, `materializer.run {created, skipped_conflicts}`, `ledger.period_closed`.
- Métricas mínimas (contadores y última ejecución en `job_runs` o líneas de log; sin infraestructura nueva): reservas denegadas por motivo, promociones y omisiones, retraso del materializador y del barrido, bloqueos aplicados, rechazos de autorización, fallos de subida.
- Preguntas que el sistema debe poder responder:

| Pregunta | Dónde |
|---|---|
| ¿Por qué se denegó una reserva? | `reasons[]` de la respuesta y el log |
| ¿Por qué no se promocionó a alguien? | `last_evaluation_reason` |
| ¿Por qué se bloqueó el acceso? | `assignment_access_events` (causa y `effective_at`) |
| ¿Quién cambió un permiso? | auditoría compartida (`rbac`) |
| ¿Quién devolvió un derecho? | `calendar_reservation_cancellations` / ajustes de consecuencia |
| ¿De qué periodo salió una sesión? | `calendar_reservation_rights.entitlement_period_id` |

- Alertas: retraso del materializador o del barrido, eventos de outbox en `dead_letter`, errores de almacenamiento, incidencias `entitlement_period_missing`. El `/health` se amplía con el estado de los jobs.

## EXTERNAL DEPENDENCIES

| Dependencia | Efecto |
|---|---|
| Proveedor real de autenticación/identidad de staff (ADR pendiente) | Bloquea **solo** la activación de RBAC granular en producción y la identidad de actores reales en overrides. No bloquea el diseño ni la construcción. |
| Hosting final y proveedor de `ObjectStorage` | Define el adaptador de producción de D. No bloquea D (adaptador local + S3-compatible). |
| Decisión humana sobre solapes históricos (B-1a) | Bloquea **solo** B-1b (la restricción fuerte). |

## REMAINING OPEN DECISIONS

1. **Proveedor de autenticación/identidad de staff.**
2. **Proveedor/hosting final de `ObjectStorage`.**
3. **Resolución humana de los solapes históricos que detecte el informe de B-1a** (se decide con datos reales, al ejecutarlo).

Ninguna bloquea 098-0. No hay decisiones de producto abiertas.

## CONSECUENCIAS DE LAS DECISIONES

No son decisiones nuevas; son efectos de las decisiones aprobadas que el propietario debe conocer.

1. Una mensualidad natural **no puede asignarse una vez empezado el mes** (ni siquiera el día 2): se asigna por adelantado o el propio día 1. Un cliente que entra con el mes avanzado, o un registro tardío, usa un plan de rango parcial definido por 2J («Medio Mes · …»), con su precio explícito. En la práctica el plazo de 5 días desde la asignación (P-02) se aplica a esos planes de rango parcial y a los planes largos, no a la mensualidad natural.
2. La pausa de un plan no extiende los periodos (las fechas son de calendario); cualquier compensación es un `adjustment` manual.
3. Los contratos que empiezan el último día de su mes mantienen semántica de fin de mes (31/01 + 3 meses → 30/04; 30/11 + 3 meses → 28/02 o 29/02). Caso límite documentado: un inicio en día 29 o 30 que **no** es fin de mes y cuyo mes destino no tiene ese día usa el aniversario recortado al último día del mes destino y termina el día anterior (29/11/2026 + 3 meses → 27/02/2027).
4. La vigencia de un bono nuevo cuenta el día de inicio (90 días desde 12/10 acaba el 09/01); el modelo legacy trata `anchor + valid_days` como último día válido. El legacy no cambia.
5. La suma de las bolsas de los subperiodos puede diferir del redondeo del total (cada subperiodo se redondea por separado).
6. Sin festivos: un mes con muchos festivos da la misma bolsa que uno sin ellos.
7. Un cargo de bono/puntual necesita `due_on` (NOT NULL); se fija en asignación + 5 días solo para listados de impagos; el acceso depende de la activación por pago.
8. Bloqueo por contrato: un contrato largo impagado bloquea las nuevas reservas de todos sus periodos, no de otros productos del cliente.
9. Cambiar de plan expira también los periodos futuros del contrato anterior.

## DEFINITION OF DONE

- Todos los PRs del plan mergeados, cada uno con su handoff, sus tests y una revisión independiente de SHA exacto.
- Cada capacidad nueva detrás de un flag documentado, con rollback verificado.
- Ninguna migración destructiva; todas probadas con datos heredados.
- Solape de profesional imposible por la BD; `GET` Member sin escrituras.
- Un contrato largo **nunca** funciona como bolsa única: cada subperiodo tiene su bolsa, su grant, su snapshot y su caducidad; la reserva consume del periodo de su fecha y la restauración vuelve al mismo periodo.
- La bolsa se calcula una sola vez, queda congelada y coincide con la tabla de casos; el ledger cuadra con los periodos.
- El bloqueo por pago funciona aunque el barrido esté parado, nunca toca reservas existentes ni el resto de la app, y se reactiva solo al saldarse el cargo.
- Toda cancelación, ajuste, cambio de permisos, override y bloqueo tiene actor y motivo trazables.
- Imágenes de Tienda sin binarios en PostgreSQL, máximo 6 por producto.
- RBAC impuesto en servidor en las rutas migradas, con el golden de permisos actual intacto; flag apagado en producción hasta tener autenticación real de staff.
- Validación completa sobre base limpia y CI verde en cada PR; aceptación visual del propietario para UI visible.
- Este documento y los handoffs actualizados con la deuda restante.

## AGENT HANDOFF RULES

1. **Lee este master antes de cada task.** Después lee el fichero `tasks/2J-098*.md` de tu task y los handoffs de las tasks de las que depende.
2. **No reinterpretes decisiones aprobadas.** Si crees que una decisión es incorrecta o ambigua, para y repórtalo; no la cambies en código.
3. Cada task tiene su propio documento; cada PR tiene su handoff (`docs/handoffs/2J-098<X>-<n>.md` y su JSON máquina si el repo lo exige). Actualízalo al terminar para la siguiente persona.
4. Una task, una rama (`agent/<agent>/<task-id>-<slug>`), un PR. No implementes sobre `main`. No toques `main` directamente durante el trabajo de features.
5. El propietario valida manualmente la UI visible. Los tests no sustituyen la aceptación visual. No registres aprobaciones que no se hayan dado.
6. Antes de mergear, se revisa el SHA exacto del PR. Si el head cambia, se revisa de nuevo.
7. No toques Búnker/Training/`2jfitnessapp` desde Platform salvo integración explícita.
8. No hagas deploy sin autorización expresa. Sin credenciales ni secretos en el repo ni en logs.
9. No añadas decisiones de producto. No amplíes el alcance de la task; la deuda descubierta se registra, no se implementa.
10. Migraciones solo aditivas; número asignado al mergear. Cada migración con test sobre datos heredados.
11. Reglas de tiempo: `Atlantic/Canary`, `date` para reglas de negocio, reloj inyectable en tests.
12. Un PR que cambie el comportamiento de un flujo existente lo hace detrás de un flag y con modo sombra o doble lectura cuando proceda.
