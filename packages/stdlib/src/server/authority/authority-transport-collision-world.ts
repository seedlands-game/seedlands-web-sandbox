import { bodyWorldAabb, type BodyConfig, type Collider, type PhysicsWorld, type WorldAabb } from '../../physics';
import type { MountedSeatConstraintV1 } from '../gameplay/modules/transport-motion-model';
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
  mountedSeats: readonly MountedSeatConstraintV1[] = [],
): Readonly<{ all: PhysicsWorld; forEntity: (id: string) => PhysicsWorld }> {
  const seats = new Map(mountedSeats.map((seat) => [seat.rider.entityId, seat]));
  const colliders = entities
    .filter((entity) => entity.type === 'transport' || seats.has(entity.id))
    .map((entity): Collider => {
      const config = bodyConfigFor(entity);
      const [x, y, z] = seats.get(entity.id)?.pose.position ?? entity.position;
      const aabb = bodyWorldAabb({ position: { x, y, z }, velocity: { x: 0, y: 0, z: 0 } }, config);
      return Object.freeze({
        id: `${entity.type === 'transport' ? 'transport' : 'mounted'}:${entity.id}`,
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

  return Object.freeze({
    all,
    forEntity: (id: string) =>
      colliders.some((body) => body.id === `transport:${id}` || body.id === `mounted:${id}`)
        ? wrap(colliders.filter((body) => body.id !== `transport:${id}` && body.id !== `mounted:${id}`))
        : all,
  });
}
