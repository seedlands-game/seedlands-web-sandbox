import type { ModModule, ModuleInvocationValue } from '../../composition/contracts';
import { TRANSPORT_INTERACTION_CAPABILITY, TRANSPORT_RESOURCE } from './transport-interaction-config';
import {
  TRANSPORT_RELATION_CAPABILITY,
  TRANSPORT_RELATION_COMPONENT,
  TRANSPORT_RELATION_SITE_COMPONENT,
  transportRelationAddress,
  transportRelationSiteAddress,
  readTransportRelationInput,
  buildTransportRelationInteraction,
  type TransportRelationActor,
  type TransportRelationSite,
  type TransportRelationConfig,
} from './transport-relation-interaction';

export function defineTransportRelationModule(input: TransportRelationConfig): ModModule {
  const namespace = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
  if (!namespace.test(input.moduleId) || !namespace.test(input.operationId))
    throw new TypeError('Transport relation IDs must be qualified.');
  const config = Object.freeze({ moduleId: input.moduleId, operationId: input.operationId });
  return Object.freeze({
    descriptor: {
      id: config.moduleId,
      version: '1.0.0',
      requires: [{ id: TRANSPORT_INTERACTION_CAPABILITY, version: '1.0.0' }],
      provides: [{ id: TRANSPORT_RELATION_CAPABILITY, version: '1.0.0', definitionIdentity: JSON.stringify(config) }],
      permissions: [{ resource: TRANSPORT_RESOURCE, operations: ['read', 'write', 'execute'] }],
    },
    register(api) {
      api.provideCapability(TRANSPORT_RELATION_CAPABILITY, config);
      for (const id of [TRANSPORT_RELATION_COMPONENT, TRANSPORT_RELATION_SITE_COMPONENT])
        api.registerState({
          id,
          version: '1.0.0',
          resource: TRANSPORT_RESOURCE,
          validate: (value) => !!value && typeof value === 'object' && 'version' in value && value.version === 1,
        });
      api.registerOperation({
        id: config.operationId,
        resource: TRANSPORT_RESOURCE,
        run(context, raw, state) {
          if (context.kind !== 'actor' || context.target.kind !== 'entity')
            throw new TypeError('Transport relation requires an actor entity target.');
          const input = readTransportRelationInput(raw);
          const address = transportRelationAddress(context.originalActorId);
          const actor = state.read(address) as TransportRelationActor;
          const target = input.target ?? actor.mounted;
          if (!target) throw new Error('not-mounted');
          if (context.target.entityId !== (input.kind === 'mount' ? target.entityId : context.originalActorId))
            throw new TypeError('Transport relation invocation target is invalid.');
          const site = state.read(transportRelationSiteAddress(target.entityId)) as TransportRelationSite;
          const candidate = buildTransportRelationInteraction(actor, site, input);
          state.write(address, candidate as ModuleInvocationValue);
          return candidate as ModuleInvocationValue;
        },
      });
    },
  } satisfies ModModule);
}
