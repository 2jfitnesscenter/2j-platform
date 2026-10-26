# 2J-HOME — Estado de pago visible en Perfil

## Estado

- Rama local: `agent/codex/2J-HOME-PAYMENT-STATE`
- Base: `main` en `5e1d6b26079228aa13c5f32e37cd75199e7c1a7b`.
- Dependencia satisfecha: PR #110 fusionado con merge commit `e90a649f15b87c2350dc27a35f2b00bb9f10f047`.
- PR de elegibilidad de lista de espera: #116 ya está publicado como Draft, abierto y apilado sobre el head de #110. No se creó un duplicado.

## Implementación

- `apps/client-app/src/client-app.tsx`: añade el tipo opcional `Assignment.payment` y presenta estado de pago, acceso, importe pendiente, vencimiento y bloqueo efectivo en «Tus cuotas».
- Home solo formatea los valores recibidos de `GET /api/me/membership`; no calcula saldos, fechas límite, bloqueo ni derechos y no escribe datos.
- Los estados distinguen pendiente, parcial, impagado, pagado, anulado, exento y reembolsado; acceso activo, provisional, bloqueado, programado, pausado, finalizado o no disponible.
- `apps/client-app/src/styles.css`: tarjetas compactas compatibles con el tema grafito/lima y contraste de bloqueo para tema oscuro y claro.
- `apps/client-app/test/client-app.test.mjs`: cubre importe/vencimiento/bloqueo de Canarias y estado recibido de Platform.

## Contrato usado

`GET /api/me/membership` devuelve `assignments[].payment` con `status`, `accessStatus`, `amountCents`, `paidCents`, `pendingAmountCents`, `dueOn`, `effectiveBlockAt`, `timezone` y `payments`. La autoridad de estos valores es Platform (#110). Un `payment` ausente o `null` no se interpreta ni se sustituye por un estado calculado en Home.

## Verificación

- `pnpm --filter @2j/client-app test`: 46/46.
- `pnpm --filter @2j/client-app typecheck`: correcto.
- `pnpm --filter @2j/client-app build`: correcto.
- `git diff --check`: correcto.
- Verificado con respuestas sintéticas en pruebas; no se probó una sesión autenticada contra staging.

## Límites y siguientes pasos

- Este cambio está solo en la rama local y aún no tiene commit publicado ni PR.
- Mantener como Draft al publicarlo; no fusionar ni desplegar sin autorización.
- Los puntos 3–8 del gap check siguen aplazados hasta que el propietario pruebe staging.
- Mediciones siguen bloqueadas a la espera del contrato de Platform.
- No se cambió la identidad, la API, las reglas de negocio, pagos ni reservas.
