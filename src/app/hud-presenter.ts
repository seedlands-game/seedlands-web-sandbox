import type * as pc from 'playcanvas';
import { macroAt } from '../world/macro-world';
import { GENERATOR_VERSION, floorDiv } from '../world/voxel';
import type { PerformanceProfile } from '../client/performance-profile';
import type { PerformanceTelemetry } from '../client/performance-telemetry';
import type { AppElements } from './app-elements';
import { PLAYER_FEET_OFFSET } from './player-controller';
import { QUALITY_PROFILES, type QualityLevel } from './quality-profile';
import type { WorldEnvironment } from './world-environment';
import type { World } from './world-runtime';

type HudContext = {
  world: World;
  environment: WorldEnvironment | null;
  camera: pc.Entity;
  telemetryRecorder: PerformanceTelemetry;
  elements: Pick<AppElements, 'worldClock' | 'debug'>;
  fps: number;
  frameMs: number;
  qualityLevel: QualityLevel;
  performanceProfile: PerformanceProfile;
  deviceType: string;
  seedText: string;
};

export function updateHud(context: HudContext) {
  const { world, environment, camera, elements } = context;
  const feetY = camera.getPosition().y - PLAYER_FEET_OFFSET;
  const telemetry = world.telemetry;
  const macro = macroAt(world.seed, camera.getPosition().x, camera.getPosition().z);
  const water =
    macro.hydrology.kind === 'dry'
      ? 'dry'
      : `${macro.hydrology.kind}${macro.hydrology.water ? ' water' : ' bank'} (${macro.hydrology.id})`;
  const worldTime = world.server.worldTime;
  const hours = Math.floor(worldTime);
  const minutes = Math.floor((worldTime - hours) * 60);
  elements.worldClock.textContent = `${environment?.phase ?? 'Day'} · ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  const performance = world.performanceSummary;
  const span = context.telemetryRecorder.beginSpan('hud', 'DebugHud');
  elements.debug.textContent = `FPS  ${context.fps.toFixed(0)} · Frame  ${context.frameMs.toFixed(1)} ms
Backend  ${context.deviceType}
Quality  ${QUALITY_PROFILES[context.qualityLevel].label} · 性能档位  ${context.performanceProfile.name}
帧分位  p50 ${performance.frame.p50Ms.toFixed(1)} · p95 ${performance.frame.p95Ms.toFixed(1)} · 最近长帧 ${performance.frame.lastLongFrameMs.toFixed(1)} ms
区块可见 p95  ${performance.chunkVisible.p95Ms.toFixed(1)} ms · Worker 忙碌 ${telemetry.meshingQueue}
提交预算  ${performance.maxMeshCommitsInFrame} 区块 / ${performance.maxMeshPartsInFrame} 部件 · 上传队列 ${performance.uploadQueueDepth}
估算网格内存  ${(performance.estimatedMeshBytes / 1024 / 1024).toFixed(1)} MiB · 事件丢弃 ${performance.droppedEvents}
Time  ${worldTime.toFixed(2)}h ${environment?.paused ? '(paused)' : `${environment?.speed ?? 1}×`}
Seed  ${context.seedText}
Generator  v${GENERATOR_VERSION}
Player  ${camera.getPosition().x.toFixed(1)}, ${feetY.toFixed(1)}, ${camera.getPosition().z.toFixed(1)}
Chunk  ${floorDiv(camera.getPosition().x, 32)}, ${floorDiv(feetY, 32)}, ${floorDiv(camera.getPosition().z, 32)}
Macro Region  ${macro.region.join(',')} · ${macro.biome}
Elevation  ${macro.terrainHeight} · Relief  ${macro.relief.toFixed(2)}
Temperature  ${macro.temperature.toFixed(2)} · Humidity  ${macro.humidity.toFixed(2)}
Hydrology  ${water}
Loaded  ${telemetry.loadedChunks} · Rendered  ${telemetry.renderedChunks}
Generation Queue  ${telemetry.generationQueue} · Meshing Queue  ${telemetry.meshingQueue}
Triangles  ${telemetry.triangles.toLocaleString()} · Draw Calls  ${telemetry.drawCalls}
Deferred Remeshes  ${telemetry.deferredRemeshes}
Materialized Chunks  ${world.mutationCount}`;
  context.telemetryRecorder.endSpan(span);
}
