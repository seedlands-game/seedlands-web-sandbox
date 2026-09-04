import type { FaceMaterialId } from '../world/voxel';
import type { RenderLayer } from '../world/mesh';
import type { WorldChange } from '../world/storage';
import type { BrowserChunkPersistence } from '../client/browser-chunk-persistence';
import type { MeshTaskIdentity } from '../client/mesh-task-snapshot';
import type { PerformanceTelemetry } from '../client/performance-telemetry';

export type MeshPart = {
  material: FaceMaterialId;
  renderLayer: RenderLayer;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Uint8Array;
  indices: Uint32Array;
};

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
  serverRevision: number;
  voxelAtOrigin: number;
  serverPlayerPosition: [number, number, number];
  serverWorldTime: number;
  performance: PerformanceSummary;
};

export type RestoredSession = {
  player: [number, number, number];
  seed: string;
  persistence: BrowserChunkPersistence;
  changes: WorldChange[];
};

export type LifecycleSnapshot = {
  worldInstanceId: number;
  disposedWorlds: number;
  staleVisibleCommits: number;
};
