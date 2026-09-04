import type { PerformanceTelemetry } from '../client/performance-telemetry';
import { Voxel } from '../world/voxel';
import type { HarnessSnapshot, LifecycleSnapshot, StreamingVariant } from './app-contracts';
import type { PlayerController } from './player-controller';
import type { QualityLevel } from './quality-profile';
import type { WorldEnvironment } from './world-environment';
import type { World } from './world-runtime';

type HarnessApi = {
  snapshot: () => HarnessSnapshot;
  lifecycleSnapshot: () => LifecycleSnapshot;
  restartWorld: (seed: string) => Promise<void>;
  moveTo: (x: number, z: number) => void;
  burstEdits: () => void;
  removeVoxelAt: (x: number, y: number, z: number) => void;
  movePlayerTo: (x: number, y: number, z: number) => void;
  prepareFlatMovement: () => void;
  prepareCenterExcavation: () => void;
  prepareStepDown: () => void;
  setWorldTime: (hour: number) => void;
  setTimePaused: (paused: boolean) => void;
  setTimeSpeed: (speed: number) => void;
  setView: (yaw: number, pitch: number) => void;
  setSpectatorPosition: (x: number, y: number, z: number) => void;
  beginPerformanceScenario: (name: string) => string;
  setStreamingVariant: (variant: StreamingVariant) => void;
  exportPerformanceTrace: () => ReturnType<PerformanceTelemetry['exportChromeTrace']>;
};

declare global {
  interface Window {
    __seedlandsHarness?: HarnessApi;
  }
}

type SnapshotContext = {
  world: World | null;
  environment: WorldEnvironment | null;
  controller: PlayerController | null;
  frameMs: number;
  qualityLevel: QualityLevel;
  serverPlayerId: string | null;
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

export function createHarnessSnapshot(context: SnapshotContext): HarnessSnapshot {
  const position = context.controller?.position;
  const player: [number, number, number] = position ? [position.x, position.y, position.z] : [0, 0, 0];
  const telemetry = context.world?.telemetry;
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
    storageBytes: new TextEncoder().encode(localStorage.getItem('seedlands-world-v2') ?? '').byteLength,
    worldTime: context.environment?.worldTime ?? 0,
    timePaused: context.environment?.paused ?? false,
    quality: context.qualityLevel,
    triangles: telemetry?.triangles ?? 0,
    drawCalls: telemetry?.drawCalls ?? 0,
    runtime: 'integrated-server',
    serverRevision: context.world?.server.getChunk(0, 0, 0).revision ?? 0,
    voxelAtOrigin: context.world?.getVoxel(0, 0, 0) ?? Voxel.Air,
    serverPlayerPosition: context.serverPlayerId
      ? (context.world?.server.getEntity(context.serverPlayerId)?.position ?? [0, 0, 0])
      : [0, 0, 0],
    serverWorldTime: context.world?.server.worldTime ?? 0,
    performance: context.world?.performanceSummary ?? unavailablePerformance(),
  };
}

export function installHarness(api: HarnessApi) {
  window.__seedlandsHarness = api;
  return () => {
    if (window.__seedlandsHarness === api) delete window.__seedlandsHarness;
  };
}
