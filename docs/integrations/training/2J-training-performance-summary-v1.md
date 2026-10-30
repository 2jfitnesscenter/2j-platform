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

## Pendiente antes de ampliar rendimiento

El DTO actual no es una API de gráficas de rendimiento. Antes de añadir métricas hay que acordar con Búnker una lista cerrada de claves, significado, unidades y ventanas permitidas, revisar que ninguna revele salud y añadir límites/paginación apropiados. No se debe aceptar un `metrics[]` genérico del proveedor. La integración ampliada requerirá un contrato y revisión independientes; queda fuera de esta ficha y no bloquea el resumen ya integrado.

## Evidencia del código integrado

- Platform schema y ruta de salida: `apps/api/src/training-integration.ts` (`trainingSummarySchema`, `TRAINING_SUMMARY_PATH`).
- Adaptador: `createRemoteTrainingSummaryAdapter` en el mismo archivo; cuerpo `{v:1, trainingUserId}`, autenticación firmada, timeout y límite de 16 KiB.
- Resolución de identidad miembro: `apps/api/src/client-app.ts`, `GET /api/me/training-summary`.
- Esquema machine-readable asociado: [`contracts/2J-training-performance-summary-v1.schema.json`](../../../contracts/2J-training-performance-summary-v1.schema.json).
