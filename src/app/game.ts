import * as pc from 'playcanvas';
import * as sceneBootstrap from './scene/scene-bootstrap';
import type { GlobalAudio } from './audio/global-audio';
import { WorldAudio } from './audio/world-audio';
import { WaterExperience } from './gameplay/water-experience';
import { BrowserChunkPersistence } from '../client/persistence/browser-chunk-persistence';
import type { WorldOpenMode } from '../client/world-version-policy';
import { PERFORMANCE_PROFILES, type PerformanceProfile } from '../client/presentation/performance-profile';
import {
  executeSlashCommand,
  type CommandExecutorPort,
  type SlashCommandExecution,
} from '../server/commands/slash-command-parser';
import { ALL_COMMAND_CAPABILITIES, type CommandSource, type ServerCommand } from '../server/commands/command-contract';
import type { LifecycleSnapshot, RestoredSession } from './app-contracts';
import { BrowserGameplay } from './gameplay/browser-gameplay';
import { BrowserWorldStore } from './world/browser-world-store';
import { createRuntimeHarnessApi, installHarness } from './game-harness';
import { PLAYER_FEET_OFFSET, PlayerController } from './player/player-controller';
import { QUALITY_PROFILES, type QualityLevel } from './scene/quality-profile';
import type { UiBridge, UiWorldSession } from './ui/ui-bridge';
import type { MapLayer } from './ui/ui-contracts';
import { WorldEnvironment } from './scene/world-environment';
import { World, waitForInitialWorldReady } from './world/world-runtime';
import { AdvancedVisualEffects } from './scene/advanced-visual-effects';
import { LIGHTING_QUALITY_BUDGETS } from './scene/advanced-lighting-budget';
import { BrowserAuthorityClient } from '../client/authority/browser-authority-client';
import { BrowserComputeRuntime } from '../client/compute/browser-compute-runtime';
import { BrowserLogicClient } from '../client/authority/browser-logic-client';
import { startBrowserWorkerSession } from './browser-worker-session';
import * as gamePlayer from './player/game-player-controller';
import { AuthorityPresentationSync } from './authority-presentation-sync';
import { GameUiProjection } from './game-ui-projection';
import { CollisionDebugRuntime } from './player/collision-debug-runtime';
import * as runtimeControls from './game-runtime-controls';
import { applySessionWorkerBudget, readBrowserSessionConfig } from './browser-session-config';
import {
  resolveExperimentalClientOptions,
  type ResolvedExperimentalClientOptions,
} from '../client/experimental-client-options';
import { GameExperimentState } from './experimental/game-experiment-state';
import { GameFrameLoop } from './game-frame-loop';
import { createAppearanceMaterials } from './gameplay/load-appearance-runtime';

export class Game {
  private paused = false;
  private worldAudio: WorldAudio | null = null;
  private waterExperience: WaterExperience | null = null;
  private app: pc.Application | null = null;
  private world: World | null = null;
  private environment: WorldEnvironment | null = null;
  private visualEffects: AdvancedVisualEffects | null = null;
  private visualResources: Awaited<ReturnType<typeof createAppearanceMaterials>> | null = null;
  private controller: PlayerController | null = null;
  private gameplayClient: BrowserGameplay | null = null;
  private camera: pc.Entity | null = null;
  private performanceProfile: PerformanceProfile = PERFORMANCE_PROFILES.balanced;
  private performanceTelemetry = sceneBootstrap.createPerformanceTelemetry(PERFORMANCE_PROFILES.balanced);
  private readonly store = new BrowserWorldStore();
  private authority: BrowserAuthorityClient | null = null;
  private computeRuntime: BrowserComputeRuntime | null = null;
  private logicClient: BrowserLogicClient | null = null;
  private serverPlayerId: string | null = null;
  private seedText = '';
  private qualityLevel: QualityLevel = 'medium';
  private saveTimer: number | null = null;
  private saveInFlight: Promise<void> = Promise.resolve();
  private removeHarness: (() => void) | null = null;
  private commandExecutor: CommandExecutorPort | null = null;
  private commandSource: CommandSource | null = null;
  private uiSession: UiWorldSession | null = null;
  private hudSequence = 0;
  private interactionSequence = 0;
  private debugSequence = 0;
  private readonly uiProjection = new GameUiProjection();
  private readonly lifecycle: LifecycleSnapshot = { worldInstanceId: 0, disposedWorlds: 0, staleVisibleCommits: 0 };
  private sessionSequence = 0;
  private startGeneration = 0;
  private readonly experimentState: GameExperimentState;
  private readonly authoritySync = new AuthorityPresentationSync(() => this.controller);
  private collisionDebug: CollisionDebugRuntime | null = null;
  private readonly frameLoop: GameFrameLoop;
  onRuntimeFailure: ((error: Error) => void) | null = null;
  private readonly onResize = () => this.app?.resizeCanvas();
  private readonly onPageHide = () => void this.flushSave().catch(() => undefined);

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly uiBridge: UiBridge,
    private readonly audio?: GlobalAudio,
    experiments: ResolvedExperimentalClientOptions = resolveExperimentalClientOptions(),
  ) {
    this.experimentState = new GameExperimentState(experiments);
    this.frameLoop = new GameFrameLoop({
      app: () => this.app,
      authority: () => this.authority,
      camera: () => this.camera,
      collisionDebug: () => this.collisionDebug,
      controller: () => this.controller,
      environment: () => this.environment,
      gameplay: () => this.gameplayClient,
      paused: () => this.paused,
      performanceProfile: () => this.performanceProfile,
      performanceTelemetry: () => this.performanceTelemetry,
      qualityLevel: () => this.qualityLevel,
      queueSave: () => this.queueSave(),
      seedText: () => this.seedText,
      session: () => this.uiSession,
      uiProjection: this.uiProjection,
      visualEffects: () => this.visualEffects,
      waterExperience: () => this.waterExperience,
      world: () => this.world,
      worldAudio: () => this.worldAudio,
      nextHudSequence: () => ++this.hudSequence,
      nextDebugSequence: () => ++this.debugSequence,
    });
    window.addEventListener('resize', this.onResize);
    window.addEventListener('pagehide', this.onPageHide);
  }

  loadSavedSession = () => this.store.load();

  loadLatestWorldSeed = async () => (await BrowserChunkPersistence.latestWorld())?.seedText ?? null;

  async start(
    seedText: string,
    restore: RestoredSession | null,
    qualityLevel: QualityLevel,
    openMode: WorldOpenMode = 'continue',
  ) {
    await this.flushSave();
    this.disposeRuntime();
    const startGeneration = ++this.startGeneration;
    this.paused = false;
    this.seedText = seedText;
    this.qualityLevel = qualityLevel;
    this.uiSession = this.uiBridge.beginWorldSession(seedText);
    this.hudSequence = this.interactionSequence = this.debugSequence = 0;
    this.uiProjection.reset();
    const quality = QUALITY_PROFILES[this.qualityLevel];
    const lightingBudget = LIGHTING_QUALITY_BUDGETS[this.qualityLevel];
    this.performanceProfile = sceneBootstrap.selectPerformanceProfile(location.search);
    this.performanceTelemetry = sceneBootstrap.createPerformanceTelemetry(this.performanceProfile);
    this.frameLoop.reset();
    const scene = await sceneBootstrap.createSceneApplication(this.canvas, this.experimentState.rendererRequest);
    if (startGeneration !== this.startGeneration) {
      scene.application.destroy();
      throw new Error('World start was superseded.');
    }
    this.app = scene.application;
    this.experimentState.acceptRenderer(scene);
    this.collisionDebug = new CollisionDebugRuntime(this.app);
    const light = sceneBootstrap.createSun(this.app, lightingBudget);
    this.camera = sceneBootstrap.createCamera(this.app, quality.fogEnd + 18);
    this.visualResources = await createAppearanceMaterials(this.app, quality);
    if (startGeneration !== this.startGeneration) {
      this.visualResources.destroy();
      this.visualResources = null;
      throw new Error('World start was superseded.');
    }
    this.camera.camera!.layers = [...this.camera.camera!.layers, this.visualResources.waterLayer.id];
    this.environment = new WorldEnvironment(this.app, light, quality, this.visualResources.water);
    const sessionConfig = readBrowserSessionConfig(location.search);
    const { harnessEnabled, generalWorkerCount, physicsHz, authorityTransportFaults } = sessionConfig;
    this.performanceProfile = applySessionWorkerBudget(this.performanceProfile, generalWorkerCount);
    const session = await startBrowserWorkerSession({
      epochSequence: ++this.sessionSequence,
      seedText,
      openMode,
      legacySnapshots: restore?.seed === seedText ? restore.legacySnapshots : [],
      initialWorldTime: this.environment.worldTime,
      harnessEnabled,
      generalWorkerCount,
      wasm: this.experimentState.workerSelection,
      frequencies: { physicsHz, gameplayHz: 20, fluidHz: 30 },
      authorityTransportFaults,
      onSnapshot: (snapshot) => this.authoritySync.receive(snapshot),
      onGameplay: () => this.gameplayClient?.refresh(),
      onPlayerDeath: () => this.controller?.releaseInput(),
      onCommit: (commit) => this.world?.consumeServerCommit(commit),
      onUnknownChunk: (key) => runtimeControls.requestAuthorityChunk(this.world, key),
      onInputDecision: (decision) => gamePlayer.applyAuthorityInputDecision(this.controller, decision),
      onFatal: (error) => {
        runtimeControls.reportRuntimeFailure(this.uiSession, ++this.interactionSequence, error);
        this.onRuntimeFailure?.(error);
      },
    });
    const { authority, compute: computeRuntime, logic: logicClient, ready } = session;
    if (startGeneration !== this.startGeneration) {
      logicClient.dispose();
      authority.dispose();
      computeRuntime.dispose();
      throw new Error('World start was superseded.');
    }
    this.authority = authority;
    this.computeRuntime = computeRuntime;
    this.logicClient = logicClient;
    this.environment.setTime(ready.worldTime);
    if (this.audio) this.worldAudio = new WorldAudio(this.audio, ready.seed);
    this.world = new World(
      authority,
      this.computeRuntime.meshPort,
      this.app,
      this.visualResources.resolve,
      quality,
      this.performanceTelemetry,
      this.performanceProfile,
      'worker-first',
      () => {
        this.lifecycle.staleVisibleCommits += 1;
      },
      this.visualResources.waterLayer.id,
    );
    this.visualEffects = new AdvancedVisualEffects(
      this.app,
      this.camera,
      this.world,
      lightingBudget,
      this.visualResources,
    );
    this.waterExperience = new WaterExperience(this.camera.camera ?? null, this.app.graphicsDevice);
    this.lifecycle.worldInstanceId += 1;
    if (restore?.changes.length) await this.world.restoreLegacyChanges(restore.changes);
    const feet = ready.playerBodyPosition;
    this.camera.setPosition(feet[0], feet[1] + PLAYER_FEET_OFFSET, feet[2]);
    this.serverPlayerId = ready.playerId;
    this.world.updateStreaming(this.camera.getPosition());
    this.gameplayClient = new BrowserGameplay({
      app: this.app,
      camera: this.camera,
      authority,
      playerId: this.serverPlayerId,
      bridge: this.uiBridge,
      session: this.uiSession,
      nextHudSequence: () => ++this.hudSequence,
      nextInteractionSequence: () => ++this.interactionSequence,
      getVoxel: (x, y, z) => this.world?.getVoxel(x, y, z) ?? 0,
      queueSave: () => this.queueSave(),
      releaseInput: () => this.controller?.releaseInput(),
      movePlayer: (target) => this.controller?.movePlayerTo(...target),
      onPresentation: (event) => this.worldAudio?.present(event),
    });
    this.controller = this.createController(this.camera);
    this.controller.applyAuthoritySnapshot(authority.snapshot ?? ready.snapshot);
    gamePlayer.orientPlayerTowardCamp(this.controller, ready);
    this.controller.install();
    authority.requestLogicObservation();
    this.app.on('update', (dt: number) => this.frameLoop.update(Math.min(dt, 0.05)));
    await waitForInitialWorldReady(this.world.waitForInitialVisibleChunk());
    if (startGeneration !== this.startGeneration) throw new Error('World start was superseded.');
    this.installUiAndHarness();
  }

  private createController(camera: pc.Entity) {
    const authority = this.authority;
    if (!authority) throw new Error('Authority client is not ready.');
    return gamePlayer.createGamePlayerController({
      camera,
      canvas: this.canvas,
      telemetry: this.performanceTelemetry,
      authority,
      getWorld: () => this.world,
      getEnvironment: () => this.environment,
      isPaused: () => this.paused,
      uiBridge: this.uiBridge,
      getGameplay: () => this.gameplayClient,
      getUiSession: () => this.uiSession,
      nextInteractionSequence: () => ++this.interactionSequence,
      queueSave: () => this.queueSave(),
      flushSave: () => void this.flushSave().catch(() => undefined),
      actions: {
        toggleMap: () => this.toggleMap(),
        toggleDebug: () => this.publishDebugVisibility(!this.uiBridge.debug.get().visible),
        toggleCollisionDebug: () => this.toggleCollisionDebug(),
        toggleCommandShell: () => this.toggleCommandShell(),
        toggleInventory: () => this.toggleInventory(),
        setWorldClockPaused: (paused) =>
          void runtimeControls.setAuthorityWorldClockPaused(this.environment, authority, paused),
        setWorldClockSpeed: (speed) =>
          void runtimeControls.setAuthorityWorldClockSpeed(this.environment, authority, speed),
        closeMap: () => this.closeMap(),
        closeCommandShell: () => this.closeCommandShell(),
        closeInventory: () => this.closeInventory(),
        selectHotbarSlot: (slot) => this.selectHotbarSlot(slot),
      },
    });
  }

  private installUiAndHarness() {
    const authority = this.authority;
    if (authority && this.serverPlayerId) {
      this.commandExecutor = { execute: (source, command) => authority.executeCommand(source, command) };
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
    this.removeHarness = installHarness(
      createRuntimeHarnessApi({
        lifecycleSnapshot: () => ({ ...this.lifecycle }),
        restartWorld: async (seed) => {
          await this.start(seed, null, this.qualityLevel);
        },
        world: () => this.world,
        controller: () => this.controller,
        camera: () => this.camera,
        environment: () => this.environment,
        gameplay: () => this.gameplayClient,
        frameMs: () => this.frameLoop.frameMs,
        qualityLevel: () => this.qualityLevel,
        authority: () => this.authority,
        collisionDebug: () => this.collisionDebug,
        compute: () => this.computeRuntime,
        logic: () => this.logicClient,
        authorityTrajectory: () => this.authoritySync.snapshot(),
        ui: () => this.uiBridge.metrics(),
        visualEffects: () => this.visualEffects,
        underwaterVisual: () => this.waterExperience?.visual ?? null,
        setWorldTime: (hour) => this.setWorldTime(hour),
        setTimePaused: (paused) => runtimeControls.setAuthorityWorldClockPaused(this.environment, authority, paused),
        setTimeSpeed: (speed) => runtimeControls.setAuthorityWorldClockSpeed(this.environment, authority, speed),
        blockLogicWorker: (ms) =>
          this.logicClient?.blockForHarness(ms) ?? Promise.reject(new Error('Logic Worker不可用。')),
        executeGameplayCommand: async (command) => {
          if (!this.commandExecutor || !this.commandSource) throw new Error('Harness command runtime is unavailable.');
          const result = await this.commandExecutor.execute(this.commandSource, command);
          if (result.success) this.consumeBrowserCommand(command, result);
          return result;
        },
        queueSave: () => this.queueSave(),
        flushSave: () => this.flushSave(),
        experiments: () => this.experimentState.diagnostics(this.computeRuntime?.diagnostics.workerKernelStates ?? []),
      }),
    );
  }

  async executeCommand(input: string): Promise<SlashCommandExecution> {
    if (!this.commandExecutor || !this.commandSource) throw new Error('服务端命令入口尚未就绪。');
    const execution = await executeSlashCommand(this.commandExecutor, this.commandSource, input);
    if (execution.command && execution.result.success) this.consumeBrowserCommand(execution.command, execution.result);
    return execution;
  }

  releaseInput = () => this.controller?.releaseInput();

  setPaused(paused: boolean) {
    this.paused = paused;
    this.controller?.releaseInput();
    const control = paused ? this.authority?.pause() : this.authority?.resume();
    void control?.catch(() => undefined);
    this.gameplayClient?.setSuspended(paused);
    this.worldAudio?.updateWorld(
      this.camera,
      this.world,
      this.controller?.onGround ?? false,
      paused,
      this.controller?.waterImmersion,
    );
  }

  async leaveWorld() {
    await this.flushSave();
    this.uiSession?.publishHud(++this.hudSequence, { visible: false });
    this.disposeRuntime();
    this.uiBridge.publishShell({ phase: 'menu', enterLabel: '进入世界' });
  }

  abortStart = () => {
    this.disposeRuntime();
  };

  dispose() {
    this.abortStart();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pagehide', this.onPageHide);
  }

  selectHotbarSlot = (slot: number) => this.gameplayClient?.selectHotbarSlot(slot);

  toggleInventory = () => this.gameplayClient?.toggleInventory();

  toggleCollisionDebug = () => this.collisionDebug?.toggle();

  setCollisionDebugContacts = (enabled: boolean) => this.collisionDebug?.setDetails({ contacts: enabled });

  setCollisionDebugSensors = (enabled: boolean) => this.collisionDebug?.setDetails({ sensors: enabled });

  closeInventory = () => this.gameplayClient?.closeInventory();

  craftRecipe = (recipeId: string) => this.gameplayClient?.craftRecipe(recipeId);

  moveInventorySlot = (source: number, target: number) => this.gameplayClient?.moveInventorySlot(source, target);

  useInventoryItem = (slot: number) => this.gameplayClient?.useInventoryItem(slot);

  respawn = () => this.gameplayClient?.respawn();

  toggleCommandShell() {
    const open = !this.uiBridge.shell.get().commandOpen;
    if (open) this.controller?.releaseInput();
    this.uiBridge.publishShell({ commandOpen: open });
  }

  closeCommandShell = () => this.uiBridge.publishShell({ commandOpen: false });

  closeMap = () => this.uiBridge.publishShell({ mapOpen: false });

  setMapLayer(layer: MapLayer) {
    const shell = this.uiBridge.shell.get();
    if (shell.mapLayer === layer) return;
    this.uiBridge.publishShell({ mapLayer: layer, mapRevision: shell.mapRevision + 1 });
  }

  private consumeBrowserCommand(
    command: ServerCommand,
    result: Extract<SlashCommandExecution['result'], { success: true }>,
  ) {
    if (result.commit) this.queueSave();
    if (command.type === 'teleport' && this.serverPlayerId) {
      const entity = this.authority?.gameplay.entities.find((candidate) => candidate.id === this.serverPlayerId);
      if (entity)
        void this.controller?.movePlayerTo(
          entity.position[0],
          entity.position[1] + PLAYER_FEET_OFFSET,
          entity.position[2],
        );
    }
    if (command.type === 'time-set' && this.world && this.environment) this.environment.setTime(this.world.worldTime);
    this.gameplayClient?.refresh();
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

  private async setWorldTime(hour: number) {
    if (!this.world || !this.environment) return;
    this.environment.setTime(await this.world.setWorldTime(hour));
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
    const authority = this.authority;
    if (!authority) return this.saveInFlight;
    const save = this.saveInFlight.then(async () => {
      const span = this.performanceTelemetry.beginSpan('persistence', 'FlushWorldSave');
      try {
        await authority.save();
      } finally {
        this.performanceTelemetry.endSpan(span);
      }
    });
    this.saveInFlight = save.catch(() => undefined);
    return save;
  }

  private disposeRuntime() {
    this.startGeneration += 1;
    this.worldAudio?.dispose();
    this.worldAudio = null;
    this.uiSession?.dispose();
    this.uiSession = null;
    this.commandExecutor = null;
    this.commandSource = null;
    this.removeHarness?.();
    this.removeHarness = null;
    this.controller?.dispose();
    this.controller = null;
    this.collisionDebug?.dispose();
    this.collisionDebug = null;
    this.gameplayClient?.dispose();
    this.gameplayClient = null;
    this.uiBridge.publishShell({ commandOpen: false, mapOpen: false });
    if (this.world) {
      this.world.dispose();
      this.lifecycle.disposedWorlds += 1;
    }
    this.world = null;
    this.logicClient?.dispose();
    this.logicClient = null;
    this.authority?.dispose();
    this.authority = null;
    this.computeRuntime?.dispose();
    this.computeRuntime = null;
    this.authoritySync.clear();
    this.visualEffects?.destroy();
    this.visualEffects = null;
    this.waterExperience?.destroy();
    this.waterExperience = null;
    this.environment?.destroy();
    this.environment = null;
    this.visualResources?.destroy();
    this.visualResources = null;
    this.app?.destroy();
    this.app = null;
    this.experimentState.clearRenderer();
    this.camera = null;
    this.serverPlayerId = null;
  }
}
