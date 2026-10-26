# Mapeo del prototipo Base44 (`2j-fitness-admin`) contra Platform

Estado: **baseline aprobado por el propietario (resoluciones de §3 a favor de D01–D274; sin copiar código ni datos de Base44). Pendiente de revisión de Work Platform. No se ha fusionado ni desplegado nada.**
Prototipo analizado: `2jfitnesscenter/2j-fitness-admin`, rama por defecto, commit `73c58b5` (229 ficheros; 53 son componentes `ui/` genéricos de shadcn). Revisado después hasta el commit `ccfffdb` (idéntico a la carpeta local del propietario `twoj-fitness-flow`): los 3 commits posteriores solo tocan el portal del socio (lista de espera y reservas, exportar a calendario), que no se adopta.
Platform analizada: `main` en `519e5c1`.
Decisiones de referencia: `REGISTRO-DECISIONES-2J.md` (D01–D274, A01–A33).
Documentos del propietario posteriores (en su Escritorio, no en el repositorio): `UI-REFERENCIA-BASE44-A-PLATFORM.md` (mapa pantalla → ficheros, tokens, qué no adoptar, orden) y `PARIDAD-VISUAL-BASE44.md` (lista de paridad visual); decisiones A34–A53. Donde estas decisiones cambian lo escrito en este mapa, prevalecen.

## 0. Cómo leer este documento y qué NO está verificado

- **Verificado leyendo código:** `base44/shared/*.ts`, las 12 funciones de `base44/functions/*`, las 34 entidades de `base44/entities/*`, `src/lib/permissions.js`, `src/hooks/useAppUser.js` y los puntos concretos citados.
- **Inferido:** la cobertura de Platform se deduce de migraciones (`0001`–`0045`), nombres de módulos en `apps/api/src` y ficheros de `apps/admin-web/src` / `apps/staff-app/src`. No se ha ejecutado Platform ni el prototipo. Donde pone «HAVE» significa «existe un módulo equivalente», no «equivalente en comportamiento».
- **No leído a fondo:** las ~45 pantallas y ~60 componentes del frontend se han clasificado por nombre y por las llamadas que hacen al SDK; no se ha revisado su CSS ni su accesibilidad.
- **No se ha ejecutado el prototipo** (requiere `base44 login/link/dev`, cuenta del propietario). No se ha tocado ningún dato de Base44.
- Las cifras de esfuerzo de §5 son estimaciones de orden de magnitud, no compromisos.

Leyenda: **HAVE** = Platform ya lo cubre · **MISSING** = Platform no lo tiene · **DIFFERENT** = existe en ambos pero con modelo o regla distintos.

## 1. Mapa pantalla a pantalla

Destinos: `admin-web` (panel de escritorio), `staff-app` (móvil del personal), `client-app` (Home, solo se menciona cuando el prototipo mezcla portal de socio), módulo Platform = `apps/api/src/*`.

### 1.1 Personal (`src/pages/*.jsx`)

| Pantalla Base44 | Qué hace | Destino en Platform | Estado |
|---|---|---|---|
| `Dashboard` | KPIs, alertas, sesiones de hoy | `admin-web/command-center.tsx` + `api/dashboard.ts` | HAVE (revisar KPIs concretos) |
| `Agenda`, `SessionDetail`, `components/agenda/*`, `components/work/*`, `AttendancePicker` | Rejilla semanal, alta/edición de sesiones, reservas, asistencia | `admin-web/calendar-page.tsx`, `schedule-editor.tsx`, `api/calendar*.ts`, `booking-eligibility.ts` | HAVE / DIFFERENT (§3: recurrencias, lista de espera, asistencia) |
| `Clients`, `ClientDetail`, `components/clients/*` | Listado, ficha con pestañas (Resumen, Cuotas, Reservas, Dinero, Documentos, Historial) | `admin-web/clients-page.tsx`, `api/clients.ts` | HAVE / DIFFERENT (D233–D236: pestañas distintas) |
| `Contracts`, `Plans`, `components/contracts/AssignPlanDialog` | Catálogo de planes y asignación | `api/client-plans.ts`, `assignment-periods.ts`, `contract-assignment-coordinator.ts`, `admin-web/services-page.tsx` | DIFFERENT (D166 una cuota por cliente; Platform tiene `plan_versions`, `plan_rights`) |
| `Payments`, `RegisterPaymentDialog` | Cobros, validación de transferencias, emisión de factura interna | `api/economics.ts`, `economic-extensions.ts`, `admin-web/economics-page.tsx` | DIFFERENT (§3: anulación, devoluciones, factura) |
| `Cash`, `components/cash/*` | Apertura/cierre de caja, movimientos, informe diario | `economic_cash_sessions`, `economic_cash_adjustments`, permiso `billing.cash.manage`; en `admin-web/economics-page.tsx` ya hay tarjeta «Caja de hoy», apertura, cierre y recuento (`/api/economics/cash/today`, `/cash/open`, `/:sessionId/close`) | **HAVE / PARTIAL**. #97 contiene D113 y recuentos ciegos por denominación de apertura/cierre, pero sigue abierto y sin fusionar. Pendientes: explicación obligatoria del descuadre y validación Admin (D97), integración de Staff, traspasos, informe diario completo y otras decisiones de caja |
| `Store`, `components/store/*`, `member/MemberStore` | Productos, variantes, stock, venta interna | `api/store.ts`, migración `0031_store_v1`, `admin-web/store-page.tsx` | HAVE / DIFFERENT (§3: IGIC en ventas) |
| `Promotions`, `PromotionFormDialog`, `DiscountPicker` | Promociones generales con auto-aplicación | — | **Contradice D93** (§3). No adoptar tal cual |
| `Reports`, `components/reports/*` | Ingresos mensuales, impagos | `api/economics.ts` (exportación D109) | MISSING (D108 pide listado simple, sin gráficos) |
| `Documents`, `ClientRecordsTab` | Documentos por cliente, visible al cliente | `document_requirements`, `communications.ts` | DIFFERENT (D150–D155) |
| `Messages`, `MessageDialog` | Buzón staff↔socio | `api/communications.ts` (1660 líneas) | HAVE |
| `Services` | Servicios y salas | `admin-web/services-page.tsx`, tabla `services`, `areas` | HAVE |
| `Team`, `Administration`, `Activity`, `ActivityLog` | Equipo y permisos, auditoría | `api/staff.ts`, `admin-web/staff-page.tsx`, `staff_audit_events` | DIFFERENT (§3: perfiles RBAC) |
| `TimeClock`, `components/timeclock/*`, `member/StaffWork` | Fichaje | `staff_timeclock_events`, `staff_timeclock_corrections`, `staff-app` | DIFFERENT (§3: D115–D123) |
| `Settings`, `components/settings/*` | Negocio, colores, IVA/IGIC, día de pago | `economic_settings`, `dashboard_preferences` | DIFFERENT (§3) |
| `MyGym` | Centro de ajustes con 3 pestañas: datos del negocio, novedades, consentimientos (no es un panel de resultados) | Novedades: `news-page.tsx`; ajustes: `notification-settings.tsx`, `economic_settings` | HAVE parcial. Propuesta de decisión en el PR #96 (`MYGYM-PROPUESTA-DECISION.md`, rama `agent/claude/2J-MYGYM-SPEC`); el propietario ha elegido la opción A (panel de resultados de solo lectura), pendiente de decisión numerada |
| `Login`, `Register`, `ForgotPassword`, `ResetPassword`, `OAuthConsent`, `AuthLayout`, `GoogleIcon` | Identidad (Base44 Auth + Google) | Identidad de Platform (`person-identity.ts`, `platform-passkeys.ts`, `member-pilot-auth.ts`) | **No adoptar**: Platform es la autoridad de identidad |

### 1.2 Portal de socio (`src/pages/member/*`, `MemberShell`)

| Pantalla | Destino | Estado |
|---|---|---|
| `MemberHome`, `MemberBookings`, `MemberBookingSheet`, `MemberMembership`, `MemberProfile`, `MemberSettings`, `MemberStore` | Home (`apps/client-app`), ya cubierto por la cadena Home #76–#92 | HAVE en Home; el portal Base44 **no se adopta** (duplicaría Home, prohibido por «sin apps paralelas») |
| `Bunker` | Entrada a Búnker | Sustituida por SSO/capacidades de Platform (`training-sso.ts`, `training-capabilities-api.ts`) | HAVE, ver §3 y §6 |
| `StaffMembers`, `StaffProfile`, `StaffWork`, `PortalHome`, `PortalProfile` | Acceso móvil de personal | `apps/staff-app` | HAVE parcial; revisar atajos |

### 1.3 Funciones de backend (`base44/functions/*`)

| Función | Qué hace | Equivalente Platform | Estado |
|---|---|---|---|
| `assignPlan` | Vista previa y asignación de cuota; descuento; idempotencia | `contract-assignment-coordinator.ts`, `assignment-periods.ts` | DIFFERENT |
| `registerPayment` | Pago/devolución, ledger, caja | `economics.ts`, `economic_transactions` | DIFFERENT (devolución dentro de la app) |
| `validateTransaction` | Valida/rechaza transferencia | `economic_transfer_proofs`, D102/D105 | DIFFERENT |
| `createBooking` | Elegibilidad, reserva, lista de espera | `booking-eligibility.ts`, `calendar.ts` | DIFFERENT |
| `updateReservation` | Cancelar, asistencia, promoción de lista | `calendar.ts` (`promoteEligibleWaitlist`) | DIFFERENT |
| `refreshOperations` | Barrido: expira contratos, alertas | `term-payment-access.ts`, `domain_events_outbox`, `notifications.ts` | DIFFERENT (Platform es evento/transacción, no barrido) |
| `manageCashSession` | Caja | `economic_cash_sessions` | DIFFERENT |
| `manageTimeClock` | Fichaje | `staff_timeclock_*` | DIFFERENT |
| `registerSale`, `adjustStock` | Tienda | `store.ts` | DIFFERENT |
| `bunkerCapabilities` | Capacidades de Búnker | `training-capabilities-api.ts` (2J-CAPABILITIES-V2/V2.1) | **Reemplazar, no adoptar** (§3 C-18) |
| `linkMemberAccount` | Vincula usuario con ficha por email | H13 / `training-link-*`, `platform_person_clients` | **Reemplazar** (§6 R2) |

## 2. Qué es reutilizable de verdad

Lo más valioso del prototipo no es la lógica (que choca con decisiones y no es transaccional) sino **la interfaz y el producto ya pensado**:

1. **Diseño visual** (grafito + lima `#A4D65E`): Platform ya tiene `docs/design-system` y Design V2; comparar tokens antes de importar nada.
2. **Componentes de presentación sin SDK**: `KpiCard`, `PageHeader`, `StatusBadge`, `EmptyState`, `Skeletons`, `WeekTimetable`, `AttendancePicker`, `DiscountPicker` (solo UI), `CashSessionPanel`/`CloseCashDialog`/`DailyCashReport` (referencia para completar la caja que ya existe en admin-web, no para crearla), tablas de informes. Son React + Tailwind + shadcn; Platform usa CSS propio (`styles.css`, `*-v2.css`). **Hay que reescribir estilos**, no solo cambiar el SDK.
3. **Catálogo de permisos** (`permissions.js`, 40 claves): sirve como lista de partida para los perfiles D124, pero las claves de Platform ya existen con otro nombre (`billing.*`, `store.*`, `staff.*`, `timeclock.*`). Hace falta una tabla de equivalencias, no adoptar las claves.
4. **Flujos de UX**: tarjeta de caja, informe diario, ficha rápida, hoja de asistencia. Útiles como referencia de diseño para el staff-app.

No son reutilizables tal cual: cualquier cosa que llame a `base44.entities.*` / `base44.functions.invoke` / `base44.auth.*` (SDK `@base44/sdk`), ni `useAppUser`, `AuthContext`, `ProtectedRoute`, `app-params`.

## 3. Reglas de negocio de `shared/gym.ts` y funciones frente a D01–D274

Cada fila es una contradicción o hueco **comprobado leyendo el código citado**.

| # | Prototipo | Decisión | Veredicto |
|---|---|---|---|
| C-01 | Un cliente puede tener **varios contratos activos**; `evaluateEligibility` itera `activeContracts` y devuelve `options[]` (selección de cuota al reservar) | D166: **una sola cuota vigente**, sin selección de cuota al reservar | Contradice. El modelo `Contract` + `EntitlementPeriod` por contrato no sirve tal cual |
| C-02 | Mensual: vencimiento día `due_day` (10) del mes de inicio, bloqueo desde `día+1 T00:00`, hora de Canarias, texto comparado como cadena local | D99/D103: día 10, bloqueo día 11 00:00 Canarias | Coincide en la regla; **`due_day` también está en `Plan` y en `AppSetting`** (tres sitios) frente a una sola configuración económica en Platform (`economic_settings.due_day`) |
| C-03 | `bunkerCapabilities` compara `new Date().toISOString()` (UTC) con `restrict_from` (hora local de Canarias, sin zona) | D99: bloqueo a las 00:00 de Canarias | **Error de zona horaria**: el bloqueo se aplicaría con 0–1 h de desfase (según horario de verano). `isRightBlocked` sí usa hora local; solo falla esa función |
| C-04 | No mensual: plazo = alta + `grace_days` (5) días; `payment_first` para bonos/sesión suelta | Platform: reglas `monthly_day10_v1`, `grace_from_assignment_v1`, `on_payment_v1` | Equivalentes; Platform añade `payment_block enforce/off` que el prototipo no tiene |
| C-05 | Parcial cuenta como no pagado a efectos de bloqueo (`charge.status !== 'paid'`) | D99/D250: parcial no marca pagada hasta cubrir | Coincide |
| C-06 | Los pagos se **rechazan o se devuelven** (`status: rejected`, `type: refund`); no existe «Anulado» | D252/D253: se **anula** un pago (no se borra), recalcula deuda y derechos, bloqueo inmediato si activó la cuota | Hueco. Falta anulación, bloqueo inmediato (D253), recuperación de reservas (D254–D255) |
| C-07 | `registerPayment` permite **devoluciones dentro de la app** con permiso `finances.view` y la caja las resta del efectivo | D94: la devolución se hace fuera de Platform; D259–D262: saldo a favor y devoluciones solo en contabilidad (admin) | Contradice. Además la devolución se autoriza con `finances.view` (un permiso de lectura) sumado a `payments.register` |
| C-08 | Caja: `cash_in`/`cash_out` manuales (`CashMovement`: aportes y retiradas) | A47 revierte D98: se permiten gastos y retiradas con permiso específico, tipo y motivo obligatorios; A49 hace opcional el justificante; A50 permite un límite configurable opcional sin valor predeterminado. A46 deja Promociones visible sin efecto en precios; A48 trata perfiles de permisos | **Decisiones separadas; no adoptar el modelo Base44 tal cual.** Los movimientos requieren permisos, auditoría, vínculo al turno y efecto en el cierre. La implementación queda fuera de #97 y de esta revisión; diseño/implementación posterior |
| C-09 | Se bloquea el cobro sin caja abierta **solo para efectivo** | D113: bloquear cobros de **cualquier** método hasta abrir turno | Contradice en el prototipo. El PR #97 contiene el guard de todos los métodos y pruebas asociadas; sigue abierto y sin fusionar, por lo que no se presenta como capacidad integrada en `main` |
| C-10 | Cierre de caja: nota opcional; descuadre genera notificación | D97: explicación **obligatoria** y validación posterior de Admin; D111: recuentos ciegos por denominación | D111 está implementado en el head abierto de #97 para apertura/cierre; no está fusionado. D97, la validación Admin, la integración de Staff y el informe diario siguen pendientes |
| C-11 | Promociones generales con `auto_apply`, ámbito tienda/cuotas, mínimo, fechas | D93: solo descuentos **individuales** por cliente; sin promociones generales ni códigos | **Decisión A46:** el menú Promociones SE DEJA visible pero **sin efecto en precios** (D93 sigue vigente). No crear lógica de precios ni tabla `Promotion` |
| C-12 | `Charge.invoice_number/invoice_status`, `invoice_prefix`; `Payments.jsx` emite factura con una escritura directa desde el navegador | D106/D107: ticket por defecto, factura solo a petición, **pendiente validación fiscal**; puerta fiscal `fiscal_legal_gate_open=false` | Contradice y es riesgo legal. En Platform existen `economic_invoice_series`, `economic_fiscal_documents` bajo la puerta fiscal |
| C-13 | `registerSale` guarda `tax_amount: 0`; el IGIC de la tienda no se calcula | D169: IGIC según configuración fiscal | Hueco (error de importes) |
| C-14 | Cancelación: horas por servicio, pero **consumo de la sesión tardía por ajuste global** `late_cancellation_consumes` | D87: plazo configurable por servicio; tardía libera plaza y consume | Parcial. Falta el consumo por servicio |
| C-15 | No-show: `no_show_consumes` configurable (puede no consumir); **no hay cancelación tras 3 ausencias** | D78: la ausencia consume; a la 3.ª consecutiva se cancelan reservas futuras; contador a 0 al asistir | Contradice / hueco |
| C-16 | Lista de espera: activar/desactivar global (`waitlist_enabled`), promoción FIFO de los 5 primeros, con `override: true` (salta documentos y firmas) | D69/D70: configurable **por servicio**; D207 FIFO; D208 «Suspendida»; D210 cancelar esperas solapadas; D201–D205 protección de última hora; D215 | Parcial. FIFO sí; faltan por servicio, suspendida, solape, protección, avisos |
| C-17 | Cancelar una sesión (`SessionDetail.jsx:70`) = **escritura directa desde el navegador** `GymSession.update(status: 'cancelled')`, sin devolver sesiones ni avisar ni limpiar lista | D79: cancelación manual que anula reservas, devuelve sesiones, notifica y retira la lista | Contradice: las reservas quedan huérfanas |
| C-18 | `bunkerCapabilities` decide el nivel por **expresión regular sobre el nombre del plan** (`/fuerza\|full\|premium/`) y cuenta una cuota pendiente como `suspended` | Contrato 2J-CAPABILITIES-V2/V2.1; D40/D41 | Contradice y es frágil: Platform ya tiene `plan_module_capabilities` y `training-capabilities-api.ts`. Eliminar del alcance |
| C-19 | Permisos: `User.permissions[]` **por usuario** + `permission_scope` (`all`/`own`) | D124: perfiles reutilizables, **sin excepciones individuales** | Contradice. (pendiente el punto 5 de la sección E del registro: confirmar que «entrenadores» significa «perfiles con ese permiso») |
| C-20 | Fichaje: una entrada abierta de un día anterior se cierra sola con `clock_out = clock_in` y `minutes = 0` | D123: **nunca se inventa la hora**; D115: registros inalterables; D116: solo el trabajador corrige conservando original | Contradice. Además RLS permite a cualquier admin modificar `TimeEntry` (D116: el admin consulta, no modifica) |
| C-21 | Sesiones usadas: `sessions_used` se lee y se reescribe sin transacción; la capacidad se comprueba **después** de crear la reserva y se compensa borrándola | D244/D246: movimientos de sesiones inalterables y compensables; transacciones | Riesgo de carrera (doble consumo, saldo perdido). Platform usa `client_entitlement_ledger` y bloqueos `FOR UPDATE` |
| C-22 | Sesión empezada: no se puede reservar (`start <= ahora`) | D86: se puede reservar hasta el inicio | Coincide |
| C-23 | `weeksInRange` redondea 4/5 semanas por mes y media cuota proporcional | D168 | Coincide en intención; **no verificado numéricamente** contra `assignment-periods.ts`: propongo un test de propiedades cruzado antes de decidir |
| C-24 | Reserva: el personal con `bookings.cancel` puede forzar `override` y saltar documentos/firmas/capacidad | D65: contratos obligatorios bloquean; D75: cortesías no eluden bloqueos administrativos | Riesgo: `override` no exige motivo ni deja traza específica |
| C-25 | Descuentos manuales sobre cuota/venta con permiso `discounts.apply` | D257/D258 | Parcial: sirve la idea; faltan reglas de modificación con pagos (D258) |
| C-26 | Congelación: no existe; pausas: no existen | D89/D269 | Coincide |
| C-27 | Renovación automática por cliente | D90 | No existe en el prototipo (MISSING) |

## 4. Diferencia de modelo de datos

El prototipo guarda **documentos NoSQL planos con copias de nombres** (`client_name`, `plan_name`, `service_name`) y claves de texto sin integridad referencial. Platform es relacional (Postgres), con migraciones, auditoría y claves.

| Entidad Base44 | Entidad / tabla Platform | Diferencias clave | Impacto de migración |
|---|---|---|---|
| `Client` | `clients`, `platform_persons`, `platform_person_clients`, `client_fiscal_profiles` | `health_notes` y `notes` libres en la ficha; sin separación persona/cliente; `user_id` plano | **No migrar `health_notes`** (R1). Identidad y vínculo cambian a `platform_person_*` |
| `User` (`staff_role`, `permissions`, `client_id`) | `platform_person_staff`, `staff_professionals`, perfiles | Rol en el usuario; permisos por usuario | Rediseñar a perfiles D124; no migrar |
| `Plan` | `plans`, `plan_versions`, `plan_rights`, `plan_services` | `plan_type` enumerado con 8 tipos; versión por `previous_version_id`; `due_day`/`grace_days` en el plan | Mapear tipos a `payment_rule`/`term_kind`; el catálogo es pequeño y se recrea a mano, no se migra |
| `Contract` + `EntitlementPeriod` | `client_plan_assignments`, `assignment_contract_terms`, `assignment_entitlement_periods`, `client_entitlement_ledger` | Varios contratos por cliente frente a una cuota (D166); contador `sessions_used` frente a libro de movimientos | Solo datos de prueba. Los reales se asignan a mano (D141: de TIMP no se importan cuotas) |
| `Charge` | `economic_charges` | `invoice_*` en el cobro; derivados (`paid_amount`, `net_paid`) guardados | Sin migración de datos |
| `EconomicTransaction` | `economic_transactions`, `economic_payment_splits`, `economic_transfer_proofs` | Sin estado «Anulado»; devoluciones como tipo | Sin migración de datos |
| `CashSession`, `CashMovement` | `economic_cash_sessions`, `economic_cash_adjustments` | Movimientos manuales (C-08) | A47 autoriza gastos/retiradas con permiso, tipo y motivo; A49 deja el justificante opcional y A50 deja opcional un límite sin valor por defecto. A46 es Promociones (sin efecto en precio) y A48 perfiles. El diseño posterior decidirá si ampliar `economic_cash_adjustments` o crear una tabla |
| `Sale`, `SaleLine`, `Product`, `ProductVariant`, `InventoryMovement` | `store_sales`, `store_sale_lines`, `store_products`, `store_product_variants`, `store_inventory_movements` | Equivalentes casi 1 a 1; IGIC | Catálogo de productos se puede importar por script (datos no personales) |
| `GymSession`, `Reservation`, `WaitlistEntry` | `calendar_sessions`, `calendar_reservations`, `calendar_waitlist_entries`, `recurring_session_templates`, `calendar_reservation_rights` | `booked_count` almacenado; sin recurrencias con excepciones | Solo datos de prueba |
| `Service`, `Area` | `services`, `areas` | Equivalentes | Catálogo a mano |
| `TimeEntry` | `staff_timeclock_events`, `staff_timeclock_corrections` | Mutable frente a inalterable | No migrar |
| `ConsentForm`, `ConsentAcceptance` | `client_consent_versions`, `client_consents`, `client_consent_acceptances`, `client_forms` | Sin revocación; `content_snapshot` libre y creable por el propio socio | Revisar con jurídico antes de reutilizar nada |
| `ClientDocument` | `document_requirements`, tablas de comunicaciones | `doc_type: health` como categoría de documentos; `file_uri` en almacenamiento de Base44 | **No migrar documentos** (R1) |
| `Message` | `communication_messages` etc. | Equivalente | Sin migración |
| `News` | `center_news` | Equivalente (Platform más completo, D67) | Sin migración |
| `Notification` | `notifications`, `domain_events_outbox` | Platform usa outbox | Sin migración |
| `AuditEvent` | `*_audit_events` por dominio | Una tabla global frente a auditoría por dominio | Sin migración |
| `Promotion` | — | Contradice D93 | No crear tabla |
| `AppSetting` | `economic_settings`, `dashboard_preferences`, `notification_settings` | Un único registro con ~25 ajustes mezclados | Dividir por dominio |

Conclusión de migración: **no debe haber datos reales que migrar desde Base44** (regla del propietario: sin datos reales ni de salud en Base44; no se ha comprobado el contenido de la cuenta). El impacto es de diseño: ninguna migración SQL nueva es necesaria para el mapeo; las que surjan de §5 pasarán por el flujo de revisión habitual.

## 5. Plan de adopción propuesto

Principio: **Platform conserva identidad, cuotas y derechos; el prototipo aporta interfaz y producto, no lógica ni datos.** Primero se decide qué pantallas faltan de verdad; después se reescribe su frontend sobre la API de Platform.

### Fase 0 — Decisiones (sin código)
- Aprobar este documento y la tabla §3 (qué contradicciones se resuelven a favor de la decisión, que es la postura por defecto).
- Confirmar con el propietario los huecos de producto que el prototipo sugiere y no tienen decisión: `MyGym`, informe diario de caja, ficha rápida.
- Esfuerzo: 1–2 días de revisión.

### Fase 1 — Completar lo que ya tiene backend
1. **Completar la caja existente en `admin-web` y conectarla con `staff-app`.** El PR #97 (abierto, sin fusionar) contiene D113 y los recuentos ciegos por denominación de apertura/cierre. A continuación quedan D97 (explicación obligatoria y validación Admin), integración de Staff, traspasos, movimientos según A47 (tipo/motivo y permiso), justificante opcional A49, límite opcional sin valor predeterminado A50 e informe diario. A45 aprueba horario editable por propietario, turnos asignados por propietario y alertas de cobertura; su implementación espera a que #97 se integre. A46 deja Promociones visible sin efecto en precios; A48 define perfiles de permisos. No se adopta `CashMovement` como lógica de Base44; se reutiliza solo como referencia visual. **Estimación pendiente de replanificación.**
2. **Informe económico simple** D108/D109 (listado con filtros + exportación Excel) con la vista de `Reports`/`IncomeTable` como referencia visual. **~4–6 días.**
3. **Hoja de asistencia en detalle de clase** (D218–D224) con `AttendancePicker`/`SessionAttendanceSheet` como referencia. **~3–5 días.**

### Fase 2 — Huecos de dominio en la API de Platform
(Todo con tests y migraciones revisadas por Work Platform; nunca copiando funciones Base44.)
4. **Anulación de pagos y recuperación de reservas** (D252–D255, C-06). **~8–12 días.**
5. **D97 y caja restante por separado:** D111 ya está en el head abierto de #97 para conteo por denominación en apertura/cierre; D97 (explicación obligatoria y validación Admin), Staff, handover y vista diaria están pendientes y se abordarán tras integrar #97. **Estimación pendiente.**
6. **No-show y 3 ausencias** (D78, C-15). **~4–6 días.**
7. **Lista de espera por servicio, suspendida y solape** (D69–D72, D201–D214). **~10–15 días.**
8. **IGIC en ventas de tienda** (C-13). **~2 días.**
9. **Cancelación de sesión por el centro** (D79, C-17) **si no está ya cubierta** (verificar primero en `calendar.ts`). **~3–5 días.**

### Fase 3 — Pulido
10. Perfiles RBAC con equivalencias de permisos (D124), acceso móvil del personal (D128–D130). **~5–8 días.**
11. Recorrido visual de Home y admin con los tokens del prototipo, solo si Design V2 aprueba la paleta. **~3–5 días.**

Total aproximado: **50–80 días de ingeniería** repartidos en fases independientes; la Fase 0 y las tres primeras del punto 1–3 se pueden hacer sin tocar migraciones.

**Orden recomendado:** 0 → 1.1 (caja) → 2.8 (IGIC) → 1.3 → 2.4 → 2.5 → 2.6 → 2.7 → 2.9 → 1.2 → 3.

**Qué no se adopta** (queda cubierto o prohibido): portal de socio Base44 (duplica Home), autenticación Base44/Google, `linkMemberAccount`, `bunkerCapabilities`, `Promotion` como lógica de precios (el menú sí queda visible y sin efecto), factura interna, la idea de «un único cajón por día» (la sustituye el traspaso A39–A41), `TimeEntry` mutable, almacén `file_uri` de Base44, cualquier endpoint «Base44 functions».

## 6. Riesgos

### R1 — Salud (categoría especial, RGPD)
- `Client.health_notes` es texto libre en la ficha; `ClientDocument.doc_type = health` mezcla documentos médicos con contratos y recibos; el acceso se controla con un permiso de interfaz (`clients.view_private`, `ClientSummaryTab.jsx:66`).
- Falta: consentimiento expreso y revocable (D16, D23), mínima información (D02), aviso discreto sin diagnósticos (D22), **registro de accesos de lectura** (solo se audita escritura), conservación por tipo (D33, pendiente de validación jurídica) y autorización del cliente para que el personal edite (D18).
- La política RLS de Base44 devuelve `Client` completo (incluido `health_notes`) a cualquier admin de la app; los datos viajan al navegador.
- **Regla propuesta:** ningún dato de salud entra en Base44 ni se importa de allí. En Platform, la salud sigue las decisiones D02/D16–D23/D32/D33 y el permiso `health.read` ya existente. No empezar ningún trabajo de salud hasta cerrar D33 con asesoría jurídica.

### R2 — Vinculación de miembros por correo
- `linkMemberAccount` carga **todas** las fichas (`Client.filter({})` con rol de servicio) y vincula por **coincidencia de email** sin demostrar el control del correo ni de la cuenta. Quien se registre con el email de otro socio recibiría su ficha, sus cobros, documentos y mensajes (el `bulkUpdate` reescribe `client_user_id` en nueve entidades).
- Contradice D142 (el cliente acredita control de ambas cuentas), D143 (fallos los resuelve un administrador) y D140 (verificación).
- **Sustituir por** el vínculo asistido H13 (permiso `platform_link_issue`, doble control, ledger, paso de seguridad de un solo uso) y el flujo ya implementado `training-link-*` / `platform_person_clients`. Nada de este código se reutiliza.

### R3 — Detección de personal por rol
- `isStaffUser(user)` = `staff_role` informado **o** `role === 'admin'`. `User.staff_role` y `client_id` pueden ser modificados por «editores» de la app Base44; el propio comentario del esquema dice «UI only; never trusted», pero las funciones sí lo usan como autoridad.
- La seguridad real depende de reglas RLS por rol de Base44 y de comprobaciones `hasPermission` que se saltan para `admin`.
- **Sustituir por** passkeys (`platform_passkeys`) y perfiles de permisos de Platform (D124–D128); el servidor decide siempre, no el cliente.

### R4 — Otros
- **Lógica en el navegador.** Escrituras directas desde el cliente sin función de servidor: emisión de factura (`Payments.jsx:299`), cancelación de sesión (`SessionDetail.jsx:70`), alta/edición de planes y servicios. Cualquier admin puede reescribir importes y estados saltándose reglas.
- **Concurrencia.** Contadores leídos y reescritos sin transacción (C-21).
- **Alcance de cuenta Base44.** El prototipo debe seguir **sin datos reales** y con usuarios sintéticos. Cualquier prueba con personas reales rompería la regla «sin datos reales/de salud en Base44».
- **Dependencia de proveedor.** `@base44/sdk`, `base44/` y despliegue en Base44 no son portables; la reutilización se limita a la capa de presentación.
- **Licencias y activos.** Resuelto: el propietario confirma que logos e imágenes del prototipo son del centro y pueden reutilizarse.
- **Fiscal.** Cualquier función de factura queda detrás de la puerta `fiscal_legal_gate_open` y de la validación fiscal de D106.

## 7. Decisiones por defecto (aprobadas por el propietario)

1. Las contradicciones de §3 se resuelven siempre a favor de D01–D274, no del prototipo.
2. El prototipo se conserva como **catálogo de diseño y referencia de UX**, sin integrarse en el despliegue ni conectarse a Platform.
3. No se copia código de `base44/` a Platform. Se reescribe frontend sobre la API de Platform.
4. Primer trabajo concreto: completar la caja existente. #97 incluye D113 y D111 para apertura/cierre; tras su integración quedan D97, la conexión de Staff y el resto del flujo de caja.

## 8. Qué necesito del propietario

- (Resuelto) El documento lo revisa Work Platform; el baseline de contradicciones ya está aprobado por el propietario.
- MyGym: opción A aprobada en A36; las cuatro pestañas (Panel, Datos del negocio, Novedades y Consentimientos) constan en A51. El informe diario de caja queda dentro de la vertical de caja.
- La cuenta Base44 no se ha comprobado y no debe contener datos reales. Según A53, `2j-platform` permanece público por ahora; medir el uso de Actions durante una semana después de #99 y revisar el dato conforme a esa decisión. No hay cambio de visibilidad autorizado.
- (Resuelto) Logos e imágenes: propiedad del centro, reutilizables.

## 9. Siguiente paso

Revisión de Work Platform de este documento. Hasta entonces: ninguna implementación, ningún merge, ningún despliegue.
