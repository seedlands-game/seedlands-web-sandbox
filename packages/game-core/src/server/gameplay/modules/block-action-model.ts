import { validateDurableExecutionOrigin, type DurableExecutionOriginV1 } from '../../composition/execution-origin';
import type { EntityLifetimeReference } from '../../simulation/action-identity';
import { Voxel } from '../../../world/voxel';
import type { GameplayContent } from '../gameplay-content';
import type { InventorySlot } from '../inventory';
import type { ItemDefinitionRegistry, ItemStack } from '../item-registry';

export const BLOCK_ACTIONS_CAPABILITY = 'seedlands:block-actions';
export const BLOCK_RULES_CAPABILITY = 'seedlands:block-rules';
export const BLOCK_ACTOR_COMPONENT = 'seedlands:block-actor';
export const BLOCK_VOXEL_COMPONENT = 'seedlands:block-voxel';
export const BLOCK_WORLD_COMPONENT = 'seedlands:block-world';
export const BLOCK_ACTOR_RESOURCE = 'seedlands.block-actor';
export const BLOCK_VOXEL_RESOURCE = 'seedlands.block-voxel';
export const BLOCK_CLOCK_RESOURCE = 'seedlands.block-clock';
export const BLOCK_BEGIN_OPERATION = 'seedlands:block-begin';
export const BLOCK_CANCEL_OPERATION = 'seedlands:block-cancel';
export const BLOCK_PLACE_OPERATION = 'seedlands:block-place';
export const BLOCK_FINISH_OPERATION = 'seedlands:block-finish';
export const BLOCK_ADVANCE_OPERATION = 'seedlands:block-advance';
export const BLOCK_SYSTEM = 'seedlands:block-system';
export const BLOCK_PARTITIONS = 8;
export const BLOCK_PARTITION_SIZE = 16;

const MAX_IDENTITY_LENGTH = 256;
const MAX_INVENTORY_CAPACITY = 64;
const MAX_SECONDS = 1_000_000;
const MAX_VOXEL = 65_535;
const MAX_WORLD_COORDINATE = 30_000_000;

export type BlockPosition = readonly [number, number, number];
export type BlockBreakActionV1 = Readonly<{
  position: BlockPosition;
  voxel: number;
  elapsedSeconds: number;
  requiredSeconds: number;
  origin?: DurableExecutionOriginV1;
}>;
export type BlockActorProjectionV1 = Readonly<{
  version: 1;
  reference: EntityLifetimeReference;
  kind: 'player';
  position: readonly [number, number, number];
  lifecycle: 'alive' | 'dead';
  mode: Readonly<{ value: 'survival' | 'creative'; revision: number }>;
  slots: readonly InventorySlot[];
  equipment: Readonly<{ selectedSlot: number; hotbarSize: number }>;
  creativeCatalog: Readonly<{ hotbar: readonly (string | null)[]; selectedSlot: number }>;
  breakAction: BlockBreakActionV1 | null;
}>;
export type BlockVoxelProjectionV1 = Readonly<{ version: 1; position: BlockPosition; voxel: number }>;
export type BlockWorldEntryV1 = Readonly<{
  reference: EntityLifetimeReference;
  breakAction: BlockBreakActionV1 | null;
}>;
export type BlockWorldProjectionV1 = Readonly<{
  version: 1;
  partition: number;
  entries: readonly BlockWorldEntryV1[];
}>;

export type BlockVoxelEditV1 = Readonly<{
  position: BlockPosition;
  fromVoxel: number;
  toVoxel: number;
}>;
export type BlockDropIntentV1 = Readonly<{ position: BlockPosition; stack: Readonly<ItemStack> }>;
export type BlockActionPublicResultV1 = Readonly<{
  version: 1;
  success: true;
  kind: 'begin' | 'cancel' | 'place' | 'finish';
  actorId: string;
  requiredSeconds?: number;
}>;
export type BlockActorCandidateV1 = Readonly<{
  version: 1;
  kind: 'begin' | 'cancel' | 'place' | 'finish';
  actorId: string;
  actorReference: EntityLifetimeReference;
  position: BlockPosition | null;
  slots: readonly InventorySlot[];
  breakAction: BlockBreakActionV1 | null;
  voxelEdit: BlockVoxelEditV1 | null;
  dropIntent: BlockDropIntentV1 | null;
  result: BlockActionPublicResultV1;
}>;
export type BlockAdvanceInputV1 = Readonly<{ seconds: number; cancelActorIds: readonly string[] }>;
export type BlockAdvanceCandidateV1 = Readonly<{
  version: 1;
  kind: 'advance';
  seconds: number;
  cancelActorIds: readonly string[];
}>;
export type BlockAdvanceUpdateV1 = Readonly<{
  reference: EntityLifetimeReference;
  previous: BlockBreakActionV1;
  next: BlockBreakActionV1 | null;
  ready: boolean;
}>;
export type BlockActionCandidateV1 = BlockActorCandidateV1 | BlockAdvanceCandidateV1;

export type BlockBeginEffectiveInputV1 = Readonly<{
  position: BlockPosition;
  expectedVoxel: number;
  creative: boolean;
  requiredSeconds: number;
  modeRevision: number;
}>;
export type BlockPlaceEffectiveInputV1 = Readonly<{
  position: BlockPosition;
  expectedVoxel: number;
  placedVoxel: number;
  itemId: string;
  consumeCount: 0 | 1;
  modeRevision: number;
}>;
export type BlockFinishEffectiveInputV1 = Readonly<{
  position: BlockPosition;
  expectedVoxel: number;
  creative: boolean;
  drop: Readonly<ItemStack> | null;
  modeRevision: number;
}>;
export type BlockActionContent = Readonly<Pick<GameplayContent, 'items'>>;
export type BlockActionCandidateRequest =
  | Readonly<{ kind: 'begin'; actor: unknown; voxel: unknown; input: unknown }>
  | Readonly<{ kind: 'cancel'; actor: unknown; input: unknown }>
  | Readonly<{ kind: 'place'; actor: unknown; voxel: unknown; input: unknown }>
  | Readonly<{ kind: 'finish'; actor: unknown; voxel: unknown; input: unknown }>;

export type BlockActionsCapabilityV1 = Readonly<{
  actorComponentId: typeof BLOCK_ACTOR_COMPONENT;
  voxelComponentId: typeof BLOCK_VOXEL_COMPONENT;
  worldComponentId: typeof BLOCK_WORLD_COMPONENT;
  beginOperationId: typeof BLOCK_BEGIN_OPERATION;
  cancelOperationId: typeof BLOCK_CANCEL_OPERATION;
  placeOperationId: typeof BLOCK_PLACE_OPERATION;
  finishOperationId: typeof BLOCK_FINISH_OPERATION;
  advanceOperationId: typeof BLOCK_ADVANCE_OPERATION;
  partitions: typeof BLOCK_PARTITIONS;
}>;

export const blockActorAddress = (entityId: string) => ({
  componentId: BLOCK_ACTOR_COMPONENT,
  target: { kind: 'entity' as const, entityId },
});
export const blockVoxelAddress = (position: BlockPosition) => ({
  componentId: BLOCK_VOXEL_COMPONENT,
  target: { kind: 'voxel' as const, position },
});
export const blockWorldAddress = (partition: number) => ({
  componentId: BLOCK_WORLD_COMPONENT,
  target: { kind: 'world' as const },
  partition,
});
export const blockActionsCapability = (): BlockActionsCapabilityV1 =>
  Object.freeze({
    actorComponentId: BLOCK_ACTOR_COMPONENT,
    voxelComponentId: BLOCK_VOXEL_COMPONENT,
    worldComponentId: BLOCK_WORLD_COMPONENT,
    beginOperationId: BLOCK_BEGIN_OPERATION,
    cancelOperationId: BLOCK_CANCEL_OPERATION,
    placeOperationId: BLOCK_PLACE_OPERATION,
    finishOperationId: BLOCK_FINISH_OPERATION,
    advanceOperationId: BLOCK_ADVANCE_OPERATION,
    partitions: BLOCK_PARTITIONS,
  });

export function blockData(raw: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw))
  )
    throw new TypeError(`${label} must be an object.`);
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  for (const key of Reflect.ownKeys(descriptors))
    if (
      typeof key !== 'string' ||
      !allowed.includes(key) ||
      !descriptors[key].enumerable ||
      !('value' in descriptors[key])
    )
      throw new TypeError(`${label} has invalid fields.`);
  if (Object.keys(descriptors).length !== allowed.length || allowed.some((key) => !descriptors[key]))
    throw new TypeError(`${label} has missing fields.`);
  return raw as Record<string, unknown>;
}

const identity = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_IDENTITY_LENGTH && value.trim() === value;
const safeInteger = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const finite = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const voxelId = (value: unknown): value is number => safeInteger(value, Voxel.Air, MAX_VOXEL);

export function validateBlockPosition(raw: unknown, label = 'Block position'): BlockPosition {
  if (
    !Array.isArray(raw) ||
    raw.length !== 3 ||
    !raw.every((value) => safeInteger(value, -MAX_WORLD_COORDINATE, MAX_WORLD_COORDINATE))
  )
    throw new TypeError(`${label} is invalid.`);
  return Object.freeze([raw[0], raw[1], raw[2]]) as BlockPosition;
}
export function cloneBlockReference(raw: unknown): EntityLifetimeReference {
  const value = blockData(raw, ['entityId', 'epoch', 'lifetime'], 'Block entity reference');
  if (
    !identity(value.entityId) ||
    !safeInteger(value.epoch, 1, Number.MAX_SAFE_INTEGER) ||
    !safeInteger(value.lifetime, 1, Number.MAX_SAFE_INTEGER)
  )
    throw new TypeError('Block entity reference is invalid.');
  return Object.freeze({ entityId: value.entityId, epoch: value.epoch, lifetime: value.lifetime });
}

export function cloneBlockStack(
  items: ItemDefinitionRegistry,
  raw: unknown,
  enforceLimit: boolean,
): Readonly<ItemStack> {
  const hasInstance = Boolean(raw) && typeof raw === 'object' && Object.hasOwn(raw as object, 'instance');
  const value = blockData(raw, hasInstance ? ['itemId', 'count', 'instance'] : ['itemId', 'count'], 'Block item stack');
  if (hasInstance) blockData(value.instance, ['durability'], 'Block item instance');
  const stack = items.normalizeStack(raw);
  if (enforceLimit && stack.count > items.require(stack.itemId).stackLimit)
    throw new TypeError('Block inventory stack exceeds its limit.');
  return Object.freeze({
    itemId: stack.itemId,
    count: stack.count,
    ...(stack.instance ? { instance: Object.freeze({ durability: stack.instance.durability }) } : {}),
  });
}

export function validateBlockBreakAction(raw: unknown): BlockBreakActionV1 {
  const hasOrigin = Boolean(raw) && typeof raw === 'object' && Object.hasOwn(raw as object, 'origin');
  const value = blockData(
    raw,
    hasOrigin
      ? ['position', 'voxel', 'elapsedSeconds', 'requiredSeconds', 'origin']
      : ['position', 'voxel', 'elapsedSeconds', 'requiredSeconds'],
    'Block break action',
  );
  if (
    !voxelId(value.voxel) ||
    !finite(value.elapsedSeconds, 0, MAX_SECONDS) ||
    !finite(value.requiredSeconds, Number.EPSILON, MAX_SECONDS)
  )
    throw new TypeError('Block break action is invalid.');
  return Object.freeze({
    position: validateBlockPosition(value.position, 'Block break position'),
    voxel: value.voxel,
    elapsedSeconds: value.elapsedSeconds,
    requiredSeconds: value.requiredSeconds,
    ...(hasOrigin ? { origin: validateDurableExecutionOrigin(value.origin) } : {}),
  });
}

export function validateBlockActorProjection(raw: unknown, items: ItemDefinitionRegistry): BlockActorProjectionV1 {
  const value = blockData(
    raw,
    [
      'version',
      'reference',
      'kind',
      'position',
      'lifecycle',
      'mode',
      'slots',
      'equipment',
      'creativeCatalog',
      'breakAction',
    ],
    'Block actor projection',
  );
  if (value.version !== 1 || value.kind !== 'player' || !['alive', 'dead'].includes(String(value.lifecycle)))
    throw new TypeError('Block actor projection is invalid.');
  if (
    !Array.isArray(value.position) ||
    value.position.length !== 3 ||
    Object.keys(value.position).length !== 3 ||
    !value.position.every((entry) => finite(entry, -MAX_WORLD_COORDINATE, MAX_WORLD_COORDINATE))
  )
    throw new TypeError('Block actor position is invalid.');
  const position = Object.freeze([value.position[0], value.position[1], value.position[2]] as [number, number, number]);
  if (!Array.isArray(value.slots) || value.slots.length < 1 || value.slots.length > MAX_INVENTORY_CAPACITY)
    throw new TypeError('Block actor inventory is invalid.');
  const slots = Object.freeze(value.slots.map((slot) => (slot === null ? null : cloneBlockStack(items, slot, true))));
  const mode = blockData(value.mode, ['value', 'revision'], 'Block actor mode');
  if (!['survival', 'creative'].includes(String(mode.value)) || !safeInteger(mode.revision, 0, Number.MAX_SAFE_INTEGER))
    throw new TypeError('Block actor mode is invalid.');
  const equipment = blockData(value.equipment, ['selectedSlot', 'hotbarSize'], 'Block actor equipment');
  if (
    !safeInteger(equipment.hotbarSize, 1, slots.length) ||
    !safeInteger(equipment.selectedSlot, 0, equipment.hotbarSize - 1)
  )
    throw new TypeError('Block actor equipment is invalid.');
  const catalog = blockData(value.creativeCatalog, ['hotbar', 'selectedSlot'], 'Block creative catalog');
  if (
    !Array.isArray(catalog.hotbar) ||
    catalog.hotbar.length < 1 ||
    catalog.hotbar.length > MAX_INVENTORY_CAPACITY ||
    !safeInteger(catalog.selectedSlot, 0, catalog.hotbar.length - 1)
  )
    throw new TypeError('Block creative catalog is invalid.');
  const hotbar = Object.freeze(
    catalog.hotbar.map((itemId) => {
      if (itemId !== null && (!identity(itemId) || !items.has(itemId)))
        throw new TypeError('Block creative catalog item is invalid.');
      return itemId;
    }),
  );
  return Object.freeze({
    version: 1,
    reference: cloneBlockReference(value.reference),
    kind: 'player',
    position,
    lifecycle: value.lifecycle as BlockActorProjectionV1['lifecycle'],
    mode: Object.freeze({ value: mode.value as BlockActorProjectionV1['mode']['value'], revision: mode.revision }),
    slots,
    equipment: Object.freeze({ selectedSlot: equipment.selectedSlot, hotbarSize: equipment.hotbarSize }),
    creativeCatalog: Object.freeze({ hotbar, selectedSlot: catalog.selectedSlot }),
    breakAction: value.breakAction === null ? null : validateBlockBreakAction(value.breakAction),
  });
}

export function validateBlockVoxelProjection(raw: unknown): BlockVoxelProjectionV1 {
  const value = blockData(raw, ['version', 'position', 'voxel'], 'Block voxel projection');
  if (value.version !== 1 || !voxelId(value.voxel)) throw new TypeError('Block voxel projection is invalid.');
  return Object.freeze({ version: 1, position: validateBlockPosition(value.position), voxel: value.voxel });
}

export function validateBlockWorldProjection(raw: unknown): BlockWorldProjectionV1 {
  const value = blockData(raw, ['version', 'partition', 'entries'], 'Block world projection');
  if (
    value.version !== 1 ||
    !safeInteger(value.partition, 0, BLOCK_PARTITIONS - 1) ||
    !Array.isArray(value.entries) ||
    value.entries.length > BLOCK_PARTITION_SIZE
  )
    throw new TypeError('Block world projection is invalid.');
  let previous = '';
  const entries = Object.freeze(
    value.entries.map((rawEntry) => {
      const entry = blockData(rawEntry, ['reference', 'breakAction'], 'Block world entry');
      const reference = cloneBlockReference(entry.reference);
      if (reference.entityId <= previous) throw new TypeError('Block world entries are duplicated or unsorted.');
      previous = reference.entityId;
      return Object.freeze({
        reference,
        breakAction: entry.breakAction === null ? null : validateBlockBreakAction(entry.breakAction),
      });
    }),
  );
  return Object.freeze({ version: 1, partition: value.partition, entries });
}

export function validateBlockTargetInput(raw: unknown): Readonly<{ position: BlockPosition }> {
  const value = blockData(raw, ['position'], 'Block target input');
  return Object.freeze({ position: validateBlockPosition(value.position) });
}

export function validateBlockBeginEffectiveInput(raw: unknown): BlockBeginEffectiveInputV1 {
  const value = blockData(
    raw,
    ['position', 'expectedVoxel', 'creative', 'requiredSeconds', 'modeRevision'],
    'Block begin effective input',
  );
  if (
    !voxelId(value.expectedVoxel) ||
    typeof value.creative !== 'boolean' ||
    !finite(value.requiredSeconds, 0, MAX_SECONDS) ||
    !safeInteger(value.modeRevision, 0, Number.MAX_SAFE_INTEGER) ||
    (value.creative ? value.requiredSeconds !== 0 : value.requiredSeconds <= 0)
  )
    throw new TypeError('Block begin policy is invalid.');
  return Object.freeze({
    position: validateBlockPosition(value.position),
    expectedVoxel: value.expectedVoxel,
    creative: value.creative,
    requiredSeconds: value.requiredSeconds,
    modeRevision: value.modeRevision,
  });
}

export function validateBlockPlaceEffectiveInput(raw: unknown): BlockPlaceEffectiveInputV1 {
  const value = blockData(
    raw,
    ['position', 'expectedVoxel', 'placedVoxel', 'itemId', 'consumeCount', 'modeRevision'],
    'Block place effective input',
  );
  if (
    !voxelId(value.expectedVoxel) ||
    !voxelId(value.placedVoxel) ||
    value.placedVoxel === Voxel.Air ||
    !identity(value.itemId) ||
    (value.consumeCount !== 0 && value.consumeCount !== 1) ||
    !safeInteger(value.modeRevision, 0, Number.MAX_SAFE_INTEGER)
  )
    throw new TypeError('Block placement policy is invalid.');
  return Object.freeze({
    position: validateBlockPosition(value.position),
    expectedVoxel: value.expectedVoxel,
    placedVoxel: value.placedVoxel,
    itemId: value.itemId,
    consumeCount: value.consumeCount,
    modeRevision: value.modeRevision,
  });
}

export function validateBlockFinishEffectiveInput(
  raw: unknown,
  items: ItemDefinitionRegistry,
): BlockFinishEffectiveInputV1 {
  const value = blockData(
    raw,
    ['position', 'expectedVoxel', 'creative', 'drop', 'modeRevision'],
    'Block finish effective input',
  );
  if (
    !voxelId(value.expectedVoxel) ||
    typeof value.creative !== 'boolean' ||
    !safeInteger(value.modeRevision, 0, Number.MAX_SAFE_INTEGER) ||
    (value.creative && value.drop !== null)
  )
    throw new TypeError('Block finish policy is invalid.');
  return Object.freeze({
    position: validateBlockPosition(value.position),
    expectedVoxel: value.expectedVoxel,
    creative: value.creative,
    drop: value.drop === null ? null : cloneBlockStack(items, value.drop, false),
    modeRevision: value.modeRevision,
  });
}

export function validateBlockAdvanceInput(raw: unknown): BlockAdvanceInputV1 {
  const hasCancellations = Boolean(raw) && typeof raw === 'object' && Object.hasOwn(raw as object, 'cancelActorIds');
  const value = blockData(raw, hasCancellations ? ['seconds', 'cancelActorIds'] : ['seconds'], 'Block advance input');
  if (!finite(value.seconds, 0, 1)) throw new TypeError('Block advance must be between 0 and 1 second.');
  const ids = hasCancellations ? value.cancelActorIds : [];
  if (
    !Array.isArray(ids) ||
    ids.length > BLOCK_PARTITIONS * BLOCK_PARTITION_SIZE ||
    ids.some((id) => !identity(id)) ||
    new Set(ids).size !== ids.length
  )
    throw new TypeError('Block cancellation actor identities are invalid or duplicated.');
  return Object.freeze({ seconds: value.seconds, cancelActorIds: Object.freeze([...ids]) });
}
