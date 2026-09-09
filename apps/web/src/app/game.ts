import * as pc from 'playcanvas';
import * as sceneBootstrap from './scene/scene-bootstrap';
import type { GlobalAudio } from './audio/global-audio';
import { WorldAudio } from './audio/world-audio';
import { WaterExperience } from './gameplay/water-experience';
import { BrowserChunkPersistence } from '../client/persistence/browser-chunk-persistence';
import type { WorldOpenMode } from '@seedlands/game-core/runtime/world-version-policy';
import { PERFORMANCE_PROFILES, type PerformanceProfile } from '../client/presentation/performance-profile';
// prettier-ignore
import { executeSlashCommand, type CommandExecutorPort, type SlashCommandExecution } from '@seedlands/game-core/server/commands/slash-command-parser';
// prettier-ignore
import { ALL_COMMAND_CAPABILITIES, type CommandSource, type ServerCommand } from '@seedlands/game-core/server/commands/command-contract';
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
import type { BrowserComputeRuntime } from '../client/compute/browser-compute-runtime';
import { BrowserLogicClient } from '../client/authority/browser-logic-client';
import * as gamePlayer from './player/game-player-controller';
import { AuthorityPresentationSync } from './authority-presentation-sync';
import { GameUiProjection } from './game-ui-projection';
import { CollisionDebugRuntime } from './player/collision-debug-runtime';
import * as runtimeControls from './game-runtime-controls';
import { applySessionWorkerBudget, readBrowserSessionConfig } from './browser-session-config';
// prettier-ignore
import { resolveExperimentalClientOptions, type ResolvedExperimentalClientOptions } from '../client/experimental-client-options';
import { GameExperimentState } from './experimental/game-experiment-state';
import { GameFrameLoop } from './game-frame-loop';
import { GameSaveQueue } from './world/game-save-queue';
import { startBrowserWorkerSession } from './browser-worker-session';
import { createAppearanceMaterials } from './gameplay/load-appearance-runtime';
import type { AuthorityReady } from '@seedlands/game-core/compute/authority-worker-protocol';
import { readGameRuntimeDiagnostics } from './experimental/game-runtime-diagnostics';
import { restoreBrowserPresentation } from './world/browser-world-restore';

import { CompanionSession } from './gameplay/companion/companion-session';

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
  readonly companion = new CompanionSession(
    () => this.authority,
    () => this.paused,
  );
  private computeRuntime: BrowserComputeRuntime | null = null;
  private logicClient: BrowserLogicClient | null = null;
  private serverPlayerId: string | null = null;
  private seedText = '';
  private qualityLevel: QualityLevel = 'medium';
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
  private pendingStartAbort: AbortController | null = null;
  private readonly experimentState: GameExperimentState;
  private readonly authoritySync = new AuthorityPresentationSync(() => this.controller);
  private collisionDebug: CollisionDebugRuntime | null = null;
  private readonly frameLoop: GameFrameLoop;
  // prettier-ignore
  private readonly saveQueue = new GameSaveQueue(() => this.authority, () => this.performanceTelemetry);
  onRuntimeFailure: ((error: Error) => void) | null = null;
  private readonly onResize = () => this.app?.resizeCanvas();
  private readonly onPageHide = () => void this.saveQueue.flush().catch(() => undefined);

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
      queueSave: () => this.saveQueue.queue(),
      seedText: () => this.seedText,
      session: () => this.uiSession,
      uiProjection: this.uiProjection,
      visualEffects: () => this.visualEffects,
      waterExperience: () => this.waterExperience,
      world: () => this.world,
      worldAudio: () => this.worldAudio,
      nextHudSequence: () => ++this.hudSequence,
      nextDebugSequence: () => ++this.debugSequence,
      diagnostics: () =>
        readGameRuntimeDiagnostics(this.authority, this.logicClient, this.computeRuntime, this.experimentState),
    });
    window.addEventListener('resize', this.onResize);
    window.addEventListener('pagehide', this.onPageHide);
  }

  loadSavedSession = () => this.store.load();

  loadLatestWorldSeed = async () => (await BrowserChunkPersistence.latestWorld())?.seedText ?? null;

  // prettier-ignore
  async start(seedText: string, restore: RestoredSession | null, qualityLevel: QualityLevel, openMode: WorldOpenMode = 'continue') {
    return this.startSession(seedText, restore, qualityLevel, openMode);
  }

  // prettier-ignore
  private async startSession(seedText: string, restore: RestoredSession | null, qualityLevel: QualityLevel, openMode: WorldOpenMode) {
    await this.saveQueue.flush();
    this.disposeRuntime();
    const startAbort = new AbortController();
    this.pendingStartAbort = startAbort;
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
    const clientOptions = {
      onSnapshot: (snapshot: import('@seedlands/game-core/server/authority/authority-session').AuthoritySnapshot) =>
        this.authoritySync.receive(snapshot),
      onGameplay: (view: import('@seedlands/game-core/compute/authority-worker-protocol').AuthorityGameplayView) => {
        this.gameplayClient?.refresh();
        if (view.player.lifecycle === 'dead') this.controller?.releaseInput();
      },
      onCommit: (commit: import('@seedlands/game-core/server/game-server-types').WorldCommitResult) =>
        this.world?.consumeServerCommit(commit),
      onUnknownChunk: (key: string) => runtimeControls.requestAuthorityChunk(this.world, key),
      // prettier-ignore
      onInputDecision: (decision: { sequence: number; decision: import('@seedlands/game-core/runtime/session-protocol').SequenceDecision; requiresResync: boolean }) =>
        gamePlayer.applyAuthorityInputDecision(this.controller, decision),
      onWorldRestored: (ready: AuthorityReady) => this.restoreBrowserWorld(ready),
      onFatal: (error: Error) => {
        runtimeControls.reportRuntimeFailure(this.uiSession, ++this.interactionSequence, error);
        this.onRuntimeFailure?.(error);
      },
    };
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
      ...clientOptions,
      onPlayerDeath: () => this.controller?.releaseInput(),
    });
    const { authority, compute: computeRuntime, logic: logicClient, ready } = session;
    if (this.pendingStartAbort === startAbort) this.pendingStartAbort = null;
    if (startGeneration !== this.startGeneration) {
      logicClient?.dispose();
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
      () => (this.lifecycle.staleVisibleCommits += 1),
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
    // prettier-ignore
    const initialWorldReady = waitForInitialWorldReady(this.world.waitForInitialVisibleChunk());
    this.world.updateStreaming(this.camera.getPosition());
    this.gameplayClient = this.createGameplay(authority, this.serverPlayerId);
    this.controller = this.createController(this.camera);
    this.controller.applyAuthoritySnapshot(authority.snapshot ?? ready.snapshot);
    gamePlayer.orientPlayerTowardCamp(this.controller, ready);
    this.controller.install();
    authority.requestLogicObservation();
    this.app.on('update', (dt: number) => this.frameLoop.update(Math.min(dt, 0.05)));
    await initialWorldReady;
    if (startGeneration !== this.startGeneration) throw new Error('World start was superseded.');
    this.installUiAndHarness();
    this.companion.start();
    return { seed: ready.seedText };
  }

  private createGameplay(authority: BrowserAuthorityClient, playerId: string) {
    if (!this.app || !this.camera || !this.uiSession) throw new Error('Browser presentation is not ready.');
    return new BrowserGameplay({
      app: this.app,
      camera: this.camera,
      authority,
      playerId,
      bridge: this.uiBridge,
      session: this.uiSession,
      nextHudSequence: () => ++this.hudSequence,
      nextInteractionSequence: () => ++this.interactionSequence,
      getVoxel: (x, y, z) => this.world?.getVoxel(x, y, z) ?? 0,
      queueSave: () => this.saveQueue.queue(),
      releaseInput: () => this.controller?.releaseInput(),
      movePlayer: (target) => this.controller?.movePlayerTo(...target),
      orientPlayer: (yaw, pitch) => this.controller?.setView(yaw, pitch),
      executeCommand: (command) => this.executeGameplayCommand(command),
      onPlayerDamage: (amount) => this.controller?.presentDamage(amount),
      onPresentation: (event) => this.worldAudio?.present(event),
    });
  }

  private restoreBrowserWorld(ready: AuthorityReady) {
    const authority = this.authority;
    if (!authority || !this.world || !this.camera || !this.environment) return;
    // prettier-ignore
    const restored = restoreBrowserPresentation(ready, { authority, world: this.world, camera: this.camera, environment: this.environment, audio: this.audio, controller: this.controller, gameplay: this.gameplayClient, worldAudio: this.worldAudio, authoritySync: this.authoritySync, commandSource: this.commandSource, createGameplay: (playerId) => this.createGameplay(authority, playerId), createController: () => this.createController(this.camera!) });
    Object.assign(this, { serverPlayerId: ready.playerId, seedText: ready.seedText, ...restored });
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
      queueSave: () => this.saveQueue.queue(),
      flushSave: () => void this.saveQueue.flush().catch(() => undefined),
      actions: {
        toggleMap: () => this.toggleMap(),
        toggleDebug: () => this.publishDebugVisibility(!this.uiBridge.debug.get().visible),
        toggleCollisionDebug: () => this.toggleCollisionDebug(),
        toggleCommandShell: () => this.toggleCommandShell(),
        toggleInventory: () => this.toggleInventory(),
        setWorldClockPaused: (paused) => {
          if (authority instanceof BrowserAuthorityClient)
            void runtimeControls.setAuthorityWorldClockPaused(this.environment, authority, paused);
        },
        setWorldClockSpeed: (speed) => {
          if (authority instanceof BrowserAuthorityClient)
            void runtimeControls.setAuthorityWorldClockSpeed(this.environment, authority, speed);
        },
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
    this.uiBridge.publishShell({
      phase: 'playing',
      enterLabel: '进入世界',
      commandOpen: false,
      mapOpen: false,
      experience: null,
    });
    this.uiSession?.publishHud(++this.hudSequence, { visible: true });
    this.gameplayClient?.refresh();
    this.publishDebugVisibility(harnessEnabled);
    this.uiBridge.beginMeasurementWindow();
    if (!harnessEnabled || !this.controller) return;
    if (!authority) return;
    this.removeHarness = installHarness(
      createRuntimeHarnessApi({
        developerWorld: () => authority.world,
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
        authority: () => authority,
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
        executeGameplayCommand: (command) => this.executeGameplayCommand(command),
        queueSave: () => this.saveQueue.queue(),
        flushSave: () => this.saveQueue.flush(),
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

  prepareMeleeShowcase = async () => void (await this.gameplayClient?.prepareMeleeShowcase());

  triggerMeleeShowcaseDamage = async () => void (await this.gameplayClient?.triggerMeleeShowcaseDamage());

  releaseInput = () => this.controller?.releaseInput();

  setPaused(paused: boolean) {
    this.paused = paused;
    this.controller?.releaseInput();
    const control =
      this.authority?.mode === 'local' ? (paused ? this.authority.pause() : this.authority.resume()) : undefined;
    void control?.catch(() => undefined);
    this.gameplayClient?.setSuspended(paused);
    // prettier-ignore
    this.worldAudio?.updateWorld(this.camera, this.world, this.controller?.onGround ?? false, paused, this.controller?.waterImmersion);
  }

  async leaveWorld() {
    await this.saveQueue.flush();
    this.uiSession?.publishHud(++this.hudSequence, { visible: false });
    this.disposeRuntime();
    this.uiBridge.publishShell({ phase: 'menu', enterLabel: '进入世界' });
  }

  abortStart = () => {
    this.pendingStartAbort?.abort();
    this.pendingStartAbort = null;
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

  setMapLayer = (layer: MapLayer) => runtimeControls.setMapLayer(this.uiBridge, layer);

  private consumeBrowserCommand(
    command: ServerCommand,
    result: Extract<SlashCommandExecution['result'], { success: true }>,
  ) {
    if (result.commit) this.saveQueue.queue();
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

  private async executeGameplayCommand(command: ServerCommand) {
    if (!this.commandExecutor || !this.commandSource) throw new Error('Gameplay command runtime is unavailable.');
    const result = await this.commandExecutor.execute(this.commandSource, command);
    if (result.success) this.consumeBrowserCommand(command, result);
    return result;
  }

  private publishDebugVisibility = (visible: boolean) =>
    runtimeControls.publishDebugVisibility(this.uiBridge, this.controller, visible);

  toggleMap = () => runtimeControls.toggleMap(this.uiBridge, this.world, this.camera, this.controller);

  private async setWorldTime(hour: number) {
    if (!this.world || !this.environment) return;
    this.environment.setTime(await this.world.setWorldTime(hour));
  }

  private disposeRuntime() {
    this.companion.stop();
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
