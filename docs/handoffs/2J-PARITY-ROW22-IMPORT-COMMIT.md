# Handoff — importación real de clientes de TIMP (A63)

Apilado sobre #141 (vista previa). Migración **0060** (comprobada contra todos los PR abiertos: 0054 #125, 0058 #141, 0059 #132; 0060 libre).

## Qué hace
- `POST /api/clients/import/preview` devuelve además `fileDigest` (SHA-256 del archivo) y `commitAvailable`.
- `POST /api/clients/import/commit`: permisos `clients.manage` **y** `settings.manage` (perfil de administración), activado solo con `CLIENT_IMPORT_PREVIEW_ENABLED=true` y `CLIENT_IMPORT_COMMIT_ENABLED=true`. La confirmación viaja en cabeceras (`x-import-confirm: IMPORTAR`, `x-import-digest`, `x-import-expected-rows`) y se comprueba antes de leer el archivo; si la huella o el número de filas no coinciden con la vista previa, 409 y no se crea nada.
- Reglas A62: se importan todos los registros sin error de formato; **activo** si la última reserva está en los últimos 365 días (hora de Canarias), **archivado** (inactivo) en caso contrario; fichas incompletas marcadas (`import_incomplete_fields`) y posibles menores (`minor_review`); **sin deuda, cargos ni pagos**. Un correo repetido entre clientes activos no se guarda en el segundo (se marca `email_not_stored_duplicate`) porque la identidad activa es única.
- Transacción única con bloqueo; el mismo archivo no se importa dos veces (devuelve el resultado anterior); un ID de TIMP ya importado se omite (`already_imported`).
- Auditoría: `client_import_runs` (solo recuentos, huella del archivo y actor; append-only) y un evento `client.imported` por cliente. El archivo no se guarda ni se registra: ni en Git, ni en logs, ni en disco.
- Pantalla **Importar clientes** (Gestión): elegir archivo → vista previa con recuentos y filas con error → casilla de comprensión → «Importar N clientes» → resultado.

## Para el propietario (producción, solo con su frase literal)
1. Aplicar la migración 0060 sobre la base real (acción reservada al propietario).
2. Activar `CLIENT_IMPORT_PREVIEW_ENABLED=true` y `CLIENT_IMPORT_COMMIT_ENABLED=true` en el servicio de la API.
3. Entrar con el perfil de administración, Gestión → Importar clientes, subir el `.xls` de TIMP, revisar y confirmar.
4. Después de importar, volver a desactivar `CLIENT_IMPORT_COMMIT_ENABLED`.

## Pruebas (datos sintéticos únicamente)
- API contra PostgreSQL descartable: `client-import-commit.test.mjs` 4/4 y `client-import.test.mjs` 7/7 sin regresión.
- admin-web: `import-page.test.mjs` 5/5, más menú y a11y; typecheck API y web.
- No se ha procesado ningún Excel real ni se ha ejecutado nada en una base real.
