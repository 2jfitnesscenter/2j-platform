# Handoff 2J-HOME-BOOKING-PARITY

## Estado

- Rama: `agent/codex/2J-HOME-BOOKING-PARITY`
- Base local: `e8931e239671df0f273e0f9d4c5655b1667bd1f7`
- Base Platform integrada: `f87818afe474176c6e6ae77cb4d62a7e73fc1adf`
- Commit de implementación: `e60c399` (`feat(client-app): align booking shortcuts with decisions`).
- PR remoto: no creado. `AGENTS.md` prohíbe llamadas a proveedores/uso de credenciales; la rama queda preparada para que el operador autorizado cree el Draft PR por el flujo permitido.
- Sin despliegue, migraciones, Búnker ni cambios de Platform API.

## Decisiones abordadas

- D191: «Mis reservas» está disponible desde Perfil; no se añade una pestaña a la navegación de cinco secciones.
- D192: la tarjeta de Próxima reserva incluye acceso a Mis reservas y acción Cancelar.
- D188: Cancelar reutiliza primero `GET /api/me/bookings/:id/cancellation-preview`; el resumen de recuperación/pérdida mostrado al cliente procede de Platform y la mutación sigue siendo server-side.
- D193: Inicio oculta la tarjeta cuando no hay próxima reserva. El acceso a Mis reservas permanece en Perfil.

## Cambios

- En Inicio, la tarjeta de próxima reserva se renderiza solo si hay una reserva futura confirmada.
- La acción Cancelar deshabilita el modo sintético y cuentas fuera del cohort habilitado; cuando está activa reutiliza la vista previa y confirmación existentes.
- Perfil incluye acceso a próximas reservas, lista de espera e historial.
- Se conserva la navegación inferior de cinco secciones.
- La prueba existente de flujo real de reserva/cancelación ahora recorre la cancelación desde Inicio y verifica el acceso desde Perfil.

## Verificación local

- `pnpm --filter @2j/client-app test`: 15/15.
- `pnpm --filter @2j/client-app typecheck`: correcto.
- `pnpm --filter @2j/client-app build`: correcto.
- Lint: no ejecutado; `apps/client-app/package.json` no define script `lint`.
- No se ejecutaron migraciones ni se usaron datos reales.

## No incluido / siguiente

- D185: simplificar tarjetas a hora + estado y mover ocupación únicamente al detalle.
- D194–D198: acción de espera directamente en tarjeta, confirmación breve, organización en dos pestañas y estados de espera; revisar D199–D214 y su promoción automática según el contrato vigente.
- D187: confirmar éxito con aviso breve y cierre de detalle después de que Platform confirme.
- Perfil de medidas/salud (D01–D36, D47), capacidades V2.1, SSO y push dependen de contratos y consumidores que no se implementan aquí.
- No calcular derechos en Home. D31 define el acceso Home sin cuota; D40/A23 rigen el baseline autónomo de Búnker y la conservación de usuarios actuales. La política aún requiere que el consumidor verifique capacidades del lado de Búnker.

## Revisión

- Revisión independiente: pendiente.
- QA independiente: pendiente.
- Autorización de publicación/merge: no solicitada ni ejecutada.
