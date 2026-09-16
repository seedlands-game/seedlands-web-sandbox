import type { makeChunk, WorldChange } from '@seedlands/stdlib/world/chunk-generation';
import { macroAt, type MacroBiome } from '@seedlands/stdlib/world/macro-world';
import { oreVoxel } from '@seedlands/stdlib/world/ore-generation';
import { GENERATOR_VERSION, hash2 } from '@seedlands/stdlib/world/voxel';
import type { KernelMemory } from './kernel-memory';

const INPUT_OFFSET = 64;
const OUTPUT_OFFSET = 32768;
const GRID = 38;
const COLUMN_WORDS = 4;
const biomeCodes: Record<MacroBiome, number> = { plains: 0, forest: 1, mountain: 2, dry: 3, cold: 4, wet: 5 };
const treeThresholds = [0.987, 0.968, 0.995, 1, 1, 0.981];

// 相同布局的 TS 控制组和 Wasm 共用准备工作；宏观地理仍由唯一的 TS 算法计算。
export function prepareColumns(
  seed: number,
  ox: number,
  oz: number,
  version: number,
  columns: Int32Array,
  grid = GRID,
): void {
  for (let z = 0; z < grid; z += 1)
    for (let x = 0; x < grid; x += 1) {
      const wx = ox + x - 3;
      const wz = oz + z - 3;
      const context = macroAt(seed, wx, wz, version);
      const index = (x + grid * z) * COLUMN_WORDS;
      const kind = biomeCodes[context.biome];
      columns[index] = context.terrainHeight;
      columns[index + 1] = kind;
      columns[index + 2] = context.hydrology.water ? (context.hydrology.waterLevel ?? -2147483648) : -2147483648;
      columns[index + 3] = Number(
        !context.hydrology.water && context.terrainHeight >= 15 && hash2(seed ^ 0x44af, wx, wz) > treeThresholds[kind],
      );
    }
}

export function columnVoxel(
  columns: Int32Array,
  grid: number,
  x: number,
  wy: number,
  z: number,
  seed = 0,
  worldX = x,
  worldZ = z,
  generatorVersion = 3,
): number {
  const column = (x + 3 + grid * (z + 3)) * COLUMN_WORDS;
  const height = columns[column];
  const kind = columns[column + 1];
  const waterLevel = columns[column + 2];
  if (wy > height && wy <= waterLevel) return 8;
  if (wy <= height) {
    const base =
      wy === height
        ? kind === 3
          ? 6
          : kind === 4
            ? 7
            : kind === 2
              ? 3
              : 1
        : wy > height - 4
          ? kind === 3
            ? 6
            : kind === 2
              ? 3
              : 2
          : 3;
    return oreVoxel(seed, worldX, wy, worldZ, height, base, generatorVersion);
  }
  for (let tx = x; tx <= x + 6; tx += 1)
    for (let tz = z; tz <= z + 6; tz += 1) {
      const treeColumn = (tx + grid * tz) * COLUMN_WORDS;
      if (columns[treeColumn + 3] === 0) continue;
      const th = columns[treeColumn];
      const dx = Math.abs(x + 3 - tx);
      const dz = Math.abs(z + 3 - tz);
      if (dx === 0 && dz === 0 && wy > th && wy <= th + 4) return 4;
      if (dx <= 2 && dz <= 2 && wy >= th + 3 && wy <= th + 6 && (dx + dz < 4 || wy >= th + 5)) return 5;
    }
  return 0;
}

function fillChunk(
  columns: Int32Array,
  seed: number,
  ox: number,
  oy: number,
  oz: number,
  generatorVersion: number,
  output: Uint16Array,
): void {
  for (let z = 0; z < 32; z += 1)
    for (let x = 0; x < 32; x += 1)
      for (let y = 0; y < 32; y += 1)
        output[x + 32 * (z + 32 * y)] = columnVoxel(
          columns,
          GRID,
          x,
          oy + y,
          z,
          seed,
          ox + x,
          oz + z,
          generatorVersion,
        );
}

function applyChanges(output: Uint16Array, cx: number, cy: number, cz: number, changes: WorldChange[]): void {
  for (const [x, y, z, value] of changes)
    if (Math.floor(x / 32) === cx && Math.floor(y / 32) === cy && Math.floor(z / 32) === cz)
      output[(((x % 32) + 32) % 32) + 32 * ((((z % 32) + 32) % 32) + 32 * (((y % 32) + 32) % 32))] = value;
}

export const makeChunkStaged: typeof makeChunk = (seed, cx, cy, cz, changes, version = GENERATOR_VERSION) => {
  const columns = new Int32Array(GRID * GRID * COLUMN_WORDS);
  prepareColumns(seed, cx * 32, cz * 32, version, columns);
  const output = new Uint16Array(32 ** 3);
  fillChunk(columns, seed, cx * 32, cy * 32, cz * 32, version, output);
  applyChanges(output, cx, cy, cz, changes);
  return output;
};

export function createChunkKernel(kernel: KernelMemory): typeof makeChunk {
  return (seed, cx, cy, cz, changes, version = GENERATOR_VERSION) => {
    if (kernel.failed) throw new Error('The selected world-generation Kernel is unavailable.');
    if (![cx, cy, cz].every((value) => Number.isInteger(value) && Math.abs(value) < 2 ** 25))
      throw new RangeError('World-generation Chunk coordinates are outside the Kernel execution range.');
    try {
      const input = kernel.u32(INPUT_OFFSET, GRID * GRID * COLUMN_WORDS);
      prepareColumns(seed, cx * 32, cz * 32, version, new Int32Array(input.buffer, input.byteOffset, input.length));
      if (kernel.invoke('fill_chunk', INPUT_OFFSET, OUTPUT_OFFSET, cy * 32, seed, cx * 32, cz * 32, version) !== 0)
        throw new Error('Chunk kernel rejected the batch.');
      const output = kernel.u16(OUTPUT_OFFSET, 32 ** 3).slice();
      applyChanges(output, cx, cy, cz, changes);
      return output;
    } catch (error) {
      kernel.failed = true;
      throw new Error('The selected world-generation Kernel failed.', { cause: error });
    }
  };
}
