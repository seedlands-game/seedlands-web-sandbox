import { GENERATOR_VERSION } from '../world/voxel';
import type { ChunkPersistence, ChunkSnapshot } from '../server/persistence/chunk-persistence';

type SerializedChunkSnapshot = Omit<ChunkSnapshot, 'voxels'> & { voxels: number[] };
export type BrowserWorldSave = {
  seed: string;
  generatorVersion: number;
  player: [number, number, number];
  snapshots: SerializedChunkSnapshot[];
};

const serialize = (snapshot: ChunkSnapshot): SerializedChunkSnapshot => ({ ...snapshot, voxels: [...snapshot.voxels] });
const hydrate = (snapshot: SerializedChunkSnapshot): ChunkSnapshot => ({
  ...snapshot,
  voxels: Uint16Array.from(snapshot.voxels),
});

export class BrowserChunkPersistence implements ChunkPersistence {
  private readonly snapshots = new Map<string, ChunkSnapshot>();

  constructor(snapshots: readonly SerializedChunkSnapshot[] = []) {
    snapshots.forEach((snapshot) => this.snapshots.set(snapshot.key, hydrate(snapshot)));
  }

  loadSnapshot(key: string): ChunkSnapshot | null {
    const snapshot = this.snapshots.get(key);
    return snapshot ? hydrate(serialize(snapshot)) : null;
  }

  saveSnapshots(snapshots: readonly ChunkSnapshot[]): void {
    snapshots.forEach((snapshot) => this.snapshots.set(snapshot.key, hydrate(serialize(snapshot))));
  }

  serialize(seed: string, player: [number, number, number]): BrowserWorldSave {
    return {
      seed,
      generatorVersion: GENERATOR_VERSION,
      player,
      snapshots: [...this.snapshots.values()].map(serialize),
    };
  }
}

export function decodeBrowserWorldSave(raw: string | null): BrowserWorldSave | null {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (
      typeof record.seed !== 'string' ||
      record.generatorVersion !== GENERATOR_VERSION ||
      !Array.isArray(record.player) ||
      record.player.length !== 3 ||
      !record.player.every(Number.isFinite) ||
      !Array.isArray(record.snapshots)
    )
      return null;
    return {
      seed: record.seed,
      generatorVersion: record.generatorVersion,
      player: [record.player[0] as number, record.player[1] as number, record.player[2] as number],
      snapshots: record.snapshots as SerializedChunkSnapshot[],
    };
  } catch {
    return null;
  }
}
