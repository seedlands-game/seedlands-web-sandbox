export type ShellQuality = 'low' | 'medium' | 'high';
export type ApplicationShellState = Readonly<{
  phase: 'menu' | 'loading' | 'playing' | 'paused' | 'saving';
  seed: string;
  quality: ShellQuality;
  error: string;
}>;
type GamePort = {
  start: (seed: string, quality: ShellQuality) => Promise<void>;
  leave: () => Promise<void>;
  pause: (paused: boolean) => void;
};

export function sanitizeQuality(value: unknown): ShellQuality {
  return value === 'low' || value === 'high' ? value : 'medium';
}

export class ShellController {
  private value: ApplicationShellState = { phase: 'menu', seed: '', quality: 'medium', error: '' };
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

  async start(seed: string, quality: ShellQuality) {
    if (this.value.phase !== 'menu') return;
    this.publish({ phase: 'loading', seed, quality, error: '' });
    try {
      await this.game.start(seed, quality);
      this.publish({ phase: 'playing' });
    } catch (error) {
      this.publish({ phase: 'menu', error: this.message(error, '世界未能启动，请重试。') });
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
    this.publish({ phase: 'saving', error: '' });
    try {
      await this.game.leave();
      this.publish({ phase: 'menu' });
    } catch (error) {
      this.publish({ phase: 'paused', error: this.message(error, '保存失败，世界已保留，请重试。') });
    }
  }

  private publish(patch: Partial<ApplicationShellState>) {
    this.value = Object.freeze({ ...this.value, ...patch });
    this.subscribers.forEach((subscriber) => subscriber(this.value));
  }

  private message(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
  }
}
