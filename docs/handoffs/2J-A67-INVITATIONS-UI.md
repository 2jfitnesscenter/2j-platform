# Handoff — A67 Invitaciones / revisión H13

## Implementado en esta rama

- Admin muestra la cola real de `/api/platform/v1/training-link-review` y el historial del caso; tanto lectura como resolución exigen `platform_link_issue` en el servidor.
- El capability de navegación `linkReviewManage` procede del mismo permiso. El permiso es explícito y no lo concede el comodín Admin ni `identity.people.manage`.
- Aprobación/rechazo/archivo usan la ruta existente y conservan su nota de auditoría. El formulario de aprobación exige el identificador de la cuenta Búnker obtenido tras verificación presencial u otro canal verificado.
- No se muestran IDs internos ni identificadores de Búnker en listados; se evita matching por correo, teléfono o nombre.

## Límite funcional explícito

Esta pantalla gestiona revisiones manuales ya iniciadas por una persona autenticada en Platform. No crea invitaciones de alta, no crea cuentas Búnker ni activa acceso/SSO. El puente H13 bilateral con `reviewId`, step-up en Búnker, lista cerrada de emisores, límite diario, recibo de 24 h y auditoría encadenada sigue **No conectado**; la UI lo comunica antes de permitir una decisión. La aprobación Platform solo registra la revisión aprobada y no llama al endpoint de vínculo.

El identity resolver concede `platform_link_issue` al Owner configurado. A29 permite que Pedro Guerra también lo tenga, pero la asignación de perfiles de permisos aún no está implementada; por tanto, Pedro no puede recibir el permiso desde la interfaz actual. El contrato admite que un resolver de confianza lo entregue explícitamente, sin emparejar por email o teléfono.

## Alineación pendiente

La API existente aún usa razones `lost_passkey`, `no_access_to_training_account`, `proof_failed` y `other`; A28 define `lost_device`, `no_home_access`, `support_request` y `other`. Esta entrega solo pone etiquetas humanas en la interfaz. La normalización del contrato/puente H13 se mantiene pendiente y requiere revisión independiente antes de integrar activaciones.

## Validación

- Admin completo: 379/379; los 3 tests de la pantalla H13 están incluidos.
- API/PostgreSQL sintético local: 33/33 en Command Center, revisión H13 y passkeys; `@2j/permissions` 13/13. Incluye denegación del comodín Admin y acceso A29 explícito.
- Typecheck workspace: 11/11 tareas; build workspace: 9/9 tareas; `git diff --check`: PASS.
- Sin migraciones, sin datos reales, sin llamadas a Búnker y sin cambios de Home.
