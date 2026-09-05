import type { AuthoritySnapshot } from '../server/authority/authority-session';
import type { FluidAuthoritySnapshot } from '../server/fluid/fluid-transaction';
import type { WorldCommitResult } from '../server/game-server-types';
import type { LogicObservation } from '../server/logic/logic-protocol';
import type { SequenceDecision } from '../runtime/session-protocol';
import type { AuthorityGameplayView, AuthorityReady, AuthorityResponse } from '../worker/authority-worker-protocol';
import type { SerializedChunkSnapshot } from './browser-chunk-persistence';
import type { AuthorityTransportFaults } from './authority-transport';
import type { provideAuthorityBootstrap } from './authority-bootstrap-client';
import type { WorldOpenMode } from './world-version-policy';

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
