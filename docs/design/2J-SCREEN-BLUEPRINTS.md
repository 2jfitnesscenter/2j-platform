# 2J SCREEN BLUEPRINTS

Wireframes **textuales y estructurales** de las pantallas clave. No son diseño pixel-perfect: fijan **jerarquía, acción primaria, qué se oculta y qué se abre en modal/drawer/página**. Componentes en [`2J-UI-PATTERNS.md`](2J-UI-PATTERNS.md); tokens y reglas en [`2J-DESIGN-SYSTEM-V2.md`](2J-DESIGN-SYSTEM-V2.md); dirección en [`2J-DESIGN-DIRECTION-V2.md`](2J-DESIGN-DIRECTION-V2.md).

**Estado:** dirección general aprobada por el propietario el 2026-10-16 (decisiones DD-01…DD-08 `APPROVED BY PRODUCT OWNER`; estados de PP-01…PP-11 en el anexo). Sigue pendiente la revisión visual final antes de aplicar nada; no se ha tocado ninguna pantalla. **Ningún blueprint cambia reglas de negocio ni contratos de API.** Las referencias a capacidades de 2J-098 (periodos, políticas, imágenes) se activan «cuando 098X esté implementado»; mientras tanto la pantalla muestra el dato legacy sin pestañas ni textos de 098.

**Leyenda:** `P` acción primaria · `S` secundaria · `T` terciaria · `▓` relleno de aforo/saldo · `⚠` atención. Los datos y nombres son ficticios.

**Aplica a todos:** tres estados (carga con *skeleton*, vacío con causa+CTA según permiso, error con causa+reintento); `PermissionAwareAction` (sin permiso, no se pinta); hora de Canarias; foco visible; objetivos táctiles ≥ 44 px.

---

## Parte A — Shell profesional (Admin y Trainer)

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│ 2J       │  [🔍 Buscar cliente, sesión…      Ctrl K]                 🔔  │
│ Fitness  │                                                               │
│          │  PageHeader                                                   │
│ ⌂ Resumen│  ───────────────────────────────────────────────────────────  │
│ ✉ Activ. │                                                               │
│ ◉ Client.│                      contenido (máx. 1280)                    │
│ ▦ Mi gim.│                                                               │
│   Agenda │                                                               │
│   Servic.│                                                               │
│ ♙ Equipo │                                                               │
│ € Negocio│                                                               │
│          │                                                               │
│ (avatar) │                                                               │
│ Alex R.  │                                                               │
│ [Admin]  │                                                               │
└──────────┴───────────────────────────────────────────────────────────────┘
```

---

## 1. Resumen profesional

**Objetivo:** responder en 5 segundos *qué está pasando, qué importa, qué necesita acción*.
**Jerarquía:** (1) `PageHeader` (saludo + fecha + «Actualizado hace 2 min ↻») → (2) `MetricStrip` (4) → (3) **Requiere atención** (protagonista) junto a **Próximas sesiones** → (4) **Actividad reciente**.
**Acción primaria:** `Nueva sesión` (solo con permiso de gestión). Sin primaria si no hay permiso.
**Secundarias:** «Abrir agenda» (terciaria en Próximas sesiones), «Ver todo (n)» (atención), «Ver toda la actividad».

```
Buenos días, Alex          jueves 16 oct · Actualizado hace 2 min ↻            [+ Nueva sesión]

┌ Con plan activo  ┐ ┌ Reservas hoy ┐ ┌ Ocupación hoy ┐ ┌ Pendiente de cobro ┐
│ 124              │ │ 38           │ │ 71 %          │ │ 1.240 €            │
│ 3 nuevos         │ │ 4 en espera  │ │ 6 de 9 ses.   │ │ 5 vencidos ⚠       │
└──────────────────┘ └──────────────┘ └───────────────┘ └────────────────────┘

┌ Requiere atención (3) ───────────┐  ┌ Próximas sesiones ─────────────────────┐
│ ⚠ Pago vencido                   │  │ 18:00  Funcional      6/10   Alex R.    │
│   María Pérez        [Ver cliente]│  │ 19:00  Pilates        8/8 ▓  LLENO +2   │
│ ⚠ Sesión sin entrenador          │  │ 19:30  Yoga           3/12   Nora V.    │
│   Funcional · 18:00     [Asignar]│  │ 20:15  Cross          2/2 ▓             │
│ ● Transferencia por validar      │  │ 21:00  Movilidad      1/10              │
│   Ana León · 49 €  [Revisar pago]│  │                    [Abrir agenda →]     │
└──────────────────────────────────┘  └────────────────────────────────────────┘

┌ Actividad reciente ───────────────────────────────────────────────────────────┐
│ María canceló Funcional de hoy · Libera 1 plaza                    [Ver sesión]│
│ Lucía entró en lista de espera · Pilates 19:00 (3 en cola)         [Ver sesión]│
│ …                                                      [Ver toda la actividad] │
└───────────────────────────────────────────────────────────────────────────────┘
```

- **Cards:** `MetricCard` ×4 (solo las permitidas), `AttentionList`, lista de `SessionRow` (versión compacta de `SessionCard`), `ActivityFeed`.
- **Oculto:** agenda completa, listas completas, detalle económico, participantes.
- **Se abre en:** sesión → `DetailDrawer`; cliente → página del Cliente 360; pago → ficha de pago del cliente.
- **Vacío:** «Todo al día. Nada requiere tu atención.»; sin sesiones: «Hoy no hay sesiones» + [Nueva sesión] (si permiso).
- **Trainer:** `MetricStrip` sin «Pendiente de cobro» salvo permiso; **Próximas sesiones** ya refleja sus sesiones (el servidor decide el alcance; «Mis sesiones» es el filtro/experiencia **por defecto** del Trainer, no frontera de autorización; con `scope=all` puede cambiar a «Todas». *PP-07*).
- **Móvil:** orden **Atención → Próximas (3) → Métricas 2×2 → Actividad (3, colapsable)**; acciones en cada fila a 44 px.
- **Hoy → Target:** hoy el Resumen tiene **cinco paneles** —«Agenda de hoy» (protagonista, con estadísticas y hasta 5 sesiones), «Necesitan atención», «Pendientes», «Pulso operativo» y «Pendiente de gestión»— con dos *eyebrows* («CENTRO DE OPERACIONES», «HOY · ATLANTIC/CANARY») y botón «Actualizar». Target: la atención sube al protagonismo (junto a Próximas sesiones), las cifras pasan a una `MetricStrip` de 4 indicadores accionables, «Pendientes»/«Pulso operativo»/«Pendiente de gestión» se integran en atención y métricas, y desaparece el segundo *eyebrow*.

---

## 2. Agenda — Día

**Objetivo:** operar el día: ver ocupación, abrir una sesión, añadir clientes.
**Jerarquía:** barra de agenda → resumen de rango (texto) → rejilla horaria.
**Acción primaria:** `Nueva sesión`. **Secundarias:** «Configurar horarios» (menú «Más»), filtros.

```
‹ Hoy ›   jueves 16 oct          [Día|Semana]   [Filtros (1)]   [⚙ Horario]      [+ Nueva sesión]
6 sesiones · 71 % ocupación · 3 en espera                       Hora de Canarias

06:00 ┤
08:00 ┤ ┌ 08:00–09:00 ────┐ ┌ 08:00–09:00 ────┐ ┌ 08:00–09:00 ────┐
      │ │ Funcional       │ │ Pilates         │ │ Yoga            │   ← simultáneas:
      │ │ 6/10 ▓▓▓▓░░     │ │ 8/8 ▓▓▓▓ LLENO  │ │ 3/12 ▓░░░       │     hasta 4 tarjetas reales
09:00 ┤ └─────────────────┘ └─────────────────┘ └─────────────────┘
10:00 ┤                                    ┈┈┈ ahora ┈┈┈
```

- **Cards:** `SessionCard` mínima (hora · servicio · ocupación · profesional si aporta).
- **Simultáneas:** **hasta 4 tarjetas reales en paralelo**; el resto en una **lista secundaria separada** debajo de la franja («Ver 2 sesiones simultáneas adicionales»); **sin pastilla `+1 sesión`** sobre la card; sin scroll horizontal interno.
- **Resumen de rango:** una línea de texto (sesiones · ocupación · espera), no cards.
- **Día actual** en el selector con relleno `brand-soft`; **línea «ahora»** fina en verde.
- **Eje horario configurable** (⚙): primera y última franja visibles. *PP-03 (APPROVED DIRECTION — NOT IMPLEMENTED): configuración **a nivel de centro** (p. ej. inicio 06:00, fin 22:00), sin preferencia individual por profesional en V1. Las sesiones fuera del rango tienen salida razonable: indicador «Fuera de horario (n)» que las abre.*
- **Aviso de zona horaria** solo cuando el dispositivo difiere de Canarias.
- **Filtros** (popover/panel): Servicio · Profesional · Estado (**Todas** incluye canceladas; **Canceladas** las aísla) · Mis sesiones / Todas (el Trainer entra en «Mis sesiones»; «Todas» solo si su RBAC permite `scope=all`; *PP-07*). Contadores = colección filtrada.
- **Oculto:** participantes, cola, notas, reglas, saldos de sesiones, botones por tarjeta.
- **Se abre en:** clic en tarjeta → `DetailDrawer` de sesión (deep link `#calendar/session/{id}`); «Nueva sesión» → `Modal` de formulario corto con «Más opciones».
- **Vacío:** «No hay sesiones este día» + [Nueva sesión] / [Configurar horarios] (según permiso).
- **Móvil/tablet:** Día por defecto; `DayStrip` arriba; tarjetas a ancho completo; las simultáneas se apilan en filas; filtros en *bottom sheet*; detalle a página completa.
- **Hoy → Target:** tras #45 la tarjeta **ya es mínima** (hora · servicio · `ocupadas/capacidad`) y las simultáneas ya son tarjetas reales con lista secundaria. Target **conserva esa dirección** y añade: relleno visual de aforo y texto «Lleno», profesional cuando aporta, 8 colores de servicio, línea «ahora», eje horario configurable, filtro «Todas» que incluye canceladas, aviso de zona horaria condicional, detalle en `DetailDrawer` con URL propia (hoy es un modal) y decisión Día/Semana por ancho de contenedor (hoy por viewport a 1120 px).

## 3. Agenda — Semana

**Jerarquía:** barra de agenda → rejilla de 7 columnas.
**Acción primaria:** `Nueva sesión`.

```
‹ Hoy ›  12 – 18 oct          [Día|Semana]  [Filtros]  [⚙]                  [+ Nueva sesión]
         Lun 12   Mar 13   Mié 14   Jue 16*   Vie 17   Sáb 18   Dom 19
08:00   ┌Func 6/10┐┌Pil 3/8 ┐          ┌Func 6/10┐
        └────────┘└────────┘          │Pil 8/8  │   hasta 2 tarjetas paralelas
09:00                                  └─────────┘
…            Ver 1 sesión simultánea adicional ▾   (lista secundaria por día)
```

- **Hasta 2 tarjetas simultáneas por franja** (decisión aprobada); excedentes a la lista secundaria del día. Sin `+1` pegado ni scroll horizontal.
- **Columna de hoy** destacada con `brand-soft`; cabecera de día con fecha y recuento de la colección filtrada.
- **Decide por ancho de contenedor, no de viewport:** si el contenedor no permite ≥ ~120 px por columna con dos tarjetas, pasa a **Día** (con aviso «La semana completa se muestra mejor en una pantalla más ancha»).
- Vista de **3 días**: *DEFERRED / OPTIONAL (PP-11)*. No entra en V1 solo porque Trainin la tenga; las vistas principales siguen siendo **Día** y **Semana**.
- **Pivote por profesional** (columnas = profesionales; TIMP): *APPROVED DIRECTION — NOT IMPLEMENTED (PP-11)* como dirección futura. Sin cambios de lógica; solo vista.
- **Móvil:** no se ofrece Semana; `DayStrip` semanal + Día.

## 4. Detalle de sesión

**Objetivo:** comprender y operar una sesión sin salir de la agenda.
**Presentación:** `DetailDrawer` (≥ 1024) con URL propia; **página completa** en < 1024 (principio de «sesión como página» de Trainin con contexto operativo de 2J).
**Jerarquía:** cabecera (servicio, fecha/hora, chip de estado) → capacidad (`6 / 10 ▓`) → pestañas → notas → acciones.
**Acción primaria (cambia con el momento):** antes del inicio **`Añadir cliente`**; durante/tras el inicio **`Marcar asistencia`**; sesión cancelada: ninguna (lectura).
**Secundarias:** `Editar` (menú: «Solo esta sesión» / «Esta y las siguientes» con recuento), `Cancelar sesión` (**danger**, al final del menú, con `ConfirmationModal`).

```
Funcional                                         [Programada]      [ + Añadir cliente ]
jueves 16 oct · 18:00–19:00 · Alex Rivera · Sala 1                  [ Editar ▾ ] [ ⋯ ]
Plazas  6 / 10  ▓▓▓▓▓▓░░░░     En cola 2

[ Reservas (6) ][ En cola (2) ][ Historial ]
 ┌ María Pérez     Reservada            [Asistió] [No vino]      ⋯
 ┌ Carlos Ruiz     Reservada · Bono     …
 Notas internas                                              [Añadir nota]
 Serie: Lunes y jueves 18:00  [Editar serie]
```

- **Cards/secciones:** cabecera con `StatusChip`, medidor de capacidad, `Tabs` (Reservas · En cola · Historial), lista de asistentes, `InfoCard` de serie.
- **Añadir cliente:** `Combobox` con búsqueda; si el gate rechaza, muestra **los motivos** («Sin saldo en el periodo», «Pago vencido») y, con permiso, la opción de excepción con motivo. *(Autoridad: backend.)*
- **Asistencia:** por fila, dos botones secundarios compactos; no más de dos por fila.
- **Cancelar reserva (por fila):** en «⋯»; pide **motivo** y, con permiso, la consecuencia sobre el derecho (cuando 098A exista).
- **Oculto en la agenda y visible aquí:** participantes, cola, notas, historial, serie.
- **Series:** el alcance de edición se elige en el botón (TIMP).
- **Estados:** programada · en curso · finalizada · llena · cancelada (cabecera neutra, acciones deshabilitadas con motivo).
- **Salida explícita (drawer → página):** el drawer **no debe convertirse en un panel estrecho** si concentra mucha operación. En la implementación habrá que **probar visualmente** reservas, lista de espera, asistencia, notas y acciones; si el drawer resulta saturado, **se permite elevar el detalle a página completa** también en desktop (misma URL `#calendar/session/{id}`).
- **Móvil:** página completa; acción primaria fija abajo; pestañas con scroll horizontal controlado.

---

## 5. Clientes (lista)

**Objetivo:** responder *¿quién necesita atención?*, no solo localizar a alguien.
**Jerarquía:** `PageHeader` → `Tabs` con contadores → `SearchBar` + `FilterBar` → lista.
**Acción primaria:** `Nuevo cliente` (con permiso). **Secundarias:** importar/exportar (menú «Más»), columnas.

```
Clientes                                                           [+ Nuevo cliente]
[ Todos 124 ][ Requiere atención 7 ][ Plan activo 98 ][ Sin plan 19 ][ Archivados 7 ]
[🔍 Buscar por nombre, correo o teléfono]  [Plan ▾] [Actividad ▾]  [Filtros (0)]  Ordenar: A–Z ▾

CLIENTE             PLAN                       SESIONES      ACTIVIDAD                  ATENCIÓN         ENTRENADOR
(M) María Pérez     ● Activo · Trim. 3×/sem    7/13 ▓▓▓░     ● Activo · Hoy 18:00       ⚠ Pago vencido   (A) Alex
(L) Lucía Gil       ● Activo · Mensual 2×/sem  6/8  ▓▓▓▓░    ● Activo · Vie 10:00       —                (N) Nora
(P) Pablo Mena      ○ Sin plan                 —             ○ Sin actividad reciente   —                —
```

- **Tres conceptos, tres señales (PP-04):** **Cuenta** (la identidad existe siempre: avatar + nombre + «Cliente desde»; no se oculta ni se borra por no tener plan; solo «Archivado» es un estado de cuenta explícito) · **Plan** (`StatusChip`: Activo · Vencido · Sin plan · otros estados reales) · **Actividad** (`StatusChip` separado: Activo · Sin actividad reciente; la definición de «actividad» se concreta después). **El chip de actividad nunca autoriza nada.** **Sesiones:** cifra + relleno (ilimitado: «Ilimitadas»). **Atención:** chip con **motivo visible**. **Entrenador:** solo si existe la asignación (2J-098C `assigned`).
- **Orden por defecto: el normal (A–Z).** «Requiere atención» es una **pestaña/filtro y una opción de orden** («Atención primero»), con el motivo visible en cada fila, pero **no sustituye siempre** el orden normal: el usuario puede volver a Todos / filtros por plan / orden alfabético. *PP-06 y PP-01: APPROVED DIRECTION — NOT IMPLEMENTED; los umbrales concretos y las consultas se definen en su TASK.*
- **Oculto:** email, teléfono, dirección, notas (PII bajo demanda; el servidor filtra según permiso).
- **Se abre en:** clic en la fila → **página Cliente 360** (no modal); «Nuevo cliente» → `Modal` corto (nombre, apellidos, contacto) + «Más opciones».
- **Tabla vs cards:** tabla de administración en ≥ 1024; **lista de `ClientCard` en < 768**.
- **Vacío:** «Aún no hay clientes» + [Nuevo cliente]; filtros sin resultado: «Ningún cliente coincide» + [Limpiar filtros].
- **Móvil:** card de dos líneas; la atención como chip; búsqueda fija arriba.

## 6. Cliente 360

**Objetivo:** ficha clara, poco saturada, con la atención primero y la operación real de 2J.
**Jerarquía:** cabecera → **hechos clave** → pestañas → Resumen.
**Acción primaria (según contexto y permiso):** `Reservar sesión` (si puede reservar) o `Asignar plan` (si no tiene). **Secundarias:** `Mensaje`, `Vista del cliente` (PP-02), **menú «Más»** (editar datos, archivar — **sin «Eliminar»**: el perfil no se borra, se archiva).

```
‹ Clientes › María Pérez                                     [← anterior] [siguiente →]
(Avatar 72)  María Pérez   Plan ● Activo · Actividad ● Activo   Cliente desde mar 2025     [Reservar sesión]
             Trimestral · 3 días/semana                              [Mensaje] [Más ▾]

┌ Sesiones ─────┐ ┌ Pago ─────────┐ ┌ Próxima reserva ┐ ┌ Alertas ────────┐
│ 7 / 13        │ │ ● Pagado      │ │ Hoy 18:00       │ │ ⚠ 1             │
│ nov 1–30      │ │ vence —       │ │ Funcional       │ │ Doc. pendiente  │
└───────────────┘ └───────────────┘ └─────────────────┘ └─────────────────┘

[ Resumen ][ Datos ][ Reservas ][ Plan y sesiones ][ Pagos ][ Compras ][ Documentos ][ Historial ]

RESUMEN
 ⚠ Requiere atención (1)      Documento pendiente · Consentimiento        [Ver documentos]
 ┌ Próxima reserva ────────┐ ┌ Plan actual ─────────────────────────────┐
 │ Hoy 18:00 Funcional      │ │ Trimestral · 3 días/semana   15 oct–14 ene│
 │ [Ver] [Cancelar]         │ │ Periodo actual 1–30 nov · 7/13  [Ver periodos]│
 └──────────────────────────┘ └──────────────────────────────────────────┘
 ┌ Actividad reciente ──────────────┐ ┌ Notas internas ────── [Añadir nota] ┐
```

- **Hechos clave (4 `MetricCard`):** Sesiones disponibles · Pago · Próxima reserva · Alertas.
- **Pestañas:** Resumen · Datos · Reservas · Plan y sesiones · Pagos · Compras · Documentos · Historial. **Mensajes** pasa a ser la acción «Mensaje» de la cabecera (abre un panel de conversación), y **Seguimiento** (check-ins) se mantiene como pestaña **condicional** solo con esa capacidad. *(«Salud/Entrenamiento» solo con capacidad e integración con Búnker; no se reconstruye Búnker.)* Máx. 9.
- **Resumen:** atención (si hay), próxima reserva, plan actual (`PlanSummary`/`EntitlementSummary`), actividad reciente, notas internas.
- **Datos:** secciones plegables (personales, contacto, preferencias, **historial de eventos y de cuenta**); acciones de cuenta (reenviar bienvenida, desactivar acceso) **separadas** de la identidad y en rojo cuando son destructivas.
- **Plan y sesiones:** `PlanSummary` + periodos (ver blueprint 9). **Pagos:** ver blueprint 10 (resumen arriba, historial debajo). **Compras:** lista de ventas de Tienda. **Reservas:** próximas / historial (con asistencia).
- **Plan y actividad, separados (PP-04, APPROVED DIRECTION — NOT IMPLEMENTED):** la cabecera muestra dos chips distintos —*Plan* (Activo · Vencido · Sin plan…) y *Actividad* (Activo · Sin actividad reciente)— con ayuda («Cómo funciona») que explica cada uno. La identidad de la cuenta existe siempre; ningún chip de estado equivale a autorización ni oculta al cliente.
- **Navegación entre clientes:** flechas anterior/siguiente (SA) respetando el filtro de la lista.
- **Se abre en:** acciones de cobro/plan en `Modal`; documentos en `DetailDrawer`.
- **Móvil:** cabecera compacta; hechos clave en 2×2; pestañas scrollables; acción primaria fija.
- **Hoy → Target:** hoy la ficha ya tiene **pestañas por capacidad** (Resumen · Cuotas · Reservas · Pagos · Documentos/Formularios · Mensajes · Seguimiento · Historial), tres tarjetas de resumen (estado del perfil, **número** de reservas, próxima reserva) y un bloque de cuota activa. Target añade en la cabecera lo que más ayuda a operar —**sesiones disponibles, estado de pago y alertas**—, la atención primero, avatar y acciones rápidas por permiso, renombra «Cuotas» a «Plan y sesiones» (el nombre técnico *rights/entitlements* sigue en el dominio, no en la UI) y añade «Datos» y «Compras».

## 7. Servicios

**Objetivo:** listado limpio y avisos de configuración incompleta.
**Acción primaria:** `Nuevo servicio`. **Secundarias:** gestionar espacios/áreas.

```
Mi gimnasio › Servicios                                           [+ Nuevo servicio]
[Todos 12][Activos 10][Archivados 2]   [🔍 Buscar]   Área ▾

┌ Funcional ──────────────┐ ┌ Pilates ────────────────┐ ┌ Yoga ───────────────────┐
│ ● ACTIVO   Sala 1       │ │ ● ACTIVO   Sala 2       │ │ ● ACTIVO   Sala 2       │
│ 60 min · 10 plazas      │ │ 55 min · 8 plazas       │ │ 60 min · 12 plazas      │
│ ⚠ No hay planes vinculados│ │ Cancelación: 4 h        │ │                         │
└─────────────────────────┘ └─────────────────────────┘ └─────────────────────────┘
```

- **`ServiceCard`:** nombre · área · duración · aforo · estado · avisos rojos de configuración (Trainin). Una línea de política cuando 098A exista.
- **Editar:** **página** con secciones: *Básico* (nombre, área, duración, aforo, color) · *Reservas y cancelación* (reglas en lenguaje natural con valor predeterminado) · *Planes vinculados* · **«Más opciones»**; `SaveBar` («Cambios sin guardar» / «Guardado»).
- **Oculto:** reglas avanzadas, historial.
- **Vacío:** «Aún no hay servicios» + [Nuevo servicio] (con permiso).
- **Móvil:** una columna de cards; edición a pantalla completa.

## 8. Planes (catálogo)

**Objetivo:** elegir y configurar planes sin ver el modelo técnico.
**Acción primaria:** `Nuevo plan`. **Visible solo con permiso de precios.**

```
Negocio › Planes                                                    [+ Nuevo plan]
[Todos][Mensual][Trimestral][Semestral][Anual][Bono][Puntual][Medio mes]   [Activos ▾]

┌ Mensual · 3 días/semana ─┐ ┌ Trimestral · 3 días/sem ─┐ ┌ Bono 10 sesiones · 90 d ─┐
│ [MENSUAL]       ● Activo │ │ [TRIMESTRAL]    ● Activo │ │ [BONO]          ● Activo │
│ 49,00 €                  │ │ 129,00 €                 │ │ 59,00 €                  │
│ Funcional, Pilates       │ │ Funcional, Pilates       │ │ Funcional                │
└──────────────────────────┘ └──────────────────────────┘ └──────────────────────────┘
```

- **`PlanCard`:** nombre · tipo (chip) · precio · frecuencia/«Ilimitado» · servicios · estado · avisos.
- **Vista tabla** alternativa (administración/comparación) con `DataTable`: nombre, tipo, precio, frecuencia, servicios, estado.
- **Editar plan:** formulario corto (nombre, tipo, precio, frecuencia o ilimitado, servicios) + «Más opciones»; **no** se expone contrato/periodo/ledger. Una **vista previa** («Con este plan, un mes de 21 días hábiles da 13 sesiones») explica el cálculo en lenguaje natural cuando 098E exista.
- **Móvil:** cards en una columna; tabla oculta.

## 9. Perfil del plan / cuota (de un cliente)

**Objetivo:** que el staff entienda *qué tiene contratado, hasta cuándo, si está pagado y cuántas sesiones quedan*.
**Presentación:** pestaña «Plan y sesiones» del Cliente 360 + `DetailDrawer` «Ver periodos».
**Acción primaria:** `Renovar` (**acción iniciada por el staff** cuando se acerca el fin; no existe renovación automática) o `Asignar plan` (sin plan). **Secundarias:** `Cambiar plan`, `Pausar`, `Ajustar sesiones` (con motivo). **Danger:** `Cancelar plan` (`ConfirmationModal` con efectos).

```
Plan                Trimestral · 3 días/semana
Vigencia            15 oct – 14 ene
Pago                ● Pagado · 129,00 €
Periodo actual      1 nov – 30 nov
Sesiones            7 / 13 disponibles  ▓▓▓▓▓░░░░░░░
                                          [Ver periodos]

Ver periodos →   Octubre   (15–31 oct)  caducado   · usadas 5 / 7
                 Noviembre (1–30 nov)   en curso   · 7 / 13
                 Diciembre (1–31 dic)   próximo    · 14
                 Enero     (1–14 ene)   próximo    · 6
```

- **Copy de fin de plan:** «Vigente hasta 14 ene» o «Finaliza el 14 ene». La palabra «Renovación» solo aparece si hay una renovación **preparada o confirmada** por el staff (p. ej. «Renovación confirmada desde el 15 ene»). La renovación la inicia el staff (2J-098); la UI nunca sugiere cobro o renovación automáticos.
- Las sesiones **no se trasladan** entre periodos: el sobrante de un periodo pasado figura como «Caducado» (informativo).
- **Estados de pago visibles:** `PAGADO` · `PENDIENTE · vence 20 oct` · `VENCIDO` («No puede crear nuevas reservas con este plan»).
- **Ilimitado:** sin cifras ni barra. **Bono:** «Caduca el 9 ene»; sin pagar: «Se activa al validar el pago».
- **Oculto:** movimientos de ledger, claves, snapshots (disponibles en «Historial» para Admin si hace falta).
- Depende de 2J-098E; antes de ello, solo plan, vigencia, pago y saldo legacy.

## 10. Pagos

**Dos contextos con el mismo lenguaje:** (a) pestaña **Pagos** del Cliente 360 (no es contabilidad completa) y (b) página **Negocio › Economía**.
**Separación visual por estado:** `PENDIENTE` · `VENCIDO` · `PAGADO`. *`PLANIFICADO` (PP-05): **FUTURE / DEFERRED — NO APROBADO para V1**; 2J-098 no genera cargos futuros automáticos y no se introduce un estado visual cuyo concepto de dominio todavía no existe.*

```
(a) Cliente 360 › Pagos
 ┌ Pendiente ─┐ ┌ Vencido ─────┐ ┌ Pagado (12 m) ┐         [Registrar pago]
 │ 129,00 €   │ │ 0,00 €       │ │ 1.032,00 €    │
 └────────────┘ └──────────────┘ └───────────────┘
 [Todo][Pendiente][Vencido][Pagado]
 Octubre 2026
   Trimestral · 3×/sem      129,00 €   ● PAGADO     14 oct · Tarjeta     [Ver]
 Septiembre 2026
   Mensual · 2×/sem          49,00 €   ● PAGADO     2 sep  · Efectivo    [Ver]
```

- **Resumen arriba, historial debajo** (agrupado por mes); fila: concepto · importe · estado · fecha/método · acción. No se muestran ledger ni asientos.
- **Acción primaria:** `Registrar pago` (con permiso); **secundarias:** `Validar transferencia`, `Descargar justificante`.
- (b) **Economía:** `MetricStrip` (Pendiente · Vencido · Cobrado hoy) + `Tabs` (Pendiente · Vencido · Pagado) + `DataTable` por cobros (tabla justificada: administración y comparación) y caja diaria como sección aparte. En móvil → lista de cards.
- **Vencido** muestra la fecha límite con hora de Canarias y la consecuencia («Bloquea nuevas reservas»).
- **Vacío:** «Nada pendiente de cobro.»

## 11. Tienda — Admin

**Objetivo:** catálogo **visual** como experiencia principal; tabla solo para inventario y ventas.
**Acción primaria:** `Añadir producto`. **Secundarias:** `Nueva venta`, `Registrar stock`.

```
Negocio › Tienda                                [Nueva venta] [+ Añadir producto]
[ Catálogo ][ Inventario ][ Ventas ]      [🔍 Buscar]  [Categoría ▾]  [Estado ▾]

┌[img]────────┐ ┌[img]────────┐ ┌[ icono ]────┐ ┌[img]────────┐
│ Proteína 2J │ │ Camiseta 2J │ │ Cinturón    │ │ Botella     │
│ desde 32,90 │ │ 18,00 €     │ │ 24,00 €     │ │ 9,00 €      │
│ Stock 12    │ │ POCAS (3)   │ │ AGOTADO     │ │ INACTIVO    │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   ← producto sin foto: fallback
```

- **`ProductCard`:** imagen · nombre · precio · estado de stock (Admin ve cifras con permiso de inventario).
- **Inventario:** `DataTable` por variante (SKU, producto, variante, stock, mínimo) con acción «Registrar stock». **Ventas:** `DataTable` + filtros; `Nueva venta` abre un `Modal`/página: cliente → producto/variante → cantidad → precio → confirmar.
- **Vacío:** «No hay productos todavía» + [Añadir producto] (con permiso); sin permiso, sin CTA.
- **Móvil:** cards de 2 columnas; tablas → listas.
- **Hoy → Target:** hoy la pantalla tiene cuatro acciones desplegables («＋ Añadir producto», «＋ Añadir variante», «＋ Registrar stock», «＋ Nueva venta en el centro») y las secciones «Productos y variantes» (filas), «Actividad reciente» y «Últimos movimientos de stock». Target: catálogo como cuadrícula de `ProductCard` con imagen (cuando 098D exista), una sola acción primaria `Añadir producto`, y pestañas Catálogo · Inventario · Ventas con tablas solo donde se compara o administra.

## 12. Producto — Admin

**Presentación:** **página** (no modal): galería a la izquierda, datos a la derecha.
**Acción primaria:** `Guardar` (`SaveBar`). **Secundarias:** `Desactivar producto`, `Añadir variante`.

```
‹ Tienda › Camiseta 2J                                         ● Guardado   [Guardar]
┌ Imágenes (3 / 6) ──────────────┐   Nombre *         [Camiseta 2J              ]
│ ┌─────────┐ ┌───┐ ┌───┐ ┌───┐  │   Categoría *      [Merchandising ▾]
│ │principal│ │ 2 │ │ 3 │ │ + │  │   Descripción (opcional) [                 ]
│ └─────────┘ └───┘ └───┘ └───┘  │   Variantes
│ 1:1 · JPG/PNG/WebP · ≤ 8 MB    │   ┌ SKU      Variante   Precio   Stock ┐
│ ideal 1600×1600 · mín. 800×800 │   │ TEE-M    Talla M    18,00 €   5    │
│ Arrastra o [Elegir archivos]   │   │ TEE-L    Talla L    18,00 €   0    │
└────────────────────────────────┘   └ [+ Añadir variante]                ┘
                                     Más opciones ▾  (visibilidad, SKU interno…)
```

- **`ImageUploader`:** requisitos visibles antes del error; la primera es la principal; hasta 6; reordenar con botones accesibles; `alt` editable; borrar con confirmación.
- Imágenes **por producto** (las variantes las comparten).
- Variantes en `DataTable` editable; stock no editable aquí (movimientos desde «Registrar stock» con motivo).
- **Oculto:** movimientos de inventario (pestaña/drawer «Movimientos»).
- **Móvil:** galería arriba, formulario debajo; `SaveBar` fija.

---

## Parte B — Member (mobile-first)

Navegación inferior de 5: **Inicio · Búnker · Tienda · Perfil · Ajustes**. «Reservar» y «Mis reservas» viven dentro de Inicio.

## 13. Member — Inicio

**Objetivo:** que el Member vea *mi próxima sesión, mi plan y qué hacer a continuación* en un vistazo.
**Acción primaria:** `Reservar` (CTA grande). **Secundarias:** ver/cancelar la próxima reserva, abrir Búnker.

```
┌ Hola, María ─────────────────────────┐
│ jueves 16 oct                    (🔔)│
└──────────────────────────────────────┘
  L  M  X  J* V  S  D     ← tira semanal (puntos = sesiones reservadas)
 ┌ Tu próxima reserva ──────────────────┐
 │ HOY · 18:00                          │
 │ Funcional · Alex Rivera              │
 │ Sin penalización hasta las 14:00     │
 │ [Ver detalle]        [Cancelar]      │
 └──────────────────────────────────────┘
 [        Reservar una sesión        ]    ← CTA 52 px, verde
 ┌ Tu plan ─────────────────────────────┐
 │ Trimestral · 3 días/semana           │
 │ Sesiones de noviembre  7 / 13  ▓▓▓░  │
 │ Vigente hasta 14 ene                 │
 └──────────────────────────────────────┘
 ┌ Búnker ──────────────────────────────┐   ← enlace a su módulo (no se rediseña aquí)
 ┌ Del centro (noticias / avisos) ──────┘
```

- **Cards grandes**, una columna, 640 px máx. en escritorio; hero con personalidad (grafito) sin ornamento.
- **Reglas visibles antes de reservar/cancelar:** copy aprobado «Cancelación sin penalización hasta las 14:00» (o equivalente; el wireframe lo abrevia) y, **pasada la ventana, la consecuencia** («Si cancelas ahora, la sesión cuenta como usada»). *PP-10: APPROVED DIRECTION — NOT IMPLEMENTED; visible cuando 2J-098A esté implementado (hoy, el dato de política vigente).* **La UI no calcula la política: el backend entrega la política/resumen.**
- **Fin de plan sin renovación automática:** la tarjeta de plan dice «Vigente hasta 14 ene» (o «Finaliza el 14 ene»); nunca «Renovación el …» salvo renovación preparada/confirmada por el staff.
- **Pago pendiente:** `InfoCard` amarilla informativa («Tu cuota vence el 20 oct · Ver pago») — **nunca** bloquea la navegación.
- **Vacío:** sin reservas → «Todavía no tienes reservas» + [Reservar una sesión]; sin plan → «Sin plan activo» + «Consulta con tu centro».
- **Oculto:** historial, movimientos, reglas internas, términos técnicos (contrato/ledger).
- **Se abre en:** detalle de reserva → `BottomSheet`; Reservar → flujo (blueprint 14).

## 14. Member — Reservar (servicio → calendario → sesión → confirmación)

**Principio aprobado:** reserva **siempre manual y confirmada**; nunca recurrente automática.
**Estructura:** flujo a pantalla completa con indicador de pasos y «Atrás».

```
Paso 1  ¿Qué quieres reservar?        cards grandes (icono/color de servicio)
Paso 2  ¿Qué día?                     tira semanal + «ver mes»; días con sesiones marcados
Paso 3  Elige tu sesión               lista:  18:00 · Funcional · Alex · 4 plazas  [Elegir]
                                              19:00 · Pilates · LLENO · [Lista de espera]
Paso 4  Confirma                      resumen + reglas + [Confirmar reserva]
```

- **Paso 3:** cada fila muestra hora, profesional y plazas («quedan 4» / «Lleno»); si no puede reservar, **dice el motivo** («Sin sesiones disponibles este mes») en lenguaje claro (el servidor decide).
- **Paso 4:** lista las sesiones elegidas (el flujo actual admite elegir más de una antes de confirmar; V2 lo mantiene), cuota que se usará (7 → 6), **política de cancelación visible** («Cancelación sin penalización hasta las 08:00» y qué ocurre después de esa hora; el texto lo entrega el backend), y un único CTA `Confirmar reserva`.
- **Éxito:** confirmación con «Añadir al calendario» y volver a Inicio; **error** con causa y salida.
- **Antes y después de reservar:** la política de cancelación se ve en el paso de confirmación, en la pantalla de éxito y en el detalle de la reserva (*PP-10*).
- **Lista de espera:** copy neutro («Te avisamos si se libera una plaza»).
- **Desktop:** misma columna de 640 px.

## 15. Member — Tienda

**Objetivo:** catálogo visual, sin ecommerce (no hay carrito ni pago).

```
Tienda                                  (🔔)
[Todo][Nutrición][Merchandising][Accesorios]    ← pills de categoría

┌[ imagen ]──┐ ┌[ imagen ]──┐
│ Camiseta 2J│ │ Proteína   │
│ 18,00 €    │ │ desde 32,90│
│ Pocas uds. │ │            │
└────────────┘ └────────────┘
```

- **`ProductCard`** grande, 2 columnas en móvil; fotos reales; *fallback* elegante (icono de categoría sobre `surface-subtle`).
- **Detalle** (`BottomSheet`/página): galería (hasta 6, principal primero), nombre, descripción, variantes con precio y disponibilidad (`POCAS UNIDADES` / `AGOTADO` sin cifras), texto «Pídelo en el centro» (**sin checkout**).
- **Compras:** acceso a «Mis compras» desde Perfil.
- **Vacío:** «Aún no hay productos en esta categoría».

## 16. Member — Perfil

**Objetivo:** «mi cuenta» clara, sin complejidad interna.

```
(Avatar)  María Pérez
          Cliente desde mar 2025

┌ Tu plan ────────────────┐   ┌ Tus reservas ───────────┐
│ Trimestral · 3 días/sem │   │ Próximas (2)  Historial │
│ Noviembre: 7 / 13       │   └─────────────────────────┘
│ Vigente hasta 14 ene    │   ┌ Pagos y cuotas ─────────┐
│ Pago: Pagado            │   │ Pendientes (0)          │
│ [Ver mis periodos]      │   └─────────────────────────┘
└─────────────────────────┘
 Mis compras · Documentos y consentimientos · Mensajes y avisos
```

- Secciones como **cards enlazadas** (cada una abre su pantalla/sheet); el plan reutiliza `PlanSummary` con «Ver mis periodos».
- **Identidad ≠ cuota:** sin plan activo el Member **sigue viendo su perfil e historial**; la tarjeta de plan dice «Sin plan activo» y no oculta el resto.
- **Ajustes** (idioma, apariencia, notificaciones, privacidad, seguridad) en su pestaña propia.
- **Oculto:** datos técnicos del plan, estados internos.

---

## Anexo — Decisiones y propuestas que requieren a Juanjo

### Decisiones de diseño — `APPROVED BY PRODUCT OWNER` (2026-10-16)

Decididas por Juanjo el 2026-10-16. **Aprobar una decisión de diseño no significa que esté implementada**: ningún token, hoja de estilos ni componente se ha modificado todavía.

| ID | Decisión | Estado |
|---|---|---|
| DD-01 | Un único verde de marca: `#73b52e`. En la futura implementación se retira el sistema paralelo del Member basado en `#10B981` | APPROVED BY PRODUCT OWNER — NOT IMPLEMENTED |
| DD-02 | Neutros grafito/gris neutro: superficies claras, blanco, gris muy claro, grafito y verde 2J como acento | APPROVED BY PRODUCT OWNER — NOT IMPLEMENTED |
| DD-03 | Escala de radios 6 / 10 / 12 / 16 / 20 / pill | APPROVED BY PRODUCT OWNER — NOT IMPLEMENTED |
| DD-04 | Una única librería de iconos: Lucide; retirada progresiva de los glifos Unicode | APPROVED BY PRODUCT OWNER — NOT IMPLEMENTED |
| DD-05 | Inter autoalojada | APPROVED BY PRODUCT OWNER — NOT IMPLEMENTED |
| DD-06 | Member: tema **claro por defecto**; Sistema / Claro / Oscuro se mantienen como preferencias sobre los mismos tokens; `.hub-theme` no sigue como sistema visual independiente | APPROVED BY PRODUCT OWNER — NOT IMPLEMENTED |
| DD-07 | Profesional: barra lateral grafito + indicador verde en el activo; Admin/Trainer V2.0 en tema claro | APPROVED BY PRODUCT OWNER — NOT IMPLEMENTED |
| DD-08 | `staff-app` se mantiene como experiencia móvil profesional específica, con los patrones y tokens de V2. El shell web profesional sigue siendo responsive y usable en móvil/tablet para operaciones básicas, **sin** sustituir `staff-app` ni buscar paridad completa del backoffice, y **sin** diseñar una segunda navegación profesional móvil incompatible con `staff-app` | APPROVED BY PRODUCT OWNER — NOT IMPLEMENTED |

### Propuestas de producto — estado tras la decisión de 2026-10-16

Leyenda: **APPROVED DIRECTION — NOT IMPLEMENTED** = dirección aprobada, sin implementación ni umbrales/queries definitivos (se concretan en su TASK); **FUTURE** = bien visto, fuera de 2J-098 y de la primera aplicación del Design System; **DEFERRED** = aplazado/opcional; **NOT APPROVED (V1)**. Ninguna se implementa en esta fase. Los agentes no deben tratar una dirección aprobada como una funcionalidad existente.

| ID | Propuesta | Estado | Alcance aprobado |
|---|---|---|---|
| PP-01 | «Requiere atención» | APPROVED DIRECTION — NOT IMPLEMENTED | Señales conceptuales: pago vencido · plan próximo a finalizar · saldo de sesiones agotado · documentación/consentimiento pendiente · sesión futura sin profesional asignado · no-shows repetidos. **Umbrales y consultas, en su TASK** |
| PP-02 | «Vista del cliente» | APPROVED DIRECTION — NOT IMPLEMENTED | Solo lectura, segura, autorizada, **sin impersonación**, sin poder ejecutar acciones como Member. Permite al Admin/Trainer autorizado comprobar qué ve el cliente |
| PP-03 | Eje horario configurable de la agenda | APPROVED DIRECTION — NOT IMPLEMENTED | **A nivel de centro** (p. ej. 06:00–22:00). Sin preferencia individual por profesional en V1. Salida razonable para sesiones fuera del rango |
| PP-04 | Estado del cliente | APPROVED DIRECTION — NOT IMPLEMENTED | **No** un único Activo/Inactivo. Se separan **Cuenta** (la identidad existe siempre), **Plan** (Activo · Vencido · Sin plan · otros estados reales) y **Actividad** (Activo · Sin actividad reciente; definición de «actividad» pendiente). La actividad nunca es autorización; nunca se oculta ni borra la identidad por no tener plan |
| PP-05 | Estado «Planificado» en pagos | NOT APPROVED (V1) — FUTURE / DEFERRED | 2J-098 no genera cargos futuros automáticos; no se introduce un estado cuyo concepto de dominio no existe. Eliminado del target V2 |
| PP-06 | «Requiere atención» como filtro/pestaña/orden en Clientes | APPROVED DIRECTION — NOT IMPLEMENTED | Depende de PP-01. No sustituye siempre el orden normal; se puede volver a Todos / filtros por plan / orden alfabético |
| PP-07 | Trainer entra en «Mis sesiones» | APPROVED DIRECTION — NOT IMPLEMENTED | Por defecto en Resumen/Agenda; con `scope=all` puede cambiar a «Todas». Es filtro/experiencia por defecto, **no frontera de autorización**; el RBAC del backend sigue siendo la autoridad |
| PP-08 | Catálogo de notificaciones editable | FUTURE | Fuera de 098 y de la primera aplicación del Design System |
| PP-09 | Checklist de puesta en marcha / migración desde TIMP | FUTURE | Se diseñará al preparar la migración real del centro |
| PP-10 | «Cancelación sin penalización hasta las 14:00» | APPROVED DIRECTION — NOT IMPLEMENTED | Con 2J-098A implementada, el Member lo ve antes y después de reservar y, pasada la ventana, la consecuencia. **La UI no calcula la política: la entrega el backend** |
| PP-11a | Pivote de agenda por profesional | APPROVED DIRECTION — NOT IMPLEMENTED | Dirección futura (solo vista) |
| PP-11b | Vista de 3 días | DEFERRED / OPTIONAL | No entra en V1; las vistas principales siguen siendo Día y Semana |
