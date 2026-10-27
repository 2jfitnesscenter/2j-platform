# Handoff — diseño de dos cajas A58

- Estado: diseño documental Draft; no hay cambios de producto ejecutables.
- Base: `5e1d6b26079228aa13c5f32e37cd75199e7c1a7b` (`origin/main`, 2026-10-27).
- Decisión directa del propietario confirma: cada persona custodia como máximo una caja; Búnker y Sala pueden estar abiertas simultáneamente con custodios distintos; handover por caja.
- Modelo propuesto: catálogo `economic_cash_registers`; `economic_cash_sessions.register_id`; intervalos de custodia y handovers con conteos separados; ledger existente conectado por `cash_session_id`; sumario global desglosable por registro.
- Migración candidata `0055_cash_registers.sql`; 0053 está en PR #124, 0054 en #125, y no se encontró 0055 en el resto de PRs abiertas. Revalidar antes de implementar.
- Privacidad: solo `owner.panel.read` recibe diferencia, expected amounts o incidentes de conteo.
- Tests/código/migraciones/despliegues: ninguno en este PR.
- Revisora independiente requerida antes de merge: Work Home o Work Búnker.
