import { expect, it } from 'vitest';
import {
  createKernelDefinitionRegistry,
  createKernelWorld,
  createMapKernelComponentStorage,
  defineComponent,
  defineModule,
  type KernelComponentDefinition,
  type KernelComponentStorage,
} from '../src/index';

type State = { count: number };
const component = defineComponent<State>({
  id: 'test:object',
  moduleId: 'test:objects',
  storage: createMapKernelComponentStorage,
  codec: {
    version: 1,
    encode: (state) => state,
    decode: (value) => {
      if (!value || typeof value !== 'object' || !('count' in value) || typeof value.count !== 'number')
        throw new Error('Invalid object state');
      return value as State;
    },
  },
});
function create(components: readonly KernelComponentDefinition<State>[]) {
  const registry = createKernelDefinitionRegistry();
  registry.register(defineModule({ id: 'test:objects', version: '1.0.0', components }));
  const definitions = registry.freeze();
  const world = createKernelWorld({
    identity: { worldId: 'objects', definitionIdentity: definitions.definitionIdentity },
    definitions,
  });
  world.transact(world.epoch, (candidate) => {
    candidate.spawn('entity');
    for (const definition of components) candidate.write(definition.id, 'entity', { count: 1 });
  });
  return world;
}

it('isolates an object-valued delete hook that mutates its value then throws', () => {
  const world = create([
    {
      ...component,
      lifecycle: {
        deleted: (_id, value) => {
          value.count = 2;
          throw new Error('delete rejected');
        },
      },
    },
  ]);
  const before = structuredClone(world.checkpoint());
  expect(() => world.transact(world.epoch, (candidate) => candidate.remove('entity'))).toThrow('delete rejected');
  expect(world.read<State>(component.id, 'entity')).toEqual({ count: 1 });
  expect(world.checkpoint()).toEqual(before);
});

it('discards first-storage candidate mutations when the next storage rejects', () => {
  let rejecting = false;
  let candidateMutation = false;
  const wrap = (storage: KernelComponentStorage<State>, first: boolean): KernelComponentStorage<State> => ({
    ...storage,
    fork(writes) {
      if (rejecting && !first) throw new Error('second rejected');
      const candidate = storage.fork(writes);
      if (rejecting && first) {
        candidate.read('entity')!.count = 99;
        candidateMutation = true;
      }
      return wrap(candidate, first);
    },
  });
  const first = { ...component, storage: () => wrap(createMapKernelComponentStorage<State>(), true) };
  const second = {
    ...component,
    id: 'test:second',
    storage: () => wrap(createMapKernelComponentStorage<State>(), false),
  };
  const world = create([first, second]);
  const before = structuredClone(world.checkpoint());
  const projection = world.read<State>(component.id, 'entity')!;
  rejecting = true;
  expect(() =>
    world.transact(world.epoch, (candidate) => {
      candidate.write(first.id, 'entity', projection);
      candidate.write(second.id, 'entity', { count: 2 });
    }),
  ).toThrow('second rejected');
  expect(candidateMutation).toBe(true);
  expect(world.checkpoint()).toEqual(before);
});

it('does not expose state or event payloads through reads, receipts or checkpoints', () => {
  const world = create([component]);
  const payload = { count: 3 };
  const result = world.transact(world.epoch, (candidate) => candidate.emit('test:event', payload));
  const before = structuredClone(world.checkpoint());
  world.read<State>(component.id, 'entity')!.count = 20;
  (result.events[0]!.payload as State).count = 21;
  const checkpoint = world.checkpoint();
  (checkpoint.components[0]!.entries[0]!.value as State).count = 22;
  (checkpoint.events[0]!.payload as State).count = 23;
  payload.count = 24;
  expect(world.checkpoint()).toEqual(before);
});

it('releases every rejected storage candidate in reverse order without masking the preparation error', () => {
  const disposed: string[] = [];
  let reject = false;
  const wrap = (
    id: string,
    storage: KernelComponentStorage<State>,
    candidate = false,
  ): KernelComponentStorage<State> => ({
    ...storage,
    fork: (writes) => wrap(id, storage.fork(writes), true),
    dispose: () => {
      storage.dispose?.();
      if (candidate && reject) {
        disposed.push(id);
        if (id === 'test:second') throw new Error('cleanup failed');
      }
    },
  });
  const definitions = ['test:first', 'test:second'].map((id) => ({
    ...component,
    id,
    storage: () => wrap(id, createMapKernelComponentStorage<State>()),
    lifecycle: {
      deleted: () => {
        if (reject) throw new Error('delete rejected');
      },
    },
  }));
  const world = create(definitions);
  const before = structuredClone(world.checkpoint());
  reject = true;
  expect(() => world.transact(world.epoch, (candidate) => candidate.remove('entity'))).toThrow('delete rejected');
  expect(disposed).toEqual(['test:second', 'test:first']);
  expect(world.checkpoint()).toEqual(before);
});

it('disposes committed storage forks before their base storage, exactly once', () => {
  const disposed: number[] = [];
  let serial = 0;
  const wrap = (storage: KernelComponentStorage<State>): KernelComponentStorage<State> => {
    const id = serial++;
    return {
      ...storage,
      fork: (writes) => wrap(storage.fork(writes)),
      dispose: () => {
        disposed.push(id);
        storage.dispose?.();
      },
    };
  };
  const world = create([{ ...component, storage: () => wrap(createMapKernelComponentStorage<State>()) }]);
  world.transact(world.epoch, (candidate) => candidate.write(component.id, 'entity', { count: 2 }));
  world.dispose();
  expect(disposed).toEqual([2, 1, 0]);
});

it('can checkpoint after a long sequence of idle ticks and component updates', () => {
  const world = create([component]);
  for (let tick = 0; tick < 20_000; tick++) world.advance(world.epoch);
  expect(world.checkpoint().logicalTick).toBe(20_000);
  for (let count = 2; count <= 20_000; count++)
    world.transact(world.epoch, (candidate) => candidate.write(component.id, 'entity', { count }));
  expect(world.checkpoint().components[0]?.entries).toEqual([{ entityId: 'entity', value: { count: 20_000 } }]);
  expect(world.read<State>(component.id, 'entity')).toEqual({ count: 20_000 });
  for (let index = 0; index < 1_000; index++) {
    world.transact(world.epoch, (candidate) => candidate.spawn('transient'));
    world.transact(world.epoch, (candidate) => candidate.remove('transient'));
  }
  expect(world.checkpoint().entities.map((entity) => entity.id)).toEqual(['entity']);
  world.dispose();
});

it('keeps an explicit null component value instead of reading its parent value', () => {
  const original = createMapKernelComponentStorage<string | null>();
  original.write('entity', 'before');
  const candidate = original.fork([{ entityId: 'entity', value: null }]);
  expect(candidate.has('entity')).toBe(true);
  expect(candidate.read('entity')).toBeNull();
  expect(candidate.entries()).toEqual([{ entityId: 'entity', value: null }]);
  expect(original.read('entity')).toBe('before');
});

it('owns an immutable world identity independent of the constructor input', () => {
  const registry = createKernelDefinitionRegistry();
  registry.register(defineModule({ id: 'test:objects', version: '1.0.0', components: [component] }));
  const definitions = registry.freeze();
  const identity = { worldId: 'original', definitionIdentity: definitions.definitionIdentity };
  const world = createKernelWorld({ identity, definitions });
  identity.worldId = 'changed';
  expect(world.identity.worldId).toBe('original');
  expect(Reflect.set(world.identity, 'worldId', 'changed-again')).toBe(false);
  expect(Reflect.set(world.checkpoint().identity, 'worldId', 'changed-via-save')).toBe(false);
  expect(world.identity.worldId).toBe('original');
  world.dispose();
});

it('reads an explicit null through a later transaction without treating it as an absent component', () => {
  const registry = createKernelDefinitionRegistry();
  registry.register(
    defineModule({
      id: 'test:null',
      version: '1.0.0',
      components: [
        {
          id: 'test:null-value',
          moduleId: 'test:null',
          codec: {
            version: 1,
            encode: (value: unknown) => (value === null ? null : String(value)),
            decode: (value) => value,
          },
          storage: () => createMapKernelComponentStorage<unknown>(),
        },
      ],
    }),
  );
  const definitions = registry.freeze();
  const world = createKernelWorld({
    identity: { worldId: 'null', definitionIdentity: definitions.definitionIdentity },
    definitions,
  });
  world.transact(world.epoch, (context) => {
    context.spawn('entity');
    context.write('test:null-value', 'entity', null);
  });
  world.transact(world.epoch, (context) => {
    expect(context.has('test:null-value', 'entity')).toBe(true);
    expect(context.read('test:null-value', 'entity')).toBeNull();
  });
  world.dispose();
});

it('never reuses an entity lifetime after removal, checkpoint restore, or directory compaction', () => {
  const registry = createKernelDefinitionRegistry();
  registry.register(defineModule({ id: 'test:lifetime', version: '1.0.0' }));
  const definitions = registry.freeze();
  const identity = { worldId: 'lifetime', definitionIdentity: definitions.definitionIdentity };
  const world = createKernelWorld({ identity, definitions });
  world.transact(world.epoch, (context) => context.spawn('entity'));
  const original = world.entities()[0]!;
  world.transact(world.epoch, (context) => context.remove('entity'));
  for (let index = 0; index < 150; index++) {
    world.transact(world.epoch, (context) => context.spawn('entity'));
    expect(world.entities()[0]!.lifetime).toBeGreaterThan(original.lifetime);
    world.transact(world.epoch, (context) => context.remove('entity'));
  }
  const checkpoint = world.checkpoint();
  const restored = createKernelWorld({ identity, definitions, checkpoint });
  restored.transact(restored.epoch, (context) => context.spawn('entity'));
  expect(restored.entities()[0]!.lifetime).toBe(checkpoint.lifetimeHighWater + 1);
  expect(() =>
    createKernelWorld({ identity, definitions, checkpoint: { ...restored.checkpoint(), lifetimeHighWater: 0 } }),
  ).toThrow(/entity is invalid/i);
  world.dispose();
  restored.dispose();
});
