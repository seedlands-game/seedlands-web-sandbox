import { CollisionLayer } from '../../physics/body-registry';
import type { BodyConfig, WorldAabb } from '../../physics';
import type { TransportDefinitionV1 } from './modules/transport-model';

/** Conservative world-axis bounds of the local definition after its canonical yaw rotation. */
const rotatedAabb = (aabb: WorldAabb, yaw: number): WorldAabb => {
  if (!Number.isFinite(yaw)) throw new TypeError('Transport body yaw must be finite.');
  if (yaw === 0) return aabb;
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  const corners = [aabb.min.x, aabb.max.x].flatMap((x) =>
    [aabb.min.z, aabb.max.z].map((z) => ({ x: x * cosine + z * sine, z: -x * sine + z * cosine })),
  );
  return Object.freeze({
    min: Object.freeze({
      x: Math.min(...corners.map(({ x }) => x)),
      y: aabb.min.y,
      z: Math.min(...corners.map(({ z }) => z)),
    }),
    max: Object.freeze({
      x: Math.max(...corners.map(({ x }) => x)),
      y: aabb.max.y,
      z: Math.max(...corners.map(({ z }) => z)),
    }),
  });
};

/** Deployed transports keep their canonical pose until the registered motion owner advances them. */
export const transportBodyConfig = (definition: TransportDefinitionV1, yaw = 0): BodyConfig =>
  Object.freeze({
    localAabb: rotatedAabb(definition.bodyAabb, yaw),
    collisionLayer: CollisionLayer.Character,
    collisionMask: CollisionLayer.World | CollisionLayer.Character,
    pushable: false,
    gravity: 0,
    terminalVelocity: 0,
    maxHorizontalSpeed: 0,
    groundAcceleration: 0,
    airAcceleration: 0,
    swimAcceleration: 0,
    buoyancy: 0,
    fluidDrag: 0,
  });
