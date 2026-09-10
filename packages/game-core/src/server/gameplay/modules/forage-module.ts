import type { ModModule } from '../../composition/contracts';
import type { ItemDefinitionRegistry } from '../item-registry';
import {
  FORAGE_ADVANCE_OPERATION,
  FORAGE_CAPABILITY,
  FORAGE_MODULE_ID,
  FORAGE_RESOURCE,
  FORAGE_SYSTEM,
  FORAGE_WORLD_COMPONENT,
  buildForageCandidate,
  forageSeconds,
  forageWorldAddress,
  validateForageConfiguration,
  validateForageWorldProjection,
  type ForageModuleConfiguration,
} from './forage-model';

export function defineForageModule(input: ForageModuleConfiguration): ModModule {
  const supplied = validateForageConfiguration(input);
  return Object.freeze({
    descriptor: {
      id: FORAGE_MODULE_ID,
      version: '1.0.0',
      requires: [{ id: 'seedlands:items', version: '1.0.0' }],
      provides: [{ id: FORAGE_CAPABILITY, version: '1.0.0' }],
      resources: [{ id: FORAGE_RESOURCE, operations: ['read', 'execute'] }],
      permissions: [{ resource: FORAGE_RESOURCE, operations: ['read', 'execute'] }],
    },
    register(api) {
      const items = api.requireCapability<ItemDefinitionRegistry>('seedlands:items');
      let configuration: ForageModuleConfiguration | undefined;
      const resolve = () => (configuration ??= validateForageConfiguration(supplied, items));
      api.onDefinitionsReady(resolve);
      api.provideCapability(FORAGE_CAPABILITY, Object.freeze({ resolve }));
      api.registerState({
        id: FORAGE_WORLD_COMPONENT,
        version: '1.0.0',
        resource: FORAGE_RESOURCE,
        validate(value) {
          try {
            validateForageWorldProjection(value);
            return true;
          } catch {
            return false;
          }
        },
      });
      api.registerOperation({
        id: FORAGE_ADVANCE_OPERATION,
        executionKind: 'system',
        resource: FORAGE_RESOURCE,
        run(context, input, state) {
          if (context.kind !== 'system' || context.systemId !== FORAGE_SYSTEM || context.target.kind !== 'world')
            throw new TypeError('Forage advance requires its registered world system.');
          const configuration = resolve();
          forageSeconds(input, configuration);
          return buildForageCandidate(state.read(forageWorldAddress()), configuration);
        },
      });
      api.registerSystem({
        id: FORAGE_SYSTEM,
        operationId: FORAGE_ADVANCE_OPERATION,
        intervalSeconds: supplied.intervalSeconds,
      });
    },
  } satisfies ModModule);
}
