# Application contracts

This document defines the protocol shared by HTTP handlers, workers, workflow activities, scheduled jobs, and tests. Domain methods remain transport independent.

## Command envelope

Every command contains:

```text
commandId             globally unique operation ID
commandType           stable qualified name
schemaVersion         positive integer
tenantId              resolved internal tenant
principalId           person or workload identity
subjectSessionEpoch   authorization freshness marker
resourceId            target when known
expectedVersion       optimistic concurrency token when mutating an aggregate
idempotencyKey        caller-scoped replay key
correlationId         end-to-end journey ID
causationId           command/event/workflow step that caused this command
purpose               approved processing purpose
riskTier              evaluated tier, never caller asserted
requestedAt           caller-observed UTC time
deadline              maximum useful completion time
traceContext          non-authoritative telemetry context
payload               schema-validated command body
```

The application layer authenticates, canonicalizes IDs, validates syntax and size, resolves tenant/subject, evaluates authorization and obligations, and only then calls the domain. Domain code validates business invariants. Infrastructure failures are translated at the application boundary.

`tenantId`, `principalId`, policy results, entitlement, and risk tier are derived from trusted platform state; external callers cannot override them. A command past its deadline is rejected before new external work starts.

## Command processing order

1. Authenticate transport and workload/user identity.
2. Enforce request size, schema, content type, and rate limit.
3. Resolve tenant, principal, session epoch, purpose, and resource.
4. Load idempotency record and return the bound result for an exact replay.
5. Authorize action and satisfy obligations such as consent, step-up, approval, or safety case.
6. Reserve quota/capacity when the command can create paid or asynchronous work.
7. Load aggregate with tenant predicate and expected version.
8. Execute domain transition.
9. Persist aggregate, outbox events, audit intent, and idempotency outcome atomically.
10. Return the resource or durable operation reference; never wait synchronously for an unbounded workflow.

If the same idempotency scope/key is reused with a different canonical payload hash, return `IDEMPOTENCY_CONFLICT`. Store terminal failures that occurred after authorization and business evaluation; do not permanently cache authentication, transient capacity, or dependency failures. Retention is at least the maximum client retry and webhook replay window.

## Result contract

Successful synchronous commands return the resource, its version, and correlation ID. Accepted asynchronous commands return an `Operation`:

```text
Operation {
  id, tenantId, type, resourceRef, state,
  progress { completedUnits?, totalUnits?, phase? },
  acceptedAt, startedAt?, finishedAt?, cancellable,
  resultRef?, error?, retryAfter?, version
}
```

States are `accepted`, `running`, `succeeded`, `failed`, `cancelled`, and `expired`. Terminal operations are immutable. Progress is monotonic within a phase and must not disclose hidden model reasoning or sensitive worker data.

## Typed error taxonomy

| Code | Meaning | Retry |
|---|---|---|
| `INVALID_ARGUMENT` | Syntactic/schema boundary failure | after correction |
| `UNAUTHENTICATED` | Missing, invalid, or expired identity | after reauthentication |
| `PERMISSION_DENIED` | Policy denies action; response does not reveal resource existence | no |
| `OBLIGATION_REQUIRED` | Consent, approval, step-up, or review is missing | after satisfying obligation |
| `NOT_FOUND` | Resource absent in authorized scope | no |
| `VERSION_CONFLICT` | Expected aggregate version is stale | after reload |
| `IDEMPOTENCY_CONFLICT` | Key reused for different canonical request | new key/correct request |
| `INVARIANT_VIOLATION` | Business rule rejects transition | after business change |
| `RISK_NOT_SUPPORTED` | Use case is prohibited or has no current safety case | no |
| `ENTITLEMENT_REQUIRED` | Feature/contract not enabled | after plan change |
| `QUOTA_EXHAUSTED` | Hard commercial limit reached | after release/renewal |
| `CAPACITY_UNAVAILABLE` | Safe admission unavailable | honor retry-after |
| `DEPENDENCY_UNAVAILABLE` | Required provider unavailable | bounded retry |
| `DEADLINE_EXCEEDED` | Useful execution window elapsed | caller decides |
| `CONTENT_REJECTED` | Malware, prompt injection, policy, or safety filter rejected input | after safe correction |
| `DATA_RESTRICTED` | Retention, hold, residency, sensitivity, or purpose prevents action | no/obligation |
| `ABSTAINED` | Evaluation safely completed without recommendation | not a system failure |
| `INTERNAL` | Unexpected failure with opaque incident reference | bounded retry only if marked |

HTTP uses RFC problem details with stable `type`, `code`, safe `detail`, `correlationId`, `incidentId`, violations, and `retryAfter`. Internal exception text, SQL, prompts, credentials, provider bodies, and cross-tenant identifiers never cross the boundary.

## Domain event envelope

```text
eventId, eventType, schemaVersion,
tenantId, aggregateType, aggregateId, aggregateVersion,
occurredAt, recordedAt, actorId,
correlationId, causationId, purpose,
policyDecisionRef, dataClassification,
payload
```

Event names use completed business facts. Consumers ignore unknown optional fields, reject unsupported major versions into quarantine, and deduplicate by `(consumer, eventId)`. Ordering is guaranteed only per aggregate. Events contain minimum necessary data; consumers fetch authorized detail from the owner when needed.

## Query contract

Queries are side-effect free except access audit where policy requires it. They specify pagination limit, stable sort, opaque cursor, fields/expansion, and accepted consistency class. Maximum page sizes and expansions are server controlled. Results return a data watermark and staleness when served from a projection.

## Webhook contract

Outbound webhooks are subscriptions to approved integration events, not raw outbox access. Deliveries use HTTPS, signed timestamped payloads, destination allowlists, unique delivery IDs, secret rotation overlap, bounded retry, and a dead-letter view. Receivers must tolerate duplicate and out-of-order delivery. Replays are authorized, scoped, rate limited, and audited.

Inbound provider webhooks are authenticated against raw bytes, freshness checked, schema validated, deduplicated by provider event ID, and treated as observations requiring reconciliation. They never directly authorize or perform a canonical state transition.

## Contract acceptance

- Consumer-driven and provider contract suites run for every supported API/event version.
- Property tests prove canonical payload hashing and replay behavior.
- Fuzz tests cover parsers, cursors, envelopes, webhook signatures, and problem details.
- Every public command has positive, denial, obligation, concurrency, replay, timeout, and audit assertions.
