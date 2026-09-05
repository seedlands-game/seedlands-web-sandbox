import { describe, expect, it } from 'vitest';
import { playerOccupiesVoxelShape } from '../../src/server/gameplay/player-occupancy';
import { Voxel } from '../../src/world/voxel';

describe('模型方块放置占用', () => {
  it('保留完整方块占用并允许玩家经过灯笼格边空隙', () => {
    const voxel = [0, 40, 0] as const;
    expect(playerOccupiesVoxelShape([1.1, 40, 0.5], voxel, Voxel.Glowstone)).toBe(true);
    expect(playerOccupiesVoxelShape([1.1, 40, 0.5], voxel, Voxel.Lantern)).toBe(false);
    expect(playerOccupiesVoxelShape([0.82, 40, 0.5], voxel, Voxel.Lantern)).toBe(true);
  });

  it('真实跳搭：权威脚底已越过新块顶面时允许放置，不重复减眼高', () => {
    expect(playerOccupiesVoxelShape([0.5, 50.0533333333, 0.5], [0, 49, 0], Voxel.Dirt)).toBe(false);
    expect(playerOccupiesVoxelShape([0.5, 50, 0.5], [0, 49, 0], Voxel.Dirt)).toBe(false);
    expect(playerOccupiesVoxelShape([0.5, 49.99, 0.5], [0, 49, 0], Voxel.Dirt)).toBe(true);
  });

  it('头顶与侧面使用同一注册身体的真实体积，接触边界不是重叠', () => {
    expect(playerOccupiesVoxelShape([0.5, 50, 0.5], [0, 51, 0], Voxel.Stone)).toBe(true);
    expect(playerOccupiesVoxelShape([0.5, 50, 0.5], [0, 52, 0], Voxel.Stone)).toBe(false);
    expect(playerOccupiesVoxelShape([1.32, 50, 0.5], [0, 50, 0], Voxel.Stone)).toBe(false);
    expect(playerOccupiesVoxelShape([1.319, 50, 0.5], [0, 50, 0], Voxel.Stone)).toBe(true);
  });
});
