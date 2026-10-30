# Handoff — Ajustes de Apariencia, Reservas y Tienda

## Alcance implementado

- **Apariencia:** preferencia `light | dark | system` por actor autenticado, servida por `GET/PUT /api/settings/appearance`. El tema usa los tokens claros/oscuros ya aprobados; no cambia colores, logotipo ni identidad corporativa. El valor inicial es `light` y se persiste en `staff_appearance_preferences` (migración 0064). Solo se guarda una preferencia visual, sin auditoría de negocio.
- **Reservas:** Configuración edita el recordatorio operativo con `GET /api/settings/notifications` y `PATCH /api/settings/booking-reminders`. La ruta PATCH solo cambia los dos campos de recordatorio y preserva ajustes no relacionados. No añade ni cambia ventanas, cancelaciones, promociones, horizonte, capacidad ni políticas; esas reglas siguen configuradas por servicio.
- **Tienda:** conserva el umbral real de aviso de stock, con API y auditoría existentes. No duplica catálogo, variantes, inventario ni ventas.

## Validación y límites

- Base del trabajo: `origin/main` `6d46f06523285882e518de0512af11e11be46461` (más reciente que la base indicada al iniciar).
- La secuencia de migraciones en `origin/main` termina en `0063_member_evolution_consent_audit.sql`. Antes de publicar se revisaron los 174 refs remotos disponibles de PR/ramas: no hay otra migración `0064` o `0065` ya publicada. Este cambio usa `0064_staff_appearance_preferences.sql`; Invitaciones tiene reservado `0065` en una rama paralela aún no publicada.
- La configuración y los recordatorios existentes requieren `settings.manage`; la preferencia de tema queda aislada por `actor_id` y no expone datos de otro usuario.
- No se editan Facturación, privacidad/consentimientos, horario/turnos ni las reglas por servicio.
- Suite comprobada en PostgreSQL sintético: API 435/435; Admin Web 393/393 (una primera ejecución tuvo un fallo intermitente preexistente en `deep-link.test.mjs`, que pasó aislado 3/3 y en la repetición completa); Client 49/49; Staff 7/7; deploy-kit 8/8; paquetes 76/76. Total consolidado: 968 tests aprobados.
- `pnpm typecheck`: 11/11 tareas; `pnpm build --force`: 9/9; `git diff --check`: PASS. `pnpm audit --audit-level high` no encontró vulnerabilidades altas/críticas, pero informa 11 vulnerabilidades conocidas (6 bajas, 5 moderadas).
- Falta revisión independiente antes de merge por ser un cambio Level-2. Sin publicación ni merge en este estado.
- Los tests/gates y el SHA final se completan tras ejecutar la suite en PostgreSQL sintético.
