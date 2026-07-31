# ADR-029: Establish a Trusted API Edge and Workload Identity

- **Status**: proposed
- **Date**: 2026-07-31
- **Deciders**:
- **Tags**: api, identity, oidc, zero-trust, rate-limits

## Context

The demo route trusts caller-supplied tenant and principal headers. That is explicitly unsafe for production. Production must authenticate humans and services, resolve tenant membership, enforce purpose/risk policy, protect request boundaries, and propagate identity without trusting user-controlled metadata.

## Decision

Place a managed API gateway/WAF in front of the public API. It terminates TLS, applies bounded request sizes, rate and concurrency limits, bot/abuse controls, and forwards only to private API workloads. Public clients never reach workers, databases, workflow services, or connector endpoints.

Human sessions authenticate through tenant-configured OIDC or SAML mapped by the Identity context. Service clients use OAuth 2.0 client credentials or workload federation. The API validates issuer, audience, signature, expiry, nonce/session state, tenant membership, and session epoch. It derives tenant and principal context from verified identity and resource routing; it ignores or rejects caller assertions that conflict.

Internal service calls use mutually authenticated workload identities and short-lived audience-bound tokens. Authorization remains in platform policy, not the gateway. Every command requires server-side authorization, idempotency, correlation, tenant, principal, purpose, and resource scope. Step-up and human-review obligations use one-time, resource-bound receipts.

CSRF, CORS, redirect, cookie, token storage, replay, and logout behavior are explicitly configured per client type. Break glass is time-bound, independently approved, fully audited, and cannot silently impersonate a customer.

## Consequences

- The local header-based demo remains isolated behind an explicit development-only switch.
- Identity-provider availability and key rotation become measured dependencies.
- Authentication success alone never grants domain authorization.

## Rejected alternatives

- **Trusting `x-tenant-id` or `x-principal-id`**: permits trivial impersonation.
- **Gateway-only authorization**: lacks domain resource, purpose, consent, and safety context.
- **Long-lived static service keys**: increase compromise and rotation risk.

## Acceptance evidence

- Forged, expired, wrong-audience, replayed, confused-deputy, and tenant-conflicting tokens fail closed.
- Federation, SCIM, revocation, session-epoch, logout, and key-rotation contracts pass.
- Authorization tests cover every public command and consequential side effect.
- Rate, body-size, WAF, and overload controls protect downstream capacity.
- Workload identity tests prove services cannot assume another workload or cell identity.

## Links

- [ADR-011](./ADR-011-enforce-tenant-isolation-and-zero-trust-authorization.md)
- [ADR-014](./ADR-014-publish-contract-first-apis-and-versioned-events.md)
- [ADR-024](./ADR-024-make-enterprise-lifecycle-and-support-first-class.md)
