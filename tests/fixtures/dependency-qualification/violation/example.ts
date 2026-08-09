// Fixture only: simulates a composition root incorrectly marking a flagged dependency eligible.
const qualification = { id: 'agentdb' };
declare const dependency: { markEligible(evidencePassed: boolean): void };
dependency.markEligible(true);
