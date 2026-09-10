import {
  bodyConfigFor,
  bodyKindForEntity,
  bodyWorldAabb,
  isBodyPositionReachable,
  probeBodyContacts,
  type BodyState,
} from '../../physics';
import { COLLISION_EPSILON } from '../../physics/geometry';
import type { AuthorityEntity } from './authority-session-types';
import { VoxelCollisionWorld, type LoadedVoxelSource } from './voxel-collision-world';

export const MAX_SAFE_MODE_LANDING_DISTANCE = 8;

const codeUnitCompare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export const bodyStateForAuthorityEntity = (entity: AuthorityEntity): BodyState => ({
  position: { x: entity.position[0], y: entity.position[1], z: entity.position[2] },
  velocity: {
    x: entity.physicsVelocity?.[0] ?? 0,
    y: entity.physicsVelocity?.[1] ?? 0,
    z: entity.physicsVelocity?.[2] ?? 0,
  },
});

/** Finds the nearest loaded, reachable support directly below the entity. */
export const findSafeModeLanding = (
  entity: AuthorityEntity,
  voxelSource: LoadedVoxelSource,
): [number, number, number] | null => {
  const state = bodyStateForAuthorityEntity(entity);
  const config = bodyConfigFor(bodyKindForEntity(entity));
  const bodyBounds = bodyWorldAabb(state, config);
  const currentFootY = bodyBounds.min.y;
  const world = new VoxelCollisionWorld(voxelSource);
  world.beginStep();
  const candidates = world
    .querySolids({
      min: {
        x: bodyBounds.min.x,
        y: currentFootY - MAX_SAFE_MODE_LANDING_DISTANCE - COLLISION_EPSILON,
        z: bodyBounds.min.z,
      },
      max: {
        x: bodyBounds.max.x,
        y: currentFootY + COLLISION_EPSILON,
        z: bodyBounds.max.z,
      },
    })
    .filter((collider) => collider.id?.startsWith('voxel:'))
    .map((collider) => ({
      colliderId: collider.id!,
      positionY: collider.aabb.max.y - config.localAabb.min.y,
    }))
    .filter(({ positionY }) => {
      const distance = state.position.y - positionY;
      return distance >= -COLLISION_EPSILON && distance <= MAX_SAFE_MODE_LANDING_DISTANCE + COLLISION_EPSILON;
    })
    .sort((left, right) => right.positionY - left.positionY || codeUnitCompare(left.colliderId, right.colliderId));
  const testedY = new Set<number>();
  for (const candidate of candidates) {
    if (testedY.has(candidate.positionY)) continue;
    testedY.add(candidate.positionY);
    const target = { x: state.position.x, y: candidate.positionY, z: state.position.z };
    if (!isBodyPositionReachable(state, config, world, target)) continue;
    const probe = probeBodyContacts({ state: { position: target, velocity: state.velocity }, config, world });
    if (
      !probe.grounded ||
      !probe.contacts.some((contact) => contact.normal.y > 0 && contact.colliderId?.startsWith('voxel:'))
    )
      continue;
    return [target.x, target.y, target.z];
  }
  return null;
};
