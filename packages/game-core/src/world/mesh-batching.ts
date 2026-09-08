import type { MeshData, RenderCategory } from './mesh';

const float32Scratch = new Float32Array(1);
const float32ScratchBits = new Uint32Array(float32Scratch.buffer);
const categories: readonly RenderCategory[] = ['opaque', 'cutout', 'emissive', 'transparent'];

/** Preserves the former JS Number to Float32 conversion while reusing one bit view. */
export function float32ToFloat16(value: number) {
  float32Scratch[0] = value;
  const bits = float32ScratchBits[0]!;
  const sign = (bits >>> 16) & 0x8000;
  const exponent = ((bits >>> 23) & 0xff) - 127 + 15;
  const mantissa = bits & 0x7fffff;
  if (exponent <= 0) return sign;
  if (exponent >= 31) return sign | 0x7c00;
  return sign | (exponent << 10) | (mantissa >>> 13);
}

type BatchLengths = Readonly<{
  positions: number;
  normals: number;
  uvs: number;
  colors: number;
  indices: number;
  maxIndex: number;
}>;

const measureParts = (parts: readonly MeshData[], compact: boolean): BatchLengths => {
  let positions = 0;
  let normals = 0;
  let uvs = 0;
  let colors = 0;
  let indices = 0;
  let maxIndex = 0;
  for (const part of parts) {
    if (part.layout !== 'float32' || part.material === null)
      throw new Error('Render-category batching expects unbatched Float32 mesh parts.');
    const vertexOffset = positions / 3;
    positions += part.positions.length;
    normals += part.normals.length;
    uvs += part.uvs.length;
    colors += part.colors.length;
    indices += part.indices.length;
    if (compact)
      for (let index = 0; index < part.indices.length; index += 1)
        maxIndex = Math.max(maxIndex, part.indices[index]! + vertexOffset);
  }
  return { positions, normals, uvs, colors, indices, maxIndex };
};

const packCategory = (renderCategory: RenderCategory, parts: readonly MeshData[], compact: boolean): MeshData => {
  const lengths = measureParts(parts, compact);
  const positions = new Float32Array(lengths.positions);
  const normals = new Float32Array(lengths.normals);
  const uvs = compact ? new Uint16Array(lengths.uvs) : new Float32Array(lengths.uvs);
  const colors = new Uint8Array(lengths.colors);
  const indices =
    compact && lengths.maxIndex <= 65_535 ? new Uint16Array(lengths.indices) : new Uint32Array(lengths.indices);
  let positionOffset = 0;
  let normalOffset = 0;
  let uvOffset = 0;
  let colorOffset = 0;
  let indexOffset = 0;
  for (const part of parts) {
    const material = part.material!;
    const vertexOffset = positionOffset / 3;
    positions.set(part.positions, positionOffset);
    normals.set(part.normals, normalOffset);
    if (compact) {
      for (let index = 0; index < part.uvs.length; index += 1)
        uvs[uvOffset + index] = float32ToFloat16(part.uvs[index]!);
    } else (uvs as Float32Array).set(part.uvs, uvOffset);
    for (let index = 0; index < part.colors.length; index += 4) {
      colors[colorOffset + index] = part.colors[index]!;
      colors[colorOffset + index + 1] = part.colors[index + 1]!;
      colors[colorOffset + index + 2] = part.colors[index + 2]!;
      colors[colorOffset + index + 3] = material - 1;
    }
    for (let index = 0; index < part.indices.length; index += 1)
      indices[indexOffset + index] = part.indices[index]! + vertexOffset;
    positionOffset += part.positions.length;
    normalOffset += part.normals.length;
    uvOffset += part.uvs.length;
    colorOffset += part.colors.length;
    indexOffset += part.indices.length;
  }
  return {
    material: null,
    renderCategory,
    layout: compact ? 'compact' : 'float32',
    positions,
    normals,
    uvs,
    colors,
    indices,
  };
};

const packMeshData = (parts: readonly MeshData[], compact: boolean) =>
  categories.flatMap((renderCategory) => {
    const matching = parts.filter((part) => part.renderCategory === renderCategory);
    return matching.length ? [packCategory(renderCategory, matching, compact)] : [];
  });

export const batchMeshData = (parts: readonly MeshData[]): MeshData[] => packMeshData(parts, false);

/** Worker-only fast path: emits public batch-then-compact bytes without intermediate meshes. */
export const batchCompactMeshData = (parts: readonly MeshData[]): MeshData[] => packMeshData(parts, true);
