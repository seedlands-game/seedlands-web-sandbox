import { describe, expect, it } from 'vitest';
import { batchMeshData, compactMeshData, type MeshData } from '../../src/world/mesh';
import { batchCompactMeshData } from '../../src/world/mesh-batching';

const oversizedPart = (vertexCount: number, indexCount: number): MeshData => ({
  material: 1,
  renderCategory: 'opaque',
  layout: 'float32',
  positions: Float32Array.from({ length: vertexCount * 3 }, (_, index) => index),
  normals: Float32Array.from({ length: vertexCount * 3 }, (_, index) => -index),
  uvs: Float32Array.from({ length: vertexCount * 2 }, (_, index) => index / 4),
  colors: Uint8Array.from({ length: vertexCount * 4 }, (_, index) => index % 256),
  indices: Uint32Array.from({ length: indexCount }, (_, index) => index % vertexCount),
});

describe('大网格数据平面容量', () => {
  it('批量拼接超过函数参数上限的 TypedArray 时保持所有顶点和索引', () => {
    const source = oversizedPart(70_000, 210_000);

    const [batched] = batchMeshData([source]);

    expect(batched.positions).toEqual(source.positions);
    expect(batched.normals).toEqual(source.normals);
    expect(batched.uvs).toEqual(source.uvs);
    expect(batched.indices).toEqual(source.indices);
  });

  it('紧凑布局在超过函数参数上限的索引上选择正确的 Uint32 容器', () => {
    const source = oversizedPart(70_000, 210_000);

    const compact = compactMeshData(source);

    expect(compact.indices).toBeInstanceOf(Uint32Array);
    expect(compact.indices).toEqual(source.indices);
  });

  it('融合打包保持分步 batch + compact 的所有输出字节与索引宽度', () => {
    const source = [oversizedPart(70_000, 210_000), { ...oversizedPart(4, 6), renderCategory: 'cutout' as const }];

    const expected = batchMeshData(source).map(compactMeshData);
    const fused = batchCompactMeshData(source);

    expect(fused).toHaveLength(expected.length);
    for (let index = 0; index < expected.length; index += 1) {
      expect(fused[index]!.positions).toEqual(expected[index]!.positions);
      expect(fused[index]!.normals).toEqual(expected[index]!.normals);
      expect(fused[index]!.uvs).toEqual(expected[index]!.uvs);
      expect(fused[index]!.colors).toEqual(expected[index]!.colors);
      expect(fused[index]!.indices).toEqual(expected[index]!.indices);
      expect(fused[index]!.indices.constructor).toBe(expected[index]!.indices.constructor);
    }
  });

  it('紧凑 UV 对 NaN payload、负零与溢出保持旧 JS Number 转换的字节语义', () => {
    const uvs = new Float32Array(8);
    new Uint32Array(uvs.buffer).set([
      0x7fc01234, 0x7fa00001, 0x80000000, 0x00000001, 0x7f800000, 0xff800000, 0x477fe000, 0x3f800001,
    ]);
    const source = { ...oversizedPart(4, 6), uvs };

    const compact = compactMeshData(source);
    const fused = batchCompactMeshData([source])[0]!;
    const legacyFloat16 = (value: number) => {
      const bits = new Uint32Array(new Float32Array([value]).buffer)[0]!;
      const sign = (bits >>> 16) & 0x8000;
      const exponent = ((bits >>> 23) & 0xff) - 127 + 15;
      const mantissa = bits & 0x7fffff;
      if (exponent <= 0) return sign;
      if (exponent >= 31) return sign | 0x7c00;
      return sign | (exponent << 10) | (mantissa >>> 13);
    };
    const expected = Uint16Array.from(uvs, legacyFloat16);

    expect(compact.uvs).toEqual(expected);
    expect(fused.uvs).toEqual(expected);
  });
});
