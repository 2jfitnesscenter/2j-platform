# A67 — Integración local de Home para revisión

## Estado

- Rama local aislada: `agent/codex/2J-HOME-A67-MEMBER-CONTINUATION`.
- Base de la continuación: PR #157 (`agent/codex/2J-HOME-MEMBER-MESSAGES-CLEAN`), con los cambios anteriores ya integrados en su main actualizado.
- Publicación/fusión/despliegue: pendiente de publicar esta continuación. No se ha fusionado ni desplegado.

## Alcance integrado

- #116: la tarjeta de clase presenta lista de espera solo cuando Platform devuelve elegibilidad explícita.
- #126: Perfil representa los estados y cantidades `assignment.payment` recibidos de `GET /api/me/membership`; Home no calcula saldos, vencimientos ni bloqueos.
- #157: Buzón del socio usa los endpoints autenticados de conversación y conserva la idempotencia al reintentar un borrador editado.
- Mi evolución usa el resumen de solo lectura 2J-089 (`GET /api/me/training-summary`) para mostrar programa y actividad agregada cuando Platform confirma una vinculación activa. No expone IDs de Búnker.
- En demo, Mi evolución muestra `No conectado · DEMO · Datos ficticios`, no hace llamadas y no presenta métricas simuladas. Mediciones, gráficos, evaluaciones y salud quedan `No conectado` porque 2J-089 no incluye esos datos.
- Perfil muestra los datos existentes en modo consulta y explica cómo solicitar cambios.
- Compras ya estaba conectada a `GET /api/me/store/purchases`; la prueba actual verifica datos del endpoint y el estado de demo sintética.
- A64/A66: facturas permitidas en Home. Perfil incluye «Mis facturas» como `No conectado` mientras Platform no publique un endpoint autenticado y acotado al socio para listar y descargar sus PDF. No se simula una descarga.

## Decisiones y límites aplicados

- D238/D239: no se habilita edición de nombre, apellidos, teléfono, dirección, DNI/NIE, nacimiento ni correo, ni formulario de solicitud en Home. Se indica la vía presencial o WhatsApp con verificación del equipo.
- Contrato de facturas de socio pendiente: Platform expone rutas económicas internas con permiso `billing.read-tax` (`GET /api/economics/charges/:chargeId/documents` y `GET /api/economics/documents/:documentId/pdf`), no un listado/descarga autenticado y auto-acotado para miembros. Home no las llama ni recibe IDs de documentos desde el cliente.
- D238/D239: los datos personales siguen siendo de solo lectura; no se añade edición de perfil.
- No se cambian Platform, Búnker, contratos de backend, permisos, cuotas ni reglas de reserva.

## Validación

Tras añadir Mis facturas: `pnpm --filter @2j/client-app test` 48/48; `typecheck` correcto; `build` correcto; `build:demo` correcto; `git diff --check` correcto. Son pruebas de cliente con respuestas sintéticas; no se probó una sesión real.

## Revisión requerida

Revisión independiente anterior completada sobre `5f47137989179798cb96ab406d801ee072af23a6`: sin hallazgos para ese SHA. No cubre Mis facturas y requiere revisión independiente sobre el SHA final. Tampoco verificó CI remoto, secret scan, staging ni una sesión real. `gitleaks` y `trufflehog` no están instalados localmente.
