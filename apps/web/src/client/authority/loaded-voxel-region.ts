import { CHUNK_SIZE, floorDiv, voxelIndex } from '@seedlands/stdlib/world/voxel';

export type LoadedVoxelRegion = Readonly<{
  origin: readonly [number, number, number];
  size: number;
  voxels: Uint16Array;
  loaded: Uint8Array;
}>;

/** Detached derived buffers, in block-light x/y/z order; never expose owner buffers. */
export function copyLoadedVoxelRegion(
  origin: readonly [number, number, number],
  size: number,
  readChunk: (cx: number, cy: number, cz: number) => Readonly<{ canonical: Uint16Array }> | null,
): LoadedVoxelRegion {
  if (
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > 96 ||
    origin.length !== 3 ||
    origin.some((v) => !Number.isSafeInteger(v) || !Number.isSafeInteger(v + (size - 1)))
  )
    throw new RangeError('Invalid loaded voxel region.');
  const voxels = new Uint16Array(size ** 3);
  const loaded = new Uint8Array(size ** 3);
  const end = origin.map((v) => v + (size - 1));
  for (let cy = floorDiv(origin[1], CHUNK_SIZE); cy <= floorDiv(end[1]!, CHUNK_SIZE); cy++)
    for (let cz = floorDiv(origin[2], CHUNK_SIZE); cz <= floorDiv(end[2]!, CHUNK_SIZE); cz++)
      for (let cx = floorDiv(origin[0], CHUNK_SIZE); cx <= floorDiv(end[0]!, CHUNK_SIZE); cx++) {
        const chunk = readChunk(cx, cy, cz);
        if (!chunk) continue;
        if (chunk.canonical.length !== CHUNK_SIZE ** 3) throw new RangeError('Invalid canonical chunk size.');
        const startX = Math.max(origin[0], cx * CHUNK_SIZE);
        const endX = Math.min(end[0]!, cx * CHUNK_SIZE + CHUNK_SIZE - 1);
        const rowLength = endX - startX + 1;
        for (
          let z = Math.max(origin[2], cz * CHUNK_SIZE);
          z <= Math.min(end[2]!, cz * CHUNK_SIZE + CHUNK_SIZE - 1);
          z++
        )
          for (
            let y = Math.max(origin[1], cy * CHUNK_SIZE);
            y <= Math.min(end[1]!, cy * CHUNK_SIZE + CHUNK_SIZE - 1);
            y++
          ) {
            const source = voxelIndex(startX - cx * CHUNK_SIZE, y - cy * CHUNK_SIZE, z - cz * CHUNK_SIZE);
            const destination = startX - origin[0] + size * (y - origin[1] + size * (z - origin[2]));
            voxels.set(chunk.canonical.subarray(source, source + rowLength), destination);
            loaded.fill(1, destination, destination + rowLength);
          }
      }
  return { origin: [...origin], size, voxels, loaded };
}

export function sampleLoadedVoxelRegion(
  region: LoadedVoxelRegion,
  x: number,
  y: number,
  z: number,
): number | undefined {
  x -= region.origin[0];
  y -= region.origin[1];
  z -= region.origin[2];
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    !Number.isInteger(z) ||
    Math.min(x, y, z) < 0 ||
    Math.max(x, y, z) >= region.size
  )
    return undefined;
  const index = x + region.size * (y + region.size * z);
  return region.loaded[index] === 1 ? region.voxels[index] : undefined;
}
