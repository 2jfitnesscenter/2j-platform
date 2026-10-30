# Fila 22 — previsualización de importación TIMP

## Estado y límites

- PR existente: #141, rama `codex/2J-PARITY-22-IMPORT-API`, permanece Draft y sin fusionar.
- Alcance: `POST /api/clients/import/preview` conserva el modo `dry_run`; no hay ruta de confirmación y nunca crea/actualiza clientes.
- Activación apagada por defecto; endpoint exige autenticación y `clients.manage`.
- A62 aplicada: campos de TIMP, fecha de corte de 365 días, estados active/inactive, ficha incompleta y revisión por DOB ausente. Todos los registros se muestran; los campos ausentes no bloquean.
- `Deuda total` se ignora aunque la columna contenga un valor. No se importan cargos, pagos ni deuda.
- No se abrió ni procesó el Excel real adjunto. Los tests generan en memoria un `.xls` sintético con 1.390 filas; no hay datos reales copiados al repo.

## Formato, reglas y privacidad

- El parser admite CSV, XLSX y XLS clásico. TIMP reconoce ID, Nombre, Apellidos, Fecha de alta, Código de cliente, Correo electrónico, Teléfono, Género, Fecha de nacimiento, Fecha última reserva, Procedencias y Etiquetas.
- Columnas desconocidas vacías (p. ej., fiscal/dirección/política) se omiten sin devolver sus valores. `Deuda total` tiene omisión explícita. Una columna desconocida con datos bloquea la previsualización sin revelar su contenido.
- Límite: 5 MiB, 2.000 filas y 64 columnas; XLSX mantiene el límite de expansión de 20 MiB. Se rechazan fórmulas, hipervínculos y libros con más de una hoja.
- La fecha local del día se calcula en `Atlantic/Canary`; desde hoy hasta exactamente el límite inclusivo de 365 días es `active`; más antiguo, ausente o futuro queda `inactive` (el futuro también se marca como error de fila).
- `completenessStatus=imported_incomplete` y `incompleteFields` cubren correo, teléfono, género y nacimiento ausentes. DOB ausente marca `minor_review`; nunca se inventan datos.
- La respuesta cuenta total, activos, inactivos, incompletos por campo y filas con email/teléfono duplicado. Conserva todas las filas y separa avisos de errores estructurales.
- Respuesta PII solo al actor autorizado. El audit append-only almacena actor, formato y conteos, nunca filas, contactos, fechas ni el fichero. `Cache-Control: no-store`.

## Parser y migración

- XLSX existente usa ExcelJS. XLS clásico usa SheetJS Community Edition `0.20.3`, fijado al tarball oficial porque las instrucciones oficiales identifican CDN como distribución Node autorizada: [instalación Node](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/).
- Migración existente del PR `0058_client_import_audit.sql` permanece como `0058`; ahora permite formato `xls` y hasta 2.000 filas en el audit. No se crea una migración nueva ni se aplica a una base real.
- La pila debe conservar `0053`, `0054`, `0055` en main y después `0056`, `0057`, `0058`, `0059`; #141 sigue pendiente de integrar después de #140 (0056) y #138 (0057), y antes de #132 (0059).

## Verificación ejecutada

- Test focal `client-import.test.mjs`: 7/7 PASS; incluye 1.390 filas XLS sintéticas, límite de 365 días, duplicados, incompletos, columnas vacías, omisión de deuda, rechazo determinista de fórmulas/hipervínculos y API auditada sin escritura de clientes.
- Suite API completa en PostgreSQL Docker desechable recién creado: 378/378 PASS, 0 fallos/omitidos. Última migración aplicada: `0058_client_import_audit.sql`.
- `pnpm typecheck`: 10/10 tareas PASS. `pnpm build --force`: 9/9 tareas PASS.
- `pnpm audit --audit-level high`: PASS; 11 avisos conocidos (6 low, 5 moderate), 0 high/critical según el umbral.
- `git diff --check`: PASS. No se accedió a staging, producción ni bases de datos reales.

## Pendiente antes de integrar

- Revalidar numeración/árboles abiertos y actualizar la rama contra main después de #140 y #138, sin reescribir la migración como una numeración distinta.
- Una revisión independiente para este PR de nivel 2 antes del merge. Importación real sigue bloqueada hasta la frase literal aprobada por el propietario y se ejecutará solo en producción bajo su control; nunca en staging ni Git.
