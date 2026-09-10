import type { ModModule } from '../../composition/contracts';
import type { GameplayContent } from '../gameplay-content';
import type { ItemDefinitionRegistry } from '../item-registry';
import {
  INVENTORY_ACTIONS_CAPABILITY,
  INVENTORY_ACTOR_COMPONENT,
  INVENTORY_CONSUME_OPERATION,
  INVENTORY_CRAFT_OPERATION,
  INVENTORY_DROP_OPERATION,
  INVENTORY_ITEM_COMPONENT,
  INVENTORY_ITEM_RESOURCE,
  INVENTORY_MOVE_OPERATION,
  INVENTORY_PICKUP_OPERATION,
  INVENTORY_RESOURCE,
  INVENTORY_SELECT_OPERATION,
  buildInventoryActionCandidate,
  inventoryActionsCapability,
  inventoryActorAddress,
  inventoryItemAddress,
  validateInventoryActorProjection,
  validateInventoryWorldItemProjection,
  type InventoryActionKind,
} from './inventory-action-model';
import { buildInventoryPointerCandidate } from './inventory-pointer-model';

type GameplayContentCapabilityV1 = Readonly<{ resolve(): GameplayContent }>;

function actorId(context: Readonly<{ kind: string; originalActorId?: string }>): string {
  if (context.kind !== 'actor' || !context.originalActorId) throw new TypeError('Inventory action requires an actor.');
  return context.originalActorId;
}

function entityTarget(target: unknown): string {
  if (!target || typeof target !== 'object') throw new TypeError('Inventory action requires an entity target.');
  const value = target as { kind?: unknown; entityId?: unknown };
  if (value.kind !== 'entity' || typeof value.entityId !== 'string')
    throw new TypeError('Inventory action requires an entity target.');
  return value.entityId;
}

export function defineInventoryActionsModule(): ModModule {
  return Object.freeze({
    descriptor: {
      id: 'seedlands:inventory-actions-module',
      version: '1.0.0',
      requires: [
        { id: 'seedlands:inventory', version: '1.0.0' },
        { id: 'seedlands:items', version: '1.0.0' },
        { id: 'seedlands:gameplay-content', version: '1.0.0' },
      ],
      provides: [{ id: INVENTORY_ACTIONS_CAPABILITY, version: '1.0.0' }],
      resources: [{ id: INVENTORY_ITEM_RESOURCE, operations: ['read', 'execute'] }],
      permissions: [
        { resource: INVENTORY_RESOURCE, operations: ['read', 'write', 'execute'] },
        { resource: INVENTORY_ITEM_RESOURCE, operations: ['read', 'execute'] },
      ],
    },
    register(api) {
      const itemCapability = api.requireCapability<ItemDefinitionRegistry>('seedlands:items');
      const contentCapability = api.requireCapability<GameplayContentCapabilityV1>('seedlands:gameplay-content');
      const content = () => {
        const resolved = contentCapability.resolve();
        if (resolved.recipes.items !== resolved.items)
          throw new TypeError('Inventory action content registries do not match.');
        for (const item of resolved.items.list())
          if (!itemCapability.has(item.id))
            throw new TypeError(`Inventory action item capability is missing ${item.id}.`);
        return resolved;
      };
      api.provideCapability(INVENTORY_ACTIONS_CAPABILITY, inventoryActionsCapability());
      api.registerState({
        id: INVENTORY_ACTOR_COMPONENT,
        version: '1.0.0',
        resource: INVENTORY_RESOURCE,
        validate(value) {
          try {
            validateInventoryActorProjection(value, content().items);
            return true;
          } catch {
            return false;
          }
        },
      });
      api.registerState({
        id: INVENTORY_ITEM_COMPONENT,
        version: '1.0.0',
        resource: INVENTORY_ITEM_RESOURCE,
        validate(value) {
          try {
            validateInventoryWorldItemProjection(value, content().items);
            return true;
          } catch {
            return false;
          }
        },
      });
      const operations: readonly Readonly<{
        kind: Exclude<InventoryActionKind, 'pickup'>;
        id: string;
      }>[] = [
        { kind: 'select', id: INVENTORY_SELECT_OPERATION },
        { kind: 'move', id: INVENTORY_MOVE_OPERATION },
        { kind: 'consume', id: INVENTORY_CONSUME_OPERATION },
        { kind: 'craft', id: INVENTORY_CRAFT_OPERATION },
        { kind: 'drop', id: INVENTORY_DROP_OPERATION },
      ];
      for (const operation of operations)
        api.registerOperation({
          id: operation.id,
          resource: INVENTORY_RESOURCE,
          run(context, input, state) {
            const boundActorId = actorId(context);
            if (entityTarget(context.target) !== boundActorId)
              throw new TypeError('Inventory target must match the bound actor.');
            const actor = state.read(inventoryActorAddress(boundActorId));
            const result =
              operation.kind === 'move' &&
              input !== null &&
              typeof input === 'object' &&
              !Array.isArray(input) &&
              Object.hasOwn(input, 'command')
                ? buildInventoryPointerCandidate(content(), { actor: actor as never, input })
                : buildInventoryActionCandidate(content(), { kind: operation.kind, actor, input });
            if (result.actorId !== boundActorId)
              throw new TypeError('Inventory actor projection does not match the bound actor.');
            return result;
          },
        });
      api.registerOperation({
        id: INVENTORY_PICKUP_OPERATION,
        resource: INVENTORY_ITEM_RESOURCE,
        run(context, input, state) {
          const boundActorId = actorId(context);
          const itemId = entityTarget(context.target);
          const actor = state.read(inventoryActorAddress(boundActorId));
          const item = state.read(inventoryItemAddress(itemId));
          const candidate = buildInventoryActionCandidate(content(), { kind: 'pickup', actor, item, input });
          if (candidate.actorId !== boundActorId)
            throw new TypeError('Inventory actor projection does not match the bound actor.');
          if (candidate.pickupIntent?.reference.entityId !== itemId)
            throw new TypeError('Inventory pickup target does not match its projection.');
          return candidate;
        },
      });
    },
  } satisfies ModModule);
}
