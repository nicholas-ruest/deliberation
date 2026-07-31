# ADR-032: Deliver an Accessible Human-Authority Web Application

- **Status**: proposed
- **Date**: 2026-07-31
- **Deciders**:
- **Tags**: web, accessibility, human-authority, uncertainty, security

## Context

The platform's purpose depends on humans understanding evidence, uncertainty, dissent, abstention, and authority boundaries. An API-only demo cannot establish the required interaction, accessibility, or safe communication evidence. A production UI must not turn model output into an implied decision or hide conflicting stakeholders.

## Decision

Build a separately deployable TypeScript web application against the versioned public API. It uses the trusted identity edge and contains no provider credentials or direct data-plane access. Server-side/BFF behavior may manage secure sessions and API composition but cannot bypass context APIs or policy decisions.

The application targets WCAG 2.2 AA. Every workflow is keyboard operable, screen-reader understandable, responsive, and usable without color, pointer precision, animation, or chart interpretation. Every chart has an equivalent table or structured text alternative. Focus, errors, timeouts, loading, cancellation, and long-running progress are explicit.

Decision briefs distinguish observed facts, external claims, user assertions, model inferences, and simulations. Citations are inspectable. Assumptions, limitations, dissent, sensitivity, calibration basis, abstention, and unblock conditions are first-class—not collapsed behind a score. The interface never labels a platform ranking as the user's decision. Recording a consequential decision requires authenticated human authority and an explicit confirmation boundary.

Use a strict content-security policy, output encoding, safe markdown/component rendering, dependency integrity, CSRF protection, secure cookies, and privacy-preserving telemetry. Customer content is excluded from analytics and replay by default.

## Consequences

- Accessibility and content safety become release-blocking application requirements.
- Product design must accommodate abstention and disagreement instead of optimizing only for conversion.
- API compatibility must support incremental UI deployment and assistive technology testing.

## Rejected alternatives

- **Production API with no supported human client**: cannot prove the core human-authority experience.
- **Dashboard assembled from raw model HTML/markdown**: creates XSS and authority ambiguity.
- **Automated accessibility scans alone**: cannot validate comprehension or assistive workflows.

## Acceptance evidence

- Automated WCAG scans and assisted keyboard, screen-reader, zoom, contrast, and reduced-motion reviews pass.
- Uncertainty, dissent, abstention, citation, and chart-alternative usability studies meet approved comprehension thresholds.
- XSS, CSRF, session fixation, clickjacking, unsafe redirect, and content-injection tests pass.
- Every consequential decision journey proves an authorized human performed the final action.
- Telemetry inspection proves no prompt, evidence, preference, or brief content leaks to analytics.

## Links

- [ADR-001](./ADR-001-position-as-a-human-authority-decision-laboratory.md)
- [ADR-009](./ADR-009-use-multi-objective-evaluation-with-abstention.md)
- [ADR-014](./ADR-014-publish-contract-first-apis-and-versioned-events.md)
- [ADR-023](./ADR-023-require-risk-tiered-human-oversight-and-safety-cases.md)
