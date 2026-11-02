# Plataforma 2J unificada — estado del proyecto

Documento vivo. Se actualiza en cada tarea cerrada. Si la conversación pierde el hilo, empezar por aquí.

Última actualización: 2026-11-02.

---

## 1. La idea en una frase

Una sola aplicación para el socio del centro deportivo: entra con Google, ve sus reservas, cuotas, tienda, noticias y chat, y desde ahí abre **Búnker** (su registro de entrenamiento) sin volver a iniciar sesión. El personal (entrenadores, recepción, administración) usa **PLATFORM** con la misma identidad de persona.

## 2. Piezas

| Pieza | Qué es | Dónde vive |
|---|---|---|
| **Home** | Web del socio (`client-app` de `2j-platform` ampliada): Inicio, Búnker, Tienda, Perfil, Ajustes | repo `2j-hub` |
| **PLATFORM** | Web de entrenadores y administración (`admin-web`, `staff-app`, `training-port`) | repo `2j-hub` |
| **Plataforma API** | Identidad, sesiones de socio, cuotas, reservas, economía, tienda, comunicación | repo `2j-hub` (`apps/api`) |
| **Búnker** | App de entrenamiento: fuerza, rutinas, historial. Datos en ficheros JSON | repo `2jfitnessapp` (rama propia, §4) |
| `2j-platform` | Monorepo original. **Se queda intacto** como referencia | GitHub `2jfitnesscenter/2j-platform` |
| `2j-fitness-admin` | Administración en Base44. **Descartado** | — |

## 3. Decisiones tomadas

| # | Decisión | Origen |
|---|---|---|
| D1 | Partir de `2j-platform` (copia), no empezar de cero | Usuario |
| D2 | La plataforma es la fuente de verdad de la **persona** (`personId`) | Usuario |
| D3 | Búnker conserva su cuenta (`uid`), sus datos y sus ficheros JSON; no se migran en este hito | Usuario |
| D4 | Home y Búnker bajo **un mismo dominio con proxy** (`/` y `/bunker/`), una sola sesión | Usuario |
| D5 | Sin passkey ni login adicional al entrar a Búnker desde Home | Usuario |
| D6 | Login del socio con **Google**. Passkeys del socio fuera de este hito; se registran desde cero | Usuario |
| D7 | Los usuarios de prueba se re-registran; sus datos se copian más adelante | Usuario |
| D8 | **Enlace automático por correo** (opción A): Plataforma busca la cuenta de Búnker por el correo guardado; si hay una única, la marca verificada y enlaza. **Riesgo aceptado:** alguien que registre en Búnker el correo de otra persona puede quedar enlazado a ella cuando esa persona entre con Google | Usuario (riesgo aceptado) |
| D9 | Búnker guarda el correo y su marca de verificado; Plataforma marca el correo verificado al entrar con Google y envía el enlace a Búnker (`platformLink`) | Usuario |
| D10 | Los cambios de Búnker van en **su propia rama** de `2jfitnessapp`, nunca en `main`, para que los usuarios de prueba no se vean afectados | Usuario |
| D11 | Despliegue en servidor propio con Docker Compose | Usuario |
| D12 | Chat social y ajustes de Búnker pasan a Home en un hito posterior (pendiente) | Conversación |
| D13 | Red interna del compose: `http` entre servicios permitido solo con bandera explícita (`PLATFORM_ALLOW_INTERNAL_HTTP`, `BUNKER_ALLOW_INTERNAL_HTTP`); el acceso público sigue en https | Usuario |
| D14 | Cambiar el correo en Búnker exige passkey (sesión fuerte) | Revisión final (riesgo de secuestro de cuenta) |
| D15 | El correo se pide al registrarse y en el perfil de Búnker | Usuario |

## 4. Repos y ramas

| Repo | Rama | Estado |
|---|---|---|
| `2jfitnesscenter/2j-hub` (GitHub, privado) | `main` | Copia de `2j-platform` en su estado de partida |
| `2j-hub` | `agent/claude/m1-cimientos` | **Implementación del hito 1 completa** (base `b00f2b4` + correcciones H1–H6, head `e93f2a5`). Subida a GitHub hasta la base de correcciones; las últimas correcciones no están empujadas |
| `2j-hub` | `agent/claude/hub-bunker-unified-spec` | Spec, plan y este documento (subidos) |
| `2jfitnessapp` (local, sin subir) | `agent/claude/m1-bunker-home-session` | **Implementación de Búnker completa** (incluye correcciones C1–C4 y pantalla de correo). Sin subir a GitHub |
| `2jfitnessapp` | `main` | **Intacto**: lo que usan los usuarios de prueba |
| `2j-platform` (local) | `agent/claude/hub-bunker-unified-spec` | Documentos de diseño |

## 5. Dónde están los documentos

- **Spec (diseño):** `docs/superpowers/specs/2026-11-02-hub-bunker-unified-design.md`
- **Plan del hito 1:** `docs/superpowers/plans/2026-11-02-hub-bunker-m1-cimientos.md`
- **Ledger de ejecución:** `.superpowers/sdd/2026-11-02-hub-bunker-m1-cimientos/progress.md` (git-ignored)
- **Informes por tarea:** `.superpowers/sdd/2026-11-02-hub-bunker-m1-cimientos/task-N-report.md`
- **Correcciones:** `bunker-fixes-report.md` (Búnker C1–C4), `hub-fixes-report.md` (plataforma H1–H6)

## 6. Hito 1 — Cimientos

**Objetivo:** un socio entra con Google en Home, abre Búnker en el mismo origen sin login ni passkey adicional, y la cuota decide qué puede usar.

### 6.1 Implementado

| Bloque | Tareas | Estado |
|---|---|---|
| Proxy de dos orígenes | 2 | ✅ |
| Login de socio con Google y sesión única | 3, 4 | ✅ |
| Endpoint interno de verificación de sesión | 5 | ✅ |
| Búnker: resolver de sesión Home, nivel `home`, política de rutas, modos | 6, 7, 8, 9 | ✅ |
| Correo verificado en Búnker y búsqueda interna | 6b, 6c | ✅ |
| Enlace automático por correo en Plataforma (migración 0073) | 3b | ✅ |
| Home abre Búnker en `/bunker/` (misma ventana) | 10 | ✅ |
| Retirar código de prueba fuera de desarrollo | 11 | ✅ |
| Estado de enlace pendiente en Home | 12 | ✅ |
| Búnker bajo `/bunker/` (base configurable) | 13b | ✅ |
| Botón "Entrar con Google" en Home | 13c | ✅ |
| Backend de Búnker como servicio propio en el compose | 13d | ✅ |
| Correcciones de revisión final (Búnker C1–C4, plataforma H1–H6) | — | ✅ aprobadas |

### 6.2 Verificado y no verificado

- **Verificado por lectura y pruebas unitarias/integración en cada tarea:** todo lo anterior.
- **Verificado el 2026-11-02 en local (PostgreSQL 17 en Docker):**
  - Platform `apps/api`: `tsc --noEmit` limpio; suite 520/521. El único fallo, `reservation evaluation share-lock serializes with payment writer`, **también falla en la base ac023c4** (es previo, no lo introduce el hito);
  - Búnker `api`: 1003/1005. Los 2 fallos son los conocidos de `security-ops.test.js`;
  - Búnker `frontend`: build con `VITE_BASE=/bunker/` correcto; `security-ui.test.jsx` 14/14 tras añadir la etiqueta de `platform_email_sync` (commit `0f81afe` en `2jfitnessapp`);
  - Home `client-app`: `tsc` limpio, build correcto, tests 55/55;
  - e2e `home-bunker-single-app.spec.ts` en local: **2/2 pasan** (Google falso → Home → `/bunker/` sin login → registro de fuerza → vuelta a Home; y caso pendiente). Hubo que corregir el helper (el estado de Búnker va cifrado) y admitir Google Fonts, que es la única host externa declarada por Búnker (commit `af2f683` en `2j-hub`).
- **NO verificado:**
  - `docker compose up` **arranca** desde el commit `9f4f8ea` (`2j-hub`): postgres, api (con migraciones: 71 verificadas), bunker-api, bunker-web, home y proxy. Comprobado con `curl` en HTTPS local: `/` 200, `/bunker/` 200, `/bunker/api/me` 401 sin sesión, `/bunker` 301, `/api/internal/*` 404, `/api/member/google/start` 302 a Google. **No** se ha recorrido el flujo de login completo contra el stack (el e2e corre sobre su propio stack de loopback). Dockerfile de API y de Home añadidos; el `Dockerfile.demo` queda solo para la demo;
  - `nginx -t` del proxy;
  - CI de los PR (`2j-hub#1`): `quality` falla por el share-lock previo (también en `main`); `secret scan` falla por 7 `generic-api-key` en fixtures de tests, incluidos commits de historia (también en `main`); los dos jobs e2e fallan porque falta el secreto `BUNKER_REPO_READ_TOKEN` y el workflow toma Búnker de `main` por defecto. CI de `2jfitnessapp#82`: `test` falla por `security-ui` (ya corregido en `0f81afe`, pendiente de re-ejecutar CI); `api` y `api-image` pasan.

### 6.3 Pendiente antes de producción

Ver §8.

## 7. Reglas que siguen vigentes

- **Mínimo privilegio:** el endpoint de sesión de Home solo acepta la firma de Búnker; las llamadas internas solo las firma `platform`, `bunker` o `home` según la ruta.
- **Sesión `home` nunca da admin ni entrenador**, aunque la cuenta esté en `ADMIN_UIDS`.
- **Rutas de identidad, passkey y personal cerradas a sesión Home** (least privilege). Las acciones de perfil de Búnker piden sesión de Búnker.
- **Cookie `2j_member`:** `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`. Vida de 8 horas.
- **Caché de capacidades** y de sesión en Búnker: como máximo 60 s.
- **CSRF:** las mutaciones de socio exigen `Origin` (o `Referer`) igual a `MEMBER_APP_ORIGIN`; sin cabecera se rechaza (cierre por defecto). Las llamadas internas firmadas (`/api/internal/`) quedan fuera de la exención de personal; no son alcanzables desde navegador.
- **Rutas previas al inicio de sesión** (login, registro, recuperación, vinculación, quiosco) tratan una sesión `home` como anónima.
- **Código de prueba del piloto:** `PILOT_MEMBER_AUTH_ENABLED` apagado por defecto; el servidor no arranca con él fuera de dev/test.
- **Ninguna tarea se implementa en `main`.** Ni de `2j-hub` ni de `2jfitnessapp`.
- **Sin credenciales en el repo ni en logs.** Los secretos se configuran en `.env`.

## 8. Pendientes antes de producción

| Qué | Dónde | Bloquea |
|---|---|---|
| Ejecutar el e2e en CI y que quede verde (es la puerta de la fusión) | CI `single-app` | Fusionar |
| Ejecutar `docker compose config`, build y `nginx -t` reales | máquina con Docker | Producción |
| Docker de `apps/api` (hoy el servicio supone `dist` ya compilado) | `2j-hub` | Producción |
| Cerrar sesión de Google en Home (H1) | ya hecho | — |
| Mensaje y auditoría cuando el login con Google se cancela o falla (F7) | `2j-hub` | Producción |
| Retorno a la ruta original tras sesión caducada (F7) | `2j-hub` | Producción |
| Rechazar `email_match` en `activate()` (latente, F10) | `2j-hub` | Producción |
| Negative cache de capacidades cuando Plataforma cae (M3) | Búnker | Producción (opcional) |
| Log de 401 que no sean `session_invalid` (M4) | Búnker | Producción |
| Test de firma y cabeceras del verificador de Home (M2) | Búnker | Fusionar Búnker |
| `PLATFORM_TRUSTED_PROXIES` en compose (IP real del cliente) | `2j-hub` | Seguimiento |
| Trailing slash en `MEMBER_APP_ORIGIN` (fallo cerrado, no inseguro) | `2j-hub` | Seguimiento (menor) |
| Compose exige todas las variables aunque se arranque solo `postgres` | `2j-hub` | Seguimiento (usabilidad) |
| Decidir si sync con `personId` puede reactivar un enlace revocado sin nueva prueba | Plataforma | Producción |
| Error `security-ui` por etiqueta de `platform_email_sync` | Búnker | Seguimiento (una línea) |
| `security-ops.test.js` (2 fallos en base de Búnker) y `bodyweight.test.js` (`%20`) | Búnker | Investigar aparte |
| Enlace de Google dentro de la app nativa (Capacitor) | Home | Decisión pendiente |
| Búnker: ajustes opcionales (`ADMIN_UIDS`, `INVITE_ONLY`, VAPID, `SECRET_FILE`) no cableados en el compose | `2j-hub` | Producción |
| Cookies de Búnker detrás de `/bunker/` (examinar en navegador) | Búnker | Producción |

## 9. Decisiones abiertas (pendientes de ti)

1. **Permiso para empujar** la rama `agent/claude/m1-bunker-home-session` de `2jfitnessapp` a GitHub, y para **abrir los PRs**. Son acciones externas; no las he hecho.
2. **Chat social, amigos y ajustes de Búnker**: cuándo y cómo pasan a Home (hito 5).
3. **Lista definitiva de rutas sensibles de Búnker** (exportar, borrar cuenta): confirmación dentro de la app, sin passkey.
4. **Nombre y dominio definitivos** del producto (ahora `2j-hub`, renombrable).
5. **Credenciales de Google OAuth** para el dominio nuevo, y las claves internas (`PLATFORM_API_KEY_*`, `BUNKER_PLATFORM_*`) que hay que generar y poner en `.env` en ambos lados.
6. **Qué hacer con `2j-platform`** tras la copia: hoy se queda intacto.
7. **Acciones de perfil de Búnker** (avatar, nombre, cerrar sesión) para usuarios que solo tienen sesión Home: hoy requieren sesión de Búnker.

## 10. Siguiente paso

1. Dar permiso para empujar y abrir los PRs (decisión 9.1).
2. Ejecutar el e2e y el compose en una máquina con Docker, y corregir lo que aparezca.
3. Atender los pendientes de §8 que bloquean producción.
