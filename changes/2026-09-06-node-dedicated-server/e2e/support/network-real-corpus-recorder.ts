import type { AuthoritySnapshot } from '../../../../packages/game-core/src/server/authority/authority-session-types';
import type {
  AuthorityCollisionBaselineResult,
  WorldCommitResult,
} from '../../../../packages/game-core/src/server/game-server-types';
import type { ActionReceiptReference } from '../../../../packages/game-core/src/server/protocol/network-action-reference';
import {
  projectChunkBaselineReference,
  projectWelcomeReference,
  type ChunkBaselineReference,
  type ReferenceBootstrapContext,
  type ReferenceSha256DigestPort,
  type WelcomeReference,
} from '../../../../packages/game-core/src/server/protocol/network-reference-bootstrap';
import {
  projectGameplayViewReference,
  projectPlayerCorrectionReference,
  projectWorldCommitReference,
  type GameplayViewReference,
  type PlayerCorrectionReference,
  type WorldCommitReference,
} from '../../../../packages/game-core/src/server/protocol/network-reference-projection';
import type {
  AuthorityGameplayView,
  AuthorityReady,
} from '../../../../packages/game-core/src/worker/authority-worker-protocol';

/**
 * Change-local evidence helper. It records only reference projections from a
 * real Host publication; it is neither a wire encoder nor a transport API.
 */
export const NETWORK_REAL_CORPUS_REFERENCE_FORMAT = 'seedlands-network-real-corpus-reference/v1' as const;

type CapturedPayload =
  | WelcomeReference
  | PlayerCorrectionReference
  | GameplayViewReference
  | WorldCommitReference
  | ChunkBaselineReference
  | ActionReceiptReference;
type CapturedCategory =
  'welcome' | 'player-correction' | 'gameplay-view' | 'world-commit' | 'chunk-baseline' | 'action-receipt';
type CorpusBinaryBlock = Readonly<{ name: 'canonical' | 'fluid'; sha256: string; bytes: ArrayBuffer }>;

export type CapturedReferenceCorpusFrame = Readonly<{
  status: 'CAPTURED';
  direction: 'server-to-client';
  category: CapturedCategory;
  payload: CapturedPayload;
  /** UTF-8 metadata; binary baseline blocks remain complete in `binaryBlocks`. */
  payloadUtf8: Uint8Array;
  binaryBlocks: readonly CorpusBinaryBlock[];
}>;

export type NotCollectedReferenceCorpusFrame = Readonly<{
  status: 'NOT_COLLECTED';
  category: 'action-receipt' | 'chunk-baseline';
  reason: 'no-action-receipt-captured' | 'no-real-baseline-captured';
}>;

export type NetworkRealCorpusReference = Readonly<{
  format: typeof NETWORK_REAL_CORPUS_REFERENCE_FORMAT;
  frames: readonly (CapturedReferenceCorpusFrame | NotCollectedReferenceCorpusFrame)[];
}>;

const encodeCaptured = <Payload extends CapturedPayload>(
  category: CapturedCategory,
  payload: Payload,
): CapturedReferenceCorpusFrame => {
  const isBaseline = payload.kind === 'chunk-baseline-reference';
  const metadata = isBaseline
    ? {
        ...payload,
        canonical: { ...payload.canonical, bytes: undefined },
        fluid: { ...payload.fluid, bytes: undefined },
      }
    : payload;
  const text = JSON.stringify(metadata);
  if (!text) throw new TypeError(`Projected ${category} must be JSON serializable.`);
  const binaryBlocks: readonly CorpusBinaryBlock[] = isBaseline
    ? [
        { name: 'canonical', sha256: payload.canonical.sha256, bytes: payload.canonical.bytes.slice(0) },
        { name: 'fluid', sha256: payload.fluid.sha256, bytes: payload.fluid.bytes.slice(0) },
      ]
    : [];
  return {
    status: 'CAPTURED',
    direction: 'server-to-client',
    category,
    payload: structuredClone(payload),
    payloadUtf8: new TextEncoder().encode(text),
    binaryBlocks,
  };
};

/**
 * Captures an actual Host publication after its inputs have crossed the public
 * projection boundary. Absent public DTOs remain explicit gaps, never fixtures.
 */
export async function captureNetworkRealCorpusReference(
  options: Readonly<{
    ready: AuthorityReady;
    bootstrapContext: ReferenceBootstrapContext;
    snapshot: AuthoritySnapshot;
    gameplay: AuthorityGameplayView;
    commits: readonly WorldCommitResult[];
    baselines: readonly Extract<AuthorityCollisionBaselineResult, { status: 'available' }>[];
    baselineDigest: ReferenceSha256DigestPort;
    actionReceipt?: ActionReceiptReference;
    actionReceipts?: readonly ActionReceiptReference[];
  }>,
): Promise<NetworkRealCorpusReference> {
  const { snapshot } = options;
  if (options.ready.snapshot.epoch !== snapshot.epoch)
    throw new TypeError('Ready and publication snapshot must belong to the same epoch.');
  const gameplayContext = {
    epoch: snapshot.epoch,
    snapshotPhysicsTick: snapshot.physicsTick,
    snapshotCommitSequence: snapshot.commitSequence,
    snapshotWorldRevision: snapshot.worldRevision,
  } as const;
  const baselineFrames = await Promise.all(
    options.baselines.map(async (baseline) =>
      encodeCaptured(
        'chunk-baseline',
        await projectChunkBaselineReference(baseline, {
          epoch: snapshot.epoch,
          worldId: options.bootstrapContext.worldId,
          generatorVersion: options.ready.generatorVersion,
          digest: options.baselineDigest,
        }),
      ),
    ),
  );
  const actionReceipts = [...(options.actionReceipts ?? []), ...(options.actionReceipt ? [options.actionReceipt] : [])];
  if (actionReceipts.some((receipt) => receipt.transaction.epoch !== snapshot.epoch))
    throw new TypeError('Action receipt must belong to the captured publication epoch.');
  return {
    format: NETWORK_REAL_CORPUS_REFERENCE_FORMAT,
    frames: [
      encodeCaptured('welcome', projectWelcomeReference(options.ready, options.bootstrapContext)),
      encodeCaptured('player-correction', projectPlayerCorrectionReference(snapshot)),
      encodeCaptured('gameplay-view', projectGameplayViewReference(options.gameplay, gameplayContext)),
      ...options.commits.map((commit) =>
        encodeCaptured(
          'world-commit',
          projectWorldCommitReference(commit, {
            epoch: snapshot.epoch,
            publicationCommitSequenceUpperBound: snapshot.commitSequence,
          }),
        ),
      ),
      ...baselineFrames,
      ...(actionReceipts.length
        ? actionReceipts.map((receipt) => encodeCaptured('action-receipt', receipt))
        : [
            {
              status: 'NOT_COLLECTED' as const,
              category: 'action-receipt' as const,
              reason: 'no-action-receipt-captured' as const,
            },
          ]),
      ...(baselineFrames.length
        ? []
        : [
            {
              status: 'NOT_COLLECTED' as const,
              category: 'chunk-baseline' as const,
              reason: 'no-real-baseline-captured' as const,
            },
          ]),
    ],
  };
}
