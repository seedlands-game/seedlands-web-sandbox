import { bodyWorldAabb, type BodyConfig, type BodyState, type PhysicsWorld } from '@seedlands/game-core/physics';
import { overlapDepth } from '@seedlands/game-core/physics/geometry';

export function bodyOverlapsWorld(body: BodyState, config: BodyConfig, world: PhysicsWorld): boolean {
  const bounds = bodyWorldAabb(body, config);
  return world.querySolids(bounds).some((collider) => overlapDepth(bounds, collider.aabb) !== null);
}
