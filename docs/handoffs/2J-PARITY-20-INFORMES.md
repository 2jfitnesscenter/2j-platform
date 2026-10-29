# Handoff — Informes (PR #147)

## Corrección del P2

Las exportaciones de ventas ya no entregan resultados parciales como si fueran completos:

- CSV: límite de 500 filas; si hay más, responde `413 export_result_limit_exceeded`.
- XLSX: límite de 5.000 filas; si hay más, responde `413 export_result_limit_exceeded`.
- El XLSX comprueba el límite antes de calcular o incluir el resumen, evitando totales que no correspondan a las filas exportadas.

Se añadió una regresión API que crea 5.001 cargos sintéticos y verifica ambos rechazos. El test elimina solo sus fixtures y restaura los triggers de inmutabilidad; requiere la base PostgreSQL desechable usada por la suite API. No hay cambios de migración ni de reglas de negocio.

## Base y validación

- Rama del PR: `claude/informes-resumen` (PR #147, sin merge).
- Actualizada contra `origin/main` en `ba276f968ee5ee60194d1b0c5c570b96807c287c`.
- El único conflicto al integrar fue `apps/admin-web/src/summary-v2.css`; se conservaron ambos bloques independientes: estilos de gráficos de Informes y estilos de Mensajes/Resumen de la rama principal.
- Validación del árbol actualizado: `pnpm test` PASS (API 386/386; Client 45/45; Staff 7/7; deploy-kit 6/6; paquetes Admin y librerías también completados con salida 0), `pnpm typecheck` PASS (11/11 tareas), `pnpm build --force` PASS (9/9 tareas).
- La suite completa se ejecutó contra una base PostgreSQL 17 nueva y desechable. CI del nuevo head remoto: pendiente de push.
- Sin cambios en Home, Búnker ni migraciones.
