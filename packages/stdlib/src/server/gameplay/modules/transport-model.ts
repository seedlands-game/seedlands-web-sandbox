import type { WorldAabb } from '../../../physics/types';
import type { EntityLifetimeReference, EntityLifetimeSnapshot } from '../ecs-entity-owner';
import { isItemId, type ItemStack } from '../item-registry';

const NAMESPACE_ID = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
const MAX_DEFINITIONS = 256;
const MAX_TRANSPORTS = 4_096;
const MAX_INVENTORY_CAPACITY = 64;
const MAX_FUEL = 1_000_000_000;
const ROUTE_SIDES = ['north', 'east', 'south', 'west'] as const;

export type TransportLocomotionV1 = Readonly<{ provider: 'route' | 'surface'; providerId: string }>;

export type TransportDefinitionV1 = Readonly<{
  version: 1;
  id: string;
  locomotion: TransportLocomotionV1;
  bodyAabb: WorldAabb;
  seatOffset: readonly [number, number, number];
  fuelCapacity: number | null;
  inventoryCapacity: number | null;
  presentationId: string;
}>;

export type TransportDefinitionRegistryV1 = Readonly<{
  get(id: string): TransportDefinitionV1 | undefined;
  require(id: string): TransportDefinitionV1;
  list(): readonly TransportDefinitionV1[];
}>;

export type TransportRouteCursorV2 = Readonly<{
  family: string;
  cell: readonly [number, number, number];
  variant: string;
  entry: Readonly<{ side: (typeof ROUTE_SIDES)[number]; elevation: -1 | 0 | 1 }>;
  exit: Readonly<{ side: (typeof ROUTE_SIDES)[number]; elevation: -1 | 0 | 1 }>;
  progress: number;
  segmentLength: number;
}>;

export type TransportStateV2 = Readonly<{
  version: 2;
  reference: EntityLifetimeReference;
  definitionId: string;
  pose: Readonly<{ position: readonly [number, number, number]; yaw: number }>;
  velocity: readonly [number, number, number];
  routeCursor: TransportRouteCursorV2 | null;
  rider: EntityLifetimeReference | null;
  fuel: number | null;
  inventory: readonly (Readonly<ItemStack> | null)[];
}>;

export type TransportCheckpointV2 = Readonly<{
  version: 2;
  sequence: number;
  transports: readonly TransportStateV2[];
}>;

/** Canonical component fields; transform, velocity and volatile epoch belong to the ECS owner. */
export type TransportComponentV1 = Readonly<{
  version: 1;
  entityId: string;
  revision: number;
  definitionId: string;
  yaw: number;
  routeCursor: TransportRouteCursorV2 | null;
  rider: EntityLifetimeSnapshot | null;
  fuel: number | null;
  inventory: readonly (Readonly<ItemStack> | null)[];
}>;

export type LegacyTransportStateV1 = Readonly<{
  id: string;
  kind: string;
  position: readonly number[];
  velocity: number;
  heading: readonly number[];
  riderId: string | null;
  fuelSeconds: number;
  inventory: readonly unknown[];
}>;

export type LegacyTransportCheckpointV1 = Readonly<{
  version: 1;
  sequence: number;
  vehicles: readonly LegacyTransportStateV1[];
}>;

export type TransportDefinitionInputV1 = Readonly<{
  version: 1;
  id: string;
  locomotion: TransportLocomotionV1;
  bodyAabb: WorldAabb;
  seatOffset: readonly number[];
  fuelCapacity?: number | null;
  inventoryCapacity?: number | null;
  presentationId: string;
}>;

const namespaced = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !NAMESPACE_ID.test(value))
    throw new TypeError(`${label} must be namespace-qualified.`);
  return value;
};

const finiteTuple = (value: unknown, label: string): readonly [number, number, number] => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite))
    throw new TypeError(`${label} is invalid.`);
  return Object.freeze([value[0], value[1], value[2]]);
};

const finiteVector = (value: unknown, label: string): Readonly<{ x: number; y: number; z: number }> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} is invalid.`);
  const vector = value as Record<string, unknown>;
  if (
    Object.keys(vector).length !== 3 ||
    !Number.isFinite(vector.x) ||
    !Number.isFinite(vector.y) ||
    !Number.isFinite(vector.z)
  )
    throw new TypeError(`${label} is invalid.`);
  return Object.freeze({ x: vector.x as number, y: vector.y as number, z: vector.z as number });
};

const integerTuple = (value: unknown, label: string): readonly [number, number, number] => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isSafeInteger))
    throw new TypeError(`${label} is invalid.`);
  return Object.freeze([value[0], value[1], value[2]]);
};

const finiteAabb = (value: unknown, label: string): WorldAabb => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} is invalid.`);
  const source = value as { min?: unknown; max?: unknown };
  const min = finiteVector(source.min, `${label} minimum`);
  const max = finiteVector(source.max, `${label} maximum`);
  if (min.x >= max.x || min.y >= max.y || min.z >= max.z) throw new TypeError(`${label} is invalid.`);
  return Object.freeze({ min, max });
};

const optionalCapacity = (value: unknown, maximum: number, label: string): number | null => {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > maximum)
    throw new TypeError(`${label} is invalid.`);
  return value as number;
};

export function defineTransportV1(input: TransportDefinitionInputV1): TransportDefinitionV1 {
  if (!input || input.version !== 1) throw new TypeError('Transport definition version is invalid.');
  if (
    !input.locomotion ||
    !['route', 'surface'].includes(input.locomotion.provider) ||
    typeof input.locomotion.providerId !== 'string'
  )
    throw new TypeError('Transport locomotion provider is invalid.');
  return Object.freeze({
    version: 1,
    id: namespaced(input.id, 'Transport definition id'),
    locomotion: Object.freeze({
      provider: input.locomotion.provider,
      providerId: namespaced(input.locomotion.providerId, 'Transport locomotion provider id'),
    }),
    bodyAabb: finiteAabb(input.bodyAabb, 'Transport body AABB'),
    seatOffset: finiteTuple(input.seatOffset, 'Transport seat offset'),
    fuelCapacity: optionalCapacity(input.fuelCapacity, MAX_FUEL, 'Transport fuel capacity'),
    inventoryCapacity: optionalCapacity(
      input.inventoryCapacity,
      MAX_INVENTORY_CAPACITY,
      'Transport inventory capacity',
    ),
    presentationId: namespaced(input.presentationId, 'Transport presentation id'),
  });
}

export function createTransportDefinitionRegistryV1(
  inputs: readonly TransportDefinitionInputV1[],
): TransportDefinitionRegistryV1 {
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > MAX_DEFINITIONS)
    throw new TypeError('Transport definitions are invalid.');
  const byId = new Map<string, TransportDefinitionV1>();
  for (const input of inputs) {
    const definition = defineTransportV1(input);
    if (byId.has(definition.id)) throw new TypeError(`Duplicate transport definition: ${definition.id}`);
    byId.set(definition.id, definition);
  }
  const definitions = Object.freeze([...byId.values()].sort((left, right) => left.id.localeCompare(right.id)));
  return Object.freeze({
    get: (id: string) => byId.get(id),
    require: (id: string) => {
      const definition = byId.get(id);
      if (!definition) throw new RangeError(`Unknown transport definition: ${id}`);
      return definition;
    },
    list: () => definitions,
  });
}

const lifetimeReference = (raw: unknown, label: string): EntityLifetimeReference => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError(`${label} is invalid.`);
  const value = raw as Record<string, unknown>;
  if (
    Object.keys(value).length !== 3 ||
    typeof value.entityId !== 'string' ||
    !value.entityId.trim() ||
    !Number.isSafeInteger(value.epoch) ||
    (value.epoch as number) <= 0 ||
    !Number.isSafeInteger(value.lifetime) ||
    (value.lifetime as number) <= 0
  )
    throw new TypeError(`${label} is invalid.`);
  return Object.freeze({
    entityId: value.entityId,
    epoch: value.epoch as number,
    lifetime: value.lifetime as number,
  });
};

const exactKeys = (value: Record<string, unknown>, expected: readonly string[], label: string): void => {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key)))
    throw new TypeError(`${label} fields are invalid.`);
};

const referenceKey = (reference: EntityLifetimeReference): string => `${reference.epoch}:${reference.lifetime}`;
const routeEndpoint = (raw: unknown, label: string): TransportRouteCursorV2['entry'] => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError(`${label} is invalid.`);
  const value = raw as Record<string, unknown>;
  exactKeys(value, ['side', 'elevation'], label);
  if (
    Object.keys(value).length !== 2 ||
    !ROUTE_SIDES.includes(value.side as (typeof ROUTE_SIDES)[number]) ||
    !Number.isSafeInteger(value.elevation) ||
    (value.elevation as number) < -1 ||
    (value.elevation as number) > 1
  )
    throw new TypeError(`${label} is invalid.`);
  return Object.freeze({
    side: value.side as (typeof ROUTE_SIDES)[number],
    elevation: value.elevation as -1 | 0 | 1,
  });
};

const routeCursor = (raw: unknown, definition: TransportDefinitionV1): TransportRouteCursorV2 | null => {
  if (definition.locomotion.provider === 'surface') {
    if (raw !== null) throw new TypeError('Surface transport must not have a route cursor.');
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new TypeError('Route transport requires a route cursor.');
  const value = raw as Record<string, unknown>;
  if (
    Object.keys(value).length !== 7 ||
    value.family !== definition.locomotion.providerId ||
    typeof value.variant !== 'string' ||
    !NAMESPACE_ID.test(value.variant) ||
    !Number.isFinite(value.progress) ||
    !Number.isFinite(value.segmentLength) ||
    (value.segmentLength as number) <= 0 ||
    (value.progress as number) < 0 ||
    (value.progress as number) > (value.segmentLength as number)
  )
    throw new TypeError('Transport route cursor is invalid.');
  const entry = routeEndpoint(value.entry, 'Transport route cursor entry');
  const exit = routeEndpoint(value.exit, 'Transport route cursor exit');
  if (entry.side === exit.side && entry.elevation === exit.elevation)
    throw new TypeError('Transport route cursor endpoints must differ.');
  return Object.freeze({
    family: value.family as string,
    cell: integerTuple(value.cell, 'Transport route cursor cell'),
    variant: value.variant,
    entry,
    exit,
    progress: value.progress as number,
    segmentLength: value.segmentLength as number,
  });
};

const itemStack = (raw: unknown, label: string): Readonly<ItemStack> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError(`${label} is invalid.`);
  const value = raw as Record<string, unknown>;
  exactKeys(
    value,
    ['itemId', 'count', 'instance'].filter((key) => key !== 'instance' || value.instance !== undefined),
    label,
  );
  if (
    typeof value.itemId !== 'string' ||
    !isItemId(value.itemId) ||
    !Number.isSafeInteger(value.count) ||
    (value.count as number) <= 0
  )
    throw new TypeError(`${label} is invalid.`);
  if (value.instance !== undefined) {
    if (
      !value.instance ||
      typeof value.instance !== 'object' ||
      Array.isArray(value.instance) ||
      !Number.isSafeInteger((value.instance as { durability?: unknown }).durability) ||
      ((value.instance as { durability: number }).durability as number) <= 0
    )
      throw new TypeError(`${label} instance is invalid.`);
  }
  return Object.freeze({
    itemId: value.itemId,
    count: value.count as number,
    ...(value.instance
      ? { instance: Object.freeze({ durability: (value.instance as { durability: number }).durability }) }
      : {}),
  });
};

const inventory = (raw: unknown, definition: TransportDefinitionV1): readonly (Readonly<ItemStack> | null)[] => {
  const capacity = definition.inventoryCapacity ?? 0;
  if (!Array.isArray(raw) || raw.length !== capacity) throw new TypeError('Transport inventory capacity is invalid.');
  return Object.freeze(
    raw.map((slot, index) => (slot === null ? null : itemStack(slot, `Transport inventory slot ${index}`))),
  );
};

const fuel = (raw: unknown, definition: TransportDefinitionV1): number | null => {
  if (definition.fuelCapacity === null) {
    if (raw !== null) throw new TypeError('Transport without fuel capacity must have null fuel.');
    return null;
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > definition.fuelCapacity)
    throw new TypeError('Transport fuel is invalid.');
  return raw;
};

export function validateTransportComponentV1(
  raw: unknown,
  definitions: TransportDefinitionRegistryV1,
): TransportComponentV1 {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Transport component is invalid.');
  const value = raw as Record<string, unknown>;
  exactKeys(
    value,
    ['version', 'entityId', 'revision', 'definitionId', 'yaw', 'routeCursor', 'rider', 'fuel', 'inventory'],
    'Transport component',
  );
  if (
    value.version !== 1 ||
    typeof value.entityId !== 'string' ||
    !value.entityId.trim() ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    typeof value.definitionId !== 'string' ||
    !Number.isFinite(value.yaw)
  )
    throw new TypeError('Transport component identity or revision is invalid.');
  const definition = definitions.require(value.definitionId);
  let rider: EntityLifetimeSnapshot | null = null;
  if (value.rider !== null) {
    if (!value.rider || typeof value.rider !== 'object' || Array.isArray(value.rider))
      throw new TypeError('Transport component rider is invalid.');
    const source = value.rider as Record<string, unknown>;
    exactKeys(source, ['entityId', 'lifetime'], 'Transport component rider');
    if (
      typeof source.entityId !== 'string' ||
      !source.entityId.trim() ||
      source.entityId === value.entityId ||
      !Number.isSafeInteger(source.lifetime) ||
      (source.lifetime as number) <= 0
    )
      throw new TypeError('Transport component rider is invalid.');
    rider = Object.freeze({ entityId: source.entityId, lifetime: source.lifetime as number });
  }
  return Object.freeze({
    version: 1,
    entityId: value.entityId,
    revision: value.revision as number,
    definitionId: definition.id,
    yaw: value.yaw as number,
    routeCursor: routeCursor(value.routeCursor, definition),
    rider,
    fuel: fuel(value.fuel, definition),
    inventory: inventory(value.inventory, definition),
  });
}

const stateV2 = (raw: unknown, definitions: TransportDefinitionRegistryV1): TransportStateV2 => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Transport state is invalid.');
  const value = raw as Record<string, unknown>;
  exactKeys(
    value,
    ['version', 'reference', 'definitionId', 'pose', 'velocity', 'routeCursor', 'rider', 'fuel', 'inventory'],
    'Transport state',
  );
  if (value.version !== 2 || typeof value.definitionId !== 'string')
    throw new TypeError('Transport state version or definition is invalid.');
  const definition = definitions.require(value.definitionId);
  if (!value.pose || typeof value.pose !== 'object' || Array.isArray(value.pose))
    throw new TypeError('Transport pose is invalid.');
  const pose = value.pose as Record<string, unknown>;
  if (Object.keys(pose).length !== 2 || !Number.isFinite(pose.yaw)) throw new TypeError('Transport pose is invalid.');
  return Object.freeze({
    version: 2,
    reference: lifetimeReference(value.reference, 'Transport lifetime reference'),
    definitionId: definition.id,
    pose: Object.freeze({
      position: finiteTuple(pose.position, 'Transport pose position'),
      yaw: pose.yaw as number,
    }),
    velocity: finiteTuple(value.velocity, 'Transport velocity'),
    routeCursor: routeCursor(value.routeCursor, definition),
    rider: value.rider === null ? null : lifetimeReference(value.rider, 'Transport rider lifetime reference'),
    fuel: fuel(value.fuel, definition),
    inventory: inventory(value.inventory, definition),
  });
};

export function validateTransportCheckpointV2(
  raw: unknown,
  definitions: TransportDefinitionRegistryV1,
): TransportCheckpointV2 {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Transport checkpoint is invalid.');
  const value = raw as Record<string, unknown>;
  exactKeys(value, ['version', 'sequence', 'transports'], 'Transport checkpoint');
  if (
    value.version !== 2 ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 0 ||
    !Array.isArray(value.transports) ||
    value.transports.length > MAX_TRANSPORTS
  )
    throw new TypeError('Transport checkpoint is invalid.');
  const ids = new Set<string>();
  const lifetimes = new Set<string>();
  const riders = new Set<string>();
  const riderIds = new Set<string>();
  const transports = value.transports.map((entry) => {
    const state = stateV2(entry, definitions);
    const lifetime = referenceKey(state.reference);
    if (ids.has(state.reference.entityId) || lifetimes.has(lifetime))
      throw new TypeError('Transport checkpoint contains a duplicate vehicle or lifetime.');
    ids.add(state.reference.entityId);
    lifetimes.add(lifetime);
    if (state.rider) {
      const rider = referenceKey(state.rider);
      if (state.reference.entityId === state.rider.entityId) throw new TypeError('Transport cannot ride itself.');
      if (riders.has(rider) || riderIds.has(state.rider.entityId))
        throw new TypeError('Transport checkpoint assigns one rider to multiple transports.');
      riders.add(rider);
      riderIds.add(state.rider.entityId);
    }
    return state;
  });
  return Object.freeze({
    version: 2,
    sequence: value.sequence as number,
    transports: Object.freeze(
      transports.sort((left, right) => left.reference.entityId.localeCompare(right.reference.entityId)),
    ),
  });
}

export function migrateLegacyTransportCheckpointV1(
  raw: LegacyTransportCheckpointV1,
  options: Readonly<{
    definitions: TransportDefinitionRegistryV1;
    definitionIdForKind(kind: string): string | null;
    referenceForEntity(entityId: string): EntityLifetimeReference | null;
    routeCursorForState?(
      state: LegacyTransportStateV1,
      definition: TransportDefinitionV1,
    ): TransportRouteCursorV2 | null;
  }>,
): TransportCheckpointV2 {
  if (
    !raw ||
    raw.version !== 1 ||
    !Number.isSafeInteger(raw.sequence) ||
    raw.sequence < 0 ||
    !Array.isArray(raw.vehicles)
  )
    throw new TypeError('Legacy transport checkpoint is invalid.');
  const transports = raw.vehicles.map((legacy) => {
    if (
      !legacy ||
      typeof legacy.id !== 'string' ||
      !legacy.id.trim() ||
      typeof legacy.kind !== 'string' ||
      !legacy.kind.trim() ||
      !Array.isArray(legacy.heading) ||
      legacy.heading.length !== 2 ||
      !legacy.heading.every(Number.isFinite) ||
      Math.hypot(legacy.heading[0]!, legacy.heading[1]!) === 0 ||
      !Number.isFinite(legacy.velocity) ||
      legacy.velocity < 0 ||
      !Number.isFinite(legacy.fuelSeconds) ||
      legacy.fuelSeconds < 0 ||
      (legacy.riderId !== null && (typeof legacy.riderId !== 'string' || !legacy.riderId.trim()))
    )
      throw new TypeError('Legacy transport state is invalid.');
    const definitionId = options.definitionIdForKind(legacy.kind);
    if (!definitionId) throw new TypeError(`Unknown legacy transport kind: ${legacy.kind}`);
    const definition = options.definitions.require(definitionId);
    if (definition.fuelCapacity === null && legacy.fuelSeconds !== 0)
      throw new TypeError(`Legacy transport fuel is incompatible with definition: ${definition.id}`);
    const reference = options.referenceForEntity(legacy.id);
    if (!reference) throw new TypeError(`Legacy transport lifetime is missing: ${legacy.id}`);
    const rider = legacy.riderId === null ? null : options.referenceForEntity(legacy.riderId);
    if (legacy.riderId !== null && !rider) throw new TypeError(`Legacy transport rider is stale: ${legacy.riderId}`);
    const headingLength = Math.hypot(legacy.heading[0]!, legacy.heading[1]!);
    const route = options.routeCursorForState?.(legacy, definition) ?? null;
    return {
      version: 2 as const,
      reference,
      definitionId,
      pose: {
        position: finiteTuple(legacy.position, 'Legacy transport position'),
        yaw: Math.atan2(legacy.heading[0]!, legacy.heading[1]!),
      },
      velocity: [
        (legacy.heading[0]! / headingLength) * legacy.velocity,
        0,
        (legacy.heading[1]! / headingLength) * legacy.velocity,
      ],
      routeCursor: route,
      rider,
      fuel: definition.fuelCapacity === null ? null : legacy.fuelSeconds,
      inventory: legacy.inventory,
    };
  });
  return validateTransportCheckpointV2({ version: 2, sequence: raw.sequence, transports }, options.definitions);
}
