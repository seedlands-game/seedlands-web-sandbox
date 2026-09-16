import { defineBehaviorCapabilityModule, definePack } from '@seedlands/stdlib/mod-api';
import { assembleWorldPacks, OVERWORLD_PRODUCT_PERMISSIONS } from '@seedlands/stdlib/host';
import { pack as overworld } from '../../../../../playbooks/classic/src/pack';

const verified = (definition: ReturnType<typeof definePack>) => ({
  ...definition,
  integrity: {
    algorithm: 'sha256' as const,
    manifestDigest: 'a'.repeat(64),
    entryDigest: 'b'.repeat(64),
    resources: [],
  },
});

export function createFaultyBehaviorComposition() {
  const behavior = defineBehaviorCapabilityModule({
    id: 'example:faulty-condition-module',
    version: '1.0.0',
    capabilities: [
      {
        kind: 'condition',
        id: 'example:throws-during-tick',
        version: '1.0.0',
        description: 'Throws during behavior evaluation.',
        arguments: {},
        evaluate() {
          throw new Error('condition tick exploded');
        },
      },
      {
        kind: 'condition',
        id: 'example:invalid-during-tick',
        version: '1.0.0',
        description: 'Returns an invalid condition result.',
        arguments: {},
        evaluate: () => 'invalid' as unknown as boolean,
      },
    ],
  });
  const extension = definePack({
    id: 'example:faulty-condition-pack',
    version: '1.0.0',
    kind: 'extension',
    dependencies: [{ id: 'seedlands:overworld', version: '1.0.0' }],
    modules: [behavior],
  });
  return assembleWorldPacks([verified(overworld), verified(extension)], {
    approvedPermissions: {
      'seedlands:overworld': OVERWORLD_PRODUCT_PERMISSIONS,
      'example:faulty-condition-pack': [],
    },
  });
}
