import type { ChunkBlockLightCache } from './block-light-volume';

type LightCache = Pick<ChunkBlockLightCache, 'rebuildNearest' | 'snapshot'>;

/** Services derived light between render frames, with one bounded job per timer turn. */
export class BlockLightRebuildPump {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private position: readonly [number, number, number] = [0, 0, 0];
  private disposed = false;
  private nextRebuildAtMs = 0;

  constructor(private readonly cache: LightCache) {}

  request(position: readonly [number, number, number]): void {
    if (this.disposed || !position.every(Number.isFinite)) return;
    this.position = [...position];
    if (this.cache.snapshot.pendingBrickCount > 0) this.schedule(Math.max(0, this.nextRebuildAtMs - performance.now()));
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number): void {
    if (this.disposed || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.disposed || this.cache.snapshot.pendingBrickCount === 0) return;
      const started = performance.now();
      const rebuilt = this.cache.rebuildNearest(this.position);
      this.nextRebuildAtMs = performance.now() + Math.max(16, (performance.now() - started) * 4);
      if (rebuilt && this.cache.snapshot.pendingBrickCount > 0)
        this.schedule(Math.max(0, this.nextRebuildAtMs - performance.now()));
    }, delayMs);
  }
}
