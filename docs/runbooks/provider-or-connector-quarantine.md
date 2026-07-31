# Provider or connector quarantine

1. Trigger the dependency kill switch and increment the result-fencing generation.
2. Stop new admissions to the affected route/capability while preserving cancel, security, export, and erasure traffic.
3. Reject late results; classify already-issued external writes as uncertain until reconciled.
4. Preserve schemas, request/result digests, policy decisions, approvals, usage, and audit evidence without customer content in telemetry.
5. Rotate credential references out of band when compromise is suspected.
6. Mark derived evidence for review and route only to policy-approved fallbacks that preserve residency, risk, and privacy.
7. Restore through a new health/schema/identity validation and independent authorization.
