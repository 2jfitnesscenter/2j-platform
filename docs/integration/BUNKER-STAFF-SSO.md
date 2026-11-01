# Acceso único del personal a la administración de Búnker (A79)

Platform es la autoridad de identidad (A20, D142); Búnker conserva su UID. Mismo patrón que el SSO de socio (`/api/me/training/sso`), con **audiencia y propósito propios**.

| | Socio (existente) | Personal (A79) |
|---|---|---|
| Emisión | `POST /api/me/training/sso` | `POST /api/staff/bunker/sso` (cookie de sesión de personal, `Origin` exacto de admin-web) |
| Canje (Búnker → Platform) | `POST /api/internal/platform/v2/sso/redeem` | `POST /api/internal/platform/v2/staff-sso/redeem` |
| `audience` / `purpose` | `2j-training-sso` / `training-session` | `2j-bunker-admin-sso` / `bunker-admin-session` |
| Permiso | vínculo + capacidades de entrenamiento | `bunker.admin.access` (por perfil: perfil admin y propietario; nunca por persona) |
| Tabla | `platform_training_sso_codes` | `platform_staff_sso_codes` (migración 0073) |

## Flujo (lado Platform, implementado)
1. admin-web, ruta `#bunker`: «Abrir Búnker» navega a `<BUNKER_ADMIN_URL>/api/platform/v1/staff-sso/start`.
2. Búnker guarda un `verifier` en cookie HttpOnly propia y devuelve el navegador a `<admin-web>/#bunker?sso_challenge=<S256(verifier)>`.
3. admin-web pide el código a Platform con ese `challenge`; Platform comprueba el permiso, emite un código de un solo uso (60 s, solo se guarda su SHA-256) y devuelve `redirectUrl = BUNKER_ADMIN_SSO_REDIRECT_URL#code=…`.
4. Búnker canjea servidor a servidor (2J-SERVICE-AUTH-V1, `caller: bunker`) con `{v:2, code, verifier, audience, purpose}`. Platform **vuelve a leer** permiso, sesión y persona en el canje (cambio de perfil, baja o cierre de sesión dentro de la ventana lo deniegan) y responde `{v:1, personId, authSubject, role, permission}`.

## Lado Búnker (pendiente, repo `2jfitnessapp`, fuera de este PR)
- Página `GET /api/platform/v1/staff-sso/start` y página de canje del administrador; cookie de `verifier`.
- Canje contra el endpoint anterior y apertura de sesión de administrador asociada **al mismo UID**: mapear `personId` (estable) al UID de Búnker del miembro del personal; si no existe el vínculo, rechazar (no crear usuarios).
- Rechazar cualquier respuesta cuyo `permission` no sea `bunker.admin.access`.

## Configuración (apagado por defecto)
API: `BUNKER_ADMIN_SSO_ENABLED=true`, `BUNKER_ADMIN_SSO_REDIRECT_URL`, `PLATFORM_INTERNAL_SERVICE_KEYS` (caller `bunker`), `STAFF_APP_ORIGIN`. admin-web: `VITE_2J_BUNKER_ADMIN_URL`.
