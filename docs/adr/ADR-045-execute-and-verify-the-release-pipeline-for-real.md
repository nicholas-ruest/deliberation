# ADR-045: Execute and Verify the Release Pipeline for Real

- **Status**: proposed
- **Date**: 2026-08-09
- **Deciders**:
- **Tags**: release, ci, supply-chain

## Context

`.github/workflows/release.yml` (ADR-033/034 era work) builds, SBOMs, and keylessly signs three
container images on a `v*.*.*` tag push, gated on the same quality check as any pull request. It
has never actually run: no tag has ever been cut, no image has ever reached `ghcr.io`, and the
repository's GHCR package-write permission — required for the workflow's `packages: write` job
permission to actually succeed — has never been confirmed enabled in this repository's own
settings, since that is a manual, human-only action (`docs/adr/ADR-033...`'s own implementation
notes flagged this as a human follow-up and it was never closed out).

A CI/CD pipeline that has never executed is a design document with workflow-YAML syntax, not
verified infrastructure. Every claim this repository makes about signed, verifiable release
artifacts (the README's "Releases and versioning" section, the `cosign verify` example it shows
adopters) is currently unverified against a real run.

## Decision

Run the pipeline for real, once, deliberately, as a verification exercise — not folded silently
into unrelated feature work:

1. **Human prerequisite, done first and explicitly**: enable GHCR package-write for this
   repository (Settings → Actions → Workflow permissions, or the repository's package-visibility
   settings) and set the resulting packages to the intended visibility (public, matching the
   `cosign verify` example's assumption of a publicly pullable image). This ADR names it as a
   required, tracked step rather than leaving it as an unclosed note.
2. **Cut a real `v0.1.0` tag** matching `package.json`'s current version and `CHANGELOG.md`'s
   existing `[0.1.0]` section (already present, satisfying `check-version.ts`'s tag-vs-changelog
   check) and push it, triggering `release.yml` for the first time.
3. **Verify every stage actually did what it claims**, not just that the workflow went green:
   - the `quality` prerequisite job ran the full gate, not a cached/skipped result;
   - all three images (api, web, worker) built and pushed, tagged both `v0.1.0` and `latest`;
   - `cosign verify` (the exact command in the README) succeeds against the real pushed digest,
     run from outside the CI environment (a fresh local shell), not only inside the job that
     produced the signature;
   - the CycloneDX SBOM attestation is retrievable and matches the image's actual installed
     dependency set.
4. **Fix whatever that reveals**, then re-tag if needed (`v0.1.1`) rather than force-pushing or
   deleting the first tag — a failed first attempt is itself useful evidence, not something to
   erase.
5. **Record the result** in `docs/implementation/` alongside the other prompt-evidence documents,
   naming the actual tag, the actual image digests, and the actual `cosign verify` output —
   replacing "the pipeline is defined but has not been run" in the README with a real, dated claim.

## Consequences

### Positive

- Converts an unverified design into a verified one; every subsequent release inherits confidence
  from a real precedent instead of an untested workflow file.
- Surfaces integration problems (GHCR permissions, cosign OIDC trust configuration, SBOM format
  mismatches) once, deliberately, rather than during a future release under time pressure.

### Negative

- This is an inherently manual, one-time verification exercise — it cannot be fully automated
  away (someone has to look at the real output and confirm it's correct), and it requires
  repository-admin access this ADR cannot itself grant.
- Publishing a real `v0.1.0` image, even privately, is a step that is easy to get wrong once and
  hard to fully undo (a public registry may cache a bad image even after it's deleted) — the
  verification steps above exist specifically to catch problems before wider adoption depends on
  the artifact.

### Neutral

- This ADR does not change the release workflow's design (ADR-033/034's work); it only verifies
  the design against reality and requires acting on what that reveals.

## Links

- [ADR-033](./ADR-033-wire-built-capabilities-into-the-runtime-path-with-fail-closed-defaults.md)
- [ADR-034](./ADR-034-close-multi-replica-and-attack-surface-gaps-in-the-wired-runtime.md)
- [ADR-030](./ADR-030-separate-build-attestation-from-release-authority.md)
