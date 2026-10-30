# Handoff — configuración de stock de Tienda

**Estado:** backend implementado en una rama local apilada sobre `codex/2J-settings-write-integration` (PR #158); sin publicar ni fusionar.

## Alcance funcional

- `GET /api/settings/store` y `PUT /api/settings/store` exigen `settings.manage` en servidor y responden `Cache-Control: no-store`.
- `lowStockThreshold` es un entero entre 0 y 100.000. El valor inicial es **3**, que conserva el umbral que ya aplicaba el catálogo del socio.
- El catálogo `GET /api/me/store/catalog` lee ese umbral desde Platform; `agotado` sigue teniendo prioridad sobre `pocas_unidades`.
- Solo un cambio efectivo escribe `store.settings.updated` en el ledger inmutable `store_audit_events`, con valor anterior/nuevo y actor. Repetir el mismo valor no genera un evento duplicado.
- No se añadieron comportamiento de bloqueo de ventas, alertas, ni datos fiscales.

## Migración

- Se asignó `0062_store_settings.sql`. La base de trabajo terminaba en `0061_invoice_settings.sql`.
- Revisé los archivos cambiados de las 17 PR abiertas de `2j-platform`: ninguna incluye archivos `apps/api/migrations/*`; no hay colisión visible con `0062`.
- La prueba de integración migró una base PostgreSQL 17 desechable desde cero; no se aplicó nada a una base real.

## Verificación local

- `apps/api/test/store.test.mjs`: **11/11 PASS**, incluida autorización, valor predeterminado 3, efecto observable en catálogo, validación y auditoría.
- PostgreSQL 17 en contenedor desechable, eliminado al terminar.
- `pnpm --filter @2j/api typecheck`: PASS.
- `pnpm build --force`: se ejecutó; confirmar el resumen final de salida antes de publicar.
- La pestaña Tienda permite consultar y guardar el umbral real; Admin Web muestra estados de carga, error y falta de permiso.
