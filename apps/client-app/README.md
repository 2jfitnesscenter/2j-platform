# 2J Hub client app

The member Hub is an additional surface; Training at `https://app.2jfitnesscenter.com` remains independent.

## Local fixture preview

```powershell
$env:VITE_2J_HUB_PREVIEW='true'
$env:VITE_2J_STAFF_URL='http://127.0.0.1:5175'
$env:VITE_2J_ADMIN_URL='http://127.0.0.1:5174'
pnpm --filter @2j/client-app dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173/?preview=1`. Fixture data is fictional, API-free, and write actions are disabled or simulated locally. The preview flag must be enabled at build time; a URL parameter alone cannot enable preview.

## Normal mode

Without `VITE_2J_HUB_PREVIEW=true`, the app calls its existing `/api/me`, booking, membership, documents, consent and notification APIs and relies on the server for identity and authorization. Do not point it at real personal data until the platform's production identity/session provider and hosting have been approved. The current API runtime is loopback-only and has no production authentication.

Staff/admin are separate workspaces. Internal pilot links can be configured with `VITE_2J_STAFF_URL` and `VITE_2J_ADMIN_URL`; they appear only in development/preview builds and do not grant API access.
