# ADR-050: Build a Reference OIDC Federation Adapter Tested Against a Real IdP

- **Status**: proposed
- **Date**: 2026-08-09
- **Deciders**:
- **Tags**: identity-access, oidc, saml, federation

## Context

`FederationPort` (`src/identity-access/infrastructure/federation-ports.ts`) declares the exact
contract ADR-011 calls for — `validate(assertion, expectedAudience, now)` mapping an external OIDC
or SAML assertion into an `ExternalIdentity` behind an anti-corruption boundary — but has zero
implementations anywhere in this codebase. Everything downstream that depends on identity (ADR-033's
`TrustedIdentityVerifier`, ADR-034's replay/rate-limit work) is real and is tested end-to-end, but
only ever against synthetic Ed25519 tokens this repository mints itself in tests. No code in this
repository has ever actually validated a token issued by a real identity provider. This is a
different, more fundamental gap than ADR-042/044's "wired but not yet trusted" — there is no
adapter here to trust or distrust yet.

This is deliberately an adopter's own IdP in production (ADR-033's "adopter supplies their own
issuer" framing is correct and unchanged by this ADR) — but a reference implementation, validated
against at least one real, standard-conformant identity provider, is what turns `FederationPort`
from an untested interface into a starting point an adopter can actually trust and adapt.

## Decision

1. **Implement one reference `FederationPort` adapter for OIDC** (SAML is real but structurally
   heavier — XML signature validation, a different assertion shape — and is scoped as a follow-on
   once the OIDC path is proven, not bundled into this ADR). The adapter validates a JWT-format
   OIDC ID token: fetches the issuer's JWKS (cached, with rotation handling — the same concern
   ADR-011 already names: "JWKS rotation... logout, revocation"), verifies signature, issuer,
   audience, expiry, and nonce/replay where applicable, and maps standard claims (`sub`, `iss`,
   plus configurable claim-to-tenant-hint mapping) into `ExternalIdentity`. This is a distinct
   code path from `TrustedIdentityVerifier` (ADR-033/034), which verifies this platform's own
   short-lived internal session tokens — `FederationPort`'s job is the one-time exchange of an
   external assertion for an internal identity, upstream of session issuance, not a replacement
   for it.
2. **Test it against a real, self-hostable OIDC provider in CI** — a lightweight, standards-conformant
   IdP (e.g., Dex or a comparable self-hosted OIDC provider, run the same way `TEST_DATABASE_URL`'s
   Postgres service container already runs in `quality.yml`) issuing real tokens signed with a real
   (test-only) key, so the adapter's JWKS-fetch, signature-verification, and claim-mapping logic is
   proven against actual OIDC wire behavior, not a hand-constructed fixture that might not match
   what a real IdP actually sends.
3. **Ship it as a documented starting point, not a production default.** An adopter's real
   deployment still supplies their own issuer configuration (unchanged from ADR-033); this ADR's
   deliverable is a correct, tested reference they can point at their own IdP and adapt, replacing
   "build this yourself against an interface with zero examples" with "start from a working
   implementation and change the parts specific to your provider."
4. **SCIM (`ScimPort`) is explicitly out of scope for this ADR** — same zero-implementation gap,
   same category of work, but a separate protocol and a separate follow-on ADR once OIDC federation
   is proven.

## Consequences

### Positive

- Closes the largest remaining "interface with no implementation" gap in the identity path — after
  this, `FederationPort` has at least one real, CI-tested implementation to point to, the same
  status every other major port in this platform already has (`BranchMemoryPort`,
  `EvidenceSearchPort`, `VectorCachePort`).
- Testing against a real IdP in CI catches integration mistakes (clock skew handling, JWKS caching
  bugs, claim-shape assumptions) that a hand-written fixture is structurally unable to catch, since
  the fixture author and the test author are the same person making the same assumptions.

### Negative

- Running a real IdP container in CI is new infrastructure (an image to pin, health-check, and
  maintain), adding to `quality.yml`'s existing Postgres service container.
- An OIDC-only reference still leaves SAML and SCIM as zero-implementation gaps; this ADR narrows
  the identity-federation gap, it does not close all of ADR-011's federation scope.

### Neutral

- This does not change ADR-033's fail-closed default (production still refuses to start without a
  configured, real issuer) — it changes what exists to point that configuration at as a documented
  starting example.

## Links

- [ADR-011](./ADR-011-enforce-tenant-isolation-and-zero-trust-authorization.md)
- [ADR-033](./ADR-033-wire-built-capabilities-into-the-runtime-path-with-fail-closed-defaults.md)
- [ADR-034](./ADR-034-close-multi-replica-and-attack-surface-gaps-in-the-wired-runtime.md)
