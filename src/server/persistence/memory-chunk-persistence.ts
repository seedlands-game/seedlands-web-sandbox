import type { ChunkPersistence, ChunkSnapshot } from './chunk-persistence';

const cloneSnapshot = (snapshot: ChunkSnapshot): ChunkSnapshot => ({
  ...snapshot,
  voxels: snapshot.voxels.slice(),
  ...(snapshot.fluid ? { fluid: snapshot.fluid.slice() } : {}),
});

export class MemoryChunkPersistence implements ChunkPersistence {
  readonly writes: string[] = [];
  private readonly snapshots = new Map<string, ChunkSnapshot>();

  loadSnapshot(key: string): ChunkSnapshot | null {
    const snapshot = this.snapshots.get(key);
    return snapshot ? cloneSnapshot(snapshot) : null;
  }

  preparedSnapshotStatus(key: string) {
    return this.snapshots.has(key) ? ('found' as const) : ('missing' as const);
  }

  saveSnapshots(snapshots: readonly ChunkSnapshot[]): void {
    this.commitSnapshots(snapshots);
  }

  protected commitSnapshots(snapshots: readonly ChunkSnapshot[]): void {
    const copies = snapshots.map(cloneSnapshot);
    copies.forEach((snapshot) => this.snapshots.set(snapshot.key, snapshot));
    this.writes.push(...copies.map((snapshot) => snapshot.key));
  }
}
