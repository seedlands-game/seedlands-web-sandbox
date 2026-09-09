import { assertActorResourceExecution } from '../../composition/secondary-resource-authorization';
import { buildBlockActionCandidate, buildBlockAdvanceUpdates } from './block-actions-module';
import type { WorldComposition, ModuleInvocationValue } from '../../composition/contracts';
import type { ModuleActorAuthority } from '../../composition/gameplay-actor-authority';
import type {
  ObservedModState,
  PreparedRegisteredCommit,
  RegisteredCommitContext,
} from '../../composition/operation-contracts';
import type { PreparedWorldEdit } from '../../prepared-world-edit';
import type { WorldCommitResult } from '../../game-server-types';
import type { AutonomyRuntime } from '../../simulation/autonomy-runtime';
import type { EntityStore } from '../entity-store';
import type { GameplayContent } from '../gameplay-content';
import type { BreakAction } from '../player-state';
import { prepareEntityMutation } from '../prepared-entity-mutation';
import { positionsInRange, voxelCenter } from '../gameplay-geometry';
import { playerOccupiesVoxelShape } from '../player-occupancy';
import type { createBlockStatePort } from './block-state-port';
import type { createBlockOriginEnvironment } from './block-origin-environment';
import {
  BLOCK_BEGIN_OPERATION,
  BLOCK_CANCEL_OPERATION,
  BLOCK_PLACE_OPERATION,
  BLOCK_FINISH_OPERATION,
  BLOCK_ADVANCE_OPERATION,
  BLOCK_ACTOR_RESOURCE,
  BLOCK_VOXEL_RESOURCE,
  BLOCK_CLOCK_RESOURCE,
  BLOCK_PARTITIONS,
  BLOCK_SYSTEM,
  blockActorAddress,
  blockVoxelAddress,
  blockWorldAddress,
  validateBlockAdvanceInput,
  type BlockBreakActionV1,
} from './block-action-model';

type Participant = Readonly<{ validate(): void; apply(): void }>;
export type BlockHostOptions = Readonly<{
  composition: WorldComposition;
  entities: EntityStore;
  content: GameplayContent;
  actorAuthority?: ModuleActorAuthority;
  simulation(): AutonomyRuntime;
  getVoxel(position: [number, number, number]): number | undefined;
  prepareVoxelEdit(actorId: string, position: [number, number, number], voxel: number): PreparedWorldEdit;
  revision(): number;
  assertCanChange(): void;
  changed(inventory: boolean): void;
}>;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const breakState = (value: BlockBreakActionV1 | null): BreakAction | null =>
  value ? { ...value, position: [...value.position] } : null;
const operations = new Map<string, 'begin' | 'cancel' | 'place' | 'finish'>([
  [BLOCK_BEGIN_OPERATION, 'begin'],
  [BLOCK_CANCEL_OPERATION, 'cancel'],
  [BLOCK_PLACE_OPERATION, 'place'],
  [BLOCK_FINISH_OPERATION, 'finish'],
] as const);

export function prepareRegisteredBlockCommit(
  options: BlockHostOptions,
  projections: ReturnType<typeof createBlockStatePort>,
  origins: ReturnType<typeof createBlockOriginEnvironment>,
  prepareReceipt: (commit: WorldCommitResult) => Participant,
  observed: readonly ObservedModState[],
  execution: RegisteredCommitContext,
): PreparedRegisteredCommit {
  const expected = (addresses: readonly object[]) => {
    if (
      addresses.length !== observed.length ||
      addresses.some((address) => !observed.some((entry) => same(entry.address, address)))
    )
      throw new TypeError('Block transaction observation scope mismatch.');
  };
  const finalize = (
    parts: readonly Participant[],
    value: ModuleInvocationValue,
    changed: boolean,
    inventory = false,
    validateCondition?: () => void,
  ): PreparedRegisteredCommit => {
    const revision = options.revision();
    if (changed) options.assertCanChange();
    let validated = false,
      used = false;
    return {
      ok: true,
      value,
      revision: revision + Number(changed),
      validate() {
        validated = false;
        if (used || revision !== options.revision()) throw new Error('Prepared Block transaction is stale.');
        if (changed) options.assertCanChange();
        validateCondition?.();
        for (const part of parts) part.validate();
        validated = true;
      },
      apply() {
        if (used || !validated) throw new Error('Prepared Block transaction requires validation.');
        used = true;
        for (const part of parts) part.apply();
        if (changed) options.changed(inventory);
      },
    };
  };
  const context = execution.context;
  if (execution.operationId === BLOCK_ADVANCE_OPERATION) {
    if (
      context.kind !== 'system' ||
      context.systemId !== BLOCK_SYSTEM ||
      context.target.kind !== 'world' ||
      execution.resource !== BLOCK_CLOCK_RESOURCE
    )
      throw new TypeError('Block advance requires its registered world system.');
    expected(Array.from({ length: BLOCK_PARTITIONS }, (_, index) => blockWorldAddress(index)));
    const input = validateBlockAdvanceInput(execution.effectiveInput);
    if (!same(execution.candidateValue, { version: 1, kind: 'advance', ...input }))
      throw new TypeError('Invalid Block advance candidate.');
    const entries = Array.from({ length: BLOCK_PARTITIONS }, (_, index) => projections.world(index).entries).flat();
    const updates = buildBlockAdvanceUpdates(entries, input).filter((update) => !same(update.previous, update.next));
    const mutation = updates.length
      ? prepareEntityMutation(options.entities, {
          actors: updates.map((update) => {
            const id = update.reference.entityId,
              components = options.entities.actorComponentSnapshot(id);
            return {
              reference: update.reference,
              health: options.entities.playerStateAccess(id).health,
              components: { ...components, player: { ...components.player!, breakAction: breakState(update.next) } },
            };
          }),
        })
      : undefined;
    return finalize(
      mutation ? [mutation] : [],
      { success: true, advancedSeconds: input.seconds, cancelled: input.cancelActorIds.length },
      updates.length > 0,
    );
  }
  const kind = operations.get(execution.operationId);
  if (!kind || context.kind !== 'actor') throw new TypeError('Unknown Block actor operation.');
  const id = context.originalActorId;
  if (kind === 'cancel') {
    if (
      context.target.kind !== 'entity' ||
      context.target.entityId !== id ||
      execution.resource !== BLOCK_ACTOR_RESOURCE
    )
      throw new TypeError('Block cancellation requires its actor target.');
  } else if (context.target.kind !== 'voxel' || execution.resource !== BLOCK_VOXEL_RESOURCE) {
    throw new TypeError('Block operation requires a voxel target.');
  }
  const validateActorExecution = () =>
    assertActorResourceExecution(options.composition, execution.authorizer, context, BLOCK_ACTOR_RESOURCE);
  validateActorExecution();
  const target = context.target.kind === 'voxel' ? context.target.position : null;
  expected([blockActorAddress(id), ...(target ? [blockVoxelAddress(target)] : [])]);
  const actor = projections.actor(id);
  const candidate = buildBlockActionCandidate(
    options.content,
    kind === 'cancel'
      ? { kind, actor, input: execution.effectiveInput }
      : { kind, actor, voxel: projections.voxel(target!), input: execution.effectiveInput },
  );
  if (!same(candidate, execution.candidateValue) || !same(candidate.position, target))
    throw new TypeError('Block candidate differs from current state and effective input.');
  let nextBreak = breakState(candidate.breakAction);
  const origin = kind === 'begin' && nextBreak ? origins.capture(execution) : undefined;
  if (origin && nextBreak) nextBreak = { ...nextBreak, origin };
  if (kind === 'finish') {
    if (!actor.breakAction?.origin || !same(origins.capture(execution), actor.breakAction.origin))
      throw new TypeError('Block completion must use the accepted action origin.');
  }
  const validateCondition = () => {
    validateActorExecution();
    if (target) {
      const entity = options.entities.get(id);
      if (!entity || !positionsInRange(entity.position, voxelCenter([...target]), 5)) throw new Error('out-of-range');
      if (
        kind === 'place' &&
        candidate.voxelEdit &&
        playerOccupiesVoxelShape(entity.position, [...target], candidate.voxelEdit.toVoxel)
      )
        throw new Error('player-collision');
      if (origin) origins.resolve(origin, target);
      if (kind === 'finish') origins.resolve(actor.breakAction!.origin!, target);
    }
  };
  validateCondition();
  const components = options.entities.actorComponentSnapshot(id);
  const world = candidate.voxelEdit
    ? options.prepareVoxelEdit(id, [...candidate.voxelEdit.position], candidate.voxelEdit.toVoxel)
    : undefined;
  if (world && !world.committed) throw new Error('world-not-changed');
  const inventoryChanged = !same(actor.slots, candidate.slots);
  const changed = Boolean(world) || inventoryChanged || !same(actor.breakAction, nextBreak);
  const mutation = prepareEntityMutation(options.entities, {
    actors: [
      {
        reference: candidate.actorReference,
        health: options.entities.playerStateAccess(id).health,
        components: {
          ...components,
          inventory: [...candidate.slots],
          player: { ...components.player!, breakAction: nextBreak },
        },
      },
    ],
    spawns: candidate.dropIntent
      ? [{ position: [...candidate.dropIntent.position], stack: candidate.dropIntent.stack }]
      : [],
  });
  const equippedChanged = !same(
    actor.slots[actor.equipment.selectedSlot],
    candidate.slots[actor.equipment.selectedSlot],
  );
  const cancellation = equippedChanged ? options.simulation().prepareCancellation([id], 'slot-changed') : undefined;
  const receipt = world ? prepareReceipt(world.result) : undefined;
  const parts: Participant[] = [
    mutation,
    ...(cancellation ? [cancellation] : []),
    ...(world ? [world] : []),
    ...(receipt ? [receipt] : []),
  ];
  return finalize(
    parts,
    { ...candidate.result, ...(world ? { commit: { worldRevision: world.result.worldRevision } } : {}) },
    changed,
    inventoryChanged,
    validateCondition,
  );
}
