import { BrowserAuthorityClient } from '../client/browser-authority-client';
import { BrowserComputeRuntime } from '../client/browser-compute-runtime';
import { BrowserLogicClient } from '../client/browser-logic-client';
import { createSessionEpoch, type SequenceDecision } from '../runtime/session-protocol';
import type { AuthoritySnapshot } from '../server/authority/authority-session';
import type { FluidAuthoritySnapshot } from '../server/fluid/fluid-transaction';
import type { LogicObservation } from '../server/logic/logic-protocol';
import type { WorldCommitResult } from '../server/game-server-types';
import type { SerializedChunkSnapshot } from '../client/browser-chunk-persistence';
import type { WorldOpenMode } from '../client/world-version-policy';
import type { AuthorityGameplayView } from '../worker/authority-worker-protocol';

export type BrowserWorkerSession = Readonly<{
  authority: BrowserAuthorityClient;
  compute: BrowserComputeRuntime;
  logic: BrowserLogicClient;
  ready: NonNullable<BrowserAuthorityClient['readyState']>;
}>;

type Options = Readonly<{
  epochSequence: number;
  seedText: string;
  openMode: WorldOpenMode;
  legacySnapshots: readonly SerializedChunkSnapshot[];
  initialWorldTime: number;
  harnessEnabled: boolean;
  generalWorkerCount: 1 | 2;
  onSnapshot: (snapshot: AuthoritySnapshot) => void;
  onGameplay: (view: AuthorityGameplayView) => void;
  onCommit: (commit: WorldCommitResult) => void;
  onUnknownChunk: (key: string) => void;
  onInputDecision: (decision: { sequence: number; decision: SequenceDecision; requiresResync: boolean }) => void;
  onFatal: (error: Error) => void;
}>;

export async function startBrowserWorkerSession(options: Options): Promise<BrowserWorkerSession> {
  const epoch = createSessionEpoch(`seedlands:${options.seedText}`, options.epochSequence);
  const compute = new BrowserComputeRuntime({
    epoch,
    generalWorkerCount: options.generalWorkerCount,
    onFluidCandidate: (candidate) => authority.commitFluid(candidate),
    onFluidFailure: (workId, error) => authority.failFluid(workId, error.message),
  });
  const logic = BrowserLogicClient.create(epoch, {
    onIntents: (batch) => {
      authority.sendLogicIntents(batch);
      authority.requestLogicObservation();
    },
    onFatal: options.onFatal,
  });
  const authority = BrowserAuthorityClient.create(epoch, {
    onSnapshot: options.onSnapshot,
    onGameplay: options.onGameplay,
    onCommit: options.onCommit,
    onFluidWork: (snapshot: FluidAuthoritySnapshot) => compute.enqueueFluid(snapshot),
    onLogicObservation: (observation: LogicObservation) => logic.sendObservation(observation),
    onBootstrapGeneration: ({ seed, generatorVersion }) => compute.findSafeSpawn(seed, generatorVersion),
    onUnknownChunk: options.onUnknownChunk,
    onInputDecision: options.onInputDecision,
    onFatal: options.onFatal,
  });
  try {
    await logic.start(options.harnessEnabled, 60);
    const ready = await authority.start({
      seedText: options.seedText,
      openMode: options.openMode,
      legacySnapshots: options.legacySnapshots,
      initialWorldTime: options.initialWorldTime,
    });
    return { authority, compute, logic, ready };
  } catch (error) {
    logic.dispose();
    authority.dispose();
    compute.dispose();
    throw error;
  }
}
