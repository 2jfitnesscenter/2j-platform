# A67 — Mensajes de error de cobros y caja

## Alcance

La interfaz de Economía traduce los errores recibidos al iniciar/confirmar traspasos, registrar/resolver gastos y retiradas, y registrar pagos mediante `reasonText`. Los fallos de red indican la acción que falló y que los datos ya registrados no se pierden. La falta de caja al cobrar conserva el aviso guiado y evita un mensaje vacío.

Los textos del módulo de razones incluyen causa y siguiente paso. Se eliminaron expectativas de prueba ligadas al antiguo error de fichaje que A76 retiró; el fallback actual muestra la acción y el código recibido. No se modificó lógica de negocio ni el API.

## Verificación local

- `pnpm install --frozen-lockfile`: completado (las dependencias de este worktree estaban incompletas).
- Admin Web: **443/443** tests; **21/21** tests focalizados (economía, razones y fichaje).
- `pnpm --filter @2j/admin-web typecheck`: PASS.
- `pnpm --filter @2j/admin-web build`: PASS; quedan los avisos conocidos de `use client` de `lucide-react` y tamaño del chunk.
- `git diff --check`: PASS.

## Estado

PR Draft de nivel 2: pendiente de una revisión independiente antes de cualquier merge, según A60/A61. No se ha desplegado ni aplicado ninguna migración.

## No conectado

Este cambio no conecta pagos, caja o traspasos a un proveedor externo; solo mejora los mensajes de error del flujo ya existente.
