import type { ChunkPersistence, ChunkSnapshot } from './chunk-persistence';

const cloneSnapshot = (snapshot: ChunkSnapshot): ChunkSnapshot => ({ ...snapshot, voxels: snapshot.voxels.slice() });

export class MemoryChunkPersistence implements ChunkPersistence {
  readonly writes: string[] = [];
  private readonly snapshots = new Map<string, ChunkSnapshot>();

  loadSnapshot(key: string): ChunkSnapshot | null {
    const snapshot = this.snapshots.get(key);
    return snapshot ? cloneSnapshot(snapshot) : null;
  }

  saveSnapshots(snapshots: readonly ChunkSnapshot[]): void {
    snapshots.forEach((snapshot) => {
      this.snapshots.set(snapshot.key, cloneSnapshot(snapshot));
      this.writes.push(snapshot.key);
    });
  }
}
