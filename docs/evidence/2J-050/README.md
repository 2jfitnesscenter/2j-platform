# Evidencia visual 2J-050

Vista del módulo Equipo inspeccionada en navegador local usando registros completamente sintéticos. Los anchos explícitos fueron 1440, 768 y 390 px. En 390 px el documento midió 375 px frente al viewport de 390, sin desbordamiento horizontal del documento; en 768 px midió 753 px.

Se revisaron dashboard, lista de profesionales, jornada personal y cambios próximos. El navegador permitió capturar y ver las imágenes durante la sesión, pero este entorno no ofrece un mecanismo para persistir esos PNG en el workspace. Por eso no se presentan rutas de imagen inexistentes como evidencia versionada. Los flujos/estados se cubren además mediante pruebas de UI y API.

Los datos de navegador provinieron de un PostgreSQL Docker efímero para QA; se detendrá y eliminará el contenedor al cerrar la verificación. No usar los registros sintéticos fuera de este entorno.

Estados capturados y revisados: desktop 1440×1000, tablet 768×1024 y móvil 390×844. Diálogos y estados de loading/error/empty cuentan con pruebas automatizadas; sus capturas visuales persistentes quedan como polish pendiente.
