# 2J Hub client app

The member Hub is an additional surface; Training at `https://app.2jfitnesscenter.com` remains independent.

## Member shell and Inicio V2

Primary navigation is **Inicio · Búnker · Tienda · Perfil · Ajustes**. Inicio has three product blocks: Noticias, Reservar clase and Próxima reserva. News temporarily composes the newest `center_notice` from the Member notifications API; general notifications remain a separate domain and are available in the Buzón. This is an interim read source, not the final center-news model.

The booking CTA opens the existing weekly booking browser, and Próxima reserva links to the existing bookings and history view. Búnker opens `https://app.2jfitnesscenter.com` in a new tab without iframe or SSO. Tienda is informational only and has no product, price, stock, cart or purchase behavior. Perfil retains the existing profile, membership/right balances, form and consent data; unsupported store/profile sections are omitted. Ajustes is an empty general-settings shell; internal pilot links appear there only in development/preview.

## Local fixture preview

```powershell
$env:VITE_2J_HUB_PREVIEW='true'
$env:VITE_2J_STAFF_URL='http://127.0.0.1:5175'
$env:VITE_2J_ADMIN_URL='http://127.0.0.1:5174'
pnpm --filter @2j/client-app dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173/?preview=1`. Fixture data is fictional, API-free, and write actions are disabled or simulated locally. Preview appears only when the build flag is `VITE_2J_HUB_PREVIEW=true` **and** the URL has exactly one `preview=1` parameter. A build flag or URL parameter alone cannot enable preview; `/` stays in normal API mode.

## Static synthetic demo build

Create and inspect a static release candidate without inheriting `.env` files or shell `VITE_*` settings:

```powershell
pnpm --filter @2j/client-app build:demo
pnpm --filter @2j/client-app preview:demo
```

Open `http://127.0.0.1:4173/`. This dedicated build always uses synthetic fixtures, including when the URL has no query parameter; it cannot fall through into Platform API mode. The generated files are written to `apps/client-app/dist-demo/`; the build script supplies only the fixed demo flag and a synthetic build label, ignores `.env` files and shell `VITE_*` settings, and refuses to replace an output directory it did not create. The demo is visibly marked **DEMO · DATOS FICTICIOS**. It makes no API calls, exposes no staff/admin pilot links, and does not open the production Búnker app. This is a local static candidate, not a deployment or a live Platform integration.

## Isolated static container candidate

After building `dist-demo`, validate the isolated Nginx image and Compose file:

```powershell
docker compose -f apps/client-app/staging/compose.yaml config --quiet
docker compose -f apps/client-app/staging/compose.yaml build
docker compose -f apps/client-app/staging/compose.yaml up -d
docker exec 2j-home-synthetic-demo-home-demo-1 nginx -t
```

The image copies only `dist-demo` assets and the Nginx config; the Compose service has no API, database, credentials, mounts, published ports, or non-internal network. Nginx serves only the static shell/assets and returns 404 for API, pilot, authentication, booking, payment, staff/admin and unknown paths. This Compose candidate is intentionally not reachable from the host or Internet. Stop the local verification container with `docker compose -f apps/client-app/staging/compose.yaml down`. Public access would require a separately reviewed reverse-proxy/network change and owner approval; do not add a public port mapping.

## Normal mode

Without the exact preview opt-in, the app calls its existing `/api/me`, booking, membership, documents, consent and notification APIs and relies on the server for identity and authorization. The optional local pilot login UI requires the separate build flag `VITE_2J_PILOT_MEMBER_LOGIN=true`; it submits a synthetic local access code to the loopback-only Platform API, which sets the HttpOnly session cookie. The pilot URL opens normal mode without `?preview=1`, while adding the exact preview opt-in still loads fixture data without API calls. Do not point it at real personal data until a production identity/session provider and hosting have been approved.

Staff/admin are separate workspaces. Internal pilot links can be configured with `VITE_2J_STAFF_URL` and `VITE_2J_ADMIN_URL`; they appear only in development/preview builds and do not grant API access.
# Integraciones de miembro en preparación

La demo visual conserva el shell y cinco destinos existentes. La identidad principal, el bono de 12 sesiones, la sesión de ejemplo y los dos productos reflejan registros sintéticos fijos de `apps/api/scripts/seed-demo.ts`; el modo demo los incluye como fixtures locales, sin consultar la API. Noticias, compra de ejemplo, avisos y pantallas auxiliares adicionales siguen siendo contenido ficticio exclusivo de presentación.

Los adaptadores de vinculación de Búnker y elegibilidad de sesiones están apagados si no se activan expresamente:

- `VITE_2J_TRAINING_ACCOUNT_LINKING=true`: crea transacciones y permite terminar/revocar una vinculación con la sesión de miembro de Platform. Platform debe tener activa su bandera y Búnker debe implementar la emisión de la prueba passkey.
- `VITE_2J_TRAINING_LINK_REVIEW=true`: muestra y envía solicitudes de revisión manual a los endpoints de miembro de Platform. La resolución administrativa no está en Home.
- `VITE_2J_SESSION_ELIGIBILITY=true`: representa `availability` y `availabilityReason` del contrato `GET /api/me/sessions` V1 cuando esos campos estén presentes; no calcula elegibilidad.

Las banderas de cliente no conceden permisos ni sustituyen las banderas/validaciones del servidor. El build `build:demo` elimina el entorno Vite, fuerza el modo sintético y desactiva todas estas integraciones.

`Mi evolución` es una preparación de interfaz. No solicita ni presenta mediciones ficticias: se conectará cuando Platform publique su contrato.
