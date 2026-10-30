# Handoff — 2J-A67 Invitaciones

## Alcance implementado

- Platform permite emitir un código de incorporación con 256 bits aleatorios, mostrarlo una sola vez y revocarlo con motivo obligatorio.
- La invitación vence a las 24 horas. PostgreSQL conserva únicamente el SHA-256 del secreto; los eventos de emisión/revocación son de solo anexado y quedan auditados.
- El acceso requiere `member.invitations.manage` en servidor. El permiso se expone al shell solo como booleano del actor autenticado. La bandeja H13 conserva su permiso separado `platform_link_issue`.
- La pantalla reúne dos flujos visuales claramente separados: códigos de invitación y revisiones de vínculo H13 existentes.

## Límites funcionales

- La emisión no asigna destinatario, no busca por email/teléfono, no crea persona/cliente/cuenta de Training y no modifica identidad.
- El canje autenticado, la prueba de titularidad, la entrega al socio y la activación bilateral con Búnker siguen **No conectados**. No se reutiliza la aprobación de una solicitud H13 como canje de invitación.
- No hay plantillas ni datos presembrados. El operador entrega el código por un canal verificado externo; esta entrega no implementa correo/SMS.
- Las invitaciones y sus eventos se conservan; la revocación no borra registros.

## Persistencia y seguridad

- Migración `0065_platform_member_invitations.sql`. La numeración se desplazó para dejar `0064` a la configuración (#158); se inspeccionaron las ramas remotas de PR abiertas y no se encontró otro uso de `0065_platform_member_invitations.sql`.
- Las rutas de lectura/emisión/revocación fijan `Cache-Control: no-store`. La respuesta de emisión es el único lugar donde aparece el secreto bruto; las rutas de lista e historial no devuelven ni secreto ni hash.
- Pruebas cubren permisos, exposición única, ausencia de datos de identidad, expiración/revocación, auditoría e inmutabilidad.

## Validación

- Base verificada: `origin/main` `6d46f06523285882e518de0512af11e11be46461` (30-10-2026); el PR #158 reserva 0064 para Configuración, por lo que Invitaciones usa 0065. Se inspeccionaron los 351 refs remotos locales; ninguno contenía una migración con prefijo 0065. La API de GitHub devolvió rate limit al enumerar ficheros de PR, así que no se afirma una comprobación remota adicional por esa vía.
- PostgreSQL sintético desechable y vacío: migraciones desde cero y tests de Invitaciones 3/3 PASS; no se usaron bases reales.
- API completa: 436/436 PASS sobre la secuencia final 0065.
- Admin Web completo: 395/395 PASS. Una ejecución anterior tuvo un fallo aislado en `deep-link.test.mjs`; el test aislado pasó 3/3 y la suite completa repetida pasó 395/395.
- Tests focales adicionales: UI Invitaciones 6/6, bandeja H13 API 8/8, dashboard/capacidades 16/16, permisos 14/14.
- `pnpm typecheck`: 11/11 tareas PASS. `pnpm build --force`: 9/9 tareas PASS (Vite mantiene el aviso existente de chunk Admin >500 kB). `pnpm audit --audit-level high`: sin vulnerabilidades high/critical; pnpm informó 11 low/moderate. `git diff --check`: PASS.
- No se ejecutó el workflow GitHub de secret scan/E2E localmente. La CI exacta del PR debe completar antes de revisión Level-2; no se ha abierto PR desde este handoff.
