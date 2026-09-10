import type { ModModule, ModuleInvocationValue } from '../../composition/contracts';
import type { ItemDefinitionRegistry } from '../item-registry';
import { createInventoryCandidate } from './inventory-api';

const COMPONENT = 'seedlands:inventory';
const RESOURCE = 'seedlands.inventory';

export function defineInventoryModule(): ModModule {
  return Object.freeze({
    descriptor: {
      id: 'seedlands:inventory-module',
      version: '1.0.0',
      requires: [{ id: 'seedlands:items', version: '1.0.0' }],
      provides: [{ id: 'seedlands:inventory', version: '1.0.0' }],
      resources: [{ id: RESOURCE, operations: ['read', 'write', 'execute'] }],
      permissions: [{ resource: RESOURCE, operations: ['read', 'write', 'execute'] }],
    },
    register(api) {
      const items = api.requireCapability<ItemDefinitionRegistry>('seedlands:items');
      api.registerState({
        id: COMPONENT,
        version: '1.0.0',
        resource: RESOURCE,
        validate(value) {
          try {
            createInventoryCandidate(items, value);
            return true;
          } catch {
            return false;
          }
        },
      });
      api.provideCapability(
        'seedlands:inventory',
        Object.freeze({ componentId: COMPONENT, transferOperation: 'seedlands:inventory-transfer' }),
      );
      api.registerOperation({
        id: 'seedlands:inventory-transfer',
        resource: RESOURCE,
        run(context, input, state) {
          if (context.target.kind !== 'entity' || context.target.entityId !== context.originalActorId)
            throw new TypeError('Inventory source must match the bound actor.');
          const args = transferInput(input);
          if (args.recipientId === context.originalActorId)
            throw new TypeError('Inventory transfer needs a different recipient.');
          const from = { componentId: COMPONENT, target: context.target };
          const to = { componentId: COMPONENT, target: { kind: 'entity' as const, entityId: args.recipientId } };
          const source = createInventoryCandidate(items, state.read(from));
          const destination = createInventoryCandidate(items, state.read(to));
          const stack = items.normalizeStack({
            itemId: args.itemId,
            count: args.count,
            ...(args.instance === undefined ? {} : { instance: args.instance }),
          });
          if (!source.remove(stack)) throw new Error('missing-items');
          if (!destination.add(stack)) throw new Error('inventory-full');
          state.write(from, source.snapshot());
          state.write(to, destination.snapshot());
          return {
            itemId: args.itemId,
            count: args.count,
            actorId: context.originalActorId,
            recipientId: args.recipientId,
          };
        },
      });
    },
  } satisfies ModModule);
}

function transferInput(input: ModuleInvocationValue | undefined) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    !('recipientId' in input) ||
    !('itemId' in input) ||
    !('count' in input) ||
    typeof input.recipientId !== 'string' ||
    !input.recipientId.trim() ||
    typeof input.itemId !== 'string' ||
    typeof input.count !== 'number' ||
    !Number.isSafeInteger(input.count) ||
    input.count <= 0
  )
    throw new TypeError('Inventory transfer input is invalid.');
  return {
    recipientId: input.recipientId,
    itemId: input.itemId,
    count: input.count,
    instance: 'instance' in input ? input.instance : undefined,
  };
}
