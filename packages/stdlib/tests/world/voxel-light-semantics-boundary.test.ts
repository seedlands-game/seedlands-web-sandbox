import { describe, expect, it } from 'vitest';
import { sampleLight } from '../../src/server/gameplay/light-sampler';
import { buildBlockLightVolume, sampleBlockLight, voxelEmission, voxelLightCost } from '../../src/world/voxel-light';
import { createVoxelSemanticsRegistry, type VoxelSemanticsDefinition } from '../../src/world/voxel-semantics';

const definition = (id: string, storageId: number, emission: number, lightCost: number): VoxelSemanticsDefinition => ({
  id,
  storageId,
  solid: lightCost >= 16,
  targetable: storageId !== 0,
  renderable: storageId !== 0,
  meshKind: 'cube',
  emission,
  lightCost,
  faceMaterials: [1, 1, 1, 1, 1, 1],
});

describe('方块光只消费显式体素语义', () => {
  it.each([
    ['emission', () => voxelEmission(9, undefined as never)],
    ['light cost', () => voxelLightCost(8, undefined as never)],
    ['volume', () => buildBlockLightVolume(1, [0, 0, 0], () => undefined, undefined as never)],
    ['sample', () => sampleLight([0, 0, 0], 0, () => undefined, undefined as never)],
  ])('无 resolver 时不把数字 storage id 识别成 Classic %s', (_label, read) => {
    expect(read).toThrow(/semantics|resolver/i);
  });

  it('resolver 未注册 storage id 时 fail-fast，而不回落到 Classic 数值', () => {
    const semantics = createVoxelSemanticsRegistry([definition('sample:air', 0, 0, 1)]);

    expect(() => voxelEmission(9, semantics)).toThrow(/registered|semantics/i);
    expect(() => voxelLightCost(8, semantics)).toThrow(/registered|semantics/i);
    expect(() => buildBlockLightVolume(1, [0, 0, 0], () => 9, semantics)).toThrow(/registered|semantics/i);
    expect(() => sampleLight([0, 0, 0], 0, () => 9, semantics)).toThrow(/registered|semantics/i);
  });

  it('按合成世界的 synthetic semantics 传播，不依赖 Classic 方块表', () => {
    const semantics = createVoxelSemanticsRegistry([
      definition('sample:air', 0, 0, 1),
      definition('sample:filter', 8, 0, 3),
      definition('sample:source', 9, 6, 1),
      definition('sample:wall', 3, 0, 16),
    ]);

    expect(voxelEmission(9, semantics)).toBe(6);
    expect(voxelLightCost(8, semantics)).toBe(3);

    const volume = buildBlockLightVolume(
      3,
      [0, 0, 0],
      (x, y, z) => {
        if (y !== 0 || z !== 0) return 3;
        return x === 0 ? 9 : x === 1 ? 8 : 0;
      },
      semantics,
    );

    expect(sampleBlockLight(volume, 0, 0, 0)).toBe(6);
    expect(sampleBlockLight(volume, 1, 0, 0)).toBe(3);
    expect(sampleBlockLight(volume, 2, 0, 0)).toBe(2);
  });
});
