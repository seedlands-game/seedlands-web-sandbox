import type { MeshData } from '../world/mesh';
import { KernelMemory, WASM_ARENA_BYTES } from './kernel-memory';
import { MeshPackKernel, runMeshPackKernel } from './mesh-pack-kernel';

const INPUT_OFFSET = 64;

const validRange = (offset: number, length: number, width: number) =>
  offset >= INPUT_OFFSET &&
  length >= 0 &&
  offset % width === 0 &&
  offset <= WASM_ARENA_BYTES &&
  length <= (WASM_ARENA_BYTES - offset) / width;

/**
 * Creates a same-layout JavaScript control memory. The production adapter and
 * this control both copy through the KernelMemory ABI before running the
 * numeric operation, so their preparation and transfer costs stay comparable.
 */
export function createMeshPackControlMemory(): KernelMemory {
  const memory = new WebAssembly.Memory({ initial: 256, maximum: 512 });
  const u8 = () => new Uint8Array(memory.buffer);
  const u16 = () => new Uint16Array(memory.buffer);
  const u32 = () => new Uint32Array(memory.buffer);
  const exports = {
    memory,
    abi_version: () => 1,
    arena_bytes: () => WASM_ARENA_BYTES,
    compact_uvs: (input: number, output: number, count: number) => {
      if (!validRange(input, count, 4) || !validRange(output, count, 2)) return -1;
      const inputView = u32();
      const outputView = u16();
      for (let index = 0; index < count; index += 1) {
        const bits = inputView[input / 4 + index];
        const sign = (bits >>> 16) & 0x8000;
        const exponent = ((bits >>> 23) & 0xff) - 127 + 15;
        const mantissa = bits & 0x7fffff;
        outputView[output / 2 + index] =
          exponent <= 0 ? sign : exponent >= 31 ? sign | 0x7c00 : sign | (exponent << 10) | (mantissa >>> 13);
      }
      return 0;
    },
    pack_color_alpha: (input: number, output: number, count: number, material: number) => {
      if (material < 1 || !validRange(input, count, 4) || !validRange(output, count, 4)) return -1;
      const bytes = u8();
      const alpha = material - 1;
      for (let index = 0; index < count; index += 1) {
        const source = input + index * 4;
        const target = output + index * 4;
        bytes[target] = bytes[source];
        bytes[target + 1] = bytes[source + 1];
        bytes[target + 2] = bytes[source + 2];
        bytes[target + 3] = alpha;
      }
      return 0;
    },
    offset_indices: (input: number, output: number, count: number, vertexOffset: number) => {
      if (vertexOffset < 0 || !validRange(input, count, 4) || !validRange(output, count, 4)) return -1;
      const values = u32();
      let maximum = 0;
      for (let index = 0; index < count; index += 1) {
        const value = (values[input / 4 + index] + vertexOffset) >>> 0;
        values[output / 4 + index] = value;
        maximum = Math.max(maximum, value);
      }
      return maximum | 0;
    },
  } as unknown as WebAssembly.Exports;
  return new KernelMemory(exports);
}

export function runMeshPackControl(memory: KernelMemory, parts: readonly MeshData[]): MeshData[] {
  return runMeshPackKernel(new MeshPackKernel(memory), parts);
}
