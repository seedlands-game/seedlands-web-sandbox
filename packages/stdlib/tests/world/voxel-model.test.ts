import { describe, expect, it } from 'vitest';
import { FaceMaterial, Voxel, voxelNames } from '../../src/world/voxel';
import { collisionBoxesForVoxel, modelBoxesForVoxel, voxelOccludesFullFace } from '../../src/world/voxel-model';

describe('模型方块注册与形状', () => {
  it('保留旧数值 9 为辉光石并新增数值 10 灯笼', () => {
    expect(Voxel.Glowstone).toBe(9);
    expect(Voxel.Lantern).toBe(10);
    expect(FaceMaterial.Glowstone).toBe(11);
    expect(FaceMaterial.LanternFrame).toBe(12);
    expect(FaceMaterial.LanternGlow).toBe(13);
    expect(voxelNames[Voxel.Glowstone]).toBe('辉光石');
    expect(voxelNames[Voxel.Lantern]).toBe('灯笼');
  });

  it('灯笼由格内多个模型盒构成且不遮挡相邻完整方块面', () => {
    const boxes = modelBoxesForVoxel(Voxel.Lantern);
    expect(boxes.length).toBeGreaterThanOrEqual(7);
    expect(new Set(boxes.map((box) => box.material))).toEqual(
      new Set([FaceMaterial.LanternFrame, FaceMaterial.LanternGlow]),
    );
    expect(boxes.every((box) => [...box.min, ...box.max].every((value) => value >= 0 && value <= 1))).toBe(true);
    expect(boxes.some((box) => box.min[0] > 0 && box.max[0] < 1 && box.min[2] > 0 && box.max[2] < 1)).toBe(true);
    expect(voxelOccludesFullFace(Voxel.Lantern)).toBe(false);
    expect(voxelOccludesFullFace(Voxel.Glowstone)).toBe(true);
  });

  it('灯笼碰撞箱小于整格但覆盖可见主体', () => {
    expect(collisionBoxesForVoxel(Voxel.Lantern)).toEqual([{ min: [0.25, 0, 0.25], max: [0.75, 0.94, 0.75] }]);
    expect(collisionBoxesForVoxel(Voxel.Glowstone)).toEqual([{ min: [0, 0, 0], max: [1, 1, 1] }]);
  });
});
