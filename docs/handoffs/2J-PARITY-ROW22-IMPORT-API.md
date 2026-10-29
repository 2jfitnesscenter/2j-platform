# Fila 22 — API de previsualización de importación de clientes

## Estado

- Rama: `codex/2J-PARITY-22-IMPORT-API`
- Base: `abd31b89ffc2ce64c9fae167f2226267234b2348`
- Publicación: pendiente de revisión local; no se ha hecho push ni abierto PR.
- Alcance: API de previsualización CSV/XLSX, validación y auditoría. No existe ruta de confirmación ni se crean o actualizan clientes.
- La función está desactivada por defecto. Su activación requiere configuración explícita; el endpoint exige autenticación y `clients.manage`.

## Seguridad y datos

- Límites: 5 MiB por fichero, 500 filas y 20 MiB expandidos para XLSX; rechaza macros, fórmulas, enlaces y columnas desconocidas.
- No se registran nombres, contactos, fechas de nacimiento ni contenido del fichero. El log de error de base de datos contiene solo el código del error y la ruta.
- La respuesta de previsualización devuelve las filas al actor autorizado con `clients.manage`; no se almacena el fichero ni se crea/modifica ningún cliente.
- La tabla append-only registra actor, formato y contadores agregados, sin PII ni hash del contenido.
- Una importación real permanece bloqueada hasta una aprobación explícita del propietario y una tarea posterior con alcance propio.

## Parser y migración

Se usa ExcelJS (`4.4.0`) para XLSX porque no había parser XLSX en las dependencias existentes. Se añadió override de `uuid` a `^11.1.1` para evitar resolver la rama antigua usada por ExcelJS. El parser CSV es local y no añade dependencia.

Se propone `0058_client_import_audit.sql`. Tras actualizar refs remotas, se buscaron rutas `apps/api/migrations/0058_*` en los PR abiertos y en los árboles de todas las ramas `origin/*` disponibles; no se encontró colisión. La secuencia contrastada incluye `0053` (#124), `0054` (#125) y `0055` en main. Esta comprobación refleja el estado observado durante esta tarea y debe repetirse antes de publicar si el tiempo transcurrido o nuevas ramas pudieran cambiarlo.

## Verificación local

- `@2j/api` test enfocado, PostgreSQL sintético limpio: 5/5 PASS.
- Suite completa `@2j/api`, PostgreSQL sintético: 376/376 PASS.
- `@2j/api` typecheck: PASS.
- Build del monorepo: 9/9 tareas PASS.
- Migraciones aplicadas desde cero en PostgreSQL sintético: 52 registradas; última `0058_client_import_audit.sql`, tabla `client_import_preview_audit` presente.
- `pnpm audit --audit-level=high`: exit 0; 10 avisos conocidos (6 low, 4 moderate), 0 high/critical según este umbral.
- `pnpm audit --audit-level=high`: 10 avisos: 6 low, 4 moderate, 0 high, 0 critical. El total coincide con el recuento previo observado en la base antes de introducir ExcelJS; no se ha incluido una actualización general de dependencias.

Base de datos usada: Docker PostgreSQL desechable en loopback, puerto 55462; sin conexión a bases reales.

## Revisión pendiente

Revisar el diff local antes de cualquier commit o publicación. En particular, confirmar que el alcance de columnas permitidas es suficiente para la plantilla Excel real y que el retorno de PII queda aceptable para los roles con `clients.manage`. No se ha probado una importación real y no debe habilitarse para uso productivo.
