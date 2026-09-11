import { describe, expect, it } from 'vitest';
import {
  assertGeneratedChunk,
  createKernelDefinitionRegistry,
  createMapKernelComponentStorage,
  createKernelStateOwner,
  createKernelRuntime,
  createKernelWorld,
  defineComponent,
  defineModule,
  defineSystem,
  requireWorldgenProvider,
  type KernelValue,
} from '../src/index';

const counter = defineComponent<number>({
  id: 'test:counter',
  moduleId: 'test:counter-module',
  storage: createMapKernelComponentStorage,
  codec: {
    version: 1,
    encode(value) {
      if (!Number.isSafeInteger(value)) throw new TypeError('Counter must be an integer.');
      return value;
    },
    decode(value: KernelValue) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('Counter payload is invalid.');
      return value;
    },
  },
});

const definitions = () => {
  const registry = createKernelDefinitionRegistry();
  registry.register(
    defineModule({
      id: 'test:counter-module',
      version: '1.0.0',
      components: [counter],
      systems: [
        defineSystem({
          id: 'test:increment',
          moduleId: 'test:counter-module',
          phase: 10,
          order: 0,
          run(context) {
            for (const entity of context.entities()) {
              const value = context.read('test:counter', entity.id);
              if (typeof value === 'number') context.write('test:counter', entity.id, value + 1);
            }
            context.emit('test:advanced', { tick: context.tick });
          },
        }),
      ],
    }),
  );
  return registry.freeze();
};

describe('bare Kernel world', () => {
  it('runs and restores a component without gameplay, apps, or a generator', () => {
    const frozen = definitions();
    const identity = { worldId: 'test-world', definitionIdentity: frozen.definitionIdentity };
    const world = createKernelWorld({ identity, definitions: frozen });
    world.transact(world.epoch, (candidate) => {
      const entity = candidate.spawn('test:entity');
      candidate.write(counter.id, entity.id, 4);
      candidate.emit('test:created', { id: entity.id });
    });
    world.advance(world.epoch);
    expect(world.read(counter.id, 'test:entity')).toBe(5);
    expect(world.events().map((event) => event.type)).toEqual(['test:created', 'test:advanced']);

    const checkpoint = world.checkpoint();
    const restored = createKernelWorld({ identity, definitions: frozen, checkpoint });
    expect(restored.epoch).toBe(world.epoch + 1);
    expect(restored.read(counter.id, 'test:entity')).toBe(5);
    restored.advance(restored.epoch);
    expect(restored.read(counter.id, 'test:entity')).toBe(6);
    expect(() => restored.transact(world.epoch, () => undefined)).toThrow(/Stale Kernel epoch/);
  });

  it('keeps live state unchanged when a candidate or checkpoint codec fails', () => {
    const frozen = definitions();
    const identity = { worldId: 'test-world', definitionIdentity: frozen.definitionIdentity };
    const world = createKernelWorld({ identity, definitions: frozen });
    world.transact(world.epoch, (candidate) => {
      const entity = candidate.spawn('test:entity');
      candidate.write(counter.id, entity.id, 7);
    });
    const before = world.checkpoint();
    expect(() =>
      world.transact(world.epoch, (candidate) => {
        candidate.write(counter.id, 'test:entity', 8);
        throw new Error('second participant rejected');
      }),
    ).toThrow('second participant rejected');
    expect(world.checkpoint()).toEqual(before);

    const invalid = {
      ...before,
      components: before.components.map((component) => ({
        ...component,
        entries: component.entries.map((entry) => ({ ...entry, value: 'invalid' })),
      })),
    };
    expect(() => createKernelWorld({ identity, definitions: frozen, checkpoint: invalid })).toThrow(
      'Counter payload is invalid',
    );
    expect(world.checkpoint()).toEqual(before);
  });

  it('keeps the published root unchanged when a delete lifecycle rejects', () => {
    const registry = createKernelDefinitionRegistry();
    registry.register(
      defineModule({
        id: 'test:deletion-module',
        version: '1.0.0',
        components: [
          defineComponent({
            ...counter,
            moduleId: 'test:deletion-module',
            lifecycle: {
              deleted: () => {
                throw new Error('delete rejected');
              },
            },
          }),
        ],
      }),
    );
    const frozen = registry.freeze();
    const identity = { worldId: 'delete-failure', definitionIdentity: frozen.definitionIdentity };
    const world = createKernelWorld({ identity, definitions: frozen });
    world.transact(world.epoch, (candidate) => {
      candidate.spawn('test:entity');
      candidate.write(counter.id, 'test:entity', 4);
      candidate.emit('test:created', null);
    });
    const before = world.checkpoint();
    expect(() => world.transact(world.epoch, (candidate) => candidate.remove('test:entity'))).toThrow(
      'delete rejected',
    );
    expect(world.checkpoint()).toEqual(before);
  });

  it('keeps all component roots unchanged when a later storage candidate rejects', () => {
    let rejectSecond = false;
    const rejectingStorage = () => {
      const wrap = (inner: ReturnType<typeof createMapKernelComponentStorage<number>>) => ({
        ...inner,
        fork: (writes: readonly Readonly<{ entityId: string; value?: number }>[]) => {
          if (rejectSecond) throw new Error('second storage rejected');
          return wrap(inner.fork(writes));
        },
      });
      return wrap(createMapKernelComponentStorage<number>());
    };
    const second = defineComponent<number>({
      ...counter,
      id: 'test:second-counter',
      storage: rejectingStorage,
    });
    const registry = createKernelDefinitionRegistry();
    registry.register(
      defineModule({
        id: 'test:counter-module',
        version: '1.0.0',
        components: [counter, second],
      }),
    );
    const frozen = registry.freeze();
    const identity = { worldId: 'storage-failure', definitionIdentity: frozen.definitionIdentity };
    const world = createKernelWorld({ identity, definitions: frozen });
    world.transact(world.epoch, (candidate) => {
      candidate.spawn('test:entity');
      candidate.write(counter.id, 'test:entity', 1);
      candidate.write(second.id, 'test:entity', 2);
    });
    const before = world.checkpoint();
    rejectSecond = true;
    expect(() =>
      world.transact(world.epoch, (candidate) => {
        candidate.write(counter.id, 'test:entity', 3);
        candidate.write(second.id, 'test:entity', 4);
      }),
    ).toThrow('second storage rejected');
    expect(world.checkpoint()).toEqual(before);
  });

  it('preflights commit capacity before publishing component or event roots', () => {
    const frozen = definitions();
    const identity = { worldId: 'commit-capacity', definitionIdentity: frozen.definitionIdentity };
    const source = createKernelWorld({ identity, definitions: frozen });
    source.transact(source.epoch, (candidate) => {
      candidate.spawn('test:entity');
      candidate.write(counter.id, 'test:entity', 1);
    });
    const exhausted = { ...source.checkpoint(), commitSequence: Number.MAX_SAFE_INTEGER };
    const restored = createKernelWorld({ identity, definitions: frozen, checkpoint: exhausted });
    const before = restored.checkpoint();
    expect(() =>
      restored.transact(restored.epoch, (candidate) => {
        candidate.write(counter.id, 'test:entity', 2);
        candidate.emit('test:uncommitted', null);
      }),
    ).toThrow('commit sequence is exhausted');
    expect(restored.checkpoint()).toEqual(before);
  });

  it('prepares a replacement owner with the next epoch and restored commit frontier', () => {
    const retired = createKernelStateOwner({ epoch: 7, commitSequence: 4, worldRevision: 3 });
    const candidate = createKernelStateOwner();
    expect(candidate.prepareReplacement(retired.epoch, { commitSequence: 9, worldRevision: 6 })).toBe(8);
    expect(candidate.snapshot()).toMatchObject({ epoch: 8, commitSequence: 9, worldRevision: 6 });
    retired.dispose();
    expect(() => retired.commitGameplay(7)).toThrow('disposed');
  });

  it('rejects missing module dependencies before publishing definitions', () => {
    const registry = createKernelDefinitionRegistry();
    registry.register(defineModule({ id: 'test:consumer', version: '1.0.0', requiredModules: ['test:missing'] }));
    expect(() => registry.freeze()).toThrow('requires missing module test:missing');
  });

  it('requires an explicit matching world generation provider', () => {
    expect(() => requireWorldgenProvider(undefined)).toThrow('no world-generation provider');
    const provider = {
      id: 'test:generator',
      implementationVersion: '1.0.0',
      configurationIdentity: 'config-a',
      supportedGeneratorVersions: [2, 3, 4],
      artifactIdentity: 'artifact-a',
    } as const;
    const candidate = {
      coordinate: { x: 1, y: 2, z: 3 },
      provider: { ...provider, configurationIdentity: 'config-b' },
      generatorVersion: 4,
      epoch: 1,
      revision: 2,
      voxels: new Uint16Array(1),
    };
    expect(() =>
      assertGeneratedChunk(
        { provider, generatorVersion: 4, epoch: 1, revision: 2, coordinate: { x: 1, y: 2, z: 3 } },
        candidate,
      ),
    ).toThrow('does not match');
  });
});

describe('production execution state owner', () => {
  it('creates registered module state and validates every codec before publishing a replacement', () => {
    const registry = createKernelDefinitionRegistry();
    const state = (id: string) => ({
      id,
      moduleId: 'test:state-module',
      codec: {
        version: 1,
        encode: (value: { count: number }) => ({ count: value.count }),
        decode: (value: KernelValue) => {
          if (!value || Array.isArray(value) || typeof value !== 'object')
            throw new TypeError(`${id} payload is invalid.`);
          const record = value as Readonly<Record<string, KernelValue>>;
          if (typeof record.count !== 'number') throw new TypeError(`${id} payload is invalid.`);
          return { count: record.count };
        },
      },
      create: () => ({ count: id.endsWith('first') ? 1 : 2 }),
      dispose: () => undefined,
    });
    registry.register(
      defineModule({
        id: 'test:state-module',
        version: '1.0.0',
        moduleStates: [state('test:first'), state('test:second')],
        operations: [{ id: 'test:increment', moduleId: 'test:state-module', version: '1.0.0' }],
        rules: [{ id: 'test:positive-only', moduleId: 'test:state-module', version: '1.0.0' }],
        resources: [{ id: 'test:counter-resource', moduleId: 'test:state-module', version: '1.0.0' }],
        capabilities: [{ id: 'test:counter-provider', moduleId: 'test:state-module', version: '1.0.0' }],
        providers: [
          {
            id: 'test:counter-provider-implementation',
            moduleId: 'test:state-module',
            version: '1.0.0',
            capabilityId: 'test:counter-provider',
            configurationIdentity: 'config-a',
            artifactIdentity: 'artifact-a',
          },
        ],
      }),
    );
    const frozen = registry.freeze();
    const identity = { worldId: 'test-state-world', definitionIdentity: frozen.definitionIdentity };
    const live = createKernelRuntime({ identity, definitions: frozen });
    const first = live.state<{ count: number }>('test:first');
    first.count = 7;
    const checkpoint = live.checkpoint();
    const invalid = {
      ...checkpoint,
      modules: checkpoint.modules.map((entry) =>
        entry.id === 'test:second' ? { ...entry, value: { count: 'invalid' } as unknown as KernelValue } : entry,
      ),
    };
    expect(() => createKernelRuntime({ identity, definitions: frozen, checkpoint: invalid })).toThrow(
      'test:second payload is invalid',
    );
    expect(live.state<{ count: number }>('test:first').count).toBe(7);
    expect(frozen.operations.has('test:increment')).toBe(true);
    expect(frozen.providers.get('test:counter-provider-implementation')?.configurationIdentity).toBe('config-a');
  });

  it('orders world and gameplay commits and rejects stale epochs', () => {
    const owner = createKernelStateOwner();
    owner.commitGameplay(owner.epoch);
    owner.commitWorldRevision(owner.epoch, 1);
    owner.synchronizeGameplayTime(owner.epoch, 0.5);
    expect(owner.snapshot()).toMatchObject({ commitSequence: 2, gameplayRevision: 1, worldRevision: 1 });
    const stale = owner.epoch;
    owner.replaceEpoch();
    expect(() => owner.commitGameplay(stale)).toThrow('Stale Kernel epoch');
  });

  it('owns and disposes registered module state in reverse order', () => {
    const disposed: string[] = [];
    const owner = createKernelStateOwner();
    owner.createParticipant({ id: 'test:first', create: () => 'first', dispose: disposed.push.bind(disposed) });
    owner.createParticipant({ id: 'test:second', create: () => 'second', dispose: disposed.push.bind(disposed) });
    owner.freezeParticipants();
    expect(() => owner.createParticipant({ id: 'test:late', create: () => 'late', dispose: () => undefined })).toThrow(
      'registration is frozen',
    );
    owner.dispose();
    expect(disposed).toEqual(['second', 'first']);
  });

  it('keeps state and participants isolated between world owners', () => {
    const first = createKernelStateOwner();
    const second = createKernelStateOwner();
    const firstState = first.createParticipant({
      id: 'test:state',
      create: () => ({ value: 1 }),
      dispose: () => undefined,
    });
    const secondState = second.createParticipant({
      id: 'test:state',
      create: () => ({ value: 2 }),
      dispose: () => undefined,
    });
    firstState.value = 3;
    first.commitGameplay(first.epoch);
    expect(secondState.value).toBe(2);
    expect(second.snapshot()).toMatchObject({ commitSequence: 0, gameplayRevision: 0 });
  });

  it('finishes reverse disposal and invalidates the owner when one participant fails', () => {
    const disposed: string[] = [];
    const owner = createKernelStateOwner();
    owner.createParticipant({ id: 'test:first', create: () => 'first', dispose: disposed.push.bind(disposed) });
    owner.createParticipant({
      id: 'test:failing',
      create: () => 'failing',
      dispose: () => {
        disposed.push('failing');
        throw new Error('dispose failed');
      },
    });
    owner.createParticipant({ id: 'test:last', create: () => 'last', dispose: disposed.push.bind(disposed) });
    const liveEpoch = owner.epoch;
    expect(() => owner.dispose()).toThrow('Kernel state participant disposal failed: dispose failed');
    expect(disposed).toEqual(['last', 'failing', 'first']);
    expect(() => owner.commitGameplay(liveEpoch)).toThrow('Kernel state owner is disposed');
    expect(() => owner.dispose()).not.toThrow();
  });
});
