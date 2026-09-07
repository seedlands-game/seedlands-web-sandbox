import type { ChunkSnapshot } from '../../server/persistence/chunk-persistence';
import { GENERATOR_VERSION, LEGACY_GENERATOR_VERSION } from '../../world/voxel';

export type SerializedChunkSnapshot = Omit<ChunkSnapshot, 'voxels' | 'fluid'> & {
  voxels: number[];
  fluid?: number[];
};

export type BrowserWorldSave = {
  seed: string;
  generatorVersion: number;
  player: [number, number, number];
  snapshots: SerializedChunkSnapshot[];
};

export function decodeBrowserWorldSave(raw: string | null): BrowserWorldSave | null {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (
      typeof record.seed !== 'string' ||
      (record.generatorVersion !== GENERATOR_VERSION && record.generatorVersion !== LEGACY_GENERATOR_VERSION) ||
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
