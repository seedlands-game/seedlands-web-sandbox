import { validateBodyConfig } from './geometry';
import type { BodyConfig } from './types';

export const CollisionLayer = Object.freeze({
  World: 1,
  Character: 2,
  Item: 4,
  PickupSensor: 8,
});

export type BodyKind = 'player' | 'world-item' | 'grazer' | 'night-stalker' | 'settler';

const character = (halfWidth: number, height: number, maxHorizontalSpeed: number): BodyConfig => ({
  localAabb: {
    min: { x: -halfWidth, y: 0, z: -halfWidth },
    max: { x: halfWidth, y: height, z: halfWidth },
  },
  collisionLayer: CollisionLayer.Character,
  collisionMask: CollisionLayer.World | CollisionLayer.Character,
  gravity: 18,
  terminalVelocity: 24,
  maxHorizontalSpeed,
  groundAcceleration: 50,
  airAcceleration: 20,
  jumpSpeed: 6.5,
  waterSurfaceJumpSpeed: 6.5,
  buoyancy: 1,
  fluidDrag: 6,
  swimAcceleration: 12,
});

const configs: Readonly<Record<BodyKind, BodyConfig>> = Object.freeze({
  player: character(0.32, 1.8, 4.5),
  'world-item': {
    localAabb: { min: { x: -0.2, y: 0, z: -0.2 }, max: { x: 0.2, y: 0.4, z: 0.2 } },
    collisionLayer: CollisionLayer.Item,
    collisionMask: CollisionLayer.World,
    gravity: 18,
    terminalVelocity: 24,
    maxHorizontalSpeed: 6,
    groundAcceleration: 20,
    airAcceleration: 8,
    buoyancy: 0.7,
    fluidDrag: 7,
    maxExternalAcceleration: 60,
  },
  grazer: character(0.75, 1.9, 2.1),
  'night-stalker': character(0.65, 2.1, 2.8),
  settler: character(0.65, 2.35, 2.2),
});

for (const config of Object.values(configs))
  if (!validateBodyConfig(config)) throw new TypeError('Body registry contains an invalid body configuration.');

export function bodyConfigFor(kind: BodyKind): BodyConfig {
  const config = configs[kind];
  if (!config) throw new RangeError(`Unknown body kind: ${String(kind)}`);
  return config;
}

export function bodyKindForEntity(entity: { type: string; archetype?: string }): BodyKind {
  if (entity.type === 'player' || entity.type === 'world-item') return entity.type;
  if (entity.type === 'creature' && (entity.archetype === 'grazer' || entity.archetype === 'night-stalker'))
    return entity.archetype;
  if (entity.type === 'npc' && entity.archetype === 'settler') return 'settler';
  throw new RangeError(`Entity has no registered body: ${entity.type}:${String(entity.archetype)}`);
}
