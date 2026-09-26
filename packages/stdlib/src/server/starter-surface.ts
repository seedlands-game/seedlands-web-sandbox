import { isSolid, terrainHeight, Voxel } from '../world/voxel';
import type { VoxelSemanticsResolver } from '../world/voxel-semantics';
import { voxelIsPassable, voxelIsSolid } from '../world/voxel-semantics';

export function findDryStarterSurface(
  seed: number,
  generatorVersion: number,
  x: number,
  z: number,
  getVoxel: (x: number, y: number, z: number) => number,
  semantics?: VoxelSemanticsResolver,
): [number, number, number] {
  for (let radius = 0; radius <= 6; radius += 1)
    for (let dx = -radius; dx <= radius; dx += 1)
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const candidateX = x + dx;
        const candidateZ = z + dz;
        const y = terrainHeight(seed, candidateX, candidateZ, generatorVersion) + 1;
        if (
          (semantics
            ? voxelIsSolid(getVoxel(candidateX, y - 1, candidateZ), semantics)
            : isSolid(getVoxel(candidateX, y - 1, candidateZ))) &&
          [0, 1, 2, 3].every((offset) =>
            semantics
              ? voxelIsPassable(getVoxel(candidateX, y + offset, candidateZ), semantics)
              : getVoxel(candidateX, y + offset, candidateZ) === Voxel.Air,
          )
        )
          return [candidateX + 0.5, y, candidateZ + 0.5];
      }
  throw new Error(`No dry starter surface found near ${x},${z}.`);
}
