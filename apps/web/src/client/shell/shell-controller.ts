export type ShellQuality = 'low' | 'medium' | 'high';
import type { WorldOpenMode } from '@seedlands/game-core/runtime/world-version-policy';
export type ApplicationShellState = Readonly<{
  phase: 'menu' | 'loading' | 'playing' | 'paused' | 'saving';
  seed: string;
  quality: ShellQuality;
  error: string;
  mode: 'local' | 'remote';
}>;
type GamePort = {
  start: (seed: string, quality: ShellQuality, openMode: WorldOpenMode) => Promise<void>;
  startRemote: (url: string, accessKey: string, quality: ShellQuality) => Promise<void>;
  leave: () => Promise<void>;
  pause: (paused: boolean) => void;
  abortStart: () => void;
};

export function sanitizeQuality(value: unknown): ShellQuality {
  return value === 'low' || value === 'high' ? value : 'medium';
}

export class ShellController {
  private value: ApplicationShellState = { phase: 'menu', seed: '', quality: 'medium', error: '', mode: 'local' };
  private transitionSequence = 0;
  private readonly subscribers = new Set<(value: ApplicationShellState) => void>();
  constructor(private readonly game: GamePort) {}
  get state() {
    return this.value;
  }

  subscribe(subscriber: (value: ApplicationShellState) => void) {
    this.subscribers.add(subscriber);
    subscriber(this.value);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  async start(seed: string, quality: ShellQuality, openMode: WorldOpenMode = 'continue') {
    if (this.value.phase !== 'menu') return;
    const transition = ++this.transitionSequence;
    this.publish({ phase: 'loading', seed, quality, error: '', mode: 'local' });
    try {
      await this.game.start(seed, quality, openMode);
      if (transition === this.transitionSequence) this.publish({ phase: 'playing' });
    } catch (error) {
      if (transition === this.transitionSequence)
        this.publish({ phase: 'menu', error: this.message(error, '世界未能启动，请重试。') });
    }
  }

  async connectRemote(url: string, accessKey: string, quality: ShellQuality) {
    if (this.value.phase !== 'menu') return;
    const transition = ++this.transitionSequence;
    this.publish({ phase: 'loading', quality, error: '', mode: 'remote' });
    try {
      await this.game.startRemote(url, accessKey, quality);
      if (transition === this.transitionSequence) this.publish({ phase: 'playing' });
    } catch (error) {
      if (transition === this.transitionSequence)
        this.publish({ phase: 'menu', error: this.message(error, '未能连接 Node，请检查地址和口令。') });
    }
  }

  pause() {
    if (this.value.phase !== 'playing') return;
    this.game.pause(true);
    this.publish({ phase: 'paused' });
  }

  resume() {
    if (this.value.phase !== 'paused') return;
    this.game.pause(false);
    this.publish({ phase: 'playing', error: '' });
  }

  async leave() {
    if (this.value.phase !== 'paused') return;
    const transition = ++this.transitionSequence;
    this.publish({ phase: 'saving', error: '' });
    try {
      await this.game.leave();
      if (transition === this.transitionSequence) this.publish({ phase: 'menu' });
    } catch (error) {
      if (transition === this.transitionSequence)
        this.publish({ phase: 'paused', error: this.message(error, '保存失败，世界已保留，请重试。') });
    }
  }

  cancelStart() {
    if (this.value.phase !== 'loading') return;
    this.transitionSequence += 1;
    this.game.abortStart();
    this.publish({ phase: 'menu', error: '已取消连接。' });
  }

  fail(error: unknown) {
    this.transitionSequence += 1;
    this.publish({ phase: 'menu', error: this.message(error, 'Authority运行时故障，请重新进入世界。') });
  }

  private publish(patch: Partial<ApplicationShellState>) {
    this.value = Object.freeze({ ...this.value, ...patch });
    this.subscribers.forEach((subscriber) => subscriber(this.value));
  }

  private message(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
  }
}
