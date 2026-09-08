import type { AuthorityBaselineCaptureResult } from '../../../packages/game-core/src/server/authority/authority-baseline-capture-types';
import { createBaselineReferenceInFlightLedger } from '../../../packages/game-core/src/server/protocol/network-reference-baseline-budget';
import { prepareAuthorityBaselineReference } from '../../../packages/game-core/src/server/protocol/network-reference-baseline';
import type {
  BaselineReferenceProjectionContext,
  PreparedBaselineBundleReference,
} from '../../../packages/game-core/src/server/protocol/network-reference-baseline-types';

export const BASELINE_QUEUE_BYTES = 4 * 1024 * 1024;
export const baselineRef = Object.freeze({
  epoch: 'session-epoch',
  serverEpoch: 'server-epoch',
  sessionId: 'session',
  worldId: 'world',
});

export class DeferredDigest {
  readonly algorithm = 'sha-256' as const;
  readonly pending: Array<{ resolve(value: string): void; reject(error: Error): void }> = [];

  digest = () =>
    new Promise<string>((resolve, reject) => {
      this.pending.push({ resolve, reject });
    });

  release(count = this.pending.length, from = 0): void {
    this.pending.splice(from, count).forEach(({ resolve }) => resolve('a'.repeat(64)));
  }
}

export const immediateDigest = Object.freeze({
  algorithm: 'sha-256' as const,
  digest: async () => 'b'.repeat(64),
});

export function collisionCapture(
  captureId: number,
  checkpoint = { physicsTick: 1, commitSequence: 2, worldRevision: 3 },
) {
  const canonical = new Uint16Array(32 ** 3);
  canonical[0] = captureId + 1;
  const fluid = new Uint8Array(32 ** 3);
  fluid[0] = captureId + 2;
  return {
    status: 'available' as const,
    captureId,
    captureGeneration: captureId,
    purpose: 'collision-resync' as const,
    key: '0,1,0',
    checkpoint: { epoch: baselineRef.epoch, ...checkpoint },
    entries: [
      {
        role: 'collision-resync' as const,
        key: '0,1,0',
        chunkRevision: 0,
        generatorVersion: 1,
        canonical: canonical.buffer,
        fluid: fluid.buffer,
      },
    ],
  } satisfies AuthorityBaselineCaptureResult;
}

export function context(
  capture: ReturnType<typeof collisionCapture>,
  digest: BaselineReferenceProjectionContext['digest'] = immediateDigest,
  inFlight = createBaselineReferenceInFlightLedger(16 * 1024 * 1024),
): BaselineReferenceProjectionContext {
  return {
    ref: baselineRef,
    requestId: capture.captureId,
    interestId: null,
    expectedCapture: {
      captureId: capture.captureId,
      captureGeneration: capture.captureGeneration,
      purpose: capture.purpose,
      key: capture.key,
      generatorVersion: 1,
    },
    minimumRevision: 0,
    referencePagePayloadBytes: 1024,
    pagesPerBundleMax: 128,
    limits: {
      metadataBytesMax: 64 * 1024,
      reliableMessageBytesMax: 1024 * 1024,
      baselineTransferBytesMax: 1024 * 1024,
      baselineInFlightBytesMax: 16 * 1024 * 1024,
      sendQueueBytesMax: BASELINE_QUEUE_BYTES,
    },
    digest,
    sizer: {
      measureMetadataBytes: () => 32,
      measureReliableMessageBytes: (_metadata, payload) => payload.byteLength + 64,
    },
    inFlight,
  };
}

export async function prepareAvailable(
  capture: ReturnType<typeof collisionCapture>,
  options: Readonly<{
    digest?: BaselineReferenceProjectionContext['digest'];
    inFlight?: BaselineReferenceProjectionContext['inFlight'];
  }> = {},
): Promise<PreparedBaselineBundleReference> {
  const prepared = await prepareAuthorityBaselineReference(capture, context(capture, options.digest, options.inFlight));
  if (!('publish' in prepared))
    throw new Error(`Expected an available prepared baseline, received ${prepared.reason}.`);
  return prepared;
}

export async function flushDigestTurns(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
