# 2J-A67 — Gestión de formularios y consentimientos en Admin

## Alcance entregado

Mi gimnasio > Consentimientos incorpora dos espacios independientes: cuestionarios y textos de consentimiento. La pantalla usa exclusivamente las rutas Communications existentes para listar, crear, versionar, activar y archivar. No asigna cuestionarios a clientes, no recoge ni muestra respuestas y no consulta datos de salud de personas.

Los formularios y textos comienzan vacíos: no se incluyen preguntas, copy legal, ejemplos publicables ni plantillas por defecto. Crear y versionar guarda un borrador; activar/publicar exige una acción explícita. El esquema de cuestionario se etiqueta como sensible cuando corresponde y las versiones del consentimiento se conservan como historial.

## Permisos

`GET /api/session/capabilities` añade solo cuatro booleanos calculados del actor autenticado: `formsRead`, `formsManage`, `consentsRead`, `consentsManage`. No expone listas de permisos ni datos de otros actores. La UI no solicita catálogos sin permiso de lectura y oculta creación, edición, activación y archivo cuando falta el permiso de gestión. Los endpoints siguen aplicando autorización server-side.

## Límite del API existente

`GET /api/forms` devuelve los campos de la versión activa; no ofrece una ruta de lectura para recuperar el esquema de un borrador. La pantalla conserva en memoria el esquema recién creado para permitir su revisión antes de activarlo durante esa sesión. Si se vuelve a cargar la página, no permite activar ese borrador porque el API no devuelve el contenido que se debe revisar. No añadí una ruta nueva ni una migración.

El API de consentimientos sí ofrece GET de versiones; la pantalla lo usa para inspeccionar el texto histórico. Crear/versionar textos guarda el contenido en borrador y el botón de publicación es separado. No hay edición de metadatos de consentimientos porque no existe una ruta existente para ello.

## Validación local

- Admin Web completo: 380/380 PASS.
- Pruebas focalizadas de Mi gimnasio: 12/12 PASS.
- API `dashboard.test.mjs`: 16/16 PASS en PostgreSQL sintético efímero, recién creado y eliminado al terminar; comprobó Admin, Trainer, Reception, Accountant y anónimo.
- Admin Web typecheck/build: PASS.
- API typecheck/build: PASS.
- `git diff --check`: PASS.
- Build avisa de chunk de frontend >500 kB, existente en la aplicación.
