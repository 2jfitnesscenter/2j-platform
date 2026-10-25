# Handoff — Home member read contracts

## Estado

Implementación API en rama `codex/2J-HOME-READ-IMPLEMENTATION`, apilada sobre el PR documental #107 (`codex/2J-HOME-READ-CONTRACT`). No incluye cambios de interfaz en Home ni reglas de venta/reserva.

## Contratos añadidos

- `GET /api/me/membership` conserva los campos actuales y añade `payment` por asignación cuando tiene un cargo propio coherente. La respuesta deriva el estado económico de `economic_charges` y `economic_transactions`, y el acceso contractual mediante `evaluateTermPaymentAccess`. Incluye importe, neto pagado, pendiente, fecha de vencimiento, instante efectivo calculado con `Atlantic/Canary` y abonos confirmados. No expone `chargeId`.
- `GET /api/me/sessions` conserva la lista y añade `availability` por sesión utilizando el resolvedor de reservas ya usado por Platform. Distingue plaza disponible/completa, reserva, derecho no permitido, lista de espera y espera suspendida por elegibilidad actual. La espera suspendida es una lectura derivada; no cambia ni crea un estado en base de datos.
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

La lista evalúa elegibilidad en el servidor por sesión en lotes acotados; el resultado es una instantánea y las operaciones de reserva/lista de espera vuelven a validar bajo transacción. Home debe presentar los campos sin recomputar deuda, elegibilidad, vencimientos ni posición de cola.
