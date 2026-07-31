import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/shared/domain/index.js';
import { EncryptedInMemoryObjectStore } from '../../src/platform/persistence/index.js';
import { EvidenceRecord } from '../../src/evidence/domain/index.js';
import { LearningCandidate, OutcomeRecord } from '../../src/learning/domain/index.js';

const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));

describe('epistemic integrity and learning', () => {
  it('never reclassifies model inference as observed fact', async () => {
    const store = EncryptedInMemoryObjectStore.forTests();
    const artifact = await store.put(Buffer.from('generated'), {
      tenantId: 't', purpose: 'planning', sensitivity: 'confidential', retentionPolicyId: 'r',
    });
    expect(artifact.ok).toBe(true);
    if (!artifact.ok) return;
    const ingested = EvidenceRecord.ingest({
      id: 'e', tenantId: 't', artifact: artifact.value, sourceLocator: 'model://run',
      capturedAt: clock.now(), epistemicClass: 'model-inference', sensitivity: 'confidential',
      purposes: ['planning'], retentionPolicyId: 'r', provenance: [{ kind: 'model', reference: 'manifest' }],
    }, clock);
    expect(ingested.ok).toBe(true);
    if (!ingested.ok) return;
    expect(ingested.value.reclassify('observed-fact', 'approval').ok).toBe(false);
  });

  it('excludes generated outcomes and requires predictions before decisions', () => {
    const outcome = OutcomeRecord.open('o', 't', 'd', clock);
    expect(outcome.addPrediction({
      id: 'p', optionId: 'a', measure: 'success', predictedValue: 0.8, unit: 'probability',
      madeAt: new Date('2026-02-01'),
    }, new Date('2026-01-15')).ok).toBe(false);
  });

  it('requires independent learning approval and rolls back breached canary', () => {
    const candidate = LearningCandidate.propose('c', 't', 'author', 'router', 'manifest', clock);
    candidate.attachEvaluation([{ name: 'safety', candidate: 1, baseline: 1, direction: 'higher-is-better', requiredNonRegression: true }]);
    expect(candidate.approve('author', 'signed', 'prior').ok).toBe(false);
    expect(candidate.approve('reviewer', 'signed', 'prior').ok).toBe(true);
    candidate.startCanary({ minimumObservations: 10, maximumFailureRate: 0 });
    candidate.observeCanary(true);
    expect(candidate.state).toBe('rolled-back');
    expect(candidate.rollbackTarget()).toEqual({ ok: true, value: 'prior' });
  });
});
