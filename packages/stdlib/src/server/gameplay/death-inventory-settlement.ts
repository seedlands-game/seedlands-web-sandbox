import type { ActorComponentSnapshot } from './ecs-actor-components';
import type { EntityLifetimeReference } from './ecs-entity-owner';
import type { EntityStore } from './entity-store';
import type { InventorySlot } from './inventory';
import { cloneItemStack, type ItemInstanceState } from './item-instance';
import type { ItemStack } from './item-registry';
import { copyBreakAction } from './player-break-action-codec';
import { ARMOR_SLOTS, type ArmorSlot } from './modules/armor-policy';
import { emptyInventoryCursor, type InventoryCursorV1 } from './modules/inventory-pointer-contract';
import { cloneCharacterComponentState } from '../simulation/character-runtime-validation';
import {
  prepareEntityMutation,
  type PreparedActorReplacement,
  type PreparedEntityMutation,
  type PreparedEntityMutationInput,
  type PreparedWorldItemSpawn,
} from './prepared-entity-mutation';

export type DeathInventorySettlementDispositionV1 = 'drop' | 'retain';

export type DeathInventorySettlementPolicyV1 = Readonly<{
  inventory: DeathInventorySettlementDispositionV1;
  cursor: DeathInventorySettlementDispositionV1;
  crafting: DeathInventorySettlementDispositionV1;
  armor: DeathInventorySettlementDispositionV1;
  actor: 'retain' | 'despawn';
}>;

export type DeathInventoryDropSourceV1 =
  | Readonly<{ kind: 'inventory'; slot: number }>
  | Readonly<{ kind: 'cursor' }>
  | Readonly<{ kind: 'crafting'; slot: number }>
  | Readonly<{ kind: 'equipment'; slot: ArmorSlot }>;

export type DeathInventoryDropIntentV1 = Readonly<{
  source: DeathInventoryDropSourceV1;
  position: readonly [number, number, number];
  stack: Readonly<ItemStack>;
}>;

export type DeathInventorySettlementCandidateV1 = Readonly<{
  version: 1;
  actorReference: EntityLifetimeReference;
  expectedInventoryRevision: number;
  policy: DeathInventorySettlementPolicyV1;
  actorReplacement: PreparedActorReplacement | null;
  despawnReference: EntityLifetimeReference | null;
  dropIntents: readonly DeathInventoryDropIntentV1[];
  mutation: PreparedEntityMutationInput;
}>;

const frozenReference = (reference: EntityLifetimeReference): EntityLifetimeReference => {
  if (
    !reference ||
    typeof reference.entityId !== 'string' ||
    !reference.entityId.trim() ||
    !Number.isSafeInteger(reference.epoch) ||
    reference.epoch <= 0 ||
    !Number.isSafeInteger(reference.lifetime) ||
    reference.lifetime <= 0
  )
    throw new TypeError('Death inventory actor reference is invalid.');
  return Object.freeze({ ...reference });
};

const frozenPosition = (position: readonly [number, number, number]): readonly [number, number, number] => {
  if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite))
    throw new TypeError('Death inventory position is invalid.');
  return Object.freeze([...position]) as readonly [number, number, number];
};

const frozenStack = (stack: Readonly<ItemStack>): Readonly<ItemStack> => {
  const copy = cloneItemStack(stack);
  return Object.freeze({
    ...copy,
    ...(copy.instance ? { instance: Object.freeze({ ...copy.instance }) as ItemInstanceState } : {}),
  });
};

const deepFreeze = <Value>(value: Value): Value => {
  if (!value || typeof value !== 'object') return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
};

const frozenSlot = (slot: InventorySlot): InventorySlot => (slot ? frozenStack(slot) : null) as InventorySlot;

const policyValue = (value: unknown, field: string): DeathInventorySettlementDispositionV1 => {
  if (value !== 'drop' && value !== 'retain') throw new TypeError(`Death inventory ${field} policy is invalid.`);
  return value;
};

const frozenPolicy = (raw: DeathInventorySettlementPolicyV1): DeathInventorySettlementPolicyV1 => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Death inventory policy is invalid.');
  if (
    Reflect.ownKeys(raw).some(
      (key) => typeof key !== 'string' || !['inventory', 'cursor', 'crafting', 'armor', 'actor'].includes(key),
    ) ||
    Object.keys(raw).length !== 5
  )
    throw new TypeError('Death inventory policy is invalid.');
  if (raw.actor !== 'retain' && raw.actor !== 'despawn')
    throw new TypeError('Death inventory actor policy is invalid.');
  const policy = Object.freeze({
    inventory: policyValue(raw.inventory, 'inventory'),
    cursor: policyValue(raw.cursor, 'cursor'),
    crafting: policyValue(raw.crafting, 'crafting'),
    armor: policyValue(raw.armor, 'armor'),
    actor: raw.actor,
  });
  if (policy.actor === 'despawn' && Object.values(policy).some((value) => value === 'retain'))
    throw new TypeError('A despawned actor cannot retain death inventory.');
  return policy;
};

function copyCursor(cursor: InventoryCursorV1): InventoryCursorV1 {
  const origin =
    cursor.origin?.kind === 'station'
      ? Object.freeze({
          kind: 'station' as const,
          reference: Object.freeze({ ...cursor.origin.reference }),
          slot: cursor.origin.slot,
        })
      : cursor.origin
        ? Object.freeze({ ...cursor.origin })
        : null;
  return deepFreeze({
    version: 1,
    revision: cursor.revision,
    stack: cursor.stack ? frozenStack(cursor.stack) : null,
    origin,
    craftingGrid: Object.freeze((cursor.craftingGrid ?? []).map(frozenSlot)),
  });
}

function emptyArmor(): Readonly<Record<ArmorSlot, InventorySlot>> {
  return Object.freeze(Object.fromEntries(ARMOR_SLOTS.map((slot) => [slot, null]))) as Readonly<
    Record<ArmorSlot, InventorySlot>
  >;
}

function actorComponents(
  source: ActorComponentSnapshot,
  inventory: InventorySlot[],
  cursor: InventoryCursorV1,
  armor: Readonly<Record<ArmorSlot, InventorySlot>>,
): ActorComponentSnapshot {
  return deepFreeze({
    entityId: source.entityId,
    needs: Object.freeze({ ...source.needs }),
    inventory,
    ...(source.inventoryRevision === undefined ? {} : { inventoryRevision: source.inventoryRevision }),
    inventoryCursor: cursor,
    equipment: Object.freeze({ ...source.equipment, armor }),
    lifecycle: 'dead' as const,
    controlSource: source.controlSource,
    ...(source.controlRevision === undefined ? {} : { controlRevision: source.controlRevision }),
    ...(source.character ? { character: cloneCharacterComponentState(source.character) } : {}),
    ...(source.mode ? { mode: Object.freeze({ ...source.mode }) } : {}),
    ...(source.creativeCatalog
      ? {
          creativeCatalog: Object.freeze({
            ...source.creativeCatalog,
            hotbar: Object.freeze([...source.creativeCatalog.hotbar]),
          }),
        }
      : {}),
    ...(source.flight ? { flight: Object.freeze({ ...source.flight }) } : {}),
    ...(source.species ? { species: Object.freeze({ ...source.species }) } : {}),
    ...(source.player
      ? {
          player: Object.freeze({
            spawnPosition: [...source.player.spawnPosition] as [number, number, number],
            breakAction: copyBreakAction(source.player.breakAction),
          }),
        }
      : {}),
  });
}

/** Builds a detached settlement plan. The caller still owns death policy selection and transaction coordination. */
export function buildDeathInventorySettlementCandidateV1(
  input: Readonly<{
    actorReference: EntityLifetimeReference;
    position: readonly [number, number, number];
    components: ActorComponentSnapshot;
    policy: DeathInventorySettlementPolicyV1;
  }>,
): DeathInventorySettlementCandidateV1 {
  const reference = frozenReference(input.actorReference);
  const position = frozenPosition(input.position);
  const policy = frozenPolicy(input.policy);
  const source = input.components;
  if (!source || source.entityId !== reference.entityId)
    throw new TypeError('Death inventory actor snapshot is invalid.');
  const expectedInventoryRevision = source.inventoryRevision ?? 0;
  if (!Number.isSafeInteger(expectedInventoryRevision) || expectedInventoryRevision < 0)
    throw new TypeError('Death inventory actor revision is invalid.');
  const cursor = copyCursor(source.inventoryCursor ?? emptyInventoryCursor());
  const sourceArmor = source.equipment?.armor;
  if (!sourceArmor || ARMOR_SLOTS.some((slot) => !(slot in sourceArmor)))
    throw new TypeError('Death inventory armor snapshot is incomplete.');

  const drops: DeathInventoryDropIntentV1[] = [];
  const addDrop = (sourceRef: DeathInventoryDropSourceV1, stack: InventorySlot) => {
    if (!stack) return;
    drops.push(
      Object.freeze({
        source: Object.freeze(sourceRef),
        position,
        stack: frozenStack(stack),
      }),
    );
  };
  if (policy.inventory === 'drop')
    source.inventory.forEach((stack, slot) => addDrop({ kind: 'inventory', slot }, stack));
  if (policy.cursor === 'drop') addDrop({ kind: 'cursor' }, cursor.stack);
  if (policy.crafting === 'drop')
    cursor.craftingGrid.forEach((stack, slot) => addDrop({ kind: 'crafting', slot }, stack));
  if (policy.armor === 'drop') ARMOR_SLOTS.forEach((slot) => addDrop({ kind: 'equipment', slot }, sourceArmor[slot]));

  const cursorChanged =
    (policy.cursor === 'drop' && cursor.stack !== null) ||
    (policy.crafting === 'drop' && cursor.craftingGrid.some(Boolean));
  if (cursorChanged && cursor.revision >= Number.MAX_SAFE_INTEGER)
    throw new RangeError('Death inventory cursor revision is exhausted.');
  const nextCursor = cursorChanged
    ? Object.freeze({
        ...cursor,
        revision: cursor.revision + 1,
        ...(policy.cursor === 'drop' ? { stack: null, origin: null } : {}),
        ...(policy.crafting === 'drop' ? { craftingGrid: Object.freeze(cursor.craftingGrid.map(() => null)) } : {}),
      })
    : cursor;
  const nextInventory = Object.freeze(
    source.inventory.map((stack) => (policy.inventory === 'drop' ? null : frozenSlot(stack))),
  ) as unknown as InventorySlot[];
  const nextArmor =
    policy.armor === 'drop'
      ? emptyArmor()
      : (Object.freeze(
          Object.fromEntries(ARMOR_SLOTS.map((slot) => [slot, frozenSlot(sourceArmor[slot])])),
        ) as Readonly<Record<ArmorSlot, InventorySlot>>);
  const actorReplacement: PreparedActorReplacement | null =
    policy.actor === 'retain'
      ? Object.freeze({
          reference,
          health: 0,
          components: actorComponents(source, nextInventory, nextCursor, nextArmor),
        })
      : null;
  const dropIntents = Object.freeze(drops);
  const spawns = Object.freeze(
    dropIntents.map((drop): PreparedWorldItemSpawn =>
      Object.freeze({ position: drop.position, stack: drop.stack as ItemStack }),
    ),
  );
  const mutation: PreparedEntityMutationInput = Object.freeze({
    ...(actorReplacement ? { actors: Object.freeze([actorReplacement]) } : { despawns: Object.freeze([reference]) }),
    spawns,
  });
  return Object.freeze({
    version: 1,
    actorReference: reference,
    expectedInventoryRevision,
    policy,
    actorReplacement,
    despawnReference: actorReplacement ? null : reference,
    dropIntents,
    mutation,
  });
}

/** Prepares the existing entity transaction; callers coordinate validate/apply with other death participants. */
export function prepareDeathInventorySettlementParticipantV1(
  entities: EntityStore,
  candidate: DeathInventorySettlementCandidateV1,
): PreparedEntityMutation {
  if (candidate.version !== 1) throw new TypeError('Death inventory settlement candidate version is invalid.');
  if (!entities.resolveReference(candidate.actorReference))
    throw new Error('Death inventory settlement actor reference is stale.');
  const currentRevision = entities.actorComponentSnapshot(candidate.actorReference.entityId).inventoryRevision ?? 0;
  if (currentRevision !== candidate.expectedInventoryRevision)
    throw new Error('Death inventory settlement actor revision is stale.');
  return prepareEntityMutation(entities, candidate.mutation);
}
