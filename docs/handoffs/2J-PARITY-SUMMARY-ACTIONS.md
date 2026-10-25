# Handoff — Resumen: acciones rápidas

## Alcance

Se añade al Resumen una banda compacta de acciones rápidas basada exclusivamente en `quickActions`, el campo que ya devuelve `GET /api/dashboard/command-center` según los permisos efectivos del actor. Cada acceso conserva la etiqueta y el destino interno entregados por el servidor; se descartan destinos que no sean hashes internos compatibles con la navegación de Admin Web.

La banda usa `Button`, iconos y tokens existentes de `@2j/ui`/Design Tokens. No añade endpoints, mutaciones, permisos ni flujos simulados. Por ello las etiquetas describen el destino real —por ejemplo, «Abrir agenda»— y no afirman iniciar una reserva o un cobro.

## Archivos

- `apps/admin-web/src/command-center.tsx`
- `apps/admin-web/src/summary-v2.css`
- `apps/admin-web/test/app-shell.test.mjs`

## Validación local

- Admin Web: 187/187 tests aprobados.
- Admin Web typecheck: aprobado.
- Admin Web build: aprobado.
- `git diff --check`: aprobado.

La prueba añadida confirma que se muestran solo acciones proporcionadas por el modelo, con sus destinos internos e iconos, y que un enlace externo no se representa como acción.

## Evidencia visual

No se adjuntan capturas: las pruebas de UI son de DOM y no se ejecutó una sesión de navegador conectada a un backend de demostración. No se presentan capturas simuladas como evidencia visual.

## Límites preservados

Sin cambios en el backend ni en los módulos de Home, Búnker, Caja o Asistencia. Sin merge ni despliegue.
