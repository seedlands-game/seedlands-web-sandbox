import { createHash } from 'node:crypto';
import { authorityBaselineCaptureKeys } from '../../../src/server/authority/authority-baseline-capture';
import { createBaselineReferenceInFlightLedger } from '../../../src/server/protocol/network-reference-baseline-budget';
import {
  NETWORK_REFERENCE_BASELINE_CELL_COUNT,
  type BaselineBlockDescriptorReference,
  type BaselineBundleDescriptorReference,
  type BaselinePageReference,
  type BaselineReferenceInFlightLedger,
  type BaselineReferenceReassemblerOptions,
} from '../../../src/server/protocol/network-reference-baseline-types';
import type { InterestSessionRef } from '../../../src/server/protocol/network-reference-interest-control';

const CANONICAL_BYTES = NETWORK_REFERENCE_BASELINE_CELL_COUNT * Uint16Array.BYTES_PER_ELEMENT;
const FLUID_BYTES = NETWORK_REFERENCE_BASELINE_CELL_COUNT;
const PAGE_PAYLOAD_BYTES = CANONICAL_BYTES;

export const baselineConcurrencyRef: InterestSessionRef = Object.freeze({
  epoch: 'epoch-concurrency',
  serverEpoch: 'server-epoch-concurrency',
  sessionId: 'session-concurrency',
  worldId: 'world-concurrency',
});

export const baselineConcurrencyLimits = Object.freeze({
  metadataBytesMax: 64 * 1024,
  reliableMessageBytesMax: 1024 * 1024,
  baselineTransferBytesMax: 1024 * 1024,
  baselineInFlightBytesMax: 16 * 1024 * 1024,
  sendQueueBytesMax: 4 * 1024 * 1024,
});

type BarrierDigest = Readonly<{
  algorithm: 'sha-256';
  digest(bytes: Uint8Array): Promise<string>;
  waitForStarted(count: number): Promise<void>;
  release(): void;
}>;

export function createBarrierDigest(): BarrierDigest {
  let released = false;
  let resolveRelease!: () => void;
  const releaseGate = new Promise<void>((resolve) => {
    resolveRelease = resolve;
  });
  let started = 0;
  const waiters = new Set<Readonly<{ count: number; resolve(): void }>>();
  const notify = () => {
    for (const waiter of waiters) {
      if (started < waiter.count) continue;
      waiters.delete(waiter);
      waiter.resolve();
    }
  };
  return Object.freeze({
    algorithm: 'sha-256',
    async digest(bytes: Uint8Array): Promise<string> {
      started += 1;
      notify();
      await releaseGate;
      return sha256(bytes);
    },
    waitForStarted(count: number): Promise<void> {
      if (started >= count) return Promise.resolve();
      return new Promise((resolve) => waiters.add(Object.freeze({ count, resolve })));
    },
    release(): void {
      if (released) return;
      released = true;
      resolveRelease();
    },
  });
}

export function createImmediateDigest() {
  return Object.freeze({ algorithm: 'sha-256' as const, digest: async (bytes: Uint8Array) => sha256(bytes) });
}

export function createConcurrencyReassemblerOptions(
  digest: BaselineReferenceReassemblerOptions['digest'],
  inFlight: BaselineReferenceInFlightLedger = createBaselineReferenceInFlightLedger(
    baselineConcurrencyLimits.baselineInFlightBytesMax,
  ),
): BaselineReferenceReassemblerOptions {
  return Object.freeze({
    ref: baselineConcurrencyRef,
    limits: baselineConcurrencyLimits,
    pagesPerBundleMax: 54,
    digest,
    sizer: Object.freeze({
      measureMetadataBytes: (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength,
      measureReliableMessageBytes: (metadata: unknown, payload: Uint8Array) =>
        new TextEncoder().encode(JSON.stringify(metadata)).byteLength + payload.byteLength,
    }),
    inFlight,
  });
}

export function createConcurrencyLedger(): BaselineReferenceInFlightLedger {
  return createBaselineReferenceInFlightLedger(baselineConcurrencyLimits.baselineInFlightBytesMax);
}

export function createBaselineDescriptor(
  purpose: 'mesh' | 'collision-resync',
  bundleId: number,
): BaselineBundleDescriptorReference {
  const key = purpose === 'mesh' ? '10,0,10' : '40,0,40';
  const captureKeys = authorityBaselineCaptureKeys({ captureId: 0, purpose, key, minimumRevision: 4 });
  const keys = purpose === 'mesh' ? [key, ...captureKeys.filter((candidate) => candidate !== key)] : [key];
  const firstTransferId = bundleId * 1000;
  return Object.freeze({
    kind: 'baseline-bundle-descriptor-reference',
    projectionVersion: 1,
    wireStatus: 'not-adopted',
    ref: baselineConcurrencyRef,
    requestId: bundleId + 100,
    interestId: purpose === 'mesh' ? bundleId + 200 : null,
    bundleId,
    purpose,
    key,
    minimumRevision: 4,
    authorityCheckpoint: Object.freeze({ physicsTick: 30, commitSequence: 40, worldRevision: 50 }),
    entries: Object.freeze(
      keys.map((entryKey, entryId) => {
        const canonical = bytesFor(bundleId, entryId, 'canonical', CANONICAL_BYTES);
        const fluid = bytesFor(bundleId, entryId, 'fluid', FLUID_BYTES);
        return Object.freeze({
          entryId,
          role:
            purpose === 'collision-resync'
              ? ('collision-resync' as const)
              : entryId === 0
                ? ('main' as const)
                : ('overlay' as const),
          key: entryKey,
          chunkRevision: 4 + entryId,
          generatorVersion: 1,
          blocks: Object.freeze([
            block('canonical', firstTransferId + entryId * 2, canonical),
            block('fluid', firstTransferId + entryId * 2 + 1, fluid),
          ]) as readonly [BaselineBlockDescriptorReference, BaselineBlockDescriptorReference],
        });
      }),
    ),
  });
}

export function pagesFor(descriptor: BaselineBundleDescriptorReference): readonly BaselinePageReference[] {
  return Object.freeze(
    descriptor.entries.flatMap((entry) =>
      entry.blocks.map((blockDescriptor) => {
        const bytes = bytesFor(descriptor.bundleId, entry.entryId, blockDescriptor.name, blockDescriptor.byteLength);
        return Object.freeze({
          kind: 'baseline-page-reference' as const,
          projectionVersion: 1 as const,
          wireStatus: 'not-adopted' as const,
          ref: baselineConcurrencyRef,
          requestId: descriptor.requestId,
          interestId: descriptor.interestId,
          bundleId: descriptor.bundleId,
          purpose: descriptor.purpose,
          entryId: entry.entryId,
          transferId: blockDescriptor.transferId,
          block: blockDescriptor.name,
          pageIndex: 0,
          pageCount: 1,
          byteOffset: 0,
          bytes,
        });
      }),
    ),
  );
}

export function withPage<T extends BaselinePageReference>(
  page: T,
  changes: Partial<BaselinePageReference>,
): BaselinePageReference {
  return { ...page, ...changes };
}

export function totalBlockBytes(descriptor: BaselineBundleDescriptorReference): number {
  return descriptor.entries.reduce(
    (total, entry) => total + entry.blocks[0].byteLength + entry.blocks[1].byteLength,
    0,
  );
}

function block(name: 'canonical' | 'fluid', transferId: number, bytes: Uint8Array): BaselineBlockDescriptorReference {
  return Object.freeze({
    name,
    transferId,
    elementType: name === 'canonical' ? 'uint16-le' : 'uint8',
    elementCount: NETWORK_REFERENCE_BASELINE_CELL_COUNT,
    byteLength: bytes.byteLength,
    referencePagePayloadBytes: PAGE_PAYLOAD_BYTES,
    pageCount: 1,
    sha256: sha256(bytes),
  });
}

function bytesFor(bundleId: number, entryId: number, name: 'canonical' | 'fluid', length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const salt = bundleId * 31 + entryId * 7 + (name === 'canonical' ? 3 : 5);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index + salt) & 0xff;
  return bytes;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
