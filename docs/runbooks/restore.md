# PostgreSQL and object restore

1. Declare the incident and select an approved region/cell and restore point within tenant residency policy.
2. Create an isolated recovery environment with separate workload identities and no customer traffic.
3. Verify backup/object version signatures, checksums, encryption-key availability, and immutable retention.
4. Restore PostgreSQL and versioned objects; apply forward-compatible migrations.
5. Replay the erasure/restriction deny-list before enabling any read path.
6. Rebuild projections, search, vectors, and caches from canonical watermarks.
7. Reconcile tenant counts, aggregate versions, outbox/inbox, audit-chain continuity, reservations/usage, and object hashes.
8. Run tenant-isolation and synthetic safe-deliberation/cancellation probes.
9. Record measured RPO/RTO and evidence digests. Obtain cutover approval or destroy the quarantined restore.

Never fail over across a residency boundary or restore accessible erased data to meet an availability target.
