# Home member messages handoff

## Scope

Adds the member-facing conversation screen to the existing Home client PWA, inside Perfil. It preserves the five-section navigation and does not change Platform APIs, permissions, authentication, or Búnker.

## Data and behavior

- Authenticated mode reads `GET /api/client-portal/conversation`.
- A first message creates/reuses the member conversation with `POST /api/client-portal/conversations`, then sends through `POST /api/client-portal/conversations/:conversationId/messages` with the existing idempotency-key helper.
- Unread staff messages can be marked read through `POST /api/client-portal/messages/:messageId/read`.
- Message notifications with the approved `/messages` deeplink open this screen.
- Demo mode displays an explicit fictional-preview notice and makes no API calls.
- No message content is copied into logs or browser persistence by this screen.

## Verification

- `pnpm --filter @2j/client-app typecheck` — passed.
- `pnpm --filter @2j/client-app test` — 46/46 passed, including live-mode request behavior, demo no-call behavior, message send/idempotency, read receipt and safe notification routing.
- `pnpm --filter @2j/client-app build` — passed.
- `git diff --check` — passed.

## Boundaries and next work

- These tests use synthetic API responses; no authenticated staging session or real persistence was exercised.
- Purchases already read the existing Platform endpoint; profile editing still awaits a member-write contract. Evolution remains informational and exposes no measurements or health data under A63.
- This is a local feature branch only. Do not merge or deploy until the required review/CI gates are satisfied.
