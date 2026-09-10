import { defineBehaviorCapabilityModule, definePack } from '@seedlands/game-core/mod-api';

/** Negative browser fixture: admitted code can still fail during a pure condition evaluation. */
export const pack = definePack({
  id: 'sample:camp-work',
  version: '1.0.0',
  kind: 'extension',
  entry: 'camp-work.mjs',
  dependencies: [{ id: 'seedlands:overworld', version: '1.0.0' }],
  modules: [
    defineBehaviorCapabilityModule({
      id: 'sample:camp-behavior',
      version: '1.0.0',
      permissions: [],
      capabilities: [
        {
          id: 'sample:condition-unavailable',
          version: '1.0.0',
          kind: 'condition',
          description: 'Negative fixture: report an unavailable camp condition.',
          arguments: {},
          evaluate() {
            throw new Error('Camp condition is unavailable');
          },
        },
      ],
    }),
  ],
});
