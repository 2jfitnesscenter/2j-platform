# Handoff — 2J-DESIGN-V2-PILOT-03 (Agenda)

Agenda profesional en Design System V2 **conservando toda la operativa existente**. Solo presentación: reglas de booking, cancelación, lista de espera, asistencia, plantillas y permisos son las de antes.

- Base: `origin/main` @ `7392c47` (incluye PILOT-01 y PILOT-02, mergeados).
- Estado: Draft. `VISUAL_APPROVED=no` · `FUNCTIONAL_APPROVED=no` hasta que Juanjo pruebe.

## Qué cambia

| Pieza | Dónde |
|---|---|
| Cabecera, resumen de hoy, toolbar, filtros, franja de días, rejilla, tarjetas, simultáneas | `apps/admin-web/src/calendar-page.tsx` (JSX de la vista principal) + `agenda-v2.css` |
| Componentes `@2j/ui` reutilizados | `PageHeader`, `Button`, `IconButton`, `Card`, `SegmentedControl` (ahora con `disabled`/`title`) |
| Tokens | colores de servicio V2 (5 ranuras `service1…5` + tinte) en `tokens.json`, con test de contraste |
| CSS antiguo de la vista principal | −112 líneas en `styles.css` (los estilos del editor semanal, plantillas y diálogos se conservan) |

## Diseño aplicado

- **SessionCard mínima:** hora · servicio · `ocupadas/aforo` + barra de relleno (relleno = aforo). «Lleno» en texto cuando corresponde; cancelada en neutro y tachada; sobrecupo con borde rojo. En vista **Día** añade el profesional (hay sitio); en **Semana** no. Nada de participantes, espera, reglas, notas ni botones en la tarjeta.
- **Simultáneas (decisión aprobada, sin cambios de lógica):** tarjetas reales en paralelo, hasta 4 en Día y 2 en Semana; el resto en una lista secundaria («Ver N sesiones simultáneas adicionales»). Sin pastilla «+1», sin scroll horizontal interno. Probado con 2, 3 y 5.
- **Detalle de sesión:** es el diálogo existente (mismo foco, Escape y confirmaciones) presentado como **cajón lateral de 40 rem** en escritorio y **pantalla completa por debajo de 1024 px**. Al contener reservas, lista de espera, asistencia, edición, overrides y cancelación, no se estrechó a un cajón pequeño. **Gap:** no hay URL propia por sesión (`#calendar/session/{id}`); el detalle se abre por estado. Pasarlo a página con ruta propia es un cambio de navegación, no de presentación.
- **Responsive:** ≥1121 Día/Semana con eje horario; ≤1120 solo Día (Semana desactivada con motivo), franja de días, lista vertical de tarjetas sin eje, sin scroll horizontal de página. No sustituye a `staff-app`.
- **Resumen de hoy:** compacto (sesiones, plazas ocupadas/libres, en espera), solo en la semana actual.
- Diálogos existentes (nueva sesión, plantilla, editor de horarios, confirmaciones) conservan su marcado y se **reskinean** con la misma apariencia V2 (botones, campos, radios, foco, errores). **UI debt:** migrarlos al marcado compartido `ui-modal` en una limpieza posterior.

## Funcionalidad conservada (probada)

Los 20 tests existentes de la Agenda pasan sin cambios (crear sesión, plantilla recurrente, editor visual de horarios, editar ocurrencia con aviso de disponibilidad, cita individual, lista de espera, reabrir tras asistencia/no-show, cancelar sesión y reserva con confirmación, override de capacidad, vista previa de elegibilidad y documentos). Nuevos (8, `calendar-v2.test.mjs`): densidad de tarjeta, «Lleno»/cancelada, 2/3/5 simultáneas, overflow accesible, detalle como diálogo, comportamiento estrecho, permisos sin `manage`, una sola acción primaria.

## Permisos

Sin cambios. Sin `manage` no hay Nueva sesión / plantilla / Configurar horarios ni edición ni cancelación de sesión en el detalle (test).

## Gaps conocidos

- Sin URL por sesión (ver arriba).
- Eje horario fijo 06:00–22:00 (PP-03 configurable no existe).
- El pivote por profesional (PP-11a) y la vista de 3 días (PP-11b) no existen/no se hacen.
- Los colores de servicio son 5 (hash existente), no los 8 de la propuesta de diseño.

## Verificación

typecheck, build y tests en verde. Revisado en navegador (Admin) a 1440, 1024, 768 y 390 px: Día y Semana, detalle como cajón / página, sin scroll horizontal. Las acciones de escritura (crear, cancelar, reservar…) están cubiertas por los tests existentes; el propietario debe probarlas en el piloto.

## Prueba manual (guion para Juanjo)

1. Abre http://127.0.0.1:5174/#calendar (Admin) tras `pnpm owner:review`. El menú marca **Mi gimnasio › Agenda**.
2. Cabecera: **Configurar horarios**, **Nueva plantilla** y **Nueva sesión** (verde, única principal). Debajo, «Viernes, 16 de octubre»: sesiones, plazas ocupadas/libres, en espera.
3. **Semana:** columnas por día con tarjetas (hora, servicio, 0/8) y relleno de aforo. El viernes tiene sesiones simultáneas: se ven como tarjetas en paralelo, sin «+1».
4. Pulsa **Día**: una sola columna, tarjetas más anchas con el profesional. Usa **‹ Hoy ›** y el filtro **Filtrar sesiones** (Todas, Próximas, Completas, Con espera, Canceladas).
5. Pulsa una tarjeta: se abre el **cajón lateral** con Reservas, Lista de espera, **Añadir cliente** y **Cancelar sesión**. Cierra con la **×** o Escape.
6. **Nueva sesión:** servicio, fecha y hora, aforo → crear; aparece en la agenda. Ábrela, **Editar esta sesión** y cambia solo esa fecha. (Modifica datos de prueba.)
7. En el detalle: busca un cliente (2+ letras), **Reservar plaza**; marca **Asistió / No vino**; cancela la reserva (pide confirmación). Con la sesión llena aparece la opción de lista de espera.
8. **Cancelar sesión:** pide confirmación con consecuencias; no confirmes si no quieres cancelarla.
9. **Configurar horarios:** editor semanal en cuadrícula (sin cambios de lógica).
10. **Trainer** (http://127.0.0.1:5175/#calendar): no hay Nueva sesión / plantilla / Configurar horarios; el detalle no ofrece Editar ni Cancelar sesión.
11. Responsive: a **1024** y **768** solo Día con franja de días; a **390** el detalle ocupa toda la pantalla; no hay scroll horizontal.
