# Handoff — 2J-DESIGN-V2-PILOT-02 (Clientes + Cliente 360)

Segundo piloto del Design System V2: **gestión real**, no una demo. Se migra solo la presentación de Clientes y Cliente 360; la lógica, los endpoints y las capacidades son los de antes.

- Estado: Draft. `VISUAL_APPROVED=no` y `FUNCTIONAL_APPROVED=no` hasta que Juanjo pruebe el piloto. Que pase CI no marca ninguno.
- Guion para el propietario: [`2J-DESIGN-V2-PILOT-02-manual-test.md`](2J-DESIGN-V2-PILOT-02-manual-test.md).
- Parte de PILOT-01 ([handoff](2J-DESIGN-V2-PILOT-01.md)); reutiliza `Button`, `Card`, `StatusChip`, `PageHeader`, `Icon`.

## Qué cambia

| Pieza | Dónde |
|---|---|
| Lista de Clientes y Cliente 360 (presentación) | `apps/admin-web/src/clients-page.tsx` (lógica y *handlers* intactos; solo cambia el JSX y la navegación) |
| Mapeos de presentación (estados, copy, etiquetas) | `apps/admin-web/src/client-presenters.tsx` |
| Estilos | `apps/admin-web/src/clients-v2.css` (se eliminan 128 líneas del CSS antiguo de clientes en `styles.css`) |
| Componentes nuevos en `@2j/ui` | `Tabs`, `SearchField`, `SegmentedControl`, `EmptyState`, variantes `danger` / `danger-solid` de `Button`, estilos de modal y de campos de formulario (`ui-modal*`) |

Alcance de los tokens V2: igual que PILOT-01 (`data-2j-design="v2"`), ahora también en `<main>` de Clientes.

## Cómo se ve ahora cada cosa

- **Lista:** `PageHeader` + «Nuevo cliente» (solo con permiso de gestión) + buscador + filtro Activos/Archivados. Cada fila: iniciales, nombre, «Cliente desde», chip *Archivado* solo si lo está, sin botones repetidos. Abrir un cliente es un enlace (`#clients?clientId=…`), accesible con teclado y en nueva pestaña.
- **Cliente 360 = página** (no un panel junto a la lista): «← Todos los clientes», cabecera con avatar, nombre, «Cliente desde», chip del plan y acciones por peso, datos clave, pestañas y contenido. Volver conserva búsqueda y filtro. La pestaña seleccionada va en la URL (`&tab=`), así que recargar vuelve al mismo sitio.
- **Estado del cliente (PP-04):** no hay un «Activo/Inactivo» global. La cuenta solo muestra *Archivado* cuando lo está; el **plan** se muestra aparte (*Plan activo / Plan en pausa / Plan programado / Bono agotado / Plan vencido / Sin plan*) y solo si el perfil trae los planes. **Actividad** no se muestra: no hay fuente real.
- **Acciones del Cliente 360, auditadas y clasificadas:**

| Acción | Peso | Permiso (sin cambios) |
|---|---|---|
| Añadir cuota | PRIMARY | `assignPlans` y cliente activo |
| Editar datos | SECONDARY | `manage` |
| Archivar | DANGER (confirmación con consecuencias; botón final relleno rojo) | `manage` y cliente activo |
| Renovar, Pausar, Reanudar, Ajustar saldo | SECONDARY | `renewEntitlements`, `pauseEntitlements`, `adjustEntitlements` |
| Cambiar plan, Ver movimientos | TERTIARY (ghost) | `assignPlans`, `readEntitlements` |
| Cancelar (plan) | DANGER (motivo obligatorio, consecuencia explícita, botón final relleno rojo) | `cancelEntitlements` |
| Aprobar / Rechazar revisión; Registrar consentimiento asistido | SECONDARY / DANGER | las que ya devolvía el servidor |

## Datos reales y divergencias respecto al blueprint

- **Pestañas:** solo las que el servidor entrega y el usuario puede ver: Resumen · Reservas · **Plan y sesiones** (antes «Cuotas») · **Pagos** (antes «Cuotas y pagos») · Documentos · Mensajes · Seguimiento · Historial.
- **No hay pestaña «Datos»:** el producto minimiza deliberadamente el correo y el teléfono en pantalla (hay un test que lo exige); se ven y editan en «Editar datos».
- **No hay «Compras», notas internas, «Vista del cliente» (PP-02) ni «Requiere atención» en la lista (PP-01/PP-06):** no existen en el backend o no hay señal real en la lista. Sin botones muertos.
- **Datos clave de la cabecera:** *Próxima reserva*, *Sesiones disponibles* (suma de saldos del bono activo) y *Pago* (vencidos / pendiente / al día). Cada uno aparece **solo** si el dato existe; si no, no hay hueco.
- **Resumen:** próximas reservas, plan actual, actividad reciente (historial real) y «Requiere atención» **solo** con señales reales ya devueltas (cargos vencidos, lista de espera, mensajes sin leer). No es el motor PP-01.
- **Lista:** el API de la lista solo trae nombre, estado y alta. No se añadieron consultas, así que no hay columnas de plan, sesiones, próxima reserva ni entrenador asignado.
- **Plan y sesiones:** se muestran los datos actuales (plan, vigencia, saldo, sesiones). No se simulan periodos mensuales independientes (2J-098E no existe). No se expone vocabulario interno (*derechos, entitlement, ledger, grant, snapshot*): se reescribieron los textos de los diálogos de venta y de movimientos que lo hacían.
- **Pagos:** estados reales *Pendiente / Vencido / Pagado* (más *Devuelto / Exento / Anulado* que ya existían). Sin «Planificado» (PP-05 sigue FUTURE / DEFERRED).
- **Reservas:** solo lectura, como antes (el Cliente 360 nunca permitió reservar ni cancelar). La lista de espera se muestra aparte.

## Permisos

No se tocó RBAC ni el servidor. Admin y Trainer comparten shell; cada botón, pestaña y dato aparece solo si el servidor lo concede (`capabilities` del perfil y `access` de cada sección). Tests nuevos: el Trainer de solo lectura no ve acciones de escritura, Pagos ni importes, y conserva «Ver movimientos». Comprobado en el piloto real (Admin :5174 y Trainer :5175).

## Cosas a vigilar

- **Vite en Windows:** al arrancar el piloto con caché fría puede salir una pantalla en blanco (`EPERM` al renombrar `node_modules/.vite`). Detener y volver a ejecutar `pnpm owner:review` lo resuelve. Ya ocurría antes; no es de este PR.
- Los formularios de los diálogos reutilizan los mismos campos y validaciones; solo cambia el aspecto (`ui-modal`).

## Verificación

typecheck, build y tests de `design-tokens`, `ui`, `admin-web`, `client-app` y `staff-app` en verde; se actualizaron los tests de Clientes (enlaces en lugar de botones, copy nuevo, la ficha es una página) y se añadieron 10 de permisos, estados y copy y 5 de componentes. Revisado en navegador a 1440, 1024, 768 y 390 px con Admin y Trainer.

## Revisión tras la prueba del propietario (fixes y matices)

### 1. Bug: «Motivo del ajuste de precio» exigido sin cambiar el precio — corregido
- **Causa raíz:** `GET /api/plans/assignable` devuelve `basePriceCents` como **cadena** (`"5000"`; PostgreSQL `bigint`), aunque el tipo del cliente lo declaraba `number`. El formulario mostraba bien `50.00` (la división `"5000"/100` fuerza el número), pero la comparación `euroToCents("50.00") !== plan.basePriceCents` era `5000 !== "5000"` → siempre «hay ajuste». El mismo fallo estaba en la validación al guardar. No era un problema de decimales ni de flotantes.
- **Medido con el plan «3 dias» del piloto:** `basePriceCents="5000"` (string) · `planPrice="50.00"` · `euroToCents("50.00")=5000` (entero).
- **Fix (solo frontend, sin cambiar API):** el catálogo asignable se normaliza al recibirlo con `toIntegerCents` y todas las comparaciones son entre **céntimos enteros**. Sin tocar el contrato, la base de datos ni el cálculo de precios. El que la API serialice un `bigint` como texto es un detalle preexistente del backend; queda anotado, no se ha cambiado.
- **Tests de regresión** (`apps/admin-web/test/clients-pricing.test.mjs`): 5000 / "50.00" → sin campo de motivo y se guarda sin `adjustmentReason` (con base como string —forma real— y como número); 5000 / "45.00" → campo presente, obligatorio, y se envía; 49,99 → 50,00 lo quita de nuevo; sin permiso de precio, solo lectura y sin motivo. Se comprobó que el test con el valor real falla sin el fix.
- Observación no tocada: un plan con precio base 0 € (p. ej. el *Bono piloto*) no puede venderse desde este formulario porque el importe debe ser mayor que cero (validación preexistente).

### 2. Cuota «indefinida» (legacy)
- **Confirmado:** el plan recurrente «3 dias» se asigna con `startsOn=2026-10-16` y `endsOn=null`. «Inicio / Fin (opcional)» pertenece al modelo legacy; no se calcula vigencia ni se inventa una fecha final en el frontend.
- La venta de planes recurrentes muestra una nota neutra: *«La duración definitiva del plan se aplicará con el nuevo modelo de cuotas. Esta asignación usa actualmente el comportamiento legacy.»* Cuando 2J-098E esté implementado hay que retirar la nota (está en `clients-page.tsx`, `data-testid="legacy-duration-note"`).

### 3. Las sesiones no aparecen tras asignar «3 dias» — confirmado, no es un bug de la UI
La asignación creada devuelve exactamente un derecho:

| rightType | quantity | period | quotaScope | balance |
|---|---|---|---|---|
| `service_access` (Fuerza funcional) | null | null | null | 0 |

No existe ningún derecho `sessions_quota` ni `period_quota`: el plan legacy «3 dias» solo da **acceso** al servicio; «3 días/semana» no está modelado como derecho. La UI muestra sesiones solo si `rightType === sessions_quota` **y** `balance != null` (p. ej. el Bono piloto: `quantity=12`, `balance=12`), y por eso no hay ninguna cifra. **No se fabrica saldo ni se calcula «13 sesiones» en React**: ese cálculo (bolsa del periodo) es de 2J-098E. Tests: con `balance=null` o solo acceso no aparece «Sesiones disponibles» ni «restantes»; con un saldo real sí.

### 4. Estado real de los flujos (matiz del PASS anterior)

```
PLAN_ASSIGNMENT_LEGACY_FLOW=PASS           # asignar, cobrar o dejar pendiente, pausar, reanudar, cancelar, renovar, cambiar, ajustar saldo de bonos
2J098E_PERIOD_ENTITLEMENTS=NOT_IMPLEMENTED
SESSION_BAG_DISPLAY=NOT_AVAILABLE          # no hay bolsa de periodo; solo saldo legacy de bonos de sesiones
```

El «PASS» de PILOT-02 se refiere a la **operativa legacy** conservada; la experiencia aprobada final de planes y sesiones **no está** y no debe darse por existente.

### 5. Capacidades pendientes (todas de 2J-098E)
- Cálculo automático de vigencia (natural-mes = periodo cerrado; contratos largos = duración contractual calculada).
- Periodos de derecho mensuales independientes.
- Generación de bolsas de periodo en backend (frecuencia semanal ≠ límite semanal; p. ej. nov-2026: `ROUND_HALF_UP(21 × 3 / 5) = 13`), congeladas y sin *rollover*.
- Apunte de concesión (*ledger grant*) y saldo del periodo; consumo por fecha de la sesión y restauración al mismo periodo.
- Expiración de periodos.
- Renovación iniciada por el staff (sin renovación automática).
- Retirar la nota de duración legacy y mostrar «Vigente hasta…» / «Sesiones de noviembre 7/13» cuando el backend los entregue.
