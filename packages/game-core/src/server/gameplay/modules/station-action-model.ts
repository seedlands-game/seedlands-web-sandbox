import type { GameplayContent } from '../gameplay-content';
import type { StationComponentV1 } from '../ecs-station-state';
import type { EntityLifetimeReference } from '../entity-store';
import { Inventory, type InventorySlot } from '../inventory';
import { sameItemStackIdentity } from '../item-instance';
import { createStationCraftCandidate } from './station-candidates';
import { validateInventoryActorProjection } from './inventory-action-model';

export const STATION_ACTOR_COMPONENT = 'seedlands:station-actor';
export const STATION_INSTANCE_COMPONENT = 'seedlands:station-instance';
export const STATION_ACTOR_RESOURCE = 'seedlands.station-actor';
export const STATION_RESOURCE = 'seedlands.station';
export const STATION_TRANSFER_OPERATION = 'seedlands:station-transfer';
export const STATION_CRAFT_OPERATION = 'seedlands:station-craft';
export type StationActionKind = 'transfer' | 'craft';
export type StationProjectionV1 = Readonly<{
  version: 1;
  reference: EntityLifetimeReference;
  position: readonly [number, number, number];
  component: StationComponentV1;
}>;
export type StationActionCandidateV1 = Readonly<{
  version: 1;
  kind: StationActionKind;
  actorReference: EntityLifetimeReference;
  stationReference: EntityLifetimeReference;
  slots: readonly InventorySlot[];
  station: StationComponentV1;
  result: Readonly<{
    version: 1;
    success: true;
    kind: StationActionKind;
    actorId: string;
    stationId: string;
    stationRevision: number;
  }>;
}>;

export const stationActorAddress = (entityId: string) => ({
  componentId: STATION_ACTOR_COMPONENT,
  target: { kind: 'entity' as const, entityId },
});
export const stationInstanceAddress = (entityId: string) => ({
  componentId: STATION_INSTANCE_COMPONENT,
  target: { kind: 'entity' as const, entityId },
});
const record = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Station value must be an object.');
  return raw as Record<string, unknown>;
};
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;

export function validateStationActor(raw: unknown, content: GameplayContent) {
  const source = record(raw);
  const { mode, ...base } = source;
  if (mode !== 'survival' && mode !== 'creative') throw new TypeError('Invalid station actor mode.');
  return { ...validateInventoryActorProjection(base, content.items), mode };
}
export function validateStationProjection(raw: unknown, content: GameplayContent): StationProjectionV1 {
  if (!content.stations) throw new TypeError('World has no station content.');
  const value = record(raw),
    reference = record(value.reference);
  if (
    value.version !== 1 ||
    typeof reference.entityId !== 'string' ||
    !reference.entityId.trim() ||
    !integer(reference.epoch, 1, Number.MAX_SAFE_INTEGER) ||
    !integer(reference.lifetime, 1, Number.MAX_SAFE_INTEGER) ||
    !Array.isArray(value.position) ||
    value.position.length !== 3 ||
    !value.position.every((x) => integer(x, -30_000_000, 30_000_000))
  )
    throw new TypeError('Invalid station projection.');
  return {
    version: 1,
    reference: { entityId: reference.entityId, epoch: reference.epoch, lifetime: reference.lifetime },
    position: [...value.position] as [number, number, number],
    component: content.stations.codec.decode(value.component, reference.entityId),
  };
}

export function buildStationActionCandidate(
  content: GameplayContent,
  request: Readonly<{ kind: StationActionKind; actor: unknown; station: unknown; input: unknown }>,
): StationActionCandidateV1 {
  const actor = validateStationActor(request.actor, content),
    station = validateStationProjection(request.station, content),
    input = record(request.input);
  if (actor.lifecycle !== 'alive') throw new Error('actor-dead');
  if (actor.mode === 'creative') throw new Error('creative-station-inventory-forbidden');
  if (
    !integer(input.expectedStationRevision, 0, Number.MAX_SAFE_INTEGER) ||
    input.expectedStationRevision !== station.component.revision
  )
    throw new Error('stale-station-revision');
  if (station.component.revision === Number.MAX_SAFE_INTEGER) throw new RangeError('Station revision exhausted.');
  let slots = new Inventory(actor.slots.length, actor.slots, content.items).snapshot();
  let next: StationComponentV1;
  if (request.kind === 'craft') {
    if (
      Object.keys(input).some((key) => !['expectedStationRevision', 'recipeId'].includes(key)) ||
      typeof input.recipeId !== 'string'
    )
      throw new TypeError('Invalid station craft input.');
    if (station.component.kind !== 'workbench') throw new Error('station-is-not-workbench');
    const recipe = content.stations!.recipe(input.recipeId);
    if (!recipe) throw new Error('unknown-station-recipe');
    const result = createStationCraftCandidate({
      items: content.items,
      recipe,
      grid: station.component.grid,
      output: slots,
    });
    if (!result.success) throw new Error(result.reason);
    slots = result.output;
    next = { ...station.component, grid: result.grid };
  } else {
    if (
      Object.keys(input).some(
        (key) => !['expectedStationRevision', 'from', 'actorSlot', 'stationSlot', 'count'].includes(key),
      ) ||
      (input.from !== 'actor' && input.from !== 'station')
    )
      throw new TypeError('Invalid station transfer input.');
    const component = station.component;
    const contents =
      component.kind === 'workbench'
        ? [...component.grid]
        : component.kind === 'chest'
          ? [...component.slots]
          : [component.furnace.input, component.furnace.fuel, component.furnace.output];
    if (!integer(input.actorSlot, 0, slots.length - 1) || !integer(input.stationSlot, 0, contents.length - 1))
      throw new TypeError('Invalid station transfer slot.');
    if (component.kind === 'furnace' && input.from === 'actor' && input.stationSlot === 2)
      throw new Error('furnace-output-is-read-only');
    const from = input.from === 'actor' ? slots : contents,
      to = input.from === 'actor' ? contents : slots;
    const fromIndex = input.from === 'actor' ? input.actorSlot : input.stationSlot,
      toIndex = input.from === 'actor' ? input.stationSlot : input.actorSlot;
    const source = from[fromIndex],
      target = to[toIndex];
    if (!source) throw new Error('empty-source-slot');
    const count = input.count ?? source.count;
    if (!integer(count, 1, source.count)) throw new TypeError('Invalid station transfer count.');
    if (target && !sameItemStackIdentity(source, target)) throw new Error('destination-occupied');
    if ((target?.count ?? 0) + count > content.items.require(source.itemId).stackLimit)
      throw new Error('destination-full');
    if (component.kind === 'furnace' && input.from === 'actor') {
      const furnace = content.stations!.codec.furnace;
      const recipe = furnace.recipeForInput(source.itemId);
      if (input.stationSlot === 0 && (!recipe || !sameItemStackIdentity(source, recipe.input)))
        throw new Error('invalid-furnace-input');
      if (input.stationSlot === 1 && !furnace.fuel(source.itemId)) throw new Error('invalid-furnace-fuel');
    }
    from[fromIndex] = source.count === count ? null : { ...source, count: source.count - count };
    to[toIndex] = { ...source, count: (target?.count ?? 0) + count };
    if (component.kind === 'workbench') next = { ...component, grid: contents };
    else if (component.kind === 'chest') next = { ...component, slots: contents };
    else {
      const furnace = { ...component.furnace, input: contents[0]!, fuel: contents[1]!, output: contents[2]! };
      const active = furnace.activeRecipeId
        ? content.stations!.codec.furnace.recipe(furnace.activeRecipeId)
        : undefined;
      if (
        active &&
        (!furnace.input ||
          !sameItemStackIdentity(furnace.input, active.input) ||
          furnace.input.count < active.input.count)
      ) {
        furnace.activeRecipeId = null;
        furnace.progressSeconds = 0;
      }
      next = { ...component, furnace };
    }
  }
  next = content.stations!.codec.decode({ ...next, revision: station.component.revision + 1 });
  return {
    version: 1,
    kind: request.kind,
    actorReference: actor.reference,
    stationReference: station.reference,
    slots: new Inventory(slots.length, slots, content.items).snapshot(),
    station: next,
    result: {
      version: 1,
      success: true,
      kind: request.kind,
      actorId: actor.reference.entityId,
      stationId: station.reference.entityId,
      stationRevision: next.revision,
    },
  };
}
