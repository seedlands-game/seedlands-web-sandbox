import { isSolid, terrainHeight, Voxel } from '../world/voxel';

export function findDryStarterSurface(
  seed: number,
  generatorVersion: number,
  x: number,
  z: number,
  getVoxel: (x: number, y: number, z: number) => number,
): [number, number, number] {
  for (let radius = 0; radius <= 6; radius += 1)
    for (let dx = -radius; dx <= radius; dx += 1)
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const candidateX = x + dx;
        const candidateZ = z + dz;
        const y = terrainHeight(seed, candidateX, candidateZ, generatorVersion) + 1;
        if (
          isSolid(getVoxel(candidateX, y - 1, candidateZ)) &&
          getVoxel(candidateX, y, candidateZ) === Voxel.Air &&
          getVoxel(candidateX, y + 1, candidateZ) === Voxel.Air &&
          getVoxel(candidateX, y + 2, candidateZ) === Voxel.Air &&
          getVoxel(candidateX, y + 3, candidateZ) === Voxel.Air
        )
          return [candidateX + 0.5, y, candidateZ + 0.5];
      }
  throw new Error(`No dry starter surface found near ${x},${z}.`);
}
