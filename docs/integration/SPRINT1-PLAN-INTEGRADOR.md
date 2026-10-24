# Sprint 1 — plan del integrador (contratos entre sistemas y E2E)

Estado: **propuesta con evidencia**, solo documentación. Nada desplegado, ninguna migración real, ninguna clave creada. Fecha de los datos: 2026-10-23 (`origin/main` de Platform = `c94830f`).
Fuente de verdad: REGISTRO-DECISIONES-2J v1.1. Lo marcado «(por defecto)» es una decisión que apliqué yo siguiendo la recomendada del registro y que el propietario puede cambiar.

## 1. Revisión de #64–#67 contra D142, D143, D158, A20, A23

| Requisito | Estado en #64–#67 / #56–#57 | Evidencia | Hueco |
|---|---|---|---|
| **Vínculo bilateral activo, único y revocable** entre persona y UID de Búnker | **Hecho** | Platform: `training_account_links` con triggers (activar exige ACK de Training; un vínculo no terminal por persona y por UID; revocar exige ACK o renuncia auditada). Búnker: `platformLink` + `/link/activate`, `/link/revoke`. Tests: `training-link-flow.test.mjs`, E2E vinculación 9/9. | — |
| **A23** usuarios actuales de Búnker se mantienen y conservan acceso | **Hecho** | Modo `legacy` por usuario y por defecto (SSO y passkey por igual); diferencial `main` vs rama: 62/63 idénticas, la única diferencia intencionada es `PUT /api/data` con array → 400. | — |
| **D142/A20** el correo verificado solo SUGIERE; ambas cuentas deben confirmar | **Parcial** | La confirmación de ambas partes existe (prueba del dueño en Búnker con passkey + recibo servidor-a-servidor + confirmación de la persona en Platform). **No existe la sugerencia por correo** (no hay búsqueda por correo ni tabla de sugerencias; `grep` de `suggest`, `candidate`, `review_queue` en `apps/api/src` y migraciones: sin resultados). | Construir sugerencias (§1.1). |
| **D143** vinculación fallida → solo administradores resuelven, con comprobación y registro | **Falta** | No hay cola de revisión manual ni fusión administrativa. | Cola de revisión (§1.1). |
| **D158** baja definitiva coordinada Home + Platform + Búnker | **Falta** | Solo existe la revocación del vínculo; no hay trámite de baja ni borrado/anonimización coordinada. Requiere revisión jurídica (RGPD, plazo de un mes, conservar lo obligatorio). | Diseño con asesor + PR propio (§1.2). |
| Identidad única, sin cuentas duplicadas | **Parcial** | Un vínculo activo por persona y por UID (BD). La fusión de duplicados de personas (D144) no existe. | Sprint 2. |
| Latencia de suspensión (D59–D62) | Parcial | Caché de capacidades ≤ 60 s medida (p50 19 s); señal firmada (PoC, apagada) la baja a < 1 s en loopback. La suspensión actual solo cubre acceso a entrenamiento, no la cuenta completa (conflicto #4 del registro). | Ampliar el modelo (suspensión de cuenta) antes de producción. |

### 1.1 Sugerencia por correo + cola de revisión (siguiente PR de identidad)
Diseño mínimo, sin tocar lo ya construido:
1. Platform pide a Búnker, servidor a servidor (`2J-SERVICE-AUTH-V1`), los UID cuyo **correo verificado** coincide con el de la persona (nuevo endpoint de Búnker que solo devuelve `{trainingUserId, emailVerified:true}` y nunca el correo; A20 confirma que los correos de Búnker están verificados).
2. Se crea `training_link_suggestions(person_id, training_user_id, evidence, status)` con estados `suggested → person_confirmed → training_confirmed → linked | rejected | expired | review_required`. **Sugerir nunca vincula**: el paso a `linked` reutiliza el flujo bilateral existente (ambas cuentas demuestran control).
3. `review_required` cuando haya ambigüedad (varias personas con el mismo correo, varios UID, correo compartido, sin coincidencia tras un intento fallido). Los administradores (no los entrenadores, D143) la resuelven con comprobación de titularidad y registro (quién, cuándo, cómo); auditoría y permiso propio en el perfil RBAC.
4. Tests: correo no verificado no sugiere; dos candidatos → cola; confirmar una sola cuenta no vincula; revocar y volver a sugerir; concurrencia.
Estimación: 1 migración + 1 módulo + 2 endpoints de Búnker + pantallas (las hacen Work Home/Platform). **No lo he empezado**: depende de #64–#67, que siguen en borrador.

### 1.2 Baja definitiva (D158)
Requiere un procedimiento común Home/Platform/Búnker validado jurídicamente (conflicto #38). Técnicamente: orden de baja en Platform → revocar vínculo y sesiones → Búnker anonimiza/borra según política → registro de lo conservado. **No se implementa hasta tener la política de conservación por tipo de dato (D33).**

## 2. SSO Home → Búnker de extremo a extremo en staging, con E2E en CI

- **Hecho en local**: flujo completo con procesos reales (Platform, Búnker, Home) y una pasada con navegador real; 16 + 9 casos E2E (`tooling/e2e`) pasan en mi máquina. **No corren en CI**: necesitan los dos repositorios y una base PostgreSQL.
- **CI propuesto** (workflow nuevo en `2j-platform`, reutiliza `tooling/e2e`): servicio PostgreSQL, checkout de Platform y de Búnker (`2jfitnessapp`), `pnpm install` + `npm ci`, ejecutar `training-sso.e2e.mjs` y `training-link.e2e.mjs`. **Necesita un secreto**: un token de solo lectura del repositorio de Búnker (`secrets` = aprobación del propietario). Alternativa sin secreto: mover el job al repositorio de Búnker, que ya contiene el código a probar, y hacer checkout de Platform (también requiere acceso entre repos si ambos son privados).
- **Staging real** con los builds reales de Home y Búnker: **no se puede sin aprobación** (despliegue, DNS/Caddy, secretos). El diseño está en `docs/design/2J-INT-staging-mode.md` (en #67). Propongo no desplegar nada hasta que el propietario apruebe hosts y secretos; mientras tanto el E2E local es la evidencia.

## 3. Push (D152, D176, D199, D209, D211, D248, D255) — hecho en #71
Proveedor: **Web Push estándar (VAPID)** con `web-push`: gratis, Android y iOS (solo PWA añadida a pantalla de inicio), el contenido solo lo ve el servicio push del navegador. Alternativas descartadas (FCM, OneSignal) con motivos en `docs/handoffs/2J-PUSH-INFRA.md`. Entrega: tablas de consentimiento/suscripciones/intenciones/entregas, API `enqueuePushIntent(tx, …)`, dispatcher con un reintento, rutas `/api/me/push/*`, hook de Home. Apagado por defecto. Falta: conectar cada módulo (lista de espera, cambio de cuota, corrección de pago, documentos) — son PRs de esos módulos — y claves VAPID (secreto → aprobación).

## 4. Contrato de capacidades V2.1 (D40/D41) — propuesta para acordar con Work Búnker y Work Home

**Problema (conflicto #1 del registro):** V2 deja `guidedTraining` y `premiumPrograms` fuera de la línea base gratuita; D40 permite «Entrena con 2J» y Premium sin cuota y D41 hace Premium gratuito para registrados. No permite IA ni seguimiento profesional.

| Capacidad | V2 base | **V2.1 base (registrados sin cuota)** | Con cuota |
|---|---|---|---|
| autonomousTraining, personalRoutineCreation, personalRoutineManagement, workoutRecording, workoutHistory | sí | sí | sí |
| **guidedTraining** («Entrena con 2J») | no | **sí** (D40) | sí |
| **premiumPrograms** | no | **sí** (D41) | sí |
| aiCoach (IA, rutinas con IA) | no | no (D40) | según cuota |
| professionalFollowUp | no | no (D40) | según cuota |
| routineCreation (comercial) | no | no (informativa, ADR-2J-INT-001) | según cuota |

Cambio de contrato:
- Identificador nuevo `2J-CAPABILITIES-V2.1` (no cambiar el significado de V2 en silencio: los consumidores V2 validan la base **exacta** y rechazarían V2.1). Misma forma de respuesta, mismo TTL ≤ 60 s, `generatedAt/expiresAt`, mismas razones; solo cambia la tabla de la base y un campo `contract` distinto.
- Endpoint versionado `/api/internal/platform/v2.1/persons/:personId/training-capabilities`; V2 sigue sirviéndose hasta que Búnker migre; el canje SSO (v2) incluye el contrato pedido (campo opcional `contract` en la petición de canje, por defecto V2).
- Consumidor de Búnker: tabla de base por identificador de contrato (`platform-sso/capabilities.js`, corpus de 59 escenarios ya existente → se añaden los casos V2.1); `route-policy.js` ya decide por capacidad, así que `/api/guided`, `/api/premium`, `/api/opposition` se abren **solo** cambiando la tabla (sin tocar rutas). `COMMERCIAL_SUBTREES` mantiene `coach` (IA) y deja libre `premium`/`opposition` por capacidad; los programas guiados (`guidedTraining`) también quedan libres.
- Home: sin cambios de pantalla; solo lee el contrato.

**Preguntas para el propietario/Works (con respuesta por defecto):**
1. ¿«Oposiciones» (`/api/opposition`) cuenta como Premium gratuito? *(por defecto: sí, usa `premiumPrograms`)*.
2. ¿«Registrado» = cualquier persona con vínculo activo a Búnker, o también quien aún no tiene vínculo? *(por defecto: solo con vínculo activo; sin vínculo Búnker no tiene identidad que consultar)*.
3. Acordar con Work Búnker el nombre del contrato y con Work Home el uso de `guidedTraining` en la tarjeta de Búnker.
No implemento nada de V2.1 hasta tener el acuerdo de los dos Works (el cambio toca Platform + Búnker + corpus y rompe el consumidor V2 si se hace a medias).

## 5. Orden de integración propuesto y conflictos detectados

Archivos solapados entre PRs abiertos de Platform (calculado con `git diff` contra el merge-base de cada uno):
| Par | Archivos | Gravedad |
|---|---|---|
| #67 (pila SSO) × #71 (push) | `apps/api/package.json`, `pnpm-lock.yaml`, `apps/api/src/server.ts`, `apps/api/.env.example`, `apps/api/test/services.test.mjs` | **conflicto seguro de texto** en `package.json` (es un JSON de **una sola línea**: cualquier cambio de dos PRs choca). Resolución trivial: rebase del segundo en fusionarse. `services.test.mjs`: #64 y #71 llevan el **mismo** parche (sin conflicto). |
| #67 × #52 (pila Design V2) | `apps/api/package.json`, `pnpm-lock.yaml`, `apps/api/src/{schema,server}.ts`, `.gitignore` | mismo caso; #52 además renumera 0033 (§ siguiente). |
| #70 (calendario) × #52 | 22 archivos de `admin-web` (calendario) | **alto**: ya señalado en el handoff de Codex; resolver rebasando #52 sobre #70 o al revés. No lo toco (interfaz de Work Platform). |
| #67 × #69, #69 × #71 | `apps/api/test/services.test.mjs` (hunks distintos) | bajo |
| #71 × #52 | `package.json`, lockfile, `server.ts` | mismo caso |

**Orden recomendado (Platform), cada paso con su CI en verde y aprobación previa del propietario:**
1. **#69** (checksums + LF + prefijos únicos): sin dependencias, CI verde, desbloquea `pnpm build` en Windows y protege las migraciones. *Primero.*
2. **#70** (calendario, Codex) y la pila Design V2 **#50→#51→#52**: Work Platform decide su orden; antes de #52 hay que **renumerar `0033_store_product_media`** (propuesta en el informe de #69: `0039` si entra antes de la pila SSO, `0044+` si entra después; el volumen de revisión visual que ya la aplicó debe recrearse).
3. **#71** (push): independiente de lo demás; migración 0044.
4. **Pila SSO #64→#65→#66→#67** (migraciones 0039–0043), **después** de que el propietario decida el consumidor de Búnker y los commits visuales de Home (que están en #65, ver `PR-DEPENDENCIES.md` en #67). Búnker (#56→#57) **antes** que Platform en cualquier despliegue.
5. Numeración de migraciones: reservar **0039–0043 para la pila SSO**, 0044 push; el test de prefijos únicos (#69) evita duplicados, pero no huecos (intencionado).

Búnker (`2jfitnessapp`): #56 → #57; la rama `codex/bunker-v2-snapshot-consumer-prep` (consumidor alternativo) sigue sin fusionar; recomendación de `CONSUMER-COMPARISON.md`: conservar `platform-sso`.

## 6. Decisiones aplicadas por defecto en esta pasada
1. Migración de push numerada **0044** para no chocar con la pila SSO. 2. Avisos «imprescindibles» (D38) requieren un dispositivo registrado y no se envían tras retirar el consentimiento. 3. Un navegador compartido pertenece a quien se registró último. 4. Kinds de push limitados a los aprobados; D25, D187, D206 y reactivación de espera (D209) sin push. 5. «Registrado» en V2.1 = con vínculo activo (pregunta 2).

## 7. Necesito del propietario
Aprobar: (a) secreto de lectura entre repositorios para el E2E en CI; (b) claves VAPID cuando haya entorno; (c) hosts/secretos de staging; (d) orden de fusión del §5; (e) respuestas a las 3 preguntas de V2.1 (o confirmar los defaults). Nada de esto se ha hecho.

## 8. Siguiente
V2.1 en cuanto acuerden Work Búnker y Work Home; PR de sugerencias/cola de revisión (§1.1) cuando el orden de fusión de #64–#67 esté decidido; Sprint 2: importación de Excel (D144, D163) y suite E2E de regresión.
