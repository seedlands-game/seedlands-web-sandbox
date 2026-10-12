import type { ModModule, ModuleInvocationValue } from '../../composition/contracts';
import type { ItemDefinitionRegistry } from '../item-registry';
import {
  TRANSPORT_INTERACTION_CAPABILITY,
  TRANSPORT_RESOURCE,
  type FrozenTransportInteractionConfig,
} from './transport-interaction-config';
import {
  buildTransportStorageCandidateV1,
  readTransportStorageInputV1,
  type TransportFuelBindingV1,
  type TransportStorageActorV1,
  type TransportStorageSiteV1,
} from './transport-storage-model';

export const TRANSPORT_STORAGE_CAPABILITY = 'seedlands:transport-storage';
export const TRANSPORT_STORAGE_ACTOR_COMPONENT = 'seedlands:transport-storage-actor';
export const TRANSPORT_STORAGE_SITE_COMPONENT = 'seedlands:transport-storage-site';
export type TransportStorageConfigV1 = Readonly<{
  moduleId: string;
  operationId: string;
  fuels: readonly TransportFuelBindingV1[];
}>;
export const transportStorageActorAddress = (entityId: string) => ({
  componentId: TRANSPORT_STORAGE_ACTOR_COMPONENT,
  target: { kind: 'entity' as const, entityId },
});
export const transportStorageSiteAddress = (entityId: string) => ({
  componentId: TRANSPORT_STORAGE_SITE_COMPONENT,
  target: { kind: 'entity' as const, entityId },
});

export function defineTransportStorageModule(input: TransportStorageConfigV1): ModModule {
  const namespace = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
  if (
    !namespace.test(input.moduleId) ||
    !namespace.test(input.operationId) ||
    !Array.isArray(input.fuels) ||
    input.fuels.length > 256
  )
    throw new TypeError('Transport storage configuration is invalid.');
  const keys = new Set<string>();
  const fuels = input.fuels.map((binding) => {
    const key = `${binding.definitionId}\0${binding.itemId}`;
    if (
      !namespace.test(binding.definitionId) ||
      typeof binding.itemId !== 'string' ||
      !binding.itemId.trim() ||
      !Number.isSafeInteger(binding.units) ||
      binding.units <= 0 ||
      binding.units > 1_000_000_000 ||
      keys.has(key)
    )
      throw new TypeError('Transport fuel binding is invalid.');
    keys.add(key);
    return Object.freeze({ ...binding });
  });
  const config = Object.freeze({
    moduleId: input.moduleId,
    operationId: input.operationId,
    fuels: Object.freeze(fuels),
  });
  return Object.freeze({
    descriptor: {
      id: config.moduleId,
      version: '1.0.0',
      requires: [
        { id: TRANSPORT_INTERACTION_CAPABILITY, version: '1.0.0' },
        { id: 'seedlands:items', version: '1.0.0' },
        { id: 'seedlands:inventory', version: '1.0.0' },
      ],
      provides: [{ id: TRANSPORT_STORAGE_CAPABILITY, version: '1.0.0', definitionIdentity: JSON.stringify(config) }],
      permissions: [
        { resource: TRANSPORT_RESOURCE, operations: ['read', 'write', 'execute'] },
        { resource: 'seedlands.inventory', operations: ['read', 'write', 'execute'] },
      ],
    },
    register(api) {
      const transport = api.requireCapability<FrozenTransportInteractionConfig>(TRANSPORT_INTERACTION_CAPABILITY);
      const items = api.requireCapability<ItemDefinitionRegistry>('seedlands:items');
      for (const binding of fuels) {
        if (transport.definitions.require(binding.definitionId).fuelCapacity === null)
          throw new TypeError('Transport fuel binding requires configured fuel capacity.');
      }
      api.provideCapability(TRANSPORT_STORAGE_CAPABILITY, config);
      for (const id of [TRANSPORT_STORAGE_ACTOR_COMPONENT, TRANSPORT_STORAGE_SITE_COMPONENT])
        api.registerState({
          id,
          version: '1.0.0',
          resource: TRANSPORT_RESOURCE,
          validate: (value) => !!value && typeof value === 'object' && !Array.isArray(value),
        });
      api.registerOperation({
        id: config.operationId,
        resource: TRANSPORT_RESOURCE,
        run(context, raw, state) {
          if (context.kind !== 'actor' || context.target.kind !== 'entity')
            throw new TypeError('Transport storage requires an actor entity target.');
          const input = readTransportStorageInputV1(raw);
          if (input.actor.entityId !== context.originalActorId || input.transport.entityId !== context.target.entityId)
            throw new TypeError('Transport storage invocation target is invalid.');
          const actorAddress = transportStorageActorAddress(context.originalActorId);
          const actor = state.read(actorAddress) as TransportStorageActorV1;
          const site = state.read(transportStorageSiteAddress(context.target.entityId)) as TransportStorageSiteV1;
          const candidate = buildTransportStorageCandidateV1(
            { definitions: transport.definitions, items, fuels },
            actor,
            site,
            input,
          );
          state.write(actorAddress, candidate as ModuleInvocationValue);
          return candidate as ModuleInvocationValue;
        },
      });
    },
  } satisfies ModModule);
}
