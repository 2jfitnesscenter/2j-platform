# Handoff — paridad API, fila 2 Accesos de turno

- Base: `abd31b89ffc2ce64c9fae167f2226267234b2348`.
- Cambia únicamente los rótulos de las acciones API ya existentes: `Registrar pago` → `Cobrar`, `Registrar venta` → `Vender`.
- Se preservan permisos y destinos: `billing.payments.manage` → `#economics`; `store.sales.create` → `#store?sale=1`. No se ejecuta cobro ni venta desde la acción rápida; la pantalla destino conserva validación, caja abierta D113 y auditoría.
- La PR #102 es UI únicamente sobre `command-center.tsx`; no la modifica esta rama.
- Validación local en PostgreSQL sintético desechable: suite API completa 372/372 PASS, 0 fallos ni omitidos; test de permisos nuevo incluido.
- Typecheck API: PASS. Build monorepo: 9/9 tareas PASS. `git diff --check`: PASS.
- CI de GitHub aún pendiente de publicar la rama.
