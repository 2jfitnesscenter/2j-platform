# Handoff — filtros operativos de Agenda

## Contexto

- Repositorio: `2jfitnesscenter/2j-platform`.
- Rama: `codex/2J-CALENDAR-FILTERS`.
- Base: rama del PR #50, `agent/claude/2J-DESIGN-V2-PILOT-03`, head `0bf260048f459a4669a1b334e5a02aec1cf87e4a`.
- Esta rama conserva el PR #50 intacto y añade solo filtros de presentación a la Agenda V2.
- Política respetada: sin cambios en Home, Búnker, Training, SSO, permisos de servidor ni reglas de reservas.

## Trabajo previo conservado

La base ya aporta agenda Día/Semana, tarjetas compactas, sesiones simultáneas sin desplazamiento horizontal interno, detalle operativo, aforo, estados, filtros de estado y acciones existentes sujetas a capacidades del servidor.

## Delta implementado

- Añadidos filtros combinables por estado, servicio y profesional.
- Añadido “Limpiar filtros”, disponible solo cuando hay un filtro activo.
- Los catálogos provienen de la respuesta existente de la API semanal; el filtrado solo organiza las sesiones que la API ya autorizó y devolvió.
- Los controles conservan etiquetas asociadas, foco visible, tokens 2J y ajuste adaptable en pantallas estrechas.
- El estado vacío indica cuando no hay sesiones para los filtros elegidos.

## Evidencia y validación

- Captura real del piloto local sintético: `docs/evidence/2J-CALENDAR-FILTERS/agenda-semana-desktop.png`.
- `pnpm --filter @2j/admin-web test`: **173/173**.
- `pnpm --filter @2j/admin-web typecheck`: PASS.
- `pnpm --filter @2j/admin-web build`: PASS.
- `git diff --check`: PASS.
- Piloto visual: `pnpm owner:review`; Admin en `http://127.0.0.1:5174/#calendar`. El piloto ya está detenido. PostgreSQL usado fue el contenedor sintético aislado `2j-platform-owner-visual-review-097y` en loopback; no se usaron datos reales.

## Handoff backend

No queda trabajo backend necesario para este delta: reutiliza la respuesta y autorización existentes de `/api/calendar/week`. No se añadieron rutas ni se cambió ninguna regla de acceso.

## Siguiente integración

Esta rama depende del PR #50. Para revisar o integrar el delta, conservar esa relación de ramas: integrar primero #50 y después este delta, o usar una PR apilada cuyo destino sea la rama de #50. No retargetear a `main` hasta que la agenda base esté integrada.
