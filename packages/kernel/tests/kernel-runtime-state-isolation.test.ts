import { describe, expect, it } from 'vitest';
import { createKernelDefinitionRegistry, createKernelRuntime, defineModule, type KernelValue } from '../src';

const definitions = () => {
  const registry = createKernelDefinitionRegistry();
  registry.register(
    defineModule({
      id: 'test:identity-codec-module',
      version: '1.0.0',
      moduleStates: [
        {
          id: 'test:identity-codec-state',
          moduleId: 'test:identity-codec-module',
          codec: {
            version: 1,
            encode: (value: { nested: { count: number } }) => value as KernelValue,
            decode: (value: KernelValue) => value as { nested: { count: number } },
          },
          create: () => ({ nested: { count: 1 } }),
          restore: (_port, value) => value as { nested: { count: number } },
          dispose: () => undefined,
        },
      ],
    }),
  );
  return registry.freeze();
};

describe('Kernel runtime module-state isolation', () => {
  it('isolates identity-codec checkpoint output and restore input from live state', () => {
    const frozen = definitions();
    const identity = { worldId: 'test:identity-codec-world', definitionIdentity: frozen.definitionIdentity };
    const source = createKernelRuntime({ identity, definitions: frozen });
    identity.worldId = 'mutated-caller-world';
    expect(source.identity).toEqual({
      worldId: 'test:identity-codec-world',
      definitionIdentity: frozen.definitionIdentity,
    });
    expect(Object.isFrozen(source.identity)).toBe(true);
    const checkpoint = source.checkpoint();
    expect(checkpoint.identity).toBe(source.identity);
    const wire = checkpoint.modules[0]!.value as { nested: { count: number } };
    wire.nested.count = 7;
    expect(source.state<{ nested: { count: number } }>('test:identity-codec-state').nested.count).toBe(1);

    const restored = createKernelRuntime({ identity: source.identity, definitions: frozen, checkpoint });
    wire.nested.count = 9;
    expect(restored.state<{ nested: { count: number } }>('test:identity-codec-state').nested.count).toBe(7);
    restored.state<{ nested: { count: number } }>('test:identity-codec-state').nested.count = 11;
    expect(wire.nested.count).toBe(9);
    source.dispose();
    restored.dispose();
  });

  it('rejects a checkpoint whose commit frontier precedes a registered revision', () => {
    const frozen = definitions();
    const identity = { worldId: 'test:invalid-frontier-world', definitionIdentity: frozen.definitionIdentity };
    const source = createKernelRuntime({ identity, definitions: frozen });
    const checkpoint = source.checkpoint();
    expect(() =>
      createKernelRuntime({
        identity,
        definitions: frozen,
        checkpoint: {
          ...checkpoint,
          state: { ...checkpoint.state, commitSequence: 0, gameplayRevision: 1 },
        },
      }),
    ).toThrow('commit frontier precedes');
    source.dispose();
  });
});
