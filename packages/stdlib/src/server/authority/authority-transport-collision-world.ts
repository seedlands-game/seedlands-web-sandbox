import { bodyWorldAabb, type BodyConfig, type Collider, type PhysicsWorld, type WorldAabb } from '../../physics';
import type { AuthorityEntity } from './authority-session-types';

const intersects = (left: WorldAabb, right: WorldAabb) =>
  left.min.x <= right.max.x &&
  left.max.x >= right.min.x &&
  left.min.y <= right.max.y &&
  left.max.y >= right.min.y &&
  left.min.z <= right.max.z &&
  left.max.z >= right.min.z;

/** Derived for one synchronous physics/recovery step; canonical bodies remain in the ECS owner. */
export function createAuthorityTransportCollisionWorlds(
  world: PhysicsWorld,
  entities: readonly AuthorityEntity[],
  bodyConfigFor: (entity: AuthorityEntity) => BodyConfig,
): Readonly<{ all: PhysicsWorld; forEntity: (id: string) => PhysicsWorld }> {
  const colliders = entities
    .filter((entity) => entity.type === 'transport')
    .map((entity): Collider => {
      const config = bodyConfigFor(entity);
      const [x, y, z] = entity.position;
      const aabb = bodyWorldAabb({ position: { x, y, z }, velocity: { x: 0, y: 0, z: 0 } }, config);
      return Object.freeze({
        id: `transport:${entity.id}`,
        aabb: Object.freeze({ min: Object.freeze(aabb.min), max: Object.freeze(aabb.max) }),
        layer: config.collisionLayer,
        mask: config.collisionMask,
      });
    });
  const wrap = (bodies: readonly Collider[]): PhysicsWorld =>
    bodies.length === 0
      ? world
      : Object.freeze({
          querySolids: (bounds: WorldAabb) => [
            ...world.querySolids(bounds),
            ...bodies.filter((body) => intersects(bounds, body.aabb)),
          ],
          ...(world.sampleFluid ? { sampleFluid: (bounds: WorldAabb) => world.sampleFluid!(bounds) } : {}),
        });
  const all = wrap(colliders);
  const transportIds = new Set(colliders.map(({ id }) => id));
  return Object.freeze({
    all,
    forEntity: (id: string) =>
      transportIds.has(`transport:${id}`) ? wrap(colliders.filter((body) => body.id !== `transport:${id}`)) : all,
  });
}
