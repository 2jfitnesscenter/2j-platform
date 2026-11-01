# A67 — Historial completo de reservas del miembro

## Cambio

`GET /api/me/bookings` acepta `limit` (1–100) y `offset`, pagina reservas y lista de espera bajo el mismo miembro autenticado y devuelve `nextOffset`. La app Member sigue todas las páginas antes de mostrar el historial. La página inicial conserva la URL anterior y límites inválidos se rechazan.

La regresión crea 205 reservas sintéticas, recorre cada página y confirma que no hay IDs repetidos ni corte a 100. No se añadieron migraciones ni se modificó el acceso de otros miembros.

## Validación local

- API/PostgreSQL sobre base sintética nueva: **455/455**.
- Client App: **50/50**.
- Typecheck API y Client App: PASS.
- Build API y Client App: PASS.
- `git diff --check`: PASS.

## Estado

PR de nivel 2 listo para una revisión independiente de privacidad/datos personales según A60/A61. No se ha desplegado ni se ha modificado ningún dato real.
