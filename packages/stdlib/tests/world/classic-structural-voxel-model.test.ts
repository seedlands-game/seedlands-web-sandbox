import { expect, it } from 'vitest';
import { renderCategoryForMaterial } from '../../src/world/mesh-render-category';
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
  for (const voxel of [Voxel.Slab, Voxel.WoodStairs, Voxel.CobblestoneStairs, Voxel.WoodenDoor, Voxel.Bed, Voxel.Cake])
    expect(collisionBoxesForVoxel(voxel)).toEqual(modelBoxesForVoxel(voxel).map(({ min, max }) => ({ min, max })));
  expect(modelBoxesForVoxel(Voxel.Slab)).toEqual([{ min: [0, 0, 0], max: [1, 0.5, 1], material: FaceMaterial.Slab }]);
  expect(modelBoxesForVoxel(Voxel.WoodStairs)).toHaveLength(2);
  expect(renderCategoryForMaterial(FaceMaterial.Ladder)).toBe('cutout');
});

it('火把拆分为不发光木柄和发光火头，栅栏横档不改变既有中心柱碰撞', () => {
  const torch = modelBoxesForVoxel(Voxel.Torch);
  expect(torch).toEqual([
    { min: [0.43, 0, 0.43], max: [0.57, 0.56, 0.57], material: FaceMaterial.Torch },
    { min: [0.36, 0.56, 0.36], max: [0.64, 0.82, 0.64], material: FaceMaterial.TorchFlame },
  ]);
  expect(renderCategoryForMaterial(FaceMaterial.Torch)).toBe('opaque');
  expect(renderCategoryForMaterial(FaceMaterial.TorchFlame)).toBe('emissive');

  expect(modelBoxesForVoxel(Voxel.Fence)).toEqual([
    { min: [0.38, 0, 0.38], max: [0.62, 1, 0.62], material: FaceMaterial.Fence },
    { min: [0, 0.38, 0.44], max: [1, 0.5, 0.56], material: FaceMaterial.Fence },
    { min: [0, 0.68, 0.44], max: [1, 0.8, 0.56], material: FaceMaterial.Fence },
    { min: [0.44, 0.38, 0], max: [0.56, 0.5, 1], material: FaceMaterial.Fence },
    { min: [0.44, 0.68, 0], max: [0.56, 0.8, 1], material: FaceMaterial.Fence },
  ]);
  expect(collisionBoxesForVoxel(Voxel.Fence)).toEqual([{ min: [0.38, 0, 0.38], max: [0.62, 1, 0.62] }]);
});
