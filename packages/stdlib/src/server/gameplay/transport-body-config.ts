import { CollisionLayer } from '../../physics/body-registry';
import type { BodyConfig } from '../../physics';
import { orientedBox, orientedBoxBounds } from '../../physics';
import type { TransportDefinitionV1 } from './modules/transport-model';

/** Deployed transports keep their canonical pose until the registered motion owner advances them. */
export const transportBodyConfig = (definition: TransportDefinitionV1, yaw = 0, inclination = 0): BodyConfig =>
  Object.freeze({
    localAabb:
      yaw === 0 && inclination === 0
        ? definition.bodyAabb
        : orientedBoxBounds(orientedBox(definition.bodyAabb, { x: 0, y: 0, z: 0 }, yaw, inclination)),
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
