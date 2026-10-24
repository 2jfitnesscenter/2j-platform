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
