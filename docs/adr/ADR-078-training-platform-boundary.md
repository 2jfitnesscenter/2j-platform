# ADR-078: Training and Platform bounded-context boundary

- **Status:** Proposed
- **Date:** 2026-10-10
- **Task:** 2J-078A
- **Platform audit SHA:** `fc97458100b45db51475b37470e75cf2bb76d687`
- **Training audit SHA:** `d1ea376d4834fb5ba7b419c9315a926e64a9cab4` (point-in-time only)
- **Owners:** 2J product and engineering

## Context

2J Platform owns commercial and operational management: client records, services, plans/entitlements, calendar/reservations, payments, staff, communications, documents/forms and notifications. 2jfitnessapp (Training) has existing member accounts/passkeys and owns routines, workouts, progression, Búnker and Health-related data. The systems have different identity ids, authentication/session mechanisms, persistence technology and deployable units. Platform currently has permission vocabulary for training/health surfaces, but no live Training integration or configured runtime identity resolver.

The product goal is one coherent 2J member experience through a Hub while allowing each product to deploy and evolve independently. Rewriting Training into Platform, joining repositories, querying each other's databases, synchronizing full profiles/state, or moving passkey credentials would create unnecessary coupling and user-data risk.

## Decision proposal

**Platform and Training remain independently deployable bounded contexts connected through versioned contracts.**

1. `personId` is the proposed conceptual human-identity root, distinct from every facet and authentication identifier. Platform `clients.id` remains the client-facet id (`centralClientId`); staff/professional ids and Training `user.id` (`trainingUserId`) remain separate. A later audited account-link maps the existing Training account to `personId` only after proof of both identities; client-domain records continue to reference `centralClientId`.
2. Each domain writes only its own data. Platform owns clients/contact, membership/rights, reservations, payments, staff, communications, forms/documents and Platform notifications. Training owns its account/passkeys, profile preferences, routines/programs, workouts, Búnker, Health and Training integrations.
3. Cross-product reads use narrow, versioned APIs and DTOs through anti-corruption adapters. No cross-database reads, shared tables, full Training state transfer, or bidirectional profile sync.
4. Existing Training passkeys remain attached to the existing Training user and relying-party id. A future Hub handoff uses a short-lived, single-use authorization-code exchange (OIDC/OAuth-style, PKCE, state/nonce and audience), then establishes a local Training session. Passkey consolidation is optional and not required for SSO.
5. Access assertions originate from Platform and are verified by Training; access-sensitive actions revalidate current link/version. Health is excluded by default and needs separate member consent, least-privilege authorization and an explicit product decision.
6. Integration flags default OFF. Shadow mode validates link/access and DTO behavior without changing Training access or rendering data. Failure of either product must not break core workflows in the other.

## Consequences

### Positive

- Existing Training accounts, credentials, history and Búnker state remain intact.
- Platform stays the only authority for commercial access and reservations; Training remains the owner of workouts and Health.
- Each codebase can deploy independently, and internal model changes do not automatically become cross-repo changes.
- Narrow contracts make permissions, consent, versioning, auditing, revocation, caching and fallback explicit.

### Costs and constraints

- Linking, SSO and API adapters require additional services, contract tests, monitoring and lifecycle/revocation logic.
- Member/staff surfaces must tolerate delayed, unavailable or stale cross-product information.
- A dual-proof link ceremony and support process are needed; matching by contact or display name is insufficient. The Platform person identity root and verified client/staff facet mappings must be defined before account linking.
- Platform's runtime identity provider and client auth mapping must be completed/approved before production linking or Hub SSO.

## Considered alternatives

| Alternative | Disposition |
|---|---|
| Merge Training into Platform or rewrite Training domains | Rejected: high migration and regression cost; unnecessary for one member experience. |
| Shared database or direct cross-database queries | Rejected: couples deploys/schemas and bypasses ownership and permission boundaries. |
| Reuse Training cookie across sibling domains | Rejected: broad cookie trust boundary and no secure entitlement/link version semantics. |
| Match/link automatically by name/email/phone | Rejected: not proof of control; Training currently does not collect email/phone in registration. |
| Move passkeys into a central account now | Rejected: credentials are RP-scoped and not exportable; creates lockout and account migration risk. |
| Copy the entire Training state into Client 360 | Rejected: excess sensitive data and schema coupling. |

## Proposed person identity and facet model

This ADR remains **Proposed**. `personId` is a conceptual Platform-owned root for one human; it is not `clients.id`, `staff.auth_actor_id`, a staff/professional id, or Training `user.id`. One person may have zero or one client facet (`centralClientId`), staff facet(s) as product modeling permits, and an external Training account link (`trainingUserId`). Client records such as membership and reservations continue to use `centralClientId`.

Authentication subject → verified `personId` → domain facets is the identity relation. It does not merge authorization: Platform permissions remain scoped to Platform client/staff capabilities and Training `admin`/`trainer` roles remain local to Training. No role mapping is implied by a link. Resolve staff actor subjects to a person only through explicit proof; never treat `auth_actor_id` as the person key.

Person-level data should be minimal. Client contact/commercial fields, staff professional/operational fields and Training display/preferences remain owned by their respective domains and are not silently synchronized. Client archive, staff deactivation, Training suspension/deletion and unlink are independent lifecycle changes; unlink revokes mappings and dependent access but does not cascade-delete accounts or history. Require fresh proof of both Platform identity and the existing Training account before linking; if the person layer is unavailable, defer rather than substitute `centralClientId`.

Conceptual acceptance cases A–E (regular client, non-client trainer, trainer/client/Training, admin without Training, and Reception later acquiring a client facet) are specified in the 2J-078A integration map. Ambiguous or failed proof must fail closed. They are future implementation criteria, not changes implemented by this audit.

## Security and rollout gates

Before implementation reaches users: live snapshot revalidation; dual-proof identity tests; one-to-one link constraints; server-side authorization; replay/CSRF/redirect/session-switch tests; service identity and key rotation; PII-free logs; Health consent gate; link revocation and orphan reconciliation; independent security review; disabled-by-default flags; shadow mode; rollback exercise. No auto-merge of a security-critical integration.

## Product decisions still open

- Hub naming/information architecture.
- Whether Health appears in the Hub and under what consent/visibility rules.
- Whether membership entitlement strictly blocks Training and what offline grace behavior is acceptable.
- Which Training summary is useful in the first Hub surface and whether any staff role can see it.
- Whether Platform booking/attendance should ever be surfaced inside Training.

## Rollback

Disable summary, handoff and access flags; stop issuing one-time codes; revoke service credentials; preserve original account ids, passkeys and domain records; retain link audit; expire/purge derived caches by link version. Do not delete account links or reverse identity mappings to roll back.

## References

- [2J-078A integration map](../integrations/training/2J-078A-integration-map.md)
- Platform source snapshot: `fc97458100b45db51475b37470e75cf2bb76d687`
- Training source snapshot: `d1ea376d4834fb5ba7b419c9315a926e64a9cab4`
