import type { ChunkPersistenceCorpusSummary } from '../client/persistence/browser-chunk-persistence';
import type { BrowserAuthorityClient } from '../client/authority/browser-authority-client';
import type { BrowserComputeRuntime } from '../client/compute/browser-compute-runtime';
import type { BrowserLogicClient } from '../client/authority/browser-logic-client';
import type * as pc from 'playcanvas';
import type { ChunkPersistenceLoadScenario } from '../client/persistence/chunk-persistence-benchmark';
import type { PerformanceTelemetry } from '../client/presentation/performance-telemetry';
import type { FillCommand } from '@seedlands/game-core/server/commands/fill-command';
import type { CommandResult, ServerCommand } from '@seedlands/game-core/server/commands/command-contract';
import { Voxel } from '@seedlands/game-core/world/voxel';
import type { HarnessSnapshot, LifecycleSnapshot, StreamingVariant } from './app-contracts';
import type { PlayerController } from './player/player-controller';
import type { QualityLevel } from './scene/quality-profile';
import { FINAL_RENDER_PIPELINE } from './scene/voxel-render-pipeline';
import type { WorldEnvironment } from './scene/world-environment';
import type { World } from './world/world-runtime';
import type { UiMetrics } from './ui/ui-contracts';
import type { AdvancedVisualEffects } from './scene/advanced-visual-effects';
import type { BrowserGameplay } from './gameplay/browser-gameplay';
import type { UnderwaterVisualEffects } from './scene/underwater-visual-effects';
import { PLAYER_FEET_OFFSET } from './player/player-view-offsets';
import type { CollisionDebugRuntime } from './player/collision-debug-runtime';
import type { FluidFeedbackTarget } from './gameplay/fluid-feedback-tracker';
import type { AuthorityBodySnapshot } from '@seedlands/game-core/server/authority/authority-session-types';
import type { WorldHarnessPort } from '@seedlands/game-core/server/harness/world-harness-contract';

export type HarnessApi = {
  world: WorldHarnessPort;
  snapshot: () => HarnessSnapshot;
  lifecycleSnapshot: () => LifecycleSnapshot;
  restartWorld: (seed: string) => Promise<void>;
  moveTo: (x: number, z: number) => Promise<void>;
  burstEdits: () => Promise<void>;
  fillWorld: (command: FillCommand) => Promise<unknown>;
  removeVoxelAt: (x: number, y: number, z: number) => Promise<void>;
  movePlayerTo: (x: number, y: number, z: number) => Promise<void>;
  prepareFlatMovement: () => Promise<void>;
  prepareCenterExcavation: () => Promise<void>;
  prepareStepDown: () => Promise<void>;
  setWorldTime: (hour: number) => Promise<void>;
  setTimePaused: (paused: boolean) => void;
  setTimeSpeed: (speed: number) => void;
  setView: (yaw: number, pitch: number) => void;
  setSpectatorPosition: (x: number, y: number, z: number) => void;
  beginPerformanceScenario: (name: string) => string;
  setStreamingVariant: (variant: StreamingVariant) => void;
  exportPerformanceTrace: () => ReturnType<PerformanceTelemetry['exportChromeTrace']>;
  executeGameplayCommand: (command: ServerCommand) => Promise<CommandResult>;
  advanceGameplay: (seconds: number) => void;
  setVoxelAt: (x: number, y: number, z: number, voxel: number) => Promise<void>;
  getVoxelAt?: (x: number, y: number, z: number) => number | null;
  advanceFluid?: (seconds: number) => void;
  beginFluidFeedbackSample?: (target?: Omit<FluidFeedbackTarget, 'chunkRevisions'>) => void;
  setWaterTransitionHold?: (held: boolean) => void;
  getFluidCell?: (x: number, y: number, z: number) => { level: number; source: boolean } | null;
  getChunkRevision?: (cx: number, cy: number, cz: number) => number | null;
  sunSnapshot?: () => { direction: [number, number, number]; screen: [number, number] | null; facing: boolean };
  flushSave: () => Promise<void>;
  blockLogicWorker: (ms: number) => Promise<void>;
  authorityBody: (entityId: string) => {
    physicsTick: number;
    position: [number, number, number];
    velocity: [number, number, number];
    grounded: boolean;
  } | null;
  presentedEntityPosition: (entityId: string) => [number, number, number] | null;
  playerDamageFeedback: () => { pitch: number; yaw: number; roll: number; active: boolean };
};

type RuntimeHarnessBindings = {
  developerWorld: () => WorldHarnessPort;
  lifecycleSnapshot: () => LifecycleSnapshot;
  restartWorld: (seed: string) => Promise<void>;
  world: () => World | null;
  controller: () => PlayerController | null;
  camera: () => pc.Entity | null;
  environment: () => WorldEnvironment | null;
  gameplay: () => BrowserGameplay | null;
  frameMs: () => number;
  qualityLevel: () => QualityLevel;
  authority: () => BrowserAuthorityClient | null;
  compute: () => BrowserComputeRuntime | null;
  logic: () => BrowserLogicClient | null;
  collisionDebug?: () => CollisionDebugRuntime | null;
  authorityTrajectory: () => HarnessSnapshot['trajectory'];
  ui: () => UiMetrics;
  visualEffects: () => AdvancedVisualEffects | null;
  underwaterVisual: () => UnderwaterVisualEffects | null;
  executeGameplayCommand: (command: ServerCommand) => Promise<CommandResult>;
  setWorldTime: (hour: number) => void | Promise<void>;
  setTimePaused: (paused: boolean) => void;
  setTimeSpeed: (speed: number) => void;
  blockLogicWorker: (ms: number) => Promise<void>;
  queueSave: () => void;
  flushSave: () => Promise<void>;
  experiments: () => HarnessSnapshot['experiments'];
};

declare global {
  interface Window {
    __seedlandsHarness?: HarnessApi;
    __seedlandsPersistenceHarness?: {
      seedCorpus: (database: string, seedText: string, chunkCount: number) => Promise<ChunkPersistenceCorpusSummary>;
      loadScenario: (
        database: string,
        seedText: string,
        activeChunkCount: number,
      ) => Promise<ChunkPersistenceLoadScenario>;
      saveOneChangedChunk: (
        database: string,
      ) => Promise<{ encodedChunkCount: number; idbPutCount: number; untouchedChunkReadCount: number }>;
    };
  }
}

type SnapshotContext = {
  world: World | null;
  environment: WorldEnvironment | null;
  controller: PlayerController | null;
  frameMs: number;
  qualityLevel: QualityLevel;
  authority: BrowserAuthorityClient | null;
  compute: BrowserComputeRuntime | null;
  logic: BrowserLogicClient | null;
  collisionDebug?: CollisionDebugRuntime | null;
  authorityTrajectory: HarnessSnapshot['trajectory'];
  ui: UiMetrics;
  presentedEntityCount: number;
  presentation?: {
    breakingOverlay: { position: [number, number, number]; stage: number } | null;
    viewmodel: { isolatedLayer: boolean };
  };
  visualEffects: AdvancedVisualEffects | null;
  underwaterVisual: UnderwaterVisualEffects | null;
  experiments?: HarnessSnapshot['experiments'];
};

const unavailablePerformance = (): HarnessSnapshot['performance'] => ({
  scenarioId: 'unavailable',
  frame: { count: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, longFrameCount: 0, lastLongFrameMs: 0 },
  chunkVisible: { count: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 },
  completedChunkTraces: 0,
  traceEventCount: 0,
  maxMeshCommitsInFrame: 0,
  maxMeshPartsInFrame: 0,
  visibleAfterPostrender: false,
  incidents: 0,
  droppedEvents: 0,
  uploadQueueDepth: 0,
  estimatedMeshBytes: 0,
});

const unavailableCompute = (): HarnessSnapshot['compute'] => ({
  workerCount: 0,
  fluidWorkerCount: 0,
  generalWorkerCount: 0,
  running: 0,
  queued: 0,
  queuedBytes: 0,
  cancellationRequests: 0,
  staleResults: 0,
  failedTasks: 0,
  completedTasks: 0,
  submittedTasks: 0,
  submittedBytes: 0,
  maxQueued: 0,
  maxQueuedBytes: 0,
  workerTaskDuration: {
    fluid: { count: 0, capacity: 256, samplesMs: [] },
    general: { count: 0, capacity: 256, samplesMs: [] },
  },
  workerKernelStates: [],
});

export function createHarnessSnapshot(context: SnapshotContext): HarnessSnapshot {
  const experiments = context.experiments ?? {
    requested: { renderer: 'webgl2', wasm: false, simd: false },
    kernels: [],
    renderer: null,
    workers: [],
  };
  const position = context.controller?.position;
  const player: [number, number, number] = position ? [position.x, position.y, position.z] : [0, 0, 0];
  const telemetry = context.world?.telemetry;
  const transactions = context.world?.transactionDiagnostics;
  const authoritySnapshot = context.authority?.snapshot;
  const authorityPlayer = authoritySnapshot?.player.body.position;
  const gameplayMetrics = context.authority?.readyState ? context.authority.gameplay.metrics : null;
  const authorityWorkers = context.authority?.isReady ? 1 : 0;
  const logicWorkers = context.logic?.isReady ? 1 : 0;
  const computeWorkers = context.compute?.diagnostics;
  const fluidWorkers = computeWorkers?.fluidWorkerCount ?? 0;
  const generalWorkers = computeWorkers?.generalWorkerCount ?? 0;
  const authorityEntities: readonly AuthorityBodySnapshot[] = authoritySnapshot?.entities ?? [];
  const nonPlayerBodies = authorityEntities.filter((entity) => entity.type !== 'player');
  const authorityBodies = {
    total: nonPlayerBodies.length,
    actors: nonPlayerBodies.filter((entity) => entity.type === 'creature' || entity.type === 'npc').length,
    worldItems: nonPlayerBodies.filter((entity) => entity.type === 'world-item').length,
    nearPlayer: authorityPlayer
      ? nonPlayerBodies.filter(
          ({ body }) =>
            (body.position.x - authorityPlayer.x) ** 2 +
              (body.position.y - authorityPlayer.y) ** 2 +
              (body.position.z - authorityPlayer.z) ** 2 <=
            32 ** 2,
        ).length
      : 0,
  };
  return {
    frameMs: context.frameMs,
    player,
    streamCenter: context.world?.streamCenter ?? [0, 0],
    loadedChunks: telemetry?.loadedChunks ?? 0,
    renderedChunks: telemetry?.renderedChunks ?? 0,
    generationQueue: telemetry?.generationQueue ?? 0,
    meshingQueue: telemetry?.meshingQueue ?? 0,
    deferredRemeshes: telemetry?.deferredRemeshes ?? 0,
    onGround: context.controller?.onGround ?? false,
    colliding: context.controller?.isColliding ?? false,
    interactionAttempts: context.controller?.interactionAttempts ?? 0,
    mutationCount: context.world?.mutationCount ?? 0,
    worldRevision: transactions?.worldRevision ?? 0,
    structuralEventCount: transactions?.structuralEventCount ?? 0,
    remeshSchedulingCount: transactions?.remeshSchedulingCount ?? 0,
    lastCommitMutationCount: transactions?.lastCommitMutationCount ?? 0,
    lastCommitMeshChunkCount: transactions?.lastCommitMeshChunkCount ?? 0,
    storageBytes: context.authority?.storageBytes ?? 0,
    worldTime: context.environment?.worldTime ?? 0,
    timePaused: context.environment?.paused ?? false,
    quality: context.qualityLevel,
    triangles: telemetry?.triangles ?? 0,
    drawCalls: telemetry?.drawCalls ?? 0,
    collisionDebug: context.collisionDebug?.diagnostics ?? {
      enabled: false,
      entityCount: 0,
      meshCount: 0,
      materialCount: 0,
      visibleBatchCount: 0,
      vertexCapacity: 0,
      buildCount: 0,
      authorityRequestCount: 0,
    },
    runtime: 'authority-worker',
    workers: {
      total: authorityWorkers + logicWorkers + authorityWorkers + fluidWorkers + generalWorkers,
      authority: authorityWorkers,
      logic: logicWorkers,
      persistence: authorityWorkers,
      fluid: fluidWorkers,
      general: generalWorkers,
    },
    authority: {
      physicsHz: context.authority?.readyState?.frequencies.physicsHz ?? 60,
      paused: authoritySnapshot?.paused ?? false,
      physicsTick: authoritySnapshot?.physicsTick ?? 0,
      integratedPhysicsTimeMs: authoritySnapshot?.integratedPhysicsTimeMs ?? 0,
      acknowledgedInputSequence: authoritySnapshot?.acknowledgedInputSequence ?? -1,
      physicsDebtMs: authoritySnapshot?.physicsDebtMs ?? 0,
      activeTimeMs: authoritySnapshot?.activeTimeMs ?? 0,
      commitSequence: authoritySnapshot?.commitSequence ?? 0,
      physicsCost: authoritySnapshot?.diagnostics?.physicsCost ?? null,
      fluid: authoritySnapshot?.diagnostics?.fluid ?? {
        pendingCellCount: 0,
        inFlightLeaseCount: 0,
        acceptedCandidateCount: 0,
        rejectedCandidateCount: 0,
        returnedLeaseCount: 0,
        issuedLeaseCount: 0,
        settledLeaseCount: 0,
      },
      residency: authoritySnapshot?.diagnostics?.residency ?? null,
      bodies: authorityBodies,
      snapshotRejections: context.authority?.snapshotRejections ?? {},
    },
    logic: context.logic?.diagnostics ?? { blockStartedCount: 0, blockCompletedCount: 0 },
    trajectory: context.authorityTrajectory,
    generatorVersion: context.world?.generatorVersion ?? 0,
    renderPipeline: {
      ...FINAL_RENDER_PIPELINE,
      backend: experiments.renderer?.effectiveRenderer ?? 'webgl2',
    },
    experiments,
    serverRevision: context.world?.getChunkRevision(0, 0, 0) ?? 0,
    voxelAtOrigin: context.world?.getVoxel(0, 0, 0) ?? Voxel.Air,
    serverPlayerPosition: authorityPlayer
      ? [authorityPlayer.x, authorityPlayer.y + PLAYER_FEET_OFFSET, authorityPlayer.z]
      : [0, 0, 0],
    serverPlayerVelocity: authoritySnapshot
      ? [
          authoritySnapshot.player.body.velocity.x,
          authoritySnapshot.player.body.velocity.y,
          authoritySnapshot.player.body.velocity.z,
        ]
      : [0, 0, 0],
    prediction: context.controller?.predictionDiagnostics ?? {
      pendingFrames: 0,
      lastResetReason: null,
      resetCounts: {},
      presentationOffset: { x: 0, y: 0, z: 0 },
    },
    serverWorldTime: context.world?.worldTime ?? 0,
    performance: context.world?.performanceSummary ?? unavailablePerformance(),
    compute: computeWorkers ?? unavailableCompute(),
    fluidFeedback: context.world?.fluidFeedbackSummary ?? {
      count: 0,
      pending: false,
      pendingSample: null,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
      samples: [],
    },
    waterTransitions: context.world?.waterTransitionSnapshot ?? {
      activeCount: 0,
      active: [],
      recent: [],
    },
    ui: context.ui,
    gameplay: {
      ...(gameplayMetrics ?? {
        entityCount: 0,
        worldItemCount: 0,
        creatureCount: 0,
        npcCount: 0,
        nearbyVisitedBucketCount: 0,
        nearbyCandidateCount: 0,
        nearbyReturnedCount: 0,
        inventoryOperationCount: 0,
        gameplayEventCount: 0,
        snapshotBytes: 0,
        retainedActorCount: 0,
        activeActorCount: 0,
        behaviorEvaluationCount: 0,
        navigationPlanCount: 0,
        navigationExpandedNodeCount: 0,
        pathRecomputeCount: 0,
        actionCompletionCount: 0,
        actionFailureCount: 0,
        actionInterruptionCount: 0,
        perceptionLineOfSightCheckCount: 0,
        simulationTime: 0,
      }),
      presentedEntityCount: context.presentedEntityCount,
    },
    breakingOverlay: context.presentation?.breakingOverlay ?? null,
    viewmodel: context.presentation?.viewmodel ?? { isolatedLayer: false },
    visualEffects: context.visualEffects?.snapshot ?? {
      activeLocalLights: 0,
      shadowedLocalLights: 0,
      localLightLimit: 0,
      localShadowLimit: 0,
      sunShadows: false,
      sunShadowResolution: 0,
      reflectionEnabled: false,
      reflectionActive: false,
      reflectionResolution: 0,
      reflectionFrameInterval: 0,
      reflectionRenderCount: 0,
      waterPlaneY: null,
      postProcessing: false,
      shadowUpdateCount: 0,
      shadowStableFrameCount: 0,
    },
    water: {
      ...(context.controller?.waterImmersion ?? {
        bodyFraction: 0,
        wading: false,
        swimming: false,
        cameraSubmerged: false,
        cameraDepth: Number.NEGATIVE_INFINITY,
        waterSurfaceY: null,
      }),
      underwaterBlend: context.underwaterVisual?.amount ?? 0,
    },
  };
}

export function createRuntimeHarnessApi(bindings: RuntimeHarnessBindings): HarnessApi {
  return {
    world: bindings.developerWorld(),
    snapshot: () =>
      createHarnessSnapshot({
        world: bindings.world(),
        environment: bindings.environment(),
        controller: bindings.controller(),
        frameMs: bindings.frameMs(),
        qualityLevel: bindings.qualityLevel(),
        authority: bindings.authority(),
        compute: bindings.compute(),
        logic: bindings.logic(),
        collisionDebug: bindings.collisionDebug?.() ?? null,
        authorityTrajectory: bindings.authorityTrajectory(),
        ui: bindings.ui(),
        presentedEntityCount: bindings.gameplay()?.presentedEntityCount ?? 0,
        presentation: bindings.gameplay()?.presentationSnapshot,
        visualEffects: bindings.visualEffects(),
        underwaterVisual: bindings.underwaterVisual(),
        experiments: bindings.experiments(),
      }),
    lifecycleSnapshot: bindings.lifecycleSnapshot,
    restartWorld: bindings.restartWorld,
    moveTo: (x, z) => bindings.controller()?.moveHarnessPlayer(x, z) ?? Promise.resolve(),
    burstEdits: () => bindings.controller()?.burstEdits() ?? Promise.resolve(),
    fillWorld: (command) => bindings.world()?.fill('harness-fill', command) ?? Promise.resolve(),
    removeVoxelAt: (x, y, z) => bindings.controller()?.removeVoxel(x, y, z) ?? Promise.resolve(),
    movePlayerTo: (x, y, z) => bindings.controller()?.movePlayerTo(x, y, z) ?? Promise.resolve(),
    prepareFlatMovement: () => bindings.controller()?.prepareFlatMovement() ?? Promise.resolve(),
    prepareCenterExcavation: () => bindings.controller()?.prepareCenterExcavation() ?? Promise.resolve(),
    prepareStepDown: () => bindings.controller()?.prepareStepDown() ?? Promise.resolve(),
    setWorldTime: async (hour) => void (await bindings.setWorldTime(hour)),
    setTimePaused: bindings.setTimePaused,
    setTimeSpeed: bindings.setTimeSpeed,
    setView: (yaw, pitch) => bindings.controller()?.setView(yaw, pitch),
    setSpectatorPosition: (x, y, z) => bindings.controller()?.setSpectatorPosition(x, y, z),
    beginPerformanceScenario: (name) => bindings.world()?.beginScenario(name) ?? '',
    setStreamingVariant: (variant) => bindings.world()?.setStreamingVariant(variant),
    exportPerformanceTrace: () => bindings.world()?.exportTrace() ?? { traceEvents: [] },
    executeGameplayCommand: bindings.executeGameplayCommand,
    beginFluidFeedbackSample: (target) => bindings.world()?.beginFluidFeedbackSample(target),
    setWaterTransitionHold: (held) => bindings.world()?.setWaterTransitionHoldForHarness(held),
    getFluidCell: (x, y, z) => bindings.world()?.getFluidCell(x, y, z) ?? null,
    getChunkRevision: (cx, cy, cz) => bindings.world()?.getChunkRevision(cx, cy, cz) ?? null,
    getVoxelAt: (x, y, z) => bindings.world()?.getVoxel(x, y, z) ?? null,
    sunSnapshot: () => {
      const environment = bindings.environment();
      const camera = bindings.camera();
      return environment && camera
        ? environment.sunSnapshot(camera)
        : { direction: [0, 0, 0], screen: null, facing: false };
    },
    advanceGameplay: () => {
      throw new Error('Authority gameplay advances only on its independent clock.');
    },
    setVoxelAt: async (x, y, z, voxel) => {
      await bindings.world()?.edit(x, y, z, voxel);
      bindings.queueSave();
    },
    flushSave: bindings.flushSave,
    blockLogicWorker: bindings.blockLogicWorker,
    authorityBody: (entityId) => {
      const snapshot = bindings.authority()?.snapshot;
      const entity = snapshot?.entities.find(({ id }) => id === entityId);
      return snapshot && entity
        ? {
            physicsTick: snapshot.physicsTick,
            position: [entity.body.position.x, entity.body.position.y, entity.body.position.z],
            velocity: [entity.body.velocity.x, entity.body.velocity.y, entity.body.velocity.z],
            grounded: entity.grounded,
          }
        : null;
    },
    presentedEntityPosition: (entityId) => bindings.gameplay()?.presentedEntityPosition(entityId) ?? null,
    playerDamageFeedback: () => bindings.controller()?.damageFeedback ?? { pitch: 0, yaw: 0, roll: 0, active: false },
  };
}

export function installHarness(api: HarnessApi) {
  window.__seedlandsHarness = api;
  return () => {
    if (window.__seedlandsHarness === api) delete window.__seedlandsHarness;
  };
}

export async function installPersistenceHarness() {
  if (!new URLSearchParams(location.search).has('harness')) return () => undefined;
  const {
    seedBrowserChunkPersistenceCorpus,
    runBrowserChunkPersistenceLoadScenario,
    saveOneBrowserChunkPersistenceChange,
  } = await import('../client/persistence/chunk-persistence-benchmark');
  const harness = {
    seedCorpus: seedBrowserChunkPersistenceCorpus,
    loadScenario: runBrowserChunkPersistenceLoadScenario,
    saveOneChangedChunk: saveOneBrowserChunkPersistenceChange,
  };
  window.__seedlandsPersistenceHarness = harness;
  return () => {
    if (window.__seedlandsPersistenceHarness === harness) delete window.__seedlandsPersistenceHarness;
  };
}
