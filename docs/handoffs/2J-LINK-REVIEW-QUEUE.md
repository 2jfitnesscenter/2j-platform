# 2J-LINK-REVIEW-QUEUE — A26: passkey proof from Home + manual admin review queue (stacked on #64–#67)

Owner decision A26 (2026-10-23): email matching is dropped. A person links an existing Búnker account by **proving control of it with its passkey, starting from Home**; people who cannot do that go to a **manual review queue** resolved only by administrators (D143). Flag OFF by default (`trainingLinkReviewEnabled`); migration **0045**.

## 1. The normal path (already built in #67; Home only needs the screens)
1. Home (member session) → `POST /api/platform/v1/training-link-transactions` → `{transactionId, challenge}` (5 min, bound to the member's auth subject).
2. The member opens Búnker (their account, passkey session) → Búnker issues a one-time code for that exact transaction (`POST /api/platform/v1/link-proofs`, owner's passkey session on Búnker).
3. Home → `POST /api/me/training/link {transactionId, challenge, code}` → Platform verifies the proof with Búnker, creates the **pending** link and activates it with Búnker's acknowledgement. Both sides hold the link; it is unique per person and per Training user and revocable (`DELETE /api/me/training/link`).
Proven by E2E (`tooling/e2e/training-link.e2e.mjs`, 9 cases). No email, name, phone or username is ever used to link.

## 2. The queue (new)
| Who | Endpoint | What |
|---|---|---|
| member | `POST /api/me/training/link-review {reason, note?}` | opens ONE case (`lost_passkey`, `no_access_to_training_account`, `proof_failed`, `other`); same-origin; cannot name a Training account; `409` if the person already has or is getting a link; repeating returns the open case |
| member | `GET /api/me/training/link-review` | status of their latest case; no resolution notes |
| admin | `GET /api/platform/v1/training-link-review?status=open|approved|rejected|dismissed|all` | the queue (person id + display name, reason, note) |
| admin | `GET …/:caseId` | case + event history |
| admin | `POST …/:caseId/resolve {action, note, verification?, trainingUserId?}` | `approve` needs `verification.method` (`in_person` \| `other_verified`), a note (>= 10 chars) and the Training user; `reject`/`dismiss` need a note and carry nothing else |

- **Only administrators** (`identity.people.manage`, not held by trainers: D143). Every decision records who, when, how identity was checked and why; events are append-only; a resolved case is final; the same decision twice is idempotent.
- **Approval does not link.** It records the decision and refuses a Training user already linked to someone else or a person already linked; the link itself then goes through the audited admin link path (`POST /api/platform/v1/persons/:id/training-link`, flag `trainingLinkingEnabled`).
- **Known gap (H13):** that admin path creates an `explicit_admin` link that **Búnker does not hold**, so SSO would not work for it. A real fix is an admin-assisted activation on Búnker's side (a Búnker administrator confirms the same pairing); not built — needs the owner's decision on who administers Búnker accounts.
- Response is sent only after the transaction commits (a first draft sent it inside the transaction; the integration test caught the race).

## 3. Tests
`apps/api/test/training-link-review.test.mjs` (7): disabled → 423 everywhere; member auth/origin/strict body/one open case; already-linked person; admin-only (trainer 403) and no resolution notes for members; strict validation of every resolution; approval records without linking, idempotent, final, refuses taken Training user/person; reject/dismiss and DB-level immutability. API suite 289: 286 pass; the 3 failures are the clock tests fixed by #68 on `main` (this stack predates it: merge `main` into the stack before merging).
Not tested: Home screens (Work Home), a real Búnker passkey.

## 4. Decisions applied by default
One open case per person; a member can open a new case after a resolution; reasons limited to four values; notes capped at 500 characters; resolution note minimum 10 characters.
