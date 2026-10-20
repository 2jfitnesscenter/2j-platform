# 2J Platform — Work Continuation Handoff

Fecha: 2026-10-20. Escrito para que ChatGPT Work, Codex, Claude u otro agente continúe sin leer la conversación. Todo lo marcado `UNKNOWN / NOT VERIFIED` no se pudo comprobar en Git/GitHub.

## A. Objetivo actual

Ejecutar `docs/product/COMPETITIVE-IMPROVEMENT-ROADMAP-V2.md` (79 tareas en fases 0–10 + 6 propuestas Member), derivado de la auditoría competitiva de TIMP, Harbiz, Trainin y Strength Academy. **Un RM = un PR**; se mergea solo con CI verde y mergeable. Fase 0 (RM-00-01…04) cerrada; Fase 1 en curso: RM-01-01 abierta (PR #57).

## B. Repositorios

- Platform: `2jfitnesscenter/2j-platform` (pnpm monorepo: `apps/admin-web`, `apps/api`, `packages/ui`, `packages/design-tokens`).
- Búnker: `2jfitnesscenter/2jfitnessapp` — **NO modificar desde Platform.**
- Research: `2jfitnesscenter/2j-product-research`.
- AI orchestrator: `2jfitnesscenter/2j-ai-orchestrator`.

## C. Arquitectura de producto aprobada

- **Identidad ≠ cuota/plan.** Persona, perfil e historial persisten sin pagar; sin derechos activos puede entrar y consultar lo permitido, pero no crear reservas nuevas.
- **Member reserva siempre a mano:** servicio → calendario → sesión concreta → confirmación manual. Nunca reservas recurrentes automáticas.
- **Nav Member:** INICIO | BÚNKER | TIENDA | PERFIL | AJUSTES.
- **Shell profesional:** Resumen | Actividad | Clientes | Mi gimnasio | Equipo | Negocio.
- **RBAC futuro = permiso + alcance** (all / own / assigned). «Mis clientes» = asignación explícita.

## D. Design V2

Verde `#73b52e`, grafito/neutros, Inter, Lucide, bordes finos, sombras bajas, radios existentes, resumen primero, divulgación progresiva, aspecto premium fitness (no dashboard genérico). Antes de crear un componente, buscar equivalente en `@2j/ui` (ya hay `Button`, `Icon`, `ConfirmDialog`, `SaveState`, `SearchField`, `EmptyState`, `Card`, `PageHeader`…). Documentado en `docs/design-system/foundation.md`.

## E. Decisiones de producto aprobadas

1. **Atención / adherencia:** motivos concretos y explicables, sin score opaco. Adherencia = hechas / esperadas hasta la fecha; bandas ≥80 / 50–79 / <50 que no controlan derechos. Umbrales **TBD**.
2. **Actividad / Avisos / Noticias** separados. Actividad = Todo / Avisos / Eventos; Noticias no se mezcla.
3. **Áreas y multiárea:** áreas reales El Estudio, La Sala, El Búnker. «Entrenamiento personal» es un **servicio** asociado a La Sala y a El Búnker; **cada sesión elige UNA**. Hoy 1 servicio = 1 área (`services.area_id NOT NULL`; `checkService` en `apps/api/src/calendar.ts` exige igualdad servicio/sesión → `service_area_mismatch`). Cambio real de schema/API más adelante (expand/contract: RM-06-01 → RM-06-09 → RM-06-10). No se reescribe el histórico; el área legacy se archiva mientras esté referenciada; sesiones y plantillas futuras no se reasignan solas. **No implementado.**
4. **Vista del cliente:** preview real de solo lectura, sin impersonación, sin ampliar permisos.
5. **Anulación con trazabilidad:** ventas y cobros se anulan, no se borran; guardan quién, cuándo, motivo, cliente, importe, método, líneas y stock devuelto. Sin numeración fiscal.
6. **Ver ≠ poder reservar:** el gate de reserva del backend decide; el frontend no calcula derechos.

## F. 2J-098

- Decidido: la fórmula de derechos por periodo `ROUND_HALF_UP(días lun–vie × frecuencia semanal / 5)`, sin arrastre (rollover) ni prorrateo automático.
- Implementado en main: asignación de planes a clientes y ledger de derechos (`client_plan_assignments`, `client_entitlement_ledger`, derechos por plan) y su lectura en Cliente 360. Alcance exacto de 098A–D: **UNKNOWN / NOT VERIFIED** (no revisado en esta ejecución).
- **2J-098E NO está implementado.** Todo lo que dependa de ella se marca bloqueado; no calcular bolsas de sesiones en React ni fingir derechos en el frontend.

## G. PRs y pilotos (apilados, NO tocar)

| PR | Rama → base | Draft | Estado (verificado 2026-10-20) |
|---|---|---|---|
| #50 Agenda | `agent/claude/2J-DESIGN-V2-PILOT-03` → `main` | sí | OPEN, **CONFLICTING** con main (`clients-page.test.mjs`: arreglo equivalente en ambos lados), head `0bf26004` |
| #51 Servicios + Planes | `…PILOT-04` → `…PILOT-03` | sí | OPEN, MERGEABLE, head `b7015f1d` |
| #52 Tienda | `…PILOT-05` → `…PILOT-04` | sí | OPEN, MERGEABLE, head `8c9998ed` |

Aprobación del dueño de los pilotos en GitHub: `UNKNOWN / NOT VERIFIED` (sin reviews ni labels). Orden de merge si algún día se decide: **#50 → #51 → #52**. No mergear, rebasar, retargetear ni resolver sus conflictos desde un RM.

## H. Roadmap competitivo (fuente de verdad)

- `docs/product/COMPETITIVE-IMPROVEMENT-V2.md` — auditoría (153 filas; sección 7 = decisiones aprobadas).
- `docs/product/COMPETITIVE-IMPROVEMENT-ROADMAP-V2.md` — roadmap con fichas RM-XX-YY (scope, fuera de scope, criterios, pruebas, puertas del dueño).
- Aviso: estos dos documentos viven en la rama local `agent/claude/2J-COMPETITIVE-V2-AUDIT` (worktree `…\worktrees\claude\platform\2J-COMPETITIVE-V2-AUDIT`), **no están pusheados ni en main** (`UNKNOWN / NOT VERIFIED` en remoto). Leer la ficha del RM desde ahí antes de implementar; nunca desde memoria.

## I. RM completadas

| RM | PR | Head | Merge SHA (main) |
|---|---|---|---|
| RM-00-01 scroll + foco h1 al cambiar de módulo | #53 | `1e38a4a6` | `4f48b63c` |
| RM-00-02 a11y del shell (skip link, checkbox 24px) | #54 | `42ad1d9c` | `f9bb3392` |
| RM-00-03 copy y formato (título de día en Agenda) | #55 | `b3fcb8e6` | `b54c8186` |
| RM-00-04 `ConfirmDialog` + `SaveState` comunes | #56 | `5e65baaa` | `9adb1237` (SHA completo `9adb12377fb499a655377c3acd1571986b37329a`) |

**RM-01-01** — Clientes: A–Z y búsqueda por nombre/email/teléfono. PR #57, rama `agent/claude/RM-01-01-clients-order-search`, owner gate: ninguna. Head y CI: ver sección L.

## J. Conflictos conocidos

- #50 ya conflictúa con main en `apps/admin-web/test/clients-page.test.mjs` (mismo arreglo de aserción en ambos lados; se resuelve al integrar #50, no antes).
- El título de día de Agenda de RM-00-03 choca con #50 en la línea de toolbar de `calendar-page.tsx` (cuando #50 se integre, prevalece su diseño).
- Microcopy diferido hasta que aterricen #51/#52: placeholders con puntos suspensivos y mayúsculas de «eyebrow» en `calendar-page.tsx`, `services-page.tsx`, `store-page.tsx` (el lint `shell-a11y.test.mjs` los exime a propósito); además G2 y F4 de la auditoría.
- Los otros `window.confirm` (Servicios, Tienda) siguen sin migrar a `ConfirmDialog`: pertenecen a #51/#52.
- RM-01-01: **sin conflicto nuevo** (`git merge-tree` contra #50 da los mismos 2 bloques que main). #51/#52 no tocan `clients.ts` ni `clients-page.tsx`.

## K. Decisiones TBD

- Umbrales de atención: propuestas **no aprobadas** — 3 no-shows/30 días, 14 días de inactividad, plan termina en 7 días. Deben vivir en un único módulo de constantes (`REPEATED_NO_SHOW_THRESHOLD`, `INACTIVITY_DAYS_THRESHOLD`, `PLAN_ENDING_SOON_DAYS`) marcado DEFAULT_PROPOSAL / TBD (RM-01-02; esa ficha lleva `OWNER_PRODUCT_DECISION_GATE`).
- Todo lo dependiente de 2J-098E (rollover, prorrateo, saldo por periodo recurrente).
- Mapeo de conversión de «Entrenamiento personal» a multiárea (RM-06-09): requiere aprobación del dueño.
- Fiscalidad/numeración de anulaciones: fuera de alcance por decisión.
- Recordatorios menores: puede quedar marcado el filtro «Entrenamiento de Fuerza» en TIMP; apagar la depuración remota de Chrome.

## L. Estado exacto actual

```
CURRENT_MAIN_SHA=9adb12377fb499a655377c3acd1571986b37329a
CURRENT_OPEN_PR=https://github.com/2jfitnesscenter/2j-platform/pull/57
CURRENT_TASK=RM-01-01
CURRENT_BRANCH=agent/claude/RM-01-01-clients-order-search
CURRENT_HEAD=f453be08ab25732faba198777a8c9382c169c009 (código; el commit del handoff va encima: ver `gh pr view 57 --json headRefOid`)
CURRENT_CI=PENDING / NOT VERIFIED al escribir esto (el test de API necesita el Postgres de CI; no hay DB local)
CURRENT_OWNER_GATE=none
```

## M. Próxima acción

Una sola: comprobar `gh pr checks 57`. Si `quality` está verde y el PR es mergeable → `gh pr merge 57 --squash`, actualizar main, leer la ficha **RM-01-02** en el roadmap e implementar solo esa. Si la CI está roja → corregir solo ese fallo (probable foco: el test de API nuevo en `apps/api/test/services.test.mjs`). Si RM-01-02 exige confirmar umbrales (OWNER_PRODUCT_DECISION_GATE), no inventar valores: pedir confirmación al dueño.

## N. Reglas para el siguiente agente

- Gastar pocos créditos: sin revisiones redundantes, sin repetir auditorías ni pruebas ya validadas.
- Sin auditoría competitiva nueva (TIMP/Harbiz/Trainin/Strength Academy) salvo contradicción concreta que bloquee la tarea.
- Sin trabajo Member; sin 2J-098E; sin multiárea hasta sus RM (fase 6).
- No tocar #50/#51/#52; documentar conflictos reales sin inventar estrategia de integración.
- No modificar `2jfitnessapp` (Búnker).
- Un RM por PR; ficha del roadmap = fuente de verdad; STOP tras abrir el PR salvo instrucción contraria.
- Windows: pnpm solo funciona desde PowerShell (no desde Git Bash). Los `.ts` de la API usan CRLF: parchear normalizando saltos de línea. En tests de jsdom, `assert.ok(a === b)` en lugar de `assert.equal` sobre nodos DOM dentro de `waitFor` (el formateo del fallo puede tardar minutos). Con `exactOptionalPropertyTypes` no pasar `prop={undefined}`.
- agent-browser se cuelga a veces: no reintentar; usar el navegador integrado o marcar `not_required`.
- No hay owner gate para arreglos, copy, accesibilidad, tests, espaciado, estados vacíos o refactors.
