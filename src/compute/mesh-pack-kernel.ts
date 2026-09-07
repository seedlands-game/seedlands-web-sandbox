import type { MeshData, RenderCategory } from '../world/mesh';
import { KernelMemory } from './kernel-memory';

export const MESH_PACK_INPUT_OFFSET = 64;
export const MESH_PACK_OUTPUT_OFFSET = 8 * 1024 * 1024;
export const MESH_PACK_ARENA_LIMIT = 16 * 1024 * 1024;

type OffsetIndicesResult = { values: Uint32Array; maxIndex: number };

export class MeshPackKernel {
  constructor(readonly memory: KernelMemory) {}

  get failed(): boolean {
    return this.memory.failed;
  }

  compactUvs(values: Float32Array): Uint16Array {
    this.copyBytes(values);
    this.invoke('compact_uvs', MESH_PACK_INPUT_OFFSET, MESH_PACK_OUTPUT_OFFSET, values.length);
    return this.memory.u16(MESH_PACK_OUTPUT_OFFSET, values.length).slice();
  }

  packColors(values: Uint8Array, material: number): Uint8Array {
    this.copyBytes(values);
    this.invoke('pack_color_alpha', MESH_PACK_INPUT_OFFSET, MESH_PACK_OUTPUT_OFFSET, values.length / 4, material);
    return this.memory.bytes(MESH_PACK_OUTPUT_OFFSET, values.length).slice();
  }

  offsetIndices(values: Uint32Array | Uint16Array, vertexOffset: number): OffsetIndicesResult {
    const u32Values = values instanceof Uint32Array ? values : new Uint32Array(values);
    this.copyBytes(u32Values);
    const maxIndex =
      this.invoke('offset_indices', MESH_PACK_INPUT_OFFSET, MESH_PACK_OUTPUT_OFFSET, u32Values.length, vertexOffset) >>>
      0;
    return { values: this.memory.u32(MESH_PACK_OUTPUT_OFFSET, u32Values.length).slice(), maxIndex };
  }

  private copyBytes(values: ArrayBufferView): void {
    if (values.byteLength > MESH_PACK_OUTPUT_OFFSET - MESH_PACK_INPUT_OFFSET)
      throw new RangeError('Mesh pack input exceeds the Wasm arena workspace.');
    this.memory
      .bytes(MESH_PACK_INPUT_OFFSET, values.byteLength)
      .set(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
  }

  private invoke(name: string, ...parameters: number[]): number {
    try {
      const result = this.memory.invoke(name, ...parameters);
      if (result < 0) throw new Error(`Wasm mesh pack ABI rejected ${name} with status ${result}.`);
      return result;
    } catch (error) {
      this.memory.failed = true;
      throw error;
    }
  }
}

export function createMeshPackKernel(memory: KernelMemory): MeshPackKernel {
  return new MeshPackKernel(memory);
}

const categories: readonly RenderCategory[] = ['opaque', 'cutout', 'emissive', 'transparent'];

/**
 * Keep batching and its bulk TypedArray copies in TypeScript. The selected Wasm module owns
 * only compact UV conversion, alpha/material packing, and index offset scans.
 */
const runMeshPackKernelUnsafe = (kernel: MeshPackKernel, parts: readonly MeshData[]): MeshData[] =>
  categories.flatMap((renderCategory) => {
    const matching = parts.filter((part) => part.renderCategory === renderCategory);
    if (!matching.length) return [];
    const vertexCount = matching.reduce((total, part) => total + part.positions.length / 3, 0);
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvValues = new Float32Array(vertexCount * 2);
    const colors = new Uint8Array(vertexCount * 4);
    const indexValues = new Uint32Array(matching.reduce((total, part) => total + part.indices.length, 0));
    let vertexOffset = 0;
    let uvOffset = 0;
    let colorOffset = 0;
    let indexOffset = 0;
    let maxIndex = 0;
    for (const part of matching) {
      if (part.layout !== 'float32' || part.material === null)
        throw new Error('Render-category batching expects unbatched Float32 mesh parts.');
      const partVertexCount = part.positions.length / 3;
      positions.set(part.positions, vertexOffset * 3);
      normals.set(part.normals, vertexOffset * 3);
      uvValues.set(part.uvs as Float32Array, uvOffset);
      colors.set(kernel.packColors(part.colors, part.material), colorOffset);
      const offsetIndices = kernel.offsetIndices(part.indices, vertexOffset);
      indexValues.set(offsetIndices.values, indexOffset);
      maxIndex = Math.max(maxIndex, offsetIndices.maxIndex);
      vertexOffset += partVertexCount;
      uvOffset += part.uvs.length;
      colorOffset += part.colors.length;
      indexOffset += part.indices.length;
    }
    return [
      {
        material: null,
        renderCategory,
        layout: 'compact' as const,
        positions,
        normals,
        uvs: kernel.compactUvs(uvValues),
        colors,
        indices: maxIndex <= 65_535 ? new Uint16Array(indexValues) : new Uint32Array(indexValues),
      },
    ];
  });

export function runMeshPackKernel(kernel: MeshPackKernel, parts: readonly MeshData[]): MeshData[] {
  try {
    return runMeshPackKernelUnsafe(kernel, parts);
  } catch (error) {
    kernel.memory.failed = true;
    throw error;
  }
}
