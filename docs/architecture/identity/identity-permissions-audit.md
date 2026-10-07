# Identity, permissions, and audit boundary (2J-007)

## Scope

This is a server-side policy contract only. It does not select an identity provider, session transport, credential flow, legal retention period, or production auth library. No provider provisioning or customer login is included.

## Roles and authorization

The role names follow approved `DECISIONS_2J.md`: Admin, Entrenador, Recepción/Gestión, and Contable. `packages/permissions/role-permissions.json` records the action-level starter matrix strictly where source decisions support it. Every request is checked on the server; UI visibility is not authorization. Unknown roles and permissions deny. Explicit denies override grants, including the Admin wildcard. The permission registry is explicit: adding an operation requires adding and reviewing its identifier before the Admin wildcard can grant it.

Contable intentionally has no effective grants until its exact economic/fiscal scope is approved. The high-level approved statement that it may access necessary economic/fiscal information is not enough to infer specific actions. Health fields/purposes and role administration grants remain gated too. Trainer access to clients reflects the approved all-clients rule; finer health access must be product-reviewed before sensitive runtime functionality.

## Session lifecycle contract

Session token verification is an infrastructure responsibility. Once cryptographically verified, the server checks expiration, issuance time, and an actor session version against authoritative storage. Incrementing that version after credential change, role change, or revocation invalidates prior sessions deterministically. Native/web cookie and token details require a separate approved provider/transport decision. No credentials are stored here.

## Audit envelope

`packages/audit/audit-event.schema.json` defines the machine-readable envelope. Events record actor, action, resource, outcome, timestamp and correlation ID. Optional changes are short summaries only. Credential, health/diagnosis, and document-content keys are rejected. Audit storage is append-only by contract; application access must not expose update/delete methods. Sensitive reads, denied access, and administrative overrides should be auditable when their product policy is approved. Audit retention and deletion require explicit legal review.

## Tests and implementation gates

Synthetic tests cover the approved role matrix, deny-by-default, explicit denies, session epoch revocation, malformed/expired claims, audit validation, and sensitive-field exclusion. Before implementing a production identity provider, role editor, retention policy, or broader health/accountant access, create a decision/ADR with Juanjo. This package is not a compliance certification.
