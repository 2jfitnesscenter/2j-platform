# DEMO APP CLIENTE — PLAN SEMANAL

## Preparación

1. Usa una base local desechable `2j_demo` y ejecuta manualmente `NODE_ENV=development pnpm seed:demo` después de aplicar migraciones. El seed existente es sintético y no se ejecuta automáticamente.
2. Crea desde Admin Web un plan recurrente con servicio activo y `period_quota` semanal en `Atlantic/Canary`; asigna un cliente de demo y configura el motor 2J-074 con límite tres.
3. Arranca la API solo en loopback y con `LOCAL_DEMO_CLIENT_ID` de ese cliente. Arranca `apps/client-app` con `pnpm --filter @2j/client-app dev`.

## Recorrido

1. Inicio muestra la próxima reserva y el plan activo.
2. En Reservar, elige un día y abre una sesión elegible.
3. Reserva y comprueba que Mis reservas la muestra como confirmada.
4. Repite en dos sesiones distintas de la misma semana; el motor devuelve el límite y la App muestra el mensaje que llega de elegibilidad. El cliente nunca calcula ni consume por su cuenta.

La suite PostgreSQL prueba la lógica semanal central en `apps/api/test/calendar.test.mjs`; el test self-service comprueba que la mutación llega a ese mismo motor.
