import { BrowserAuthorityClient } from '../client/authority/browser-authority-client';
import { BrowserComputeRuntime } from '../client/compute/browser-compute-runtime';
import { BrowserLogicClient } from '../client/authority/browser-logic-client';
import { createSessionEpoch, type SequenceDecision } from '../runtime/session-protocol';
import type { AuthoritySnapshot } from '../server/authority/authority-session';
import type { FluidAuthoritySnapshot } from '../server/fluid/fluid-transaction';
import type { LogicObservation } from '../server/logic/logic-protocol';
import type { WorldCommitResult } from '../server/game-server-types';
import type { SerializedChunkSnapshot } from '../client/persistence/browser-chunk-persistence';
import type { WorldOpenMode } from '../client/world-version-policy';
import type { AuthorityGameplayView } from '../worker/authority-worker-protocol';
import type { AuthorityTransportFaults } from '../client/authority/authority-transport';
import type { WasmWorkerSelection } from '../compute/wasm-kernel-contract';

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
  wasm: WasmWorkerSelection;
  frequencies: Readonly<{ physicsHz: 30 | 60 | 120; gameplayHz: 10 | 20; fluidHz: 20 | 30 }>;
  authorityTransportFaults?: AuthorityTransportFaults;
  onSnapshot: (snapshot: AuthoritySnapshot) => void;
  onGameplay: (view: AuthorityGameplayView) => void;
  onPlayerDeath: () => void;
  onCommit: (commit: WorldCommitResult) => void;
  onUnknownChunk: (key: string) => void;
  onInputDecision: (decision: { sequence: number; decision: SequenceDecision; requiresResync: boolean }) => void;
  onFatal: (error: Error) => void;
}>;

export async function startBrowserWorkerSession(options: Options): Promise<BrowserWorkerSession> {
  const epoch = createSessionEpoch(`seedlands:${options.seedText}`, options.epochSequence);
  let authorityReady: BrowserWorkerSession['ready'] | null = null;
  const queuedAuthorityChunks = new Set<string>();
  const generatingAuthorityChunks = new Set<string>();
  const compute = new BrowserComputeRuntime({
    epoch,
    generalWorkerCount: options.generalWorkerCount,
    wasm: options.wasm,
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
  const generateAuthorityChunk = (key: string) => {
    if (!authorityReady) {
      queuedAuthorityChunks.add(key);
      return;
    }
    if (generatingAuthorityChunks.has(key)) return;
    generatingAuthorityChunks.add(key);
    void compute
      .generateCanonicalChunk(authorityReady.seed, authorityReady.generatorVersion, key)
      .then((chunk) =>
        authority.acceptWorkerCanonical(
          {
            chunkKey: chunk.key,
            cx: chunk.cx,
            cy: chunk.cy,
            cz: chunk.cz,
            chunkRevision: chunk.chunkRevision,
            generatorVersion: chunk.generatorVersion,
          },
          { canonical: chunk.voxels, generatorVersion: chunk.generatorVersion },
        ),
      )
      .catch(() => false)
      .finally(() => generatingAuthorityChunks.delete(key));
  };
  const authority = BrowserAuthorityClient.create(epoch, {
    onSnapshot: options.onSnapshot,
    onGameplay: (view) => {
      options.onGameplay(view);
      if (view.player.lifecycle === 'dead') options.onPlayerDeath();
    },
    onCommit: options.onCommit,
    onFluidWork: (snapshot: FluidAuthoritySnapshot) => compute.enqueueFluid(snapshot),
    onLogicObservation: (observation: LogicObservation) => logic.sendObservation(observation),
    onBootstrapGeneration: ({ seed, generatorVersion }) => compute.findSafeSpawn(seed, generatorVersion),
    onAuthorityChunkNeeded: generateAuthorityChunk,
    onUnknownChunk: options.onUnknownChunk,
    onInputDecision: options.onInputDecision,
    onFatal: options.onFatal,
    transportFaults: options.authorityTransportFaults,
  });
  try {
    await logic.start(options.harnessEnabled, options.frequencies.physicsHz);
    const ready = await authority.start({
      seedText: options.seedText,
      openMode: options.openMode,
      legacySnapshots: options.legacySnapshots,
      initialWorldTime: options.initialWorldTime,
      frequencies: options.frequencies,
    });
    authorityReady = ready;
    queuedAuthorityChunks.forEach(generateAuthorityChunk);
    queuedAuthorityChunks.clear();
    return { authority, compute, logic, ready };
  } catch (error) {
    logic.dispose();
    authority.dispose();
    compute.dispose();
    throw error;
  }
}
