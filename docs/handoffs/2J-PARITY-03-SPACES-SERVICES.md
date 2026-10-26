# Handoff — Espacios y Servicios separados

## Decisión aplicada

La decisión del propietario establece que **Espacios** y **Servicios** son pantallas separadas, como en Base44. El modelo y las rutas API existentes de áreas y servicios se conservan; esta entrega separa la navegación y la presentación, sin duplicar lógica de dominio.

## Resolución del conflicto con `main`

Se integró el `main` vigente y se conservaron sus versiones de las cinco áreas conflictivas antes de aplicar esta separación:

- `apps/admin-web/src/app-shell.tsx`
- `apps/admin-web/src/main.tsx`
- `apps/admin-web/src/services-page.tsx`
- `apps/admin-web/test/app-shell.test.mjs`
- `apps/admin-web/test/services-page.test.mjs`

El resultado conserva el shell y la UI recientes de `main`, y añade rutas independientes `#spaces` y `#services`. La primera presenta los espacios (áreas operativas); la segunda presenta servicios y, para perfiles autorizados, sus planes.

## Verificación local

- Tests Admin Web enfocados en shell, catálogo y separación de pantallas: 58/58 PASS.
- Typecheck Admin Web: PASS.
- Build Admin Web: PASS.
- `git diff --check`: PASS.
- Se debe esperar CI sobre el nuevo head antes de considerar esta rama revisada.

No se ha fusionado ni desplegado esta rama. Conforme a A57, requiere revisión independiente antes de cualquier merge.
