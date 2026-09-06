import { macroAt, type MacroContext } from './macro-world';
import { CHUNK_SIZE, GENERATOR_VERSION, baseVoxel, chunkKey, voxelIndex } from './voxel';

export type WorldChange = [number, number, number, number];

export function makeChunk(
  seed: number,
  cx: number,
  cy: number,
  cz: number,
  changes: WorldChange[],
  generatorVersion = GENERATOR_VERSION,
): Uint16Array {
  const data = new Uint16Array(CHUNK_SIZE ** 3);
  const ox = cx * CHUNK_SIZE,
    oy = cy * CHUNK_SIZE,
    oz = cz * CHUNK_SIZE;
  const macroCache = new Map<string, MacroContext>();
  const queryMacro = (x: number, z: number) => {
    const key = chunkKey(x, 0, z);
    let context = macroCache.get(key);
    if (!context) {
      context = macroAt(seed, x, z, generatorVersion);
      macroCache.set(key, context);
    }
    return context;
  };
  for (let z = 0; z < CHUNK_SIZE; z += 1)
    for (let x = 0; x < CHUNK_SIZE; x += 1) {
      const context = queryMacro(ox + x, oz + z);
      for (let y = 0; y < CHUNK_SIZE; y += 1)
        data[voxelIndex(x, y, z)] = baseVoxel(seed, ox + x, oy + y, oz + z, context, queryMacro);
    }
  for (const [x, y, z, value] of changes) {
    if (Math.floor(x / CHUNK_SIZE) === cx && Math.floor(y / CHUNK_SIZE) === cy && Math.floor(z / CHUNK_SIZE) === cz) {
      const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
        ly = ((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
        lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      data[voxelIndex(lx, ly, lz)] = value;
    }
  }
  return data;
}
