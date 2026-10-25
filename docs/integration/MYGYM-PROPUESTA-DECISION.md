# Propuesta de decisión: «Mi gimnasio» (MyGym)

Estado: **el propietario ha elegido la opción A (panel de resultados de solo lectura) el 25 oct 2026.** Respuestas recibidas: pregunta 2 (la diferencia de caja la ve solo el propietario) y pregunta 3 («añadir todo lo estándar en apps de gestión de gimnasios», recogido en §2). **Fase 2 aceptada por el propietario con los valores por defecto propuestos** (umbrales de ocupación baja y stock bajo, semanas sin asistencia y definición de baja, tal como están en §2.3–§2.4 y §4). Pendiente: asignación de número de decisión, revisión de Work Platform (la aclaración de la sección 7 ya está resuelta). **No se implementa nada hasta cerrar eso.** Solo documento: sin código ni migraciones.
Origen: pantalla `MyGym` del prototipo Base44 (`2j-fitness-admin`, commit `73c58b5`). Referencia: `docs/integration/BASE44-PROTOTYPE-MAPPING.md` (#95).

## 1. Aviso importante: lo que el prototipo llama «Mi gimnasio» no es un panel de resultados

Leído el código (`src/pages/MyGym.jsx`, 381 líneas), la pantalla del prototipo es un **centro de ajustes** con tres pestañas: datos del negocio, novedades y consentimientos. No muestra cifras. El propietario la entiende como un panel para él; por eso la opción elegida (A) es un diseño nuevo de Platform inspirado en la idea, no una adopción del prototipo. La opción B (ajustes) se describe en §5 solo como alternativa descartada por ahora.

## 2. Opción A: panel del propietario, solo lectura

Una pantalla de entrada para el propietario que responde a «¿cómo va el centro?» agrupada en **HOY**, **ESTA SEMANA** y **ESTE MES**. Solo lee datos que Platform ya tiene; no escribe nada ni crea reglas.

### 2.1 Reglas comunes

- **Permiso único: `owner.panel.read`.** Concedido solo al perfil de administración (que ya tiene `*`). Ningún otro perfil lo recibe, y el endpoint no depende de otros permisos de lectura: quien lo tiene ve el panel completo. Consecuencia a tener presente: si hubiera varias cuentas con perfil de administración, todas ven el panel (incluida la diferencia de caja). Nunca debe concederse a entrenadores, recepción o contabilidad.
- **Solo agregados.** Cada tarjeta muestra contadores e importes. Las listas (máximo 10 filas) muestran nombre y motivo, nunca teléfono, correo, DNI ni dirección, y enlazan a la ficha, que aplica sus propios permisos.
- **Sin datos de salud, notas internas ni mensajes.** Ningún indicador usa `health`, evaluaciones, mediciones, notas ni cuerpo de mensajes.
- **Importes y fechas** en euros y hora de Canarias; los importes cobrados, netos de devoluciones.
- **Sin gráficos** (coherente con D108): cifras y comparativas en tabla.
- **Fase 1** = agregación directa de tablas que ya existen (un endpoint nuevo, sin migración). **Fase 2** = requiere una definición de negocio, una regla nueva o un dato que hoy no se guarda.

### 2.2 HOY

| # | Indicador | Fuente en Platform | Fase | Notas |
|---|---|---|---|---|
| H1 | Ocupación de clases de hoy (reservas/plazas, por clase) | `calendar_sessions`, `calendar_reservations` | 1 | Solapa con el centro de mando |
| H2 | Quién ha fichado ahora | `staff_timeclock_events` (y `staff_timeclock_corrections`) | 1 | Solapa con «Equipo ahora» |
| H3 | Estado de la caja y **diferencia** (solo propietario) | `economic_cash_sessions` (`status`, `expected_cents`, `counted_cents`, `difference_cents`, `close_kind`) | 1 | No está en el centro de mando. Tras D97/D111 se añadirá el estado de validación (fase 2) |
| H4 | Cobros pendientes (importe y nº vencidos) | `economic_charges`, `economic_transactions` | 1 | Solapa con «Pendiente de cobro» |
| H5 | Clientes con cuota vencida o bloqueada | `economic_charges`, `client_plan_assignments`, módulo `term-payment-access` (regla día 10 / bloqueo día 11 00:00) | 1 | Reutilizar la lógica de acceso por pago, no reimplementarla; contar «vencida» y «bloqueada» por separado. Solapa en parte con el aviso «Vencido» |
| H6 | Lista de espera activa (nº de esperas y clases afectadas) | `calendar_waitlist_entries` | 1 | Solapa con el aviso «Lista de espera» |
| H7 | Alertas de equipo (fichajes por cerrar, ausencias y sesiones sin cubrir) | `staff_timeclock_events`, `staff_exceptions`, `staff_substitutions`, `calendar_sessions` | 1 | Solapa con avisos «Por cerrar», «Sesiones afectadas», «Sin asignar» |
| H8 | Pendientes de revisión: documentos, transferencias, consentimientos | `document_requirements`, `economic_transfer_proofs`, `client_consents` | 1 | Solapa con avisos «Validar» y «Revisar» |
| H9 | Pendientes de revisión: vinculaciones de Búnker | `training_link_review_cases` | 1 | El centro de mando no lo muestra (por confirmar al implementar) |

### 2.3 ESTA SEMANA

| # | Indicador | Fuente en Platform | Fase | Notas |
|---|---|---|---|---|
| S1 | Cuotas que vencen en los próximos días | `client_plan_assignments` (`ends_on`), `assignment_entitlement_periods`, `economic_charges` (`due_on`) | 1 | Ventana de 7 días; solo recuento y lista corta |
| S2 | Clases con muy pocas reservas y clases llenas con lista de espera | `calendar_sessions`, `calendar_reservations`, `calendar_waitlist_entries` | 1 con umbrales fijos; 2 si se quieren configurables | Umbral propuesto por defecto: menos del 25 % de ocupación a menos de 24 h; configuración por servicio sería fase 2 |
| S3 | Ausencias (no-show) y clientes con 2 o más seguidas | `calendar_reservations` (estado `no_show`) | 2 | Requiere una consulta de rachas por cliente; relación con D78 (3.ª ausencia consecutiva cancela reservas, no implementada) |
| S4 | Clientes sin asistencia en 2–3 semanas (riesgo de baja) | `calendar_reservations` (asistidas), `client_plan_assignments` (cuota vigente) | 2 | Solo clientes con cuota vigente; definir «asistencia» y las semanas (2 o 3) |
| S5 | Stock bajo de tienda | `store_product_variants`, `store_inventory_movements` | 1 | Umbral por variante a definir; por defecto, sin existencias o menos de 3 |
| S6 | Ventas semanales de tienda | `store_sales`, `store_sale_lines` | 1 | Cobradas y no anuladas; por método de pago cuando la caja de #97 esté fusionada |

### 2.4 ESTE MES

| # | Indicador | Fuente en Platform | Fase | Notas |
|---|---|---|---|---|
| M1 | Altas nuevas | `clients` (`created_at`) | 1 | Ya hay «altas en 30 días» en el centro de mando |
| M2 | Bajas (cuotas finalizadas sin renovación) | `client_plan_assignment_events`, `client_plan_assignments` | 2 | Falta definir «baja» (D158 es baja definitiva de cuenta; D270–D272 baja de contrato) |
| M3 | Retención | `client_plan_assignments` por mes | 2 | Propuesta: % de clientes con cuota el mes anterior que la tienen este mes |
| M4 | Ingresos frente al mes anterior: por cuota, por tienda y por método de pago | `economic_transactions` y `economic_payment_splits` (método), `economic_charges` y `client_plan_assignments` (cuota), `store_sales` (tienda) | 1 | Cobrado neto de devoluciones; sin impuestos desglosados (el desglose fiscal queda tras la puerta fiscal) |
| M5 | Ocupación media por franja horaria y servicio | `calendar_sessions`, `calendar_reservations`, `services` | 1 | Tabla servicio × franja |
| M6 | Horas fichadas por entrenador | `staff_timeclock_events`, `staff_timeclock_corrections` | 2 | Emparejar entradas/salidas con correcciones; los fichajes incompletos se muestran aparte y nunca se inventa la hora (D123) |
| M7 | Clientes de Búnker activos | `training_account_links`, `platform_training_access_events` | 1 (vinculados con acceso vigente) | «Activo» por uso real exigiría datos de Búnker, que no son de Platform; no se propone |

### 2.5 Solapes con el centro de mando actual y cómo evitar duplicados

El centro de mando (`command-center.tsx`, `GET /api/dashboard/command-center`) ya muestra: **Reservas hoy**, **Ocupación hoy**, **Pendiente de cobro** (con cargos vencidos), **Clientes activos** (con altas de 30 días), la tarjeta **Requiere atención** (vencidos, sesión sin asignar, fichaje por cerrar, sesiones por ausencia, lista de espera, seguimiento, transferencias por validar, documentos y consentimientos por revisar), **Próximas sesiones** y **Equipo ahora**.

| Indicador MyGym | Solape | Decisión propuesta |
|---|---|---|
| H1, H4, H6, H7, H8, M1 | Mismos datos que el centro de mando | Reutilizar las mismas funciones de servidor para que las cifras coincidan; en MyGym solo un contador que enlaza al Resumen, sin repetir la lista |
| H2 | «Equipo ahora» | Un contador y enlace |
| H3, H5, H9, S1–S6, M2–M7 | No están en el centro de mando | Contenido propio de MyGym |

Para no tener dos pantallas casi iguales: el Resumen sigue siendo la pantalla operativa de todo el personal; MyGym es la vista del propietario y se limita a (a) lo que el Resumen no muestra y (b) contadores de lo que sí, con enlace. Si al implementar se comprueba que el solape es mayor de lo previsto, la alternativa es añadir una pestaña «Propietario» al Resumen en lugar de una pantalla nueva.

### 2.6 Esfuerzo y fases

- **Fase 1** (H1–H9, S1, S2 con umbrales fijos, S5, S6, M1, M4, M5, M7): un endpoint de agregados con tests de permiso (otros perfiles reciben 403), la pantalla y el permiso. Sin migraciones. **~8–12 días.**
- **Fase 2** (S3, S4, M2, M3, M6 y umbrales configurables): requiere definiciones del propietario (qué es «baja», cuántas semanas sin asistencia, umbrales) y consultas nuevas. **~8–12 días** más.
- La caja (H3) y las ventas por método (S6) dependen de que #97 esté fusionado; D97/D111 se incorporan después.

## 3. Datos que no se usarán nunca en este panel

Salud, mediciones, evaluaciones, notas internas, cuerpo de mensajes, documentos y contenido de consentimientos, datos de contacto y datos fiscales de personas.

## 4. Lo que se pide al propietario

1. Confirmar que acepta el reparto en fases (§2.6) y que la Fase 1 sale primero.
2. Definir para la fase 2: qué cuenta como «baja», cuántas semanas sin asistencia marcan riesgo (2 o 3) y los umbrales de ocupación baja y stock bajo (o aceptar los valores por defecto propuestos).
3. Confirmar que, mientras haya más de una cuenta de administración, todas pueden ver la diferencia de caja (o pedir un perfil «propietario» separado).
4. Logotipos y colores del prototipo: ya confirmado que pueden reutilizarse; se aplicarán a través del sistema de diseño de Platform, no copiando el CSS.

## 5. Opción B (descartada por ahora): centro de ajustes

Agrupar datos del negocio, novedades, consentimientos, día de pago y avisos en una pantalla. Ya existen novedades (`news-page.tsx`, D67), ajustes de notificaciones y día de pago (`economic_settings`); faltarían datos del negocio editables y la gestión de formularios (con la puerta fiscal cerrada y D33 pendiente para salud). ~6–10 días. Se retoma si el propietario lo pide.

## 6. Siguiente paso

Respuestas a §4 → número de decisión en el registro → revisión de Work Platform → implementación de la Fase 1 en un PR aparte, pequeño y con tests. Mientras tanto: nada que implementar.

## 7. Aclaración resuelta: la lista de paridad visual

**Decidido por el propietario:** `/mi-gimnasio` tendrá **cuatro pestañas**: Panel (opción A) primero y después Datos del negocio, Novedades y Consentimientos.


La lista del propietario (`PARIDAD-VISUAL-BASE44.md`, A46–A50) define `/mi-gimnasio` con las tres pestañas del prototipo (Datos del negocio / Novedades / Consentimientos) y remite a este documento «opción A». Son dos cosas distintas (ver §1 y §5). Propuesta aceptada: `/mi-gimnasio` tiene **cuatro pestañas**, la primera **«Panel»** (la opción A de este documento, solo con `owner.panel.read`) y después las tres del prototipo. Las tres pestañas de ajustes reutilizan lo que ya existe en Platform (novedades, ajustes) y no incluyen consentimientos de salud ni datos fiscales hasta cerrar D33 y la validación fiscal.
