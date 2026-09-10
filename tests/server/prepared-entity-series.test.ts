import { describe, expect, it } from 'vitest';
import { EntityStore } from '../../packages/game-core/src/server/gameplay/entity-store';
import {
  prepareEntityMutation,
  prepareEntityMutationSeries,
} from '../../packages/game-core/src/server/gameplay/prepared-entity-mutation';

function setup() {
  const store = new EntityStore();
  for (const id of ['a', 'b', 'c', 'd']) store.spawn({ id, type: 'player', position: [0, 1, 0] });
  const series = ['a', 'b', 'c', 'd'].map((id) => ({
    actors: [
      {
        reference: store.createReference(id)!,
        health: 0,
        components: { ...store.actorComponentSnapshot(id), lifecycle: 'dead' as const },
      },
    ],
    spawns: [{ position: [0, 1, 0] as const, stack: { itemId: 'wood-block', count: 1 } }],
  }));
  return { store, series };
}

describe('one allocator frontier across bounded entity segments', () => {
  it('commits multiple death/drop segments without allocator staleness or epoch replacement', () => {
    const { store, series } = setup();
    const reference = store.createReference('a')!;
    const before = store.exportComponentSnapshot();
    const prepared = prepareEntityMutationSeries(store, series);
    expect(store.exportComponentSnapshot()).toEqual(before);
    prepared.validate();
    expect(prepared.apply().spawned).toHaveLength(4);
    expect(store.resolveReference(reference)?.health).toBe(0);
    expect(new Set(store.query({ type: 'world-item' }).map(({ id }) => id)).size).toBe(4);
  });
  it('rejects late allocator exhaustion without committing any segment', () => {
    const { store } = setup();
    const exhausted = store.exportComponentSnapshot();
    exhausted.sequence = Number.MAX_SAFE_INTEGER - 2;
    store.restoreComponentSnapshot(exhausted);
    const before = store.exportComponentSnapshot();
    const series = ['a', 'b', 'c', 'd'].map((id) => ({
      actors: [
        {
          reference: store.createReference(id)!,
          health: 0,
          components: { ...store.actorComponentSnapshot(id), lifecycle: 'dead' as const },
        },
      ],
      spawns: [{ position: [0, 1, 0] as const, stack: { itemId: 'wood-block', count: 1 } }],
    }));
    expect(() => prepareEntityMutationSeries(store, series)).toThrow(/sequence.*exhausted/i);
    expect(store.exportComponentSnapshot()).toEqual(before);
  });
  it('rejects sparse candidate arrays before a valid preceding candidate can be installed', () => {
    const { store, series } = setup();
    const actors = [series[0].actors[0], series[1].actors[0]];
    delete actors[1];
    const before = store.exportComponentSnapshot();
    expect(() => prepareEntityMutation(store, { actors })).toThrow(/dense/i);
    expect(store.exportComponentSnapshot()).toEqual(before);
  });
});
