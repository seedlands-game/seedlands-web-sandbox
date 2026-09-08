import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { C0BinaryBlock } from '@seedlands/game-core/server/protocol/network-c0-codec';
import type {
  NetworkMessageClass,
  PublicInboundMessage,
  PublicSessionRef,
} from '@seedlands/game-core/server/protocol/network-message-semantics';
import {
  createBaselineReferencePublicationQueue,
  prepareAuthorityBaselineReference,
} from '@seedlands/game-core/server/protocol/network-reference-baseline';
import {
  createBaselineReferenceInFlightLedger,
  createBaselineReferenceSendQueue,
} from '@seedlands/game-core/server/protocol/network-reference-baseline-budget';
import type { BaselinePageReference } from '@seedlands/game-core/server/protocol/network-reference-baseline-types';
import type { InterestSessionRef } from '@seedlands/game-core/server/protocol/network-reference-interest-control';
import type { NodeAuthorityLane } from '../runtime/node-authority-lane';
import { playableBaselineLimits, playableNetworkLimits } from './node-playable-network-limits';

const BASELINE_PAGE_BYTES = 64 * 1024;
const digest = Object.freeze({
  algorithm: 'sha-256' as const,
  digest: async (value: Uint8Array) => createHash('sha256').update(value).digest('hex'),
});
const sizer = Object.freeze({
  measureMetadataBytes: (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8'),
  measureReliableMessageBytes: (metadata: unknown, payload: Uint8Array) =>
    Buffer.byteLength(JSON.stringify(metadata), 'utf8') + payload.byteLength + 16,
});

type BaselineMessage = Extract<PublicInboundMessage, { kind: 'interest-update' }>;
type Enqueue = (
  messageClass: NetworkMessageClass,
  message: Readonly<Record<string, unknown>>,
  blocks?: readonly C0BinaryBlock[],
) => Promise<void>;

export function createPlayableBaselineSender(
  options: Readonly<{
    authority: NodeAuthorityLane;
    transportRef: PublicSessionRef;
    interestRef: InterestSessionRef;
    generatorVersion: number;
    allocateCaptureId(): number;
    setCapture(requestId: number, captureId: number | null): void;
    isCancelled(requestId: number): boolean;
    enqueue: Enqueue;
  }>,
) {
  const publicationQueue = createBaselineReferencePublicationQueue();
  const projectionLedger = createBaselineReferenceInFlightLedger(playableNetworkLimits.baselineInFlightBytesMax);
  const sendLedger = createBaselineReferenceSendQueue(playableNetworkLimits.sendQueueBytesMax);

  const send = async (message: BaselineMessage) => {
    const cancelled = () => options.isCancelled(message.requestId);
    if (cancelled()) return;
    const [cx, cy, cz] = message.keys[0]!.split(',').map(Number) as [number, number, number];
    const snapshot = options.authority.latestSnapshot();
    if (!snapshot) throw new Error('Authority snapshot is unavailable.');
    const playerCx = Math.floor(snapshot.player.body.position.x / 32);
    const playerCz = Math.floor(snapshot.player.body.position.z / 32);
    if (cy < 0 || cy > 1 || Math.abs(cx - playerCx) > 8 || Math.abs(cz - playerCz) > 8)
      throw new Error('Interest request is outside the playable spatial budget.');
    const captureId = options.allocateCaptureId();
    options.setCapture(message.requestId, captureId);
    let bundle: ReturnType<ReturnType<typeof createBaselineReferencePublicationQueue>['publish']> | null = null;
    try {
      const capture = await options.authority.captureBaseline({
        captureId,
        purpose: 'mesh',
        key: message.keys[0]!,
        minimumRevision: 0,
      });
      if (cancelled()) return;
      const projected = await prepareAuthorityBaselineReference(capture, {
        ref: options.interestRef,
        requestId: message.requestId,
        interestId: message.requestId,
        expectedCapture: {
          captureId,
          captureGeneration: capture.captureGeneration,
          purpose: 'mesh',
          key: message.keys[0]!,
          generatorVersion: options.generatorVersion,
        },
        minimumRevision: 0,
        referencePagePayloadBytes: BASELINE_PAGE_BYTES,
        pagesPerBundleMax: 128,
        limits: playableBaselineLimits,
        digest,
        sizer,
        inFlight: projectionLedger,
      });
      if (cancelled()) {
        if ('cancel' in projected) await projected.cancel();
        return;
      }
      if (!('publish' in projected)) {
        await options.enqueue('baseline-unavailable', {
          kind: 'baseline-unavailable',
          ref: options.transportRef,
          requestId: message.requestId,
          reason: projected.reason,
        });
        return;
      }
      bundle = publicationQueue.publish(projected);
      if (cancelled()) return;
      const descriptorLease = publicationQueue.takeDescriptor(sendLedger);
      if (!descriptorLease) throw new Error('Baseline descriptor send queue is full.');
      try {
        await options.enqueue('baseline-descriptor', {
          kind: 'baseline-descriptor',
          ref: options.transportRef,
          requestId: message.requestId,
          descriptor: descriptorLease.descriptor,
        });
      } finally {
        descriptorLease.settle();
      }
      for (const entry of bundle.descriptor.entries)
        for (const block of entry.blocks)
          for (let pageIndex = 0; pageIndex < block.pageCount; pageIndex += 1) {
            if (cancelled()) return;
            const lease = bundle.materializePage({ entryId: entry.entryId, block: block.name, pageIndex }, sendLedger);
            if (!lease) throw new Error('Baseline page send queue is full.');
            const { bytes, ...page } = lease.page as BaselinePageReference;
            try {
              await options.enqueue(
                'baseline-page',
                {
                  kind: 'baseline-page',
                  ref: options.transportRef,
                  requestId: message.requestId,
                  page,
                  payloadBlock: 'payload',
                },
                [{ name: 'payload', bytes }],
              );
            } finally {
              lease.settle();
            }
          }
    } finally {
      bundle?.close();
      options.setCapture(message.requestId, null);
    }
  };

  return Object.freeze({ send, close: () => publicationQueue.close() });
}
