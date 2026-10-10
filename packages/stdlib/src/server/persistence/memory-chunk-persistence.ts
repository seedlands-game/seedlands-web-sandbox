import type { ChunkColumnDirectory, ChunkPersistence, ChunkSnapshot } from './chunk-persistence';
import { chunkKey } from '../../world/voxel';

const cloneSnapshot = (snapshot: ChunkSnapshot): ChunkSnapshot => ({
  ...snapshot,
  voxels: snapshot.voxels.slice(),
  ...(snapshot.fluid ? { fluid: snapshot.fluid.slice() } : {}),
});

export class MemoryChunkPersistence implements ChunkPersistence {
  readonly writes: string[] = [];
  private readonly snapshots = new Map<string, ChunkSnapshot>();
  private readonly columnKeys = new Map<string, Set<string>>();
  private directoryRevision = 0;
  private invalidDirectoryKey = false;

  async inspectColumnDirectory(cx: number, cz: number): Promise<ChunkColumnDirectory> {
    if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cz)) throw new RangeError('Column coordinates are invalid.');
    const revision = this.directoryRevision;
    const keys = this.columnKeys.get(`${cx},${cz}`);
    let result: ChunkColumnDirectory | undefined;
    if (this.invalidDirectoryKey) result = { status: 'unknown', reason: 'invalid-data' };
    else if (keys && keys.size > 128) result = { status: 'unknown', reason: 'budget-exhausted' };
    else {
      const entries = [];
      for (const key of keys ?? []) {
        const record = this.snapshots.get(key);
        if (
          !record ||
          record.cx !== cx ||
          record.cz !== cz ||
          !Number.isSafeInteger(record.cy) ||
          record.key !== chunkKey(cx, record.cy, cz) ||
          !Number.isSafeInteger(record.revision) ||
          record.revision < 0
        ) {
          result = { status: 'unknown', reason: 'invalid-data' };
          break;
        }
        entries.push({ key, cx, cy: record.cy, cz, revision: record.revision });
      }
      result ??= { status: 'complete', revision, entries: entries.sort((a, b) => a.cy - b.cy) };
    }
    await Promise.resolve();
    return revision === this.directoryRevision ? result : { status: 'unknown', reason: 'superseded' };
  }

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
    if (copies.length === 0) return;
    if (this.directoryRevision === Number.MAX_SAFE_INTEGER)
      throw new RangeError('Column directory revision exhausted.');
    copies.forEach((snapshot) => {
      this.snapshots.set(snapshot.key, snapshot);
      const coordinates = typeof snapshot.key === 'string' ? snapshot.key.split(',').map(Number) : [];
      if (
        coordinates.length !== 3 ||
        !coordinates.every(Number.isSafeInteger) ||
        snapshot.key !== chunkKey(coordinates[0], coordinates[1], coordinates[2])
      ) {
        this.invalidDirectoryKey = true;
        return;
      }
      const column = `${coordinates[0]},${coordinates[2]}`;
      let keys = this.columnKeys.get(column);
      if (!keys) this.columnKeys.set(column, (keys = new Set()));
      keys.add(snapshot.key);
    });
    this.writes.push(...copies.map((snapshot) => snapshot.key));
    this.directoryRevision += 1;
  }
}
