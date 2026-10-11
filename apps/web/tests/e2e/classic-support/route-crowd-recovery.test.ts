import { describe, expect, it } from 'vitest';
import {
  bodyConfigFor,
  bodyWorldAabb,
  separateBodies,
  stepBody,
  type BodyState,
  type PhysicsWorld,
} from '@seedlands/stdlib/physics';
import { overlapDepth } from '@seedlands/stdlib/physics/geometry';
import { RouteCrowdRecovery } from './route-crowd-recovery';
import type { Point } from './scenario';

const goal = [72.5, 0.5] as const;
const foot = (body: BodyState): Point => [body.position.x, body.position.y, body.position.z];
const idle = { wish: { x: 0, z: 0 }, jumpPressed: false, verticalIntent: 0 as const };
const world: PhysicsWorld = {
  querySolids: () => [
    { id: 'floor', aabb: { min: { x: -100, y: 30, z: -3 }, max: { x: 300, y: 31, z: 3 } }, layer: 1, mask: 0xffffffff },
  ],
};

/** Real solver/configs; finite physical pulses, not a browser wall-clock or input acceptance. */
function route(withSheep: boolean, recovery?: RouteCrowdRecovery) {
  const pc = bodyConfigFor('player'),
    sc = bodyConfigFor('sheep');
  let p: BodyState = {
    position: { x: 208.10468667915515, y: 31.000001, z: 0.48115124419608296 },
    velocity: { x: 0, y: 0, z: 0 },
  };
  let sheep: BodyState = { position: { x: 108.56324064529531, y: 31, z: 1 }, velocity: { x: 0, y: 0, z: 0 } };
  let pulse = 0;
  for (; pulse < 256 && p.position.x > goal[0]; pulse++) {
    const before = foot(p);
    const target = recovery?.aimTarget(before) ?? goal;
    const dx = target[0] - before[0],
      dz = target[1] - before[2],
      length = Math.hypot(dx, dz);
    for (let tick = 0; tick < 90; tick++) {
      p = stepBody({
        state: p,
        config: pc,
        input: tick < 19 ? { ...idle, wish: { x: dx / length, z: dz / length }, jumpPressed: tick === 1 } : idle,
        world,
        dt: 1 / 60,
      }).state;
      if (withSheep) {
        sheep = stepBody({ state: sheep, config: sc, input: idle, world, dt: 1 / 60 }).state;
        const result = separateBodies({
          left: p,
          leftConfig: pc,
          right: sheep,
          rightConfig: sc,
          world,
          maxDistance: 0.1,
        });
        p = result.left;
        sheep = result.right;
      }
    }
    recovery?.observe(before, foot(p), 300);
  }
  return { player: p, sheep, pulses: pulse };
}

describe('bounded native route steering', () => {
  it('reduces the physical sheep-push detour and reaches the original goal while preserving both bodies', () => {
    const clear = route(false),
      straight = route(true),
      result = route(true, new RouteCrowdRecovery(goal));
    expect(clear.player.position.x).toBeLessThanOrEqual(goal[0]);
    expect(straight.player.position.x).toBeLessThanOrEqual(goal[0]);
    // Physical progress comparison only. The 256-pulse fuse is not a browser deadline.
    // Two slow pulses plus steering cost at most two pulses relative to the clear route.
    expect(result.pulses).toBeLessThanOrEqual(clear.pulses + 2);
    expect(straight.pulses - result.pulses).toBeGreaterThanOrEqual(10);
    expect(result.player.position.x).toBeLessThanOrEqual(goal[0]);
    expect(Math.abs(result.player.position.z - goal[1])).toBeLessThan(1.5);
    // Native steering can legitimately push the sheep sideways through the real solver.
    expect(result.sheep.position.y).toBeCloseTo(31, 5);
    expect(result.sheep.position.z).toBeGreaterThanOrEqual(1);
    expect(
      overlapDepth(
        bodyWorldAabb(result.player, bodyConfigFor('player')),
        bodyWorldAabb(result.sheep, bodyConfigFor('sheep')),
      ),
    ).toBeNull();
    expect(bodyConfigFor('sheep').localAabb.max.x).toBe(0.55);
    expect(bodyConfigFor('player').localAabb.max.x).toBe(0.32);
  });

  it('leaves an unobstructed route byte-for-byte equivalent', () => {
    expect(route(false, new RouteCrowdRecovery(goal))).toEqual(route(false));
  });

  it('requires two consecutive slow settled pulses and keeps the original goal separate from its waypoint', () => {
    const r = new RouteCrowdRecovery(goal);
    r.observe([110, 31, 0.42], [109.2, 31, 0.42], 300);
    expect(r.aimTarget([109.2, 31, 0.42])).toBe(goal);
    r.observe([109.2, 31, 0.42], [108.4, 31, 0.42], 300);
    const waypoint = r.aimTarget([108.4, 31, 0.42]);
    expect(waypoint[0]).toBeLessThan(108.4);
    expect(waypoint[1]).toBeLessThan(0.42);
    expect(r.aimTarget([waypoint[0], 31, waypoint[1]])).toBe(goal);
  });

  it('does not classify short final pulses or healthy movement as crowd blockage', () => {
    const r = new RouteCrowdRecovery(goal);
    for (let i = 0; i < 4; i++) r.observe([110, 31, 0.5], [109.8, 31, 0.5], 100);
    expect(r.aimTarget([109.8, 31, 0.5])).toBe(goal);
    r.observe([110, 31, 0.5], [109.2, 31, 0.5], 300);
    r.observe([109.2, 31, 0.5], [107.7, 31, 0.5], 300);
    r.observe([107.7, 31, 0.5], [106.9, 31, 0.5], 300);
    expect(r.aimTarget([106.9, 31, 0.5])).toBe(goal);
    for (let i = 0; i < 4; i++) r.observe([74, 31, 0.5], [73.9, 31, 0.5], 300);
    expect(r.aimTarget([79.9, 31, 0.5])).toBe(goal);
  });

  it('expires each recovery after four pulses and never exceeds three attempts', () => {
    const r = new RouteCrowdRecovery(goal);
    const before = [110, 31, 0.5] as const,
      after = [109.2, 31, 0.5] as const;
    for (let attempt = 0; attempt < 4; attempt++) {
      r.observe(before, after, 300);
      r.observe(before, after, 300);
      const target = r.aimTarget(after);
      if (attempt === 3) expect(target).toBe(goal);
      else {
        expect(target).not.toBe(goal);
        for (let pulse = 0; pulse < 4; pulse++) r.observe(after, after, 300);
        expect(r.aimTarget(after)).toBe(goal);
      }
    }
  });
});
