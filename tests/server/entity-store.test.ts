import { describe, expect, it } from 'vitest';
import { EntityStore } from '../../packages/game-core/src/server/gameplay/entity-store';

describe('EntityStore ECS facade', () => {
  it('rejects a bad restore atomically after validating earlier candidate entities', () => {
    const store = new EntityStore();
    store.spawn({ id: 'original', type: 'creature', position: [1, 8, 1] });
    const reference = store.createReference('original');
    store.queryNearby([1, 8, 1], 1);
    const metrics = store.metrics();

    expect(() =>
      store.restore([
        { id: 'candidate', type: 'creature', position: [20, 8, 0] },
        { id: 'broken', type: 'creature', position: [21, 8, 0], health: 13, maxHealth: 12 },
      ]),
    ).toThrow(/health/i);

    expect(store.query().map((entity) => entity.id)).toEqual(['original']);
    expect(store.queryNearby([1, 8, 1], 1).map((entity) => entity.id)).toEqual(['original']);
    expect(store.resolveReference(reference!)).toMatchObject({ id: 'original', position: [1, 8, 1] });
    expect(store.metrics()).toEqual({ ...metrics, returnedEntityCount: 1 });
  });

  it('invalidates pre-restore references and keeps every previously issued id retired', () => {
    const store = new EntityStore();
    store.spawn({ id: 'old', type: 'creature', position: [0, 8, 0] });
    const reference = store.createReference('old');

    store.restore([{ id: 'restored', type: 'npc', position: [3, 8, 0], archetype: 'settler' }], 7);

    expect(store.resolveReference(reference!)).toBeNull();
    expect(store.nextSequence).toBe(7);
    expect(store.exportSnapshot().map((entity) => entity.id)).toEqual(['restored']);
    expect(() => store.spawn({ id: 'old', type: 'creature', position: [0, 8, 0] })).toThrow(/issued|retired/i);
  });

  it('advances generated ids past a retired explicit identity', () => {
    const store = new EntityStore();
    store.spawn({ id: 'creature-1', type: 'creature', position: [0, 8, 0] });
    store.despawn('creature-1');

    expect(store.spawn({ type: 'creature', position: [1, 8, 0] }).id).toBe('creature-2');
    expect(store.nextSequence).toBe(2);
  });

  it('copies input and every public projection while preserving filtered query order', () => {
    const store = new EntityStore();
    const position: [number, number, number] = [1, 8, 1];
    const velocity: [number, number, number] = [1, 2, 3];
    store.spawn({ id: 'first', type: 'creature', position, physicsVelocity: velocity });
    store.spawn({ id: 'drop', type: 'world-item', position: [2, 8, 1], stack: { itemId: 'wood-block', count: 2 } });
    store.spawn({ id: 'third', type: 'creature', position: [3, 8, 1] });
    position[0] = 99;
    velocity[0] = 99;

    const projection = store.query({ type: 'creature' });
    projection[0]!.position[0] = 88;
    projection[0]!.physicsVelocity![0] = 88;

    expect(store.query({ type: 'creature' }).map((entity) => entity.id)).toEqual(['first', 'third']);
    expect(store.get('first')).toMatchObject({ position: [1, 8, 1], physicsVelocity: [1, 2, 3] });
  });
});
