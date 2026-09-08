import type { ReassembledBaselineReference } from '@seedlands/game-core/server/protocol/network-reference-baseline-types';
import type { InterestSessionRef } from '@seedlands/game-core/server/protocol/network-reference-interest-control';
import type {
  AuthorityCollisionCachedChunk,
  AuthorityCollisionCommit,
  AuthorityCollisionRevisionGuard,
} from './authority-collision-mirror';

export type NetworkBaselineOwnerRef = Readonly<{
  ref: InterestSessionRef;
  ownerId: number;
  ownerGeneration: number;
  requestId: number;
  interestId: number | null;
  purpose: 'mesh' | 'collision-resync';
  key: string;
  generatorVersion: number;
  expectedEntries: readonly Readonly<{ key: string; minimumRevision: number }>[];
}>;

export type NetworkBaselineConsumerLimits = Readonly<{
  ownersMax: number;
  sharedCollisionBytesMax: number;
  sharedPreparationBytesMax: number;
  workerTransferBytesMax: number;
}>;

export type NetworkBaselineOwnerHandle = Readonly<{
  ownerId: number;
  ownerGeneration: number;
}>;

export type AuthorityCompleteMeshInputReference = Readonly<{
  inputStrategy: 'authority-complete';
  chunkRevision: number;
  generatorVersion: number;
  haloRevision: string;
  canonical: Uint16Array;
  fluid: Uint8Array;
  overlays: readonly Readonly<{
    cx: number;
    cy: number;
    cz: number;
    voxels: Uint16Array;
    fluid: Uint8Array;
  }>[];
}>;

export type NetworkBaselineWorkerSnapshotLease = Readonly<{
  input: AuthorityCompleteMeshInputReference;
  settle(): void;
}>;

export type NetworkBaselineWorkerResultIdentity = Readonly<{
  key: string;
  chunkRevision: number;
  generatorVersion: number;
  haloRevision: string;
  canonical: ArrayBuffer;
}>;

export type NetworkBaselineAcceptResult =
  | Readonly<{ status: 'accepted'; haloRevision: string | null }>
  | Readonly<{ status: 'satisfied-by-newer' }>
  | Readonly<{
      status: 'rejected';
      reason: 'late-owner' | 'identity-mismatch' | 'superseded' | 'resource-limit' | 'conflicting-content';
    }>;

export type NetworkBaselineConsumerDiagnostics = Readonly<{
  activeOwners: number;
  ownedKeys: number;
  trackedRevisionKeys: number;
  sharedCollisionBytes: number;
  sharedPreparationBytes: number;
  sharedPreparationEntries: number;
  workerTransferBytes: number;
  activeWorkerSnapshots: number;
  ownerGenerationHighWatermark: number;
  untrackedPeakBytesStatus: 'NOT_COLLECTED';
  closed: boolean;
}>;

export type NetworkBaselineConsumer = Readonly<{
  registerOwner(owner: NetworkBaselineOwnerRef): NetworkBaselineOwnerHandle;
  accept(owner: NetworkBaselineOwnerHandle, bundle: ReassembledBaselineReference): NetworkBaselineAcceptResult;
  snapshotForWorker(owner: NetworkBaselineOwnerHandle): NetworkBaselineWorkerSnapshotLease | null;
  acceptWorkerResult(owner: NetworkBaselineOwnerHandle, result: NetworkBaselineWorkerResultIdentity): boolean;
  observeChunkRevisions(revisions: readonly Readonly<{ key: string; revision: number }>[]): readonly number[];
  consumeCollisionCommits<Commit extends AuthorityCollisionCommit>(
    commits: readonly Commit[] | undefined,
    callbacks?: Readonly<{ onCommit?(commit: Commit): void; onUnknownChunk?(key: string): void }>,
  ): void;
  releaseOwner(owner: NetworkBaselineOwnerHandle): void;
  close(): Promise<void>;
  whenIdle(): Promise<void>;
  diagnostics(): NetworkBaselineConsumerDiagnostics;
}>;

export type NetworkBaselineConsumerOptions = Readonly<{
  limits: NetworkBaselineConsumerLimits;
  collisionChunks: Map<string, AuthorityCollisionCachedChunk>;
  collisionGuard: AuthorityCollisionRevisionGuard;
}>;
