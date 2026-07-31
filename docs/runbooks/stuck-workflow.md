# Stuck workflow repair

1. Confirm incident authority, tenant/cell, workflow ID, current version, generation, deadline, and customer impact.
2. Stop new dependent work without deleting workflow, inbox, outbox, usage, or audit evidence.
3. Inspect the typed failure, retry budget, capacity lease, reservation, and last completed durable step.
4. Verify whether the external effect is known-success, known-failed, or uncertain. Reconcile uncertain effects before retry.
5. Preview one of: bounded retry, compensation, cancellation, or dead-letter repair. Never edit workflow rows manually.
6. Execute an authorized repair command with expected version, rationale, incident ID, and a new fencing generation.
7. Verify aggregate invariants, reservation/usage reconciliation, outbox delivery, customer-visible operation state, and audit chain.
8. Resume admission only after the failure source and alert are resolved.

Stop if tenant identity, policy version, external-effect outcome, or current fencing generation cannot be established.
