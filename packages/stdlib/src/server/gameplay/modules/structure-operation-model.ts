import { Voxel } from '../../../world/voxel';
import { buildStructureTransitionCandidateV1, type StructureVoxelEditCandidateV1 } from './structure-multi-edit-model';
import {
  structureFootprintV1,
  type ResolvedStructureV1,
  type StructureCellReaderV1,
  type StructurePositionV1,
} from './structure-definition';
import type { StructureDefinitionRegistryV1 } from './structure-definition-module';
import { resolveStructureTargetIntentV1 } from './structure-target-dispatch';

export type StructureOperationFailure =
  | 'structure-definition-missing'
  | 'structure-state-invalid'
  | 'structure-unavailable'
  | 'structure-malformed'
  | 'structure-target-occupied'
  | 'structure-support-invalid'
  | 'structure-player-collision'
  | 'structure-stale'
  | 'structure-transition-invalid';

export class StructureOperationModelError extends Error {
  constructor(readonly code: StructureOperationFailure) {
    super(code);
    this.name = 'StructureOperationModelError';
  }
}

export type StructureOperationActorV1 = Readonly<{ actorId: string; mode: 'survival' | 'creative' }>;
export type StructurePlaceActorV1 = StructureOperationActorV1 & Readonly<{ selectedItemDefinitionId: string }>;
export type StructureDropIntentV1 = Readonly<{
  ownerRole: string;
  position: StructurePositionV1;
  itemDefinitionId: string;
  count: number;
}>;
export type StructureOperationPlanV1 = Readonly<{
  version: 1;
  kind: 'place' | 'toggle' | 'break';
  actorId: string;
  mode: StructureOperationActorV1['mode'];
  definitionId: string;
  root: StructurePositionV1;
  fromState: string | null;
  toState: string | null;
  transitionId: string | null;
  edits: readonly StructureVoxelEditCandidateV1[];
  consume: Readonly<{ itemDefinitionId: string; count: 1 }> | null;
  drop: StructureDropIntentV1 | null;
  support: Readonly<{ position: StructurePositionV1; expected: number }> | null;
}>;

function fail(code: StructureOperationFailure): never {
  throw new StructureOperationModelError(code);
}
const frozenPosition = (position: readonly number[]): StructurePositionV1 =>
  Object.freeze([position[0]!, position[1]!, position[2]!]);
const supportPosition = (root: StructurePositionV1, offset: readonly [number, number, number]) =>
  frozenPosition(root.map((value, axis) => value + offset[axis]));
const freezeEdit = (edit: StructureVoxelEditCandidateV1) =>
  Object.freeze({ ...edit, position: frozenPosition(edit.position) });
const freezePlan = (plan: StructureOperationPlanV1): StructureOperationPlanV1 =>
  Object.freeze({
    ...plan,
    root: frozenPosition(plan.root),
    edits: Object.freeze(plan.edits.map(freezeEdit)),
    ...(plan.consume ? { consume: Object.freeze({ ...plan.consume }) } : {}),
    ...(plan.drop ? { drop: Object.freeze({ ...plan.drop, position: frozenPosition(plan.drop.position) }) } : {}),
    ...(plan.support
      ? { support: Object.freeze({ ...plan.support, position: frozenPosition(plan.support.position) }) }
      : {}),
  });
const resolvedTarget = (
  registry: StructureDefinitionRegistryV1,
  hit: StructurePositionV1,
  read: StructureCellReaderV1,
): ResolvedStructureV1 => {
  const result = resolveStructureTargetIntentV1(registry, hit, read);
  if (result.status === 'unavailable') throw new StructureOperationModelError('structure-unavailable');
  if (result.status !== 'resolved') throw new StructureOperationModelError('structure-malformed');
  return result.structure;
};
const requireValue = <Value>(value: Value | undefined, code: StructureOperationFailure): Value => {
  if (value === undefined) throw new StructureOperationModelError(code);
  return value;
};
const transitionCandidate = (
  definition: ReturnType<StructureDefinitionRegistryV1['require']>,
  input: Parameters<typeof buildStructureTransitionCandidateV1>[1],
) => {
  try {
    return buildStructureTransitionCandidateV1(definition, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/candidate read is unknown/i.test(message)) throw new StructureOperationModelError('structure-unavailable');
    if (/stale/i.test(message)) throw new StructureOperationModelError('structure-stale');
    throw new StructureOperationModelError('structure-transition-invalid');
  }
};

export function buildStructurePlaceCandidateV1(
  registry: StructureDefinitionRegistryV1,
  input: Readonly<{
    actor: StructurePlaceActorV1;
    root: StructurePositionV1;
    stateId: string;
    read: StructureCellReaderV1;
    isReplaceable(voxel: number): boolean;
    isSolid(voxel: number): boolean;
    collides(position: StructurePositionV1, voxel: number): boolean;
  }>,
): StructureOperationPlanV1 {
  const definition = requireValue(
    registry.resolvePlacementItem(input.actor.selectedItemDefinitionId),
    'structure-definition-missing',
  );
  const state = requireValue(
    definition.states.find(({ id }) => id === input.stateId),
    'structure-state-invalid',
  );
  const footprint = structureFootprintV1(definition, input.root, state.id);
  const edits = footprint.map((part) => {
    const expected = requireValue(input.read(part.position), 'structure-unavailable');
    if (!input.isReplaceable(expected)) fail('structure-target-occupied');
    if (state.collision[part.role] === 'blocking' && input.collides(part.position, part.voxel))
      fail('structure-player-collision');
    return freezeEdit({
      role: part.role,
      position: part.position,
      chunkKey: part.chunkKey,
      expected,
      from: expected,
      to: part.voxel,
    });
  });
  const at = supportPosition(input.root, definition.support.offset);
  const support = requireValue(input.read(at), 'structure-unavailable');
  if (!input.isSolid(support)) fail('structure-support-invalid');
  return freezePlan({
    version: 1,
    kind: 'place',
    actorId: input.actor.actorId,
    mode: input.actor.mode,
    definitionId: definition.id,
    root: input.root,
    fromState: null,
    toState: state.id,
    transitionId: null,
    edits,
    consume:
      input.actor.mode === 'survival'
        ? Object.freeze({ itemDefinitionId: definition.placementItemId, count: 1 as const })
        : null,
    drop: null,
    support: Object.freeze({ position: at, expected: support }),
  });
}

export function buildStructureToggleCandidateV1(
  registry: StructureDefinitionRegistryV1,
  input: Readonly<{
    actor: StructureOperationActorV1;
    hit: StructurePositionV1;
    transitionId: string;
    read: StructureCellReaderV1;
    collides(position: StructurePositionV1, voxel: number): boolean;
  }>,
): StructureOperationPlanV1 {
  const current = resolvedTarget(registry, input.hit, input.read);
  const definition = registry.require(current.definitionId);
  const candidate = transitionCandidate(definition, {
    current,
    transitionId: input.transitionId,
    read: input.read,
  });
  const state = definition.states.find(({ id }) => id === candidate.toState)!;
  if (
    candidate.edits.some((edit) => state.collision[edit.role] === 'blocking' && input.collides(edit.position, edit.to))
  )
    fail('structure-player-collision');
  return freezePlan({
    version: 1,
    kind: 'toggle',
    actorId: input.actor.actorId,
    mode: input.actor.mode,
    definitionId: definition.id,
    root: candidate.root,
    fromState: candidate.fromState,
    toState: candidate.toState,
    transitionId: candidate.transitionId,
    edits: candidate.edits,
    consume: null,
    drop: null,
    support: null,
  });
}

export function buildStructureBreakCandidateV1(
  registry: StructureDefinitionRegistryV1,
  input: Readonly<{ actor: StructureOperationActorV1; hit: StructurePositionV1; read: StructureCellReaderV1 }>,
): StructureOperationPlanV1 {
  const current = resolvedTarget(registry, input.hit, input.read);
  const definition = registry.require(current.definitionId);
  const edits = current.parts.map((part) =>
    freezeEdit({
      role: part.role,
      position: part.position,
      chunkKey: part.chunkKey,
      expected: part.voxel,
      from: part.voxel,
      to: Voxel.Air,
    }),
  );
  const owner = current.parts.find(({ role }) => role === definition.dropOwnerRole)!;
  return freezePlan({
    version: 1,
    kind: 'break',
    actorId: input.actor.actorId,
    mode: input.actor.mode,
    definitionId: definition.id,
    root: current.root,
    fromState: current.stateId,
    toState: null,
    transitionId: null,
    edits,
    consume: null,
    drop:
      input.actor.mode === 'survival'
        ? Object.freeze({
            ownerRole: owner.role,
            position: owner.position,
            itemDefinitionId: definition.drop.itemId,
            count: definition.drop.count,
          })
        : null,
    support: null,
  });
}
