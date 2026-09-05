import { bodyWorldAabb, type BodyConfig, type BodyState, type PhysicsWorld, type WorldAabb } from '../physics';

function overlaps(left: WorldAabb, right: WorldAabb): boolean {
  const epsilon = 1e-7;
  return (
    left.min.x < right.max.x - epsilon &&
    left.max.x > right.min.x + epsilon &&
    left.min.y < right.max.y - epsilon &&
    left.max.y > right.min.y + epsilon &&
    left.min.z < right.max.z - epsilon &&
    left.max.z > right.min.z + epsilon
  );
}

export function bodyOverlapsWorld(body: BodyState, config: BodyConfig, world: PhysicsWorld): boolean {
  const bounds = bodyWorldAabb(body, config);
  return world.querySolids(bounds).some((collider) => overlaps(bounds, collider.aabb));
}
