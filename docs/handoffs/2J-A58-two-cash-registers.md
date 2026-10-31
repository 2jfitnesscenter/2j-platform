# Handoff — diseño de dos cajas A58

- Estado: diseño documental Draft; se incorporaron P1/P2 de la revisión Work Home; re-revisión pendiente.
- Base revisada: `origin/main` en `5e1d6b26079228aa13c5f32e37cd75199e7c1a7b` (2026-10-27).
- Decisión directa del propietario confirma: cada persona custodia como máximo una caja; Búnker y Sala pueden estar abiertas simultáneamente con custodios distintos; handover por caja.
- Modelo propuesto: catálogo `economic_cash_registers`; `economic_cash_sessions.register_id`; intervalos de custodia y handovers con conteos separados; ledger existente conectado por `cash_session_id`; sumario global desglosable por registro.
- Privacidad API: `owner.panel.read` recibe global, ambos registros, total, expected, counted, diferencias e incidencias. Personal queda restringido por servidor a sus propias operaciones en un solo registro autorizado; no puede ver movimientos de custodios anteriores/alternativos, incluso en la misma caja. Traspasos muestran únicamente el conteo y confirmación propios. Sin agregados globales/de caja, cierres previos, diferencias, esperado ni recuentos ajenos.
- Legado: sesiones históricas no se asignan por suposición. Una sesión abierta sin register_id bloquea globalmente nuevas aperturas y movimientos; owner-only la resuelve con motivo, conteo real, auditoría y aviso al trainer, sin modificar fichajes.
- A37: no se permite clock-out con custodia activa; debe cerrar o completar handover. Cierre/traspaso y clock-out requieren exclusión transaccional para cerrar carreras.
- D111: el flujo de apertura no lee ni muestra cierre previo; 50 EUR es referencia, no precarga.
- A47/A49/A50: gastos/retiradas con permiso específico, tipo y motivo obligatorios; justificante opcional; límite owner-configurable nulo por defecto; superar el límite requiere aprobación.
- Candidata `0055_cash_registers.sql`: explorados los árboles de las 16 PR abiertas y `origin/main`; no existe otro `0055_*.sql`. #124 propone 0053 y #125 0054. Revalidar tras re-review y justo antes de crear el fichero.
- Implementación y migración: todavía no iniciadas. Este PR solo cambia diseño/handoff documental. No se ejecutó DB.
- Revisión independiente requerida: Work Home re-review del nuevo head; no merge antes de resultado aprobatorio.
