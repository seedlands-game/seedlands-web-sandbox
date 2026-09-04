import type * as pc from 'playcanvas';
import { macroAt } from '../world/macro-world';
import { GENERATOR_VERSION, floorDiv } from '../world/voxel';
import type { PerformanceProfile } from '../client/performance-profile';
import { PLAYER_FEET_OFFSET } from './player-controller';
import { QUALITY_PROFILES, type QualityLevel } from './quality-profile';
import type { WorldEnvironment } from './world-environment';
import type { World } from './world-runtime';

type DebugProjectionContext = {
  world: World;
  environment: WorldEnvironment | null;
  camera: pc.Entity;
  fps: number;
  frameMs: number;
  qualityLevel: QualityLevel;
  performanceProfile: PerformanceProfile;
  deviceType: string;
  seedText: string;
};

export function projectWorldClock(worldTime: number, phase: string) {
  const hours = Math.floor(worldTime);
  const minutes = Math.floor((worldTime - hours) * 60);
  return `${phase} · ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

export function projectDebug(context: DebugProjectionContext) {
  const { world, environment, camera } = context;
  const position = camera.getPosition();
  const feetY = position.y - PLAYER_FEET_OFFSET;
  const telemetry = world.telemetry;
  const macro = macroAt(world.seed, position.x, position.z);
  const water =
    macro.hydrology.kind === 'dry'
      ? 'dry'
      : `${macro.hydrology.kind}${macro.hydrology.water ? ' water' : ' bank'} (${macro.hydrology.id})`;
  const worldTime = world.server.worldTime;
  const performance = world.performanceSummary;
  return {
    fps: context.fps,
    position: [position.x, position.y, position.z] as const,
    text: `FPS  ${context.fps.toFixed(0)} · Frame  ${context.frameMs.toFixed(1)} ms
Backend  ${context.deviceType}
Quality  ${QUALITY_PROFILES[context.qualityLevel].label} · 性能档位  ${context.performanceProfile.name}
帧分位  p50 ${performance.frame.p50Ms.toFixed(1)} · p95 ${performance.frame.p95Ms.toFixed(1)} · 最近长帧 ${performance.frame.lastLongFrameMs.toFixed(1)} ms
区块可见 p95  ${performance.chunkVisible.p95Ms.toFixed(1)} ms · Worker 忙碌 ${telemetry.meshingQueue}
提交预算  ${performance.maxMeshCommitsInFrame} 区块 / ${performance.maxMeshPartsInFrame} 部件 · 上传队列 ${performance.uploadQueueDepth}
估算网格内存  ${(performance.estimatedMeshBytes / 1024 / 1024).toFixed(1)} MiB · 事件丢弃 ${performance.droppedEvents}
Time  ${worldTime.toFixed(2)}h ${environment?.paused ? '(paused)' : `${environment?.speed ?? 1}×`}
Seed  ${context.seedText}
Generator  v${GENERATOR_VERSION}
Player  ${position.x.toFixed(1)}, ${feetY.toFixed(1)}, ${position.z.toFixed(1)}
Chunk  ${floorDiv(position.x, 32)}, ${floorDiv(feetY, 32)}, ${floorDiv(position.z, 32)}
Macro Region  ${macro.region.join(',')} · ${macro.biome}
Elevation  ${macro.terrainHeight} · Relief  ${macro.relief.toFixed(2)}
Temperature  ${macro.temperature.toFixed(2)} · Humidity  ${macro.humidity.toFixed(2)}
Hydrology  ${water}
Loaded  ${telemetry.loadedChunks} · Rendered  ${telemetry.renderedChunks}
Generation Queue  ${telemetry.generationQueue} · Meshing Queue  ${telemetry.meshingQueue}
Triangles  ${telemetry.triangles.toLocaleString()} · Draw Calls  ${telemetry.drawCalls}
Deferred Remeshes  ${telemetry.deferredRemeshes}
Materialized Chunks  ${world.mutationCount}`,
  };
}
