import type * as pc from 'playcanvas';
import type { PerformanceProfile } from '../client/presentation/performance-profile';
import type { PerformanceTelemetry } from '../client/presentation/performance-telemetry';
import type { BrowserAuthorityClient } from '../client/authority/browser-authority-client';
import type { WorldAudio } from './audio/world-audio';
import type { BrowserGameplay } from './gameplay/browser-gameplay';
import type { WaterExperience } from './gameplay/water-experience';
import type { GameUiProjection } from './game-ui-projection';
import type { PlayerController } from './player/player-controller';
import type { CollisionDebugRuntime } from './player/collision-debug-runtime';
import type { AdvancedVisualEffects } from './scene/advanced-visual-effects';
import type { QualityLevel } from './scene/quality-profile';
import type { WorldEnvironment } from './scene/world-environment';
import type { UiWorldSession } from './ui/ui-bridge';
import type { World } from './world/world-runtime';
import type { DebugRuntimeInput } from './ui/debug-diagnostics';

type GameFrameBindings = Readonly<{
  app: () => pc.Application | null;
  authority: () => BrowserAuthorityClient | null;
  camera: () => pc.Entity | null;
  collisionDebug: () => CollisionDebugRuntime | null;
  controller: () => PlayerController | null;
  environment: () => WorldEnvironment | null;
  gameplay: () => BrowserGameplay | null;
  paused: () => boolean;
  performanceProfile: () => PerformanceProfile;
  performanceTelemetry: () => PerformanceTelemetry;
  qualityLevel: () => QualityLevel;
  queueSave: () => void;
  seedText: () => string;
  session: () => UiWorldSession | null;
  uiProjection: GameUiProjection;
  visualEffects: () => AdvancedVisualEffects | null;
  waterExperience: () => WaterExperience | null;
  world: () => World | null;
  worldAudio: () => WorldAudio | null;
  nextHudSequence: () => number;
  nextDebugSequence: () => number;
  diagnostics?: () => DebugRuntimeInput;
}>;

export class GameFrameLoop {
  private lastFpsSample = performance.now();
  private frames = 0;
  private fps = 0;
  private fpsSampled = false;
  frameMs = 0;
  private lastFrameTimestamp = performance.now();

  constructor(private readonly bindings: GameFrameBindings) {}

  reset(): void {
    const now = performance.now();
    this.lastFpsSample = now;
    this.lastFrameTimestamp = now;
    this.frames = 0;
    this.fps = 0;
    this.fpsSampled = false;
    this.frameMs = 0;
  }

  update(dt: number): void {
    const world = this.bindings.world();
    const camera = this.bindings.camera();
    if (!world || !camera) return;
    const now = performance.now();
    const actualFrameMs = now - this.lastFrameTimestamp;
    this.lastFrameTimestamp = now;
    const controller = this.bindings.controller();
    this.bindings
      .worldAudio()
      ?.updateWorld(camera, world, controller?.onGround ?? false, this.bindings.paused(), controller?.waterImmersion);
    if (this.bindings.paused()) return;
    const telemetry = this.bindings.performanceTelemetry();
    telemetry.beginFrame();
    world.beginFrame();
    const environment = this.bindings.environment();
    if (environment) {
      this.bindings.waterExperience()?.updateFlow(dt, camera, world, environment);
      environment.update(dt, world.worldTime);
    }
    this.frameMs = actualFrameMs;
    this.frames += 1;
    if (now - this.lastFpsSample > 500) {
      this.fps = (this.frames * 1000) / (now - this.lastFpsSample);
      this.fpsSampled = true;
      this.frames = 0;
      this.lastFpsSample = now;
    }
    controller?.update(dt, actualFrameMs / 1000);
    const collisionDebug = this.bindings.collisionDebug();
    collisionDebug?.update(
      this.bindings.authority()?.snapshot ?? null,
      controller?.predictedPhysicsState ?? null,
      controller?.aimTarget ?? null,
    );
    this.bindings.waterExperience()?.updateImmersion(dt, controller?.waterImmersion, environment);
    const gameplay = this.bindings.gameplay();
    gameplay?.advance(dt);
    this.bindings.visualEffects()?.update(dt, gameplay?.shadowCasters ?? []);
    world.updateStreaming(camera.getPosition());
    world.drainCommits();
    const session = this.bindings.session();
    if (session) {
      this.bindings.uiProjection.publish({
        world,
        camera,
        session,
        environment,
        telemetry,
        performanceProfile: this.bindings.performanceProfile(),
        qualityLevel: this.bindings.qualityLevel(),
        deviceType: this.bindings.app()?.graphicsDevice.deviceType ?? 'WebGL2',
        seedText: this.bindings.seedText(),
        fps: this.fps,
        fpsSampled: this.fpsSampled,
        frameMs: this.frameMs,
        nextHudSequence: this.bindings.nextHudSequence,
        nextDebugSequence: this.bindings.nextDebugSequence,
        collisionDebug: collisionDebug?.status ?? null,
        diagnostics: this.bindings.diagnostics,
      });
    }
    telemetry.endFrame(actualFrameMs);
    if (Math.floor(now / 2000) !== Math.floor((now - dt * 1000) / 2000)) this.bindings.queueSave();
  }
}
