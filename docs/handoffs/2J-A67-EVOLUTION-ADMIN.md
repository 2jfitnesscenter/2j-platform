# Handoff — 2J-A67 Evolución en ficha Admin

## Alcance

La ficha de cliente Admin incluye una sección de Evolución de solo lectura que usa el `TrainingAdapter` existente. El navegador envía únicamente el `clientId` de la ficha; Platform resuelve en servidor la persona activa y su enlace activo de Training. La respuesta no incluye `personId`, `trainingUserId` ni identificadores de programa. Mediciones de Platform se muestran como «No conectado».

## Permisos

La lectura de Evolución requiere el permiso existente `training.read`, tanto para `GET /api/clients/:clientId/training-summary` como para la pestaña devuelta por `GET /api/clients/:clientId`. Trainer lo recibe por su perfil actual y Admin por su perfil. Reception puede consultar la ficha con `clients.read`, pero recibe `403` al endpoint y la sección aparece como `forbidden`, por lo que Admin Web oculta la pestaña y no solicita sus datos.

## Validación del delta de permisos

- API/PostgreSQL focal: Trainer y Admin permitidos; Reception y Accountant denegados; Reception no invoca el adapter.
- Admin Web: prueba de que una sección `forbidden` no muestra la pestaña ni solicita el endpoint.
- El contrato, el modelo de identidad, la salida resumida, `no-store`, estados de error y adapter no cambian.
- Sin migraciones. Sin cambios en Home o Búnker.
- Esta PR de nivel 2 requiere re-revisión independiente del nuevo SHA antes de cualquier merge.

