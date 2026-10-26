# 2J-PARITY-08 — Planes y cuotas

## Estado

PR #115 continúa abierta y sin fusionar. La rama conserva la separación de Espacios y Servicios integrada en #108.

La revisión independiente señaló dos defectos: los planes archivados no se podían reactivar (D172) y desaparecían del catálogo de gestión. La corrección añade una consulta explícita `includeArchived=true`, restringida a `catalog.pricing.manage`, y permite reactivar solo la misma versión comercial congelada cuando todos sus servicios y áreas siguen activos. La versión congelada no se modifica.

La migración `0052_reactivate_archived_plans.sql` endurece el guard de base de datos para esa transición. La UI mantiene visibles los planes archivados y solicita confirmación antes de reactivarlos.

## Verificación

- API completa en PostgreSQL sintético limpio: 365/365 PASS.
- Admin Web completo: 321/321 PASS.
- Admin Web, prueba de planes archivados/reactivación: 9/9 PASS.
- Prueba API enfocada de reactivación tras migración: 1/1 PASS.
- Typecheck: 11/11 PASS.
- Build: 9/9 PASS; permanece el aviso existente de tamaño de chunk de Vite.
- Suite integral limpia y CI del nuevo SHA: pendientes de finalizar antes de re-review.

## Pendiente

Solicitar re-review independiente de Work Home sobre el SHA final. No fusionar antes de aprobación independiente y checks verdes en ese mismo SHA. No desplegar ni aplicar migraciones a una base real.
