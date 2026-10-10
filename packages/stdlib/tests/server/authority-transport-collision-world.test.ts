import { describe, expect, it } from 'vitest';
import { sweepBodyThroughWorld, type Collider, type PhysicsWorld, type WorldAabb } from '../../src/physics';
import { bodyConfigFor, CollisionLayer } from '../../src/physics/body-registry';
import { createAuthorityTransportCollisionWorlds } from '../../src/server/authority/authority-transport-collision-world';
import type { AuthorityEntity } from '../../src/server/authority/authority-session-types';

const bounds: WorldAabb = { min: { x: -2, y: -2, z: -2 }, max: { x: 10, y: 10, z: 10 } };
const unknown: Collider = {
  id: 'unknown:8,0,0',
  aabb: { min: { x: 8, y: 0, z: 0 }, max: { x: 9, y: 1, z: 1 } },
};
const fluid = [{ aabb: unknown.aabb, velocity: { x: 1, y: 0, z: 0 }, surfaceY: 1 }];
const voxelWorld: PhysicsWorld = { querySolids: () => [unknown], sampleFluid: () => fluid };
const config = {
  localAabb: { min: { x: -0.4, y: 0, z: -0.4 }, max: { x: 0.4, y: 0.8, z: 0.4 } },
  collisionLayer: CollisionLayer.Character,
  collisionMask: CollisionLayer.World | CollisionLayer.Character,
};
const entity = (id: string, x: number): AuthorityEntity => ({
  id,
  type: 'transport',
  position: [x, 0, 0],
});

describe('current Authority transport collision projection', () => {
  it('returns the original world when there are no transport entities', () => {
    const player: AuthorityEntity = { id: 'player', type: 'player', position: [0, 0, 0] };
    const worlds = createAuthorityTransportCollisionWorlds(voxelWorld, [player], () => bodyConfigFor('player'));
    expect(worlds.all).toBe(voxelWorld);
    expect(worlds.forEntity('player')).toBe(voxelWorld);
  });

  it('keeps voxel unknown blockers and fluids, and excludes only the querying transport itself', () => {
    const worlds = createAuthorityTransportCollisionWorlds(
      voxelWorld,
      [entity('first', 3), entity('second', 5)],
      () => config,
    );
    expect(worlds.all.querySolids(bounds).map(({ id }) => id)).toEqual([
      unknown.id,
      'transport:first',
      'transport:second',
    ]);
    expect(
      worlds
        .forEntity('first')
        .querySolids(bounds)
        .map(({ id }) => id),
    ).toEqual([unknown.id, 'transport:second']);
    expect(worlds.forEntity('player').querySolids(bounds)).toEqual(worlds.all.querySolids(bounds));
    expect(worlds.all.sampleFluid?.(bounds)).toBe(fluid);
    expect(worlds.all.querySolids({ min: { x: 20, y: 0, z: 0 }, max: { x: 21, y: 1, z: 1 } })).toEqual([unknown]);
  });

  it('takes independent current projections without retaining retired or previous-world bodies', () => {
    const first = createAuthorityTransportCollisionWorlds(voxelWorld, [entity('reused', 3)], () => config);
    const next = createAuthorityTransportCollisionWorlds(voxelWorld, [entity('reused', 5)], () => config);
    expect(first.all.querySolids(bounds)[1]!.aabb.min.x).toBe(2.6);
    expect(next.all.querySolids(bounds)[1]!.aabb.min.x).toBe(4.6);
    const retired = createAuthorityTransportCollisionWorlds(voxelWorld, [], () => config);
    expect(retired.all.querySolids(bounds)).toEqual([unknown]);
    expect(next.forEntity('reused').querySolids(bounds)).toEqual([unknown]);
  });
});

it('blocks a normal body crossing the derived mounted rider above the carrier body', () => {
  const rider: AuthorityEntity = { id: 'rider', type: 'player', position: [3, 0.55, 0] };
  const seat = {
    rider: { entityId: 'rider', epoch: 1, lifetime: 1 },
    walkingEnabled: false as const,
    pose: { position: [3, 0.55, 0] as const, yaw: 0 },
  };
  const worlds = createAuthorityTransportCollisionWorlds(
    { querySolids: () => [] },
    [entity('cart', 3), rider],
    (entry) => (entry.type === 'transport' ? config : bodyConfigFor('player')),
    [seat],
  );
  const collider = worlds.all.querySolids(bounds).find(({ id }) => id === 'mounted:rider');
  const crossing = sweepBodyThroughWorld(
    { position: { x: 0, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
    bodyConfigFor('player'),
    worlds.all,
    { x: 6, y: 0, z: 0 },
  );
  expect(crossing.position.x).toBeLessThan(3);
  expect(collider).toBeDefined();
  expect(collider!.aabb.min.y).toBe(0.55);
  expect(crossing.contacts.some(({ collider }) => collider.id === 'mounted:rider')).toBe(true);
  expect(
    worlds
      .forEntity('rider')
      .querySolids(bounds)
      .some(({ id }) => id === 'mounted:rider'),
  ).toBe(false);
});
