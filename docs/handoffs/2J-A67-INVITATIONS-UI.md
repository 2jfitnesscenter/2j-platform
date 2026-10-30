# Handoff — A67 Invitaciones / revisión H13

## Implementado en esta rama

- Admin muestra la cola real de `/api/platform/v1/training-link-review` y el historial del caso; tanto lectura como resolución exigen `platform_link_issue` en el servidor.
- El capability de navegación `linkReviewManage` procede del mismo permiso. El permiso es explícito y no lo concede el comodín Admin ni `identity.people.manage`.
- Aprobación/rechazo/archivo usan la ruta existente y conservan su nota de auditoría. El formulario de aprobación exige el identificador de la cuenta Búnker obtenido tras verificación presencial u otro canal verificado.
- No se muestran IDs internos ni identificadores de Búnker en listados; se evita matching por correo, teléfono o nombre.

## Límite funcional explícito

Esta pantalla gestiona revisiones manuales ya iniciadas por una persona autenticada en Platform. No crea invitaciones de alta, no crea cuentas Búnker ni activa acceso/SSO. El puente H13 bilateral con `reviewId`, step-up en Búnker, lista cerrada de emisores, límite diario, recibo de 24 h y auditoría encadenada sigue **No conectado**; la UI lo comunica antes de permitir una decisión. La aprobación Platform solo registra la revisión aprobada y no llama al endpoint de vínculo.

El resolver de servidor elimina cualquier concesión heredada de `platform_link_issue` y reconstruye el permiso solo para el Owner configurado o para `personId` estables incluidos en `PLATFORM_LINK_ISSUERS`. Así, ni un perfil explícito no autorizado ni el comodín Admin lo concede; tampoco se acepta un `personId` enviado por el navegador. Esto permite autorizar a Pedro Guerra sin usar email/teléfono ni concederle el rol Owner. El valor real de su `personId` debe configurarse fuera del repositorio; este cambio no afirma que ya esté configurado en staging o producción.

## Contrato y límites pendientes

El contrato de API acepta las razones A28 `lost_device`, `no_home_access`, `support_request` y `other`. Para mantener compatibilidad con la restricción y los registros históricos, las razones canónicas se traducen a los valores heredados al persistir; las respuestas API vuelven a exponer únicamente el vocabulario A28. Las activaciones H13 siguen fuera de este alcance.

## Validación

- Admin completo: 379/379; los 3 tests de la pantalla H13 están incluidos.
- Client App: 46/46; `@2j/permissions`: 13/13.
- API completa en PostgreSQL sintético nuevo: 427/427 PASS después del hardening A29.
- El test H13 focal en PostgreSQL sintético pasa 8/8; incluye rechazo de un actor no allowlisted con permiso explícito, aceptación del Owner y del `personId` configurado, razones A28 en lista/detalle y rechazo de spoofing.
- Typecheck workspace: 11/11 tareas; build workspace: 9/9 tareas; `git diff --check`: PASS.
- Una ejecución de Admin hecha en paralelo con otras suites tuvo 3 fallos intermitentes de sincronización; repetida en aislamiento pasó 379/379 y los tres tests afectados pasaron también al ejecutarse juntos (31/31).
- Sin migraciones, sin datos reales, sin llamadas a Búnker y sin cambios de Home.
