# Home vs portal de socios de 2jfit-admin — mapa de brechas

**Alcance:** comparación de presentación y contratos disponibles, no transferencia de código ni reglas de Base44.
**Base Home:** `2j-platform` `abd31b89ffc2ce64c9fae167f2226267234b2348` (main, 29-10-2026).
**Referencia:** `2jfitnesscenter/2jfit-admin` main `ded5340d8404ed1577a9e4d404554cbef82173b7`.
**Evidencia:** inspección de rutas/componentes y handlers locales. No se ejecutó una sesión autenticada contra datos reales; “API disponible” significa implementada en el código de Platform, no verificada en producción.

Home conserva cinco pestañas principales: **Inicio, Búnker, Tienda, Perfil y Ajustes**. Reservas y Evolución son vistas internas; no se añade una sexta pestaña. Se conserva el diseño aprobado grafito + lima #A4D65E. El modo de demo contiene fixtures sintéticos y no equivale a operaciones reales.

| Portal socio 2jfit-admin | Estado en Home | Real vs. prototipo | API de Platform disponible hoy | Brecha / decisión |
|---|---|---|---|---|
| Inicio | HAVE | Código real; demo usa fixtures | `GET /api/me`, `/api/me/membership`, `/api/me/bookings`, `/api/me/news` | Noticias, resumen de cuota y próxima reserva ya están representados. |
| Reservas | HAVE / DIFFERENT | Código real; resultados reales requieren sesión/API | `GET /api/me/sessions`, `/api/me/booking-services`, `/api/me/bookings`, detalle, cancelación-preview; `POST` reserva/lista de espera y `PATCH` cancelaciones | Próximas e Historial y confirmación/cancelación existen. La elegibilidad en tarjeta está en el borrador Home #116; no duplicar ni considerar fusionado. Sin posición en cola, acorde a decisiones. |
| Evolución | MISSING | Hay pantalla de entrada/placeholder real; sin datos de evolución simulados | `GET /api/me/training-summary` es resumen/capacidades, no mediciones ni evaluaciones | No existe contrato miembro publicado para mediciones/evolución. Esperar el contrato de Platform; no reutilizar summary como historial ni exponer datos de salud (D33). |
| Búnker | HAVE / PARTIAL | Integración real condicionada por flags, sesión/vinculación y SSO; demo es visual | `GET /api/me/training-summary`, `/api/me/membership`, `POST /api/me/training/sso`; flujos de vínculo/revisión | La entrada está integrada en la pestaña aprobada. La ejecución depende de configuración y vínculo; no autenticar ni conceder derechos desde Home. |
| Facturas | MISSING (bloqueado) | No implementado en Home | No hay API miembro de facturas | No construir hasta abrir el gate fiscal (D106). La pantalla de referencia no prevalece sobre Platform ni las decisiones. |
| Tienda | HAVE / DIFFERENT | Catálogo real; demo usa fixtures; compra online no se simula como real | `GET /api/me/store/catalog`, `GET /api/me/store/purchases` | Catálogo, variantes/stock y estados existen. El historial de compras se presenta en Perfil/Tickets, no dentro de Tienda; no falta el dato ni debe duplicarse. |
| Perfil | PARTIAL | Perfil y apartados reales; demo sintética | `GET /api/me`, `/api/me/membership`, compras, asignaciones de formularios y consentimientos | Consulta de datos, cuotas, reservas, compras, buzón y documentos. No se encontró edición general de datos personales ni endpoint miembro de actualización; requiere contrato/autorización de Platform antes de construir. |
| Ajustes | HAVE / PARTIAL | Preferencias reales cuando API/config está habilitada; demo local | `GET/PATCH /api/me/preferences`; API cliente push/suscripciones y preferencias | Apariencia/preferencias y controles disponibles. Push depende de configuración/consentimiento; no afirmar entrega de notificaciones push sin suscripción y servicio habilitados. |
| Cuota | PARTIAL | Resumen real del membership; presentación de pago en Draft #126 | `GET /api/me/membership` (estado, cargos/pagos y derechos calculados por Platform) | Home muestra cuotas/saldos, pero no tiene pestaña adicional ni flujo separado. La UI de estado de pago está en PR #126, aún sin integrar; no reimplementarla aquí. Plataforma calcula bloqueo y derechos. |

## Trabajo que sí puede avanzar sin solapar código

1. **Evolución:** cuando Platform publique el contrato versionado y permisos/consentimiento, implementar la pantalla de lectura en Home. Ahora no hay endpoint compatible.
2. **Perfil — edición:** pedir/consumir un contrato de actualización explícito de Platform antes de habilitar escritura. La lectura existente no autoriza escritura.
3. **Factura:** mantener fuera hasta autorización del gate fiscal D106.
4. **No iniciar ahora:** cuotas/estado de pago (#126), elegibilidad de espera (#116) ni historial de compras; están cubiertos por la pantalla existente o por PRs ya abiertos.

## Revisión independiente previa a integración

La elegibilidad de sesiones es una dependencia de Reservas cuya rama ajena a Home está disponible localmente como `origin/agent/codex/2J-D185-session-eligibility`. Revisión independiente publicada en #80 contra el SHA 9abb0cab982ea967e44232a6e4a0141c43f0c0bb: en un worktree desechable, API focalizada 9/9 PASS sobre PostgreSQL sintético. Hallazgo previo a merge: la rama cambia availability de objeto {status, reason, canJoinWaitlist} (contrato #110, ya integrado) a string, incompatible con Home #116; GitHub la marca mergeable=false. Comentarios publicados en la PR antes de integrar. El resultado aislado no valida compatibilidad con main.

## Fuentes inspeccionadas

- Home: `apps/client-app/src/client-app.tsx`, `apps/client-app/src/member-integrations.ts`.
- Contratos: `apps/api/src/client-app.ts`, `apps/api/src/store.ts`, `apps/api/src/center-news.ts`.
- Portal de referencia: `src/App.jsx`, `src/components/layout/MemberShell.jsx` y `src/pages/member/Member{Home,Bookings,Membership,Invoices,Store,Profile,Settings,Evolution}.jsx` en el main de `2jfit-admin`.
- Decisiones aplicadas: Platform manda; no copiar backend/lógica del portal de referencia; D33 limita salud; D106 mantiene cerrado facturación; navegación de Home conserva cinco secciones.
