// Fixture only: this file marks a dependency eligible, but never references the flagged
// dependency id at all, so the check has nothing to associate the call with.
declare const otherDependency: { markEligible(evidencePassed: boolean): void };
otherDependency.markEligible(true);
