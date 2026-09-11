import type { EntityLifetimeReference } from '../ecs-entity-owner';
import type { StationComponentV1 } from '../ecs-station-state';
import type { InventorySlot } from '../inventory';
import type { ItemDefinitionRegistry, ItemStack } from '../item-registry';

export type InventoryPointerSlotRef =
  Readonly<{ kind: 'inventory'; slot: number }> | Readonly<{ kind: 'station'; slot: number }>;

export type InventoryCursorOriginV1 =
  | Readonly<{ kind: 'inventory'; slot: number }>
  | Readonly<{ kind: 'station'; reference: EntityLifetimeReference; slot: number }>;

export type InventoryCursorV1 = Readonly<{
  version: 1;
  revision: number;
  stack: Readonly<ItemStack> | null;
  origin: InventoryCursorOriginV1 | null;
}>;

export type InventoryPointerStationRef = Readonly<{
  reference: EntityLifetimeReference;
  expectedRevision: number;
}>;

export type InventoryPointerCommand =
  | Readonly<{ kind: 'click'; slot: InventoryPointerSlotRef; button: 0 | 2 }>
  | Readonly<{ kind: 'distribute'; targets: readonly InventoryPointerSlotRef[]; button: 0 | 2 }>
  | Readonly<{ kind: 'quick-move'; slot: InventoryPointerSlotRef }>
  | Readonly<{ kind: 'collect'; slot: InventoryPointerSlotRef }>
  | Readonly<{ kind: 'hotbar'; slot: InventoryPointerSlotRef; hotbarSlot: number }>
  | Readonly<{ kind: 'craft'; batch: boolean }>
  | Readonly<{ kind: 'close' }>
  | Readonly<{ kind: 'drop'; button: 0 | 2 }>;

export type InventoryPointerInputV1 = Readonly<{
  actor: EntityLifetimeReference;
  expectedInventoryRevision: number;
  station?: InventoryPointerStationRef;
  command: InventoryPointerCommand;
}>;

/** Public pointer failures are deliberately finite; internal module messages never cross the network boundary. */
export const INVENTORY_POINTER_FAILURE_REASONS = [
  'actor-reference-stale',
  'actor-dead',
  'stale-inventory-revision',
  'stale-station-reference',
  'stale-station-revision',
  'station-context-required',
  'station-voxel-mismatch',
  'out-of-range',
  'chunk-unavailable',
  'blocked',
  'invalid-pointer-slot',
  'invalid-station-slot',
  'invalid-hotbar-slot',
  'empty-source-slot',
  'cursor-empty',
  'cursor-not-empty',
  'cursor-full',
  'destination-occupied',
  'destination-full',
  'insufficient-items',
  'collect-identity-mismatch',
  'no-collectable-items',
  'same-slot',
  'furnace-output-is-read-only',
  'station-is-not-workbench',
  'recipe-mismatch',
  'station-rejected',
  'inventory-rejected',
] as const;
export type InventoryPointerFailureReason = (typeof INVENTORY_POINTER_FAILURE_REASONS)[number];

export function publicInventoryPointerFailureReason(
  reason: unknown,
  stationContext: boolean,
): InventoryPointerFailureReason {
  if (reason === 'stale-actor-reference') return 'actor-reference-stale';
  if ((INVENTORY_POINTER_FAILURE_REASONS as readonly unknown[]).includes(reason))
    return reason as InventoryPointerFailureReason;
  return stationContext ? 'station-rejected' : 'inventory-rejected';
}

export type InventoryPointerActorProjectionV1 = Readonly<{
  version: 1;
  reference: EntityLifetimeReference;
  kind: 'player' | 'creature' | 'npc';
  slots: readonly InventorySlot[];
  equipment: Readonly<{ selectedSlot: number; hotbarSize: number }>;
  lifecycle: 'alive' | 'dead';
  inventoryRevision: number;
  cursor: InventoryCursorV1;
}>;

export type InventoryPointerStationProjectionV1 = Readonly<{
  version: 1;
  reference: EntityLifetimeReference;
  position: readonly [number, number, number];
  component: StationComponentV1;
}>;

export type InventoryPointerCandidateV1 = Readonly<{
  version: 1;
  kind: 'pointer';
  actorId: string;
  actorReference: EntityLifetimeReference;
  inventoryRevision: number;
  slots: readonly InventorySlot[];
  cursor: InventoryCursorV1;
  stationReference: EntityLifetimeReference | null;
  station: StationComponentV1 | null;
  dropIntents: readonly Readonly<ItemStack>[];
  changed: boolean;
  result: Readonly<{
    version: 1;
    success: true;
    kind: 'pointer';
    actorId: string;
    inventoryRevision: number;
    cursorRevision: number;
    stationRevision?: number;
    crafted?: number;
  }>;
}>;

const MAX_SLOT = 63;
const MAX_TARGETS = 64;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const integer = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
function reference(raw: unknown, label: string): EntityLifetimeReference {
  if (!isRecord(raw) || Object.keys(raw).some((key) => !['entityId', 'epoch', 'lifetime'].includes(key)))
    throw new TypeError(`${label} reference is invalid.`);
  if (
    typeof raw.entityId !== 'string' ||
    !raw.entityId.trim() ||
    raw.entityId !== raw.entityId.trim() ||
    raw.entityId.length > 256 ||
    !integer(raw.epoch, 1) ||
    !integer(raw.lifetime, 1)
  )
    throw new TypeError(`${label} reference is invalid.`);
  return Object.freeze({ entityId: raw.entityId, epoch: raw.epoch, lifetime: raw.lifetime });
}

function frozenStack(stack: Readonly<ItemStack> | null): InventorySlot {
  return stack
    ? Object.freeze({
        ...stack,
        ...(stack.instance ? { instance: Object.freeze({ ...stack.instance }) } : {}),
      })
    : null;
}

export function emptyInventoryCursor(): InventoryCursorV1 {
  return Object.freeze({ version: 1, revision: 0, stack: null, origin: null });
}

export function validateInventoryCursor(raw: unknown, items: ItemDefinitionRegistry): InventoryCursorV1 {
  if (raw === undefined) return emptyInventoryCursor();
  if (
    !isRecord(raw) ||
    Object.keys(raw).some((key) => !['version', 'revision', 'stack', 'origin'].includes(key)) ||
    Object.keys(raw).length !== 4 ||
    raw.version !== 1 ||
    !integer(raw.revision)
  )
    throw new TypeError('Actor inventory cursor snapshot is invalid.');
  const stack = raw.stack === null ? null : frozenStack(items.normalizeStack(raw.stack));
  if (stack && stack.count > items.require(stack.itemId).stackLimit)
    throw new TypeError('Actor inventory cursor exceeds its stack limit.');
  let origin: InventoryCursorOriginV1 | null;
  if (raw.origin === null) origin = null;
  else {
    if (!isRecord(raw.origin) || !integer(raw.origin.slot, 0, MAX_SLOT))
      throw new TypeError('Actor inventory cursor origin is invalid.');
    if (raw.origin.kind === 'inventory' && Object.keys(raw.origin).every((key) => ['kind', 'slot'].includes(key)))
      origin = Object.freeze({ kind: 'inventory', slot: raw.origin.slot });
    else if (
      raw.origin.kind === 'station' &&
      Object.keys(raw.origin).every((key) => ['kind', 'reference', 'slot'].includes(key))
    )
      origin = Object.freeze({
        kind: 'station',
        reference: reference(raw.origin.reference, 'Cursor station'),
        slot: raw.origin.slot,
      });
    else throw new TypeError('Actor inventory cursor origin is invalid.');
  }
  if (stack === null && origin !== null) throw new TypeError('An empty inventory cursor cannot retain an origin.');
  return Object.freeze({ version: 1, revision: raw.revision, stack, origin });
}

function slotRef(raw: unknown): InventoryPointerSlotRef {
  if (
    !isRecord(raw) ||
    Object.keys(raw).some((key) => !['kind', 'slot'].includes(key)) ||
    (raw.kind !== 'inventory' && raw.kind !== 'station') ||
    !integer(raw.slot, 0, MAX_SLOT)
  )
    throw new TypeError('Inventory pointer slot reference is invalid.');
  return Object.freeze({ kind: raw.kind, slot: raw.slot });
}

function button(value: unknown): 0 | 2 {
  if (value !== 0 && value !== 2) throw new TypeError('Inventory pointer button is invalid.');
  return value;
}

export function validateInventoryPointerInput(raw: unknown): InventoryPointerInputV1 {
  if (!isRecord(raw)) throw new TypeError('Inventory pointer input is invalid.');
  if (Object.keys(raw).some((key) => !['actor', 'expectedInventoryRevision', 'station', 'command'].includes(key)))
    throw new TypeError('Inventory pointer input contains unknown fields.');
  const actor = reference(raw.actor, 'Inventory pointer actor');
  if (!integer(raw.expectedInventoryRevision)) throw new TypeError('Inventory pointer revision is invalid.');
  let station: InventoryPointerStationRef | undefined;
  if (raw.station !== undefined) {
    if (
      !isRecord(raw.station) ||
      Object.keys(raw.station).some((key) => !['reference', 'expectedRevision'].includes(key)) ||
      !integer(raw.station.expectedRevision)
    )
      throw new TypeError('Inventory pointer station is invalid.');
    station = Object.freeze({
      reference: reference(raw.station.reference, 'Inventory pointer station'),
      expectedRevision: raw.station.expectedRevision,
    });
  }
  if (!isRecord(raw.command) || typeof raw.command.kind !== 'string')
    throw new TypeError('Inventory pointer command is invalid.');
  const source = raw.command;
  let command: InventoryPointerCommand;
  switch (source.kind) {
    case 'click':
      if (Object.keys(source).some((key) => !['kind', 'slot', 'button'].includes(key)))
        throw new TypeError('Inventory pointer click is invalid.');
      command = Object.freeze({ kind: source.kind, slot: slotRef(source.slot), button: button(source.button) });
      break;
    case 'distribute':
      if (
        Object.keys(source).some((key) => !['kind', 'targets', 'button'].includes(key)) ||
        !Array.isArray(source.targets) ||
        source.targets.length < 1 ||
        source.targets.length > MAX_TARGETS
      )
        throw new TypeError('Inventory pointer distribution is invalid.');
      command = Object.freeze({
        kind: source.kind,
        targets: Object.freeze(source.targets.map(slotRef)),
        button: button(source.button),
      });
      break;
    case 'quick-move':
    case 'collect':
      if (Object.keys(source).some((key) => !['kind', 'slot'].includes(key)))
        throw new TypeError('Inventory pointer slot command is invalid.');
      command = Object.freeze({ kind: source.kind, slot: slotRef(source.slot) });
      break;
    case 'hotbar':
      if (
        Object.keys(source).some((key) => !['kind', 'slot', 'hotbarSlot'].includes(key)) ||
        !integer(source.hotbarSlot, 0, 7)
      )
        throw new TypeError('Inventory pointer hotbar command is invalid.');
      command = Object.freeze({ kind: source.kind, slot: slotRef(source.slot), hotbarSlot: source.hotbarSlot });
      break;
    case 'craft':
      if (Object.keys(source).some((key) => !['kind', 'batch'].includes(key)) || typeof source.batch !== 'boolean')
        throw new TypeError('Inventory pointer craft command is invalid.');
      command = Object.freeze({ kind: source.kind, batch: source.batch });
      break;
    case 'close':
      if (Object.keys(source).length !== 1) throw new TypeError('Inventory pointer close command is invalid.');
      command = Object.freeze({ kind: source.kind });
      break;
    case 'drop':
      if (Object.keys(source).some((key) => !['kind', 'button'].includes(key)))
        throw new TypeError('Inventory pointer drop command is invalid.');
      command = Object.freeze({ kind: source.kind, button: button(source.button) });
      break;
    default:
      throw new TypeError('Inventory pointer command kind is invalid.');
  }
  return Object.freeze({
    actor,
    expectedInventoryRevision: raw.expectedInventoryRevision,
    ...(station ? { station } : {}),
    command,
  });
}
