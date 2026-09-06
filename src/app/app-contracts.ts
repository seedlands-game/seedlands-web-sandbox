import type { MeshData } from '../world/mesh';
import type { WorldChange } from '../world/storage';
import type { SerializedChunkSnapshot } from '../client/browser-chunk-persistence';
import type { MeshTaskIdentity } from '../client/mesh-task-snapshot';
import type { PerformanceTelemetry } from '../client/performance-telemetry';
import type { FINAL_RENDER_PIPELINE } from './voxel-render-pipeline';
import type { UiMetrics } from './ui/ui-contracts';
import type { VisualEffectsSnapshot } from './advanced-visual-effects';
import type { FluidFeedbackSummary } from './fluid-feedback-tracker';
import type { WaterMeshTransitionSnapshot } from './water-mesh-transition';
import type { CostSampleWindow } from '../runtime/bounded-cost-samples';
import type { CollisionDebugRendererDiagnostics } from './collision-debug-renderer';
import type { ComputePoolDiagnostics } from '../client/compute-worker-pool';
import type { FluidAuthorityDiagnostics } from '../server/fluid/fluid-transaction';
import type { AuthorityResidencyDiagnostics } from '../server/authority/authority-residency-runtime';

export type MeshPart = MeshData;

export type WorkerResult = {
  kind: 'mesh-result';
  taskId: number;
  traceId: string;
  epoch: number;
  chunkKey: string;
  chunkRevision: number;
  haloRevision: string;
  cx: number;
  cy: number;
  cz: number;
  workerMeshingMs: number;
  workerGenerationMs?: number;
  workerHaloMs?: number;
  computedHaloRevision?: string;
  canonical?: ArrayBuffer;
  generatorVersion?: number;
  meshes: MeshPart[];
};

export type StreamingVariant = 'main-snapshot' | 'worker-first';

export type PendingMeshTask = MeshTaskIdentity & {
  chunkKey: string;
  traceId: string;
  seed: number;
  cx: number;
  cy: number;
  cz: number;
  generatorVersion: number;
  variant: StreamingVariant;
  visibilityBarrierRevision?: number;
};

export type PerformanceSummary = {
  scenarioId: string;
  frame: ReturnType<PerformanceTelemetry['frameSummary']>;
  chunkVisible: ReturnType<PerformanceTelemetry['traceSummary']>;
  completedChunkTraces: number;
  traceEventCount: number;
  maxMeshCommitsInFrame: number;
  maxMeshPartsInFrame: number;
  visibleAfterPostrender: boolean;
  incidents: number;
  droppedEvents: number;
  uploadQueueDepth: number;
  estimatedMeshBytes: number;
};

export type HarnessSnapshot = {
  frameMs: number;
  player: [number, number, number];
  loadedChunks: number;
  renderedChunks: number;
  streamCenter: [number, number];
  generationQueue: number;
  meshingQueue: number;
  deferredRemeshes: number;
  onGround: boolean;
  colliding: boolean;
  interactionAttempts: number;
  mutationCount: number;
  worldRevision: number;
  structuralEventCount: number;
  remeshSchedulingCount: number;
  lastCommitMutationCount: number;
  lastCommitMeshChunkCount: number;
  storageBytes: number;
  worldTime: number;
  timePaused: boolean;
  quality: 'low' | 'medium' | 'high';
  triangles: number;
  drawCalls: number;
  collisionDebug: CollisionDebugRendererDiagnostics & { authorityRequestCount: 0 };
  runtime: 'authority-worker';
  workers: {
    total: number;
    authority: number;
    logic: number;
    persistence: number;
    fluid: number;
    general: number;
  };
  authority: {
    physicsHz: 30 | 60 | 120;
    paused: boolean;
    physicsTick: number;
    integratedPhysicsTimeMs: number;
    acknowledgedInputSequence: number;
    physicsDebtMs: number;
    activeTimeMs: number;
    commitSequence: number;
    physicsCost: CostSampleWindow | null;
    fluid: FluidAuthorityDiagnostics;
    residency: AuthorityResidencyDiagnostics | null;
    bodies: { total: number; actors: number; worldItems: number; nearPlayer: number };
    snapshotRejections: Readonly<Record<string, number>>;
  };
  logic: { blockStartedCount: number; blockCompletedCount: number };
  trajectory: readonly {
    physicsTick: number;
    activeTimeMs: number;
    position: [number, number, number];
  }[];
  generatorVersion: number;
  renderPipeline: typeof FINAL_RENDER_PIPELINE;
  serverRevision: number;
  voxelAtOrigin: number;
  serverPlayerPosition: [number, number, number];
  serverPlayerVelocity: [number, number, number];
  prediction: {
    pendingFrames: number;
    lastResetReason: string | null;
    resetCounts: Readonly<Record<string, number>>;
    presentationOffset: Readonly<{ x: number; y: number; z: number }>;
  };
  serverWorldTime: number;
  performance: PerformanceSummary;
  compute: ComputePoolDiagnostics;
  fluidFeedback: FluidFeedbackSummary;
  waterTransitions: WaterMeshTransitionSnapshot;
  ui: UiMetrics;
  gameplay: {
    entityCount: number;
    worldItemCount: number;
    creatureCount: number;
    npcCount: number;
    nearbyVisitedBucketCount: number;
    nearbyCandidateCount: number;
    nearbyReturnedCount: number;
    inventoryOperationCount: number;
    gameplayEventCount: number;
    snapshotBytes: number;
    retainedActorCount: number;
    activeActorCount: number;
    behaviorEvaluationCount: number;
    navigationPlanCount: number;
    navigationExpandedNodeCount: number;
    pathRecomputeCount: number;
    actionCompletionCount: number;
    actionFailureCount: number;
    actionInterruptionCount: number;
    perceptionLineOfSightCheckCount: number;
    simulationTime: number;
    presentedEntityCount: number;
  };
  breakingOverlay: { position: [number, number, number]; stage: number } | null;
  viewmodel: { isolatedLayer: boolean };
  visualEffects: VisualEffectsSnapshot;
  water: {
    bodyFraction: number;
    wading: boolean;
    swimming: boolean;
    cameraSubmerged: boolean;
    cameraDepth: number;
    waterSurfaceY: number | null;
    underwaterBlend: number;
  };
};

export type RestoredSession = {
  player: [number, number, number];
  seed: string;
  legacySnapshots: readonly SerializedChunkSnapshot[];
  changes: WorldChange[];
};

export type LifecycleSnapshot = {
  worldInstanceId: number;
  disposedWorlds: number;
  staleVisibleCommits: number;
};
