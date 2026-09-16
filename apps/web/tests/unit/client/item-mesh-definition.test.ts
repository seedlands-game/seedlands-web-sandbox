import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, FaceMaterial, Voxel, voxelIndex } from '../../../../../packages/stdlib/src/world/voxel';
import { meshChunk } from '../../../../../packages/stdlib/src/world/mesh';
import { modelBoxesForVoxel } from '../../../../../packages/stdlib/src/world/voxel-model';
import { itemMeshDefinition } from '../../../src/client/presentation/item-mesh-definition';

describe('物品静态网格定义', () => {
  it('灯笼只从权威体素盒子生成，并按两个兼容材质分组', () => {
    const definition = itemMeshDefinition(Voxel.Lantern);

    expect(definition.groups.map((group) => group.material).sort((a, b) => a - b)).toEqual([
      FaceMaterial.LanternFrame,
      FaceMaterial.LanternGlow,
    ]);
    expect(definition.groups.reduce((count, group) => count + group.boxCount, 0)).toBe(
      modelBoxesForVoxel(Voxel.Lantern).length,
    );
    expect(definition.groups.every((group) => group.indices.length === group.boxCount * 36)).toBe(true);
  });

  it('普通方块的六个面使用 world faceMaterialFor 的同源材质', () => {
    const wood = itemMeshDefinition(Voxel.Wood);

    expect(wood.groups.map((group) => group.material).sort((a, b) => a - b)).toEqual([
      FaceMaterial.WoodSide,
      FaceMaterial.WoodEnd,
    ]);
    expect(wood.groups.reduce((count, group) => count + group.boxCount, 0)).toBe(6);
  });

  it('灯笼每个面复刻 world mesher 的朝向、尺寸和正反面 UV', () => {
    const data = new Uint16Array(CHUNK_SIZE ** 3);
    data[voxelIndex(0, 0, 0)] = Voxel.Lantern;
    const world = meshChunk({ seed: 1, cx: 0, cy: 0, cz: 0, data, changes: [], outside: () => Voxel.Air });

    for (const group of itemMeshDefinition(Voxel.Lantern).groups) {
      const expected = Array.from(world[group.material]!.uvs);
      expect(group.uvs).toHaveLength(expected.length);
      for (let face = 0; face < expected.length / 8; face += 1)
        expect(group.uvs.slice(face * 8, face * 8 + 8)).toEqual(expected.slice(face * 8, face * 8 + 8));
    }
  });
});
