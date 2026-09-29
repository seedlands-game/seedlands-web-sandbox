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

  it.each([
    [Voxel.WoodenDoor, FaceMaterial.WoodenDoor],
    [Voxel.Ladder, FaceMaterial.Ladder],
    [Voxel.Fence, FaceMaterial.Fence],
  ] as const)('结构物品 %i 复用世界模型的材质和 UV 采样范围', (voxel, material) => {
    const data = new Uint16Array(CHUNK_SIZE ** 3);
    data[voxelIndex(0, 0, 0)] = voxel;
    const world = meshChunk({ seed: 1, cx: 0, cy: 0, cz: 0, data, changes: [], outside: () => Voxel.Air })[material]!;
    const item = itemMeshDefinition(voxel).groups;

    expect(item).toHaveLength(1);
    expect(item[0].material).toBe(material);
    expect(new Float32Array(item[0].positions)).toEqual(world.positions);
    expect(item[0].uvs).toEqual([...world.uvs]);
  });

  it('火把物品复用世界模型的分材质木柄和火头', () => {
    const data = new Uint16Array(CHUNK_SIZE ** 3);
    data[voxelIndex(0, 0, 0)] = Voxel.Torch;
    const world = meshChunk({ seed: 1, cx: 0, cy: 0, cz: 0, data, changes: [], outside: () => Voxel.Air });
    const torch = itemMeshDefinition(Voxel.Torch).groups;

    expect(torch.map((group) => group.material).sort((a, b) => a - b)).toEqual([
      FaceMaterial.Torch,
      FaceMaterial.TorchFlame,
    ]);
    for (const group of torch) {
      const mesh = world[group.material]!;
      expect(group.boxCount).toBe(1);
      expect(new Float32Array(group.positions)).toEqual(mesh.positions);
      expect(group.uvs).toEqual([...mesh.uvs]);
    }
  });

  it('火把木柄和火头各自以自身模型高度采样纹理', () => {
    const groups = itemMeshDefinition(Voxel.Torch).groups;
    const handle = groups.find((group) => group.material === FaceMaterial.Torch)!;
    const flame = groups.find((group) => group.material === FaceMaterial.TorchFlame)!;
    const handleSideRows = handle.uvs.slice(0, 16).filter((_value, index) => index % 2 === 1);
    const flameSideRows = flame.uvs.slice(0, 16).filter((_value, index) => index % 2 === 1);

    expect(Math.min(...handleSideRows)).toBe(0);
    expect(Math.max(...handleSideRows)).toBeCloseTo(0.56);
    expect(Math.min(...flameSideRows)).toBe(0);
    expect(Math.max(...flameSideRows)).toBeCloseTo(0.26);
  });

  it.each([
    [Voxel.Sapling, FaceMaterial.Sapling],
    [Voxel.TallGrass, FaceMaterial.TallGrass],
    [Voxel.Flower, FaceMaterial.Flower],
    [Voxel.Mushroom, FaceMaterial.Mushroom],
    [Voxel.SugarCane, FaceMaterial.SugarCane],
    [Voxel.DeadBush, FaceMaterial.DeadBush],
    [Voxel.RedFlower, FaceMaterial.RedFlower],
    [Voxel.RedMushroom, FaceMaterial.RedMushroom],
  ] as const)('植物物品 %i 复用世界交叉双面几何', (voxel, material) => {
    const data = new Uint16Array(CHUNK_SIZE ** 3);
    data[voxelIndex(0, 0, 0)] = voxel;
    const world = meshChunk({ seed: 1, cx: 0, cy: 0, cz: 0, data, changes: [], outside: () => Voxel.Air })[material];
    const item = itemMeshDefinition(voxel).groups;

    expect(item).toHaveLength(1);
    expect(item[0].material).toBe(material);
    expect(item[0].boxCount).toBe(2);
    expect(item[0].positions).toEqual([...world.positions]);
    expect(new Float32Array(item[0].normals)).toEqual(world.normals);
    expect(item[0].uvs).toEqual([...world.uvs]);
    expect(item[0].indices).toEqual([...world.indices]);
  });
});
