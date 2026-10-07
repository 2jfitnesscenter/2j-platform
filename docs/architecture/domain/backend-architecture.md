# Domain and backend architecture (2J-006)

## Authority and scope

This document turns the approved technical direction into implementation boundaries. `DECISIONS_2J.md` remains authoritative for product behavior. These boundaries do not define unresolved booking penalties, waitlist promotion, retention periods, or other product/legal policy. The existing `2jfitnessapp` remains separate and integrates through versioned APIs.

## Runtime shape

The API is a TypeScript/Fastify application organized by domain module. HTTP routes validate requests at the edge, invoke application use cases, and map stable errors to versioned API responses. Domain rules do not import Fastify, Drizzle, storage SDKs, or provider SDKs. Persistence adapters implement application ports. PostgreSQL is the transactional source of truth; Drizzle and reviewed SQL migrations are infrastructure details.

Each module owns its vocabulary, application use cases, persistence interfaces and adapters, and tests. `module-boundaries.json` is the machine-readable dependency allowlist. Modules may call another module only through its published application interface or an explicit application-level coordinator; they must not import another module's persistence adapter or mutate its tables directly.

## Transactions and side effects

An application use case owns one explicit unit of work. Constraints that protect uniqueness, capacity, balances, and inventory belong in PostgreSQL as well as in domain validation. Multi-record changes that must be atomic use a database transaction. Cross-module coordination is explicit and small; no distributed transaction is implied. External effects (notifications, files, provider calls) happen after commit. When reliable delivery is required, persist an outbox record in the same transaction and deliver it asynchronously with idempotency. Redis/BullMQ remain optional until an approved task requires background processing.

## Contracts and errors

Request/response schemas are runtime-validated and used to generate OpenAPI. Public contracts are versioned before external consumption. IDs are opaque stable strings at boundaries. Errors use a stable code and safe message; internal stack traces and sensitive payloads never cross the API boundary. Health checks expose process/dependency status without business data.

## Data and observability

PostgreSQL constraints and migrations are reviewed artifacts. Object storage holds binaries; PostgreSQL stores metadata and authorization context. Structured logs carry request/correlation IDs and omit credentials, health content, and document contents. The audit domain is distinct from operational logs. Sensitive access policy is specified in 2J-007 before implementation.

## Testing and rollout

Pure domain rules receive unit tests. Persistence adapters and transaction behavior receive integration tests against PostgreSQL. API contracts receive schema/contract tests; critical customer flows receive E2E coverage before rollout. Migrations must be forward-reviewed and have documented recovery considerations. This task creates architecture contracts only: no runtime server, schema migration, authentication, payment, or production feature is introduced.

## Decisions still gated

No business rule or product behavior is inferred here. Database and framework remain the approved technical direction in `TECH_ARCHITECTURE.md`. Any change to those foundations needs an ADR. Legal retention, identity provider, payment provider, and unresolved booking rules require their own approval.
