# 2J-HOME-DOCUMENTS-CONSENTS

## Estado

- Rama local: `agent/codex/2J-HOME-DOCUMENTS-CONSENTS`.
- Base rebased de Claude: `7074177be0e9db7d42342466813627392f4a6d03` (`MEASUREMENTS-CLIENT-rebased`), que ya contiene la integración local apilada sobre PUSH-CLIENT-rebased/PR #71.
- Se añadió regresión de documentos y consentimientos accesibles sin cuota; no se cambiaron contratos ni lógica de negocio.

## Real, prototipo y pendientes

- **Real en Home:** perfil consulta `GET /api/client-portal/form-assignments` y `GET /api/client-portal/consents`; formularios asignados se consultan y envían por sus endpoints; consentimientos se aceptan explícitamente en `/api/client-portal/consents/:versionId/accept`. El cliente no escribe respuestas en otra base.
- **Prototipo:** solo la vista de preview usa asignaciones y consentimientos ficticios.
- **D31:** formularios/consentimientos siguen disponibles sin cuota; la prueba nueva cubre lectura, envío y aceptación y comprueba que no se cargan operaciones de reserva.
- **D48/D150 parcial:** Home presenta formularios y consentimientos en apartados de Perfil, no un archivo documental único por fecha/buscador y categorías (contratos, facturas, certificados, otros). No existe endpoint miembro de Home que entregue archivos de esa clase.
- **D151/D154 pendientes:** no hay carga de adjuntos del cliente ni fecha/caducidad documental en el contrato del portal.
- **D152:** requiere notificaciones push vinculadas al documento solicitado/rechazado; la infraestructura push de PR #71 está presente en la base rebased, pero la vinculación de eventos documentales y preferencias de ese evento no se verificó ni se implementó aquí.
- **D153/D155:** revisión, rechazo con motivo y eliminación autorizada pertenecen a Platform/staff-app; Home no duplica esas funciones.
- **D63 pendiente:** Home no permite editar datos personales; no se encontró contrato de autoedición, verificación de correo o validación de datos legales en los endpoints de miembro inspeccionados.
- **D64 parcial:** el consentimiento recoge nombre tecleado y aceptación explícita, pero no firma manuscrita ni PDF firmado.
- **D65 parcialmente cubierto por Platform:** el motor de reservas verifica documentos obligatorios; Home presenta el motivo de bloqueo de forma genérica cuando el endpoint de elegibilidad lo devuelve. No asigna ni elimina requisitos.

## Pruebas

- Cliente: 26/26; incluye una prueba nueva de cliente sin cuota que abre y envía un formulario asignado, acepta un consentimiento y no solicita endpoints de reservas.
- API `communications.test.mjs`: 9/9 contra PostgreSQL efímero local, iniciado para esta ejecución y retirado al terminar; cubre asignaciones, respuestas, consentimiento, control de acceso e historial.
- `pnpm --filter @2j/client-app typecheck`: correcto.
- `pnpm --filter @2j/client-app build`: correcto.
- UI comprobada con contratos/respuestas sintéticas; persistencia/validación del API comprobadas solo en PostgreSQL local de pruebas. Sin staging ni producción.

## Próximas dependencias

Work Platform debe definir los contratos de archivo documental, descarga/adjuntos y edición de perfil antes de ampliar Home. La firma dibujada/PDF requiere contrato documental y decisión técnica/legal; Home no presenta el nombre tecleado como firma manuscrita.
