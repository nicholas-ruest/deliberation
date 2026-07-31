import { createHash, verify, type KeyLike } from 'node:crypto';
import type { Result } from '../../shared/domain/result.js';

export interface ReleaseBundle {
  readonly sourceDigest: string;
  readonly apiImageDigest: string;
  readonly workerImageDigest: string;
  readonly webImageDigest: string;
  readonly sbomDigest: string;
  readonly configurationDigest: string;
  readonly schemaDigest: string;
  readonly migrationDigest: string;
  readonly evaluationDigest: string;
  readonly builderId: string;
  readonly createdAt: string;
}

export interface SignedReleaseBundle {
  readonly bundle: ReleaseBundle;
  readonly keyId: string;
  readonly signature: string;
}

export interface TrustedBuilder {
  readonly builderId: string;
  readonly publicKey: KeyLike;
  readonly revoked: boolean;
}

export const bundleDigest = (bundle: ReleaseBundle): string =>
  createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))))).digest('hex');

export interface ReleaseTransition {
  readonly approvalId: string;
  readonly environment: string;
  readonly from: string;
  readonly to: string;
  readonly bundleDigest: string;
  readonly expectedDeploymentVersion: number;
}

export interface ReleaseAuthorization extends ReleaseTransition {
  readonly approverId: string;
  readonly role: 'release';
  readonly policyDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface SignedReleaseAuthorization {
  readonly authorization: ReleaseAuthorization;
  readonly keyId: string;
  readonly signature: string;
}

export interface TrustedReleaseApprover {
  readonly approverId: string;
  readonly publicKey: KeyLike;
  readonly revoked: boolean;
}

export const authorizationDigest = (authorization: ReleaseAuthorization): string =>
  createHash('sha256').update(`deliberation.release-authorization.v1\0${canonical(authorization)}`).digest('hex');

export interface DeploymentReconciler {
  currentVersion(environment: string): Promise<number>;
  reconcile(environment: string, bundle: ReleaseBundle, expectedVersion: number): Promise<boolean>;
}

export class ReleaseAuthority {
  private readonly consumedApprovals = new Set<string>();

  constructor(
    private readonly trustedBuilders: ReadonlyMap<string, TrustedBuilder>,
    private readonly trustedApprovers: ReadonlyMap<string, TrustedReleaseApprover>,
    private readonly reconciler: DeploymentReconciler,
    private readonly currentPolicyDigest: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async promote(signed: SignedReleaseBundle, signedAuthorization: SignedReleaseAuthorization): Promise<Result<number>> {
    const builder = this.trustedBuilders.get(signed.keyId);
    const transition = signedAuthorization.authorization;
    const digest = bundleDigest(signed.bundle);
    if (!validBundle(signed.bundle) || builder === undefined || builder.revoked || builder.builderId !== signed.bundle.builderId
      || digest !== transition.bundleDigest
      || !verify(null, Buffer.from(digest), builder.publicKey, Buffer.from(signed.signature, 'base64url'))) {
      return denied('Release bundle attestation invalid');
    }
    const approver = this.trustedApprovers.get(signedAuthorization.keyId);
    const authorizationHash = authorizationDigest(transition);
    const now = this.now().getTime();
    const issuedAt = Date.parse(transition.issuedAt);
    const expiresAt = Date.parse(transition.expiresAt);
    if (approver === undefined || approver.revoked || approver.approverId !== transition.approverId
      || transition.role !== 'release' || transition.policyDigest !== this.currentPolicyDigest
      || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
      || issuedAt > now || now >= expiresAt || expiresAt <= issuedAt || expiresAt - issuedAt > 86_400_000
      || !allowedTransition(transition.from, transition.to, transition.environment)
      || !verify(null, Buffer.from(authorizationHash), approver.publicKey, Buffer.from(signedAuthorization.signature, 'base64url'))) {
      return denied('Independent release authorization invalid');
    }
    if (this.consumedApprovals.has(transition.approvalId)) return denied('Release approval replayed');
    const current = await this.reconciler.currentVersion(transition.environment);
    if (current !== transition.expectedDeploymentVersion) {
      return { ok: false, error: { code: 'VERSION_CONFLICT', message: 'Stale deployment fencing version' } };
    }
    const accepted = await this.reconciler.reconcile(transition.environment, signed.bundle, current);
    if (!accepted) return { ok: false, error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Deployment reconciliation failed' } };
    this.consumedApprovals.add(transition.approvalId);
    return { ok: true, value: current + 1 };
  }
}

const denied = (message: string): Result<never> => ({ ok: false, error: { code: 'PERMISSION_DENIED', message } });
const canonical = (value: object): string => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
const validBundle = (bundle: ReleaseBundle): boolean => {
  const digests = [
    bundle.sourceDigest, bundle.apiImageDigest, bundle.workerImageDigest, bundle.webImageDigest,
    bundle.sbomDigest, bundle.configurationDigest, bundle.schemaDigest, bundle.migrationDigest, bundle.evaluationDigest,
  ];
  return digests.every((digest) => /^[a-f0-9]{64}$/.test(digest))
    && bundle.builderId.length > 0
    && Number.isFinite(Date.parse(bundle.createdAt));
};
const allowedTransition = (from: string, to: string, environment: string): boolean => {
  const transitions: Readonly<Record<string, string>> = {
    draft: 'development',
    development: 'integration',
    integration: 'staging',
    staging: 'canary',
    canary: 'cell-expansion',
    'cell-expansion': 'general-availability',
  };
  return transitions[from] === to && environment === to;
};
