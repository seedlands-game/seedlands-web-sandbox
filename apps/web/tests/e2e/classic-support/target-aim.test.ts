import { describe, expect, it } from 'vitest';
import { traceVoxelTarget, type VoxelTarget } from '../../../src/client/presentation/voxel-target';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import {
  horizontalMouseCorrectionToRoute,
  matchesVoxelAim,
  mouseCorrectionToPoint,
  mouseCorrectionToVoxel,
  voxelAimPoint,
  voxelInteractionDistance,
} from './target-aim';
import type { Point } from './scenario';

const directionForView = ([yaw, pitch]: readonly [number, number]): [number, number, number] => {
  const yawRadians = (yaw * Math.PI) / 180;
  const pitchRadians = (pitch * Math.PI) / 180;
  const horizontal = Math.cos(pitchRadians);
  return [-Math.sin(yawRadians) * horizontal, Math.sin(pitchRadians), -Math.cos(yawRadians) * horizontal];
};

const applyCorrection = (
  view: readonly [number, number],
  correction: Readonly<{ dx: number; dy: number }>,
): readonly [number, number] => [view[0] - correction.dx * 0.13, view[1] - correction.dy * 0.13];

const floorTarget = (player: Point, view: readonly [number, number]): VoxelTarget | null =>
  traceVoxelTarget([player[0], player[1], player[2]], directionForView(view), (_x, y) =>
    y === 30 ? Voxel.Stone : Voxel.Air,
  );

const legacyCorrection = (player: Point, observed: Point, target: Point): Readonly<{ dx: number; dy: number }> => {
  const yaw = (point: Point) =>
    (Math.atan2(-(point[0] + 0.5 - player[0]), -(point[2] + 0.5 - player[2])) * 180) / Math.PI;
  let yawError = (yaw(target) - yaw(observed)) % 360;
  if (yawError > 180) yawError -= 360;
  if (yawError < -180) yawError += 360;
  if (Math.abs(yawError) > 2.5) return { dx: Math.max(-80, Math.min(80, -yawError / 0.13)), dy: 0 };
  return { dx: 0, dy: observed[1] === target[1] ? 4 : observed[1] < target[1] ? -6 : 6 };
};

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

  it('converges the Browser-08 top-face target where discrete hit-cell steering stalls', () => {
    const player: Point = [73.74300384521484, 32.60000228881836, 2.7646305561065674];
    const target: Point = [76, 30, 2];
    const adjacent: Point = [76, 31, 2];
    const initialView = [-96.88999999999997, -44.60000000000002] as const;
    let legacyView: readonly [number, number] = initialView;
    let modernView: readonly [number, number] = initialView;

    for (let attempt = 0; attempt < 180; attempt += 1) {
      const legacyTarget = floorTarget(player, legacyView);
      if (legacyTarget)
        legacyView = applyCorrection(legacyView, legacyCorrection(player, legacyTarget.position, target));
      modernView = applyCorrection(
        modernView,
        mouseCorrectionToPoint(player, modernView, voxelAimPoint(target, adjacent)),
      );
    }

    expect(matchesVoxelAim(floorTarget(player, legacyView), target, adjacent)).toBe(false);
    expect(matchesVoxelAim(floorTarget(player, modernView), target, adjacent)).toBe(true);
    expect(legacyView[1]).toBe(initialView[1]);
  });

  it.each([
    { player: [76.5, 32.6, 2.5] as Point, target: [76, 30, 2] as Point, adjacent: [76, 31, 2] as Point },
    { player: [-0.5, 3.5, 4.5] as Point, target: [2, 3, 4] as Point, adjacent: [1, 3, 4] as Point },
  ])('aims through the requested shared face for $target -> $adjacent', ({ player, target, adjacent }) => {
    const point = voxelAimPoint(target, adjacent);
    const direction: [number, number, number] = [point[0] - player[0], point[1] - player[1], point[2] - player[2]];
    const hit = traceVoxelTarget([player[0], player[1], player[2]], direction, (x, y, z) =>
      x === target[0] && y === target[1] && z === target[2] ? Voxel.Stone : Voxel.Air,
    );

    expect(matchesVoxelAim(hit, target, adjacent)).toBe(true);
  });

  it('uses the shortest yaw correction across the wrap boundary', () => {
    const radians = (-179 * Math.PI) / 180;
    const target: Point = [-Math.sin(radians), 0, -Math.cos(radians)];
    const correction = mouseCorrectionToPoint([0, 0, 0], [179, 0], target);

    expect(Math.abs(correction.dx)).toBeLessThan(20);
    expect(correction.dy).toBe(0);
  });

  it('keeps center aiming without adjacent and rejects incomplete observations', () => {
    expect(voxelAimPoint([2, 3, 4])).toEqual([2.5, 3.5, 4.5]);
    expect(matchesVoxelAim(null, [2, 3, 4])).toBe(false);
    expect(matchesVoxelAim({ position: [1, 3, 4], adjacent: [0, 3, 4] }, [2, 3, 4])).toBe(false);
    expect(matchesVoxelAim({ position: [2, 3, 4], adjacent: [1, 3, 4] }, [2, 3, 4], [3, 3, 4])).toBe(false);
    expect(matchesVoxelAim({ position: [2, 3, 4], adjacent: null }, [2, 3, 4])).toBe(true);
  });

  it('rejects malformed target faces before calculating a correction', () => {
    expect(() => voxelAimPoint([2, 3, 4], [3, 4, 4])).toThrow('orthogonally adjacent');
    expect(() => voxelAimPoint([2, 3, 4], [2, 3, 4.5])).toThrow('finite integer');
  });
});
