import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Result } from '../../shared/domain/result.js';

export interface DataPlaneContext {
  readonly tenantId: string;
  readonly principalId: string;
  readonly cellId: string;
}

export interface WrappedDataKey {
  readonly keyReference: string;
  readonly ciphertext: Uint8Array;
}

export interface EnvelopeKeyService {
  generate(context: DataPlaneContext): Promise<{ plaintext: Uint8Array; wrapped: WrappedDataKey }>;
  unwrap(context: DataPlaneContext, key: WrappedDataKey): Promise<Uint8Array>;
  rotate(context: DataPlaneContext, key: WrappedDataKey): Promise<WrappedDataKey>;
  destroy(context: DataPlaneContext, keyReference: string): Promise<void>;
}

export interface BlobClient {
  put(key: string, ciphertext: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
}

export interface ManagedObjectMetadata {
  readonly opaqueKey: string;
  readonly ownerContext: string;
  readonly contentHash: string;
  readonly keyReference: string;
  readonly sensitivity: string;
  readonly purpose: string;
  readonly retentionPolicy: string;
  readonly encryptionNonce: string;
  readonly authenticationTag: string;
  readonly wrappedDataKey: string;
  readonly creatorPrincipalId: string;
}

export class ManagedImmutableObjectStore {
  constructor(private readonly blobs: BlobClient, private readonly keys: EnvelopeKeyService) {}

  async put(
    context: DataPlaneContext,
    ownerContext: string,
    content: Uint8Array,
    policy: Pick<ManagedObjectMetadata, 'sensitivity' | 'purpose' | 'retentionPolicy'>,
  ): Promise<Result<ManagedObjectMetadata>> {
    const contentHash = createHash('sha256').update(content).digest('hex');
    const generated = await this.keys.generate(context);
    if (generated.plaintext.byteLength !== 32) {
      return { ok: false, error: { code: 'INVARIANT_VIOLATION', message: 'Envelope data key must be 256 bits' } };
    }
    const opaqueKey = `${context.cellId}/${hash(context.tenantId)}/${crypto.randomUUID()}`;
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', generated.plaintext, nonce);
    const aad = metadataAad(context, opaqueKey, ownerContext, contentHash, generated.wrapped.keyReference, policy);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(content), cipher.final()]);
    const authenticationTag = cipher.getAuthTag();
    await this.blobs.put(opaqueKey, ciphertext);
    return { ok: true, value: {
      opaqueKey, ownerContext, contentHash, keyReference: generated.wrapped.keyReference,
      creatorPrincipalId: context.principalId,
      wrappedDataKey: Buffer.from(generated.wrapped.ciphertext).toString('base64url'),
      encryptionNonce: nonce.toString('base64url'), authenticationTag: authenticationTag.toString('base64url'), ...policy,
    } };
  }

  async get(context: DataPlaneContext, metadata: ManagedObjectMetadata, wrapped: WrappedDataKey): Promise<Result<Uint8Array>> {
    if (!metadata.opaqueKey.startsWith(`${context.cellId}/${hash(context.tenantId)}/`)
      || context.principalId !== metadata.creatorPrincipalId
      || wrapped.keyReference !== metadata.keyReference
      || Buffer.from(wrapped.ciphertext).toString('base64url') !== metadata.wrappedDataKey) {
      return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'Object cell or tenant partition mismatch' } };
    }
    const ciphertext = await this.blobs.get(metadata.opaqueKey);
    if (ciphertext === undefined) return { ok: false, error: { code: 'NOT_FOUND', message: 'Object not found' } };
    const key = await this.keys.unwrap(context, wrapped);
    if (key.byteLength !== 32) {
      return { ok: false, error: { code: 'CONTENT_REJECTED', message: 'Invalid envelope data key' } };
    }
    let content: Uint8Array;
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(metadata.encryptionNonce, 'base64url'));
      decipher.setAuthTag(Buffer.from(metadata.authenticationTag, 'base64url'));
      decipher.setAAD(metadataAad(context, metadata.opaqueKey, metadata.ownerContext, metadata.contentHash, metadata.keyReference, metadata));
      content = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      return { ok: false, error: { code: 'CONTENT_REJECTED', message: 'Object authentication failed' } };
    }
    if (hashBytes(content) !== metadata.contentHash) {
      return { ok: false, error: { code: 'CONTENT_REJECTED', message: 'Object content hash mismatch' } };
    }
    return { ok: true, value: content };
  }

  async erase(context: DataPlaneContext, metadata: ManagedObjectMetadata): Promise<Result<void>> {
    if (!metadata.opaqueKey.startsWith(`${context.cellId}/${hash(context.tenantId)}/`)
      || context.principalId !== metadata.creatorPrincipalId) {
      return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'Object cell or tenant partition mismatch' } };
    }
    await this.keys.destroy(context, metadata.keyReference);
    await this.blobs.delete(metadata.opaqueKey);
    return { ok: true, value: undefined };
  }
}

const hash = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 24);
const hashBytes = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');
const metadataAad = (
  context: DataPlaneContext,
  opaqueKey: string,
  ownerContext: string,
  contentHash: string,
  keyReference: string,
  policy: Pick<ManagedObjectMetadata, 'sensitivity' | 'purpose' | 'retentionPolicy'>,
): Buffer => Buffer.from(JSON.stringify({
  cellId: context.cellId, tenantPartition: hash(context.tenantId), principalId: context.principalId,
  opaqueKey, ownerContext, contentHash, keyReference, sensitivity: policy.sensitivity,
  purpose: policy.purpose, retentionPolicy: policy.retentionPolicy,
}));
