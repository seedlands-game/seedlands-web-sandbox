import type { ModModule } from '../../composition/contracts';
import type { ItemDefinitionRegistry } from '../item-registry';
import { freezeNavigationPolicy, NAVIGATION_ITEMS_CAPABILITY } from './navigation-policy';
import {
  NAVIGATION_COMPONENT,
  NAVIGATION_RESOURCE,
  navigationAddress,
  validateNavigationProjection,
  buildNavigationCandidate,
  type NavigationInteractionConfig,
} from './navigation-interaction-model';

export function defineNavigationInteractionModule(config: NavigationInteractionConfig): ModModule {
  const frozen = Object.freeze({
    moduleId: config.moduleId,
    operationId: config.operationId,
    policy: freezeNavigationPolicy(config.policy),
  });
  return Object.freeze({
    descriptor: {
      id: frozen.moduleId,
      version: '1.0.0',
      requires: [{ id: 'seedlands:items', version: '1.0.0' }],
      provides: [{ id: NAVIGATION_ITEMS_CAPABILITY, version: '1.0.0', definitionIdentity: JSON.stringify(frozen) }],
      resources: [{ id: NAVIGATION_RESOURCE, operations: ['read', 'write', 'execute'] }],
      permissions: [{ resource: NAVIGATION_RESOURCE, operations: ['read', 'write', 'execute'] }],
    },
    register(api) {
      const items = api.requireCapability<ItemDefinitionRegistry>('seedlands:items');
      api.onDefinitionsReady(() => {
        for (const id of [frozen.policy.mapItemId, frozen.policy.compassItemId, frozen.policy.clockItemId])
          items.require(id);
        const voxels = new Set(api.readContentDefinitions().voxels.map((voxel) => voxel.storageId));
        for (const { voxel } of frozen.policy.palette)
          if (!voxels.has(voxel)) throw new TypeError('Navigation palette requires registered voxels.');
      });
      api.provideCapability(NAVIGATION_ITEMS_CAPABILITY, frozen);
      api.registerState({
        id: NAVIGATION_COMPONENT,
        version: '1.0.0',
        resource: NAVIGATION_RESOURCE,
        validate(value) {
          try {
            validateNavigationProjection(value);
            return true;
          } catch {
            return false;
          }
        },
      });
      api.registerOperation({
        id: frozen.operationId,
        resource: NAVIGATION_RESOURCE,
        run(context, input, state) {
          if (context.target.kind !== 'entity' || context.target.entityId !== context.originalActorId)
            throw new TypeError('Navigation requires its own actor target.');
          const address = navigationAddress(context.originalActorId);
          const candidate = buildNavigationCandidate(state.read(address), frozen.policy, input);
          state.write(address, candidate);
          return candidate;
        },
      });
    },
  } satisfies ModModule);
}
