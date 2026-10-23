# 2J-HOME-NEWS-NOTICES

## Estado local

- Rama: `agent/codex/2J-HOME-NEWS-NOTICES`.
- Base: `fa7f4e630f4387ac242a276f233ec87a5efffa19`.
- Se añadió una prueba de reintento para lectura de noticias; no se cambió el contrato API ni la lógica de publicación.

## Real, simulado y pendiente

- **Real en Home:** `GET /api/me/news` muestra noticias publicadas, destacado, fecha, detalle y orden reciente. Las noticias son independientes del buzón de notificaciones y accesibles sin cuota (D31).
- **Simulado:** la vista previa usa artículos ficticios y no llama al API.
- **D67 parcial:** el endpoint existente cubre publicación/retirada, destacado, filtrado de centro y lectura de cliente. No expone destinatarios, programación futura, caducidad ni permisos editoriales configurables por entrenador.
- **D68 pendiente:** el modelo/endpoint de noticia no contiene prioridad normal/importante/urgente ni confirmación de lectura urgente. Home no infiere prioridad desde `featured` ni cambia los avisos del buzón.
- La publicación y gestión editorial pertenecen a Platform; esta rama no las duplica.

## Verificación

- Cliente: 18/18. La prueba nueva simula una caída temporal de `GET /api/me/news`, usa el reintento de Inicio y comprueba que se renderiza el contenido recuperado sin cuota.
- API `center-news.test.mjs`: 1/1 sobre un contenedor PostgreSQL efímero local, aislado y retirado tras la prueba; verifica permisos editoriales, visibilidad, destacado, retirada y auditoría.
- Typecheck y build de `@2j/client-app`: correctos.
- La prueba de Home emplea respuestas de contrato sintéticas; la de API usa PostgreSQL local, no staging ni producción.

## Siguiente

Work Platform debe versionar los campos de audiencia, fecha de publicación/caducidad, permisos editoriales y prioridad/acuse de lectura. Home puede consumirlos cuando exista un contrato aprobado.
