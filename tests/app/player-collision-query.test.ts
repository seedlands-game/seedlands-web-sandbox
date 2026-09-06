import { describe, expect, it } from 'vitest';
import { bodyConfigFor, type PhysicsWorld, type WorldAabb } from '../../src/physics';
import { COLLISION_EPSILON } from '../../src/physics/geometry';
import { bodyOverlapsWorld } from '../../src/app/player-collision-query';

const ground = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };
const world: PhysicsWorld = {
  querySolids: (_bounds: WorldAabb) => [{ id: 'ground', aabb: ground }],
};

const overlapsAtFeetY = (y: number) =>
  bodyOverlapsWorld(
    { position: { x: 0.5, y, z: 0.5 }, velocity: { x: 0, y: 0, z: 0 } },
    bodyConfigFor('player'),
    world,
  );

describe('玩家碰撞诊断', () => {
  it('与统一物理解算共享接触epsilon', () => {
    expect(overlapsAtFeetY(1)).toBe(false);
    expect(overlapsAtFeetY(1 - COLLISION_EPSILON / 2)).toBe(false);
    expect(overlapsAtFeetY(1 - COLLISION_EPSILON * 2)).toBe(true);
  });
});
