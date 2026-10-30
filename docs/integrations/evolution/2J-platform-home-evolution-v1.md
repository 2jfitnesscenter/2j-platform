# Contrato de Evolución Home ↔ Platform v1

**Estado:** contrato canónico de «Mi evolución» para consumo de Home. La API de mediciones/evaluaciones de Platform sigue siendo propuesta y no está implementada. El endpoint miembro de entrenamiento y su transporte firmado A68 se implementan en PR #174; no quedan disponibles hasta integrar ese cambio y superar la revisión independiente. No se añaden migraciones ni se habilitan datos reales.

Este contrato separa dos fuentes: las mediciones/evaluaciones administradas por Platform y el resumen de entrenamiento propiedad de Búnker. La ficha Búnker relacionada documenta el contrato ya integrado `POST /api/platform/v1/training-summary`; no se crea una segunda ruta person-scoped.

## Reglas de autoridad aplicadas

- Platform resuelve identidad y facetas; Home nunca envía `personId` ni `clientId` para elegir la cuenta del socio. Las rutas `/api/me/*` usan exclusivamente la sesión autenticada.
- Platform es la única autoridad de catálogo de medidas, derechos de escritura, evaluaciones, consentimientos y permisos. Búnker conserva su usuario, rutinas, entrenamientos y originales históricos.
- El socio puede crear mediciones propias solo si Platform confirma una cuota vigente. El personal autorizado puede crear o corregir mediciones para un cliente aunque no tenga cuota. Ninguna de estas reglas se calcula en Home.
- Los entrenadores reciben capacidades por perfil; no hay excepciones por usuario. El servidor aplica la autorización en cada lectura y escritura.
- Una corrección conserva autor, fecha, valor anterior y nuevo en auditoría. Un borrado definitivo elimina el dato y su historial de edición; solo conserva actor, instante e identificador/tipo de medida, según D35. No se reutiliza el flujo de corrección para simular borrado.
- Mediciones de salud son una superficie separada. Requieren consentimiento previo, actual y revocable, permiso específico, registro de acceso y `Cache-Control: no-store`. Ningún dato de salud aparece en notificaciones push ni en notas internas.
- La revocación bloquea inmediatamente el acceso de personal. No se inventa una política de retención ni texto legal; el acceso de salud no queda disponible hasta que el propietario publique la versión de texto correspondiente en Configuración.

## API de miembro para Home

Todas las rutas son autenticadas por sesión y no reciben un selector de persona/cliente.

| Método y ruta | Resultado |
|---|---|
| `GET /api/me/evolution/v1/catalog` | Definiciones publicadas que el socio puede consultar; `canWrite` es una decisión del servidor basada en cuota vigente. No incluye definiciones de salud. |
| `GET /api/me/evolution/v1/measurements?from=YYYY-MM-DD&to=YYYY-MM-DD&cursor=…&limit=…` | Historial paginado y valores por clave estable; el mismo resultado alimenta las gráficas. Rango máximo recomendado: 24 meses; `limit` máximo 100. |
| `POST /api/me/evolution/v1/measurements` | Crea una sesión de medición si la cuota está vigente; `Idempotency-Key` obligatorio. El servidor establece autor, cliente y fecha de registro. |
| `GET /api/me/evolution/v1/evaluations?cursor=…&limit=…` | Evaluaciones publicadas, separadas de borradores y notas internas. |
| `GET /api/me/evolution/v1/evaluations/{evaluationId}/document` | Descarga autenticada del documento publicado, también sin cuota; el API no devuelve una URL pública de almacenamiento. |
| `GET /api/me/health/v1/consent` | Estado de publicación/aceptación, versión y texto vigente o motivo de indisponibilidad. |
| `POST /api/me/health/v1/consent` | Acepta explícitamente una versión publicada; el servidor fija actor e instante. Se rechaza una versión obsoleta. |
| `DELETE /api/me/health/v1/consent` | Revoca el consentimiento actual; el efecto de autorización es inmediato y queda auditado. |
| `GET /api/me/health/v1/measurements` | Datos de salud propios solo con consentimiento vigente; si el texto no está publicado o el consentimiento no está aceptado, falla cerrado. |

Para el consentimiento específico del flujo A68, que no es consentimiento de salud, se añaden estas operaciones:

| Método y ruta | Resultado |
|---|---|
| `GET /api/me/evolution/consent` | Devuelve estado `unpublished`, `required`, `accepted` o `revoked`, y solo si existe publica la versión/título/texto activo del consentimiento `home_evolution`. |
| `POST /api/me/evolution/consent` | Acepta explícitamente la versión activa con nombre escrito e idempotencia. El servidor fija cliente, identidad, versión, texto/hash aceptado e instante. No acepta versiones obsoletas. |
| `DELETE /api/me/evolution/consent` | Revoca inmediatamente el grant de la versión vigente mediante un evento append-only. No borra ni cambia la aceptación/snapshot previo. El socio puede volver a aceptar esa misma versión con un nuevo evento explícito. |

Cada aceptación o revocación se registra con actor/instante/versión, sin modificar eventos anteriores. La autorización de `/api/me/evolution` usa el evento efectivo más reciente de la versión activa. La revocación se hace efectiva antes de cualquier llamada futura a Búnker; las respuestas son `no-store` y el endpoint no sirve una lectura ya cacheada.

Los errores contractuales incluyen `401 authentication_required`, `403 permission_denied`, `409 active_entitlement_required`, `409 consent_required`, `409 consent_version_changed`, `404 not_found` y `400 validation_error`. Respuestas de salud y documentos incluyen `Cache-Control: no-store`. No hay fallback a datos de demostración ni a respuestas cacheadas.

## API profesional de Platform

El cliente identifica la faceta con `clientId` en la ruta; el servidor la valida contra el actor y su perfil en cada petición. Los nombres de permiso propuestos para el catálogo RBAC son `measurements.read`, `measurements.manage`, `evaluations.read`, `evaluations.manage`, `health.read` y `health.manage`. `health.read` ya existe en el paquete de permisos; las nuevas capacidades deben añadirse a perfiles de manera explícita, con pruebas fail-closed. Nunca se autorizan por nombre de rol.

| Método y ruta | Autorización/semántica |
|---|---|
| `GET /api/admin/clients/{clientId}/evolution/v1/catalog` | `measurements.read`; solo catálogo no sanitario. |
| `GET /api/admin/clients/{clientId}/evolution/v1/measurements` | `measurements.read`; lectura auditada. |
| `POST /api/admin/clients/{clientId}/evolution/v1/measurements` | `measurements.manage`; no exige cuota al cliente. Idempotencia obligatoria. |
| `PATCH /api/admin/clients/{clientId}/evolution/v1/measurements/{measurementId}` | `measurements.manage`; corrección controlada, motivo obligatorio y evento con valor anterior/nuevo. |
| `DELETE /api/admin/clients/{clientId}/evolution/v1/measurements/{measurementId}` | `measurements.manage`; borrado definitivo con la retención mínima de auditoría D35, sin valores anteriores. |
| `GET /api/admin/clients/{clientId}/health/v1/measurements` | `health.read` y consentimiento vigente; siempre audita el acceso. |
| `GET/POST /api/admin/evolution/v1/templates` | `evaluations.manage`; crea y mantiene plantillas configurables, versionadas. |
| `POST /api/admin/clients/{clientId}/evaluations` | `evaluations.manage`; crea evaluación desde una plantilla publicada. |
| `POST /api/admin/clients/{clientId}/evaluations/{evaluationId}/publish` | `evaluations.manage`; publica campos visibles al socio, excluyendo notas internas, y genera aviso in-app discreto. |

Un `403` o consentimiento revocado no revela si existen valores. Descargas se autorizan en servidor; los nombres de archivo, logs y avisos no contienen valores de salud. Todos los eventos sensibles incluyen actor, cliente, acción y hora; ningún log técnico guarda cuerpos de medición.

## DTO v1

El esquema JSON machine-readable asociado define el catálogo, lectura paginada, creación de mediciones, evaluación resumida y estado de consentimiento. Reglas adicionales:

- `measuredOn` es una fecha civil `YYYY-MM-DD`; la hora de presentación del producto es `Atlantic/Canary`. `recordedAt`/`publishedAt` son instantes UTC generados por servidor.
- Cada sesión contiene `values[]` con claves únicas definidas por catálogo, valores numéricos y precisión/unidad del catálogo. No se aceptan etiquetas o unidades libres del cliente.
- El API calcula elegibilidad y `canWrite`; Home nunca infiere cuota ni elegibilidad.
- Las consultas de gráfica usan los puntos del historial paginado; no se añade una ruta agregada que pudiera dar resultados divergentes.
- Los textos de consentimiento se guardan con versión y fecha de publicación. La aceptación referencia exactamente esa versión. No se incorpora texto legal a este repositorio.

## Búnker y pantalla “Mi evolución”

El flujo canónico de miembro será:

```text
Home (sesión de miembro) → Platform GET /api/me/evolution → comprobaciones Platform
  → Platform POST /api/platform/v1/training-evolution → Búnker → Platform → Home
```

Home nunca llama a Búnker directamente ni elige `personId`, `clientId` o `trainingUserId`. Platform deriva la identidad exclusivamente de la sesión, resuelve el vínculo canónico activo de Training y comprueba, antes de cada llamada remota:

1. persona y faceta de cliente activas;
2. al menos un derecho `training_access` vigente y operativo `active` en una asignación efectiva; un baseline gratuito, un derecho provisional, bloqueado, vencido o una reserva no sustituyen este requisito;
3. consentimiento específico `consent_type='home_evolution'`, publicado, vigente y aceptado por el cliente para su versión activa exacta. Un consentimiento no publicado, archivado, revocado o con nueva versión no aceptada falla cerrado.

Sin consentimiento, Platform no llama a Búnker y responde `state: "consent_required"`; sin derecho vigente responde `state: "not_available"` y no incluye datos; un vínculo ausente o remoto no disponible tampoco incluye datos. Home presenta esos casos como estado vacío/indisponible. Los errores y estados no revelan datos de otra persona.

La ruta firmada reutiliza exactamente el envelope `2J-SERVICE-AUTH-V1` de 2J-089: firma canónica de método, ruta fija, timestamp, request UUID y digest del cuerpo, anti-replay, límites de respuesta, timeout y `redirect: error`. El cuerpo firmado incluye `authorization.consent.purpose: "home_evolution"`; Búnker registra y valida ese mismo propósito. No se inventa otro protocolo de autenticación. Cada petición y resultado de autorización genera auditoría en Platform con identidad opaca, propósito, versión de consentimiento, evaluación de derecho, resultado e instante; nunca guarda cuerpo, respuesta ni valores de entrenamiento. La llamada y la respuesta llevan `Cache-Control: no-store` en el lado HTTP correspondiente.

La respuesta aceptada por Platform es una allowlist estricta de historial de entrenamientos finalizados: fecha, ejercicio, series y resultados deportivos necesarios para visualizar rendimiento. No incluye peso corporal, medidas antropométricas/biométricas, salud, programa actual, nombres, notas, fotos, PII ni IDs seleccionables por el navegador. El adaptador Platform rechaza campos extra como `bodyweight`, `bodyMeasurements` o `measurements`; no los persiste, filtra para mostrarlos ni los reenvía. Búnker #77 está integrado en `d5b45c17a6400a41a18924e28d67afd9149d82e5`; la compatibilidad efectiva se limita al DTO estricto aceptado por Platform. D43 mantiene Búnker como fuente de rendimiento; D33 excluye salud de este contrato.

El endpoint de miembro queda definido como `GET /api/me/evolution` (consulta paginada con cursor opaco, límite máximo 100). Su respuesta versionada es `contracts/2J-home-evolution-member-v1.schema.json`; los identificadores de persona/Training, consentimiento, derecho y auditoría nunca se exponen a Home. Se mantiene `GET /api/me/training-summary` como contrato 2J-089 separado y compatible; no sustituye ni evita las comprobaciones de «Mi evolución».

El PR #163 («Evolución») ya integrado añade una sección de solo lectura a la ficha profesional/Admin y su endpoint `/api/clients/:id/training-summary`, con permiso `training.read`. Es una vista de personal distinta del endpoint del socio; #135 no duplica ni modifica ese módulo. Home consume el endpoint autenticado del socio definido aquí.

Home presenta por separado “Mediciones y evaluaciones de Platform” y “Entrenamiento de Búnker”. La API de mediciones de Platform sigue siendo un contrato independiente; sus datos de salud no se mezclan con esta llamada Búnker. No se consulta `/api/data`, no se copia el historial a Platform y no se borran originales de Búnker.

Una futura ampliación de gráficas de rendimiento de Búnker necesita una allowlist aprobada de claves/unidades por Work Búnker y límites explícitos. Se rechaza `metrics[]` genérico, no tipado por el proveedor. El DTO actual no contiene medidas corporales ni salud.

## Dependencias y límites antes de implementar

1. La API de mediciones no existe en la base revisada; cada endpoint, permiso, validación y modelo requiere implementación y tests en PRs separados.
2. La API de formularios no sustituye evaluaciones ni historial de medidas.
3. Los textos legales los aporta el propietario. Sin versión publicada, el flujo de salud permanece cerrado.
4. Búnker #77 está integrado. Platform consume el endpoint `training-evolution` con el mismo envelope firmado `2J-SERVICE-AUTH-V1` y propósito `home_evolution`; la integración miembro está en PR #174.
5. `origin/main` ya contiene `0063_member_evolution_consent_audit.sql`, que añade el tipo de consentimiento y la auditoría sin contenido. PR #174 no modifica migraciones ni ejecuta migraciones reales; cualquier cambio futuro debe revisar de nuevo la secuencia de todas las ramas y PR abiertas.
6. Antes de habilitar lecturas o escritura de datos personales/sanitarios, revisión independiente y pruebas con datos sintéticos; no usar capturas con datos reales.

## Evidencia consultada

- Platform main `e33113c311171fb7d63da9964774db39eaca4630`: `apps/api/src/client-app.ts` y `apps/api/src/training-integration.ts` implementan el resumen Búnker; no se encontraron rutas `/api/me/evolution/*` ni modelo de mediciones.
- `packages/permissions/src/index.ts`: `health.read` existe; permisos específicos de mediciones/evaluaciones no aparecen en el catálogo actual.
- `docs/handoffs/2J-HOME-MEASUREMENTS-CLIENT.md` describe una base antigua y conflictos D01/D08/D28. Para esta propuesta prevalece la decisión posterior del propietario: socio escribe con cuota vigente; personal autorizado puede escribir sin cuota.
- No se modificó código ni DB, no se ejecutaron pruebas, y no se afirma que la propuesta esté implementada.
