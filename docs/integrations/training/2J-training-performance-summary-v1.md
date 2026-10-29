# Propuesta de contrato — resumen de rendimiento Búnker → Platform

**Estado:** propuesta para revisión independiente de Work Búnker; no implementado ni aprobado como contrato wire definitivo.

**Alcance de esta fila:** lectura de indicadores de rendimiento de Búnker en las superficies profesionales de Platform. No añade datos, rutas ni lógica al repositorio Búnker.

## Decisiones que gobiernan el límite

- Platform administra la identidad humana compartida mediante `personId`; `clientId` y `staffId` son facetas locales de Platform, y Training mantiene su `trainingUserId` y su historial (decisión final Training y `2J-capabilities-contract.md`). El consumidor no debe emparejar por email/teléfono.
- D06 y D42 mantienen el progreso deportivo, logros y estadísticas en Búnker. D01/D10/D43 asignan las mediciones corporales y salud a Platform/Home y exigen conservar el original Búnker hasta verificar cualquier migración histórica.
- D01: el socio con cuota activa puede registrar sus mediciones desde Home. D08: sin cuota conserva lectura de historial, sin escritura propia. D28: personal con permiso puede consultar, registrar y corregir aunque el socio no tenga cuota. D04: el permiso del entrenador se asigna mediante perfil; no hay excepción individual.
- D02 exige consentimiento revocable y auditoría para que entrenadores lean datos de salud; D23 bloquea acceso de salud al revocarse; D33 deja pendiente la política legal de retención. Este contrato excluye salud.
- D24-D26: las evaluaciones de Platform se publican separando notas internas; publicación genera aviso discreto en Home sin push ni datos sensibles; el socio puede descargar PDF aun sin cuota. Esos documentos y evaluaciones no se leen desde Búnker.

## Separación de datos

Este contrato **no** autoriza replicar `S.measurements`, series de peso/composición corporal, medidas de cinta, pliegues, sueño, pasos, frecuencia cardiaca, calorías, datos de dispositivos, escaneos, imágenes, tokens, programas, rutinas, sesiones de entrenamiento completas ni el estado `/api/data` de Training. La auditoría de integración 2J-078A identifica esos campos como sensibles o propietarios de Training y prohíbe consumir la interfaz de estado genérica.

El DTO propuesto se limita a una lista explícita de métricas de rendimiento deportivo que Work Búnker identifique como seguras y autorizadas para lectura profesional. **La lista de claves y sus unidades debe aprobarla Búnker antes de implementar**; el esquema deja la colección tipada pero no prescribe que exista una métrica concreta.

## Endpoint propuesto (requiere aceptación de Búnker)

```http
GET /api/internal/platform/v1/persons/{personId}/performance-summary
```

- Búnker resuelve su enlace activo por `personId`; no acepta `trainingUserId`, `centralClientId`, email ni teléfono como selector alternativo.
- Solo servicio Platform autenticado servidor a servidor. Reutilizar el formato HMAC `2J-SERVICE-AUTH-V1` si Búnker confirma que admite a Platform como caller; validar firma canónica, antigüedad limitada y `requestId` de un solo uso atómico en Búnker. Si esa confianza direccional no existe todavía, el endpoint debe permanecer apagado y la integración bloqueada hasta un diseño/revisión de seguridad específico.
- Una cuenta sin vínculo activo no devuelve contenido (`404 link_not_found`). No se almacena una copia del DTO ni se sirve desde caché tras revocar el enlace.
- Respuesta `200`: JSON descrito en [`contracts/2J-training-performance-summary-v1.schema.json`](../../../contracts/2J-training-performance-summary-v1.schema.json), con `Cache-Control: no-store`. `state=no_data` se distingue de enlace inexistente; números ausentes no se convierten en cero.
- La respuesta no incluye nombre, contacto, salud, pagos, derechos, reservas, notas internas, `trainingUserId` ni IDs de facetas Platform. Cada punto conserva fecha de origen y la métrica conserva la unidad acordada.
- Errores de servicio/red no sustituyen el resultado con datos antiguos. Platform muestra “No disponible” y puede reintentar; no infiere progreso ni permisos.

## Uso previsto en Platform

La API profesional de Platform debe resolver el actor y el permiso de perfil antes de invocar Búnker. Propuesta de permiso dedicado: `training.read` para este resumen; `health.read` no participa. El endpoint de cara a Admin debe derivar el `personId` del vínculo canónico de la faceta cliente y no confiar en un `personId` elegido libremente por el navegador. Si no hay vínculo, devuelve `not_connected`; si el servicio Búnker falla, `unavailable`.

La gráfica Admin es de solo lectura. No edita ni reescribe historial Training. La escritura de mediciones corporales/evaluaciones que D01-D15 definen será una API propia de Platform, con catálogo configurable, historial de cambios, separación de observaciones públicas/notas internas y permisos; no forma parte de este contrato Búnker.

## Publicación, consentimiento y revocación

La publicación y el aviso de D24/D25 se aplican a evaluaciones propiedad de Platform, no al DTO de rendimiento. El DTO no debe generar push ni mensajes.

El resumen de rendimiento debe respetar el estado del vínculo y cualquier revocación de acceso ya definida por la autoridad correspondiente. No representa consentimiento de salud. Si Búnker considera que algún agregado revela datos de salud o requiere consentimiento adicional, debe excluirse de este contrato hasta resolver D02/D23/D33; la UI no debe mostrarlo por defecto.

## Revisión requerida antes de implementar

1. Work Búnker confirma dueño, campos exactos, unidades, fuente y si sus métricas de rendimiento permiten esta proyección profesional.
2. Work Búnker valida la dirección de autenticación (Platform caller), replay atómico, vínculo activo y revocación, y confirma que el esquema no expone estado genérico ni PII.
3. Platform confirma el permiso por perfil `training.read` y el mapeo autorizado de `clientId → personId`; el contrato no crea ni resuelve ese vínculo.
4. Se prueban ausencia/revocación de enlace, acceso denegado, timeout, respuesta `no_data`, series vacías y datos ficticios sin salud. La integración queda apagada hasta E2E en par de repos revisado.

## Diferencias y límites no resueltos

- D10 habla de historial único en Home y conservación del original Búnker, mientras D43 asigna rendimiento a Búnker y mediciones/salud a Platform. Esta propuesta evita una migración o una copia de series corporales; cualquier importación histórica desde Training necesita un contrato y un plan de verificación aparte.
- El esquema es una propuesta de transporte, no acredita que Búnker tenga ya un endpoint equivalente. La auditoría 2J-078A indica que no existe hoy un resumen Training para consumidores y que `/api/data` no debe usarse.
- No define métricas concretas, retención, exportación, ventanas de consulta ni caducidad de caché porque no hay decisiones aprobadas para esos puntos. Si se requieren, se decidirán con Búnker antes del código.
