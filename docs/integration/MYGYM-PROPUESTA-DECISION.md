# Propuesta de decisión: «Mi gimnasio» (MyGym)

Estado: **el propietario ha elegido la opción A (panel de resultados de solo lectura) el 25 oct 2026.** Pregunta 2 respondida: la diferencia de caja se ve solo para el propietario. Pendiente: su respuesta a la pregunta 3 (indicadores que faltan) y la asignación de número de decisión. **No se implementa nada hasta cerrar eso y la revisión de Work Platform.**
Origen: pantalla `MyGym` del prototipo Base44 (`2j-fitness-admin`, commit `73c58b5`). Referencia: `docs/integration/BASE44-PROTOTYPE-MAPPING.md` (#95).

## 1. Aviso importante: lo que el prototipo llama «Mi gimnasio» no es un panel de resultados

Leído el código (`src/pages/MyGym.jsx`, 381 líneas), la pantalla del prototipo es un **centro de ajustes** con tres pestañas:

1. **Datos del negocio:** nombre, razón social, contacto, dirección, CIF, logotipo, colores.
2. **Novedades:** publicar avisos.
3. **Consentimientos:** formularios y versiones.

No muestra cifras ni indicadores. El propietario ha descrito «MyGym» como un panel para él. Por eso se plantean dos opciones; se pide elegir una (o las dos, en este orden).

## 2. Opción A (recomendada): panel del propietario, solo lectura

Una pantalla de entrada para el propietario que responde, de un vistazo, a «¿cómo va el centro hoy?». Solo lee datos que Platform ya tiene; no crea reglas ni escribe nada.

| Bloque | Qué muestra | De dónde sale (ya existe) |
|---|---|---|
| Hoy | Clases del día y ocupación (reservados/plazas), listas de espera abiertas | `calendar_sessions`, `calendar_reservations`, `calendar_waitlist_entries` |
| Clientes | Con cuota vigente, sin cuota, nuevos del mes | `clients`, `client_plan_assignments` |
| Cobros | Importe pendiente y nº de cobros vencidos; pagos por comprobar | `economic_charges`, `economic_transactions`, `economic_transfer_proofs` |
| Caja | ¿Hay turno abierto? Quién lo abrió. Último cierre y su diferencia (solo propietario) | `economic_cash_sessions` |
| Personal | Quién ha fichado ahora | `staff_timeclock_events` |
| Por revisar | Vinculaciones de Búnker pendientes, documentos pendientes | `training_link_review_cases`, `document_requirements` |
| Tienda | Variantes con poco stock | `store_product_variants`, `store_inventory_movements` |

**Qué no muestra:** ningún dato de salud, ninguna nota interna, ningún dato personal más allá del nombre cuando hace falta, nada de mensajes. No tiene gráficos de ingresos (D108: el panel económico es un listado simple, sin gráficos).

**Permiso:** uno nuevo, `owner.panel.read`, concedido solo al perfil de administración. El resto de perfiles (entrenador, recepción, contabilidad) no lo tienen, aunque tengan acceso a alguno de los bloques en sus propias pantallas. Cada bloque comprueba además su permiso de origen (por ejemplo, el bloque de caja exige `billing.cash.manage` o lectura económica), de modo que dar el permiso a otro perfil en el futuro no abriría datos que ese perfil no puede ver hoy.

**Dónde vive:** `apps/admin-web`, como pantalla propia enlazada desde el menú, usando un único endpoint de lectura `GET /api/admin/owner-panel` que devuelve contadores agregados (no listas de personas). Sin migraciones.

**Relación con lo que ya existe:** el centro de mando (`command-center.tsx`, `/api/dashboard`) ya muestra parte de esto para el personal. MyGym sería la vista del propietario con el bloque de caja y economía, que el centro de mando no muestra a todos. Antes de implementar habría que comparar ambos para no duplicar tarjetas; si resulta que el centro de mando cubre casi todo, la propuesta se reduciría a añadir una vista «propietario» al centro de mando existente en lugar de una pantalla nueva.

**Esfuerzo estimado:** 5–8 días (endpoint de agregados con tests, pantalla, permiso y pruebas de que otros perfiles reciben 403).

## 3. Opción B: centro de ajustes (lo que hace el prototipo)

Agrupar en una pantalla «Mi gimnasio» lo que hoy está repartido: datos del negocio, novedades, consentimientos, día de pago y avisos.

- **Ya existe:** novedades (`news-page.tsx`, `center_news`, D67), ajustes de notificaciones (`notification-settings.tsx`), día de pago (`economic_settings`).
- **Falta:** datos del negocio editables (razón social, CIF, contacto, logotipo) y la gestión de formularios y consentimientos en una sola pantalla. Los datos fiscales están detrás de la puerta fiscal cerrada (`fiscal_legal_gate_open=false`) y requieren validación fiscal antes de usarse en documentos (D106).
- **Permisos:** `settings.manage` ya existe y solo lo tiene administración.
- **Esfuerzo estimado:** 6–10 días, con riesgo en consentimientos si se tocan los de salud (D16–D23, D33 pendiente de asesoría jurídica); recomiendo dejar fuera cualquier consentimiento de salud.

## 4. Lo que se pide al propietario

1. ¿Qué entiende por MyGym: **A (panel de resultados)**, **B (ajustes)** o ambas, y en qué orden?
2. Si A: ¿quiere el bloque de **caja con diferencias** visible solo para él, como propone el texto (coherente con D111 y D110)?
3. ¿Hay algún indicador imprescindible que no esté en la tabla de la opción A?
4. Si B: ¿se deja fuera todo lo de salud y fiscal hasta cerrar D33 y la validación fiscal?
5. Logotipos y colores del prototipo: ya confirmado que pueden reutilizarse; se aplicarán a través del sistema de diseño de Platform, no copiando el CSS del prototipo.

## 5. Siguiente paso

Respuesta del propietario → la propuesta pasa a decisión numerada en el registro (D275 o la que corresponda) → Work Platform revisa → implementación en un PR aparte, pequeño y con tests. Mientras tanto: nada que implementar.
