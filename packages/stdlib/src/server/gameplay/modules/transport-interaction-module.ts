import type { ModModule, ModuleInvocationValue } from '../../composition/contracts';
import type { ItemDefinitionRegistry } from '../item-registry';
import {
  freezeTransportInteractionConfig,
  transportDefinitionIdentity,
  TRANSPORT_INTERACTION_CAPABILITY,
  TRANSPORT_DEPLOYMENT_COMPONENT,
  TRANSPORT_RESOURCE,
  type TransportInteractionConfig,
} from './transport-interaction-config';
import {
  buildTransportDeploymentCandidate,
  type TransportDeploymentActorV1,
  type TransportDeploymentSiteV1,
} from './transport-deployment-model';

export const transportActorAddress = (entityId: string) => ({
  componentId: TRANSPORT_DEPLOYMENT_COMPONENT,
  target: { kind: 'entity' as const, entityId },
});
export const transportSiteAddress = (position: readonly [number, number, number]) => ({
  componentId: TRANSPORT_DEPLOYMENT_COMPONENT,
  target: { kind: 'voxel' as const, position },
});

export function defineTransportInteractionModule(input: TransportInteractionConfig): ModModule {
  const config = freezeTransportInteractionConfig(input);
  return Object.freeze({
    descriptor: {
      id: config.moduleId,
      version: '1.0.0',
      requires: [
        { id: 'seedlands:items', version: '1.0.0' },
        { id: 'seedlands:voxel-semantics', version: '1.0.0' },
      ],
      provides: [
        {
          id: TRANSPORT_INTERACTION_CAPABILITY,
          version: '1.0.0',
          definitionIdentity: transportDefinitionIdentity(config),
        },
      ],
      resources: [{ id: TRANSPORT_RESOURCE, operations: ['read', 'write', 'execute'] }],
      permissions: [
        { resource: TRANSPORT_RESOURCE, operations: ['read', 'write', 'execute'] },
        { resource: 'seedlands.inventory', operations: ['read', 'execute'] },
      ],
    },
    register(api) {
      const items = api.requireCapability<ItemDefinitionRegistry>('seedlands:items');
      api.onDefinitionsReady(() => {
        for (const binding of config.deployments) items.require(binding.itemId);
        const registered = new Set(api.readContentDefinitions().voxels.map((voxel) => voxel.storageId));
        for (const provider of [...config.routes, ...config.surfaces])
          for (const voxel of provider.voxels)
            if (!registered.has(voxel)) throw new TypeError('Transport providers require registered voxels.');
      });
      api.provideCapability(TRANSPORT_INTERACTION_CAPABILITY, config);
      api.registerState({
        id: TRANSPORT_DEPLOYMENT_COMPONENT,
        version: '1.0.0',
        resource: TRANSPORT_RESOURCE,
        validate(value) {
          return !!value && typeof value === 'object' && 'version' in value && value.version === 1;
        },
      });
      api.registerOperation({
        id: config.operationId,
        resource: TRANSPORT_RESOURCE,
        run(context, input, state) {
          if (context.kind !== 'actor' || context.target.kind !== 'voxel')
            throw new TypeError('Transport deployment requires its actor voxel target.');
          const actorAddress = transportActorAddress(context.originalActorId);
          const actor = state.read(actorAddress) as TransportDeploymentActorV1;
          const site = state.read(transportSiteAddress(context.target.position)) as TransportDeploymentSiteV1;
          const candidate = buildTransportDeploymentCandidate(config, actor, site, input);
          state.write(actorAddress, candidate as ModuleInvocationValue);
          return candidate as ModuleInvocationValue;
        },
      });
    },
  } satisfies ModModule);
}
