# Handoff: Platform paridad fila 21 — Mi gimnasio y datos del centro

Base revisada: `abd31b89ffc2ce64c9fae167f2226267234b2348`.

## APIs disponibles y delta

- **Noticias del centro (ya estaba en main):** `GET/POST /api/admin/news`, `PATCH /api/admin/news/:newsId`, publicar/retirar/destacar/quitar destacado, auditoría y `GET /api/me/news`. Lecturas por `news.read`; escrituras por `news.manage`; auditadas. No se duplicaron.
- **Consentimientos:** esta PR añade `GET /api/consents` y `GET /api/consents/:consentId/versions`, con `consents.read`, filtros SQL y paginación acotada. Las escrituras, activación, archivo, aceptación e historial ya estaban en `communications.ts` y permanecen intactas.
- **Perfil general de centro:** `GET/PUT /api/admin/center-profile`, protegido por `settings.manage`. Guarda nombre comercial, correo/teléfono de contacto y dirección/ciudad/código postal. Los cambios se auditan con actor y nombres de campos cambiados, sin duplicar valores de contacto en el historial.
- **Migración/modelo:** `0059_center_business_profile.sql`, reflejada en Drizzle. La tabla es específica de `2j` y no crea un almacén genérico de configuración.

## Fuera de alcance explícito

- Identificadores/razón social/facturación fiscal: D106.
- Salud y cuestionarios: D33.
- Horarios y turnos: A45 permanece en PR #124; esta PR no crea una segunda fuente para horarios.
- URL/logo y subida de imágenes: pendiente de contrato privado/público de recursos; no se persisten URLs arbitrarias.
- Ajustes genéricos de reservas, pagos, permisos e integraciones: se mantienen en sus modelos/endpoints existentes; no se inventan campos.

## Migración y orden de integración

Antes de crear 0059 se revisaron los diffs de todas las PR abiertas, todas las ramas `origin/*` y los worktrees Platform locales; no había una migración 0059. La numeración anterior incluye #124/0053, #125/0054, main/0055, fila 7/0056, fila 16/0057 y la fila 22 local/0058. Por tanto, integrar la fila 22 (0058) antes de esta PR (0059) mantiene el orden de aplicación esperado.

## Validación

- Consentimientos y noticias: 10/10 tests focales PASS en PostgreSQL sintético.
- Perfil: 2 tests nuevos, incluidos permisos, auditoría no-PII, validación estricta y rechazo de campos fiscal/salud/horarios.
- Suite API completa en PostgreSQL sintético limpio: 373/373 PASS, 0 fallos.
- Typecheck API: PASS.
- Build monorepo: 9/9 tareas PASS.
- `git diff --check`: PASS.
- No se usaron datos reales, no se aplicaron migraciones a una base real, y no se tocó Home, Búnker ni el seed de producción.

La rama contiene la migración 0059. Su integración debe respetar la secuencia de cambios de esquema pendientes: fila 7/0056, fila 16/0057 y fila 22/0058 antes de aplicar 0059. La comprobación de colisiones se debe repetir justo antes de publicar cualquier nueva migración.
