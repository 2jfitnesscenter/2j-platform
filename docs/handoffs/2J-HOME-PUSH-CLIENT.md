# 2J-HOME-PUSH-CLIENT — Integración cliente Web Push

## Estado verificado

- Repositorio: `2jfitnesscenter/2j-platform`.
- Rama local: `agent/codex/2J-HOME-PUSH-CLIENT`.
- Base: `9c634bd68721d49762493e00cae6fd7ad0bf960c` (incluye D185–D198 y D31).
- Commit de implementación: `a9d8c935f3d591f70f973c8805b670b084e0f0d8`.
- PR: ninguno; según `AGENTS.md`, la rama queda local para que Claude Code la publique como Draft.
- Worktree limpio al cerrar.

## Contrato de Claude revisado

La referencia disponible localmente es `origin/agent/claude/2J-PUSH-INFRA`, SHA `fc3b3ae51f3e03f7df977a10690ef8b6b940a27f`. Home usa las rutas de miembro con sesión del navegador:

- `GET /api/me/push/config`
- `PUT /api/me/push/consent` con `{ granted }`
- `POST /api/me/push/subscriptions` con endpoint, claves y agente de usuario
- `DELETE /api/me/push/subscriptions` con endpoint

El usuario/cliente se obtiene de la sesión del servidor; Home no envía un identificador de persona. Esta rama copia solo el código cliente de esa referencia. No incluye ni modifica sus rutas API, migración `0044`, dependencias de servidor, configuración VAPID o dispatcher. No se consultó GitHub ni un servicio externo para comprobar el número o estado del PR indicado.

## Cambios

- Ajustes incorpora controles de notificación push, estado del navegador y del centro, alta mediante acción explícita, reintento y revocación de consentimiento.
- La alta pide primero permiso al centro y después al navegador, registra la suscripción del dispositivo y usa `credentials: include`.
- La retirada general aclara que apaga todos los dispositivos. Al cerrar sesión, Home elimina la suscripción de este navegador con `DELETE` sin revocar los demás dispositivos; si el servidor tiene push apagado y rechaza la ruta con `423`, se elimina la suscripción local.
- El service worker importa los manejadores push. Los clics solo navegan a destinos del mismo origen. La caché existente continúa excluyendo `/api/*`.
- La demo sintética y las cuentas no autenticadas no consultan ni modifican push.

## Verificación

- `pnpm --filter @2j/client-app test`: 25/25.
- `pnpm --filter @2j/client-app typecheck`: correcto.
- `pnpm --filter @2j/client-app build`: correcto.
- `git diff --check`: correcto.
- Artefacto confirmado: `dist/service-worker.js` importa `/push-sw-handlers.js`; el archivo se copia a `dist/push-sw-handlers.js`.
- Los tests simulan APIs y navegador. No se contactó un servicio Web Push ni se probó un teléfono físico.
- No hay script `lint` configurado para client-app.

## Dependencias y límites

- El endpoint de servidor referido sigue en una rama remota de Claude, fuera de la base de esta rama. La UI solo recibirá estado real cuando ese trabajo esté integrado y `PUSH_ENABLED` se habilite en un entorno autorizado con VAPID configurado.
- No se generaron ni usaron claves VAPID, no se aplicó migración y no se habilitó envío.
- iPhone requiere iOS compatible y que Home se haya instalado en la pantalla de inicio. No hay verificación física de Safari, Chrome Android o entrega real.
- Al cerrar sesión, si una eliminación autenticada falla por un error distinto de `push_disabled`, Home mantiene la sesión abierta para evitar dejar asociada una suscripción activa. Si el flag está apagado, el endpoint deniega la eliminación remota y Home desuscribe localmente; el registro remoto puede permanecer hasta que backend lo invalide.

## Seguridad / alcance

- Solo se modificaron archivos de `apps/client-app` y este handoff.
- Sin cambios al API Platform, endpoint o contrato de capacidades, base de datos, Búnker, DNS, infraestructura, producción, ni rama `agent/codex/2J-CAPABILITIES-D40-D41`.
- No push, merge, publicación o despliegue.
- Revisión independiente y QA: pendientes.

## Siguiente orden

1. Claude publica/integrará el Draft del servidor y confirma las rutas VAPID habilitadas en staging.
2. Revisión independiente de esta rama cliente y validación de navegador/PWA real cuando exista un staging autorizado.
3. Después, mediciones del cliente contra contratos Platform confirmados.
