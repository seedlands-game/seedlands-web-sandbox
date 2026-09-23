import { describe, expect, it } from 'vitest';
import {
  horizontalMouseCorrectionToRoute,
  mouseCorrectionToPoint,
  mouseCorrectionToVoxel,
  voxelInteractionDistance,
} from './target-aim';

describe('Classic real-mouse target correction', () => {
  it('corrects the hosted C1 yaw residue toward the first resource voxel', () => {
    const correction = mouseCorrectionToVoxel([28.78, 61.6, 1.37], [-80, -16], [34, 60, 0]);
    expect(correction.dx).toBeGreaterThan(0);
    expect(correction.dy).toBeLessThan(0);
    expect(Math.abs(correction.dx)).toBeLessThanOrEqual(80);
    expect(Math.abs(correction.dy)).toBeLessThanOrEqual(80);
  });

  it('requires no correction when already aimed at the voxel center', () => {
    const player = [28.5, 61.6, 0.5] as const;
    const target = [34, 60, 0] as const;
    const yaw = -90;
    const pitch = (Math.atan2(target[1] + 0.5 - player[1], target[0] + 0.5 - player[0]) * 180) / Math.PI;
    expect(mouseCorrectionToVoxel(player, [yaw, pitch], target)).toEqual({ dx: 0, dy: 0 });
  });

  it('raises the post-mining view toward the hostile body', () => {
    const correction = mouseCorrectionToPoint([55.61, 61.6, -0.65], [-73.1, -47.2], [56, 61, 0.5]);
    expect(correction.dy).toBeLessThan(0);
    expect(Math.abs(correction.dx)).toBeLessThanOrEqual(80);
    expect(Math.abs(correction.dy)).toBeLessThanOrEqual(80);
  });

  it('aligns W toward a route target and S away from it', () => {
    expect(horizontalMouseCorrectionToRoute([56, 61.6, 0.5], -73, [72.5, 0.5], 'KeyW')).toBeGreaterThan(0);
    expect(Math.abs(horizontalMouseCorrectionToRoute([208.5, 61.6, 0.5], -90, [72.5, 0.5], 'KeyS'))).toBe(0);
  });

  it('measures gameplay reach from the player to the voxel center', () => {
    expect(voxelInteractionDistance([29.61, 61.6, 0.48], [34, 60, 0])).toBeGreaterThan(5);
    expect(voxelInteractionDistance([31.5, 61.6, 0.5], [34, 60, 0])).toBeLessThan(5);
  });
});
