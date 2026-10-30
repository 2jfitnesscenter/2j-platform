# Búnker ↔ Platform — resumen de entrenamiento v1

**Estado:** contrato ya implementado e integrado; esta ficha documenta el contrato existente. No propone una segunda ruta ni una réplica de historial.

## Fuente canónica

- Búnker PR #28 y Platform PR #36 integraron el contrato `POST /api/platform/v1/training-summary`.
- El adaptador Platform envía `{ v: 1, trainingUserId }` firmado servidor a servidor con `2J-SERVICE-AUTH-V1`.
- Platform solo obtiene `trainingUserId` al resolver el vínculo canónico activo de la persona. La interfaz de miembro consume `GET /api/me/training-summary`; deriva `personId`/`trainingUserId` de la sesión y del vínculo en servidor. No acepta un identificador de socio elegido por el navegador.
- La respuesta existente es `{ v, trainingUserId, trainingStatus, asOf, currentProgram?, recentActivity? }`. `recentActivity` contiene `lastTrainingAt` y `sessionsLast30Days`.

La ruta person-scoped `GET /api/internal/platform/v1/persons/{personId}/performance-summary` que figuraba en una versión anterior de esta propuesta **se retira**: duplicaba el contrato integrado y trasladaba a Búnker una ruta de otra dirección. El esquema de esta carpeta ahora describe únicamente el DTO real de respuesta. La implementación de Platform valida el DTO, el `trainingUserId` exacto, firma/replay del servicio, timeout y tamaño máximo de respuesta; un fallo remoto resulta en `unavailable`, sin datos obsoletos.

## Límites de propiedad

- Búnker conserva usuarios, `trainingUserId`, programas, rutinas, entrenamientos y su historial original. No guarda `personId`, `clientId` ni `staffId`.
- Platform conserva `personId` y las facetas locales; una persona puede tener una sola vinculación canónica activa. No hay matching por correo/teléfono.
- El resumen muestra solo programa actual y actividad reciente. No incluye medidas corporales, salud, pagos, derechos, reservas, notas ni contenido completo de entrenamientos.
- Home puede consumir el resumen de miembro existente. No se copia el historial de Búnker a Platform ni se sustituye el original.

## Extensión independiente A68: «Mi evolución» del socio

A68 define una lectura paginada de historial deportivo para Home, separada del resumen `GET /api/me/training-summary` de 2J-089. Home llama a Platform con su sesión de socio; Platform aplica identidad, derecho activo y consentimiento publicado/aceptado antes de invocar Búnker. No se cambia el contrato existente ni se permite a Home llamar directamente a Búnker.

Platform reutiliza las cabeceras, canonicalización, firma, timestamp, UUID anti-replay y validaciones TLS/timeout del envelope `2J-SERVICE-AUTH-V1`, sobre la ruta fija `POST /api/platform/v1/training-evolution`. El cuerpo firmado porta `authorization.consent.purpose = "home_evolution"`; ambos lados registran ese propósito. El permiso/capability y la versión exacta del consentimiento son una comprobación fresca de Platform; `accessState` solo puede ser `entitled` para este flujo. El baseline gratuito o una asignación provisional no satisfacen A68.

El consentimiento usa el tipo específico `home_evolution`, con texto que publica y versiona el propietario en la configuración de consentimientos existente. El socio acepta la versión activa exacta y puede revocarla por el mecanismo de consentimientos existente. Si no hay texto activo/aceptación vigente o no hay derecho `training_access` activo, Platform no llama al servicio de Búnker. Cada intento deja un evento de auditoría de metadatos (persona/cliente opacos, propósito, versión y resultado), sin cuerpo ni valores.

El DTO A68 solo admite entrenamientos finalizados y resultados deportivos necesarios para representar actividad/rendimiento. Rechaza campos extra, incluido `measurements` o `bodyweight`; no envía ni devuelve salud, peso corporal, medidas antropométricas/biométricas, PII, notas, fotos, programas o texto libre. El PR Búnker #77 actual aún incluye peso y medidas en su respuesta, así que requiere adaptación antes de integrarse. La especificación machine-readable es `contracts/2J-home-evolution-member-v1.schema.json`.

`GET /api/me/evolution` es el endpoint autenticado de Home. Resuelve socio y vínculo desde la sesión, no admite IDs de persona/cliente en query o body y devuelve estados vacíos sin datos para consentimiento pendiente, derecho no vigente, vínculo ausente o fuente no disponible. Es `no-store`. El endpoint profesional de Admin incluido en Platform PR #163 ya integrado es otro módulo y no sustituye este recurso de miembro.

## Pendiente antes de ampliar rendimiento

El DTO actual no es una API de gráficas de rendimiento. Antes de añadir métricas hay que acordar con Búnker una lista cerrada de claves, significado, unidades y ventanas permitidas, revisar que ninguna revele salud y añadir límites/paginación apropiados. No se debe aceptar un `metrics[]` genérico del proveedor. La integración ampliada requerirá un contrato y revisión independientes; queda fuera de esta ficha y no bloquea el resumen ya integrado.

## Evidencia del código integrado

- Platform schema y ruta de salida: `apps/api/src/training-integration.ts` (`trainingSummarySchema`, `TRAINING_SUMMARY_PATH`).
- Adaptador: `createRemoteTrainingSummaryAdapter` en el mismo archivo; cuerpo `{v:1, trainingUserId}`, autenticación firmada, timeout y límite de 16 KiB.
- Resolución de identidad miembro: `apps/api/src/client-app.ts`, `GET /api/me/training-summary`.
- Esquema machine-readable asociado: [`contracts/2J-training-performance-summary-v1.schema.json`](../../../contracts/2J-training-performance-summary-v1.schema.json).
