import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { traceVoxelTarget, type VoxelTarget } from '../../../src/client/presentation/voxel-target';
import { EQUIPMENT_RESOURCE_ROUTE_OPTIONS, EQUIPMENT_ROUTE_MAX_X_ERROR } from './equipment-resource-route';
import { mineVoxel, type ClassicSnapshot } from './harness';
import { matchesVoxelAim, mouseCorrectionToPoint, mouseCorrectionToVoxel, voxelAimPoint } from './target-aim';
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

const fixtureVoxels = new Map([
  ...classicScenario.v2Equipment.resourceStrip.map(({ target, voxel }) => [target.join(','), voxel] as const),
  [classicScenario.v2Equipment.workbench.target.join(','), Voxel.Workbench] as const,
]);

const observedTarget = (player: Point, view: readonly [number, number]): VoxelTarget | null =>
  traceVoxelTarget([...player], directionForView(view), (x, y, z) => {
    const explicit = fixtureVoxels.get([x, y, z].join(','));
    if (explicit !== undefined) return explicit;
    const { from, to, voxel } = classicScenario.initialState.floor;
    return x >= from[0] && x <= to[0] && y >= from[1] && y <= to[1] && z >= from[2] && z <= to[2] ? voxel : Voxel.Air;
  });

const legacyPitchOnly = (
  view: readonly [number, number],
  observed: VoxelTarget | null,
  target: Point,
): readonly [number, number] => {
  if (!observed) return applyCorrection(view, mouseCorrectionToVoxel(BROWSER18_PLAYER, view, target));
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

const miningSnapshot = (interactionAttempts: number): ClassicSnapshot =>
  ({
    player: BROWSER18_PLAYER,
    serverPlayerPosition: BROWSER18_PLAYER,
    viewAngles: BROWSER18_VIEW,
    onGround: true,
    colliding: false,
    interactionAttempts,
    authority: { physicsTick: 10, acknowledgedInputSequence: 5, commitSequence: 2 },
  }) as ClassicSnapshot;

function createMiningPage(target: Point, options: Readonly<{ failOnLegacyAim?: boolean }> = {}) {
  const calls = { down: 0, up: 0, legacyAimReads: 0, interactionAttempts: 7 };
  const order: string[] = [];
  const page = {
    evaluate: async (callback: (...args: unknown[]) => unknown) => {
      const source = String(callback);
      if (source.includes('pointerLockElement')) {
        order.push('pointer-lock');
        return true;
      }
      if (source.includes('getVoxelAt')) return 0;
      if (source.includes('target-card')) {
        order.push('legacy-aim');
        calls.legacyAimReads += 1;
        if (options.failOnLegacyAim) throw new Error('legacy aim callback must not run');
        return target.join(',');
      }
      if (source.includes('snapshot()')) {
        order.push('snapshot');
        return miningSnapshot(calls.interactionAttempts);
      }
      throw new Error(`Unexpected evaluate callback: ${source}`);
    },
    mouse: {
      down: async () => {
        order.push('mouse-down');
        calls.down += 1;
        calls.interactionAttempts += 1;
      },
      up: async () => {
        order.push('mouse-up');
        calls.up += 1;
      },
    },
  } as unknown as Page;
  return { calls, order, page };
}

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

  it('requires both V2 mining consumers to inject full aim into mineVoxel instead of pre-aiming separately', () => {
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
      expect(consumer).not.toContain('await aimAtVoxelWithRealMouse(page,');
      expect(consumer).toContain('await mineVoxel(page,');
      expect(consumer).toContain('aimAtVoxelWithRealMouse');
      expect(consumer.split('mineVoxel(')).toHaveLength(2);
    }
  });

  it('keeps the default mineVoxel aim callback and calls it before the mining button', async () => {
    const target = classicScenario.v2Equipment.resourceStrip[0]!.target;
    const { calls, order, page } = createMiningPage(target);
    await mineVoxel(page, target);
    expect(calls).toMatchObject({ legacyAimReads: 1, down: 1, up: 1 });
    expect(order.slice(0, 4)).toEqual(['snapshot', 'pointer-lock', 'legacy-aim', 'snapshot']);
    expect(order.indexOf('mouse-down')).toBeGreaterThan(order.indexOf('legacy-aim'));
  });

  it('uses one injected full-aim callback and does not fall back to the legacy guard', async () => {
    const target = classicScenario.v2Equipment.resourceStrip[0]!.target;
    const { calls, order, page } = createMiningPage(target, { failOnLegacyAim: true });
    const fullAim = vi.fn(async () => {
      order.push('full-aim');
    });
    await mineVoxel(page, target, fullAim);
    expect(fullAim).toHaveBeenCalledOnce();
    expect(fullAim).toHaveBeenCalledWith(page, target);
    expect(calls).toMatchObject({ legacyAimReads: 0, down: 1, up: 1 });
    expect(order.slice(0, 4)).toEqual(['snapshot', 'pointer-lock', 'full-aim', 'snapshot']);
    expect(order.indexOf('mouse-down')).toBeGreaterThan(order.indexOf('full-aim'));
  });

  it('stops before left mouse down when the injected full-aim callback rejects', async () => {
    const target = classicScenario.v2Equipment.resourceStrip[0]!.target;
    const { calls, order, page } = createMiningPage(target, { failOnLegacyAim: true });
    const fullAim = vi.fn(async () => {
      order.push('full-aim');
      throw new Error('full aim rejected');
    });
    await expect(mineVoxel(page, target, fullAim)).rejects.toThrow('full aim rejected');
    expect(fullAim).toHaveBeenCalledOnce();
    expect(calls).toMatchObject({ legacyAimReads: 0, down: 0, up: 0 });
    expect(order).toEqual(['snapshot', 'pointer-lock', 'full-aim']);
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
