# 2J Hub client app

The member Hub is an additional surface; Training at `https://app.2jfitnesscenter.com` remains independent.

## Local fixture preview

```powershell
$env:VITE_2J_HUB_PREVIEW='true'
$env:VITE_2J_STAFF_URL='http://127.0.0.1:5175'
$env:VITE_2J_ADMIN_URL='http://127.0.0.1:5174'
pnpm --filter @2j/client-app dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173/?preview=1`. Fixture data is fictional, API-free, and write actions are disabled or simulated locally. Preview appears only when the build flag is `VITE_2J_HUB_PREVIEW=true` **and** the URL has exactly one `preview=1` parameter. A build flag or URL parameter alone cannot enable preview; `/` stays in normal API mode.

## Normal mode

Without the exact preview opt-in, the app calls its existing `/api/me`, booking, membership, documents, consent and notification APIs and relies on the server for identity and authorization. The optional local pilot login UI requires the separate build flag `VITE_2J_PILOT_MEMBER_LOGIN=true`; it submits a synthetic local access code to the loopback-only Platform API, which sets the HttpOnly session cookie. The pilot URL opens normal mode without `?preview=1`, while adding the exact preview opt-in still loads fixture data without API calls. Do not point it at real personal data until a production identity/session provider and hosting have been approved.

Staff/admin are separate workspaces. Internal pilot links can be configured with `VITE_2J_STAFF_URL` and `VITE_2J_ADMIN_URL`; they appear only in development/preview builds and do not grant API access.
