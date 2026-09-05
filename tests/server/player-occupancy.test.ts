import { describe, expect, it } from 'vitest';
import { playerOccupies, playerOccupiesVoxelShape } from '../../src/server/gameplay/player-occupancy';
import { Voxel } from '../../src/world/voxel';

describe('模型方块放置占用', () => {
  it('保留完整方块占用并允许玩家经过灯笼格边空隙', () => {
    const voxel = [0, 40, 0] as const;
    expect(playerOccupies([1.1, 41.6, 0.5], voxel)).toBe(true);
    expect(playerOccupiesVoxelShape([1.1, 41.6, 0.5], voxel, Voxel.Glowstone)).toBe(true);
    expect(playerOccupiesVoxelShape([1.1, 41.6, 0.5], voxel, Voxel.Lantern)).toBe(false);
    expect(playerOccupiesVoxelShape([0.82, 41.6, 0.5], voxel, Voxel.Lantern)).toBe(true);
  });
});
