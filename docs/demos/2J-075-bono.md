# DEMO APP CLIENTE — BONO

## Preparación

En `2j_demo`, asigna explícitamente a un cliente sintético un `session_pack` activo con diez sesiones y servicio dirigido. Arranca API/app con ese `clientId` fijo únicamente en `NODE_ENV=development` y loopback.

## Recorrido

1. Inicio/Perfil muestra el plan y el saldo derivado del ledger central.
2. Abre una clase compatible y reserva usando el único derecho o seleccionando una alternativa si hay varias.
3. Confirma que la reserva aparece en Mis reservas y el saldo se actualiza desde la API.
4. Previsualiza y cancela dentro del plazo; el motor decide la restauración y el saldo leído vuelve a incluir la sesión.

Las transacciones de consumo/restauración pertenecen a 2J-074. Las pruebas PostgreSQL del motor son la fuente de verificación contable; la interfaz no aplica aritmética comercial.
