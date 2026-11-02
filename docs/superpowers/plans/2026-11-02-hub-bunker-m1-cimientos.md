# Cimientos (hito 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un socio entra con Google en Home, abre Búnker en el mismo origen sin login ni passkey adicional, y la comprobación de cuota decide qué puede usar, con los modos `legacy`, `shadow` y `enforced` por socio.

**Architecture:** Proxy único (`/` para Home y PLATFORM, `/bunker/` para Búnker). Plataforma emite una sesión de socio (`platform_member_sessions`, cookie `2j_member`) y Búnker la valida en cada petición llamando a un endpoint interno firmado. Búnker resuelve esa sesión antes de su despachador, con un nuevo nivel de autenticación `home`, y aplica el mismo gate de capacidades que ya usa.

**Tech Stack:** Node.js 22, Fastify, Postgres (`postgres` client), Zod, Vitest/`node --test` (según paquete), React + Vite (`client-app`), nginx (proxy), Docker Compose, Playwright (e2e existente).

**Spec:** [docs/superpowers/specs/2026-11-02-hub-bunker-unified-design.md](../specs/2026-11-02-hub-bunker-unified-design.md)

## Global Constraints

- Session TTL de socio: 8 horas (`SESSION_TTL_MS` de `member-pilot-auth.ts`), sin cambio.
- Cookie de socio: `2j_member`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.
- Caché de capacidades en Búnker: como máximo `MAX_CAPABILITY_CACHE_MS = 60_000` ms.
- Contrato de capacidades: `2J-CAPABILITIES-V2`, sin cambios.
- `RP_ID` de passkeys de personal: sin cambios.
- Google se configura solo por variables de entorno. Ningún secreto en el repo.
- Ninguna tarea se implementa en `main`. Rama: `agent/<agente>/<task-id>-<slug>`.
- Ninguna tarea añade credenciales, claves de proveedor ni logs con secretos.

## Review Focus

1. **Cuenta de Google sin persona asociada:** debe rechazarse con `no_member_account`, nunca crear una persona nueva. Prueba en Task 3.
2. **Sesión cerrada en Home que sigue viva en Búnker:** Búnker debe rechazarla en menos de `MAX_CAPABILITY_CACHE_MS`. Prueba en Task 7.
3. **Plataforma caída durante una sesión activa:** en `enforced` se deniega con `platform_unavailable`; en `legacy` se deja pasar como hoy. Prueba en Task 9.
4. **Sesión de Home pidiendo rutas de personal o rutas con passkey:** debe responder `passkey_required` o `forbidden`, nunca dar privilegios de admin o entrenador. Prueba en Task 8.
5. **Cookie `2j_member` reenviada a rutas fuera de `/bunker/`:** el proxy debe devolver 404 para cualquier ruta no declarada. Prueba en Task 2.

## Decisiones tomadas en este plan

- **Proxy:** nginx, en `deploy/proxy/nginx.conf`, añadido al `docker-compose.yml` raíz. Motivo: es lo más simple para dos orígenes bajo un dominio.
- **Enlace automático:** el espec dice que el enlace se crea al primer login con Google si ya existe cuenta de Búnker. Este plan **no** crea enlaces automáticamente: el enlace se crea solo con el flujo de vinculación existente (`training-link-flow.ts`) o por personal. Crear el enlace por coincidencia de correo sería inseguro. **Pendiente de confirmar con el usuario.**
- **Passkey al vincular:** el flujo de vinculación sigue pidiendo passkey dentro de Búnker. Solo se elimina la passkey al entrar desde Home.
- **Nivel de sesión en Búnker:** nuevo valor `home`, distinto de `sso`, para no cambiar el comportamiento del flujo SSO antiguo mientras dura la transición.

---

### Task 1: Repo base y rama de trabajo

**Requires your permission:** crear el repo nuevo en GitHub y copiar `2j-platform`. No se hace sin tu aprobación.

**Files:**
- Create: repo nuevo, copia de `2j-platform` en su estado `main`.
- Modify: ninguno en `2j-platform`.

**Interfaces:**
- Consumes: nada.
- Produces: rama base `agent/claude/m1-cimientos` a partir de `main` del repo nuevo.

- [ ] **Step 1: Confirmar permiso y nombre del repo nuevo.** Esperar respuesta explícita.
- [ ] **Step 2: Crear el repo y copiar el historial de `2j-platform`.** Verificar con `git log --oneline -1` que el commit de partida coincide con el de `main` de origen.
- [ ] **Step 3: Crear la rama.** `git checkout -b agent/claude/m1-cimientos`
- [ ] **Step 4: Verificar que la baseline pasa.** Run: `pnpm install && pnpm test`. Expected: todas las suites en verde antes de tocar nada.

---

### Task 2: Proxy de dos orígenes

**Files:**
- Create: `deploy/proxy/nginx.conf`
- Create: `deploy/proxy/test/nginx-routes.test.mjs`
- Modify: `docker-compose.yml` (servicio `proxy`)

**Interfaces:**
- Consumes: nada.
- Produces: `/` → Home/PLATFORM; `/bunker/` → Búnker; resto → 404.

- [ ] **Step 1: Escribir la prueba que falla.**

```js
// deploy/proxy/test/nginx-routes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const conf = readFileSync(new URL('../nginx.conf', import.meta.url), 'utf8');

test('declares only the two public prefixes and a default 404', () => {
  assert.match(conf, /location \/bunker\//);
  assert.match(conf, /location \/ \{/);
  assert.match(conf, /return 404;/);
});

test('does not expose the Platform internal API', () => {
  assert.doesNotMatch(conf, /\/api\/internal/);
});
```

- [ ] **Step 2: Ejecutar y ver que falla.** Run: `node --test deploy/proxy/test/nginx-routes.test.mjs`. Expected: FAIL, `nginx.conf` no existe.
- [ ] **Step 3: Escribir `deploy/proxy/nginx.conf`.** Un `server` en el puerto 443 con `location /bunker/` que hace `proxy_pass` al servicio `bunker-web`, `location /` que hace `proxy_pass` al servicio `home`, y un `location` por defecto que devuelve `return 404;`. Cabeceras `X-Forwarded-Proto` y `Cookie` pasan sin modificar.
- [ ] **Step 4: Ejecutar y ver que pasa.** Run: `node --test deploy/proxy/test/nginx-routes.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(proxy): dos orígenes bajo un dominio"`

---

### Task 3: Login de socio con Google

**Files:**
- Create: `apps/api/src/member-google-auth.ts`
- Create: `apps/api/test/member-google-auth.test.mjs`
- Modify: `apps/api/src/server.ts` (registrar rutas)

**Interfaces:**
- Consumes: `platform_persons`, `platform_person_auth_subjects` (provider `google`), `createMemberSession` (Task 4).
- Produces:
  - `createMemberGoogleAuth(database: DB, options: { enabled: boolean; clientId: string | null; clientSecret: string | null; redirectUri: string | null; issuer: string }): { register(app: FastifyInstance): void }`
  - `GET /api/member/google/start` → redirige a Google con `state` y PKCE.
  - `GET /api/member/google/callback?code&state` → crea sesión y redirige a `/`.

Las credenciales vienen solo de variables de entorno: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MEMBER_GOOGLE_REDIRECT_URI`.

- [ ] **Step 1: Escribir la prueba que falla** (caso sin persona).

Usar los helpers de base de datos y de app que ya usan los tests vecinos en `apps/api/test/` (no existen todavía con estos nombres exactos; copiar el patrón de `member-pilot-auth` o `training-sso`).

```js
test('rejects a Google account with no active person', async () => {
  const db = await testDb();            // helper del paquete de tests
  const app = await buildApp(db, { googleSub: 'sub-unknown' }); // helper del paquete de tests
  const res = await app.inject({ method: 'GET', url: '/api/member/google/callback?code=ok&state=' + validState });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: 'no_member_account' });
  assert.equal(await countPersons(db), 0);
});
```

- [ ] **Step 2: Ejecutar y ver que falla.** Run: `pnpm --filter @2j/api test -- member-google-auth`. Expected: FAIL, módulo no existe.
- [ ] **Step 3: Implementar el callback.** Verificar `state` y `code_verifier` guardados en cookie `2j_member_oauth` (HttpOnly, 5 min). Intercambiar `code` con Google y validar `id_token` (issuer, audience, expiración). Buscar `platform_person_auth_subjects` con `provider='google'` y `auth_subject = sub`. Si no hay fila activa, responder 403 `no_member_account`.
- [ ] **Step 4: Ejecutar y ver que pasa.** Expected: PASS.
- [ ] **Step 5: Escribir la prueba de éxito** y verificar que crea sesión (Task 4) con persona existente.
- [ ] **Step 6: Commit.** `git commit -m "feat(identity): login de socio con Google"`

---

### Task 4: Sesión única de socio

**Files:**
- Create: `apps/api/src/member-session.ts`
- Create: `apps/api/test/member-session.test.mjs`
- Modify: `apps/api/src/member-pilot-auth.ts` (usa `createMemberSession`)

**Interfaces:**
- Produces:
  - `createMemberSession(db: DB, input: { personId: string; authSubjectLinkId: string }): Promise<{ raw: string; expiresAt: Date }>`
  - `setMemberCookie(reply, raw: string, expiresAt: Date): void`, con `2j_member`.
  - `revokeMemberSession(db: DB, raw: string): Promise<void>`

- [ ] **Step 1: Prueba que falla:** la cookie tiene `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`, y el hash guardado no coincide con el token crudo.
- [ ] **Step 2: Ejecutar y ver que falla.**
- [ ] **Step 3: Extraer la lógica de sesión de `member-pilot-auth.ts`** a `member-session.ts`, sin cambiar el comportamiento del piloto. El piloto sigue usando la misma tabla.
- [ ] **Step 4: Ejecutar `pnpm --filter @2j/api test -- member-pilot-auth member-session`.** Expected: PASS, incluidas las pruebas existentes del piloto.
- [ ] **Step 5: Commit.** `git commit -m "refactor(identity): sesión de socio compartida"`

---

### Task 5: Verificación interna de sesión

**Files:**
- Create: `apps/api/src/member-session-verify.ts`
- Create: `apps/api/test/member-session-verify.test.mjs`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `verifyInternalServiceRequest` (de `internal-service-auth.ts`), `createMemberSession`.
- Produces: `POST /api/internal/platform/v2/member-session/verify`, body `{ cookie: string }`, respuesta `{ personId: string; trainingUserId: string | null; expiresAt: string }` o 401 `{ error: 'session_invalid' }`.

- [ ] **Step 1: Prueba que falla:** petición sin firma → 401; sesión revocada → 401 `session_invalid`; sesión válida → 200 con `personId`.
- [ ] **Step 2: Ejecutar y ver que falla.**
- [ ] **Step 3: Implementar.** Validar la firma con `verifyInternalServiceRequest`. Buscar por hash, comprobar `revoked_at IS NULL` y `expires_at > now()`. Resolver `trainingUserId` desde `training_account_links` con `status='active'`.
- [ ] **Step 4: Ejecutar y ver que pasa.**
- [ ] **Step 5: Commit.** `git commit -m "feat(identity): verificación interna de sesión de socio"`

---

### Task 6: Búnker resuelve la sesión de Home antes del despachador

`readSession` en `2jfitnessapp/api/server.js` es síncrona. La verificación es asíncrona, así que se resuelve antes.

**Files:**
- Create: `2jfitnessapp/api/platform-sso/home-session.js`
- Create: `2jfitnessapp/api/test/home-session.test.js`
- Modify: `2jfitnessapp/api/server.js` (llamada antes del despachador)

**Interfaces:**
- Consumes: `signPlatformServiceRequest` (de `api/platform-proof/service-auth.js`), endpoint de Task 5.
- Produces:
  - `resolveHomeSession(cookieHeader: string | undefined, deps: { fetchImpl, now, cache }): Promise<{ uid: string | null; personId: string; expiresAt: number } | null>`
  - Cache por cookie de como máximo `60_000` ms (`MAX_CAPABILITY_CACHE_MS`).

- [ ] **Step 1: Prueba que falla:** sin cookie `2j_member` → `null` sin llamar a Plataforma; con cookie válida → objeto con `personId`; dos llamadas seguidas → una sola llamada a `fetch`; tras 60 001 ms → segunda llamada.
- [ ] **Step 2: Ejecutar `node --test api/test/home-session.test.js`.** Expected: FAIL.
- [ ] **Step 3: Implementar** `resolveHomeSession`. Cookie ausente → `null`. Error de red → `null` y se registra en el log de `platform-sso`, sin secretos.
- [ ] **Step 4: Ejecutar y ver que pasa.**
- [ ] **Step 5: Commit.** `git commit -m "feat(platform-sso): resolver sesión de Home"`

---

### Task 7: Nivel de sesión `home` en Búnker

**Files:**
- Modify: `2jfitnessapp/api/server.js` (`readSession`, despachador)
- Create: `2jfitnessapp/api/test/home-session-level.test.js`

**Interfaces:**
- Consumes: `resolveHomeSession` (Task 6).
- Produces: sesión con `authLevel: 'home'`, `admin: false`, `trainer: false`, `uid`.

- [ ] **Step 1: Prueba que falla:** una petición con solo cookie `2j_member` recibe `authLevel: 'home'` y `admin: false`, aunque el `uid` esté en `ADMIN_UIDS`.
- [ ] **Step 2: Ejecutar y ver que falla.**
- [ ] **Step 3: Implementar.** Si no hay `gymsid` y sí `2j_member`, usar el resultado de Task 6 y construir la sesión `home`. Si no hay resultado válido, seguir como sesión anónima.
- [ ] **Step 4: Ejecutar y ver que pasa.**
- [ ] **Step 5: Commit.** `git commit -m "feat(platform-sso): nivel de sesión home"`

---

### Task 8: Política de rutas para `home`

**Files:**
- Modify: `2jfitnessapp/api/platform-sso/route-policy.js`
- Create: `2jfitnessapp/api/test/home-route-policy.test.js`

**Interfaces:**
- Consumes: `classifyRoute(key)` existente (línea 152).
- Produces: `classifyRoute` devuelve `{ kind, ssoAllowed, homeAllowed }`. `homeAllowed` es `true` para rutas `member` y `gated` que no sean de personal ni de passkey-only.

- [ ] **Step 1: Prueba que falla:** `homeAllowed` es `false` para cualquier ruta de personal y para cualquier ruta marcada como passkey-only; `true` para una ruta `member` de lectura.
- [ ] **Step 2: Ejecutar y ver que falla.**
- [ ] **Step 3: Añadir `homeAllowed`** en la tabla existente de `route-policy.js`. Mantener `ssoAllowed` sin cambios.
- [ ] **Step 4: Ejecutar `node --test api/test/`.** Expected: PASS, incluida la prueba existente que exige que toda ruta esté clasificada.
- [ ] **Step 5: Commit.** `git commit -m "feat(platform-sso): política de rutas para sesión home"`

---

### Task 9: Gate con modos para `home`

**Files:**
- Modify: `2jfitnessapp/api/platform-sso/index.js` (función `gate`)
- Create: `2jfitnessapp/api/test/home-gate-modes.test.js`

**Interfaces:**
- Consumes: `classifyRoute` (Task 8), `userMode`, `createCapabilitiesService`.
- Produces: `gate` aplica `homeAllowed` cuando `authLevel === 'home'`; por lo demás, la misma lógica que hoy.

- [ ] **Step 1: Pruebas que fallan:**
  - `legacy` con sesión home: pasa todo lo que pasa hoy.
  - `shadow` con sesión home: pasa y registra diferencia.
  - `enforced` con sesión home y cuota inactiva: deniega con `capability_denied`.
  - `enforced` con Plataforma caída: deniega con `platform_unavailable`.
  - `legacy` con Plataforma caída: pasa.
- [ ] **Step 2: Ejecutar y ver que falla.**
- [ ] **Step 3: Implementar** el cambio mínimo en `gate`: sustituir el chequeo `isSso && !policy.ssoAllowed` por `policy.homeAllowed` cuando `authLevel === 'home'`.
- [ ] **Step 4: Ejecutar y ver que pasa.**
- [ ] **Step 5: Commit.** `git commit -m "feat(platform-sso): gate con modos para sesión home"`

---

### Task 10: Home abre Búnker en el mismo origen

**Files:**
- Modify: `apps/client-app/src/client-app.tsx` (función `openTrainingWithSso`, mensaje de la línea 736)
- Modify: `apps/client-app/test/client-app.test.mjs`

**Interfaces:**
- Consumes: ruta `/bunker/` del proxy (Task 2).
- Produces: el botón Búnker navega a `/bunker/` en la misma pestaña. Ya no llama a `/sso/start` ni abre pestaña nueva.

- [ ] **Step 1: Prueba que falla:** el botón Búnker produce `location.assign('/bunker/')`; el texto no menciona "passkey".
- [ ] **Step 2: Ejecutar `pnpm --filter @2j/client-app test`.** Expected: FAIL.
- [ ] **Step 3: Cambiar `openTrainingWithSso`** para que navegue a `/bunker/`. Mantener el flujo antiguo detrás de `trainingSsoEnabled` hasta que la transición termine.
- [ ] **Step 4: Ejecutar y ver que pasa.**
- [ ] **Step 5: Commit.** `git commit -m "feat(client-app): abrir Búnker en el mismo origen"`

---

### Task 11: Retirar el código de prueba fuera de desarrollo

**Files:**
- Modify: `apps/api/src/member-pilot-auth.ts` (flag `enabled`)
- Modify: `apps/api/.env.example`
- Create: `apps/api/test/member-pilot-disabled.test.mjs`

- [ ] **Step 1: Prueba que falla:** con `enabled: false` (producción), `POST /api/pilot/member/login` responde 404 `pilot_login_disabled`.
- [ ] **Step 2: Ejecutar y ver que falla o ya pasa** (si ya se comporta así, la prueba documenta el requisito).
- [ ] **Step 3: Documentar** en `.env.example` la variable que activa `createMemberPilotAuth` (confirmar su nombre exacto en `apps/api/src/server.ts` antes de escribirla) y que debe valer desactivado en producción.
- [ ] **Step 4: Ejecutar y ver que pasa.**
- [ ] **Step 5: Commit.** `git commit -m "chore(identity): código de prueba solo en desarrollo"`

---

### Task 12: Estado de enlace pendiente

**Files:**
- Modify: `apps/api/src/member-session-verify.ts` (campo `trainingUserId`)
- Modify: `apps/client-app/src/client-app.tsx` (mensaje "cuenta de entrenamiento pendiente")
- Create: `apps/client-app/test/training-link-pending.test.mjs`

**Interfaces:**
- Consumes: respuesta de Task 5 con `trainingUserId: null`.

- [ ] **Step 1: Prueba que falla:** con `trainingUserId: null`, Home muestra "Cuenta de entrenamiento pendiente" y no navega a `/bunker/`.
- [ ] **Step 2: Ejecutar y ver que falla.**
- [ ] **Step 3: Implementar** el mensaje y la condición.
- [ ] **Step 4: Ejecutar y ver que pasa.**
- [ ] **Step 5: Commit.** `git commit -m "feat(client-app): estado de enlace pendiente"`

---

### Task 13: E2E de una sola app

**Files:**
- Modify: `.github/workflows/e2e-training.yml`
- Create: `tooling/e2e/home-bunker-single-app.spec.ts`
- Create: `tooling/e2e/fake-google-oidc/` (servidor OIDC local para CI, sin secretos reales)

**Interfaces:**
- Consumes: todas las tareas anteriores.

- [ ] **Step 1: Escribir el spec que falla:** login con Google simulado → Home → Búnker (`/bunker/`) → registrar una serie de fuerza → volver a Home. No se pide passkey en ningún paso.
- [ ] **Step 2: Ejecutar `npx playwright test tooling/e2e/home-bunker-single-app.spec.ts`.** Expected: FAIL antes de las tareas anteriores.
- [ ] **Step 3: Conectar el workflow** para levantar el proxy, Home, Búnker, Plataforma y el servidor OIDC simulado.
- [ ] **Step 4: Ejecutar y ver que pasa.**
- [ ] **Step 5: Commit.** `git commit -m "test(e2e): Home y Búnker en una sola app"`

---

### Task 14: Regresión y entrega

**Files:** ninguno nuevo.

- [ ] **Step 1: Ejecutar** `pnpm test` en `2j-platform` (copia) y `npm test` en `2jfitnessapp`. Expected: todo en verde.
- [ ] **Step 2: Comprobar las cinco Review Focus** contra las pruebas de cada tarea indicada.
- [ ] **Step 3: Abrir PR** desde `agent/claude/m1-cimientos` hacia `main`. Revisión independiente pendiente hasta que alguien la haga realmente.

---

## Pendiente de confirmar antes de ejecutar

1. Creación del repo nuevo en GitHub y su nombre (Task 1).
2. Enlace automático frente a enlace manual (decisión de este plan, ver arriba).
3. Credenciales de Google OAuth para el dominio nuevo (spec, pendiente 4).
