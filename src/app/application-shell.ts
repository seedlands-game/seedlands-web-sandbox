import { ShellController, sanitizeQuality, type ShellQuality } from '../client/shell/shell-controller';
import type { GlobalAudio } from './audio/global-audio';
import type { Game } from './game';
import type { UiBridge } from './ui/ui-bridge';

const QUALITY_KEY = 'seedlands.quality.v1';

export class ApplicationShell {
  readonly controller: ShellController;
  quality: ShellQuality = 'medium';
  latestSeed = '';
  panel: 'settings' | 'guide' | null = null;
  private readonly subscribers = new Set<() => void>();

  constructor(
    private readonly game: Game,
    private readonly bridge: UiBridge,
    readonly audio: GlobalAudio,
  ) {
    try {
      this.quality = sanitizeQuality(localStorage.getItem(QUALITY_KEY));
    } catch {
      /* 使用默认。 */
    }
    this.controller = new ShellController({
      start: async (seed, quality) => {
        await audio.unlock();
        const restore = game.loadSavedSession();
        bridge.publishShell({ phase: 'loading', seed, quality, enterLabel: '正在唤醒世界…' });
        try {
          await game.start(seed, restore?.seed === seed ? restore : null, quality);
        } catch (error) {
          game.abortStart();
          bridge.publishShell({ phase: 'error', enterLabel: '重试进入' });
          throw error;
        }
        this.latestSeed = seed;
      },
      leave: async () => {
        await game.leaveWorld();
        await this.refresh();
      },
      pause: (paused) => game.setPaused(paused),
    });
    this.controller.subscribe(() => this.publish());
    window.addEventListener('keydown', (event) => {
      if (event.code !== 'Escape') return;
      const state = bridge.shell.get();
      if (state.mapOpen || state.commandOpen) return;
      // 背包等对话框拥有自己的 Escape；只有世界/暂停层处理这里。
      if (document.querySelector('[role="dialog"]:not([hidden])')) return;
      if (this.controller.state.phase === 'playing') this.controller.pause();
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement || this.controller.state.phase !== 'playing') return;
      const state = bridge.shell.get();
      if (!state.mapOpen && !state.commandOpen && !document.querySelector('[role="dialog"]:not([hidden])'))
        this.controller.pause();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.controller.pause();
    });
  }

  async initialize() {
    await this.refresh();
    this.bridge.publishShell({ phase: 'menu', seed: this.latestSeed, quality: this.quality, enterLabel: '进入世界' });
  }

  async start(seedInput: string, quality: ShellQuality) {
    this.setQuality(quality);
    const seed = seedInput.trim() || `world-${Math.random().toString(36).slice(2, 10)}`;
    await this.controller.start(seed, quality);
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

  subscribe(subscriber: () => void) {
    this.subscribers.add(subscriber);
    subscriber();
    return () => {
      this.subscribers.delete(subscriber);
    };
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
