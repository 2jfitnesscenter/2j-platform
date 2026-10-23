# Plan de merge (aprobado como plan) y línea única de los commits visuales de Home

Fecha de los datos: 2026-10-23, `main` de Platform = `c94830f`. **Nada se fusiona sin el «sí» explícito del propietario en ese momento; cada paso se propone solo con su CI en verde.** No se reescribe la historia de ninguna rama ya publicada: todo lo siguiente usa commits de *merge* o ramas nuevas.

## 1. Orden aprobado y estado

| Paso | PR | CI hoy | Antes de proponerlo / notas |
|---|---|---|---|
| 1 | **#75** zod 4 (nuevo, desbloquea el resto) | **verde** (4/4) | **Propongo este primero**: sin él, `pnpm audit --audit-level high` falla en cualquier PR que se vuelva a ejecutar (aviso GHSA-mrhx-c7xc-m3w5, publicado hoy). Sin migraciones |
| 2 | #69 checksums/LF/prefijos únicos | verde, **pero la ejecución es anterior al aviso de zod** | tras #75: fusionar `main` en la rama y volver a lanzar el CI |
| 3 | #70 calendario (Codex), sustituye a #50 (se cierra como sustituido) | verde (2/2) | mismo reejecutado tras #75; sin solapes con mis PRs (medido) |
| 4 | SSO #64 → #65 → #66 → #67 (+ #81 cola de revisión encima) | #64–#66 verdes (ejecuciones antiguas), #67 y #81 con rojos | antes de #64: fusionar `main` (con #68 y #75) en la rama de #64 y propagar por la pila con commits de merge (arregla los 3 tests de reloj y la auditoría). Migraciones 0039–0043 (+0045 de #81) |
| 5 | #71 push (migración 0044) | auditoría en rojo (zod) | tras #75 y un merge de `main`; choca con #67 en `apps/api/package.json`, `pnpm-lock.yaml`, `server.ts`, `.env.example` (el segundo en entrar rebasa/mergea) |
| 6 | #73 capacidades V2.1 + Búnker #58 | auditoría en rojo (zod) | tras #75; Búnker #58 va apilado sobre #56/#57 (Búnker antes que Platform en cualquier despliegue) |
| 7 | Pila Home #74 → #76 → #77 → #78 | rojos por reloj/zod | **ya actualizadas con `main`** (3634dc1…); tras #75, un merge más; ver §2 |
| 8 | #51 y #52 (Design V2) | verdes (antiguos) | #52 renumera `0033_store_product_media` (propuesta en el informe de #69); rebase/merge sobre `main` |

## 2. Una sola línea para los 5 commits visuales de Home

**Línea canónica: #65** (`agent/claude/2J-INT-HOME-CONNECTED`), la única revisada y con el SSO encima. Los cinco parches son idénticos en las tres copias (`git patch-id --stable`: `40a09fb06f`, `e389eb10a3`, `4e2eafccbc`, `259f09c7e2`, `3b341ed8e8`):

| Parche | #65 | Pila de Home (#74…) | Otras ramas |
|---|---|---|---|
| demo sintética | `7bb8ce0` | `0025d6c` | `9eadc78` (INT-HOME-REBASE), `0025d6c` (codex VISUAL-UNIFICATION) |
| staging candidate | `01a93ad` | `0987639` | `aa488e7`; también `codex/2J-HOME-004-staging-readiness` |
| visuales Búnker | `5d0e037` | `88b7163` | `a7accd5` |
| handoff visual | `2f16996` | `a9cd24d` | `75a2484` |
| corrección del handoff | `dd144e9` | `6763cf9` | `1bc037f` |

Qué se hace (sin reescribir nada publicado):
1. **Se fusiona SSO (#64→#67) primero** (orden aprobado), de modo que #65 introduce los cinco una sola vez en `main`.
2. **La pila de Home entra después con commits de merge**: git trata los parches idénticos como el mismo cambio (sin conflicto, sin contenido duplicado). La historia conservará las copias, el contenido no.
3. **Las ramas redundantes quedan marcadas como sustituidas, sin borrarlas**: `agent/claude/2J-INT-HOME-REBASE`, `agent/codex/2J-HOME-VISUAL-UNIFICATION`, `agent/codex/2J-HOME-004-staging-readiness` (ninguna tiene PR). No se les añadirán commits; se cierran/borran solo si el propietario lo pide.
4. **Prueba de que la unión funciona** (rama `agent/claude/2J-INTEGRATION-PREVIEW`, 2602953; **no es un PR ni se fusiona**): pila de Home + `main` + #71 + pila SSO. El único conflicto textual real fue `apps/client-app/src/client-app.tsx` (tres bloques donde SSO añade código sobre texto que Home no cambió → se toma el lado SSO) más la unión de `package.json`/`.env.example`/lockfile (`web-push` y `@simplewebauthn/server`), y las pruebas SSO de Home necesitan el formato de `/api/me/membership` de D31 (`active: []`; una línea de test). Resultado verificado: **API 290/290, client-app 39/39, typecheck OK**, gitleaks sin hallazgos. Sirve de receta exacta para cuando entren los PRs.

## 3. Sobre «actualizar #74 y #76 con `main`»
Hecho con merges (sin reescribir): #74 → `3634dc1`, #76 → `7832765`, #77 → `4abe4e4`, #78 → `7074177`. Arregla los 3 tests de reloj (#68). La auditoría de zod **solo** se arregla cuando #75 esté en `main`; entonces hará falta otro `merge main` en cada una (lo hago yo, sin reescribir).
