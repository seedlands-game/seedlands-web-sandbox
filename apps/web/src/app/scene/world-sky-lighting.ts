import { CHUNK_SIZE, chunkKey, floorDiv } from '@seedlands/stdlib/world/voxel';
import type { PendingMeshTask } from '../app-contracts';
import type { WorldAuthorityPort } from '../world/world-authority-port';
import { readSkyColumnProofByTask } from './sky-column-source';
import {
  SkyVisibilityCache,
  buildSkyVisibilityVolume,
  SKY_VISIBILITY_MAX_COLUMN_HEIGHT,
  SKY_VISIBILITY_DERIVED_BYTES,
  type SkyVisibilitySink,
} from './sky-visibility-volume';

type SkyAuthority = Pick<
  WorldAuthorityPort,
  'runtimeEpoch' | 'worldRevision' | 'worldTime' | 'getChunkRevision' | 'getVoxel' | 'voxelSemantics'
> & { inspectColumnSource?: WorldAuthorityPort['inspectColumnSource'] };

type Entry = {
  key: string;
  chunk: readonly [number, number, number];
  sink: SkyVisibilitySink;
  dirty: boolean;
  stamp: string;
  release: (() => void) | null;
};
const MAX_SKY_CHUNKS = Math.floor((32 * 1024 * 1024) / SKY_VISIBILITY_DERIVED_BYTES);

/** Derived visibility only. The Authority remains the sole voxel/source owner. */
export class WorldSkyLighting {
  private readonly cache = new SkyVisibilityCache(MAX_SKY_CHUNKS, { worldTime: 0, profileScalar: 1 });
  private readonly entries = new Map<string, Entry>();
  private position: readonly [number, number, number] = [0, 0, 0];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = false;
  private disposed = false;
  private revisionFloor = 0;
  private observedEpoch: string | undefined;

  constructor(
    private readonly authority: SkyAuthority,
    private readonly proofScheduling: Readonly<{ yieldTask?: () => Promise<void> }> = {},
  ) {
    this.observedEpoch = authority.runtimeEpoch;
  }

  register(task: Pick<PendingMeshTask, 'chunkKey' | 'cx' | 'cy' | 'cz'>, sink: SkyVisibilitySink): () => void {
    if (this.disposed) throw new Error('Sky lighting is disposed.');
    const previous = this.entries.get(task.chunkKey);
    if (previous) this.release(previous);
    if (this.entries.size >= MAX_SKY_CHUNKS) throw new RangeError('Sky lighting capacity is exhausted.');
    const entry: Entry = {
      key: task.chunkKey,
      chunk: [task.cx, task.cy, task.cz],
      sink,
      dirty: true,
      stamp: '',
      release: null,
    };
    this.entries.set(entry.key, entry);
    sink.failDark();
    this.schedule();
    return () => this.release(entry);
  }

  request(position?: readonly [number, number, number]): void {
    if (this.disposed) return;
    if (position?.every(Number.isFinite)) this.position = [...position];
    this.invalidateStale();
    this.schedule();
  }

  notifyCommit(worldRevision: number): void {
    this.refreshEpoch();
    this.revisionFloor = Math.max(this.revisionFloor, worldRevision);
    this.invalidateStale();
  }

  invalidateStale(): void {
    if (this.disposed) return;
    for (const entry of this.entries.values())
      if (entry.stamp && entry.stamp !== this.stamp(entry)) {
        const release = entry.release;
        entry.release = null;
        if (release) release();
        else entry.sink.failDark();
        entry.stamp = '';
        entry.dirty = true;
      }
  }

  sample(position: readonly [number, number, number]) {
    if (this.disposed || !position.every(Number.isFinite)) return null;
    this.invalidateStale();
    const chunk = position.map((value) => floorDiv(Math.floor(value), CHUNK_SIZE)) as [number, number, number];
    return this.cache.sample(
      chunkKey(...chunk),
      ...(position.map((value, axis) => Math.floor(value) - chunk[axis]! * CHUNK_SIZE) as [number, number, number]),
    );
  }

  clear(): void {
    for (const entry of [...this.entries.values()]) this.release(entry);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    this.cache.dispose();
  }

  get diagnostics() {
    return {
      pending: this.pending,
      ...this.cache.diagnostics,
      readyChunkKeys: this.disposed
        ? []
        : [...this.entries.keys()].filter((key) => this.cache.sample(key, 0, 0, 0).ready),
    };
  }

  private refreshEpoch(): void {
    if (this.observedEpoch !== this.authority.runtimeEpoch) {
      this.observedEpoch = this.authority.runtimeEpoch;
      this.revisionFloor = 0;
    }
  }

  private stamp(entry: Entry): string {
    this.refreshEpoch();
    const [cx, cy, cz] = entry.chunk;
    const revisions = Array.from({ length: SKY_VISIBILITY_MAX_COLUMN_HEIGHT / CHUNK_SIZE }, (_, offset) =>
      this.authority.getChunkRevision(cx, cy + offset, cz),
    );
    return JSON.stringify([
      this.authority.runtimeEpoch ?? null,
      this.authority.worldRevision,
      this.revisionFloor,
      revisions,
    ]);
  }

  private release(entry: Entry): void {
    if (this.entries.get(entry.key) !== entry) return;
    this.entries.delete(entry.key);
    entry.release?.();
    entry.release = null;
  }

  private schedule(): void {
    if (
      this.disposed ||
      this.pending ||
      this.timer !== null ||
      !this.authority.inspectColumnSource ||
      !this.authority.runtimeEpoch ||
      ![...this.entries.values()].some((entry) => entry.dirty)
    )
      return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.rebuildNearest();
    }, 16);
  }

  private async rebuildNearest(): Promise<void> {
    if (this.disposed || this.pending || !this.authority.inspectColumnSource) return;
    const distance = (entry: Entry) =>
      entry.chunk.reduce(
        (sum, value, axis) => sum + (value * CHUNK_SIZE + CHUNK_SIZE / 2 - this.position[axis]!) ** 2,
        0,
      );
    const entry = [...this.entries.values()]
      .filter((candidate) => candidate.dirty)
      .sort((a, b) => distance(a) - distance(b))[0];
    if (!entry) return;
    this.pending = true;
    entry.dirty = false;
    const stamp = this.stamp(entry);
    try {
      const source = await this.authority.inspectColumnSource(entry.chunk[0], entry.chunk[2]);
      if (this.disposed || this.entries.get(entry.key) !== entry) return;
      if (stamp !== this.stamp(entry)) {
        entry.dirty = true;
        entry.sink.failDark();
        return;
      }
      entry.stamp = stamp;
      if (source.status !== 'complete' || source.worldRevision !== this.authority.worldRevision) return;
      const proof = await readSkyColumnProofByTask(source, entry.chunk, this.authority, {
        yieldTask: this.proofScheduling.yieldTask,
        isCurrent: () => !this.disposed && this.entries.get(entry.key) === entry && stamp === this.stamp(entry),
      });
      if (this.disposed || this.entries.get(entry.key) !== entry) return;
      if (stamp !== this.stamp(entry)) {
        entry.stamp = '';
        entry.dirty = true;
        entry.sink.failDark();
        return;
      }
      if (!proof) return;
      entry.release?.();
      entry.release = this.cache.register(
        entry.key,
        entry.chunk,
        proof.dependencies.map((dependency) => dependency.key),
        entry.sink,
      );
      for (const dependency of proof.dependencies) this.cache.setDependency(dependency);
      this.cache.setLightingFrame({ worldTime: this.authority.worldTime, profileScalar: 1 });
      const ticket = this.cache.beginBuild(entry.key, proof.ceilingY, proof.columns);
      const volume = buildSkyVisibilityVolume(ticket);
      if (stamp === this.stamp(entry)) this.cache.publish(ticket, volume);
      else {
        entry.release();
        entry.release = null;
        entry.stamp = '';
        entry.dirty = true;
      }
    } catch {
      if (!this.disposed && this.entries.get(entry.key) === entry) {
        entry.stamp = stamp === this.stamp(entry) ? stamp : '';
        if (!entry.stamp) entry.dirty = true;
        entry.sink.failDark();
      }
    } finally {
      this.pending = false;
      this.schedule();
    }
  }
}
