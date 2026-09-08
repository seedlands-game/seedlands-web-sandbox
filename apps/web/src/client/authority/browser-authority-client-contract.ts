import type { AuthoritySnapshot } from '@seedlands/game-core/server/authority/authority-session';
import type { FluidAuthoritySnapshot } from '@seedlands/game-core/server/fluid/fluid-transaction';
import type { WorldCommitResult } from '@seedlands/game-core/server/game-server-types';
import type { LogicObservation } from '@seedlands/game-core/server/logic/logic-protocol';
import type { SequenceDecision } from '@seedlands/game-core/runtime/session-protocol';
import type {
  AuthorityGameplayView,
  AuthorityMeshPayload,
  AuthorityReady,
  AuthorityResponse,
} from '@seedlands/game-core/compute/authority-worker-protocol';
import type { SerializedChunkSnapshot } from '../persistence/browser-chunk-persistence';
import type { AuthorityTransportFaults } from './authority-transport';
import type { provideAuthorityBootstrap } from './authority-bootstrap-client';
import type { WorldOpenMode } from '@seedlands/game-core/runtime/world-version-policy';

export type AuthorityWorkerPort = {
  onmessage: ((event: MessageEvent<AuthorityResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
};

export type AuthorityClientOptions = Readonly<{
  onSnapshot?: (snapshot: AuthoritySnapshot) => void;
  onGameplay?: (view: AuthorityGameplayView) => void;
  onCommit?: (commit: WorldCommitResult) => void;
  onFluidWork?: (snapshot: FluidAuthoritySnapshot) => void;
  onLogicObservation?: (observation: LogicObservation) => void;
  onBootstrapGeneration?: Parameters<typeof provideAuthorityBootstrap>[1];
  onUnknownChunk?: (key: string) => void;
  onAuthorityChunkNeeded?: (key: string) => void;
  onInputDecision?: (decision: { sequence: number; decision: SequenceDecision; requiresResync: boolean }) => void;
  onFatal?: (error: Error) => void;
  requestTimeoutMs?: number;
  transportFaults?: AuthorityTransportFaults;
}>;

export type AuthorityStartOptions = Readonly<{
  seedText: string;
  openMode: WorldOpenMode;
  legacySnapshots: readonly SerializedChunkSnapshot[];
  initialWorldTime: number;
  frequencies: AuthorityReady['frequencies'];
}>;

export type AuthoritySaveResult = Readonly<{
  savedChunks: string[];
  gameplaySaved: boolean;
  commitSequence: number;
  storageBytes: number;
}>;

export type AuthorityCachedMesh = {
  canonical: Uint16Array;
  fluid: Uint8Array;
  chunkRevision: number;
};

export type AuthorityCachedPreparation = {
  payload: AuthorityMeshPayload;
  canonical?: Uint16Array;
  fluid?: Uint8Array;
  overlays: Array<{ cx: number; cy: number; cz: number; voxels: Uint16Array; fluid?: Uint8Array }>;
};
