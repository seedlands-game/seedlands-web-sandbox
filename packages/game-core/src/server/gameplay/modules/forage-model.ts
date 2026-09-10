import type { EntityLifetimeReference } from '../entity-store';
import type { ItemDefinitionRegistry, ItemStack } from '../item-registry';
import { cloneItemStack } from '../item-instance';

export const FORAGE_MODULE_ID = 'seedlands:forage-module';
export const FORAGE_CAPABILITY = 'seedlands:forage';
export const FORAGE_WORLD_COMPONENT = 'seedlands:forage-world';
export const FORAGE_RESOURCE = 'seedlands.forage-clock';
export const FORAGE_ADVANCE_OPERATION = 'seedlands:forage-advance';
export const FORAGE_SYSTEM = 'seedlands:forage-system';

export const FORAGE_HORIZONTAL_RADIUS = 4;
export const FORAGE_VERTICAL_MIN = 0;
export const FORAGE_VERTICAL_MAX = 8;
export const FORAGE_OCCUPANCY_RADIUS = 1.5;
export const FORAGE_MAX_DROPS = 16;

export type ForageModuleConfiguration = Readonly<{
  sourceVoxel: number;
  drop: ItemStack;
  intervalSeconds: number;
}>;

export type ForageObserverProjectionV1 = Readonly<{
  reference: EntityLifetimeReference;
  position: readonly [number, number, number];
}>;

export type ForageSourceProjectionV1 = Readonly<{
  observerId: string;
  position: readonly [number, number, number];
}>;

export type ForageWorldProjectionV1 = Readonly<{
  version: 1;
  observers: readonly ForageObserverProjectionV1[];
  sources: readonly ForageSourceProjectionV1[];
}>;

export type ForageDropCandidateV1 = Readonly<{
  observerReference: EntityLifetimeReference;
  source: readonly [number, number, number];
  position: readonly [number, number, number];
  stack: ItemStack;
}>;

export type ForageCandidateV1 = Readonly<{
  version: 1;
  kind: 'forage-spawn';
  drops: readonly ForageDropCandidateV1[];
}>;

export const forageWorldAddress = () => ({
  componentId: FORAGE_WORLD_COMPONENT,
  target: { kind: 'world' as const },
});

export function forageSeconds(raw: unknown, configuration: ForageModuleConfiguration): number {
  const value = raw as { seconds?: unknown } | null;
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).some((entry) => entry !== 'seconds') ||
    value.seconds !== configuration.intervalSeconds
  )
    throw new TypeError('Forage maturity step must match its configured interval.');
  return configuration.intervalSeconds;
}

const position = (raw: unknown, label: string, integer: boolean): readonly [number, number, number] => {
  if (!Array.isArray(raw) || raw.length !== 3 || !raw.every(Number.isFinite))
    throw new TypeError(`Forage ${label} is invalid.`);
  if (integer && !raw.every(Number.isSafeInteger)) throw new TypeError(`Forage ${label} must contain safe integers.`);
  return [raw[0], raw[1], raw[2]];
};

const reference = (raw: unknown): EntityLifetimeReference => {
  const value = raw as Partial<EntityLifetimeReference> | null;
  if (
    !value ||
    typeof value.entityId !== 'string' ||
    !value.entityId.trim() ||
    !Number.isSafeInteger(value.epoch) ||
    value.epoch! <= 0 ||
    !Number.isSafeInteger(value.lifetime) ||
    value.lifetime! <= 0
  )
    throw new TypeError('Forage observer reference is invalid.');
  return { entityId: value.entityId, epoch: value.epoch, lifetime: value.lifetime } as EntityLifetimeReference;
};

export function validateForageConfiguration(
  raw: ForageModuleConfiguration,
  items?: ItemDefinitionRegistry,
): ForageModuleConfiguration {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !Number.isSafeInteger(raw.sourceVoxel) ||
    raw.sourceVoxel <= 0 ||
    typeof raw.intervalSeconds !== 'number' ||
    !Number.isFinite(raw.intervalSeconds) ||
    raw.intervalSeconds <= 0
  )
    throw new TypeError('Forage configuration is invalid.');
  const intervalUnits = Math.round(raw.intervalSeconds * 1e9);
  if (!Number.isSafeInteger(intervalUnits) || intervalUnits <= 0 || intervalUnits / 1e9 !== raw.intervalSeconds)
    throw new RangeError('Forage interval exceeds logical schedule precision or range.');
  const drop = items ? items.normalizeStack(raw.drop) : raw.drop;
  if (
    !drop ||
    typeof drop.itemId !== 'string' ||
    !drop.itemId.trim() ||
    !Number.isSafeInteger(drop.count) ||
    drop.count <= 0
  )
    throw new TypeError('Forage drop is invalid.');
  if (items) {
    const definition = items.require(drop.itemId);
    if (definition.itemType !== 'food' || !items.capability(drop.itemId, 'consume'))
      throw new TypeError('Forage drop must reference consumable food content.');
  }
  return Object.freeze({
    sourceVoxel: raw.sourceVoxel,
    drop: Object.freeze({ ...drop }),
    intervalSeconds: raw.intervalSeconds,
  });
}

export function validateForageWorldProjection(raw: unknown): ForageWorldProjectionV1 {
  const value = raw as Partial<ForageWorldProjectionV1> | null;
  if (!value || value.version !== 1 || !Array.isArray(value.observers) || !Array.isArray(value.sources))
    throw new TypeError('Forage world projection is invalid.');
  if (value.observers.length > 128 || value.sources.length > FORAGE_MAX_DROPS)
    throw new RangeError('Forage projection exceeds its bounded membership.');
  const observers = value.observers.map((rawObserver) => ({
    reference: reference(rawObserver?.reference),
    position: position(rawObserver?.position, 'observer position', false),
  }));
  const byId = new Map<string, ForageObserverProjectionV1>();
  let previous = '';
  for (const observer of observers) {
    if (observer.reference.entityId <= previous || byId.has(observer.reference.entityId))
      throw new TypeError('Forage observers must be unique and sorted.');
    previous = observer.reference.entityId;
    byId.set(observer.reference.entityId, observer);
  }
  const seen = new Set<string>();
  const sources = value.sources.map((rawSource) => {
    if (!rawSource || typeof rawSource.observerId !== 'string' || !byId.has(rawSource.observerId))
      throw new TypeError('Forage source observer is invalid.');
    const source = position(rawSource.position, 'source position', true);
    const sourceKey = source.join(',');
    if (seen.has(sourceKey)) throw new TypeError('Forage source positions must be unique.');
    seen.add(sourceKey);
    const observer = byId.get(rawSource.observerId)!;
    const feetY = Math.floor(observer.position[1]);
    if (
      Math.abs(source[0] - Math.floor(observer.position[0])) > FORAGE_HORIZONTAL_RADIUS ||
      Math.abs(source[2] - Math.floor(observer.position[2])) > FORAGE_HORIZONTAL_RADIUS ||
      source[1] < feetY + FORAGE_VERTICAL_MIN ||
      source[1] > feetY + FORAGE_VERTICAL_MAX
    )
      throw new TypeError('Forage source lies outside its observer window.');
    return { observerId: rawSource.observerId, position: source };
  });
  return { version: 1, observers, sources };
}

export function buildForageCandidate(raw: unknown, configuration: ForageModuleConfiguration): ForageCandidateV1 {
  const projection = validateForageWorldProjection(raw);
  const config = validateForageConfiguration(configuration);
  const observers = new Map(projection.observers.map((observer) => [observer.reference.entityId, observer]));
  return {
    version: 1,
    kind: 'forage-spawn',
    drops: projection.sources.map(({ observerId, position: source }) => ({
      observerReference: { ...observers.get(observerId)!.reference },
      source: [...source] as [number, number, number],
      position: [source[0] + 0.5, source[1] - 0.5, source[2] + 0.5],
      stack: cloneItemStack(config.drop),
    })),
  };
}
