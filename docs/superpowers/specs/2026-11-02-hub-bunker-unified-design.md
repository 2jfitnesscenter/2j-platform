# Plataforma 2J unificada: Home, Búnker y PLATFORM

Estado: borrador para revisión. Fecha: 2026-11-02.
Ruta: arquitectónica. Secciones 1 a 4 aprobadas en conversación; este documento las reúne y completa el resto del alcance.

## 1. Objetivo

Una sola aplicación para el socio y para el personal del centro deportivo:

- **Home** (la `client-app` de `2j-platform` ampliada): reservas, cuotas, tienda, noticias, chat social, ajustes y perfil.
- **Búnker** (la app de entrenamiento de `2jfitnessapp`): registro de fuerza, rutinas e historial. Se abre dentro de Home, sin login ni passkey adicional.
- **PLATFORM** (las apps de `2j-platform` para entrenadores, recepción y administración): copiada y unida al mismo repo.

El socio percibe una única aplicación. Por dentro, Búnker sigue siendo un servicio con sus propios datos.

Criterio de éxito: un socio entra con Google, reserva una clase, abre Búnker y registra un entrenamiento sin volver a autenticarse, usando una cuota activa. Un entrenador gestiona socios y agenda en PLATFORM con la misma identidad de persona.

## 2. Decisiones tomadas

| Tema | Decisión | Origen |
|---|---|---|
| Repo | Nuevo repo copiado de `2j-platform` (no se empieza de cero) | Conversación |
| Repo original | `2j-platform` se queda intacto; no se archiva en este hito | Asunción, confirmar |
| Fuente de verdad de la persona | Plataforma (`personId`) | Conversación |
| Cuenta de Búnker | Búnker conserva `uid`, datos y ficheros de estado | Dominio documentado |
| Enlace | `personId ↔ training_user_id` en `training_account_links` | Existente |
| Login del socio | Google (nuevo) y código de prueba solo en desarrollo | Conversación |
| Passkeys del socio | Se registran desde cero, fuera del primer hito | Conversación |
| Passkeys de personal | Se mantienen | Existente |
| Búnker dentro de Home | Un dominio con proxy (`/bunker`) y una sola sesión | Conversación |
| Datos de Búnker | No se migran en este hito; los usuarios actuales son de prueba | Conversación |
| Despliegue | Docker Compose en servidor propio | Conversación |

## 3. Arquitectura

### 3.1 Componentes

- **Proxy de entrada:** sirve `/` (Home y PLATFORM) y `/bunker/*` (Búnker frontend y API) bajo un mismo origen.
- **Plataforma API** (`apps/api`): identidad, sesiones de socio, cuotas (entitlements), reservas, economía, tienda, comunicaciones, avisos y contrato de capacidades.
- **Home** (`apps/client-app`): navegación del socio. Primaria: **Inicio · Búnker · Tienda · Perfil · Ajustes**. Inicio incluye noticias, reservar clase y próxima reserva.
- **PLATFORM** (`apps/admin-web`, `apps/staff-app`, `apps/training-port`): personal.
- **Búnker** (`2jfitnessapp`): frontend y API de entrenamiento. Conserva su almacenamiento en JSON.
- **Paquetes compartidos** de `2j-platform` (`auth`, `permissions`, `domain`, `contracts`, `ui`, `design-tokens`, `audit`, `observability`, `testing`).

### 3.2 Flujo de datos

1. El socio entra en Home con Google. Plataforma crea una sesión (`platform_member_sessions`) y una cookie `HttpOnly`, `Secure`, `SameSite=Lax`.
2. Home muestra la navegación según las capacidades de la cuota.
3. Al abrir Búnker, el navegador pide `/bunker/*` con la misma cookie.
4. Búnker valida la sesión contra Plataforma con una llamada interna firmada, con caché corta.
5. Búnker pide a Plataforma el contrato `2J-CAPABILITIES-V2` del socio y aplica las capacidades. Plataforma es la autoridad; Búnker no recalcula cuotas.
6. Los datos de entrenamiento se quedan en Búnker.

### 3.3 Límites entre componentes

- Home no lee datos de entrenamiento. Solo conoce el estado de la cuota y del enlace.
- Búnker no conoce tablas de Plataforma. Solo recibe la sesión validada y las capacidades.
- PLATFORM usa las mismas sesiones de persona, pero con permisos de personal (`permissions`), nunca con la sesión de socio.

## 4. Identidad y autenticación

### 4.1 Login del socio
- Google es el método de login del socio. Se añade como proveedor en `platform_person_auth_subjects` (`provider = 'google'`). No hace falta cambio de esquema.
- Si un socio tiene varios métodos, todos apuntan al mismo `personId`.
- Código de prueba (`member-pilot-auth.ts`): solo desarrollo y piloto interno. Se retira antes de producción.
- Passkeys del socio: fuera de este hito. Cuando se añadan, usan el dominio nuevo.

### 4.2 Sesión única
- Una sola sesión de socio para Home y Búnker.
- Búnker no tiene login propio cuando la sesión viene de Home. El acceso directo a Búnker sigue funcionando durante la transición.
- Renovación: si la sesión caduca, Home vuelve a pedir Google y retorna a la ruta original.

### 4.3 Qué puede hacer la sesión en Búnker
- La sesión de Home da acceso a todas las rutas de Búnker permitidas por las capacidades de la cuota.
- Las acciones sensibles (exportar datos, borrar cuenta, cambiar identidad) piden confirmación dentro de la app, sin passkey. **Pendiente:** lista definitiva de rutas sensibles.

### 4.4 Modos de activación por socio
- `legacy`: sin comprobación de cuota, comportamiento actual.
- `shadow`: comprueba y registra diferencias sin bloquear.
- `enforced`: aplica la cuota.
- El modo se guarda por persona y se activa de forma gradual.

## 5. Modelo de datos

### 5.1 Plataforma (PostgreSQL)

Tablas existentes que se reutilizan:

- `platform_persons`, `platform_person_auth_subjects`, `platform_member_sessions`, `training_account_links`.
- Cuotas y reservas: `plans`, `plan_rights`, `client_plan_assignments`, `assignment_entitlement_periods`, `client_entitlement_ledger`, `calendar_sessions`, `calendar_reservations`, `calendar_waitlist_entries`.
- Tienda: `store_products`, `store_product_variants`, `store_sales`, `store_sale_lines`, `store_inventory_movements`.
- Economía: `economic_charges`, `economic_transactions`, `economic_cash_sessions`, `economic_fiscal_documents`.
- Comunicación: `communication_conversations`, `communication_messages`, `communication_templates`.
- Auditoría: `platform_identity_audit_events`, `platform_member_session_audit_events`, `platform_training_access_events`.

Cambios de este hito: ninguna tabla nueva. Google es un valor nuevo de `provider`.

Marcado para retirar después (no en este hito): `platform_training_sso_codes`, junto con el flujo de código de un solo uso, que ya no se usa para entrar a Búnker.

### 5.2 Búnker
- Sigue usando su almacenamiento JSON (`state-<uid>.json` y similares). No se migra en este hito.
- Recibe el `uid` del enlace y la sesión validada. No guarda datos de Plataforma.

### 5.3 Enlace
- Se crea la primera vez que el socio entra por Google y ya tiene una cuenta de Búnker asociada, o cuando el personal lo vincula.
- Si el socio no tiene cuenta de Búnker, Home muestra "cuenta de entrenamiento pendiente".

## 6. Errores

| Situación | Lo que ve el socio | Comportamiento |
|---|---|---|
| Google cancelado o fallido | Vuelve al login con mensaje | No crea sesión; audita el intento |
| Sesión caducada | Pantalla de login y vuelta a la ruta original | Renovación; sin passkey |
| Cuota inactiva o vencida | Estado real de la cuota | Usa `2J-CAPABILITIES-V2`; no error genérico |
| Sin enlace con Búnker | "Cuenta de entrenamiento pendiente" | No deja entrar |
| Plataforma no responde, `enforced` | "Búnker no disponible" | Deniega |
| Plataforma no responde, `legacy` | Comportamiento actual | Deja pasar |
| Respuesta reciente válida | Sin cambio | Usa la caché hasta `expiresAt` |
| Ruta `/bunker` caída | "Búnker no disponible" en Home | No muestra pantalla rota |
| Petición a Búnker sin sesión | 401 | Home redirige a login |

## 7. Pruebas

### 7.1 Unitarias
- `person-identity`: proveedor Google, vinculación a `personId`, sesiones.
- Validación de sesión en Búnker y de capacidades.
- Comprobación de cuota por modo (`legacy`, `shadow`, `enforced`).

### 7.2 Contrato
- Respuestas de Plataforma validadas contra `2J-CAPABILITIES-V2`, con los JSON de `2jfitnessapp/contracts/`.
- Cualquier cambio de contrato rompe la prueba.

### 7.3 Seguridad
- Búnker rechaza peticiones sin sesión válida.
- La cookie tiene `HttpOnly`, `Secure`, `SameSite=Lax`.
- El proxy solo expone `/` y `/bunker/*`; las rutas internas no son accesibles desde fuera.
- Las acciones sensibles piden confirmación.

### 7.4 End-to-end
- Login con Google → Home → Búnker → registro de entrenamiento, con usuarios de prueba.
- Se amplía el workflow `e2e-training` existente.
- Caso negativo: cuota inactiva, enlace pendiente y Plataforma caída.

### 7.5 Regresión
- `pnpm test` en `2j-platform` (incluye `api`, `client-app`, `staff-app`, `admin-web`).
- `npm test` en `2jfitnessapp`.
- Ningún cambio se fusiona si rompe estas suites.

### 7.6 Modos
- Pruebas por modo de activación: `legacy`, `shadow` y `enforced`.

## 8. Alcance completo por áreas

Todas estas áreas forman la plataforma. Cada una se diseña y entrega en su propio hito después de cimientos. Su estado actual se toma del código de los repos.

| Área | Dónde vive hoy | Hito |
|---|---|---|
| Identidad y login del socio (Google) | Plataforma (parcial, código de prueba) | 1 Cimientos |
| SSO de una sola app hacia Búnker | Búnker (flujo de código, a retirar) | 1 Cimientos |
| Reservas y clases | Plataforma `calendar`, `booking` | 2 Agenda |
| Cuotas, planes y derechos | Plataforma `entitlements`, `plans` | 2 Agenda (lectura), 3 Cobros |
| Noticias y avisos | Plataforma `center_news`, `notifications` | 2 Agenda |
| Perfil, consentimientos y formularios | Plataforma `client_consents`, `client_forms`, `client_documents` | 2 Agenda |
| Tienda | Plataforma `store_*` (solo informativa en Home) | 4 Tienda |
| Cobros, caja y facturas | Plataforma `economic_*`, `cash-session` | 3 Cobros |
| Chat social, amigos y social | Búnker (`chat`, `social`, `friends`) | 5 Social, decisión pendiente |
| Entrenamiento y rutinas | Búnker (`bunker`, `coach`, `strava`, `whoop`) | Fuera de alcance; se queda en Búnker |
| Personal, turnos y fichaje | Plataforma `staff_*` | 6 Personal |
| Informes y panel | Plataforma `reports`, `dashboard` | 7 Informes |

## 9. Hitos

1. **Cimientos:** Google, sesión única, SSO sin passkey hacia Búnker, enlace `personId ↔ uid`, comprobación de cuota con modos. Sin agenda, cobros ni tienda.
2. **Agenda:** reservas, clases, noticias y perfil en Home.
3. **Cobros:** cuotas, caja y facturas.
4. **Tienda:** productos, stock y compra desde Home.
5. **Social:** chat social y amigos, movidos de Búnker a Home. Requiere decisión propia.
6. **Personal:** turnos, fichaje y permisos en PLATFORM.
7. **Informes:** panel y reportes.

Cada hito tiene su propia spec, plan y entrega en cortes pequeños, con pruebas antes de fusionar.

## 10. Proceso

- Un registro vivo de decisiones en `docs/decisions/`, para que cualquier ingeniero o agente conozca el contexto sin reconstruirlo.
- Una rama por tarea: `agent/<agente>/<task-id>-<slug>`. Nada se implementa directamente en `main`.
- Cada hito se parte en tareas pequeñas, con prueba antes de código.
- Las reglas de `AGENTS.md` de `2j-platform` se mantienen: orquestador en modo dry run, sin auto-merge, sin credenciales en logs.

## 11. Pendiente

1. Lista definitiva de rutas sensibles de Búnker y su confirmación.
2. Destino del chat social y los ajustes de Búnker (hito 5).
3. Nombre y dominio definitivos del producto.
4. Configuración de Google OAuth para el dominio nuevo.
5. Confirmar si `2j-platform` se archiva tras la copia.
6. Diseño de tienda y pasarela de pago (hito 4).
7. Pasarela de cobro y facturación (hito 3).

## 12. Fuera de alcance

- Migrar datos de Búnker o de Plataforma.
- Cambiar el RP ID de las passkeys de personal.
- Desplegar a producción sin una prueba funcional con datos de prueba.
