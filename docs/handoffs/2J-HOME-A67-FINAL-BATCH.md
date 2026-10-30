# 2J Home — A67 lote final

## Alcance

Este cambio conecta «Mis facturas» del Perfil con las rutas de socio ya presentes en Platform `main`. No crea facturas, no modifica importes y no usa rutas internas de economía.

## Contratos verificados en Platform `main`

- `GET /api/me/invoices` devuelve `{ items }` con documentos propiedad de la sesión; respuestas `private, no-store`.
- `GET /api/me/invoices/:invoiceId/pdf?variant=a4|ticket` valida sesión y pertenencia; un documento ajeno responde como no encontrado. El PDF también usa `private, no-store` y `nosniff`.
- Facturas: Perfil lista número, fecha, tipo, estado e importe que Platform ya calculó. La descarga requiere sesión y valida `application/pdf`; usa nombre de archivo seguro y no almacena el documento en caché.
- El modo demo sigue mostrando `DEMO · DATOS FICTICIOS`, no llama a facturas y no ofrece descarga real.

## Revisión de las cinco secciones

| Sección | Contratos de Platform que consume Home | Estado verificado |
| --- | --- | --- |
| Inicio | `/api/me`, `/api/me/membership`, `/api/me/bookings`, `/api/me/news` | Datos reales de perfil, derechos, reservas y noticias; estados vacíos cuando no hay resultados. |
| Búnker | `/api/me/membership`, `/api/me/training-summary` y contratos de enlace/SSO | Capacidades y elegibilidad proceden de Platform. El resumen muestra datos agregados si está disponible y bloquea/oculta datos si Platform devuelve estado no autorizado; el salto SSO se prueba por E2E. |
| Tienda | `/api/me/store/catalog`, `/api/me/store/purchases` | Catálogo e historial son lecturas reales; compra/pago desde Home no se simula como operación real. |
| Perfil | `/api/me`, `/api/me/membership`, `/api/me/bookings`, `/api/me/store/purchases`, `/api/me/invoices`, PDF autenticado; documentos, mensajes y avisos con rutas de socio | Perfil personal sigue de solo lectura por D238/D239. «Mis facturas» lista y PDF ya conectados. Compras, reservas y documentos tienen estados vacíos. |
| Ajustes | `/api/me/preferences` y endpoints de suscripción/consentimiento push | Preferencias y gestión de notificaciones usan sesión de socio; la demo no escribe. |

Mi evolución usa `GET /api/me/training-summary`: estados `not_linked`, bloqueado por elegibilidad/consentimiento, no disponible o disponible. En los estados sin autorización o sin datos se presenta el estado vacío/bloqueado; Home no calcula derechos. Mediciones, gráficos históricos, evaluaciones y datos de salud siguen **No conectado** al contrato de evolución disponible.

## Validación y límites

- La suite de cliente se ejecuta con respuestas sintéticas, no es evidencia de sesión real: resultado actualizado en el PR.
- La ejecución completa Home → Platform → Búnker se realiza con el workflow aislado de E2E, PostgreSQL desechable y checkout de solo lectura de Búnker. No se ejecuta en producción ni se despliega.
- D238/D239: no se ofrece edición de datos personales.
- PR nivel 2 por mostrar datos económicos y descargar documentos; requiere una revisión independiente.

