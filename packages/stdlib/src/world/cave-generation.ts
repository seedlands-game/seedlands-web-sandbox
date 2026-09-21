// Deterministic cave carving shared byte-for-byte with crates/world-kernels cave logic.
// Caves first appear at generator version 6; earlier versions never carve.
const CAVE_SALT = 0x43_41_56_45; // "CAVE"

function caveHash(seed: number, gx: number, gy: number, gz: number): number {
  let hash =
    (seed ^ CAVE_SALT ^ Math.imul(gx, 0x9e3779b1) ^ Math.imul(gy, 0x85ebca77) ^ Math.imul(gz, 0xc2b2ae3d)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

/**
 * Returns true when the solid voxel at (x, y, z) should be carved to air.
 * Only underground solids at least four blocks below the surface are eligible so
 * surfaces never collapse. Grouped in 2x2x2 cells for chunky, connected pockets.
 */
export function caveAir(
  seed: number,
  x: number,
  y: number,
  z: number,
  height: number,
  generatorVersion: number,
): boolean {
  if (generatorVersion < 6) return false;
  if (y < 0) return false;
  const depth = height - y;
  if (depth < 4) return false;
  const gx = Math.floor(x / 2);
  const gy = Math.floor(y / 2);
  const gz = Math.floor(z / 2);
  // Two decorrelated fields intersect to form winding pockets rather than uniform holes.
  const primary = caveHash(seed, gx, gy, gz) % 1000;
  const secondary = caveHash(seed ^ 0x5bd1e995, gx, gy, gz) % 1000;
  return primary < 96 && secondary < 420;
}
