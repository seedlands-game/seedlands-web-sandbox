import type { ModModule } from '../../composition/contracts';
import type { GameplayContent } from '../gameplay-content';
import type { ItemDefinitionRegistry } from '../item-registry';
import {
  FEEDING_ACTOR_COMPONENT,
  FEEDING_ACTOR_RESOURCE,
  FEEDING_CAPABILITY,
  FEEDING_CONSUME_WORLD_ITEM_OPERATION,
  FEEDING_ITEM_COMPONENT,
  FEEDING_ITEM_RESOURCE,
  buildFeedingCandidate,
  feedingActorAddress,
  feedingCapability,
  feedingItemAddress,
  validateFeedingActorProjection,
  validateFeedingItemProjection,
} from './feeding-model';

type GameplayContentCapabilityV1 = Readonly<{ resolve(): GameplayContent }>;

function actorId(context: Readonly<{ kind: string; originalActorId?: string }>): string {
  if (context.kind !== 'actor' || !context.originalActorId) throw new TypeError('Feeding requires an actor.');
  return context.originalActorId;
}

function itemTarget(target: unknown): string {
  if (!target || typeof target !== 'object') throw new TypeError('Feeding requires an item entity target.');
  const value = target as { kind?: unknown; entityId?: unknown };
  if (value.kind !== 'entity' || typeof value.entityId !== 'string')
    throw new TypeError('Feeding requires an item entity target.');
  return value.entityId;
}

export function defineFeedingActionsModule(): ModModule {
  return Object.freeze({
    descriptor: {
      id: 'seedlands:feeding-actions-module',
      version: '1.0.0',
      requires: [
        { id: 'seedlands:needs', version: '1.0.0' },
        { id: 'seedlands:items', version: '1.0.0' },
        { id: 'seedlands:gameplay-content', version: '1.0.0' },
      ],
      provides: [{ id: FEEDING_CAPABILITY, version: '1.0.0' }],
      resources: [
        { id: FEEDING_ACTOR_RESOURCE, operations: ['read', 'execute'] },
        { id: FEEDING_ITEM_RESOURCE, operations: ['read', 'execute'] },
      ],
      permissions: [
        { resource: FEEDING_ACTOR_RESOURCE, operations: ['read', 'execute'] },
        { resource: FEEDING_ITEM_RESOURCE, operations: ['read', 'execute'] },
      ],
    },
    register(api) {
      api.requireCapability('seedlands:needs');
      const itemCapability = api.requireCapability<ItemDefinitionRegistry>('seedlands:items');
      const contentCapability = api.requireCapability<GameplayContentCapabilityV1>('seedlands:gameplay-content');
      const content = () => {
        const resolved = contentCapability.resolve();
        for (const item of resolved.items.list())
          if (!itemCapability.has(item.id)) throw new TypeError(`Feeding item capability is missing ${item.id}.`);
        return resolved;
      };
      api.provideCapability(FEEDING_CAPABILITY, feedingCapability());
      api.registerState({
        id: FEEDING_ACTOR_COMPONENT,
        version: '1.0.0',
        resource: FEEDING_ACTOR_RESOURCE,
        validate(value) {
          try {
            validateFeedingActorProjection(value);
            return true;
          } catch {
            return false;
          }
        },
      });
      api.registerState({
        id: FEEDING_ITEM_COMPONENT,
        version: '1.0.0',
        resource: FEEDING_ITEM_RESOURCE,
        validate(value) {
          try {
            validateFeedingItemProjection(value, content().items);
            return true;
          } catch {
            return false;
          }
        },
      });
      api.registerOperation({
        id: FEEDING_CONSUME_WORLD_ITEM_OPERATION,
        resource: FEEDING_ITEM_RESOURCE,
        run(context, input, state) {
          const boundActorId = actorId(context);
          const targetItemId = itemTarget(context.target);
          const candidate = buildFeedingCandidate(content(), {
            actor: state.read(feedingActorAddress(boundActorId)),
            item: state.read(feedingItemAddress(targetItemId)),
            input,
          });
          if (candidate.actorReference.entityId !== boundActorId)
            throw new TypeError('Feeding actor projection does not match the bound actor.');
          if (candidate.itemReference.entityId !== targetItemId)
            throw new TypeError('Feeding item projection does not match the target item.');
          return candidate;
        },
      });
    },
  } satisfies ModModule);
}
