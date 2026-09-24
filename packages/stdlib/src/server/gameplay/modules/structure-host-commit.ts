import type { ModuleInvocationValue, WorldComposition } from '../../composition/contracts';
import type {
  ObservedModState,
  PreparedRegisteredCommit,
  RegisteredCommitContext,
} from '../../composition/operation-contracts';
import { assertActorResourceExecution } from '../../composition/secondary-resource-authorization';
import type { ContentItemIdentityResolver } from '../../composition/content-item-identity';
import type { WorldCommitResult } from '../../game-server-types';
import type { ExpectedWorldVoxelEdit, PreparedWorldEditBatch } from '../../world-transaction-commit';
import type { VoxelGeometryRegistryV1 } from '../../../world/voxel-geometry';
import type { VoxelSemanticsRegistry } from '../../../world/voxel-semantics';
import type { EntityStore } from '../entity-store';
import { createInventoryCandidate } from './inventory-api';
import type { InventorySlot } from '../inventory';
import { prepareEntityMutation } from '../prepared-entity-mutation';
import { positionsInRange, voxelCenter } from '../gameplay-geometry';
import { traceVoxelRay } from '../voxel-ray';
import {
  STRUCTURE_BREAK_OPERATION,
  STRUCTURE_PLACE_OPERATION,
  STRUCTURE_RESOURCE,
  STRUCTURE_TOGGLE_OPERATION,
  buildRegisteredStructureCandidateV1,
  structureActorAddress,
  structureVoxelAddress,
  validateStructureActionTargetV1,
  type StructureActionEnvironmentV1,
  type StructureActionPolicyV1,
} from './structure-actions-module';
import type { StructureDefinitionRegistryV1 } from './structure-definition-module';
import type { StructureOperationPlanV1 } from './structure-operation-model';
import type { StructurePositionV1 } from './structure-definition';
import type { StructureStateProjectionsV1 } from './structure-state-port';

export type PreparedStructureParticipant = Readonly<{
  /** Must complete all external, capacity, and stale checks. */
  validate(): void;
  /** Commits only captured in-memory state and must not call external code or allocate fallibly. */
  apply(): void;
}>;
export type PreparedStructureDependentRemovalV1 = PreparedStructureParticipant &
  Readonly<{
    removed: boolean;
    ejectedItem: Readonly<{ itemId: string }> | null;
  }>;
export type StructureHostCommitOptions = Readonly<{
  composition: WorldComposition;
  registry: StructureDefinitionRegistryV1;
  identity: ContentItemIdentityResolver;
  semantics: VoxelSemanticsRegistry;
  geometry: VoxelGeometryRegistryV1;
  policy: StructureActionPolicyV1;
  entities: EntityStore;
  readCell(position: StructurePositionV1): Readonly<{ voxel: number; fluid: number }> | null;
  prepareVoxelEdits(actorId: string, edits: readonly ExpectedWorldVoxelEdit[]): PreparedWorldEditBatch;
  prepareCancellation(actorId: string): PreparedStructureParticipant;
  prepareDependentRemoval(position: StructurePositionV1): PreparedStructureDependentRemovalV1;
  prepareReceipt(commit: WorldCommitResult): PreparedStructureParticipant;
  prepareGameplayChange(
    inventoryChanged: boolean,
    precedingWorldCommit: WorldCommitResult,
  ): PreparedStructureParticipant & Readonly<{ revision: number }>;
}>;

const operations = new Map<string, StructureOperationPlanV1['kind']>([
  [STRUCTURE_PLACE_OPERATION, 'place'],
  [STRUCTURE_TOGGLE_OPERATION, 'toggle'],
  [STRUCTURE_BREAK_OPERATION, 'break'],
]);
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const positionKey = (position: StructurePositionV1): string => position.join(',');

function expectedScope(
  actorId: string,
  readPositions: readonly StructurePositionV1[],
  observed: readonly ObservedModState[],
): void {
  const addresses = [
    structureActorAddress(actorId),
    ...[...new Map(readPositions.map((position) => [positionKey(position), position])).values()].map(
      structureVoxelAddress,
    ),
  ];
  if (
    addresses.length !== observed.length ||
    addresses.some((address) => !observed.some((entry) => same(entry.address, address)))
  )
    throw new TypeError('Structure transaction observation scope mismatch.');
}

function assertReachable(
  actorPosition: readonly [number, number, number],
  target: Readonly<{ hit: StructurePositionV1; adjacent: StructurePositionV1 }>,
  readCell: StructureHostCommitOptions['readCell'],
  semantics: VoxelSemanticsRegistry,
): void {
  for (const position of [target.hit, target.adjacent]) {
    if (!positionsInRange(actorPosition, voxelCenter([...position]), 5)) throw new Error('out-of-range');
    const visibility = traceVoxelRay(
      voxelCenter([...position]),
      actorPosition,
      (x, y, z) => readCell([x, y, z])?.voxel,
      (voxel) => semantics.get(voxel)?.solid ?? false,
    );
    if (visibility !== 'clear') throw new Error(visibility === 'unavailable' ? 'chunk-unavailable' : 'blocked');
  }
}

function prepareInventory(
  options: StructureHostCommitOptions,
  plan: StructureOperationPlanV1,
  actor: ReturnType<StructureStateProjectionsV1['actor']>,
): readonly InventorySlot[] {
  const candidate = createInventoryCandidate(options.entities.items, actor.slots);
  if (plan.consume) {
    const storageId = options.identity.storageIdForDefinitionId(plan.consume.itemDefinitionId);
    const selected = candidate.slot(actor.selectedSlot);
    if (!storageId || selected?.itemId !== storageId || !candidate.removeFromSlot(actor.selectedSlot, 1))
      throw new Error('structure-selection-stale');
  }
  if (plan.kind === 'break' && actor.mode.value === 'survival') {
    const definition = options.registry.require(plan.definitionId);
    const selected = candidate.slot(actor.selectedSlot);
    const wear = options.policy.breakToolWear?.(definition, selected) ?? 0;
    if (wear !== 0 && wear !== 1) throw new TypeError('Structure break tool wear is invalid.');
    if (wear === 1) {
      if (!selected?.instance || !options.entities.items.require(selected.itemId).durability)
        throw new Error('structure-selection-stale');
      const replacement =
        selected.instance.durability === 1
          ? null
          : { ...selected, instance: { durability: selected.instance.durability - 1 } };
      const slots = candidate.snapshot();
      slots[actor.selectedSlot] = replacement;
      candidate.replace(slots);
    }
  }
  return Object.freeze(candidate.snapshot());
}

function worldEdits(
  projections: StructureStateProjectionsV1,
  plan: StructureOperationPlanV1,
): readonly ExpectedWorldVoxelEdit[] {
  return Object.freeze(
    plan.edits.map((edit) => {
      const current = projections.voxel(edit.position);
      if (current.voxel !== edit.expected) throw new Error('structure-stale');
      return Object.freeze({
        x: edit.position[0],
        y: edit.position[1],
        z: edit.position[2],
        expectedVoxel: current.voxel,
        expectedFluid: current.fluid,
        value: edit.to,
      });
    }),
  );
}

/** Recomputes a Structure operation from current authoritative projections before preparing every owner. */
export function prepareStructureHostCommit(
  options: StructureHostCommitOptions,
  projections: StructureStateProjectionsV1,
  observed: readonly ObservedModState[],
  execution: RegisteredCommitContext,
): PreparedRegisteredCommit {
  const kind = operations.get(execution.operationId);
  const context = execution.context;
  if (!kind || execution.resource !== STRUCTURE_RESOURCE || context.kind !== 'actor' || context.target.kind !== 'voxel')
    throw new TypeError('Invalid Structure execution context.');
  const actorId = context.originalActorId;
  const assertAuthorized = () =>
    assertActorResourceExecution(options.composition, execution.authorizer, context, STRUCTURE_RESOURCE);
  assertAuthorized();
  const action = validateStructureActionTargetV1(execution.effectiveInput);
  const target = Object.freeze([...context.target.position]) as StructurePositionV1;
  const readPositions: StructurePositionV1[] = [];
  const actor = projections.actor(actorId);
  assertReachable(actor.position, action, options.readCell, options.semantics);
  const read = (position: StructurePositionV1) => {
    readPositions.push(position);
    return projections.voxel(position).voxel;
  };
  const environment: StructureActionEnvironmentV1 = {
    registry: options.registry,
    identity: options.identity,
    semantics: options.semantics,
    geometry: options.geometry,
    policy: options.policy,
  };
  const plan = buildRegisteredStructureCandidateV1(environment, { kind, actor, target, action, read });
  expectedScope(actorId, readPositions, observed);
  if (!same(plan, execution.candidateValue)) throw new Error('structure-candidate-stale');

  const edits = worldEdits(projections, plan);
  const slots = prepareInventory(options, plan, actor);
  const inventoryChanged = !same(slots, actor.slots);
  const removals = kind === 'break' ? plan.edits.map((edit) => options.prepareDependentRemoval(edit.position)) : [];
  const spawns = [
    ...(plan.drop
      ? [
          {
            position: plan.drop.position,
            stack: {
              itemId:
                options.identity.storageIdForDefinitionId(plan.drop.itemDefinitionId) ??
                (() => {
                  throw new Error('structure-drop-identity-missing');
                })(),
              count: plan.drop.count,
            },
          },
        ]
      : []),
    ...removals.flatMap((removal, index) => {
      if (!removal.ejectedItem) return [];
      const itemId = options.identity.storageIdForDefinitionId(removal.ejectedItem.itemId);
      if (!itemId) throw new Error('structure-dependent-item-identity-missing');
      return [{ position: plan.edits[index]!.position, stack: { itemId, count: 1 } }];
    }),
  ];
  const components = options.entities.actorComponentSnapshot(actorId);
  const breakCancelled = components.player?.breakAction !== null && components.player?.breakAction !== undefined;
  const mutation =
    inventoryChanged || breakCancelled || spawns.length
      ? prepareEntityMutation(options.entities, {
          ...(inventoryChanged || breakCancelled
            ? {
                actors: [
                  {
                    reference: actor.reference,
                    health: options.entities.playerStateAccess(actorId).health,
                    components: {
                      ...components,
                      inventory: [...slots],
                      ...(components.player ? { player: { ...components.player, breakAction: null } } : {}),
                    },
                  },
                ],
              }
            : {}),
          ...(spawns.length ? { spawns } : {}),
        })
      : undefined;
  const cancellation = inventoryChanged || breakCancelled ? options.prepareCancellation(actorId) : undefined;
  const world = options.prepareVoxelEdits(actorId, edits);
  if (!world.result.committed) throw new Error('world-not-changed');
  const receipt = options.prepareReceipt(world.result);
  const gameplay = options.prepareGameplayChange(inventoryChanged, world.result);
  if (!Number.isSafeInteger(gameplay.revision) || gameplay.revision < 1)
    throw new RangeError('Structure gameplay revision is exhausted or invalid.');
  const participants: readonly PreparedStructureParticipant[] = [
    ...(mutation ? [{ validate: mutation.validate, apply: () => void mutation.apply() }] : []),
    ...(cancellation ? [cancellation] : []),
    ...removals,
    world,
    receipt,
    gameplay,
  ];
  const validateCondition = () => {
    assertAuthorized();
    const current = projections.actor(actorId);
    if (!same(current, actor)) throw new Error('structure-actor-stale');
    assertReachable(current.position, action, options.readCell, options.semantics);
    const repeatedPositions: StructurePositionV1[] = [];
    const repeated = buildRegisteredStructureCandidateV1(environment, {
      kind,
      actor: current,
      target,
      action,
      read(position) {
        repeatedPositions.push(position);
        return projections.voxel(position).voxel;
      },
    });
    expectedScope(actorId, repeatedPositions, observed);
    if (!same(repeated, plan)) throw new Error('structure-candidate-stale');
  };
  let validated = false;
  let used = false;
  return Object.freeze({
    ok: true as const,
    revision: gameplay.revision,
    value: Object.freeze({
      version: 1,
      success: true,
      kind,
      definitionId: plan.definitionId,
      root: plan.root,
      commit: Object.freeze({ worldRevision: world.result.worldRevision }),
    }) as ModuleInvocationValue,
    validate() {
      validated = false;
      if (used) throw new Error('Prepared Structure transaction is stale.');
      validateCondition();
      for (const participant of participants) participant.validate();
      validated = true;
    },
    apply() {
      if (used || !validated) throw new Error('Prepared Structure transaction requires validation.');
      used = true;
      for (const participant of participants) participant.apply();
    },
  });
}
