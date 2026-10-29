# Propuesta de diseño — Fila 18: Invitaciones

**Estado:** propuesta documental para revisión; no implementa rutas, tablas ni cambios de identidad.  
**Base revisada:** `origin/main` — `abd31b89ffc2ce64c9fae167f2226267234b2348`.  
**Alcance:** invitaciones de socios del prototipo, alineadas con la identidad Platform y el vínculo asistido H13.

## Decisión de arquitectura

La fila 18 del mapa de paridad pide crear una invitación de socio, mostrar un QR, revelar el secreto una sola vez y permitir revocarlo. Eso es una **invitación de incorporación a Platform**. No equivale al **vínculo H13**, cuyo propósito es asociar una persona Platform ya autenticada con una cuenta Búnker/Training existente.

H13 ya proporciona una solicitud de revisión del socio, una cola administrativa de revisión y un ciclo separado de vínculo canónico que requiere la prueba de la cuenta existente en Training o la resolución manual auditada. Por tanto, una invitación no debe duplicar esos estados, generar otro usuario Training ni activar un vínculo por sí sola. La incorporación podrá ofrecer “Conectar Búnker” al final; esa acción debe entrar en H13.

La documentación actual confirma que no hay alta pública autónoma ni flujo de invitación de extremo a extremo: el contrato de capacidades declara pendientes INT‑V2‑03/04/05 y que la prueba de invitación no está representada. El endpoint `POST /api/me/training/link-review` es para una persona Platform autenticada que solicita ayuda; la cola `/api/platform/v1/training-link-review` y su resolución no crean ni vinculan cuentas por sí solas. El protocolo H13 de activación con `reviewId` debe considerarse una dependencia de integración explícita: el flujo de activación visible en esta base aún no enlaza su activación a un `reviewId`.

La base revisada tampoco demuestra el cumplimiento completo de A28/A29 en estas rutas: la cola usa `identity.people.manage`, las razones de la API no coinciden con las cuatro razones aprobadas, y el código inspeccionado no acredita step-up por passkey, límite de 20 activaciones por emisor/día, recibo de Búnker con caducidad de 24 h ni auditoría H13 encadenada por hash. Esta propuesta no declara esos controles implementados. La invitación nueva no debe usarse para eludirlos; el flujo H13 debe cerrarlos en su contrato/PR correspondiente antes de conectarlo.

## Flujo propuesto

1. Un operador autorizado crea una invitación desde la ficha/alta de socio. Platform crea una referencia aleatoria de alta, limitada, revocable y con vencimiento; el secreto se muestra una sola vez como QR/enlace. No se incluye un `personId`, `clientId`, `trainingUserId`, nombre o dato de contacto dentro del QR.
2. El destinatario presenta la referencia en el flujo de incorporación autorizado. La referencia solo demuestra posesión del convite; no es una identidad ni permite elegir un `personId` o `trainingUserId`.
3. Tras la autenticación/prueba de titularidad que apruebe el producto, Platform crea o recupera la identidad humana central y su faceta cliente de forma transaccional. Si ya existe una persona, se conserva su `personId`; no se crea una segunda identidad. No se buscan coincidencias por email ni teléfono.
4. Si la persona solicita enlazar Búnker, se inicia el flujo H13 existente para esa misma persona y una cuenta Training existente. El enlace solo se activa tras la evidencia y confirmación bilaterales; el camino manual registra revisión y no sustituye la prueba sin una decisión expresa.
5. El operador puede revocar una invitación no consumida. Consumo, revocación, expiración y reintento quedan auditados; una invitación consumida no se reactiva.

## Frontera de identidad y responsabilidades

- **Platform** es autoridad para `personId`, la faceta `clientId`, el estado de la invitación y la auditoría de incorporación.
- **Búnker/Training** sigue siendo autoridad de sus usuarios, `trainingUserId`, credenciales, rutinas e historial. Platform nunca crea, renombra, busca ni elimina esos usuarios como efecto de emitir una invitación.
- La identidad canónica se representa con `personId` opaco e inmutable. Una persona que también sea staff mantiene la misma persona y obtiene facetas Platform; no se crea una identidad paralela.
- No hay matching automático o asistido basado únicamente en email, teléfono, nombre o fecha de nacimiento. Tampoco se copia identidad central a Training.
- Los documentos de contrato existentes especifican `PlatformSubject`, `LinkProposal` y `AccessGrant` en ámbito de persona; la tabla canónica de vínculo conserva `linkId`, `personId`, `trainingUserId`, estado, versión y auditoría. La invitación no altera ese contrato.

## Modelo mínimo a implementar tras aprobación

Entidad lógica `platform_member_invitations` (nombre provisional), sin tabla de credenciales ni entidad duplicada de persona:

| Campo | Propósito |
|---|---|
| `invitation_id` | UUID interno no secreto, para auditoría y administración. |
| `token_hash` | Hash del secreto aleatorio; el token en claro nunca se persiste ni registra. Único. |
| `status` | `pending`, `consumed`, `revoked` o `expired`; transiciones terminales no reversibles. |
| `created_at`, `expires_at`, `consumed_at`, `revoked_at` | Límites de vigencia y trazabilidad. |
| `created_by`, `consumed_person_id`, `revoked_by` | Actor y persona resultante; sin contacto ni identidad Training. |
| `request_id` | Idempotencia/auditoría del comando de creación y consumo. |

La invitación no queda vinculada a un `personId` previo porque el alcance solicitado es invitar a una persona que puede no tener identidad Platform. La asociación con `consumed_person_id` solo se establece en la misma transacción que crea/recupera la identidad mediante el método de prueba aprobado. No se almacenan email, teléfono, respuestas de verificación ni datos de salud en la invitación.

Restricciones propuestas: secreto de alta entropía, hash con comparación constante, uso único y consumo atómico; vencimiento breve configurable dentro de un límite fijo; revocación inmediata; rate limits por actor/IP; sin enumeración de invitaciones; auditoría append-only sin token ni PII. El TTL concreto y las cuotas de emisión deben reutilizar la política de invitaciones que se apruebe para el canal, no copiar automáticamente el TTL de otro protocolo.

## API y permisos

Superficie futura, autenticada y protegida server-side; nombres orientativos:

- `POST /api/clients/:clientId/invitations` — emitir y devolver el QR/enlace una sola vez; requiere permiso explícito de emisión y validación del cliente activo.
- `GET /api/clients/:clientId/invitations` — estado/metadatos sin secreto.
- `POST /api/member-invitations/consume` — canjear token en el flujo de alta con prueba de titularidad aprobada; nunca acepta IDs humanos elegidos por navegador.
- `POST /api/member-invitations/:invitationId/revoke` — revocar una invitación pendiente con motivo auditado.

El permiso `platform_link_issue` aprobado para emisores H13 no debe convertirse en permiso genérico de administración ni asignarse por petición. Solo los emisores identificados por la configuración autorizada —incluidos el propietario y el gerente aprobados— pueden iniciar la operación asistida; para la emisión de invitaciones de alta se debe usar un permiso específico y concedido por perfil, salvo que el registro de decisiones confirme expresamente que `platform_link_issue` también cubre invitaciones a nuevos socios. Ningún rol `admin` comodín debe otorgar privilegios de emisor por inferencia.

La emisión o resolución privilegiada debe exigir reautenticación/passkey reciente (step-up) y registrar actor, motivo/código, `requestId`, resultado y marcas de tiempo. Para H13, A28 exige recibo de Búnker de un solo uso con TTL de 24 horas, límite de 20 activaciones por emisor y día, auditoría propia append-only encadenada por hash y step-up de passkey en cada emisión. Las razones H13 canónicas son `lost_device`, `no_home_access`, `support_request` y `other`; no se deben sustituir por los valores históricos de UI (`lost_passkey`, `no_access_to_training_account`, `proof_failed`) sin una migración de contrato explícita. La activación bilateral de un vínculo asistido debe conservar el `reviewId` como referencia auditable; no es un sustituto del recibo de prueba de Training.

## Límites UI

- En la ficha de cliente: acciones “Crear invitación”, “Mostrar QR una vez”, “Copiar enlace una vez” y “Revocar” solo según permiso y estado. No exponer secretos en listados, logs, telemetría ni capturas.
- Mostrar estado, fecha de expiración y quién la emitió; tras cerrar el modal el secreto deja de estar disponible y solo puede emitirse una invitación nueva.
- Separar visualmente “Invitar a Platform” de “Resolver vínculo con Búnker”. La segunda acción abre la cola H13 o inicia su flujo; nunca promete que la invitación creó una cuenta Búnker.
- Mantener estados de espera, vencida, revocada y consumida; explicar que una invitación no sustituye la verificación de identidad.

## Decisiones realmente pendientes

1. **Prueba de titularidad y canal de entrega.** El registro citado define no emparejar por email/teléfono, pero no define cómo recibe y reclama un nuevo socio una invitación, cómo se acredita el canal ni cómo se recupera el acceso. Sin esa decisión no se debe habilitar consumo público. Un QR/enlace por sí solo solo es una capacidad bearer y no prueba identidad.
2. **Alcance exacto de `platform_link_issue`.** Confirmar si autoriza únicamente el proceso asistido H13 o también la emisión de invitaciones nuevas. Recomendación: mantenerlo limitado a H13 y crear una capacidad separada de invitación con concesión explícita en perfiles.
3. **Política de vigencia y límites.** Definir TTL, cuotas de emisión/canje y tratamiento de reenvío. Deben ser específicos de invitaciones y no heredarse del recibo de enlace H13.
4. **Una invitación por cliente o múltiples.** Definir si pueden coexistir varias invitaciones pendientes para una misma faceta; en todos los casos el consumo debe ser idempotente y producir una sola identidad cliente.

## Criterios de aceptación previos a implementación

- La prueba de identidad y entrega está aprobada; alta pública continúa desactivada hasta entonces.
- Tests demuestran consumo concurrente con un único ganador, expiración/revocación, idempotencia y no creación de una segunda persona/faceta; no hay matching por email/teléfono.
- Tests demuestran que invitar no crea ni altera una cuenta Training y que enlazar una cuenta existente pasa por H13 con prueba/recibo y activación bilateral.
- Tests de permisos cubren propietario, gerente autorizado, perfiles sin permiso y actor no configurado; step-up fallido deniega.
- Se revisa la numeración de migración contra `main` y todas las ramas/PR abiertas inmediatamente antes de implementar.
- Revisión independiente de seguridad antes de habilitar el flujo; implementación en un Draft PR separado.

## Evidencia consultada

- `PROMPT-PARIDAD-2JFIT-ADMIN.md`, fila 18: “Invitaciones” está marcada como faltante y pide diseñar sin duplicar identidad.
- `docs/integrations/training/2J-capabilities-contract.md`, secciones “Invitation and enrollment boundaries” y “Identity”: no hay registro público; INT‑V2‑03/04/05 siguen pendientes y no se fabrica prueba de invitación.
- `apps/api/src/training-link-review.ts`: solicitud autenticada del socio, cola y resolución manual; aprobar no crea el vínculo.
- `apps/api/src/training-link-flow.ts`: vínculo canónico y prueba del usuario existente; los endpoints administrativos actuales usan `identity.people.manage` y la activación observada no acepta `reviewId`.
- `apps/api/src/training-link-review.ts`: enumera las razones históricas (`lost_passkey`, `no_access_to_training_account`, `proof_failed`, `other`) y autoriza la cola con `identity.people.manage`; son discrepancias frente a A28/A29, no decisiones reinterpretadas por esta propuesta.
- `docs/integrations/training/2J-078A-integration-map.md`: separación de identidades, prueba dual, no matching por contacto y riesgos de duplicar cuentas.
- `docs/handoff/HANDOFF-CLAUDE-TO-CODEX-2026-10-25.md`: registra que el mapeo de razones H13 seguía abierto en ese handoff; la decisión vigente indicada para esta propuesta es A28 y debe prevalecer.
