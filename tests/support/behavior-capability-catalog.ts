import type { BehaviorCapability } from '@seedlands/game-core/runtime/behavior-control-protocol';
import { BEHAVIOR_MAX_CATALOG_BYTES } from '@seedlands/game-core/runtime/behavior-control-protocol';
import { behaviorJsonBytes } from '@seedlands/game-core/runtime/behavior-json';
import {
  createBehaviorCapabilityRegistry,
  type BehaviorCapabilityRegistry,
  type BehaviorConditionProviderDefinition,
} from '../../packages/game-core/src/server/composition/behavior-capability-registry';

const PROVIDER_ID = 'example:catalog-provider';
const PROVIDER_VERSION = '1.0.0';
const CAPABILITY_COUNT = 45;

const descriptor = (index: number, descriptionLength: number): BehaviorCapability => {
  const id = `example:catalog-${index}`;
  return {
    id,
    name: id,
    version: '1.0.0',
    provider: { moduleId: PROVIDER_ID, version: PROVIDER_VERSION },
    kind: 'condition',
    description: 'x'.repeat(descriptionLength),
    arguments: {},
    requiredOperations: [],
  };
};

function maximumDescriptors(extraBytes: number): readonly BehaviorCapability[] {
  const result = Array.from({ length: CAPABILITY_COUNT }, (_, index) => descriptor(index, 1));
  let remaining = BEHAVIOR_MAX_CATALOG_BYTES - behaviorJsonBytes(result) + extraBytes;
  for (let index = 0; index < result.length && remaining > 0; index++) {
    const added = Math.min(remaining, 511);
    result[index] = descriptor(index, 1 + added);
    remaining -= added;
  }
  if (remaining !== 0) throw new Error('Maximum behavior catalog fixture cannot reach its requested byte size.');
  return result;
}

export function createMaximumBehaviorCatalog(extraBytes = 0): readonly BehaviorCapability[] {
  const registry: BehaviorCapabilityRegistry = createBehaviorCapabilityRegistry();
  for (const entry of maximumDescriptors(extraBytes)) {
    const definition: BehaviorConditionProviderDefinition = {
      kind: 'condition',
      id: entry.id,
      version: entry.version,
      description: entry.description,
      arguments: entry.arguments,
      evaluate: () => false,
    };
    registry.register(
      { moduleId: PROVIDER_ID, moduleVersion: PROVIDER_VERSION, packId: 'example:catalog-pack' },
      definition,
    );
  }
  registry.freeze({
    operation: () => null,
    module: (id) => (id === PROVIDER_ID ? { packId: 'example:catalog-pack', permissions: [] } : null),
  });
  return registry.catalog();
}
