import type * as pc from 'playcanvas';
import type { PerformanceProfile } from '../client/performance-profile';
import type { PerformanceTelemetry } from '../client/performance-telemetry';
import type { QualityLevel } from './quality-profile';
import type { UiWorldSession } from './ui/ui-bridge';
import type { WorldEnvironment } from './world-environment';
import type { World } from './world-runtime';
import { projectDebug, projectWorldClock } from './hud-projector';

type Options = Readonly<{
  world: World;
  camera: pc.Entity;
  session: UiWorldSession;
  environment: WorldEnvironment | null;
  telemetry: PerformanceTelemetry;
  performanceProfile: PerformanceProfile;
  qualityLevel: QualityLevel;
  deviceType: string;
  seedText: string;
  fps: number;
  frameMs: number;
  nextHudSequence: () => number;
  nextDebugSequence: () => number;
  collisionDebug: Readonly<{
    authorityTick: number;
    predictionTick: number;
    visibleBodyCount: number;
    truncatedBodyCount: number;
  }> | null;
}>;

export class GameUiProjection {
  private lastClockMinute = -1;
  private lastClockPublishAt = Number.NEGATIVE_INFINITY;

  reset(): void {
    this.lastClockMinute = -1;
    this.lastClockPublishAt = Number.NEGATIVE_INFINITY;
  }

  publish(options: Options): void {
    const worldTime = options.world.worldTime;
    const displayMinute = Math.floor(worldTime * 60);
    const now = performance.now();
    if (displayMinute !== this.lastClockMinute && now - this.lastClockPublishAt >= 600) {
      this.lastClockMinute = displayMinute;
      this.lastClockPublishAt = now;
      options.session.publishHud(options.nextHudSequence(), {
        worldClock: projectWorldClock(worldTime, options.environment?.phase ?? 'Day'),
      });
    }
    options.session.sampleDebug(options.nextDebugSequence(), () =>
      options.telemetry.withSpan('ui', 'DebugProjection', () => {
        const projection = projectDebug({
          world: options.world,
          environment: options.environment,
          camera: options.camera,
          fps: options.fps,
          frameMs: options.frameMs,
          qualityLevel: options.qualityLevel,
          performanceProfile: options.performanceProfile,
          deviceType: options.deviceType,
          seedText: options.seedText,
        });
        const collision = options.collisionDebug;
        return collision
          ? {
              ...projection,
              text: `${projection.text}\n碰撞箱  权威 tick ${collision.authorityTick} · 预测 tick ${collision.predictionTick} · 实体 ${collision.visibleBodyCount} · 截断 ${collision.truncatedBodyCount}`,
            }
          : projection;
      }),
    );
  }
}
