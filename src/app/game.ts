import * as pc from 'playcanvas';
import { BrowserChunkPersistence } from '../client/browser-chunk-persistence';
import { PERFORMANCE_PROFILES, type PerformanceProfile } from '../client/performance-profile';
import { PerformanceTelemetry } from '../client/performance-telemetry';
import { GameServer } from '../server/game-server';
import { appElements } from './app-elements';
import type { HarnessSnapshot, LifecycleSnapshot, RestoredSession, StreamingVariant } from './app-contracts';
import { BrowserWorldStore } from './browser-world-store';
import { createHarnessSnapshot, installHarness } from './game-harness';
import { updateHud } from './hud-presenter';
import { MacroMapViewer } from './macro-map-viewer';
import { PlayerController } from './player-controller';
import { QUALITY_PROFILES, type QualityLevel } from './quality-profile';
import { createVoxelMaterials, type VoxelMaterials } from './voxel-materials';
import { WorldEnvironment } from './world-environment';
import { World } from './world-runtime';

export class Game {
  private app: pc.Application | null = null;
  private world: World | null = null;
  private environment: WorldEnvironment | null = null;
  private visualResources: VoxelMaterials | null = null;
  private controller: PlayerController | null = null;
  private camera: pc.Entity | null = null;
  private lastFpsSample = performance.now();
  private frames = 0;
  private fps = 0;
  private frameMs = 0;
  private lastFrameTimestamp = performance.now();
  private performanceProfile: PerformanceProfile = PERFORMANCE_PROFILES.balanced;
  private performanceTelemetry = new PerformanceTelemetry({ now: () => performance.now() });
  private readonly store = new BrowserWorldStore();
  private readonly macroMap = new MacroMapViewer(appElements);
  private persistence = new BrowserChunkPersistence();
  private serverPlayerId: string | null = null;
  private seedText = '';
  private qualityLevel: QualityLevel = 'medium';
  private saveTimer: number | null = null;
  private removeHarness: (() => void) | null = null;
  private readonly lifecycle: LifecycleSnapshot = { worldInstanceId: 0, disposedWorlds: 0, staleVisibleCommits: 0 };

  constructor() {
    window.addEventListener('resize', () => this.app?.resizeCanvas());
    window.addEventListener('pagehide', () => this.flushSave());
  }

  loadSavedSession() {
    return this.store.load();
  }

  async start(seedText: string, restore: RestoredSession | null) {
    this.flushSave();
    this.disposeRuntime();
    this.seedText = seedText;
    this.qualityLevel = appElements.qualitySelect.value as QualityLevel;
    const quality = QUALITY_PROFILES[this.qualityLevel];
    this.performanceProfile = this.selectPerformanceProfile();
    this.performanceTelemetry = new PerformanceTelemetry({
      now: () => performance.now(),
      frameCapacity: this.performanceProfile.ringBufferFrames,
      eventCapacity: this.performanceProfile.ringBufferEvents,
      incidentThresholdMs: this.performanceProfile.longFrameMs,
      chunkLatencyIncidentMs: this.performanceProfile.chunkLatencyIncidentMs,
    });
    this.lastFrameTimestamp = performance.now();
    this.persistence = restore?.seed === seedText ? restore.persistence : new BrowserChunkPersistence();
    this.app = this.createApplication();
    const light = this.createSun(this.app, quality.shadowQuality !== 'off');
    this.camera = this.createCamera(this.app, quality.fogEnd + 18);
    this.visualResources = await createVoxelMaterials(this.app, quality);
    this.environment = new WorldEnvironment(this.app, light, quality, this.visualResources.water);
    const server = new GameServer({ seedText, persistence: this.persistence });
    server.setWorldTime(this.environment.worldTime);
    this.world = new World(
      server,
      this.app,
      this.visualResources.materials,
      quality,
      this.performanceTelemetry,
      this.performanceProfile,
      this.requestedStreamingVariant(),
      () => {
        this.lifecycle.staleVisibleCommits += 1;
      },
    );
    this.lifecycle.worldInstanceId += 1;
    if (restore?.changes.length) this.world.restoreLegacyChanges(restore.changes);
    const position = restore?.player ?? [0, 34, 0];
    this.camera.setPosition(...position);
    this.serverPlayerId = server.createEntity({ kind: 'player', position }).id;
    this.world.updateStreaming(this.camera.getPosition());
    this.controller = this.createController(this.camera);
    this.controller.install();
    this.installUiAndHarness();
    this.app.on('update', (dt: number) => this.update(Math.min(dt, 0.05)));
  }

  private createApplication() {
    const app = new pc.Application(appElements.canvas, {
      mouse: new pc.Mouse(appElements.canvas),
      keyboard: new pc.Keyboard(window),
      graphicsDeviceOptions: { alpha: true },
    });
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    app.start();
    return app;
  }

  private createSun(app: pc.Application, castShadows: boolean) {
    const light = new pc.Entity('Sun');
    light.addComponent('light', {
      type: 'directional',
      color: new pc.Color(1, 0.9, 0.72),
      intensity: 1,
      castShadows,
      shadowResolution: 512,
    });
    app.root.addChild(light);
    return light;
  }

  private createCamera(app: pc.Application, farClip: number) {
    const camera = new pc.Entity('Player');
    camera.addComponent('camera', {
      clearColor: new pc.Color(0, 0, 0, 0),
      fov: 72,
      nearClip: 0.05,
      farClip,
    });
    app.root.addChild(camera);
    return camera;
  }

  private createController(camera: pc.Entity) {
    return new PlayerController({
      camera,
      elements: appElements,
      telemetry: this.performanceTelemetry,
      getWorld: () => this.world,
      getEnvironment: () => this.environment,
      onToggleMap: () => this.toggleMap(),
      onQueueSave: () => this.queueSave(),
      onFlushSave: () => this.flushSave(),
    });
  }

  private installUiAndHarness() {
    appElements.mapToggle.onclick = () => this.toggleMap();
    appElements.mapClose.onclick = () => this.macroMap.close();
    const harnessEnabled = new URLSearchParams(location.search).has('harness');
    appElements.debug.hidden = !harnessEnabled;
    if (!harnessEnabled || !this.controller) return;
    this.removeHarness = installHarness({
      snapshot: () => this.harnessSnapshot(),
      lifecycleSnapshot: () => ({ ...this.lifecycle }),
      restartWorld: async (seed) => {
        await this.start(seed, null);
        appElements.startCard.hidden = true;
        appElements.hud.hidden = false;
      },
      moveTo: (x, z) => this.controller?.moveHarnessPlayer(x, z),
      burstEdits: () => this.controller?.burstEdits(),
      fillWorld: (command) => this.world?.fill('harness-fill', command),
      removeVoxelAt: (x, y, z) => this.controller?.removeVoxel(x, y, z),
      movePlayerTo: (x, y, z) => this.controller?.movePlayerTo(x, y, z),
      prepareFlatMovement: () => this.controller?.prepareFlatMovement(),
      prepareCenterExcavation: () => this.controller?.prepareCenterExcavation(),
      prepareStepDown: () => this.controller?.prepareStepDown(),
      setWorldTime: (hour) => this.setWorldTime(hour),
      setTimePaused: (paused) => this.environment?.setPaused(paused),
      setTimeSpeed: (speed) => {
        if (this.environment) this.environment.speed = Math.max(0, speed);
      },
      setView: (yaw, pitch) => this.controller?.setView(yaw, pitch),
      setSpectatorPosition: (x, y, z) => this.controller?.setSpectatorPosition(x, y, z),
      beginPerformanceScenario: (name) => this.world?.beginScenario(name) ?? '',
      setStreamingVariant: (variant) => this.world?.setStreamingVariant(variant),
      exportPerformanceTrace: () => this.world?.exportTrace() ?? { traceEvents: [] },
    });
  }

  private update(dt: number) {
    if (!this.world || !this.camera) return;
    const now = performance.now();
    const actualFrameMs = now - this.lastFrameTimestamp;
    this.lastFrameTimestamp = now;
    this.performanceTelemetry.beginFrame();
    this.world.beginFrame();
    if (this.environment) {
      if (!this.environment.paused) this.world.server.advanceClock(dt * 0.04 * this.environment.speed);
      this.environment.update(dt, this.world.server.worldTime);
    }
    this.frameMs = actualFrameMs;
    this.frames += 1;
    if (now - this.lastFpsSample > 500) {
      this.fps = (this.frames * 1000) / (now - this.lastFpsSample);
      this.frames = 0;
      this.lastFpsSample = now;
    }
    this.controller?.update(dt);
    this.world.updateStreaming(this.camera.getPosition());
    this.world.drainCommits();
    if (this.serverPlayerId)
      this.world.server.updateEntity(this.serverPlayerId, {
        position: [this.camera.getPosition().x, this.camera.getPosition().y, this.camera.getPosition().z],
      });
    updateHud({
      world: this.world,
      environment: this.environment,
      camera: this.camera,
      telemetryRecorder: this.performanceTelemetry,
      elements: appElements,
      fps: this.fps,
      frameMs: this.frameMs,
      qualityLevel: this.qualityLevel,
      performanceProfile: this.performanceProfile,
      deviceType: this.app?.graphicsDevice.deviceType ?? 'WebGL2',
      seedText: this.seedText,
    });
    this.performanceTelemetry.endFrame(actualFrameMs);
    if (Math.floor(now / 2000) !== Math.floor((now - dt * 1000) / 2000)) this.queueSave();
  }

  private toggleMap() {
    if (!this.world || !this.camera) return;
    if (this.macroMap.isOpen) return this.macroMap.close();
    const position = this.camera.getPosition();
    this.macroMap.open(this.world.seed, [position.x, position.z]);
  }

  private harnessSnapshot(): HarnessSnapshot {
    return createHarnessSnapshot({
      world: this.world,
      environment: this.environment,
      controller: this.controller,
      frameMs: this.frameMs,
      qualityLevel: this.qualityLevel,
      serverPlayerId: this.serverPlayerId,
    });
  }

  private setWorldTime(hour: number) {
    if (!this.world || !this.environment) return;
    this.world.server.setWorldTime(hour);
    this.environment.setTime(this.world.server.worldTime);
  }

  private queueSave() {
    if (this.saveTimer !== null) return;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.flushSave();
    }, 48);
  }

  private flushSave() {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.world || !this.camera) return;
    this.performanceTelemetry.withSpan('persistence', 'FlushWorldSave', () => {
      this.world?.server.flushDirtyChunks();
      this.store.save(this.seedText, this.camera!.getPosition(), this.persistence);
    });
  }

  private disposeRuntime() {
    this.removeHarness?.();
    this.removeHarness = null;
    this.controller?.dispose();
    this.controller = null;
    this.macroMap.close();
    if (this.world) {
      this.world.dispose();
      this.lifecycle.disposedWorlds += 1;
    }
    this.world = null;
    this.environment = null;
    this.visualResources?.destroy();
    this.visualResources = null;
    this.app?.destroy();
    this.app = null;
    this.camera = null;
    this.serverPlayerId = null;
  }

  private selectPerformanceProfile() {
    const params = new URLSearchParams(location.search);
    const name = params.get('performanceProfile');
    if (name === 'diagnostic' || name === 'benchmark' || name === 'balanced') return PERFORMANCE_PROFILES[name];
    return params.has('harness') ? PERFORMANCE_PROFILES.benchmark : PERFORMANCE_PROFILES.balanced;
  }

  private requestedStreamingVariant(): StreamingVariant {
    return new URLSearchParams(location.search).get('streamingVariant') === 'main-snapshot'
      ? 'main-snapshot'
      : 'worker-first';
  }
}
