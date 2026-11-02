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
| **PLATFORM** | Web de entrenadores y administración (`admin-web`, `staff-app`, `training-port`) | repo `2j-hub` (copiada de `2j-platform`) |
| **Plataforma API** | Identidad, sesiones de socio, cuotas, reservas, economía, tienda, comunicación | repo `2j-hub` (`apps/api`) |
| **Búnker** | App de entrenamiento: fuerza, rutinas, historial. Conserva sus datos en ficheros JSON | repo `2jfitnessapp` (ver §5) |
| `2j-platform` | Monorepo original. **Se queda intacto** como referencia | GitHub `2jfitnesscenter/2j-platform` |
| `2j-fitness-admin` | Administración en Base44. **Descartado** | — |

## 3. Decisiones tomadas (no reabrir sin motivo)

| # | Decisión | Origen |
|---|---|---|
| D1 | Partir de `2j-platform` (copia), no empezar de cero | Usuario |
| D2 | La plataforma es la fuente de verdad de la **persona** (`personId`) | Usuario |
| D3 | Búnker conserva su cuenta (`uid`), sus datos y sus ficheros JSON; no se migran en este hito | Usuario |
| D4 | Home y Búnker bajo **un mismo dominio con proxy** (`/` y `/bunker/`), una sola sesión | Usuario |
| D5 | Sin passkey ni login adicional al entrar a Búnker desde Home | Usuario |
| D6 | Login del socio con **Google**. Passkeys del socio fuera de este hito; se registran desde cero | Usuario |
| D7 | Los usuarios de prueba se re-registran; sus datos se copian más adelante | Usuario |
| D8 | **Enlace automático por correo** entre persona y cuenta de Búnker, con condiciones (correo verificado, coincidencia exacta, uno a uno) | Usuario (riesgo aceptado) |
| D9 | Búnker guardará correo verificado; los perfiles se sincronizan | Usuario |
| D10 | Los cambios de Búnker van en **su propia rama** de `2jfitnessapp`, nunca en `main`, para que los usuarios de prueba no se vean afectados | Usuario |
| D11 | Despliegue en servidor propio con Docker Compose | Usuario |
| D12 | Chat social y ajustes de Búnker pasan a Home en un hito posterior (decisión pendiente) | Conversación |

## 4. Repos y ramas

| Repo | Rama | Estado |
|---|---|---|
| `2jfitnesscenter/2j-hub` (GitHub, privado) | `main` | Copia de `2j-platform` en su estado de partida |
| `2j-hub` | `agent/claude/m1-cimientos` | Trabajo del hito 1 (Tareas 2–5 hechas) |
| `2j-hub` | `agent/claude/hub-bunker-unified-spec` | Spec y plan (subidos) |
| `2jfitnessapp` (local, sin subir) | `agent/claude/m1-bunker-home-session` | Trabajo de Búnker (Tareas 6–7 hechas, 8 en curso) |
| `2jfitnessapp` | `main` | **Intacto**: lo que usan los usuarios de prueba |
| `2j-platform` (local) | `agent/claude/hub-bunker-unified-spec` | Documentos de diseño |

## 5. Dónde están los documentos

- **Spec (diseño):** `docs/superpowers/specs/2026-11-02-hub-bunker-unified-design.md`
- **Plan del hito 1:** `docs/superpowers/plans/2026-11-02-hub-bunker-m1-cimientos.md`
- **Ledger de ejecución:** `.superpowers/sdd/2026-11-02-hub-bunker-m1-cimientos/progress.md` (en `2j-platform`, git-ignored)
- **Informes por tarea:** `.superpowers/sdd/2026-11-02-hub-bunker-m1-cimientos/task-N-report.md`

## 6. Hito 1 — Cimientos

**Objetivo:** un socio entra con Google en Home, abre Búnker en el mismo origen sin login ni passkey adicional, y la cuota decide qué puede usar (modos `legacy`, `shadow`, `enforced`).

### 6.1 Hecho

| Tarea | Qué | Commits | Estado |
|---|---|---|---|
| 1 | Repo base `2j-hub` creado y subido | — | ✅ (manual) |
| 2 | Proxy de dos orígenes (nginx) | `05a4fbf`, `383f576` | ✅ tras 1 ronda de corrección |
| 4 | Sesión única de socio (`member-session.ts`) | `627112b` | ✅ |
| 3 | Login de socio con Google | `8cdd00e`, `f1138ff`, `2e818c4` | ✅ tras 2 rondas de corrección |
| 5 | Endpoint interno de verificación de sesión | `811c3ce`, `6e5427f` | ✅ tras 1 ronda (solo acepta a Búnker) |
| 6 | Búnker resuelve la sesión de Home antes del despachador | `602f940` (en `2jfitnessapp`) | ✅ |
| 7 | Nivel de sesión `home` en Búnker | `06d48b7`, `aa1b4e9` (en `2jfitnessapp`) | ✅ tras 1 ronda |

### 6.2 En curso

| Tarea | Qué | Estado |
|---|---|---|
| 8 | Política de rutas `homeAllowed` y tratamiento de rutas previas al inicio de sesión | Subagente trabajando |

### 6.3 Pendiente del plan original

| Tarea | Qué |
|---|---|
| 9 | Gate con modos (`legacy`/`shadow`/`enforced`) para sesión `home` (en `2jfitnessapp`) |
| 10 | Home abre Búnker en el mismo origen (`/bunker/`), sin SSO ni pestaña nueva (en `2j-hub`) |
| 11 | Retirar el código de prueba fuera de desarrollo |
| 12 | Estado de enlace pendiente en Home |
| 13 | E2E de una sola app (Google simulado → Home → Búnker → registro) |
| 14 | Regresión completa, revisión final y PR |

### 6.4 Tareas añadidas por decisión del usuario (no estaban en el plan)

| Tarea | Qué | Por qué |
|---|---|---|
| **6b** | En Búnker: guardar correo y `emailVerified` (por defecto `false`; pasa a `true` cuando Plataforma confirma el correo vía Google). Consulta interna por correo, firmada, solo para Plataforma. En alta y perfil. | D8 y D9: el enlace automático necesita el correo en Búnker |
| **3b** | En Plataforma: adaptador `BunkerAccountLookup` contra la consulta de 6b; migración que amplía el `CHECK` de `training_account_links` para `method = 'email_match'`; escritor del enlace | Mismo motivo |

Orden: **6b antes que 3b**.

## 7. Reglas y criterios que siguen vigentes

- **Mínimo privilegio:** el endpoint de sesión de Home solo acepta la firma de Búnker.
- **Sesión `home` nunca da admin ni entrenador**, aunque la cuenta esté en `ADMIN_UIDS`.
- **Cookie `2j_member`:** `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`. Vida de 8 horas.
- **Caché de capacidades** en Búnker: como máximo 60 s.
- **CSRF:** las mutaciones de socio exigen `Origin` (o `Referer`) igual a `MEMBER_APP_ORIGIN`; sin cabecera se rechaza (cierre por defecto).
- **Rutas previas al inicio de sesión** (login, registro, recuperación, vinculación, quiosco): una sesión `home` se trata como anónima, para que el login con passkey en Búnker no quede bloqueado.
- **Pilot de desarrollo:** el código de prueba (`2j_member_pilot`) se mantiene solo para desarrollo y no cambia de comportamiento.
- **Ninguna tarea se implementa en `main`.** Ni de `2j-hub` ni de `2jfitnessapp`.
- **Sin credenciales en el repo ni en logs.**

## 8. Pendientes diferidos (anotados, a resolver antes de producción)

| Qué | Dónde se resuelve |
|---|---|
| Docker de `apps/api` no existe; el servicio `api` supone `dist` ya compilado | Tarea 14 |
| `MEMBER_APP_ORIGIN` sin configurar con Google activo rechaza todas las mutaciones sin aviso | Tarea 14 (documentar o avisar al arrancar) |
| Test de firma y cabeceras del verificador de Home (M2) | Revisión final |
| Log de 401 que no sean `session_invalid` (M4) | Revisión final |
| Test de timeout del resolvedor (M1) | Revisión final |
| Negative cache en fallo de Plataforma (M3, opcional) | Opcional |
| `location = /api/internal` exacto debe devolver 404 (menor del proxy) | Revisión final |
| Cookie del piloto sin `Secure` sobre HTTP (comportamiento anterior) | Fuera de este hito |
| `test/client-app.test.mjs` falla en la base (pass 0, fail 1) | Tarea 10 |
| `security-ops.test.js`: 2 tests fallan en la base de Búnker | Investigar aparte (no es de este hito) |
| Persistir enlace por correo requiere migración del `CHECK` | Tarea 3b |

## 9. Decisiones abiertas (pendientes de ti)

1. **Chat social, amigos y ajustes de Búnker:** cuándo y cómo pasan a Home (hito 5).
2. **Lista definitiva de rutas sensibles de Búnker** (exportar, borrar cuenta): confirmación dentro de la app, sin passkey.
3. **Nombre y dominio definitivos** del producto (ahora `2j-hub`, renombrable).
4. **Credenciales de Google OAuth** para el dominio nuevo (configuración del despliegue).
5. **Qué hacer con `2j-platform`** tras la copia: hoy se queda intacto.

## 10. Siguiente paso

1. Terminar la **Tarea 8** y revisarla (incluye el ruling de rutas previas al inicio de sesión).
2. **Tarea 9** en `2jfitnessapp`.
3. **Tarea 6b** en `2jfitnessapp`, después **3b** en `2j-hub`.
4. **Tareas 10, 11 y 12** en `2j-hub`.
5. **Tarea 13** (E2E) y **Tarea 14** (regresión, revisión final, PR, y los pendientes de §8).

## 11. Reglas de trabajo con subagentes

- Un implementador a la vez por repo. Cada tarea: implementación → revisión independiente → correcciones acotadas → re-revisión acotada → cerrada.
- Los modelos: `sonnet` para implementar y revisar.
- Cada ruling se anota en el ledger con su costo si está mal.
- Nada se sube a GitHub ni se fusiona sin tu aprobación.
