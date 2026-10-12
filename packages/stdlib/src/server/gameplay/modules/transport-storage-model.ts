import type { EntityLifetimeReference } from '../ecs-entity-owner';
import { Inventory, type InventorySlot } from '../inventory';
import { cloneItemStack, sameItemStackIdentity } from '../item-instance';
import type { ItemDefinitionRegistry } from '../item-registry';
import { isItemInteractionTarget } from './item-interaction-module';
import {
  validateTransportComponentV1,
  type TransportComponentV1,
  type TransportDefinitionRegistryV1,
} from './transport-model';

export type TransportStorageCommandV1 =
  | Readonly<{
      kind: 'transfer';
      direction: 'deposit' | 'withdraw';
      actorSlot: number;
      transportSlot: number;
      count: number;
    }>
  | Readonly<{ kind: 'refuel'; actorSlot: number; count: number }>;
export type TransportStorageInputV1 = Readonly<{
  version: 1;
  actor: EntityLifetimeReference;
  transport: EntityLifetimeReference;
  expectedInventoryRevision: number;
  expectedTransportRevision: number;
  command: TransportStorageCommandV1;
}>;
export type TransportStorageActorV1 = Readonly<{
  reference: EntityLifetimeReference;
  alive: boolean;
  cursorBusy: boolean;
  inventoryRevision: number;
  slots: readonly InventorySlot[];
}>;
export type TransportStorageSiteV1 = Readonly<{
  reference: EntityLifetimeReference;
  component: TransportComponentV1;
}>;
export type TransportFuelBindingV1 = Readonly<{ definitionId: string; itemId: string; units: number }>;
export type TransportStorageContentV1 = Readonly<{
  definitions: TransportDefinitionRegistryV1;
  items: ItemDefinitionRegistry;
  fuels: readonly TransportFuelBindingV1[];
}>;
export type TransportStorageCandidateV1 = Readonly<{
  version: 1;
  actor: EntityLifetimeReference;
  transport: EntityLifetimeReference;
  inventoryRevision: number;
  slots: readonly InventorySlot[];
  component: TransportComponentV1;
}>;

const revision = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const sameReference = (left: EntityLifetimeReference, right: EntityLifetimeReference) =>
  left.entityId === right.entityId && left.epoch === right.epoch && left.lifetime === right.lifetime;
const reference = (value: unknown): EntityLifetimeReference => {
  if (!isItemInteractionTarget({ kind: 'entity', reference: value }))
    throw new TypeError('Transport storage lifetime reference is invalid.');
  return Object.freeze({ ...(value as EntityLifetimeReference) });
};

export function readTransportStorageInputV1(raw: unknown): TransportStorageInputV1 {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Transport storage input is invalid.');
  const value = raw as Record<string, unknown>;
  const keys = ['version', 'actor', 'transport', 'expectedInventoryRevision', 'expectedTransportRevision', 'command'];
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    value.version !== 1 ||
    !revision(value.expectedInventoryRevision) ||
    !revision(value.expectedTransportRevision)
  )
    throw new TypeError('Transport storage fields are invalid.');
  const command = value.command as Record<string, unknown> | undefined;
  if (!command || typeof command !== 'object' || Array.isArray(command))
    throw new TypeError('Transport storage command is invalid.');
  const expected =
    command.kind === 'transfer'
      ? ['kind', 'direction', 'actorSlot', 'transportSlot', 'count']
      : command.kind === 'refuel'
        ? ['kind', 'actorSlot', 'count']
        : [];
  if (
    !expected.length ||
    Object.keys(command).length !== expected.length ||
    Object.keys(command).some((key) => !expected.includes(key)) ||
    !revision(command.actorSlot) ||
    !Number.isSafeInteger(command.count) ||
    (command.count as number) <= 0 ||
    (command.kind === 'transfer' &&
      (!revision(command.transportSlot) || !['deposit', 'withdraw'].includes(command.direction as string)))
  )
    throw new TypeError('Transport storage command fields are invalid.');
  return Object.freeze({
    version: 1,
    actor: reference(value.actor),
    transport: reference(value.transport),
    expectedInventoryRevision: value.expectedInventoryRevision as number,
    expectedTransportRevision: value.expectedTransportRevision as number,
    command: Object.freeze({ ...command }) as TransportStorageCommandV1,
  });
}

/** Pure candidate only; the registered Host must publish both sides through one prepared ECS mutation. */
export function buildTransportStorageCandidateV1(
  content: TransportStorageContentV1,
  actor: TransportStorageActorV1,
  site: TransportStorageSiteV1,
  raw: unknown,
): TransportStorageCandidateV1 {
  const input = readTransportStorageInputV1(raw);
  if (!actor.alive) throw new Error('transport-storage-actor-dead');
  if (actor.cursorBusy) throw new Error('transport-storage-cursor-busy');
  if (!sameReference(input.actor, actor.reference)) throw new Error('transport-storage-actor-stale');
  if (!sameReference(input.transport, site.reference)) throw new Error('transport-storage-reference-stale');
  const component = validateTransportComponentV1(site.component, content.definitions);
  if (component.entityId !== site.reference.entityId) throw new Error('transport-storage-component-mismatch');
  if (input.expectedInventoryRevision !== actor.inventoryRevision) throw new Error('transport-storage-inventory-stale');
  if (input.expectedTransportRevision !== component.revision) throw new Error('transport-storage-component-stale');
  if (
    !revision(actor.inventoryRevision) ||
    actor.inventoryRevision >= Number.MAX_SAFE_INTEGER ||
    component.revision >= Number.MAX_SAFE_INTEGER
  )
    throw new Error('transport-storage-revision-exhausted');
  const definition = content.definitions.require(component.definitionId);
  const slots = new Inventory(actor.slots.length, actor.slots, content.items).snapshot();
  const cargo = component.inventory.length
    ? new Inventory(component.inventory.length, component.inventory, content.items).snapshot()
    : [];
  const { command } = input;
  if (command.actorSlot >= slots.length) throw new Error('transport-storage-slot-invalid');
  let fuel = component.fuel;
  if (command.kind === 'transfer') {
    if (definition.inventoryCapacity === null || command.transportSlot >= cargo.length)
      throw new Error('transport-storage-slot-invalid');
    const sourceSlots = command.direction === 'deposit' ? slots : cargo;
    const targetSlots = command.direction === 'deposit' ? cargo : slots;
    const sourceSlot = command.direction === 'deposit' ? command.actorSlot : command.transportSlot;
    const targetSlot = command.direction === 'deposit' ? command.transportSlot : command.actorSlot;
    const source = sourceSlots[sourceSlot];
    const target = targetSlots[targetSlot];
    if (!source || source.count < command.count) throw new Error('transport-storage-insufficient-items');
    if (target && !sameItemStackIdentity(source, target)) throw new Error('transport-storage-identity-mismatch');
    const nextCount = (target?.count ?? 0) + command.count;
    if (!Number.isSafeInteger(nextCount) || nextCount > content.items.require(source.itemId).stackLimit)
      throw new Error('transport-storage-destination-full');
    sourceSlots[sourceSlot] =
      source.count === command.count ? null : { ...cloneItemStack(source), count: source.count - command.count };
    targetSlots[targetSlot] = { ...cloneItemStack(source), count: nextCount };
  } else {
    const source = slots[command.actorSlot];
    if (!source || source.count < command.count) throw new Error('transport-storage-insufficient-items');
    const bindings = content.fuels.filter(
      (entry) => entry.definitionId === definition.id && entry.itemId === source.itemId,
    );
    if (definition.fuelCapacity === null || fuel === null || bindings.length !== 1)
      throw new Error('transport-storage-fuel-rejected');
    const units = bindings[0]!.units;
    const added = units * command.count;
    if (!Number.isSafeInteger(units) || units <= 0 || !Number.isSafeInteger(added))
      throw new TypeError('Transport fuel binding is invalid.');
    if (!Number.isFinite(fuel + added) || fuel + added > definition.fuelCapacity)
      throw new Error('transport-storage-fuel-full');
    fuel += added;
    slots[command.actorSlot] =
      source.count === command.count ? null : { ...cloneItemStack(source), count: source.count - command.count };
  }
  return Object.freeze({
    version: 1,
    actor: Object.freeze({ ...actor.reference }),
    transport: Object.freeze({ ...site.reference }),
    inventoryRevision: actor.inventoryRevision + 1,
    slots: Object.freeze(slots.map((slot) => slot && Object.freeze(cloneItemStack(slot)))),
    component: Object.freeze({
      ...component,
      revision: component.revision + 1,
      fuel,
      inventory: Object.freeze(cargo.map((slot) => slot && Object.freeze(cloneItemStack(slot)))),
    }),
  });
}
