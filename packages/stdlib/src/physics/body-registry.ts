import { validateBodyConfig } from './geometry';
import type { BodyConfig } from './types';

export const CollisionLayer = Object.freeze({
  World: 1,
  Character: 2,
  Item: 4,
  PickupSensor: 8,
});

export type BodyKind =
  | 'player'
  | 'world-item'
  | 'falling-block'
  | 'painting'
  | 'grazer'
  | 'night-stalker'
  | 'settler'
  | 'chicken'
  | 'cow'
  | 'pig'
  | 'pig-zombie'
  | 'sheep'
  | 'squid'
  | 'wolf'
  | 'zombie'
  | 'skeleton'
  | 'spider'
  | 'creeper'
  | 'slime';
export type BodySensorPurpose = 'attraction' | 'pickup';
export type BodySensorConfig = Readonly<{ purpose: BodySensorPurpose; shape: 'sphere'; radius: number }>;

export const WORLD_ITEM_INTERACTION = Object.freeze({
  attractionRadius: 2.25,
  attractionSpeed: 6,
  pickupRadius: 0.75,
});

const radialSensor = (purpose: BodySensorPurpose, radius: number): BodySensorConfig => ({
  purpose,
  shape: 'sphere',
  radius,
});

const worldItemSensors: readonly BodySensorConfig[] = Object.freeze([
  radialSensor('attraction', WORLD_ITEM_INTERACTION.attractionRadius),
  radialSensor('pickup', WORLD_ITEM_INTERACTION.pickupRadius),
]);

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
  'falling-block': {
    localAabb: { min: { x: -0.49, y: 0, z: -0.49 }, max: { x: 0.49, y: 0.98, z: 0.49 } },
    collisionLayer: CollisionLayer.Item,
    collisionMask: CollisionLayer.World,
    gravity: 18,
    terminalVelocity: 24,
    maxHorizontalSpeed: 0,
    groundAcceleration: 0,
    airAcceleration: 0,
    buoyancy: 0,
    fluidDrag: 0,
  },
  painting: {
    localAabb: { min: { x: -0.5, y: 0, z: -0.05 }, max: { x: 0.5, y: 1, z: 0.05 } },
    collisionLayer: CollisionLayer.Item,
    collisionMask: CollisionLayer.World,
    gravity: 0,
    terminalVelocity: 0,
    maxHorizontalSpeed: 0,
    groundAcceleration: 0,
    airAcceleration: 0,
    buoyancy: 0,
    fluidDrag: 0,
  },
  grazer: character(0.75, 1.9, 2.1),
  'night-stalker': character(0.65, 2.1, 2.8),
  settler: character(0.65, 2.35, 2.2),
  chicken: character(0.3, 0.7, 1.8),
  cow: character(0.7, 1.4, 2),
  pig: character(0.55, 1, 2),
  'pig-zombie': character(0.3, 1.8, 2.3),
  sheep: character(0.55, 1.3, 2),
  squid: character(0.45, 0.9, 1.4),
  wolf: character(0.4, 0.9, 2.4),
  zombie: character(0.3, 1.8, 2.3),
  skeleton: character(0.3, 1.8, 2.4),
  spider: character(0.7, 0.9, 2.8),
  creeper: character(0.3, 1.7, 2.3),
  slime: character(0.5, 1, 2),
});

for (const config of Object.values(configs))
  if (!validateBodyConfig(config)) throw new TypeError('Body registry contains an invalid body configuration.');

export function bodyConfigFor(kind: BodyKind): BodyConfig {
  const config = configs[kind];
  if (!config) throw new RangeError(`Unknown body kind: ${String(kind)}`);
  return config;
}

export function bodySensorsFor(kind: BodyKind): readonly BodySensorConfig[] {
  return kind === 'world-item' ? worldItemSensors : [];
}

export function bodyKindForEntity(entity: { type: string; archetype?: string }): BodyKind {
  if (
    entity.type === 'player' ||
    entity.type === 'world-item' ||
    entity.type === 'falling-block' ||
    entity.type === 'painting'
  )
    return entity.type;
  if (entity.type === 'creature')
    return entity.archetype !== 'settler' && Object.hasOwn(configs, entity.archetype ?? '')
      ? (entity.archetype as BodyKind)
      : 'grazer';
  if (entity.type === 'npc') return 'settler';
  throw new RangeError(`Entity has no registered body: ${entity.type}:${String(entity.archetype)}`);
}
