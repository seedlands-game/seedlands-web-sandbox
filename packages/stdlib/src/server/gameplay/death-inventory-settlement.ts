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
  prepareEntityMutationSeries,
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

export type DeathInventorySettlementSourceV1 = Readonly<{
  actorReference: EntityLifetimeReference;
  health: number;
  components: ActorComponentSnapshot;
}>;

export type DeathInventoryIntrinsicDropV1 = Readonly<{
  position: readonly [number, number, number];
  stack: Readonly<ItemStack>;
}>;

export type DeathInventorySettlementCandidateV1 = Readonly<{
  version: 1;
  source: DeathInventorySettlementSourceV1;
  policy: DeathInventorySettlementPolicyV1;
  actorReplacement: PreparedActorReplacement | null;
  despawnReference: EntityLifetimeReference | null;
  dropIntents: readonly DeathInventoryDropIntentV1[];
}>;

export type DeathInventoryAdditionalActorReplacementV1 = Readonly<{
  /** Authoritative pre-schedule frontier, detached by the mixed-series preparer. */
  source: DeathInventorySettlementSourceV1;
  /** Proposed living state only; death and despawn must use a policy-governed candidate. */
  replacement: PreparedActorReplacement;
}>;

const isRecord = (raw: unknown): raw is Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const prototype = Object.getPrototypeOf(raw);
  return prototype === Object.prototype || prototype === null;
};

const exactRecord = (raw: unknown, keys: readonly string[], label: string): Record<string, unknown> => {
  if (!isRecord(raw)) throw new TypeError(`${label} is invalid.`);
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (
    Reflect.ownKeys(descriptors).some(
      (key) => typeof key !== 'string' || !keys.includes(key) || !('value' in descriptors[key]!),
    ) ||
    Object.keys(descriptors).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(descriptors, key))
  )
    throw new TypeError(`${label} is invalid.`);
  return raw;
};

const exactOptionalRecord = (
  raw: unknown,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): Record<string, unknown> => {
  if (!isRecord(raw)) throw new TypeError(`${label} is invalid.`);
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const allowed = [...required, ...optional];
  if (
    Reflect.ownKeys(descriptors).some(
      (key) => typeof key !== 'string' || !allowed.includes(key) || !('value' in descriptors[key]!),
    ) ||
    required.some((key) => !Object.hasOwn(descriptors, key))
  )
    throw new TypeError(`${label} is invalid.`);
  return raw;
};

const frozenReference = (reference: EntityLifetimeReference): EntityLifetimeReference => {
  const raw = exactRecord(reference, ['entityId', 'epoch', 'lifetime'], 'Death inventory actor reference');
  if (
    typeof raw.entityId !== 'string' ||
    !raw.entityId.trim() ||
    raw.entityId !== raw.entityId.trim() ||
    !Number.isSafeInteger(raw.epoch) ||
    (raw.epoch as number) <= 0 ||
    !Number.isSafeInteger(raw.lifetime) ||
    (raw.lifetime as number) <= 0
  )
    throw new TypeError('Death inventory actor reference is invalid.');
  return Object.freeze({
    entityId: raw.entityId,
    epoch: raw.epoch as number,
    lifetime: raw.lifetime as number,
  });
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

export function freezeDeathInventorySettlementPolicyV1(raw: unknown): DeathInventorySettlementPolicyV1 {
  const value = exactRecord(raw, ['inventory', 'cursor', 'crafting', 'armor', 'actor'], 'Death inventory policy');
  if (value.actor !== 'retain' && value.actor !== 'despawn')
    throw new TypeError('Death inventory actor policy is invalid.');
  const policy = Object.freeze({
    inventory: policyValue(value.inventory, 'inventory'),
    cursor: policyValue(value.cursor, 'cursor'),
    crafting: policyValue(value.crafting, 'crafting'),
    armor: policyValue(value.armor, 'armor'),
    actor: value.actor,
  });
  if (policy.actor === 'despawn' && Object.values(policy).some((entry) => entry === 'retain'))
    throw new TypeError('A despawned actor cannot retain death inventory.');
  return policy;
}

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

function copyArmor(source: Readonly<Record<ArmorSlot, InventorySlot>>): Readonly<Record<ArmorSlot, InventorySlot>> {
  return Object.freeze(Object.fromEntries(ARMOR_SLOTS.map((slot) => [slot, frozenSlot(source[slot])]))) as Readonly<
    Record<ArmorSlot, InventorySlot>
  >;
}

function copyActorComponents(
  source: ActorComponentSnapshot,
  inventory: InventorySlot[],
  cursor: InventoryCursorV1,
  armor: Readonly<Record<ArmorSlot, InventorySlot>>,
  lifecycle: ActorComponentSnapshot['lifecycle'],
): ActorComponentSnapshot {
  return deepFreeze({
    entityId: source.entityId,
    needs: Object.freeze({ ...source.needs }),
    inventory,
    ...(source.inventoryRevision === undefined ? {} : { inventoryRevision: source.inventoryRevision }),
    inventoryCursor: cursor,
    equipment: Object.freeze({ ...source.equipment, armor }),
    lifecycle,
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

function frozenActorSnapshot(source: ActorComponentSnapshot): ActorComponentSnapshot {
  if (!source || !Array.isArray(source.inventory)) throw new TypeError('Death inventory actor snapshot is invalid.');
  const cursor = copyCursor(source.inventoryCursor ?? emptyInventoryCursor());
  const armor = source.equipment?.armor;
  if (!armor || ARMOR_SLOTS.some((slot) => !(slot in armor)))
    throw new TypeError('Death inventory armor snapshot is incomplete.');
  return copyActorComponents(source, source.inventory.map(frozenSlot), cursor, copyArmor(armor), source.lifecycle);
}

/** Builds a detached settlement plan. The caller owns policy selection and supplies both source and proposed state. */
export function buildDeathInventorySettlementCandidateV1(
  input: Readonly<{
    source: DeathInventorySettlementSourceV1;
    position: readonly [number, number, number];
    settlementComponents: ActorComponentSnapshot;
    policy: DeathInventorySettlementPolicyV1;
  }>,
): DeathInventorySettlementCandidateV1 {
  const value = exactRecord(
    input,
    ['source', 'position', 'settlementComponents', 'policy'],
    'Death inventory settlement input',
  );
  const inputSource = exactRecord(
    value.source,
    ['actorReference', 'health', 'components'],
    'Death inventory settlement source',
  );
  const reference = frozenReference(inputSource.actorReference as EntityLifetimeReference);
  if (typeof inputSource.health !== 'number' || !Number.isFinite(inputSource.health) || inputSource.health < 0)
    throw new TypeError('Death inventory source health is invalid.');
  const sourceComponents = frozenActorSnapshot(inputSource.components as ActorComponentSnapshot);
  const settlementComponents = frozenActorSnapshot(value.settlementComponents as ActorComponentSnapshot);
  if (sourceComponents.entityId !== reference.entityId || settlementComponents.entityId !== reference.entityId)
    throw new TypeError('Death inventory actor snapshot is invalid.');
  const source = Object.freeze({ actorReference: reference, health: inputSource.health, components: sourceComponents });
  const position = frozenPosition(value.position as readonly [number, number, number]);
  const policy = freezeDeathInventorySettlementPolicyV1(value.policy);
  const cursor = settlementComponents.inventoryCursor ?? emptyInventoryCursor();
  const sourceArmor = settlementComponents.equipment.armor!;

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
    settlementComponents.inventory.forEach((stack, slot) => addDrop({ kind: 'inventory', slot }, stack));
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
    settlementComponents.inventory.map((stack) => (policy.inventory === 'drop' ? null : frozenSlot(stack))),
  ) as unknown as InventorySlot[];
  const nextArmor = policy.armor === 'drop' ? emptyArmor() : copyArmor(sourceArmor);
  const actorReplacement: PreparedActorReplacement | null =
    policy.actor === 'retain'
      ? Object.freeze({
          reference,
          health: 0,
          components: copyActorComponents(settlementComponents, nextInventory, nextCursor, nextArmor, 'dead'),
        })
      : null;
  return Object.freeze({
    version: 1,
    source,
    policy,
    actorReplacement,
    despawnReference: actorReplacement ? null : reference,
    dropIntents: Object.freeze(drops),
  });
}

const sameSnapshot = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

function assertDense(entries: readonly unknown[], label: string): void {
  if (!Array.isArray(entries)) throw new TypeError(`${label} must be an array.`);
  for (let index = 0; index < entries.length; index++)
    if (!Object.hasOwn(entries, index)) throw new TypeError(`${label} must be dense.`);
}

function sourceIsFresh(entities: EntityStore, source: DeathInventorySettlementSourceV1): void {
  const reference = source?.actorReference;
  if (!reference || !entities.resolveReference(reference))
    throw new Error('Death inventory settlement actor reference is stale.');
  const entity = entities.get(reference.entityId);
  if (!entity || entity.health !== source.health) throw new Error('Death inventory settlement actor health is stale.');
  if (!sameSnapshot(entities.actorComponentSnapshot(reference.entityId), source.components))
    throw new Error('Death inventory settlement actor component source is stale.');
}

function validateCandidate(entities: EntityStore, candidate: DeathInventorySettlementCandidateV1): void {
  if (!candidate || candidate.version !== 1)
    throw new TypeError('Death inventory settlement candidate version is invalid.');
  const reference = candidate.source?.actorReference;
  sourceIsFresh(entities, candidate.source);
  if (Boolean(candidate.actorReplacement) === Boolean(candidate.despawnReference))
    throw new TypeError('Death inventory settlement actor replacement and despawn are invalid.');
  const targetReference = candidate.actorReplacement?.reference ?? candidate.despawnReference!;
  if (!sameSnapshot(targetReference, reference))
    throw new TypeError('Death inventory settlement target does not match its source.');
}

function validateAdditionalActorReplacement(
  entities: EntityStore,
  input: DeathInventoryAdditionalActorReplacementV1,
): PreparedActorReplacement {
  const value = exactRecord(input, ['source', 'replacement'], 'Death inventory additional actor replacement');
  const rawSource = exactRecord(
    value.source,
    ['actorReference', 'health', 'components'],
    'Death inventory settlement source',
  );
  const source = Object.freeze({
    actorReference: frozenReference(rawSource.actorReference as EntityLifetimeReference),
    health: rawSource.health as number,
    components: frozenActorSnapshot(rawSource.components as ActorComponentSnapshot),
  });
  if (!Number.isFinite(source.health) || source.health <= 0 || source.components.lifecycle !== 'alive')
    throw new TypeError('Death inventory additional actor source must be alive.');
  if (source.components.entityId !== source.actorReference.entityId)
    throw new TypeError('Death inventory actor snapshot is invalid.');
  sourceIsFresh(entities, source);

  const replacementValue = exactOptionalRecord(
    value.replacement,
    ['reference', 'health', 'components'],
    ['position', 'physicsVelocity'],
    'Death inventory additional actor replacement value',
  );
  const copiedPosition = (field: 'position' | 'physicsVelocity') => {
    const raw = replacementValue[field];
    return raw === undefined ? undefined : frozenPosition(raw as readonly [number, number, number]);
  };
  const position = copiedPosition('position');
  const physicsVelocity = copiedPosition('physicsVelocity');
  const replacement = Object.freeze({
    reference: frozenReference(replacementValue.reference as EntityLifetimeReference),
    health: replacementValue.health as number,
    components: frozenActorSnapshot(replacementValue.components as ActorComponentSnapshot),
    ...(position ? { position } : {}),
    ...(physicsVelocity ? { physicsVelocity } : {}),
  });
  if (!Number.isFinite(replacement.health) || replacement.health <= 0 || replacement.components.lifecycle !== 'alive')
    throw new TypeError('Death inventory additional actor replacement must remain alive.');
  if (
    replacement.components.entityId !== replacement.reference.entityId ||
    !sameSnapshot(replacement.reference, source.actorReference)
  )
    throw new TypeError('Death inventory additional actor replacement does not match its source.');
  return replacement;
}

const worldItemSpawn = (drop: DeathInventoryIntrinsicDropV1 | DeathInventoryDropIntentV1): PreparedWorldItemSpawn =>
  Object.freeze({ position: frozenPosition(drop.position), stack: frozenStack(drop.stack) as ItemStack });

function mutationSegments(
  actors: readonly PreparedActorReplacement[],
  despawns: readonly EntityLifetimeReference[],
  spawns: readonly PreparedWorldItemSpawn[],
): PreparedEntityMutationInput[] {
  const segments: PreparedEntityMutationInput[] = [];
  let actorOffset = 0;
  let despawnOffset = 0;
  let spawnOffset = 0;
  while (actorOffset < actors.length || despawnOffset < despawns.length || spawnOffset < spawns.length) {
    let remaining = 128;
    const nextActors = actors.slice(actorOffset, actorOffset + remaining);
    actorOffset += nextActors.length;
    remaining -= nextActors.length;
    const nextDespawns = despawns.slice(despawnOffset, despawnOffset + remaining);
    despawnOffset += nextDespawns.length;
    remaining -= nextDespawns.length;
    const nextSpawns = spawns.slice(spawnOffset, spawnOffset + remaining);
    spawnOffset += nextSpawns.length;
    segments.push(
      Object.freeze({
        ...(nextActors.length ? { actors: Object.freeze(nextActors) } : {}),
        ...(nextDespawns.length ? { despawns: Object.freeze(nextDespawns) } : {}),
        ...(nextSpawns.length ? { spawns: Object.freeze(nextSpawns) } : {}),
      }),
    );
  }
  return segments;
}

/** Prepares every death mutation through one allocator and freshness frontier. */
export function prepareDeathInventorySettlementSeriesV1(
  entities: EntityStore,
  input: Readonly<{
    candidates: readonly DeathInventorySettlementCandidateV1[];
    additionalActorReplacements?: readonly DeathInventoryAdditionalActorReplacementV1[];
    intrinsicDrops?: readonly DeathInventoryIntrinsicDropV1[];
  }>,
): PreparedEntityMutation {
  const value = exactOptionalRecord(
    input,
    ['candidates'],
    ['additionalActorReplacements', 'intrinsicDrops'],
    'Death inventory settlement series input',
  );
  const candidates = value.candidates as readonly DeathInventorySettlementCandidateV1[];
  const additionalActorReplacements =
    (value.additionalActorReplacements as readonly DeathInventoryAdditionalActorReplacementV1[] | undefined) ?? [];
  const intrinsicDrops = (value.intrinsicDrops as readonly DeathInventoryIntrinsicDropV1[] | undefined) ?? [];
  assertDense(candidates, 'Death inventory settlement candidates');
  assertDense(additionalActorReplacements, 'Death inventory additional actor replacements');
  assertDense(intrinsicDrops, 'Death inventory intrinsic drops');
  if (candidates.length < 1) throw new RangeError('Death inventory settlement requires at least one candidate.');

  const actorIds = new Set<string>();
  const additionalActors = additionalActorReplacements.map((entry) => {
    const replacement = validateAdditionalActorReplacement(entities, entry);
    const id = replacement.reference.entityId;
    if (actorIds.has(id)) throw new TypeError(`Death inventory settlement contains a duplicate actor: ${id}`);
    actorIds.add(id);
    return replacement;
  });
  for (const candidate of candidates) {
    validateCandidate(entities, candidate);
    const id = candidate.source.actorReference.entityId;
    if (actorIds.has(id)) throw new TypeError(`Death inventory settlement contains a duplicate actor: ${id}`);
    actorIds.add(id);
  }
  const actors = [
    ...additionalActors,
    ...candidates.flatMap((candidate) => (candidate.actorReplacement ? [candidate.actorReplacement] : [])),
  ];
  const despawns = candidates.flatMap((candidate) => (candidate.despawnReference ? [candidate.despawnReference] : []));
  const spawns = [
    ...candidates.flatMap((candidate) => candidate.dropIntents.map(worldItemSpawn)),
    ...intrinsicDrops.map(worldItemSpawn),
  ];
  return prepareEntityMutationSeries(entities, mutationSegments(actors, despawns, spawns));
}

/** Single-candidate compatibility delegates to the same series frontier. */
export function prepareDeathInventorySettlementParticipantV1(
  entities: EntityStore,
  candidate: DeathInventorySettlementCandidateV1,
): PreparedEntityMutation {
  return prepareDeathInventorySettlementSeriesV1(entities, { candidates: [candidate] });
}
