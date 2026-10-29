# Handoff — paridad API, fila 16 Documentos

- Base revisada: `abd31b89ffc2ce64c9fae167f2226267234b2348`.
- Alcance: documentos privados vinculados a clientes; no incluye pantalla Admin, salud/cuestionarios, facturación, pagos ni carga de justificantes.
- Migración propuesta/implementada en la rama: `0057_client_documents.sql`. Antes de publicar se volvió a consultar el conjunto de PRs abiertas: #124 usa 0053 y #125 usa 0054; `0055` está integrada en main y no se detectó otra migración en PR abierta. La fila 7 reserva 0056; la fila 22 queda en 0058.
- Permisos: personal necesita `documents.manage` para subir/cambiar visibilidad y `documents.read` para listar/descargar; el miembro solo ve y descarga sus documentos `client_visible` mientras su faceta cliente está activa.
- Archivos: claves generadas por el servidor, almacenadas mediante `ObjectStorage`, MIME comprobado por bytes, máximo 5 MiB, descarga como adjunto y auditoría append-only sin clave ni nombre original.
- Datos utilizados por pruebas: clientes sintéticos creados en una base PostgreSQL local desechable; sin datos reales.
- Pendiente: revisión independiente antes de merge; no se ha fusionado ni desplegado. La instalación debe contar con almacenamiento privado y política de backup antes de manejar archivos reales.

## Validación ejecutada

- `pnpm install --frozen-lockfile`: PASS.
- `pnpm build --force`: PASS (9/9 paquetes; advertencias existentes de `lucide-react` y chunk size en Admin Web).
- `pnpm --filter @2j/api typecheck`: PASS, después de compilar dependencias del workspace.
- `client-documents.test.mjs`: 4/4 PASS en PostgreSQL sintético desechable.
- Suite API completa, audit/secret scan y CI de PR: pendientes.
