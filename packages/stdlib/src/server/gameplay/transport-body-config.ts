import { CollisionLayer } from '../../physics/body-registry';
import type { BodyConfig } from '../../physics';
import type { TransportDefinitionV1 } from './modules/transport-model';

/** Deployed transports keep their canonical pose until the registered motion owner advances them. */
export const transportBodyConfig = (definition: TransportDefinitionV1): BodyConfig =>
  Object.freeze({
    localAabb: definition.bodyAabb,
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
