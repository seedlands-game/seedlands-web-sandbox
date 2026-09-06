import { KernelMemory } from '../../../src/compute/kernel-memory';
import { columnVoxel } from '../../../src/compute/chunk-kernel';
export function createGenerationControl(): KernelMemory {
  const memory = new WebAssembly.Memory({ initial: 288, maximum: 512 });
  return new KernelMemory({
    memory,
    abi_version: () => 1,
    arena_bytes: () => 16777216,
    fill_chunk: (input: number, output: number, oy: number) => {
      const columns = new Int32Array(memory.buffer, input, 38 * 38 * 4),
        target = new Uint16Array(memory.buffer, output, 32768);
      for (let z = 0; z < 32; z++)
        for (let x = 0; x < 32; x++)
          for (let y = 0; y < 32; y++) target[x + 32 * (z + 32 * y)] = columnVoxel(columns, 38, x, oy + y, z);
      return 0;
    },
    fill_halo: (input: number, knownOffset: number, haloOffset: number, fluidOffset: number, oy: number) => {
      const columns = new Int32Array(memory.buffer, input, 40 * 40 * 4),
        known = new Uint32Array(memory.buffer, knownOffset, 34 ** 3),
        halo = new Uint16Array(memory.buffer, haloOffset, 34 ** 3),
        fluid = new Uint8Array(memory.buffer, fluidOffset, 34 ** 3);
      let revision = 2166136261;
      for (let y = 0; y < 34; y++)
        for (let z = 0; z < 34; z++)
          for (let x = 0; x < 34; x++) {
            const index = x + 34 * (z + 34 * y),
              packed = known[index],
              value = packed === 0xffffffff ? columnVoxel(columns, 40, x, oy + y, z) : packed & 65535;
            halo[index] = value;
            fluid[index] = packed === 0xffffffff ? (value === 8 ? 0x88 : 0) : packed >>> 16;
            revision = Math.imul(revision ^ value, 16777619);
          }
      return revision >>> 0;
    },
  });
}
