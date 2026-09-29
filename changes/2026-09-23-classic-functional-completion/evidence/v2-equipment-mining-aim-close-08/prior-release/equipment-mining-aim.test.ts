import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { traceVoxelTarget, type VoxelTarget } from '../../../src/client/presentation/voxel-target';
import { EQUIPMENT_RESOURCE_ROUTE_OPTIONS, EQUIPMENT_ROUTE_MAX_X_ERROR } from './equipment-resource-route';
import { matchesVoxelAim, mouseCorrectionToPoint, voxelAimPoint } from './target-aim';
import { classicScenario, type Point } from './scenario';

const BROWSER18_PLAYER: Point = [80.65967559814453, 32.599998474121094, -0.4997326731681824];
const BROWSER18_VIEW = [-481.16999999999973, -17.689999999999987] as const;
const MOUSE_SENSITIVITY = 0.13;

const directionForView = ([yaw, pitch]: readonly [number, number]): [number, number, number] => {
  const yawRadians = (yaw * Math.PI) / 180;
  const pitchRadians = (pitch * Math.PI) / 180;
  const horizontal = Math.cos(pitchRadians);
  return [-Math.sin(yawRadians) * horizontal, Math.sin(pitchRadians), -Math.cos(yawRadians) * horizontal];
};

const applyCorrection = (
  view: readonly [number, number],
  correction: Readonly<{ dx: number; dy: number }>,
): readonly [number, number] => [
  view[0] - correction.dx * MOUSE_SENSITIVITY,
  view[1] - correction.dy * MOUSE_SENSITIVITY,
];

const voxelMap = new Map([
  ...classicScenario.v2Equipment.resourceStrip.map(({ target, voxel }) => [target.join(','), voxel] as const),
  [classicScenario.v2Equipment.workbench.target.join(','), Voxel.Workbench] as const,
]);

const observedTarget = (player: Point, view: readonly [number, number]): VoxelTarget | null =>
  traceVoxelTarget([...player], directionForView(view), (x, y, z) => voxelMap.get([x, y, z].join(',')) ?? Voxel.Air);

const legacyPitchOnly = (
  view: readonly [number, number],
  observed: VoxelTarget | null,
  target: Point,
): readonly [number, number] => {
  if (!observed) return view;
  const moveDown =
    observed.position[1] > target[1] || (observed.position[1] === target[1] && observed.position[0] > target[0]);
  return applyCorrection(view, { dx: 0, dy: moveDown ? 6 : -6 });
};

const converge = (player: Point, initialView: readonly [number, number], target: Point) => {
  let view = initialView;
  for (let attempt = 1; attempt <= 180; attempt += 1) {
    const observed = observedTarget(player, view);
    if (matchesVoxelAim(observed, target)) return { attempt, observed, view };
    view = applyCorrection(view, mouseCorrectionToPoint(player, view, voxelAimPoint(target)));
  }
  return { attempt: 180, observed: observedTarget(player, view), view };
};

describe('Classic V2 equipment mining aim', () => {
  it('reproduces Browser-18 pitch-only oscillation and converges with one full correction budget', () => {
    const target = classicScenario.v2Equipment.resourceStrip[0]!.target;
    let legacyView: readonly [number, number] = BROWSER18_VIEW;
    for (let attempt = 0; attempt < 180; attempt += 1)
      legacyView = legacyPitchOnly(legacyView, observedTarget(BROWSER18_PLAYER, legacyView), target);
    expect(matchesVoxelAim(observedTarget(BROWSER18_PLAYER, legacyView), target)).toBe(false);

    const corrected = converge(BROWSER18_PLAYER, BROWSER18_VIEW, target);
    expect(corrected.attempt).toBeLessThanOrEqual(180);
    expect(corrected.observed).toMatchObject({ position: target, inRange: true });
    expect(matchesVoxelAim(observedTarget(BROWSER18_PLAYER, corrected.view), target)).toBe(true);
  });

  it.each(
    classicScenario.v2Equipment.resourceStrip.flatMap((resource) =>
      [-1, 1].map((side) => ({
        name: `${resource.itemId}:${resource.target[0]}:${side}`,
        target: resource.target,
        player: [
          resource.approach[0] + side * (EQUIPMENT_ROUTE_MAX_X_ERROR - 0.001),
          32.6,
          resource.approach[1] + side * (EQUIPMENT_RESOURCE_ROUTE_OPTIONS.corridorTolerance - 0.001),
        ] as Point,
      })),
    ),
  )('keeps $name visible from the finite route boundary', ({ player, target }) => {
    const corrected = converge(player, BROWSER18_VIEW, target);
    expect(corrected.attempt).toBeLessThanOrEqual(180);
    expect(corrected.observed).toMatchObject({ position: target, inRange: true });
  });

  it('keeps the reclaimed workbench visible from its mining approach', () => {
    const workbench = classicScenario.v2Equipment.workbench;
    const player: Point = [workbench.target[0] + 0.5, 32.6, workbench.approach[1] + 1];
    const corrected = converge(player, BROWSER18_VIEW, workbench.target);
    expect(corrected.attempt).toBeLessThanOrEqual(180);
    expect(corrected.observed).toMatchObject({ position: workbench.target, inRange: true });
  });

  it('requires one exact pre-aim before both V2 mining consumers reuse mineVoxel', () => {
    const source = readFileSync(new URL('./equipment-journey-support.ts', import.meta.url), 'utf8');
    const resourceMining = source.slice(
      source.indexOf('async function mineResources'),
      source.indexOf('async function openWorkbench'),
    );
    const workbenchMining = source.slice(
      source.indexOf('export async function reclaimEquipmentWorkbench'),
      source.indexOf('export async function exerciseEquipmentPointer'),
    );
    for (const consumer of [resourceMining, workbenchMining]) {
      const preaimCall = 'await aimAtVoxelWithRealMouse(page,';
      const mineCall = 'await mineVoxel(page,';
      const preaim = consumer.indexOf(preaimCall);
      const mine = consumer.indexOf(mineCall);
      expect(preaim).toBeGreaterThanOrEqual(0);
      expect(mine).toBeGreaterThan(preaim);
      expect(
        consumer
          .slice(preaim + preaimCall.length, mine)
          .replace(/[^;]*;/, '')
          .trim(),
      ).toBe('');
      expect(consumer.split('aimAtVoxelWithRealMouse(')).toHaveLength(2);
      expect(consumer.split('mineVoxel(')).toHaveLength(2);
    }
  });

  it('keeps the correction mechanism content-neutral', () => {
    const target: Point = [3, 7, -4];
    const player: Point = [0.5, 8.6, -1.5];
    let view: readonly [number, number] = [35, -5];
    const point = voxelAimPoint(target);
    let observed: VoxelTarget | null = null;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      observed = traceVoxelTarget([...player], directionForView(view), (x, y, z) =>
        x === target[0] && y === target[1] && z === target[2] ? Voxel.Stone : Voxel.Air,
      );
      if (matchesVoxelAim(observed, target)) break;
      view = applyCorrection(view, mouseCorrectionToPoint(player, view, point));
    }
    expect(matchesVoxelAim(observed, target)).toBe(true);
  });
});
