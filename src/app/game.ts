import * as pc from 'playcanvas';
import { BrowserChunkPersistence } from '../client/browser-chunk-persistence';
import { PERFORMANCE_PROFILES, type PerformanceProfile } from '../client/performance-profile';
import { PerformanceTelemetry } from '../client/performance-telemetry';
import {
  ALL_COMMAND_CAPABILITIES,
  ServerCommandExecutor,
  type CommandSource,
} from '../server/commands/server-command-executor';
import { executeSlashCommand, type SlashCommandExecution } from '../server/commands/slash-command-parser';
import type { ServerCommand } from '../server/commands/command-contract';
import { GameServer } from '../server/game-server';
import { CHUNK_SIZE, floorDiv } from '../world/voxel';
import type { HarnessSnapshot, LifecycleSnapshot, RestoredSession, StreamingVariant } from './app-contracts';
import { BrowserGameplay } from './browser-gameplay';
import { BrowserWorldStore } from './browser-world-store';
import { createHarnessSnapshot, installHarness } from './game-harness';
import { projectDebug, projectWorldClock } from './hud-projector';
import { PlayerController } from './player-controller';
import { QUALITY_PROFILES, type QualityLevel } from './quality-profile';
import type { UiBridge, UiWorldSession } from './ui/ui-bridge';
import type { MapLayer } from './ui/ui-contracts';
import { createVoxelMaterials, type VoxelMaterials } from './voxel-materials';
import { WorldEnvironment } from './world-environment';
import { World } from './world-runtime';

export class Game {
  private app: pc.Application | null = null;
  private world: World | null = null;
  private environment: WorldEnvironment | null = null;
  private visualResources: VoxelMaterials | null = null;
  private controller: PlayerController | null = null;
  private gameplayClient: BrowserGameplay | null = null;
  private camera: pc.Entity | null = null;
  private lastFpsSample = performance.now();
  private frames = 0;
  private fps = 0;
  private frameMs = 0;
  private lastFrameTimestamp = performance.now();
  private performanceProfile: PerformanceProfile = PERFORMANCE_PROFILES.balanced;
  private performanceTelemetry = new PerformanceTelemetry({ now: () => performance.now() });
  private readonly store = new BrowserWorldStore();
  private persistence: BrowserChunkPersistence | null = null;
  private serverPlayerId: string | null = null;
  private seedText = '';
  private qualityLevel: QualityLevel = 'medium';
  private saveTimer: number | null = null;
  private saveInFlight: Promise<void> = Promise.resolve();
  private removeHarness: (() => void) | null = null;
  private commandExecutor: ServerCommandExecutor | null = null;
  private commandSource: CommandSource | null = null;
  private uiSession: UiWorldSession | null = null;
  private hudSequence = 0;
  private interactionSequence = 0;
  private debugSequence = 0;
  private lastClockMinute = -1;
  private lastClockPublishAt = -Infinity;
  private readonly lifecycle: LifecycleSnapshot = { worldInstanceId: 0, disposedWorlds: 0, staleVisibleCommits: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly uiBridge: UiBridge,
  ) {
    window.addEventListener('resize', () => this.app?.resizeCanvas());
    window.addEventListener('pagehide', () => void this.flushSave().catch(() => undefined));
  }

  loadSavedSession() {
    return this.store.load();
  }

  async loadLatestWorldSeed() {
    return (await BrowserChunkPersistence.latestWorld())?.seedText ?? null;
  }

  async start(seedText: string, restore: RestoredSession | null, qualityLevel: QualityLevel) {
    await this.flushSave();
    this.disposeRuntime();
    this.seedText = seedText;
    this.qualityLevel = qualityLevel;
    this.uiSession = this.uiBridge.beginWorldSession(seedText);
    this.hudSequence = this.interactionSequence = this.debugSequence = 0;
    this.lastClockMinute = -1;
    this.lastClockPublishAt = -Infinity;
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
    this.persistence = await BrowserChunkPersistence.open(seedText, {
      legacySnapshots: restore?.seed === seedText ? restore.legacySnapshots : [],
    });
    this.app = this.createApplication();
    const light = this.createSun(this.app, quality.shadowQuality !== 'off');
    this.camera = this.createCamera(this.app, quality.fogEnd + 18);
    this.visualResources = await createVoxelMaterials(this.app, quality);
    this.environment = new WorldEnvironment(this.app, light, quality, this.visualResources.water);
    const server = new GameServer({ seedText, persistence: this.persistence });
    server.setWorldTime(this.environment.worldTime);
    await server.restore();
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
    const restoredPlayer = server.queryEntities({ type: 'player' })[0];
    const position: [number, number, number] = restoredPlayer?.position ??
      this.persistence.restoredPlayer ??
      (restore?.seed === seedText ? restore.player : null) ?? [0, 34, 0];
    await server.ensureChunkNeighborhood(
      floorDiv(position[0], CHUNK_SIZE),
      floorDiv(position[1], CHUNK_SIZE),
      floorDiv(position[2], CHUNK_SIZE),
    );
    this.camera.setPosition(...position);
    this.serverPlayerId = restoredPlayer?.id ?? server.spawnPlayer({ position }).id;
    this.world.updateStreaming(this.camera.getPosition());
    this.gameplayClient = new BrowserGameplay({
      app: this.app,
      server,
      playerId: this.serverPlayerId,
      bridge: this.uiBridge,
      session: this.uiSession,
      nextHudSequence: () => ++this.hudSequence,
      nextInteractionSequence: () => ++this.interactionSequence,
      consumeCommit: (commit) => this.world?.consumeServerCommit(commit),
      queueSave: () => this.queueSave(),
      releaseInput: () => this.controller?.releaseInput(),
      movePlayer: (target) => this.controller?.movePlayerTo(...target),
    });
    this.controller = this.createController(this.camera);
    this.controller.install();
    this.installUiAndHarness();
    this.app.on('update', (dt: number) => this.update(Math.min(dt, 0.05)));
  }

  private createApplication() {
    const app = new pc.Application(this.canvas, {
      mouse: new pc.Mouse(this.canvas),
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
      canvas: this.canvas,
      telemetry: this.performanceTelemetry,
      getWorld: () => this.world,
      getEnvironment: () => this.environment,
      onToggleMap: () => this.toggleMap(),
      onToggleDebug: () => this.toggleDebug(),
      onToggleCommandShell: () => this.toggleCommandShell(),
      onToggleInventory: () => this.toggleInventory(),
      onSelectHotbarSlot: (slot) => this.selectHotbarSlot(slot),
      onAttackTarget: (origin, direction, maxDistance) =>
        this.gameplayClient?.attackTarget(origin, direction, maxDistance) ?? false,
      onBeginBreak: (position) => this.gameplayClient?.beginBreak(position),
      onCancelBreak: () => this.gameplayClient?.cancelBreak(),
      onPlace: (position) => this.gameplayClient?.place(position),
      isUiBlockingInput: () =>
        Boolean(
          this.gameplayClient?.blocksInput ||
          this.uiBridge.shell.get().commandOpen ||
          this.uiBridge.shell.get().mapOpen,
        ),
      onCloseUi: () => {
        this.closeInventory();
        this.closeMap();
        this.closeCommandShell();
      },
      onFeedback: (message, tone) =>
        this.uiSession?.publishFeedback(++this.interactionSequence, { message, tone, durationMs: 900 }),
      onQueueSave: () => this.queueSave(),
      onFlushSave: () => void this.flushSave().catch(() => undefined),
    });
  }

  private installUiAndHarness() {
    const world = this.world;
    if (world && this.serverPlayerId) {
      this.commandExecutor = new ServerCommandExecutor(world.server);
      this.commandSource = {
        actorId: 'browser-local-developer',
        sourceType: 'local-developer',
        entityId: this.serverPlayerId,
        capabilities: ALL_COMMAND_CAPABILITIES,
      };
    }
    const harnessEnabled = new URLSearchParams(location.search).has('harness');
    this.uiBridge.publishShell({ phase: 'playing', enterLabel: '进入世界', commandOpen: false, mapOpen: false });
    this.uiSession?.publishHud(++this.hudSequence, { visible: true });
    this.gameplayClient?.refresh();
    this.publishDebugVisibility(harnessEnabled);
    this.uiBridge.beginMeasurementWindow();
    if (!harnessEnabled || !this.controller) return;
    this.removeHarness = installHarness({
      snapshot: () => this.harnessSnapshot(),
      lifecycleSnapshot: () => ({ ...this.lifecycle }),
      restartWorld: async (seed) => {
        await this.start(seed, null, this.qualityLevel);
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
      executeGameplayCommand: async (command) => {
        if (!this.commandExecutor || !this.commandSource) throw new Error('Harness command runtime is unavailable.');
        const result = await this.commandExecutor.execute(this.commandSource, command);
        if (result.success) this.consumeBrowserCommand(command, result);
        return result;
      },
      advanceGameplay: (seconds) => this.gameplayClient?.advance(seconds),
    });
  }

  private async executeBrowserCommand(
    executor: ServerCommandExecutor,
    source: CommandSource,
    input: string,
  ): Promise<SlashCommandExecution> {
    const execution = await executeSlashCommand(executor, source, input);
    if (!execution.command || !execution.result.success) return execution;
    this.consumeBrowserCommand(execution.command, execution.result);
    return execution;
  }

  async executeCommand(input: string): Promise<SlashCommandExecution> {
    if (!this.commandExecutor || !this.commandSource) throw new Error('服务端命令入口尚未就绪。');
    return this.executeBrowserCommand(this.commandExecutor, this.commandSource, input);
  }

  releaseInput() {
    this.controller?.releaseInput();
  }

  selectHotbarSlot(slot: number) {
    this.gameplayClient?.selectHotbarSlot(slot);
  }

  toggleInventory() {
    this.gameplayClient?.toggleInventory();
  }

  closeInventory() {
    this.gameplayClient?.closeInventory();
  }

  craftRecipe(recipeId: string) {
    this.gameplayClient?.craftRecipe(recipeId);
  }

  respawn() {
    this.gameplayClient?.respawn();
  }

  toggleCommandShell() {
    const open = !this.uiBridge.shell.get().commandOpen;
    if (open) this.controller?.releaseInput();
    this.uiBridge.publishShell({ commandOpen: open });
  }

  closeCommandShell() {
    this.uiBridge.publishShell({ commandOpen: false });
  }

  closeMap() {
    this.uiBridge.publishShell({ mapOpen: false });
  }

  setMapLayer(layer: MapLayer) {
    const shell = this.uiBridge.shell.get();
    if (shell.mapLayer === layer) return;
    this.uiBridge.publishShell({ mapLayer: layer, mapRevision: shell.mapRevision + 1 });
  }

  private consumeBrowserCommand(
    command: ServerCommand,
    result: Extract<SlashCommandExecution['result'], { success: true }>,
  ) {
    if (result.commit) {
      this.world?.consumeServerCommit(result.commit);
      this.queueSave();
    }
    if (command.type === 'teleport' && this.serverPlayerId) {
      const entity = this.world?.server.getEntity(this.serverPlayerId);
      if (entity) this.controller?.movePlayerTo(...entity.position);
    }
    if (command.type === 'time-set' && this.world && this.environment)
      this.environment.setTime(this.world.server.worldTime);
    this.gameplayClient?.refresh();
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
    if (this.serverPlayerId) {
      const position = this.camera.getPosition();
      this.gameplayClient?.updatePlayerPosition([position.x, position.y, position.z]);
      this.gameplayClient?.advance(dt);
    }
    this.publishUiProjection();
    this.performanceTelemetry.endFrame(actualFrameMs);
    if (Math.floor(now / 2000) !== Math.floor((now - dt * 1000) / 2000)) this.queueSave();
  }

  private publishUiProjection() {
    if (!this.world || !this.camera || !this.uiSession) return;
    const worldTime = this.world.server.worldTime;
    const displayMinute = Math.floor(worldTime * 60);
    const now = performance.now();
    if (displayMinute !== this.lastClockMinute && now - this.lastClockPublishAt >= 600) {
      this.lastClockMinute = displayMinute;
      this.lastClockPublishAt = now;
      this.uiSession.publishHud(++this.hudSequence, {
        worldClock: projectWorldClock(worldTime, this.environment?.phase ?? 'Day'),
      });
    }
    this.uiSession.sampleDebug(++this.debugSequence, () =>
      this.performanceTelemetry.withSpan('ui', 'DebugProjection', () =>
        projectDebug({
          world: this.world!,
          environment: this.environment,
          camera: this.camera!,
          fps: this.fps,
          frameMs: this.frameMs,
          qualityLevel: this.qualityLevel,
          performanceProfile: this.performanceProfile,
          deviceType: this.app?.graphicsDevice.deviceType ?? 'WebGL2',
          seedText: this.seedText,
        }),
      ),
    );
  }

  private toggleDebug() {
    this.publishDebugVisibility(!this.uiBridge.debug.get().visible);
  }

  private publishDebugVisibility(visible: boolean) {
    this.uiBridge.publishDebug({ visible });
  }

  toggleMap() {
    if (!this.world || !this.camera) return;
    if (this.uiBridge.shell.get().mapOpen) return this.closeMap();
    const position = this.camera.getPosition();
    this.controller?.releaseInput();
    const shell = this.uiBridge.shell.get();
    this.uiBridge.publishShell({
      mapOpen: true,
      mapSeed: this.world.seed,
      mapCenter: [position.x, position.z],
      mapRevision: shell.mapRevision + 1,
    });
  }

  private harnessSnapshot(): HarnessSnapshot {
    return createHarnessSnapshot({
      world: this.world,
      environment: this.environment,
      controller: this.controller,
      frameMs: this.frameMs,
      qualityLevel: this.qualityLevel,
      serverPlayerId: this.serverPlayerId,
      persistence: this.persistence,
      ui: this.uiBridge.metrics(),
      presentedEntityCount: this.gameplayClient?.presentedEntityCount ?? 0,
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
      void this.flushSave().catch(() => undefined);
    }, 48);
  }

  private flushSave(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const world = this.world;
    const persistence = this.persistence;
    if (!world || !persistence || !this.camera || !this.serverPlayerId) return this.saveInFlight;
    const current = this.camera.getPosition();
    const player: [number, number, number] = [current.x, current.y, current.z];
    const save = this.saveInFlight.then(async () => {
      const span = this.performanceTelemetry.beginSpan('persistence', 'FlushWorldSave');
      try {
        world.server.updateEntity(this.serverPlayerId!, { position: player });
        await world.server.save();
        await persistence.saveMetadata(player);
      } finally {
        this.performanceTelemetry.endSpan(span);
      }
    });
    this.saveInFlight = save.catch(() => undefined);
    return save;
  }

  private disposeRuntime() {
    this.uiSession?.dispose();
    this.uiSession = null;
    this.commandExecutor = null;
    this.commandSource = null;
    this.removeHarness?.();
    this.removeHarness = null;
    this.controller?.dispose();
    this.controller = null;
    this.gameplayClient?.dispose();
    this.gameplayClient = null;
    this.uiBridge.publishShell({ commandOpen: false, mapOpen: false });
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
    this.persistence?.dispose();
    this.persistence = null;
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
