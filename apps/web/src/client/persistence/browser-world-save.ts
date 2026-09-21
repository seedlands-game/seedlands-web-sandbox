import type { ChunkSnapshot } from '@seedlands/stdlib/server/persistence/chunk-persistence';
import { isSupportedGeneratorVersion } from '@seedlands/stdlib/world/voxel';

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
      !isSupportedGeneratorVersion(record.generatorVersion) ||
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
