# Plan de merge (aprobado como plan) y línea única de los commits visuales de Home

Actualizado: 2026-10-24. `main` de Platform = `7b58555` (incluye #75, zod 4). **Nada se fusiona sin el «sí» explícito del propietario en ese momento; cada paso se propone solo con su CI en verde, después de #75 y de un merge de `main` en su rama.** No se reescribe la historia de ninguna rama publicada: todo usa commits de *merge* o ramas nuevas.

## 0. Dos repositorios

| Repositorio | PRs |
|---|---|
| **`2jfitnesscenter/2j-platform`** (Platform) | todo lo de Platform **y también todo Home** (la app de Home vive en `apps/client-app` de este repo): #64–#67, #69–#74, #76–#78, **#82–#86 (pila de Home de Work Home)**, #80, #81, #88, #87, #51, #52 |
| **`2jfitnessapp`** (Búnker) | #56, #57, #58, #59, #61, #62 (#60 ya fusionado) |

Por tanto: **los PRs de Home (#74, #76–#78, #82–#86) están en `2j-platform`**, no en el repositorio de Búnker; su CI es el de Platform (`quality` + `secret scan`). Los despliegues son distintos: Home se construye junto a Platform (`apps/client-app`), Búnker es otro stack y otro repo.

## 1. Orden aprobado y estado (CI a 2026-10-24, tras fusionar `main` en cada rama)

### Platform / Home (repo `2j-platform`)
| Paso | PR | CI | Antes de proponerlo |
|---|---|---|---|
| 0 | **#75** zod 4 | fusionado | — |
| 1 | **#69** checksums/LF/prefijos únicos | verde | `main` ya incorporado |
| 2 | **#70** calendario (sustituye a #50, que se cierra como sustituido) | verde | `main` incorporado |
| 3 | **#88** reconocer un falso positivo de gitleaks | nuevo, borrador | **fusionarlo antes que nada de Home**: el `secret scan` de #76–#78, #81 y la pila de Home falla por un SHA citado en un handoff de la rama de #85 (`generic-api-key`, línea 6); no se reescribe esa rama, se reconoce en `.gitleaksignore`. Después, un merge de `main` en cada rama afectada |
| 4 | SSO **#64 → #65 → #66 → #67** (+ **#81** cola de revisión encima) | #64–#66 verdes; #67 y #81 con el typecheck roto por zod 4 → **corregido** (`z.record` con dos argumentos, commit `deec99c`; API 282/282) y propagado a #81; CI relanzándose | migraciones 0039–0043 (+0045 de #81) |
| 5 | **#71** push (migración 0044) | verde | choca con #67 en `apps/api/package.json`, `pnpm-lock.yaml`, `server.ts`, `.env.example`: el segundo en entrar resuelve (receta en §3) |
| 6 | **#73** capacidades V2.1 + `trainingCapabilities` en `/api/me/membership` | verde | Búnker #58 va después de #56/#57; Búnker antes que Platform en cualquier despliegue |
| 7 | **#80** D185 elegibilidad en el listado de sesiones (Work Platform) | 1 de 2 ejecuciones en rojo | **No proponerlo todavía**: revisión independiente con hallazgos (ver §4) por resolver; CI en verde con `pnpm audit` |
| 8 | **Pila de Home en orden: #74 → #76 → #77 → #78 → #82 → #83 → #84 → #85 → #86** | #74, #76–#78: `quality` verde (el `secret scan` se arregla con #88); #82–#86: pendientes tras el merge de `main` | todas ya contienen `main` (merge propagado por la pila, sin reescribir) |
| 9 | **#51 y #52** (Design V2) | verdes (antiguos) | **conflicto real al incorporar `main`**: `apps/admin-web/src/calendar-page.tsx` y `apps/admin-web/test/clients-page.test.mjs` (y `apps/api/package.json` en #52) por el solape con #70 (calendario). Lo resuelve Work Platform tras fusionar #70; #52 renumera `0033_store_product_media` |
| — | #87 renombrar D278/D279 → INT-V2-03/04 (docs) | borrador | independiente |

**#86 (capabilities de Training V2.1 en Home) está bloqueado hasta que #73 esté integrado en `main`** (Home lee `trainingCapabilities` de `/api/me/membership`, que añade #73).

### Búnker (repo `2jfitnessapp`)
| PR | Estado | Nota |
|---|---|---|
| #60 | fusionado | arregla la inestabilidad de tests de locales/corrupción (ya con `main` en las ramas) |
| **#56 → #57 → #58** | `main` fusionado en las tres ramas (merge commits) | #58 = consumidor V2.1 opt-in **+ corrección de la caché por (personId, trainingUserId)** (§5); API 912/912 |
| **#61** consumidor del Codex | **sustituido, no fusionar** | implementación canónica = la de #56/#58 (`platform-sso`); su idea de test de partición ya está portada |
| #59 Caddy/guardia/compose | **revisión independiente hecha** (§6); no autorizado | decisión y despliegue del propietario |
| #62 renombrar D276–D282 → INT-V2-01..07 | borrador | docs |

## 2. Una sola línea para los 5 commits visuales de Home

Línea canónica: **#65**. Los cinco parches son idénticos en las tres copias (`git patch-id`: `40a09fb06f`, `e389eb10a3`, `4e2eafccbc`, `259f09c7e2`, `3b341ed8e8`). Se fusiona SSO (#64→#67) primero; la pila de Home entra después con commits de merge (git trata los parches idénticos como el mismo cambio). Ramas redundantes (`agent/claude/2J-INT-HOME-REBASE`, `agent/codex/2J-HOME-VISUAL-UNIFICATION`, `agent/codex/2J-HOME-004-staging-readiness`): marcadas como sustituidas, no borradas.

## 3. Conflicto conocido #86 ↔ SSO y cómo se resolverá (a mi cargo, sin force-push)
- La rama `agent/claude/2J-INTEGRATION-PREVIEW` (no fusionable; **se mantiene como rama de comprobación**) ya demuestra la unión pila de Home (hasta #78) + SSO + push + `main`: único conflicto textual `apps/client-app/src/client-app.tsx` (tres bloques donde SSO añade código → se toma el lado SSO) más la unión de `package.json`/`.env.example` y regenerar el lockfile; las pruebas SSO de Home necesitan el formato `active: []` de `/api/me/membership`. Verificado: API 290/290, client-app 39/39.
- **#86 toca `client-app.tsx` y no estaba en esa comprobación**: cuando el SSO (#64–#67) esté en `main`, hago `merge main` en la rama de #86 (y propago por la pila), resuelvo el conflicto con la misma receta, ejecuto client-app y API completos y lo propongo solo con CI verde. Sin rebase ni force-push.

## 4. Revisión independiente de #80 (D185) — hallazgos (agente distinto del autor; solo lectura; no ejecutó los tests)
Sin hallazgos de severidad alta. A resolver por Work Platform **antes** de proponer el merge: (1) la lista dice «available» sin replicar los controles reales de documentos pendientes, deuda (`debtBlocksNewBooking`) y selección de cuota; (2) «waitlisted» no replica el criterio real de promoción (puede saltarse por deuda/documento); (3) «full» se evalúa antes que la elegibilidad (oculta la falta de derecho; asimetría con `ignoreDebt` en la espera); (4) razones ajenas al plan (sesión empezada, conflicto, duplicada) etiquetadas «not_allowed_by_plan»; (5) N+1 secuencial dentro de una transacción (hasta ~2000–3000 consultas); (6) `availabilityReason` expone códigos internos; D185 pide solo hora y disponibilidad; (10) faltan pruebas (cuota agotada, esperas suspendidas, sesión pasada/cancelada, consistencia lista-vs-acción). La documentación omite estos matices. **No lo he podido verificar con los tests (el revisor no instaló dependencias); CI remoto: 1 de 2 ejecuciones en rojo.**

## 5. #58: caché por (personId, trainingUserId)
Confirmado con 5 tests que fallaban (una segunda cuenta de Training de la misma persona heredaba la respuesta verificada de la primera, compartía la petición en vuelo y la memoria de rechazos). Corregido: clave `persona\nusuario`, cada acierto de caché revalida que responde al usuario que pregunta, `prime` solo para el par que nombra la respuesta, `forget(persona)` borra todas las particiones. API de Búnker 912/912.

## 6. Revisión independiente de Búnker #59 (solo lectura) — resumen
Sin acceso a producción. El guardia existente **falla cerrado** y compara por bytes; el rollback es independiente del destino. Hallazgos: **(alta)** nada comprueba que existan las redes externas `2j-home-staging-proxy` y `2j-pwa-demo-edge` antes de `up -d`; si faltan, el despliegue falla y el rollback falla igual (su compose también las declara) → el stack entero queda sin poder arrancar por una dependencia de Home/staging; **(media-alta)** Caddy no se recarga ni se valida (`caddy validate/reload`) al cambiar solo el Caddyfile: un fichero inválido tumba todos los dominios, y el guardia compara el disco, no lo cargado; **(media)** el rollback y la sonda de salud no cubren home./staging-home. ni assetlinks; la doc afirma un «manifiesto con hashes» que el PR no contiene; el guardia no detecta ficheros extra en `caddy-config/`; staging-home sin noindex/HSTS; **(baja)** `caddy:2-alpine` sin fijar. Tests del kit: 99/99 en una copia limpia. Lista de comprobaciones de solo lectura que debe hacer el propietario en el servidor: en el informe del revisor (comandos `sha256sum`, `docker network ls`, `docker compose config -q`, `caddy validate`, `curl -sI`…), pegada abajo en §8.

## 7. Backlog de endurecimiento (añadido por decisión del propietario)
1. **Activar auditd y un registro de despliegues en el servidor de producción** (quién despliega qué y cuándo; ficheros de configuración vigilados: Caddyfile, compose, `.env`, `data/`).
2. **Plan de retirada de las rutas de staging del Caddy de producción** (`staging-home.` y el bloque de demos) cuando exista el nuevo staging (Contabo, 2jfit.es): verificar que el nuevo staging funciona → quitar los bloques y las redes externas del compose de producción en un cambio revisado → comprobar con `caddy validate` y sondas.
3. Del informe de #59: pre-comprobación de redes y `compose config -q`, `caddy validate` + recarga controlada, sondas a home./staging-home./assetlinks, versión fija de Caddy, manifiesto real con los hashes, noindex/HSTS en staging.
4. Platform: autenticación de personal apta para servidor (hoy el rol de demostración solo existe en `NODE_ENV=development`); mientras tanto el staging expone el admin con contraseña + lista de IP (ver runbook de staging).
5. Zod 4: revisar los límites estrictos de `uuid`/`datetime` en esquemas sin test.

## 8. Comprobaciones de solo lectura para el propietario en producción (de la revisión de #59)
`cd /opt/2jfitness && sha256sum Caddyfile caddy-config/Caddyfile docker-compose.prod.yml; ls -la caddy-config` · comparar con `git show origin/fix/production-config-guard-reconciliation:caddy-config/Caddyfile | sha256sum` · `docker network ls | grep -E '2j-home-staging-proxy|2j-pwa-demo-edge'` · `docker compose -f docker-compose.yml -f docker-compose.prod.yml config -q` · `docker exec <caddy> caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` · `docker exec <caddy> sha256sum /etc/caddy/Caddyfile` · `curl -sI https://app.2jfitnesscenter.com/` (y home., staging-home.) · `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://app.2jfitnesscenter.com/api/platform/v1/link-proofs` (esperado 401/403, nunca 2xx) · `ls -la /root/backups | tail` · `stat -c '%U:%G %a %y' /opt/2jfitness/{.env,data,Caddyfile,caddy-config/Caddyfile,docker-compose.prod.yml}`.

## 9. Actualización (misma jornada, tras #88 y #91)
**Estado de CI:** con #88 (gitleaks) y #91 (undici 8.12.3, aviso high que rompía `pnpm audit` en `main` y en todos los PR) fusionados y `main` propagado por merge commit, las 14 ramas **#64, #65, #66, #67, #81, #74, #76, #77, #78, #82, #83, #84, #85, #86 quedan totalmente verdes** (`quality` con `pnpm audit` y `secret scan`). Siguen sin fusionarse: cada merge lo autoriza el propietario en ese momento, en el orden de §1.

**Nuevos PR del integrador (todos borrador, sin fusionar):** #89 staging 2jfit.es (script + runbook; tiene dos revisiones independientes, texto íntegro en `docs/review/`; **no se ejecuta nada en el servidor** hasta una tercera revisión limitada al último commit si el propietario la pide), #90 workflow E2E (apilado sobre #67; necesita el secreto `BUNKER_REPO_READ_TOKEN`), Búnker #63 H13 asistida (permiso `platform_link_issue` para el propietario y el gerente, desactivada por defecto).

**Vigilancia de solapes (tareas nuevas de los Works).** El integrador resuelve con commits de merge, sin force-push, y propone cada merge solo con CI verde:
| Fichero | Quién lo toca | Riesgo |
|---|---|---|
| `apps/api/package.json` (+ `pnpm-lock.yaml`) | login de personal y permisos (Platform), #80, `web-push`/zod/undici | conflictos de una línea JSON: unión de dependencias y lockfile regenerado (receta en `PROPUESTAS-…`/scripts de merge) |
| `apps/client-app/src/client-app.tsx` | pantallas de vínculo, modo demo y flags (Home) frente a SSO (#64–#67) y #86 | el conflicto conocido; receta en §3 |
| `apps/api/src/server.ts`, `.env.example`, migraciones | login de personal, perfiles de permisos, `reviewId` de H13 (Platform) | numeración de migraciones (test de prefijo único, #69) |
| `docker-compose`/Caddy de Búnker | #59 (red/validación), perfil de staging | #59 sigue sin autorización; ver §6 |

**Backlog posterior al lanzamiento (decisión del propietario):** hacer que `pnpm audit` bloquee solo por dependencias de **producción** y no por las de desarrollo/pruebas (hoy un aviso de `jsdom`→`undici`, que solo existe en pruebas, bloqueó 14 PR). Hasta entonces se sigue con el override de #91.

## 10. Home «cuenta de Búnker / Mi evolución» (`agent/codex/2J-HOME-IDENTITY-EVOLUTION`) — posición en la pila
**Repositorio: `2jfitnesscenter/2j-platform`** (es código de `apps/client-app`). Entregada por Work Home en local (commits `9eabe41`, `dc009fe`, `0ec7c6c`), **sin publicar ni PR**; su base fue la rama de comprobación `agent/claude/2J-INTEGRATION-PREVIEW` (`2602953`), que **no es fusionable**.

**Decisión de base (integrador):** va **al final de la pila de Home, encima de #86** (`agent/codex/2J-HOME-TRAINING-CAPABILITIES`), como PR borrador con base esa rama, y **solo con los tres commits propios** (8 ficheros: `client-app.tsx`, `member-integrations.ts` y su test, `styles.css`, `README`, test de `client-app` y el handoff), no con el contenido de la rama de comprobación. Motivos: (1) usa los endpoints de vinculación del SSO (#64→#67) y de la cola de revisión (#81), que en `main` entran **antes** que la pila de Home; (2) depende del mismo `client-app.tsx` que #86 y las pantallas de vínculo/demo, así que cuanto más abajo estuviera, más conflictos arrastraría la pila; (3) todo va detrás de banderas `VITE_*` apagadas por defecto, por lo que es el último paso, el de menor riesgo. Orden resultante: … #85 → #86 → **identity-evolution**.

**Cómo se publica sin reescribir nada publicado:** la rama de Work Home es local, así que puede rehacerse una vez, antes de publicar (no hay historia publicada que proteger): `cherry-pick` de los tres commits sobre #86 y resolución de `client-app.tsx`. Prueba hecha (cherry-pick de `9eabe41` sobre la cabeza de #86 `3384bd15`): **un solo fichero en conflicto, `apps/client-app/src/client-app.tsx`, 6 bloques**; sin conflicto en `package.json` (la rama no toca dependencias). Con el SSO ya en `main` y #86 al día, el segundo conflicto conocido (§3) se resuelve a la vez. Lo resuelve el integrador con commits de merge; si Work Home lo publica antes, el integrador hace el merge de `main` y de #86 encima, sin force-push.

**Vigilancia de solapes en `client-app.tsx`:** #86 (capacidades) ↔ identity-evolution (Perfil/Búnker/Mi evolución/gestión de vínculo) ↔ SSO (redención) ↔ banderas y modo demo de los Works. Cualquier PR de Home que toque `client-app.tsx` se propone **de uno en uno**, con `main` fusionado y CI verde.

**Requisitos antes de proponerla para fusionar:** CI verde con `main` al día; las banderas `VITE_2J_TRAINING_ACCOUNT_LINKING`, `VITE_2J_TRAINING_LINK_REVIEW` y `VITE_2J_SESSION_ELIGIBILITY` apagadas en el build por defecto; el flujo de vínculo **no es extremo a extremo** hasta que Búnker tenga la pantalla que inicia la prueba de passkey para `transactionId` (pendiente en Búnker); #80 sin fusionar no afecta (los campos `availability` son opcionales); revisión independiente y QA de dispositivo pendientes (Work Home los declara pendientes).

## 11. PR #92 (`2jfitnesscenter/2j-platform`) — último PR de la pila de Home
Work Home publicó `agent/codex/2J-HOME-IDENTITY-EVOLUTION` como **PR borrador #92, base `agent/codex/2J-HOME-TRAINING-CAPABILITIES` (#86)**, cabeza `9d243bc` (tres commits propios de Home: `6df07d1`, `f910a5c`, `9d243bc`), con los conflictos de `client-app.tsx` ya resueltos. Es lo previsto en §10 (encima de #86, solo los commits propios). Comprobado: la cabeza contiene `main` actual y la cabeza de #86; el diff frente a #86 son 8 ficheros (`client-app.tsx`, `member-integrations.ts` y su test, `styles.css`, README, test de `client-app`, handoff md/json), sin tocar dependencias ni API.

**Orden final de la pila de Home (repo `2j-platform`):** #74 → #76 → #77 → #78 → #82 → #83 → #84 → #85 → #86 → **#92**. #92 es el último; depende de #64–#67 (SSO) y #81 (cola de revisión) ya en `main`, y de #73 para #86.

**Regla de propuesta:** #92 **no se propone** hasta que #86 y todos los anteriores estén fusionados y verdes. Cuando le toque, el integrador fusiona `main` en su rama con un commit de merge (sin force-push), resuelve el solape en `client-app.tsx` si aparece, relanza el CI y solo entonces lo propone. Banderas `VITE_*` del flujo de vínculo apagadas por defecto; el flujo no es de punta a punta hasta que Búnker tenga la pantalla de la prueba de passkey.

## 12. Comprobación de la combinación SSO + pila de Home + #92 (repo `2j-platform`)
Hecha en un árbol de pruebas aparte (`worktrees/qa/combined-sso-home`, no publicado): cabeza de #92 (`9d243bc`) + cabeza de #67 (`origin/agent/claude/2J-INT-CLOSURE`), merge sin confirmar.
- **Dónde viven las pruebas de SSO:** `apps/client-app/test/training-sso.test.mjs` (**14** pruebas, lado Home) y `apps/api/test/training-sso.test.mjs` (15, lado API). Las «3 de #92» son `apps/client-app/test/member-integrations.test.mjs`.
- **Resultado combinado:** client-app **45/45** (incluye las 14 de SSO y las 3 de #92), API **290/290** con PostgreSQL desechable (44 migraciones verificadas), typecheck sin errores.
- **Conflictos al combinar:** `apps/client-app/src/client-app.tsx` (10 bloques), `styles.css`, `client-app.test.mjs`, `apps/api/.env.example`, `apps/api/package.json`, `pnpm-lock.yaml`. Receta: en `client-app.tsx` gana el lado Home (ya lleva el flujo SSO dentro de su `BunkerDestination`), salvo `resolveTrainingUrl` del lado SSO (con el `isHttpsOrLoopback` compartido) y manteniendo las tres constantes `HUB_*_BUILD` de Home; `styles.css` y `client-app.test.mjs` (`Hola, María`) lado Home; `.env.example` unión; `package.json` unión; lockfile regenerado.
- **Un ajuste de prueba necesario:** el stub de `training-sso.test.mjs` debe responder `/api/me/membership` con `{ assignments: [], active: [] }` (forma D31); con `{ assignments: [] }` 8 de las 14 fallaban porque la app mostraba el estado de error. Es el mismo ajuste de la rama de comprobación.
