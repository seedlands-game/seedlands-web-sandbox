import { CHUNK_SIZE, Voxel, MAX_VOXEL_ID } from '../../world/voxel';
import type { ChunkSnapshot } from './chunk-persistence';

export function isValidChunkSnapshot(
  snapshot: ChunkSnapshot,
  expected: { seedText: string; generatorVersion: number; key: string; cx: number; cy: number; cz: number },
): boolean {
  return (
    snapshot.seedText === expected.seedText &&
    snapshot.generatorVersion === expected.generatorVersion &&
    snapshot.key === expected.key &&
    snapshot.cx === expected.cx &&
    snapshot.cy === expected.cy &&
    snapshot.cz === expected.cz &&
    Number.isInteger(snapshot.revision) &&
    snapshot.revision >= 0 &&
    snapshot.voxels.length === CHUNK_SIZE ** 3 &&
    (snapshot.fluid === undefined ||
      (snapshot.fluidVersion === 1 &&
        snapshot.fluid.length === CHUNK_SIZE ** 3 &&
        snapshot.fluid.every((value) => value === 0 || ((value & 0x0f) >= 1 && (value & 0x0f) <= 8)))) &&
    snapshot.voxels.every((value) => value >= Voxel.Air && value <= MAX_VOXEL_ID)
  );
}
