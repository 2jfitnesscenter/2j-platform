# Handoff — Login de personal 2J Platform

## Estado

Implementación en la rama aislada y PR Draft #125, basada en `origin/main` (`5e1d6b26079228aa13c5f32e37cd75199e7c1a7b`). El PR sigue abierto y sin fusionar.

Diseño aprobado por Juanjo el 26-10-2026. El cambio añade login separado para Admin Web y Staff App mediante passkeys WebAuthn con verificación de usuario obligatoria. La bandera `PLATFORM_STAFF_AUTH_ENABLED` permanece apagada por defecto y el servidor rechaza habilitarla fuera de `development`/`test`.

## Identidad y permisos

- La persona se resuelve en servidor desde una credencial passkey y su sujeto opaco Platform; no se busca ni empareja por correo o teléfono.
- El personal debe tener una faceta activa y un vínculo consistente con su sujeto. El rol se lee del registro activo de personal; no lo elige el navegador.
- El propietario se reconoce únicamente por el `PLATFORM_OWNER_PERSON_ID` configurado en servidor. Su contexto usa el rol interno `owner`, sin permisos heredados; solo recibe `owner.panel.read` explícitamente. No se expone como perfil asignable al personal y su identidad puede carecer de faceta de personal.
- La identidad `owner` no hereda el comodín de `admin`: la prueba API confirma que no puede leer `/api/staff/capabilities`, y la matriz de permisos niega `identity.people.manage`, `staff.read`, `settings.manage` y `billing.cash.manage`.
- El alta requiere un actor previamente autorizado con `identity.people.manage`, una persona Platform conocida y una credencial de enrolamiento de un solo uso. El enrolamiento no es autorregistro.
- Las sesiones usan tokens aleatorios, solo su hash se persiste, cookie host-only `HttpOnly; SameSite=Lax`, vencimiento de 8 horas y revocación al invalidar passkeys.
- Revocar las passkeys invalida en la misma transacción las sesiones y los enrolamientos pendientes de Platform Staff; cada enrolamiento invalidado deja auditoría `passkey.enrollment_revoked`. El endpoint de opciones rechaza después el token pendiente con `401 enrollment_invalid`.

## Datos y migración

La migración `0054_staff_passkey_sessions.sql` crea desafíos, enrolamientos, sesiones y auditoría append-only separados del flujo Member. La numeración deja `0053` disponible para el PR A45/#124 pendiente; confirmar el orden final de migraciones al integrar ambas ramas. No se han aplicado migraciones a ninguna base real.

## UI y desarrollo local

Admin Web y Staff App muestran el login si el servidor devuelve 401. Todas las llamadas API de Admin usan `apiFetch`, que envía la cookie host-only incluso si el API usa otro puerto. En desarrollo, ambas aplicaciones deben abrirse mediante `localhost` (no la IP literal) para que WebAuthn admita el contexto; Admin Web usa `http://localhost:3100` salvo que se defina `VITE_API_URL`, y Staff App conserva su proxy `/api`. El servidor valida tanto el origen configurado de Admin (`CORS_ORIGIN`) como `STAFF_APP_ORIGIN`, y exige que ambos coincidan exactamente con el RP ID. Los enlaces de cierre de sesión eliminan la cookie mediante endpoint protegido por comprobación de origen.

## Seguridad y límites

- Habilitación solo en desarrollo/test y origen/RP ID exactos de loopback; no es autenticación lista para producción. Si Admin y Staff se publican bajo hosts distintos, un único RP ID no comparte las passkeys; habrá que definir y revisar el modelo de credenciales por host antes de producción.
- El limitador actual es local al proceso y por IP; para producción hará falta un control compartido/operativo, monitorización y aceptación de seguridad.
- El bootstrap inicial del propietario requiere configurar un `personId` verificado por un proceso operativo aprobado. No se incorpora recuperación automática ni identificación por contacto.
- Antes de producción siguen pendientes: proveedor/flujo de identidad aprobado, recuperación y alta de passkeys adicional, política de MFA/passkeys, límites distribuidos y abuso, retención/limpieza, proxy HTTPS/cookies, revocación operativa, aceptación de seguridad y despliegue controlado.
- No hay cambios en Home, Búnker/Training, DNS, infraestructura de producción ni secretos.

## Verificación previa al re-review de los P1

- Regresión de enrolamiento/revocación y propietario en `platform-passkeys.test.mjs`: **9/9** en PostgreSQL sintético; incluye rechazo del token pendiente, persistencia de invalidación y auditoría, rol `owner` y denegación de capacidades staff.
- Suite API completa: **367/367**, sin fallos ni pruebas omitidas.
- `pnpm --filter @2j/permissions test`: **11/11**.
- `pnpm typecheck`: PASS (Turbo 11/11).
- `pnpm build --force`: PASS (9/9 tareas).
- Las pruebas API verificaron las migraciones en una base PostgreSQL desechable; no se tocó ninguna base real.
- `git diff --check`: PASS.
- No se repitió la suite completa de todos los paquetes ni la auditoría de dependencias en este delta acotado.
- CI del SHA actualizado y re-review independiente de Work Búnker: **pendientes**.
- Build de Admin mantiene avisos no bloqueantes existentes de tamaño de bundle y directivas `use client` de `lucide-react`.
- Pendiente antes de merge: CI verde en el nuevo SHA y re-review independiente PASS de Work Búnker sobre los dos P1. PR #125 sigue sin fusionar. No desplegar ni ejecutar migraciones en bases reales.
