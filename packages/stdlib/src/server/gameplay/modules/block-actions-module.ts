import { GAMEPLAY_CONTENT_CAPABILITIES, gameplayContentFromRegistration } from './content-capabilities';
import { STATION_RESOURCE } from './station-action-model';
import type { ModModule, ModuleInvocationValue } from '../../composition/contracts';
import { Voxel } from '../../../world/voxel';
import { createInventoryCandidate } from './inventory-api';
import type { InventorySlot } from '../inventory';
import type { ItemDefinitionRegistry } from '../item-registry';
import {
  BLOCK_ACTIONS_CAPABILITY,
  BLOCK_ACTOR_COMPONENT,
  BLOCK_ACTOR_RESOURCE,
  BLOCK_ADVANCE_OPERATION,
  BLOCK_BEGIN_OPERATION,
  BLOCK_CANCEL_OPERATION,
  BLOCK_CLOCK_RESOURCE,
  BLOCK_FINISH_OPERATION,
  BLOCK_PARTITION_SIZE,
  BLOCK_PARTITIONS,
  BLOCK_PLACE_OPERATION,
  BLOCK_SYSTEM,
  BLOCK_VOXEL_COMPONENT,
  BLOCK_VOXEL_RESOURCE,
  BLOCK_WORLD_COMPONENT,
  blockActionsCapability,
  blockActorAddress,
  blockVoxelAddress,
  blockWorldAddress,
  blockData,
  cloneBlockReference,
  cloneBlockStack,
  validateBlockActorProjection,
  validateBlockAdvanceInput,
  validateBlockPosition,
  validateBlockVoxelProjection,
  validateBlockWorldProjection,
  validateBlockBeginEffectiveInput,
  validateBlockFinishEffectiveInput,
  validateBlockPlaceEffectiveInput,
  validateBlockBreakAction,
  type BlockActionCandidateRequest,
  type BlockActionContent,
  type BlockActorCandidateV1,
  type BlockActorProjectionV1,
  type BlockAdvanceUpdateV1,
  type BlockBreakActionV1,
  type BlockDropIntentV1,
  type BlockPosition,
  type BlockVoxelEditV1,
} from './block-action-model';

const actorId = (context: Readonly<{ kind: string; originalActorId?: string }>): string => {
  if (context.kind !== 'actor' || !context.originalActorId) throw new TypeError('Block action requires an actor.');
  return context.originalActorId;
};

const targetActor = (target: unknown): string => {
  if (!target || typeof target !== 'object') throw new TypeError('Block cancel requires an entity target.');
  const value = target as { kind?: unknown; entityId?: unknown };
  if (value.kind !== 'entity' || typeof value.entityId !== 'string')
    throw new TypeError('Block cancel requires an entity target.');
  return value.entityId;
};

const targetPosition = (target: unknown) => {
  if (!target || typeof target !== 'object') throw new TypeError('Block action requires a voxel target.');
  const value = target as { kind?: unknown; position?: unknown };
  if (value.kind !== 'voxel') throw new TypeError('Block action requires a voxel target.');
  return validateBlockPosition(value.position, 'Block authorization target');
};

export function defineBlockActionsModule(options: Readonly<{ stations?: boolean }> = {}): ModModule {
  return Object.freeze({
    descriptor: {
      id: 'seedlands:block-actions-module',
      version: '1.0.0',
      requires: [
        ...(options.stations ? [{ id: 'seedlands:station-actions', version: '1.0.0' }] : []),
        ...GAMEPLAY_CONTENT_CAPABILITIES.map((id) => ({ id, version: '1.0.0' })),
      ],
      provides: [{ id: BLOCK_ACTIONS_CAPABILITY, version: '1.0.0' }],
      resources: [
        { id: BLOCK_ACTOR_RESOURCE, operations: ['read', 'execute'] },
        { id: BLOCK_VOXEL_RESOURCE, operations: ['read', 'execute'] },
        { id: BLOCK_CLOCK_RESOURCE, operations: ['read', 'execute'] },
      ],
      permissions: [
        ...(options.stations ? [{ resource: STATION_RESOURCE, operations: ['execute' as const] }] : []),
        { resource: BLOCK_ACTOR_RESOURCE, operations: ['read', 'execute'] },
        { resource: BLOCK_VOXEL_RESOURCE, operations: ['read', 'execute'] },
        { resource: BLOCK_CLOCK_RESOURCE, operations: ['read', 'execute'] },
      ],
    },
    register(api) {
      const itemCapability = api.requireCapability<ItemDefinitionRegistry>('seedlands:items');
      const contentCapabilities = gameplayContentFromRegistration(api);
      const content = () => {
        const resolved = contentCapabilities;
        for (const item of resolved.items.list())
          if (!itemCapability.has(item.id)) throw new TypeError(`Block content item capability is missing ${item.id}.`);
        return resolved;
      };
      api.provideCapability(BLOCK_ACTIONS_CAPABILITY, blockActionsCapability());
      api.registerState({
        id: BLOCK_ACTOR_COMPONENT,
        version: '1.0.0',
        resource: BLOCK_ACTOR_RESOURCE,
        validate(value) {
          try {
            validateBlockActorProjection(value, content().items);
            return true;
          } catch {
            return false;
          }
        },
      });
      api.registerState({
        id: BLOCK_VOXEL_COMPONENT,
        version: '1.0.0',
        resource: BLOCK_VOXEL_RESOURCE,
        validate(value) {
          try {
            validateBlockVoxelProjection(value);
            return true;
          } catch {
            return false;
          }
        },
      });
      api.registerState({
        id: BLOCK_WORLD_COMPONENT,
        version: '1.0.0',
        resource: BLOCK_CLOCK_RESOURCE,
        partitions: BLOCK_PARTITIONS,
        validate(value) {
          try {
            validateBlockWorldProjection(value);
            return true;
          } catch {
            return false;
          }
        },
      });
      for (const operation of [
        { kind: 'begin' as const, id: BLOCK_BEGIN_OPERATION },
        { kind: 'place' as const, id: BLOCK_PLACE_OPERATION },
        { kind: 'finish' as const, id: BLOCK_FINISH_OPERATION },
      ])
        api.registerOperation({
          id: operation.id,
          resource: BLOCK_VOXEL_RESOURCE,
          run(context, input, state) {
            const boundActorId = actorId(context);
            const position = targetPosition(context.target);
            const result = buildBlockActionCandidate(content(), {
              kind: operation.kind,
              actor: state.read(blockActorAddress(boundActorId)),
              voxel: state.read(blockVoxelAddress(position)),
              input,
            });
            if (result.actorId !== boundActorId || !result.position || !samePosition(result.position, position))
              throw new TypeError('Block candidate identity does not match its execution context.');
            return result;
          },
        });
      api.registerOperation({
        id: BLOCK_CANCEL_OPERATION,
        resource: BLOCK_ACTOR_RESOURCE,
        run(context, input, state) {
          const boundActorId = actorId(context);
          if (targetActor(context.target) !== boundActorId)
            throw new TypeError('Block cancel target must match the bound actor.');
          const result = buildBlockActionCandidate(content(), {
            kind: 'cancel',
            actor: state.read(blockActorAddress(boundActorId)),
            input,
          });
          if (result.actorId !== boundActorId)
            throw new TypeError('Block actor projection does not match the bound actor.');
          return result;
        },
      });
      api.registerOperation({
        id: BLOCK_ADVANCE_OPERATION,
        executionKind: 'system',
        resource: BLOCK_CLOCK_RESOURCE,
        run(context, input, state) {
          if (context.kind !== 'system' || context.target.kind !== 'world')
            throw new TypeError('Block advance requires its world clock.');
          const advance = validateBlockAdvanceInput(input);
          const entries: ModuleInvocationValue[] = [];
          let previous = '';
          for (let partition = 0; partition < BLOCK_PARTITIONS; partition++) {
            const projection = validateBlockWorldProjection(state.read(blockWorldAddress(partition)));
            if (projection.partition !== partition)
              throw new TypeError('Block world projection partition does not match its address.');
            for (const entry of projection.entries) {
              if (entry.reference.entityId <= previous)
                throw new TypeError('Block world projections are duplicated or globally unsorted.');
              previous = entry.reference.entityId;
              entries.push(entry as ModuleInvocationValue);
            }
          }
          buildBlockAdvanceUpdates(entries, advance);
          return Object.freeze({ version: 1 as const, kind: 'advance' as const, ...advance });
        },
      });
      api.registerSystem({ id: BLOCK_SYSTEM, operationId: BLOCK_ADVANCE_OPERATION, cadence: 'every-advance' });
    },
  } satisfies ModModule);
}

const samePosition = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const fail = (reason: string): never => {
  throw new Error(reason);
};

const freezeSlots = (items: ItemDefinitionRegistry, slots: readonly InventorySlot[]): readonly InventorySlot[] =>
  Object.freeze(slots.map((slot) => (slot ? cloneBlockStack(items, slot, true) : null)));

function actorCandidate(
  items: ItemDefinitionRegistry,
  input: Readonly<{
    kind: BlockActorCandidateV1['kind'];
    actor: BlockActorProjectionV1;
    position: BlockPosition | null;
    slots: readonly InventorySlot[];
    breakAction: BlockBreakActionV1 | null;
    voxelEdit?: BlockVoxelEditV1;
    dropIntent?: BlockDropIntentV1;
    requiredSeconds?: number;
  }>,
): BlockActorCandidateV1 {
  return Object.freeze({
    version: 1,
    kind: input.kind,
    actorId: input.actor.reference.entityId,
    actorReference: cloneBlockReference(input.actor.reference),
    position: input.position ? validateBlockPosition(input.position) : null,
    slots: input.slots,
    breakAction: input.breakAction ? validateBlockBreakAction(input.breakAction) : null,
    voxelEdit: input.voxelEdit
      ? Object.freeze({
          position: validateBlockPosition(input.voxelEdit.position),
          fromVoxel: input.voxelEdit.fromVoxel,
          toVoxel: input.voxelEdit.toVoxel,
        })
      : null,
    dropIntent: input.dropIntent
      ? Object.freeze({
          position: Object.freeze([...input.dropIntent.position]) as BlockPosition,
          stack: cloneBlockStack(items, input.dropIntent.stack, false),
        })
      : null,
    result: Object.freeze({
      version: 1,
      success: true,
      kind: input.kind,
      actorId: input.actor.reference.entityId,
      ...(input.requiredSeconds === undefined ? {} : { requiredSeconds: input.requiredSeconds }),
    }),
  });
}

/** Builds a detached candidate from effective rule input; host owners recompute it before prepare. */
export function buildBlockActionCandidate(
  content: BlockActionContent,
  request: BlockActionCandidateRequest,
): BlockActorCandidateV1 {
  const actor = validateBlockActorProjection(request.actor, content.items);
  const inventory = createInventoryCandidate(content.items, actor.slots);
  const slots = () => freezeSlots(content.items, inventory.snapshot());
  if (request.kind === 'cancel') {
    if (request.input !== undefined) throw new TypeError('Block cancel input must be omitted.');
    return actorCandidate(content.items, { kind: 'cancel', actor, position: null, slots: slots(), breakAction: null });
  }
  if (actor.lifecycle !== 'alive') fail('actor-dead');
  const target = validateBlockVoxelProjection(request.voxel);
  if (request.kind === 'begin') {
    const effective = validateBlockBeginEffectiveInput(request.input);
    if (!samePosition(target.position, effective.position) || target.voxel !== effective.expectedVoxel)
      fail('block-target-changed');
    if (actor.mode.revision !== effective.modeRevision || (actor.mode.value === 'creative') !== effective.creative)
      fail('block-mode-changed');
    if (effective.creative)
      return actorCandidate(content.items, {
        kind: 'begin',
        actor,
        position: target.position,
        slots: slots(),
        breakAction: null,
        voxelEdit: { position: target.position, fromVoxel: target.voxel, toVoxel: Voxel.Air },
        requiredSeconds: 0,
      });
    const current = actor.breakAction;
    const retained = current && current.voxel === target.voxel && samePosition(current.position, target.position);
    const next = retained
      ? current
      : Object.freeze({
          position: validateBlockPosition(target.position),
          voxel: target.voxel,
          elapsedSeconds: 0,
          requiredSeconds: effective.requiredSeconds,
        });
    return actorCandidate(content.items, {
      kind: 'begin',
      actor,
      position: target.position,
      slots: slots(),
      breakAction: next,
      requiredSeconds: next.requiredSeconds,
    });
  }
  if (request.kind === 'place') {
    const effective = validateBlockPlaceEffectiveInput(request.input);
    if (!samePosition(target.position, effective.position) || target.voxel !== effective.expectedVoxel)
      fail('block-target-changed');
    if (actor.mode.revision !== effective.modeRevision) fail('block-mode-changed');
    const place = content.items.capability(effective.itemId, 'place');
    if (!place || place.voxel !== effective.placedVoxel) fail('item-not-placeable');
    if (actor.mode.value === 'creative') {
      if (
        effective.consumeCount !== 0 ||
        actor.creativeCatalog.hotbar[actor.creativeCatalog.selectedSlot] !== effective.itemId
      )
        fail('block-selection-changed');
    } else {
      const selected = inventory.slot(actor.equipment.selectedSlot);
      if (
        effective.consumeCount !== 1 ||
        selected?.itemId !== effective.itemId ||
        !inventory.removeFromSlot(actor.equipment.selectedSlot, 1)
      )
        fail('block-selection-changed');
    }
    return actorCandidate(content.items, {
      kind: 'place',
      actor,
      position: target.position,
      slots: slots(),
      breakAction: actor.breakAction,
      voxelEdit: { position: target.position, fromVoxel: target.voxel, toVoxel: effective.placedVoxel },
    });
  }
  const effective = validateBlockFinishEffectiveInput(request.input, content.items);
  const current = actor.breakAction;
  if (!current) throw new Error('no-break-action');
  if (
    !samePosition(target.position, effective.position) ||
    !samePosition(current.position, target.position) ||
    target.voxel !== effective.expectedVoxel ||
    current.voxel !== target.voxel
  )
    fail('block-target-changed');
  if (actor.mode.revision !== effective.modeRevision || (actor.mode.value === 'creative') !== effective.creative)
    fail('block-mode-changed');
  if (current.elapsedSeconds + Number.EPSILON < current.requiredSeconds) fail('break-not-ready');
  if (effective.toolWear === 1) {
    const slot = actor.equipment.selectedSlot;
    const selected = inventory.slot(slot);
    if (!selected?.instance || !content.items.capability(selected.itemId, 'mine'))
      throw new Error('invalid-mining-tool-wear');
    const next = inventory.snapshot();
    next[slot] =
      selected.instance.durability === 1
        ? null
        : {
            ...selected,
            instance: { durability: selected.instance.durability - 1 },
          };
    inventory.replace(next);
  }
  const dropIntent = effective.drop
    ? { position: target.position.map((value) => value + 0.5) as [number, number, number], stack: effective.drop }
    : undefined;
  return actorCandidate(content.items, {
    kind: 'finish',
    actor,
    position: target.position,
    slots: slots(),
    breakAction: null,
    voxelEdit: { position: target.position, fromVoxel: target.voxel, toVoxel: Voxel.Air },
    dropIntent,
  });
}

export function buildBlockAdvanceUpdates(
  rawEntries: readonly unknown[],
  rawInput: unknown,
): readonly BlockAdvanceUpdateV1[] {
  if (!Array.isArray(rawEntries) || rawEntries.length > BLOCK_PARTITIONS * BLOCK_PARTITION_SIZE)
    throw new TypeError('Block advance entries are invalid.');
  const input = validateBlockAdvanceInput(rawInput);
  const cancellations = new Set(input.cancelActorIds);
  const seen = new Set<string>();
  const updates: BlockAdvanceUpdateV1[] = [];
  for (const raw of rawEntries) {
    const entry = blockData(raw, ['reference', 'breakAction'], 'Block advance entry');
    const reference = cloneBlockReference(entry.reference);
    if (seen.has(reference.entityId)) throw new TypeError('Block advance actor is duplicated.');
    seen.add(reference.entityId);
    if (entry.breakAction === null) continue;
    const previous = validateBlockBreakAction(entry.breakAction);
    const cancelled = cancellations.delete(reference.entityId);
    const elapsedSeconds = Math.min(
      previous.requiredSeconds,
      (Math.round(previous.elapsedSeconds * 1e9) + Math.round(input.seconds * 1e9)) / 1e9,
    );
    const next = cancelled
      ? null
      : validateBlockBreakAction({
          position: previous.position,
          voxel: previous.voxel,
          elapsedSeconds,
          requiredSeconds: previous.requiredSeconds,
          ...(previous.origin ? { origin: previous.origin } : {}),
        });
    updates.push(
      Object.freeze({
        reference,
        previous,
        next,
        ready: Boolean(next && next.elapsedSeconds + Number.EPSILON >= next.requiredSeconds),
      }),
    );
  }
  if (cancellations.size) fail('unknown-cancel-actor');
  return Object.freeze(updates);
}
