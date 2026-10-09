# Evidencia visual 2J-050

La interfaz se abrió contra la API local y PostgreSQL 17 desechable, con datos sintéticos de QA. Después de las correcciones se inspeccionó visualmente el dashboard de Equipo en el navegador. La captura inline de esta sesión midió 1265×712 px; se observó la jerarquía del dashboard, lista de personas, estado de jornada y panel de cambios próximos.

El runtime disponible no permite controlar explícitamente el viewport a 1440, 768 y 390 px ni guardar la captura inline como PNG del workspace. Por tanto, esta pasada **no afirma** que se hayan generado ni inspeccionado nuevas capturas en esas tres dimensiones. La evidencia responsive automatizada cubre tabs, navegación de teclado, selección y scroll/foco móvil; queda como polish una revisión visual repetible con viewport fijado y capturas persistentes a 1440×1000, 768×1024 y 390×844.

Las pruebas de UI cubren confirmaciones/feedback, edición y archivo de profesionales, archivo de tramos, cancelación de ausencias, selección/reasignación de sesiones de sustitución y estados de perfil. No se incluyen imágenes inexistentes como evidencia. El contenedor PostgreSQL de QA y los servidores locales son efímeros y se detendrán tras la verificación.

No usar estos registros sintéticos fuera del entorno de pruebas. No mostrar ni capturar PII real.
