# 2J-HOME — SESSION MEMBERSHIP TRAINING CAPABILITIES

## Estado

- Rama local: `agent/codex/2J-HOME-TRAINING-CAPABILITIES`
- Base: ``3d4c5129c020654d3617482b21e8f27f3e6ee656` (SETTINGS-SECURITY sobre DOCUMENTS-CONSENTS, NEWS-NOTICES y STORE-HISTORY).
- Contrato de referencia disponible localmente: PR #73, commit `d531caa920b728f7a77dfa023eec62c914500e1d`.
- Este cambio solo modifica Home. No modifica el endpoint, Platform, SSO ni Búnker.

## Implementación

Home lee `trainingCapabilities` de `GET /api/me/membership`, autenticado por la sesión del cliente. Al entrar en Búnker vuelve a consultar el endpoint. La interfaz presenta el nivel y únicamente las opciones activadas por Platform; no reconstruye derechos desde cuotas, módulos ni saldos. `expiresAt` limita la vida del dato en memoria; al vencer, Home lo descarta.

Home no llama a `/api/internal/platform/...` ni envía HMAC. La consulta de resumen de actividad existente (`GET /api/me/training-summary`) permanece separada y solo presenta actividad disponible. El enlace de Búnker y sus operaciones siguen sujetos a autorización del servidor Búnker; esta pantalla no implementa SSO ni concede acceso.

## Verificación

- `pnpm --filter @2j/client-app test`: 25/25.
- `pnpm --filter @2j/client-app typecheck`: correcto.
- `pnpm --filter @2j/client-app build`: correcto.
- La prueba de cliente simula la respuesta V2.1 y verifica el perfil baseline de un usuario sin vincular, sus funciones y la ausencia de llamadas al endpoint interno.
- No se ejecutó la API real con el commit de PR #73 ni se consultó GitHub; el endpoint de runtime depende de que ese cambio de Platform se integre en el entorno conectado.

## Estado funcional

- Real en Home: lectura tipada de la respuesta de membresía; renderizado de las capacidades recibidas; refresco al abrir Búnker; descarte al vencer el TTL.
- Simulado en pruebas: respuesta V2.1 de `GET /api/me/membership`.
- Pendiente: SSO, acceso operativo autenticado desde Home a Búnker, y verificación extremo a extremo contra una Platform que incluya PR #73. No se deben deducir ni mostrar derechos usando `modules[].capabilities`.
