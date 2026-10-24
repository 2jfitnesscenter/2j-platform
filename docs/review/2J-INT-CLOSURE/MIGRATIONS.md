# Migrations 0040 and 0041 (Platform) — invariants and probes

Both are additive, forward-only and were applied only to disposable databases. Nothing was run against a real database. Files: `apps/api/migrations/0040_training_link_activation_provisioning.sql`, `0041_platform_passkeys.sql` (0039 `training_sso_codes` belongs to PR #64).

## 0040 — link activation and provisioning

Adds `platform_training_provisioning`; adds to `training_account_links`: `source_provisioning_id`, `training_ack_id`, `training_acked_at`, `revocation_ack_id`; widens `method` (adds `provisioned`) and the source/ack CHECKs; replaces trigger `protect_training_account_link()`; extends the identity-audit action CHECK.

| Invariant | Enforced by |
|---|---|
| A canonical link becomes `active` only with a Training ACK recorded in the same transition | trigger (`pending → active` requires `training_ack_id`; `training_acked_at` set by the trigger) |
| `revoked` (non-legacy) only with a revocation ACK or an audited waiver id | trigger + CHECK `…_ack_check` |
| ACKs immutable outside their own transition; terminal states final; `link_version` advances by exactly one | trigger |
| Legacy `explicit_admin` links keep their meaning (start active, no proof source, revoke directly) | CHECK + trigger |
| One non-terminal link per person and per Training user | partial unique indexes (pre-existing) + advisory locks in code |
| A provisioning is unique per idempotency key and per person (`requested`/`provisioned`); history retained, never deleted | unique indexes + `protect_platform_training_provisioning` |
| A `provisioned` link must reference a completed provisioning of the same person and Training user | trigger |

Probes a reviewer can run on a disposable DB after `pnpm --filter @2j/api db:migrate`:
```sql
-- must fail (55000): activate without ACK
UPDATE training_account_links SET status='active', link_version=link_version+1 WHERE status='pending';
-- must fail (55000): revoke an active proof link without a revocation ACK
UPDATE training_account_links SET status='revoked', link_version=link_version+1 WHERE status='active' AND method<>'explicit_admin';
-- must fail: delete history
DELETE FROM training_account_links; DELETE FROM platform_training_provisioning;
```
Covered by: `apps/api/test/training-link-flow.test.mjs` ("the database refuses to activate or revoke …").

## 0041 — passkeys

Adds `platform_passkey_enrollments`, `platform_passkeys`, `platform_passkey_challenges`; triggers; extends the identity-audit CHECK (`passkey.*`).

| Invariant | Enforced by |
|---|---|
| Enrollment token stored as SHA-256 only, ≤ 1 h life, single use | CHECKs + `platform_passkey_single_use` |
| Challenge ≤ 10 min, single use, registration challenges bound to an enrollment, authentication ones to none | CHECKs + trigger |
| Credential identity (`credential_id`, `public_key`, `rp_id`, subject) immutable; revoked is final; sign counter never decreases; history retained | `platform_passkey_protect` |
| A credential belongs to one active auth subject of one person | composite FK to `platform_person_auth_subjects(id, person_id)` |

Note for reviewers: PostgreSQL regex repetition is capped at 255, so length bounds use `char_length()`; `rp_id` is recorded per credential so a later host change cannot silently orphan or cross-bind credentials.

Probes:
```sql
UPDATE platform_passkeys SET public_key = '\x00' WHERE true;          -- must fail (55000)
UPDATE platform_passkeys SET status='active', revoked_at=NULL WHERE status='revoked';   -- must fail (55000)
```
Covered by: `apps/api/test/platform-passkeys.test.mjs`.

## Rollback

Forward-only (project convention). Rolling back = restore the pre-migration backup of the database; the application code with all flags off does not read the new tables.

## 0042 — browser binding of SSO codes (decision 3)

File `apps/api/migrations/0042_training_sso_browser_binding.sql`. Additive: `platform_training_sso_codes.binding_challenge char(43)` (nullable column so history stays valid), CHECK `^[A-Za-z0-9_-]{43}$`; the insert trigger now **requires** a challenge for every new code; `protect_platform_training_sso_code()` extended so the challenge is immutable. Rows issued before the migration (none exist outside disposable databases) cannot be redeemed by the new path (they have no challenge) — they expire in ≤ 60 s anyway.
Probes (disposable DB): `INSERT` a code without `binding_challenge` → fails (23514); `UPDATE … SET binding_challenge=…` on an existing code → fails (55000); a challenge of 42 chars → fails the CHECK. Covered by `training-sso.test.mjs` "the binding is immutable and every stored code carries one".

## 0043 — signal delivery bookkeeping (decision 4, proof of concept)

File `apps/api/migrations/0043_training_signal_deliveries.sql`. Adds `platform_training_signal_state` (singleton: when the dispatcher was first enabled) and `platform_training_signal_deliveries` (one row per `platform_training_access_events` row: `seq` bigserial, `signal_id`, state `pending|delivered|superseded|abandoned`, attempts, `next_attempt_at`, `last_error` ≤ 80 chars, timestamps). Constraints: state/kind CHECKs, one delivery per event (unique + FK), error text bounded. **Read-only with respect to the existing event table.** Unused unless `TRAINING_SIGNALS_ENABLED=true` (dev/test only); with the flag off the tables stay empty.
Covered by `training-signals.test.mjs` "the bookkeeping is constrained…". Rollback: forward-only like the others; with the dispatcher off nothing reads the tables.
