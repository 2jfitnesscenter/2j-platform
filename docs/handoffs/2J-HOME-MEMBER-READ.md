# Handoff — Home member read contracts

## Estado

Implementación API en PR #110, rama `codex/2J-HOME-READ-IMPLEMENTATION-PR`, basada en `main`. El contrato documental sigue separado en el PR #107. No incluye cambios de interfaz en Home ni reglas de venta/reserva.

## Contratos añadidos

- `GET /api/me/membership` conserva los campos actuales y añade `payment` por asignación solo si tiene un cargo coherente con cliente y plan. La respuesta deriva el estado económico de `economic_charges` y `economic_transactions`, y el acceso contractual mediante `evaluateTermPaymentAccess`. En vencimiento, un parcial con saldo pasa a `unpaid`; `partially_paid` solo aplica antes de vencer. Incluye importe, neto pagado, pendiente, fecha de vencimiento e instante efectivo como medianoche Canary con offset real (`+01:00` verano, `+00:00` invierno). No expone `chargeId`; si el cargo no es aplicable/coherente, `payment` es `null`.
- `GET /api/me/sessions` conserva la lista y añade `availability` por sesión utilizando el resolvedor de reservas ya usado por Platform. El detalle `GET /api/me/sessions/:sessionId` expone el mismo objeto `availability`; no serializa `eligibilityReason` interno. Distingue plaza disponible/completa, reserva, derecho no permitido, lista de espera y espera suspendida por elegibilidad actual. La espera suspendida es una lectura derivada; no cambia ni crea un estado en base de datos.
- No se devuelve posición, orden, ID de entrada ni identidad de otros miembros. El ID de espera propio se usa solo internamente para excluirlo del chequeo de duplicado y se elimina antes de serializar.
- Todas las lecturas siguen ligadas al cliente de la sesión Member y usan `Cache-Control: no-store`. No hay migraciones.

## Validación local

- Suite API completa sobre PostgreSQL sintético nuevo: **315/315 PASS**.
- Prueba focalizada nueva `Member read contracts expose authoritative payment state and per-session waitlist eligibility without queue data`: **7/7 PASS**.
- `pnpm typecheck`: **11/11 tareas PASS**.
- `pnpm build --force`: **9/9 PASS**.
- `pnpm audit --audit-level high`: sin vulnerabilidades altas/críticas; 10 avisos conocidos (6 bajas, 4 moderadas).
- `git diff --check`: PASS. Sin migraciones.

CI del PR de implementación se comprobará sobre su SHA publicado. El contrato padre #107 tiene quality, secret scan y E2E PASS en su último SHA documental.

## Límites

El listado acepta hasta 31 días y devuelve como máximo 300 sesiones. Para no agotar el pool de diez conexiones con una sola lectura Member, evalúa un máximo de dos sesiones en paralelo por petición. El resultado es una instantánea y las operaciones de reserva/lista de espera vuelven a validar bajo transacción. Un límite/rate limit distribuido por identidad queda para infraestructura de borde si la observabilidad del piloto lo requiere. Home debe presentar los campos sin recomputar deuda, elegibilidad, vencimientos ni posición de cola.

## Correcciones de re-review independiente

- El detalle usa el mismo `availability` y vocabulario seguro que el listado; el booleano histórico `eligible` se conserva solo por compatibilidad.
- Se inyecta reloj en las rutas de lectura Member para pruebas deterministas; por defecto sigue usando `new Date()` real.
- Cobertura del endpoint: transición exacta día 10→11, parcial vencido, pagado, pendiente/provisional, exento, void/unavailable, cargo incoherente y offset de verano/invierno.
- Las referencias de pago incompatibles se serializan como `payment: null`. `unpaid` incluye parciales vencidos; el contrato ya no enumera `not_applicable`.
- El historial `payments[]` conserva pagos confirmados originales incluso si se devolvieron; `paidCents` y estado usan neto tras devolución.
- El PR documental #107 quedó alineado en `91fcd72`.
- PostgreSQL sintético desechable: prueba focalizada 8/8; suite API completa 316/316; suite monorepo 632/632; typecheck 11/11; build 9/9; migraciones checksummed 45/45; `git diff --check` PASS. La última comprobación de concurrencia del listado se volvió a ejecutar en la prueba focalizada.
