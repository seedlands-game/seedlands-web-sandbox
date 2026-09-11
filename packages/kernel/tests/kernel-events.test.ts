import { expect, it } from 'vitest';
import { createKernelDefinitionRegistry, createKernelWorld, defineModule } from '../src/index';

const create = (eventCapacity = 4096) => {
  const registry = createKernelDefinitionRegistry();
  registry.register(defineModule({ id: 'test:events', version: '1.0.0' }));
  const definitions = registry.freeze();
  const identity = { worldId: 'events', definitionIdentity: definitions.definitionIdentity };
  return { world: createKernelWorld({ identity, definitions, eventCapacity }), identity, definitions };
};

it('fails before publication when its event buffer is full, and resumes after explicit acknowledgement', () => {
  const { world } = create(2);
  for (let value = 1; value <= 2; value++) world.transact(world.epoch, (context) => context.emit('event', value));
  const before = world.checkpoint();
  expect(() =>
    world.transact(world.epoch, (context) => {
      context.spawn('unpublished');
      context.emit('event', 3);
    }),
  ).toThrow(/event capacity/i);
  expect(world.checkpoint()).toEqual(before);
  expect(world.acknowledgeEvents(world.epoch, 1)).toBe(1);
  expect(world.acknowledgeEvents(world.epoch, 1)).toBe(0);
  world.transact(world.epoch, (context) => context.emit('event', 3));
  expect(world.events().map((event) => [event.sequence, event.payload])).toEqual([
    [2, 2],
    [4, 3],
  ]);
  const checkpoint = world.checkpoint();
  expect(() => world.acknowledgeEvents(world.epoch - 1, 4)).toThrow();
  expect(() => world.acknowledgeEvents(world.epoch, 5)).toThrow();
  expect(world.checkpoint()).toEqual(checkpoint);
  world.dispose();
});

it('retains ordered unacknowledged events during long-running consumption and checkpoint restore', () => {
  const { world, definitions, identity } = create();
  for (let index = 0; index < 20_000; index++) {
    const result = world.transact(world.epoch, (context) => context.emit('event', index));
    expect(result.events[0]?.sequence).toBe(index + 1 + Math.floor(index / 1000));
    if (index % 1000 === 999) {
      expect(world.events()).toHaveLength(1000);
      world.acknowledgeEvents(world.epoch, result.events[0]!.sequence);
    }
  }
  world.transact(world.epoch, (context) => context.emit('last', null));
  const checkpoint = world.checkpoint();
  const restored = createKernelWorld({ identity, definitions, checkpoint });
  expect(restored.events()).toEqual(world.events());
  expect(restored.checkpoint().eventCapacity).toBe(4096);
  expect(() => restored.acknowledgeEvents(world.epoch, checkpoint.commitSequence)).toThrow();
  expect(restored.acknowledgeEvents(restored.epoch, checkpoint.commitSequence)).toBe(1);
  expect(restored.events()).toEqual([]);
  world.dispose();
  restored.dispose();
});

it('rejects a checkpoint frontier that precedes its revision', () => {
  const { world, identity, definitions } = create();
  world.transact(world.epoch, () => undefined);
  expect(() =>
    createKernelWorld({ identity, definitions, checkpoint: { ...world.checkpoint(), commitSequence: 0 } }),
  ).toThrow(/frontier/i);
  world.dispose();
});
