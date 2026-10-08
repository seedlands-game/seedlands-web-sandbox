import type { Point } from './scenario';

export type ClassicSnapshot = Readonly<{
  frameMs: number;
  player: Point;
  serverPlayerPosition: Point;
  serverPlayerVelocity: Point;
  viewAngles: readonly [number, number];
  streamCenter: readonly [number, number];
  loadedChunks: number;
  renderedChunks: number;
  onGround: boolean;
  colliding: boolean;
  interactionAttempts: number;
  mutationCount: number;
  worldRevision: number;
  remeshSchedulingCount: number;
  lastCommitMeshChunkCount: number;
  storageBytes: number;
  runtime: 'authority-worker';
  workers: Readonly<{ authority: number; logic: number; persistence: number; fluid: number; general: number }>;
  authority: Readonly<{
    physicsTick: number;
    acknowledgedInputSequence: number;
    commitSequence: number;
    residency: Readonly<{ evictionCount: number; residentCount: number; dirtyCount: number }> | null;
  }>;
  generatorVersion: number;
  renderPipeline: Readonly<{ backend: 'webgl2' | 'webgpu' }>;
  experiments: Readonly<{
    requested: Readonly<{ renderer: string; wasm: boolean; simd: boolean }>;
    renderer: Readonly<{ effectiveRenderer: string }> | null;
    workers: readonly Readonly<{
      lane: 'fluid' | 'general';
      status: string;
      effectiveArtifact: string;
      artifactSha256?: string;
    }>[];
  }>;
  compute: Readonly<{
    submittedTasks: number;
    completedTasks: number;
    failedTasks: number;
    staleResults: number;
    submittedBytes: number;
    workerActivity?: readonly Readonly<{
      lane: 'fluid' | 'general';
      completedTasks: number;
      kernel: Readonly<{ calls: number; failures: number; memoryBytes: number; failed: boolean }> | null;
    }>[];
  }>;
  performance: Readonly<{
    scenarioId: string;
    frame: Readonly<{ count: number; p50Ms: number; p95Ms: number; p99Ms: number; longFrameCount: number }>;
    chunkVisible: Readonly<{ count: number; p50Ms: number; p95Ms: number; p99Ms: number }>;
    completedChunkTraces: number;
    traceEventCount: number;
    uploadQueueDepth: number;
    estimatedMeshBytes: number;
  }>;
  gameplay: Readonly<{
    npcCount: number;
    worldItemCount: number;
    inventoryOperationCount: number;
    actionCompletionCount: number;
    behaviorEvaluationCount: number;
    presentedEntityCount: number;
  }>;
  visualEffects: Readonly<{
    blockLightReady: boolean;
    blockLightSourceRevision: number | null;
    blockLightRebuildCount: number;
    shadowUpdateCount: number;
    shadowStableFrameCount: number;
  }>;
}>;
