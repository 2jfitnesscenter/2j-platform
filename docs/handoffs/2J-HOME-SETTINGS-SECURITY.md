# 2J-HOME-SETTINGS-SECURITY

## Estado

- Rama local: `agent/codex/2J-HOME-SETTINGS-SECURITY`.
- Base apilada: `8df32e0c97fc0308f6b8ab5ffffc940f887e314a` (DOCUMENTS-CONSENTS sobre NEWS-NOTICES/STORE-HISTORY, PR #78).
- Cambio: prueba de regresión que comprueba ajustes disponibles sin cuota, preferencias persistidas/reintentables y límites honestos de seguridad. No se añadieron endpoints.

## Real, simulado y pendiente

- **Real en Home:** apariencia Automático/Claro/Oscuro se lee y guarda en `GET/PATCH /api/me/preferences`. El buzón abre el centro de notificaciones de Home. Push usa la integración de la base rebased sobre PR #71, con comprobación de compatibilidad, consentimiento y suscripción por dispositivo.
- **D31:** Ajustes se conserva sin cuota; el tema y los ajustes de cuenta/privacidad continúan accesibles.
- **Seguridad visible, sin completar:** perfil y estado se leen de `/api/me`; la interfaz identifica la sesión actual. Cierre de sesión solo aparece con el login de piloto habilitado. Recuperación, cambio de contraseña y passkeys se identifican como no disponibles; no se simula ninguna operación.
- **Simulado:** en la demo, configuración/estados de push se desactivan o representan localmente, sin suscribir al navegador ni contactar al API.
- **Pendiente de autenticación central:** recuperación, gestión/revocación de sesiones, dispositivos de confianza y métodos de acceso deben llegar mediante contratos aprobados. No se activa autenticación productiva en esta rama.

## Pruebas

- Cliente: 25/25, incluida la regresión actualizada de preferencias y seguridad.
- API `client-app.test.mjs`: 8/8 en PostgreSQL local efímero, retirado tras la ejecución.
- Typecheck y build de `@2j/client-app`: correctos.
- Las pruebas de UI usan respuestas sintéticas; las pruebas API verifican la sesión y persistencia en base de pruebas local. No se probó autenticación contra staging ni producción.

## Dependencia Búnker

Cuando se retome el acceso a Búnker, Home debe usar `trainingCapabilities` de `GET /api/me/membership` según la indicación del propietario (comentario en PR #73). No derivar capacidades desde el frontend ni sustituirlo por `modules[].capabilities`.

## Siguiente

Esperar el contrato de mediciones de Work Platform. Cuando se implementen/ajusten capacidades de Búnker, partir de esta línea rebased y consumir `trainingCapabilities`. Revisar D185 cuando Platform añada elegibilidad al listado de sesiones.
