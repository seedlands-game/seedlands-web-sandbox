import { ShellController, sanitizeQuality, type ShellQuality } from '../client/shell/shell-controller';
import type { GlobalAudio } from './audio/global-audio';
import type { Game } from './game';
import type { UiBridge } from './ui/ui-bridge';
import type { ActorMode } from './ui/ui-contracts';
import { isUserPointerUnlock } from './player/pointer-lock';
import type { WorldOpenMode } from '@seedlands/stdlib/runtime/world-version-policy';
import {
  persistExperimentalClientOptions,
  readStoredExperimentalClientOptions,
  resolveExperimentalClientOptions,
  urlWithoutExperimentalOverride,
  type ExperimentalClientOptions,
  type ExperimentalOptionField,
  type ResolvedExperimentalClientOptions,
} from '../client/experimental-client-options';
import {
  estimateHardwareCores,
  preflightClientCapabilities,
  requiredWorkerCount,
  type ClientCapabilityState,
} from './client-capability-preflight';
import { MELEE_SHOWCASE_SEED } from './gameplay/melee-action-showcase';

const QUALITY_KEY = 'seedlands.quality.v1';

type PendingStart = Readonly<{
  seed: string;
  quality: ShellQuality;
  openMode: WorldOpenMode;
  actorMode: ActorMode;
  experience: 'melee-showcase' | null;
}>;

type ApplicationShellOptions = Readonly<{
  experiments?: ResolvedExperimentalClientOptions;
  generalWorkerCount?: 1 | 2;
  preflight?: (generalWorkerCount: 1 | 2) => Promise<ClientCapabilityState>;
}>;

export class ApplicationShell {
  readonly controller: ShellController;
  quality: ShellQuality = 'medium';
  latestSeed = '';
  panel: 'settings' | 'guide' | null = null;
  readonly appliedExperiments: ResolvedExperimentalClientOptions;
  pendingExperiments: ExperimentalClientOptions;
  capabilities: ClientCapabilityState;
  performanceWarningOpen = false;
  private readonly subscribers = new Set<() => void>();
  private readonly disposers: Array<() => void> = [];
  private readonly generalWorkerCount: 1 | 2;
  private readonly preflight: (generalWorkerCount: 1 | 2) => Promise<ClientCapabilityState>;
  private pendingStart: PendingStart | null = null;
  private startingExperience: PendingStart['experience'] = null;
  private startingActorMode: ActorMode = 'survival';
  private performanceWarningAccepted = false;
  private startGeneration = 0;

  constructor(
    private readonly game: Game,
    private readonly bridge: UiBridge,
    readonly audio: GlobalAudio,
    options: ApplicationShellOptions = {},
  ) {
    this.appliedExperiments =
      options.experiments ??
      resolveExperimentalClientOptions({
        search: location.search,
        stored: readStoredExperimentalClientOptions(localStorage),
      });
    this.pendingExperiments = { ...this.appliedExperiments.options };
    this.generalWorkerCount = options.generalWorkerCount ?? 1;
    this.preflight = options.preflight ?? ((count) => preflightClientCapabilities(count));
    const estimated = estimateHardwareCores(globalThis.navigator?.hardwareConcurrency);
    this.capabilities = {
      workerSupport: 'checking',
      estimatedCores: estimated.count,
      coreEstimateFallback: estimated.fallback,
      requiredWorkerCount: requiredWorkerCount(this.generalWorkerCount),
      lowCoreWarning: estimated.count < requiredWorkerCount(this.generalWorkerCount),
    };
    try {
      this.quality = sanitizeQuality(localStorage.getItem(QUALITY_KEY));
    } catch {
      /* 使用默认。 */
    }
    this.controller = new ShellController({
      start: async (seed, quality, openMode) => {
        const generation = ++this.startGeneration;
        const experience = this.startingExperience;
        const actorMode = this.startingActorMode;
        this.startingExperience = null;
        this.startingActorMode = 'survival';
        await audio.unlock();
        if (generation !== this.startGeneration) return;
        const restore = game.loadSavedSession();
        bridge.publishShell({ phase: 'loading', seed, quality, enterLabel: '正在唤醒世界…', experience: null });
        try {
          const saved = restore?.seed === seed ? restore : null;
          if (actorMode === 'survival') await game.start(seed, saved, quality, openMode);
          else await game.start(seed, saved, quality, openMode, actorMode);
          if (generation === this.startGeneration && experience === 'melee-showcase') await game.prepareMeleeShowcase();
        } catch (error) {
          if (generation === this.startGeneration) {
            game.abortStart();
            bridge.publishShell({ phase: 'error', enterLabel: '重试进入' });
          }
          throw error;
        }
        if (generation === this.startGeneration) this.latestSeed = seed;
      },
      leave: async () => {
        await game.leaveWorld();
        await this.refresh();
      },
      pause: (paused) => game.setPaused(paused),
      abortStart: () => {
        this.startGeneration += 1;
        game.abortStart();
      },
    });
    game.onRuntimeFailure = (error) => {
      this.startGeneration += 1;
      game.releaseInput();
      this.controller.fail(error);
      bridge.publishShell({ phase: 'error', enterLabel: '重新进入世界' });
      this.publish();
      game.abortStart();
    };
    this.disposers.push(this.controller.subscribe(() => this.publish()));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Escape' || event.defaultPrevented) return;
      const state = bridge.shell.get();
      if (state.mapOpen || state.commandOpen || state.gameplay.inventoryOpen || state.gameplay.lifecycle === 'dead')
        return;
      // 背包等对话框拥有自己的 Escape；只有世界/暂停层处理这里。
      if (document.querySelector('[role="dialog"]:not([hidden])')) return;
      if (this.controller.state.phase === 'playing') this.controller.pause();
    };
    window.addEventListener('keydown', onKeyDown);
    this.disposers.push(() => window.removeEventListener('keydown', onKeyDown));
    const onPointerLockChange = () => {
      if (!isUserPointerUnlock() || this.controller.state.phase !== 'playing') return;
      const state = bridge.shell.get();
      if (
        !state.mapOpen &&
        !state.commandOpen &&
        !state.gameplay.inventoryOpen &&
        state.gameplay.lifecycle !== 'dead' &&
        !document.querySelector('dialog[open], [role="dialog"]:not([hidden])')
      )
        this.controller.pause();
    };
    document.addEventListener('pointerlockchange', onPointerLockChange);
    this.disposers.push(() => document.removeEventListener('pointerlockchange', onPointerLockChange));
    const onVisibilityChange = () => {
      if (document.hidden) this.controller.pause();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    this.disposers.push(() => document.removeEventListener('visibilitychange', onVisibilityChange));
    this.disposers.push(() => {
      if (game.onRuntimeFailure) game.onRuntimeFailure = null;
    });
  }

  async initialize(resourceReady: Promise<unknown> = Promise.resolve()) {
    const [capabilities] = await Promise.all([this.preflight(this.generalWorkerCount), this.refresh(), resourceReady]);
    this.capabilities = capabilities;
    this.bridge.publishShell({
      phase: 'menu',
      seed: this.latestSeed,
      quality: this.quality,
      enterLabel: '进入世界',
      initializationError: '',
    });
    this.publish();
  }

  reloadAfterInitializationFailure() {
    location.reload();
  }

  async start(
    seedInput: string,
    quality: ShellQuality,
    openMode: WorldOpenMode = 'continue',
    actorMode: ActorMode = 'survival',
  ) {
    return this.requestStart(seedInput, quality, openMode, actorMode, null);
  }

  async startMeleeShowcase(quality: ShellQuality) {
    return this.requestStart(MELEE_SHOWCASE_SEED, quality, 'new-current', 'survival', 'melee-showcase');
  }

  private async requestStart(
    seedInput: string,
    quality: ShellQuality,
    openMode: WorldOpenMode,
    actorMode: ActorMode,
    experience: PendingStart['experience'],
  ) {
    this.setQuality(quality);
    const seed = seedInput.trim() || `world-${Math.random().toString(36).slice(2, 10)}`;
    if (this.capabilities.workerSupport !== 'supported') throw new Error('当前浏览器不支持运行游戏所需的 Web Worker。');
    if (this.capabilities.lowCoreWarning && !this.performanceWarningAccepted) {
      this.pendingStart = { seed, quality, openMode, actorMode, experience };
      this.performanceWarningOpen = true;
      this.publish();
      return;
    }
    this.startingExperience = experience;
    this.startingActorMode = actorMode;
    await this.controller.start(seed, quality, openMode);
  }

  async confirmPerformanceWarning() {
    const pending = this.pendingStart;
    this.pendingStart = null;
    this.performanceWarningOpen = false;
    this.performanceWarningAccepted = true;
    this.publish();
    if (pending) {
      this.startingExperience = pending.experience;
      this.startingActorMode = pending.actorMode;
      await this.controller.start(pending.seed, pending.quality, pending.openMode);
    }
  }

  cancelPerformanceWarning() {
    this.pendingStart = null;
    this.startingExperience = null;
    this.startingActorMode = 'survival';
    this.performanceWarningOpen = false;
    this.publish();
  }

  continueWorld() {
    return this.start(this.latestSeed, this.quality);
  }

  openPanel(panel: 'settings' | 'guide') {
    this.controller.pause();
    this.panel = panel;
    this.publish();
  }

  closePanel() {
    this.panel = null;
    this.publish();
  }

  setQuality(quality: ShellQuality) {
    this.quality = sanitizeQuality(quality);
    try {
      localStorage.setItem(QUALITY_KEY, this.quality);
    } catch {
      /* 本次仍生效。 */
    }
    this.publish();
  }

  setExperiment<Field extends ExperimentalOptionField>(field: Field, value: ExperimentalClientOptions[Field]) {
    this.pendingExperiments = { ...this.pendingExperiments, [field]: value };
    persistExperimentalClientOptions(localStorage, this.pendingExperiments);
    try {
      history.replaceState(history.state, '', urlWithoutExperimentalOverride(location.href, field));
    } catch {
      /* 持久化仍可供无 URL override 的下次启动使用。 */
    }
    this.publish();
  }

  get experimentsRequireRefresh() {
    return (Object.keys(this.pendingExperiments) as ExperimentalOptionField[]).some(
      (field) => this.pendingExperiments[field] !== this.appliedExperiments.options[field],
    );
  }

  reloadForExperiments() {
    location.reload();
  }

  subscribe(subscriber: () => void) {
    this.subscribers.add(subscriber);
    subscriber();
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  dispose() {
    this.pendingStart = null;
    this.startingExperience = null;
    this.startingActorMode = 'survival';
    this.performanceWarningOpen = false;
    this.disposers
      .splice(0)
      .reverse()
      .forEach((dispose) => dispose());
    this.subscribers.clear();
  }

  private async refresh() {
    try {
      this.latestSeed = (await this.game.loadLatestWorldSeed()) ?? this.game.loadSavedSession()?.seed ?? '';
    } catch {
      this.latestSeed = this.game.loadSavedSession()?.seed ?? '';
    }
    this.publish();
  }

  private publish() {
    this.subscribers.forEach((subscriber) => subscriber());
  }
}
