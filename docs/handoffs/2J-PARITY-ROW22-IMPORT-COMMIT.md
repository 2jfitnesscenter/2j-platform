# Handoff — importación real de clientes de TIMP (A63)

Apilado sobre #141 (vista previa). Migración **0060** (comprobada contra todos los PR abiertos: 0054 #125, 0058 #141, 0059 #132; 0060 libre).

## Qué hace
- `POST /api/clients/import/preview` devuelve `previewId`, `fileDigest` (SHA-256 del archivo), `commitAvailable` y, para TIMP, `timpSummary.asOfDate` (fecha de corte en Atlantic/Canary).
- `POST /api/clients/import/commit`: permisos `clients.manage` **y** `settings.manage` (perfil de administración), activado solo con `CLIENT_IMPORT_PREVIEW_ENABLED=true` y `CLIENT_IMPORT_COMMIT_ENABLED=true`; el helper de runtime mantiene el commit apagado si preview no está habilitado. La confirmación envía `previewId`, huella, recuento y confirmación explícita. La API comprueba actor, formato, filas y huella contra la fila append-only de vista previa. Si cambia el día local canario entre preview y confirmación, responde `409 preview_date_changed`, sin importar; se debe generar y revisar una vista previa nueva.
- Reglas A62: se importan todos los registros sin error de formato; **activo** si la última reserva está en los últimos 365 días (hora de Canarias), **archivado** (inactivo) en caso contrario; fichas incompletas marcadas (`import_incomplete_fields`) y posibles menores (`minor_review`); **sin deuda, cargos ni pagos**. Un correo repetido entre clientes activos no se guarda en el segundo (se marca `email_not_stored_duplicate`) porque la identidad activa es única.
- Transacción única con bloqueo; el mismo archivo no se importa dos veces (devuelve el resultado anterior); un ID de TIMP ya importado se omite (`already_imported`).
- Auditoría: `client_import_preview_audit` conserva solo actor, formato, recuentos, huella y fecha de corte (append-only); `client_import_runs` conserva solo recuentos, huella y actor (append-only), y se genera un evento `client.imported` por cliente. El archivo no se guarda ni se registra: ni en Git, ni en logs, ni en disco.
- Pantalla **Importar clientes** (Gestión): elegir archivo → vista previa con recuentos y filas con error → casilla de comprensión → «Importar N clientes» → resultado.

## Para el propietario (producción, solo con su frase literal)
1. Aplicar la migración 0060 sobre la base real (acción reservada al propietario).
2. Activar `CLIENT_IMPORT_PREVIEW_ENABLED=true` y `CLIENT_IMPORT_COMMIT_ENABLED=true` en el servicio de la API.
3. Entrar con el perfil de administración, Gestión → Importar clientes, subir el `.xls` de TIMP, revisar y confirmar.
4. Después de importar, volver a desactivar `CLIENT_IMPORT_COMMIT_ENABLED`.

## Pruebas (datos sintéticos únicamente)
- API contra PostgreSQL descartable: `client-import-commit.test.mjs` 6/6, incluido preview obsoleto tras cambiar el día local, y flags de activación; la suite `client-import.test.mjs` no se ejecutó en este delta.
- admin-web: `import-page.test.mjs` 5/5; typecheck API y web: PASS; `git diff --check`: PASS.
- No se ha procesado ningún Excel real ni se ha ejecutado nada en una base real.

## Delta de revisión independiente bb98b643
- Se conserva la activación explícita y se impide que `CLIENT_IMPORT_COMMIT_ENABLED` active la importación cuando preview está deshabilitado.
- Se corrige el cambio de fecha entre vista previa y confirmación: la API vincula la vista previa al actor, archivo y fecha de corte, muestra esa fecha al propietario y rechaza el corte obsoleto antes de crear clientes.
- #153 sigue sin merge. Este delta necesita revisión independiente y CI en su nuevo SHA exacto.

## Delta de revisión sobre main actualizado (30 oct 2026)
- Base integrada: `e33113c311171fb7d63da9964774db39eaca4630` (login de personal #125). Se resolvió el único conflicto en `apps/api/src/server.ts` manteniendo tanto sus opciones de identidad como las banderas del importador.
- Correcciones de la revisión de `bb98b643`: (1) `CLIENT_IMPORT_COMMIT_ENABLED` no puede habilitar la confirmación sin preview habilitado; (2) cada preview queda ligado por actor, formato, huella y fecha local canaria; si cambia esa fecha antes de confirmar, responde `409 preview_date_changed` y no importa.
- La interfaz conserva el `previewId` y muestra la fecha de corte. Los tests cubren banderas, auditoría, confirmación obsoleta y error visible. El fixture API de 1.390 filas usa reloj fijo para evitar que una suite futura cambie su clasificación por la fecha real.
- Verificación local en PostgreSQL sintético limpio: API `417/417`; Admin Web `366/366`; typecheck API/Admin PASS; build API/Admin PASS; diff-check PASS. Ningún Excel real, base real o despliegue.
- El nuevo SHA requiere una revisión independiente de este delta y CI (quality, secret scan y E2E) antes de cualquier merge.
