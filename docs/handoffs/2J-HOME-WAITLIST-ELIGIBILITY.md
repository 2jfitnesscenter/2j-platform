# 2J-HOME — WAITLIST ELIGIBILITY ON CLASS CARDS

## Estado

- Rama local: `agent/codex/2J-HOME-WAITLIST-ELIGIBILITY-110`
- Base apilada: PR #110, `codex/2J-HOME-READ-IMPLEMENTATION-PR` en `9eec82077d1adb215e6119e4910f22efd92e634a`.
- Alcance: presentación en Home de la elegibilidad para lista de espera, sin cambios de reglas ni APIs.

## Hallazgo de contrato

- PR #110 (abierto como Draft al preparar esta rama) añade a `GET /api/me/sessions` el objeto `availability: { status, reason, canJoinWaitlist }`, calculado por Platform; el detalle conserva el `canJoinWaitlist` de servidor.
- Home no deduce elegibilidad por aforo, cuota, servicio ni estado de reservas. La tarjeta solo ofrece «Lista de espera» si la respuesta incluye explícitamente `availability.canJoinWaitlist: true` (o el campo de detalle equivalente) y el cliente no está ya reservado ni esperando.
- Home se apila sobre el head exacto de #110 para que esta forma de contrato esté disponible al revisar ambos cambios juntos. Antes de integrar, verificar que el #110 siga siendo la base vigente y que la forma no haya cambiado.

## Cambios

- `apps/client-app/src/client-app.tsx`: la tarjeta exige elegibilidad explícita del servidor.
- `apps/client-app/test/client-app.test.mjs`: cubre tarjeta llena elegible y tarjeta llena no elegible.

No se han cambiado diseño, navegación, endpoint, contrato V2.1 ni lógica de negocio. No se ha añadido ninguna integración de pago.

## Verificación

- `pnpm --filter @2j/client-app test`: 45/45.
- `pnpm --filter @2j/client-app typecheck`: correcto.
- `pnpm --filter @2j/client-app build`: correcto.
- `git diff --check`: correcto.
- Los tests de UI usan respuestas simuladas con la forma de #110. No se ejecutó Platform ni se verificó una sesión real autenticada.
- No afirmar que este contrato está disponible en `main` hasta que #110 se fusione.

## Pendiente

1. Ejecutar pruebas, typecheck y build en esta rama sobre #110; validar las comprobaciones CI antes de pedir revisión.
2. No fusionar hasta que #110 esté integrado y el propietario apruebe el orden.
3. Tras la integración de #110, empezar el PR de presentación de pago usando solo `assignment.payment`: `status`, `accessStatus`, `pendingAmountCents`, `dueOn`, `effectiveBlockAt`, `timezone` y `payments`. No calcular importes, plazos ni bloqueo en Home.
4. Los puntos 3–8 del gap check esperan a que el propietario pruebe staging.
5. Mediciones y Mi evolución permanecen en espera del contrato de mediciones de Platform.

No se ha publicado, fusionado ni desplegado esta rama.
