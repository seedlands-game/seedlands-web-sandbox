import type { ModuleInvocationValue } from '../../composition/contracts';
import type {
  ModStateWrite,
  ObservedModState,
  PreparedRegisteredCommit,
  RegisteredCommitContext,
} from '../../composition/operation-contracts';
import type { InventorySlot } from '../inventory';
import type { ItemDefinitionRegistry } from '../item-registry';
import { createInventoryCandidate } from './inventory-api';
import {
  buildMediaPlaybackCandidateV1,
  type MediaDeviceDefinitionV1,
  type MediaPlaybackActionV1,
  type MediaPlaybackModelV1,
  type MediaPlaybackStateV1,
} from './media-playback-model';
import {
  MEDIA_ACTIVATE_OPERATION,
  MEDIA_EJECT_OPERATION,
  MEDIA_INSERT_AND_ACTIVATE_OPERATION,
  MEDIA_INSERT_OPERATION,
  MEDIA_PLAYBACK_RESOURCE,
  MEDIA_STOP_OPERATION,
  MEDIA_SWITCH_OPERATION,
  mediaPlaybackAddress,
} from './media-playback-module';

export type MediaPlaybackActorInventoryV1 = Readonly<{
  actorId: string;
  lifecycle: 'alive' | 'dead';
  mode: 'survival' | 'creative';
  inventoryRevision: number;
  selectedSlot: number;
  selectedItemId: string | null;
  slots: readonly InventorySlot[];
}>;

export type PreparedMediaPlaybackParticipant = Readonly<{
  /** All external and capacity checks belong in validate; apply only commits the captured replacement. */
  validate(): void;
  apply(): void;
}>;

export type MediaPlaybackStateOwnerPort = Readonly<{
  deviceAt(position: readonly [number, number, number]): MediaDeviceDefinitionV1;
  read(position: readonly [number, number, number]): MediaPlaybackStateV1;
  prepareReplacement(
    position: readonly [number, number, number],
    expected: MediaPlaybackStateV1,
    replacement: MediaPlaybackStateV1,
  ): PreparedMediaPlaybackParticipant;
}>;

export type MediaPlaybackHostCommitOptions = Readonly<{
  model: MediaPlaybackModelV1;
  items: ItemDefinitionRegistry;
  media: MediaPlaybackStateOwnerPort;
  readActor(actorId: string): MediaPlaybackActorInventoryV1;
  resolveItemStorageId(itemId: string): string | undefined;
  prepareInventory(
    input: Readonly<{
      actorId: string;
      expectedRevision: number;
      slots: readonly InventorySlot[];
    }>,
  ): PreparedMediaPlaybackParticipant;
  validateObserved(observed: readonly ObservedModState[]): void;
  assertActorAuthorized(execution: RegisteredCommitContext): void;
  assertTargetReachable(actorId: string, position: readonly [number, number, number]): void;
  worldRevision(): number;
  prepareGameplayChange(inventoryChanged: boolean): PreparedMediaPlaybackParticipant & Readonly<{ revision: number }>;
  prepareFactDelivery(
    facts: readonly import('./media-playback-model').MediaPlaybackFactV1[],
    worldRevision: number,
    gameplayRevision: number,
  ): PreparedMediaPlaybackParticipant;
}>;

const operationKinds = new Map<string, MediaPlaybackActionV1['kind']>([
  [MEDIA_INSERT_OPERATION, 'insert'],
  [MEDIA_INSERT_AND_ACTIVATE_OPERATION, 'insert-and-activate'],
  [MEDIA_EJECT_OPERATION, 'eject'],
  [MEDIA_ACTIVATE_OPERATION, 'activate'],
  [MEDIA_STOP_OPERATION, 'stop'],
  [MEDIA_SWITCH_OPERATION, 'switch'],
]);

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const inputRecord = (value: ModuleInvocationValue | undefined): Readonly<Record<string, ModuleInvocationValue>> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Media playback operation input is invalid.');
  return value as Readonly<Record<string, ModuleInvocationValue>>;
};

function actionFromInput(
  raw: ModuleInvocationValue | undefined,
  kind: MediaPlaybackActionV1['kind'],
): Readonly<{ expectedRevision: number; action: MediaPlaybackActionV1 }> {
  const value = inputRecord(raw);
  const withItem = kind === 'insert' || kind === 'insert-and-activate' || kind === 'switch';
  const keys = withItem ? ['expectedRevision', 'itemId'] : ['expectedRevision'];
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key)) ||
    !Number.isSafeInteger(value.expectedRevision) ||
    (value.expectedRevision as number) < 0
  )
    throw new TypeError('Media playback operation input is invalid.');
  if (!withItem)
    return Object.freeze({
      expectedRevision: value.expectedRevision as number,
      action: Object.freeze({ kind }),
    });
  if (typeof value.itemId !== 'string') throw new TypeError('Media playback item input is invalid.');
  return Object.freeze({
    expectedRevision: value.expectedRevision as number,
    action: Object.freeze({ kind, itemId: value.itemId }),
  });
}

function validateActorSnapshot(
  options: MediaPlaybackHostCommitOptions,
  actorId: string,
): Readonly<{ actor: MediaPlaybackActorInventoryV1; inventory: ReturnType<typeof createInventoryCandidate> }> {
  const actor = options.readActor(actorId);
  if (
    !actor ||
    actor.actorId !== actorId ||
    actor.lifecycle !== 'alive' ||
    (actor.mode !== 'survival' && actor.mode !== 'creative') ||
    !Number.isSafeInteger(actor.inventoryRevision) ||
    actor.inventoryRevision < 0 ||
    !Number.isSafeInteger(actor.selectedSlot)
  )
    throw new Error('media-actor-unavailable');
  const inventory = createInventoryCandidate(options.items, actor.slots);
  if (actor.selectedSlot < 0 || actor.selectedSlot >= inventory.capacity)
    throw new TypeError('Media playback actor selection is invalid.');
  if (actor.selectedItemId !== null && typeof actor.selectedItemId !== 'string')
    throw new TypeError('Media playback selected item is invalid.');
  if (actor.mode === 'survival') {
    const selectedStorageId = inventory.slot(actor.selectedSlot)?.itemId ?? null;
    if (selectedStorageId !== actor.selectedItemId) throw new Error('media-selection-stale');
  }
  return Object.freeze({ actor, inventory });
}

function selectedMediaItemId(
  options: MediaPlaybackHostCommitOptions,
  device: MediaDeviceDefinitionV1,
  actor: MediaPlaybackActorInventoryV1,
): string {
  if (!actor.selectedItemId) throw new Error('no-selected-item');
  const matches = device.tracks.filter(
    (binding) => options.resolveItemStorageId(binding.itemId) === actor.selectedItemId,
  );
  if (matches.length !== 1) throw new Error('unsupported-media');
  return matches[0]!.itemId;
}

function prepareInventoryCandidate(
  options: MediaPlaybackHostCommitOptions,
  actor: MediaPlaybackActorInventoryV1,
  inventory: ReturnType<typeof createInventoryCandidate>,
  action: MediaPlaybackActionV1,
  current: MediaPlaybackStateV1,
): readonly InventorySlot[] {
  if (action.kind === 'insert' || action.kind === 'insert-and-activate' || action.kind === 'switch') {
    if (options.resolveItemStorageId(action.itemId) !== actor.selectedItemId) throw new Error('media-selection-stale');
    if (actor.mode === 'survival' && !inventory.removeFromSlot(actor.selectedSlot, 1))
      throw new Error('media-selection-stale');
  }
  if ((action.kind === 'eject' || action.kind === 'switch') && actor.mode === 'survival') {
    const itemId = current.slot?.itemId;
    const storageId = itemId ? options.resolveItemStorageId(itemId) : undefined;
    if (!storageId) throw new Error('unsupported-media');
    if (!inventory.add({ itemId: storageId, count: 1 })) throw new Error('inventory-full');
  }
  return Object.freeze(inventory.snapshot());
}

function assertScope(
  position: readonly [number, number, number],
  observed: readonly ObservedModState[],
  writes: readonly ModStateWrite[],
): void {
  const address = mediaPlaybackAddress({ kind: 'voxel', position });
  if (
    observed.length !== 1 ||
    writes.length !== 1 ||
    !same(observed[0]?.address, address) ||
    !same(writes[0]?.address, address)
  )
    throw new TypeError('Media playback transaction observation scope mismatch.');
}

/** Recomputes a media operation from authoritative device and actor state before preparing both owners. */
export function prepareMediaPlaybackHostCommit(
  options: MediaPlaybackHostCommitOptions,
  observed: readonly ObservedModState[],
  writes: readonly ModStateWrite[],
  execution: RegisteredCommitContext,
): PreparedRegisteredCommit {
  const kind = operationKinds.get(execution.operationId);
  const context = execution.context;
  if (
    !kind ||
    execution.resource !== MEDIA_PLAYBACK_RESOURCE ||
    context.kind !== 'actor' ||
    context.target.kind !== 'voxel'
  )
    throw new TypeError('Invalid media playback execution context.');
  const position = Object.freeze([...context.target.position]) as readonly [number, number, number];
  assertScope(position, observed, writes);
  options.validateObserved(observed);
  options.assertActorAuthorized(execution);
  options.assertTargetReachable(context.originalActorId, position);

  const device = options.media.deviceAt(position);
  const current = options.media.read(position);
  if (current.deviceId !== device.id) throw new Error('media-device-stale');
  const parsed = actionFromInput(execution.effectiveInput, kind);
  const { actor, inventory } = validateActorSnapshot(options, context.originalActorId);
  const action =
    parsed.action.kind === 'insert' || parsed.action.kind === 'insert-and-activate' || parsed.action.kind === 'switch'
      ? Object.freeze({ kind: parsed.action.kind, itemId: selectedMediaItemId(options, device, actor) })
      : parsed.action;
  const candidate = buildMediaPlaybackCandidateV1({
    model: options.model,
    device: { kind: 'voxel', position, definitionId: device.id },
    state: current,
    expectedRevision: parsed.expectedRevision,
    action,
  });
  if (!same(candidate.fact, execution.candidateValue) || !same(candidate.state, writes[0]!.value))
    throw new Error('media-playback-candidate-stale');

  const slots = prepareInventoryCandidate(options, actor, inventory, action, current);
  const inventoryChanged = !same(actor.slots, slots);
  const inventoryParticipant = options.prepareInventory({
    actorId: actor.actorId,
    expectedRevision: actor.inventoryRevision,
    slots,
  });
  const mediaParticipant = options.media.prepareReplacement(position, current, candidate.state);

  const gameplay = options.prepareGameplayChange(inventoryChanged);
  if (!Number.isSafeInteger(gameplay.revision) || gameplay.revision < 1)
    throw new RangeError('Media playback host revision is exhausted or invalid.');
  const delivery = options.prepareFactDelivery(
    Object.freeze([candidate.fact]),
    options.worldRevision(),
    gameplay.revision,
  );
  const actorSnapshot = JSON.stringify(actor);
  let validated = false;
  let used = false;
  return Object.freeze({
    ok: true as const,
    revision: gameplay.revision,
    value: candidate.fact,
    validate() {
      validated = false;
      if (used) throw new Error('Prepared media playback transaction is stale.');
      options.validateObserved(observed);
      options.assertActorAuthorized(execution);
      options.assertTargetReachable(actor.actorId, position);
      if (options.media.deviceAt(position).id !== device.id || !same(options.media.read(position), current))
        throw new Error('media-device-stale');
      if (JSON.stringify(options.readActor(actor.actorId)) !== actorSnapshot) throw new Error('media-actor-stale');
      inventoryParticipant.validate();
      mediaParticipant.validate();
      gameplay.validate();
      delivery.validate();
      validated = true;
    },
    apply() {
      if (used || !validated) throw new Error('Prepared media playback transaction requires validation.');
      used = true;
      inventoryParticipant.apply();
      mediaParticipant.apply();
      gameplay.apply();
      delivery.apply();
    },
  });
}
