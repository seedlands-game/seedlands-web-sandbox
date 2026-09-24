import { CHUNK_SIZE, chunkKey, floorDiv } from '../../../world/voxel';
import type { ContentItemIdentityResolver } from '../../composition/content-item-identity';
import type { ItemInteractionExpectedSelectionV1, ItemInteractionTarget } from './item-interaction-module';
import { structureFootprintV1, type ResolvedStructureV1, type StructurePositionV1 } from './structure-definition';
import type { StructureDefinitionRegistryV1 } from './structure-definition-module';
import { playerInteractionOrigin, positionsInRange, voxelCenter } from '../gameplay-geometry';
import { traceVoxelRay } from '../voxel-ray';

export type InteractionIntentV1 = 'use' | 'alternate';
export type AuthorityInteractActionV1 = Readonly<{
  type: 'interact';
  intent: InteractionIntentV1;
  target: ItemInteractionTarget;
  expectedSelection: ItemInteractionExpectedSelectionV1;
}>;
export type StructureTargetResolutionV1 =
  | Readonly<{ status: 'not-structure' }>
  | Readonly<{ status: 'malformed'; reason?: 'ambiguous-placement-orientation' | 'invalid-target' }>
  | Readonly<{ status: 'unavailable'; chunkKeys: readonly string[] }>
  | Readonly<{ status: 'resolved'; structure: ResolvedStructureV1; chunkKeys: readonly string[] }>;
export type StructurePlacementResolutionV1 =
  | Exclude<StructureTargetResolutionV1, { status: 'resolved' }>
  | Readonly<{
      status: 'resolved';
      definition: ReturnType<StructureDefinitionRegistryV1['require']>;
      stateId: string;
      root: StructurePositionV1;
      bearing: 'north' | 'east' | 'south' | 'west';
      chunkKeys: readonly string[];
    }>;
export type StructureInteractionResolutionV1 =
  | Exclude<StructureTargetResolutionV1, { status: 'resolved' }>
  | Readonly<{
      status: 'resolved';
      kind: 'existing';
      operation: 'toggle' | 'break';
      target: StructurePositionV1;
      structure: ResolvedStructureV1;
      chunkKeys: readonly string[];
    }>
  | Readonly<{
      status: 'resolved';
      kind: 'placement';
      operation: 'place';
      target: StructurePositionV1;
      definitionId: string;
      stateId: string;
      bearing: 'north' | 'east' | 'south' | 'west';
      chunkKeys: readonly string[];
    }>;
export type StructureTargetInvocationV1 = Readonly<{
  version: 1;
  actorId: string;
  intent: InteractionIntentV1;
  target: Extract<ItemInteractionTarget, { kind: 'voxel' }>;
  selectedItemId: string | null;
  resolution: Extract<StructureInteractionResolutionV1, { status: 'resolved' }>;
}>;
export type StructureTargetInteractionResultV1 =
  | Readonly<{
      success: true;
      handled: true;
      value?: import('../../composition/contracts').ModuleInvocationValue;
      commit?: import('../../game-server-types').WorldCommitResult;
    }>
  | Readonly<{ success: false; reason: string }>;
export type StructureTargetPortV1 = Readonly<{
  prepare(action: AuthorityInteractActionV1, actorId: string): StructureInteractionResolutionV1;
  prepareBreak(actorId: string, hit: StructurePositionV1): StructureInteractionResolutionV1;
  resolve(
    input: Readonly<{
      actorId: string;
      intent: InteractionIntentV1;
      target: Extract<ItemInteractionTarget, { kind: 'voxel' }>;
      selectedItemId: string | null;
    }>,
  ): StructureInteractionResolutionV1;
  invoke(input: StructureTargetInvocationV1): StructureTargetInteractionResultV1;
  breakFromMining(
    actorId: string,
    hit: StructurePositionV1,
  ):
    | Readonly<{ handled: false }>
    | Readonly<{ handled: true; success: false; reason: string }>
    | Readonly<{ handled: true; success: true; commit: import('../../game-server-types').WorldCommitResult }>;
  completeBreakFromMining(
    actorId: string,
    hit: StructurePositionV1,
  ):
    | Readonly<{ handled: false }>
    | Readonly<{ handled: true; success: false; reason: string }>
    | Readonly<{ handled: true; success: true }>;
}>;
type ActorSelection = Readonly<{
  lifecycle: 'alive' | 'dead';
  position: readonly [number, number, number];
  inventoryRevision: number;
  modeRevision: number;
  creativeCatalogRevision: number;
  selectedSlot: number;
  mode: 'survival' | 'creative';
  survivalItemId: string | null;
  creativeItemId: string | null;
}>;

const key = (position: readonly number[]) => position.join(',');
const chunkFor = (position: readonly [number, number, number]) =>
  chunkKey(...(position.map((value) => floorDiv(value, CHUNK_SIZE)) as [number, number, number]));
const ordered = (values: Iterable<string>) => Object.freeze([...new Set(values)].sort());
const selectedItem = (actor: ActorSelection) =>
  actor.mode === 'creative' ? actor.creativeItemId : actor.survivalItemId;
const selectionMatches = (actor: ActorSelection, expected: ItemInteractionExpectedSelectionV1) =>
  actor.inventoryRevision === expected.inventoryRevision &&
  actor.modeRevision === expected.modeRevision &&
  actor.creativeCatalogRevision === expected.creativeCatalogRevision &&
  actor.selectedSlot === expected.selectedSlot;
const position = (value: readonly number[], label: string): StructurePositionV1 => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isSafeInteger))
    throw new TypeError(`${label} is invalid.`);
  return Object.freeze([value[0]!, value[1]!, value[2]!]);
};
const intent = (value: InteractionIntentV1): InteractionIntentV1 => {
  if (value !== 'use' && value !== 'alternate') throw new TypeError('Structure interaction intent is invalid.');
  return value;
};

export function resolveStructureTargetIntentV1(
  registry: StructureDefinitionRegistryV1,
  hit: StructurePositionV1,
  read: (position: StructurePositionV1) => number | undefined,
): StructureTargetResolutionV1 {
  position(hit, 'Structure target');
  const cache = new Map<string, number | undefined>();
  const readOnce = (position: StructurePositionV1) => {
    const id = key(position);
    if (!cache.has(id)) cache.set(id, read(position));
    return cache.get(id);
  };
  const selected = readOnce(hit);
  if (selected === undefined) return { status: 'unavailable', chunkKeys: Object.freeze([chunkFor(hit)]) };
  const candidates = registry
    .list()
    .flatMap((definition) => [
      ...definition.states.map((state) => ({
        definition,
        stateId: state.id,
        source: 'registered' as const,
        variants: state.variants,
      })),
      ...definition.legacyStates.map((state) => ({
        definition,
        stateId: state.stateId,
        source: 'legacy' as const,
        variants: state.variants,
      })),
    ])
    .flatMap((candidate) =>
      candidate.definition.parts
        .filter((part) => candidate.variants[part.role] === selected)
        .map((part) => ({ ...candidate, selectedPart: part })),
    );
  if (!candidates.length) return { status: 'not-structure' };

  const chunkKeys = new Set<string>();
  let unavailable = false,
    completeCandidate = false;
  for (const candidate of candidates) {
    const root = Object.freeze([
      hit[0] - candidate.selectedPart.offset[0],
      hit[1] - candidate.selectedPart.offset[1],
      hit[2] - candidate.selectedPart.offset[2],
    ]) as StructurePositionV1;
    const parts = Object.freeze(
      structureFootprintV1(candidate.definition, root, candidate.stateId).map((part) =>
        Object.freeze({ ...part, voxel: candidate.variants[part.role]! }),
      ),
    );
    parts.forEach((part) => chunkKeys.add(part.chunkKey));
    const support = Object.freeze([
      root[0] + candidate.definition.support.offset[0],
      root[1] + candidate.definition.support.offset[1],
      root[2] + candidate.definition.support.offset[2],
    ]) as StructurePositionV1;
    chunkKeys.add(chunkFor(support));
    const values = parts.map((part) => readOnce(part.position));
    if (values.some((value) => value === undefined) || readOnce(support) === undefined) {
      unavailable = true;
      continue;
    }
    if (values.every((value, index) => value === parts[index]!.voxel)) completeCandidate = true;
  }
  const structure = completeCandidate ? registry.resolveTarget(hit, readOnce) : null;
  if (!structure)
    return completeCandidate || !unavailable
      ? { status: 'malformed' }
      : { status: 'unavailable', chunkKeys: ordered(chunkKeys) };
  const definition = registry.require(structure.definitionId);
  structure.parts.forEach((part) => chunkKeys.add(part.chunkKey));
  chunkKeys.add(
    chunkFor([
      structure.root[0] + definition.support.offset[0],
      structure.root[1] + definition.support.offset[1],
      structure.root[2] + definition.support.offset[2],
    ]),
  );
  return { status: 'resolved', structure, chunkKeys: ordered(chunkKeys) };
}

export function resolveStructurePlacementIntentV1(
  registry: StructureDefinitionRegistryV1,
  identity: ContentItemIdentityResolver,
  selectedStorageId: string | null,
  hit: StructurePositionV1,
  adjacent: StructurePositionV1,
  actorPosition: readonly [number, number, number],
): StructurePlacementResolutionV1 {
  position(hit, 'Structure placement hit');
  position(adjacent, 'Structure placement adjacent');
  if (!selectedStorageId) return { status: 'not-structure' };
  const definitionId = identity.definitionIdForStorageId(selectedStorageId);
  const definition = definitionId ? registry.resolvePlacementItem(definitionId) : undefined;
  if (!definition) return { status: 'not-structure' };
  const delta = adjacent.map((value, axis) => value - hit[axis]);
  if (delta.reduce((sum, value) => sum + Math.abs(value), 0) !== 1)
    return { status: 'malformed', reason: 'invalid-target' };
  let bearing: 'north' | 'east' | 'south' | 'west';
  if (delta[0] !== 0) bearing = delta[0] > 0 ? 'east' : 'west';
  else if (delta[2] !== 0) bearing = delta[2] > 0 ? 'south' : 'north';
  else {
    const x = adjacent[0] + 0.5 - actorPosition[0];
    const z = adjacent[2] + 0.5 - actorPosition[2];
    if (x === 0 && z === 0) return { status: 'malformed', reason: 'ambiguous-placement-orientation' };
    bearing = Math.abs(x) >= Math.abs(z) ? (x > 0 ? 'east' : 'west') : z > 0 ? 'south' : 'north';
  }
  const root = Object.freeze([...adjacent]) as StructurePositionV1;
  const chunkKeys = structureFootprintV1(definition, root, definition.initialState).map((part) => part.chunkKey);
  chunkKeys.push(
    chunkFor([
      root[0] + definition.support.offset[0],
      root[1] + definition.support.offset[1],
      root[2] + definition.support.offset[2],
    ]),
  );
  return {
    status: 'resolved',
    definition,
    stateId: definition.initialState,
    root,
    bearing,
    chunkKeys: ordered(chunkKeys),
  };
}

export function dispatchStructureTargetFirstV1(
  options: Readonly<{
    actor(actorId: string): ActorSelection | null;
    getVoxel(position: [number, number, number]): number | undefined;
    resolve(
      input: Readonly<{
        actorId: string;
        intent: InteractionIntentV1;
        target: Extract<ItemInteractionTarget, { kind: 'voxel' }>;
        selectedItemId: string | null;
      }>,
    ): StructureInteractionResolutionV1;
    invoke(input: StructureTargetInvocationV1): StructureTargetInteractionResultV1;
    fallback(): StructureTargetInteractionResultV1;
  }>,
  input: Readonly<{
    actorId: string;
    intent: InteractionIntentV1;
    target: ItemInteractionTarget;
    expectedSelection: ItemInteractionExpectedSelectionV1;
  }>,
): StructureTargetInteractionResultV1 {
  const actor = options.actor(input.actorId);
  intent(input.intent);
  if (!actor || actor.lifecycle !== 'alive') return { success: false, reason: 'player-dead' };
  if (!selectionMatches(actor, input.expectedSelection)) return { success: false, reason: 'stale-selection' };
  if (input.target.kind !== 'voxel') return options.fallback();
  const { hit, adjacent } = input.target;
  const origin = playerInteractionOrigin(actor.position);
  if (hit.reduce((sum, coordinate, axis) => sum + Math.abs(coordinate - adjacent[axis]), 0) !== 1)
    return { success: false, reason: 'invalid-target' };
  if (!positionsInRange(origin, voxelCenter([...hit]), 5) || !positionsInRange(origin, voxelCenter([...adjacent]), 5))
    return { success: false, reason: 'out-of-range' };
  const itemId = selectedItem(actor);
  const resolved = options.resolve({
    actorId: input.actorId,
    intent: input.intent,
    target: input.target,
    selectedItemId: itemId,
  });
  if (resolved.status === 'not-structure') return options.fallback();
  const ownCells =
    resolved.status === 'resolved' && resolved.kind === 'existing'
      ? new Set(resolved.structure.parts.map((part) => key(part.position)))
      : undefined;
  const hitVisibility = traceVoxelRay(voxelCenter([...hit]), origin, (x, y, z) =>
    ownCells?.has(key([x, y, z])) ? 0 : options.getVoxel([x, y, z]),
  );
  if (hitVisibility !== 'clear')
    return { success: false, reason: hitVisibility === 'unavailable' ? 'chunk-unavailable' : 'blocked' };
  const adjacentVisibility = traceVoxelRay(voxelCenter([...adjacent]), origin, (x, y, z) =>
    ownCells?.has(key([x, y, z])) ? 0 : options.getVoxel([x, y, z]),
  );
  if (adjacentVisibility !== 'clear')
    return { success: false, reason: adjacentVisibility === 'unavailable' ? 'chunk-unavailable' : 'blocked' };
  if (resolved.status === 'unavailable') return { success: false, reason: 'chunk-unavailable' };
  if (resolved.status === 'malformed') return { success: false, reason: resolved.reason ?? 'structure-malformed' };
  return options.invoke({
    version: 1,
    actorId: input.actorId,
    intent: input.intent,
    target: input.target,
    selectedItemId: itemId,
    resolution: resolved,
  });
}
