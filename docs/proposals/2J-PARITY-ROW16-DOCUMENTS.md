# Diseño breve — fila 16: Documentos privados por cliente

## Alcance

Añade metadatos de documentos asociados a `clients.id` y almacena el archivo en el adaptador privado `ObjectStorage`. La clave la genera el servidor y nunca se devuelve al navegador. No incorpora cuestionarios, formularios de salud, facturas ni justificantes de pago.

## Datos y migración

La migración `0057_client_documents.sql` crea `client_documents` (cliente, título, tipo, visibilidad, MIME detectado, tamaño, estado y actor/fechas) e `client_document_audit_events` (subida, cambio de visibilidad y descarga, append-only). `client_id` usa `ON DELETE RESTRICT`. El archivo admite PDF, JPEG o PNG de hasta 5 MiB. La aplicación archiva metadatos; no implementa borrado ni retención automática.

## API y permisos

- `POST /api/clients/:clientId/documents`: `documents.manage`; multipart `file`, `title`, `documentType`, `visibility`.
- `GET /api/clients/:clientId/documents` y `GET .../:documentId/download`: `documents.read`, con ambos identificadores aplicados en SQL.
- `PATCH /api/clients/:clientId/documents/:documentId/visibility`: `documents.manage`.
- `GET /api/client-portal/documents` y `GET /api/client-portal/documents/:documentId/download`: solo identidad Member activa, cliente propio y visibilidad `client_visible`.

Las descargas siempre pasan por la API, llevan `no-store`, `nosniff` y `Content-Disposition: attachment`. Ni el nombre enviado por el usuario ni la ruta local se usan como clave o cabecera de descarga.

## Límites para revisión

Tipos admitidos inicialmente: `contract`, `consent`, `identity`, `other`; visibilidad: `staff_only` o `client_visible`. El módulo no puede clasificar semánticamente el contenido de un PDF; perfiles autorizados siguen siendo responsables de no subir material de salud, que continúa fuera de alcance según D33. La instalación actual aporta almacenamiento local privado; el despliegue debe configurar el proveedor de objetos privado y su política de backup antes de usar archivos reales. No se prueba staging ni se usan datos reales en esta TASK.
