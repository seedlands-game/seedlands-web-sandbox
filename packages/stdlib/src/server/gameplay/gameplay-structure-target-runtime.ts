import { createContentItemIdentityResolver } from '../composition/content-item-identity';
import type { WorldComposition } from '../composition/contracts';
import type { RegisteredOperationRequest, RegisteredOperationResult } from '../composition/operation-contracts';
import type { EntityStore } from './entity-store';
import {
  STRUCTURE_BREAK_OPERATION,
  STRUCTURE_PLACE_OPERATION,
  STRUCTURE_TOGGLE_OPERATION,
} from './modules/structure-actions-module';
import type { StructurePositionV1 } from './modules/structure-definition';
import type { RegisteredStructureRuntime } from './modules/registered-structure-runtime';
import {
  resolveStructurePlacementIntentV1,
  resolveStructureTargetIntentV1,
  type StructureInteractionResolutionV1,
  type StructureTargetPortV1,
  type StructureTargetInvocationV1,
} from './modules/structure-target-dispatch';

type Invoke = (actorId: string, request: RegisteredOperationRequest) => RegisteredOperationResult;
type StructureBreakResult =
  | Readonly<{ handled: false }>
  | Readonly<{ handled: true; success: false; reason: string }>
  | Readonly<{ handled: true; success: true; commit: import('../game-server-types').WorldCommitResult }>;
type StructureCompletionResult =
  | Readonly<{ handled: false }>
  | Readonly<{ handled: true; success: false; reason: string }>
  | Readonly<{ handled: true; success: true }>;

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const adjacentTowardActor = (
  hit: StructurePositionV1,
  actor: readonly [number, number, number],
): StructurePositionV1 => {
  const delta = actor.map((value, axis) => value - (hit[axis]! + 0.5));
  const axis = delta.map(Math.abs).reduce((best, value, index, values) => (value > values[best]! ? index : best), 0);
  const adjacent = [...hit] as [number, number, number];
  adjacent[axis] += delta[axis]! < 0 ? -1 : 1;
  return Object.freeze(adjacent);
};

export type GameplayStructureTargetRuntime = StructureTargetPortV1;

export function createGameplayStructureTargetRuntime(
  options: Readonly<{
    composition: WorldComposition;
    runtime: RegisteredStructureRuntime;
    entities: EntityStore;
    readVoxel(position: StructurePositionV1): number | undefined;
    isTargetable(voxel: number): boolean;
    invoke: Invoke;
  }>,
): StructureTargetPortV1 {
  const identity = createContentItemIdentityResolver(options.composition.definitionMap);
  const selectedItemId = (actorId: string): string | null => {
    const actor = options.entities.get(actorId);
    if (actor?.type !== 'player') return null;
    const state = options.entities.playerStateAccess(actorId);
    return state.mode === 'creative'
      ? (state.creativeCatalog.hotbar[state.creativeCatalog.selectedSlot] ?? null)
      : (state.inventory.slot(state.selectedSlot)?.itemId ?? null);
  };
  const resolve = (
    input: Readonly<{
      actorId: string;
      intent: 'use' | 'alternate';
      target: Readonly<{ kind: 'voxel'; hit: StructurePositionV1; adjacent: StructurePositionV1 }>;
      selectedItemId: string | null;
    }>,
  ): StructureInteractionResolutionV1 => {
    if (input.selectedItemId !== selectedItemId(input.actorId))
      return { status: 'malformed', reason: 'invalid-target' };
    const current = resolveStructureTargetIntentV1(options.runtime.registry, input.target.hit, options.readVoxel);
    if (current.status === 'resolved')
      return {
        ...current,
        kind: 'existing' as const,
        operation: input.intent === 'use' ? ('toggle' as const) : ('break' as const),
        target: input.target.hit,
      };
    if (current.status !== 'not-structure' || input.intent !== 'use') return current;
    const actor = options.entities.get(input.actorId);
    if (!actor) return { status: 'malformed', reason: 'invalid-target' };
    const placement = resolveStructurePlacementIntentV1(
      options.runtime.registry,
      identity,
      selectedItemId(input.actorId),
      input.target.hit,
      input.target.adjacent,
      actor.position,
    );
    if (placement.status === 'resolved') {
      const hitVoxel = options.readVoxel(input.target.hit);
      if (hitVoxel === undefined) return { status: 'unavailable', chunkKeys: placement.chunkKeys };
      if (!options.isTargetable(hitVoxel)) return { status: 'malformed', reason: 'invalid-target' };
    }
    return placement.status === 'resolved'
      ? {
          status: 'resolved',
          kind: 'placement',
          operation: 'place',
          target: placement.root,
          definitionId: placement.definition.id,
          stateId: placement.stateId,
          bearing: placement.bearing,
          chunkKeys: placement.chunkKeys,
        }
      : placement;
  };
  const invoke = (input: StructureTargetInvocationV1) => {
    const current = resolve(input);
    if (
      input.selectedItemId !== selectedItemId(input.actorId) ||
      !same(current, input.resolution) ||
      current.status !== 'resolved'
    )
      return { success: false as const, reason: 'structure-target-stale' };
    const operationId =
      current.operation === 'place'
        ? STRUCTURE_PLACE_OPERATION
        : current.operation === 'toggle'
          ? STRUCTURE_TOGGLE_OPERATION
          : STRUCTURE_BREAK_OPERATION;
    const result = options.invoke(input.actorId, {
      operationId,
      target: { kind: 'voxel', position: current.target },
      input: { hit: input.target.hit, adjacent: input.target.adjacent },
    });
    if (!result.ok) return { success: false as const, reason: result.message };
    const commit = options.runtime.acknowledge(
      (result.value as { commit?: { worldRevision?: number } }).commit?.worldRevision ?? -1,
    );
    if (!commit) throw new TypeError('Structure operation commit receipt is invalid.');
    return { success: true as const, handled: true as const, value: result.value, commit };
  };
  const breakFromMining = (
    actorId: string,
    hit: StructurePositionV1,
    acknowledge: boolean,
  ): StructureBreakResult | StructureCompletionResult => {
    const actor = options.entities.get(actorId);
    if (!actor) return { handled: true, success: false, reason: 'structure-actor-unavailable' };
    const target = { kind: 'voxel' as const, hit, adjacent: adjacentTowardActor(hit, actor.position) };
    const selected = selectedItemId(actorId);
    const resolution = resolve({ actorId, intent: 'alternate', target, selectedItemId: selected });
    if (resolution.status === 'not-structure') return { handled: false };
    if (resolution.status !== 'resolved')
      return {
        handled: true,
        success: false,
        reason: resolution.status === 'unavailable' ? 'chunk-unavailable' : 'structure-malformed',
      };
    const result = options.invoke(actorId, {
      operationId: STRUCTURE_BREAK_OPERATION,
      target: { kind: 'voxel', position: resolution.target },
      input: { hit: target.hit, adjacent: target.adjacent },
    });
    if (!result.ok) return { handled: true, success: false, reason: result.message };
    const worldRevision = (result.value as { commit?: { worldRevision?: number } }).commit?.worldRevision ?? -1;
    if (!options.runtime.hasCommit(worldRevision))
      throw new TypeError('Structure operation commit receipt is invalid.');
    if (!acknowledge) return { handled: true, success: true };
    const commit = options.runtime.acknowledge(worldRevision);
    if (!commit) throw new TypeError('Structure operation commit receipt is invalid.');
    return { handled: true, success: true, commit };
  };
  return Object.freeze({
    resolve,
    prepare(action, actorId) {
      if (action.target.kind !== 'voxel') return { status: 'not-structure' };
      return resolve({
        actorId,
        intent: action.intent,
        target: action.target,
        selectedItemId: selectedItemId(actorId),
      });
    },
    prepareBreak(actorId, hit) {
      const actor = options.entities.get(actorId);
      if (!actor) return { status: 'malformed', reason: 'invalid-target' };
      const target = { kind: 'voxel' as const, hit, adjacent: adjacentTowardActor(hit, actor.position) };
      return resolve({ actorId, intent: 'alternate', target, selectedItemId: selectedItemId(actorId) });
    },
    invoke: (input: StructureTargetInvocationV1) => invoke(input),
    breakFromMining: (actorId, hit) => breakFromMining(actorId, hit, true) as StructureBreakResult,
    completeBreakFromMining: (actorId, hit) => breakFromMining(actorId, hit, false) as StructureCompletionResult,
  });
}
