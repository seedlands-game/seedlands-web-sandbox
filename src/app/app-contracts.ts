import type { MeshData } from '../world/mesh';
import type { WorldChange } from '../world/storage';
import type { SerializedChunkSnapshot } from '../client/browser-chunk-persistence';
import type { MeshTaskIdentity } from '../client/mesh-task-snapshot';
import type { PerformanceTelemetry } from '../client/performance-telemetry';
import type { FINAL_RENDER_PIPELINE } from './voxel-render-pipeline';
import type { UiMetrics } from './ui/ui-contracts';
import type { VisualEffectsSnapshot } from './advanced-visual-effects';

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
  runtime: 'integrated-server';
  renderPipeline: typeof FINAL_RENDER_PIPELINE;
  serverRevision: number;
  voxelAtOrigin: number;
  serverPlayerPosition: [number, number, number];
  serverWorldTime: number;
  performance: PerformanceSummary;
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
