import { expect, it } from 'vitest';
import { FaceMaterial, Voxel } from '../../src/world/voxel';
import { collisionBoxesForVoxel, modelBoxesForVoxel, voxelOccludesFullFace } from '../../src/world/voxel-model';

it('结构方块使用有界非整格模型及明确碰撞形状', () => {
  for (const voxel of [
    Voxel.Rail,
    Voxel.PoweredRail,
    Voxel.DetectorRail,
    Voxel.Slab,
    Voxel.WoodStairs,
    Voxel.CobblestoneStairs,
    Voxel.WoodenDoor,
    Voxel.Ladder,
    Voxel.Torch,
    Voxel.Bed,
    Voxel.Sign,
    Voxel.Fence,
    Voxel.Cake,
  ]) {
    const model = modelBoxesForVoxel(voxel);
    expect(model.length).toBeGreaterThan(0);
    expect(model.every((box) => [...box.min, ...box.max].every((value) => value >= 0 && value <= 1))).toBe(true);
    expect(voxelOccludesFullFace(voxel)).toBe(false);
  }
  for (const voxel of [Voxel.Ladder, Voxel.Torch, Voxel.Sign, Voxel.Rail, Voxel.PoweredRail, Voxel.DetectorRail])
    expect(collisionBoxesForVoxel(voxel)).toEqual([]);
  for (const voxel of [
    Voxel.Slab,
    Voxel.WoodStairs,
    Voxel.CobblestoneStairs,
    Voxel.WoodenDoor,
    Voxel.Bed,
    Voxel.Fence,
    Voxel.Cake,
  ])
    expect(collisionBoxesForVoxel(voxel)).toEqual(modelBoxesForVoxel(voxel).map(({ min, max }) => ({ min, max })));
  expect(modelBoxesForVoxel(Voxel.Slab)).toEqual([{ min: [0, 0, 0], max: [1, 0.5, 1], material: FaceMaterial.Slab }]);
  expect(modelBoxesForVoxel(Voxel.WoodStairs)).toHaveLength(2);
});
