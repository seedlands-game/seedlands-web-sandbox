import { positionsInRange, voxelCenter } from '../gameplay-geometry';
import type { ModCandidateState } from '../../composition/operation-contracts';
import type { ModModule, ModuleInvocationValue } from '../../composition/contracts';
import type { ActorModuleExecutionContext } from '../../composition/authorized-execution';
import { isItemId, type ItemStack } from '../item-registry';
import type { GameplayContent } from '../gameplay-content';
import type { VoxelGameplayDefinition } from '../voxel-gameplay';
import {
  BLOCK_ACTIONS_CAPABILITY,
  BLOCK_ACTOR_RESOURCE,
  BLOCK_BEGIN_OPERATION,
  BLOCK_CANCEL_OPERATION,
  BLOCK_FINISH_OPERATION,
  BLOCK_PLACE_OPERATION,
  BLOCK_RULES_CAPABILITY,
  BLOCK_VOXEL_RESOURCE,
  blockActorAddress,
  blockData,
  blockVoxelAddress,
  validateBlockActorProjection,
  validateBlockBeginEffectiveInput,
  validateBlockFinishEffectiveInput,
  validateBlockPlaceEffectiveInput,
  validateBlockPosition,
  validateBlockTargetInput,
  validateBlockVoxelProjection,
  type BlockActionContent,
  type BlockPosition,
} from './block-action-model';
import { buildBlockActionCandidate } from './block-actions-module';

type GameplayContentCapabilityV1 = Readonly<{ resolve(): GameplayContent }>;
export type BlockRulesModuleOptions = Readonly<{
  moduleId: string;
  voxelDefinitions: readonly VoxelGameplayDefinition[];
}>;

export type BlockRulesCapabilityV1 = Readonly<{
  moduleId: string;
  definitions: readonly VoxelGameplayDefinition[];
}>;

type ActorTarget = Readonly<{ actorId: string; position: BlockPosition }>;

const actorTarget = (context: ActorModuleExecutionContext): ActorTarget => {
  if (context.kind !== 'actor' || !context.originalActorId || context.target.kind !== 'voxel')
    throw new TypeError('Block rule requires an actor and voxel target.');
  return Object.freeze({
    actorId: context.originalActorId,
    position: validateBlockPosition(context.target.position, 'Block rule target'),
  });
};

const samePosition = (left: BlockPosition, right: BlockPosition): boolean =>
  left.every((value, index) => value === right[index]);

const sameData = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

function snapshotDefinition(raw: unknown): VoxelGameplayDefinition {
  const value = blockData(
    raw,
    ['voxel', 'hardnessSeconds', 'preferredTool', 'drop', 'replaceable'],
    'Block rule definition',
  );
  if (typeof value.voxel !== 'number' || !Number.isSafeInteger(value.voxel) || value.voxel < 0 || value.voxel > 65535)
    throw new TypeError('Block rule voxel is invalid.');
  if (
    value.hardnessSeconds !== null &&
    (typeof value.hardnessSeconds !== 'number' ||
      !Number.isFinite(value.hardnessSeconds) ||
      Number(value.hardnessSeconds.toFixed(6)) <= 0 ||
      value.hardnessSeconds > 1e6)
  )
    throw new TypeError('Block rule hardness is invalid.');
  if (value.preferredTool !== null && value.preferredTool !== 'axe' && value.preferredTool !== 'pickaxe')
    throw new TypeError('Block rule preferred tool is invalid.');
  if (typeof value.replaceable !== 'boolean') throw new TypeError('Block rule replaceability is invalid.');
  let drop: Readonly<ItemStack> | null = null;
  if (value.drop !== null) {
    const hasInstance = typeof value.drop === 'object' && value.drop !== null && Object.hasOwn(value.drop, 'instance');
    const stack = blockData(
      value.drop,
      hasInstance ? ['itemId', 'count', 'instance'] : ['itemId', 'count'],
      'Block rule drop',
    );
    if (
      !isItemId(stack.itemId) ||
      typeof stack.count !== 'number' ||
      !Number.isSafeInteger(stack.count) ||
      stack.count <= 0
    )
      throw new TypeError('Block rule drop identity or count is invalid.');
    let instance: Readonly<{ durability: number }> | undefined;
    if (hasInstance) {
      const state = blockData(stack.instance, ['durability'], 'Block rule drop instance');
      if (typeof state.durability !== 'number' || !Number.isSafeInteger(state.durability) || state.durability <= 0)
        throw new TypeError('Block rule drop durability is invalid.');
      instance = Object.freeze({ durability: state.durability });
    }
    drop = Object.freeze({ itemId: stack.itemId, count: stack.count, ...(instance ? { instance } : {}) });
  }
  return Object.freeze({
    voxel: value.voxel,
    hardnessSeconds: value.hardnessSeconds,
    preferredTool: value.preferredTool,
    drop,
    replaceable: value.replaceable,
  });
}

export function defineBlockRulesModule(options: BlockRulesModuleOptions): ModModule {
  const moduleId = options.moduleId;
  if (!moduleId?.trim()) throw new TypeError('Block Rules module ID is invalid.');
  const definitions = new Map<number, VoxelGameplayDefinition>();
  if (!Array.isArray(options.voxelDefinitions)) throw new TypeError('Block Rules requires explicit voxel definitions.');
  for (const raw of options.voxelDefinitions) {
    const definition = snapshotDefinition(raw);
    if (definitions.has(definition.voxel)) throw new TypeError(`Duplicate Block rule voxel: ${definition.voxel}`);
    definitions.set(definition.voxel, definition);
  }
  const definition = (voxel: number) => {
    const value = definitions.get(voxel);
    if (!value) throw new RangeError(`Unknown Block rule voxel: ${voxel}`);
    return value;
  };
  return Object.freeze({
    descriptor: {
      id: moduleId,
      version: '1.0.0',
      requires: [
        { id: BLOCK_ACTIONS_CAPABILITY, version: '1.0.0' },
        { id: 'seedlands:gameplay-content', version: '1.0.0' },
      ],
      provides: [{ id: BLOCK_RULES_CAPABILITY, version: '1.0.0' }],
      permissions: [
        { resource: BLOCK_ACTOR_RESOURCE, operations: ['read', 'execute'] },
        { resource: BLOCK_VOXEL_RESOURCE, operations: ['read', 'execute'] },
      ],
    },
    register(api) {
      api.requireCapability(BLOCK_ACTIONS_CAPABILITY);
      const contentCapability = api.requireCapability<GameplayContentCapabilityV1>('seedlands:gameplay-content');
      const content = (): BlockActionContent => contentCapability.resolve();
      api.provideCapability(
        BLOCK_RULES_CAPABILITY,
        Object.freeze({
          moduleId,
          definitions: Object.freeze([...definitions.values()]),
        } satisfies BlockRulesCapabilityV1),
      );

      const current = (context: ActorModuleExecutionContext, state: ModCandidateState) => {
        const target = actorTarget(context);
        const actor = validateBlockActorProjection(state.read(blockActorAddress(target.actorId)), content().items);
        if (!positionsInRange(actor.position, voxelCenter([...target.position]), 5)) throw new Error('out-of-range');
        const voxel = validateBlockVoxelProjection(state.read(blockVoxelAddress(target.position)));
        if (actor.reference.entityId !== target.actorId || !samePosition(voxel.position, target.position))
          throw new TypeError('Block rule projection identity changed.');
        return { target, actor, voxel };
      };

      const rawTarget = (context: ActorModuleExecutionContext, input: ModuleInvocationValue | undefined) => {
        const raw = validateBlockTargetInput(input);
        const target = actorTarget(context);
        if (!samePosition(raw.position, target.position)) throw new TypeError('Block rule input target changed.');
        return raw.position;
      };

      const deriveBegin = (
        context: ActorModuleExecutionContext,
        input: ModuleInvocationValue | undefined,
        state: ModCandidateState,
      ) => {
        rawTarget(context, input);
        const { actor, voxel } = current(context, state);
        if (actor.lifecycle !== 'alive') throw new Error('actor-dead');
        const gameplay = definition(voxel.voxel);
        if (gameplay.hardnessSeconds === null) throw new Error('unbreakable');
        if (actor.mode.value === 'creative')
          return Object.freeze({
            position: voxel.position,
            expectedVoxel: voxel.voxel,
            creative: true,
            requiredSeconds: 0,
            modeRevision: actor.mode.revision,
          });
        const selected = actor.slots[actor.equipment.selectedSlot];
        const mine = selected ? content().items.capability(selected.itemId, 'mine') : undefined;
        const multiplier = mine?.tool === gameplay.preferredTool ? mine.multiplier : 1;
        return Object.freeze({
          position: voxel.position,
          expectedVoxel: voxel.voxel,
          creative: false,
          requiredSeconds: Number((gameplay.hardnessSeconds / multiplier).toFixed(6)),
          modeRevision: actor.mode.revision,
        });
      };

      const derivePlace = (
        context: ActorModuleExecutionContext,
        input: ModuleInvocationValue | undefined,
        state: ModCandidateState,
      ) => {
        rawTarget(context, input);
        const { actor, voxel } = current(context, state);
        if (actor.lifecycle !== 'alive') throw new Error('actor-dead');
        if (!definition(voxel.voxel).replaceable) throw new Error('target-occupied');
        const creative = actor.mode.value === 'creative';
        const selected = creative
          ? actor.creativeCatalog.hotbar[actor.creativeCatalog.selectedSlot]
          : actor.slots[actor.equipment.selectedSlot]?.itemId;
        if (!selected) throw new Error('no-selected-item');
        const place = content().items.capability(selected, 'place');
        if (!place) throw new Error('item-not-placeable');
        return Object.freeze({
          position: voxel.position,
          expectedVoxel: voxel.voxel,
          placedVoxel: place.voxel,
          itemId: selected,
          consumeCount: creative ? (0 as const) : (1 as const),
          modeRevision: actor.mode.revision,
        });
      };

      const deriveFinish = (
        context: ActorModuleExecutionContext,
        input: ModuleInvocationValue | undefined,
        state: ModCandidateState,
      ) => {
        rawTarget(context, input);
        const { actor, voxel } = current(context, state);
        if (actor.lifecycle !== 'alive') throw new Error('actor-dead');
        if (!actor.breakAction || !samePosition(actor.breakAction.position, voxel.position))
          throw new Error('no-break-action');
        const gameplay = definition(voxel.voxel);
        const creative = actor.mode.value === 'creative';
        return Object.freeze({
          position: voxel.position,
          expectedVoxel: voxel.voxel,
          creative,
          drop: creative || gameplay.drop === null ? null : content().items.normalizeStack(gameplay.drop),
          modeRevision: actor.mode.revision,
        });
      };

      const register = (
        kind: 'begin' | 'place' | 'finish',
        operationId: string,
        derive: (
          context: ActorModuleExecutionContext,
          input: ModuleInvocationValue | undefined,
          state: ModCandidateState,
        ) => ModuleInvocationValue,
      ) => {
        api.registerRule({
          id: `${moduleId}/${kind}-before`,
          operationId,
          stage: 'before',
          apply(context, input, state) {
            if (context.kind !== 'actor') throw new TypeError('Block rule requires actor execution.');
            return { input: derive(context, input, state) };
          },
        });
        api.registerRule({
          id: `${moduleId}/${kind}-after`,
          operationId,
          stage: 'after',
          apply(context, input, state, candidate) {
            if (context.kind !== 'actor') return { reject: 'block-candidate-context-mismatch' };
            const effective =
              kind === 'begin'
                ? validateBlockBeginEffectiveInput(input)
                : kind === 'place'
                  ? validateBlockPlaceEffectiveInput(input)
                  : validateBlockFinishEffectiveInput(input, content().items);
            const expectedInput = derive(context, { position: effective.position }, state);
            if (!sameData(effective, expectedInput)) return { reject: `block-${kind}-policy-mismatch` };
            const { actor, voxel } = current(context, state);
            const expected = buildBlockActionCandidate(content(), { kind, actor, voxel, input: effective });
            if (!sameData(candidate, expected)) return { reject: `block-${kind}-candidate-mismatch` };
          },
        });
      };

      register('begin', BLOCK_BEGIN_OPERATION, deriveBegin);
      register('place', BLOCK_PLACE_OPERATION, derivePlace);
      register('finish', BLOCK_FINISH_OPERATION, deriveFinish);
      api.registerRule({
        id: `${moduleId}/cancel-after`,
        operationId: BLOCK_CANCEL_OPERATION,
        stage: 'after',
        apply(context, input, state, candidate) {
          if (context.kind !== 'actor' || input !== undefined) return { reject: 'block-cancel-context-mismatch' };
          const actor = validateBlockActorProjection(
            state.read(blockActorAddress(context.originalActorId)),
            content().items,
          );
          const expected = buildBlockActionCandidate(content(), { kind: 'cancel', actor, input: undefined });
          if (!sameData(candidate, expected)) return { reject: 'block-cancel-candidate-mismatch' };
        },
      });
    },
  } satisfies ModModule);
}
