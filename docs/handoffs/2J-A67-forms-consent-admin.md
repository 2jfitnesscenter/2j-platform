# 2J-A67 — Gestión de formularios y consentimientos en Admin

## Alcance entregado

Mi gimnasio > Consentimientos incorpora espacios independientes para cuestionarios y textos de consentimiento. La pantalla lista, crea, versiona, activa y archiva catálogos. No asigna cuestionarios, no recoge ni muestra respuestas y no consulta datos de salud de personas.

Los cuestionarios y textos comienzan vacíos, sin preguntas, copy legal, ejemplos publicables ni plantillas por defecto. Guardar crea una versión borrador; activar/publicar requiere acción explícita tras revisar el contenido devuelto por el servidor. Las versiones quedan inmutables.

## Permisos y API

`GET /api/session/capabilities` expone solo cuatro booleanos del actor autenticado: `formsRead`, `formsManage`, `consentsRead`, `consentsManage`. No devuelve permisos ni datos de otros actores. La UI solicita catálogos solo con read y oculta creación, edición, activación y archivo sin manage; el servidor vuelve a autorizar cada ruta.

Se añadió `GET /api/forms/:formId/versions`, protegido por `forms.manage`, para recuperar borradores y esquemas/versiones persistidos. Devuelve solo versión, estado, descripción, definición de campos y fecha; no incluye respuestas, asignaciones ni actor creador. Sin migración. Consentimientos ya tenía lectura de versiones bajo `consents.read`.

## Corrección P2 de revisión independiente

Los consentimientos archivados se muestran con estado «Archivado». El historial continúa accesible, pero la UI oculta nueva versión, publicación y archivo. La API vuelve a comprobar el estado del consentimiento padre dentro de la misma transacción y devuelve 409 si se intenta activar una versión de un consentimiento archivado. Las versiones y aceptaciones históricas se conservan.

## Validación local sobre `origin/main` 91b3a86

- Admin Web completo: 383/383 PASS, incluida la regresión de consentimiento archivado.
- API `dashboard.test.mjs`: 16/16 PASS en PostgreSQL sintético efímero; Admin, Trainer, Reception, Accountant y anónimo.
- API `communications.test.mjs`: 9/9 PASS en PostgreSQL sintético efímero; incluye rechazo de activación tras archivar y conservación del historial.
- Admin Web y API typecheck: PASS.
- Admin Web y API build: PASS; Vite conserva su aviso existente de chunk >500 kB.
- `git diff --check`: PASS.
- Integración de `origin/main` actual `91b3a86def51ec4dcbecfdf2915ab07f9c632a21` por merge normal, sin conflictos. No se añadieron migraciones.
- No se ejecutaron migraciones en bases compartidas ni se usaron datos reales.
