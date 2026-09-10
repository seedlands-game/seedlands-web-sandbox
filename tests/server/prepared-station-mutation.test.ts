import { describe, expect, it } from 'vitest';
import type { ActorComponentSnapshot } from '../../packages/game-core/src/server/gameplay/ecs-actor-components';
import { createStationStateCodec } from '../../packages/game-core/src/server/gameplay/ecs-station-state';
import { EntityStore } from '../../packages/game-core/src/server/gameplay/entity-store';
import { createItemDefinitionRegistry } from '../../packages/game-core/src/server/gameplay/item-registry';
import { createFurnaceDefinitions } from '../../packages/game-core/src/server/gameplay/modules/furnace-candidates';
import { prepareEntityMutation } from '../../packages/game-core/src/server/gameplay/prepared-entity-mutation';

const items = createItemDefinitionRegistry([
  { id: 'test:wood', name: 'Wood', itemType: 'resource', stackLimit: 64, capabilities: [] },
  { id: 'test:ore', name: 'Ore', itemType: 'resource', stackLimit: 64, capabilities: [] },
  { id: 'test:ingot', name: 'Ingot', itemType: 'resource', stackLimit: 64, capabilities: [] },
]);
const codec = createStationStateCodec({
  items,
  furnace: createFurnaceDefinitions({ items, recipes: [], fuels: [] }),
  definitions: [
    { kind: 'workbench', voxel: 41 },
    { kind: 'chest', voxel: 42 },
    { kind: 'furnace', voxel: 43 },
  ],
});

const setup = () => {
  const store = new EntityStore(items, codec);
  store.spawn({ id: 'player', type: 'player', position: [0, 8, 0] });
  store.spawn({ id: 'old-chest', type: 'station', position: [1, 8, 0], station: { kind: 'chest' } });
  store.spawn({
    id: 'retired-drop',
    type: 'world-item',
    position: [2, 8, 0],
    stack: { itemId: 'test:wood', count: 1 },
  });
  return store;
};

const actorWithWood = (store: EntityStore): ActorComponentSnapshot => {
  const actor = store.actorComponentSnapshot('player');
  return { ...actor, inventory: [{ itemId: 'test:wood', count: 3 }, ...actor.inventory.slice(1)] };
};

describe('prepared station mutation', () => {
  it('atomically combines actor inventory, station replacement, station spawn, drop and despawn', () => {
    const store = setup();
    const current = store.stationSnapshot('old-chest');
    if (current.kind !== 'chest') throw new Error('fixture mismatch');
    const slots = current.slots.map((slot) => (slot ? structuredClone(slot) : null));
    slots[0] = { itemId: 'test:ore', count: 2 };
    const replacement = { ...current, revision: 1, slots };
    const position: [number, number, number] = [4, 8, 0];
    const prepared = prepareEntityMutation(store, {
      actors: [{ reference: store.createReference('player')!, health: 20, components: actorWithWood(store) }],
      stations: [{ reference: store.createReference('old-chest')!, snapshot: replacement }],
      stationSpawns: [{ position, kind: 'workbench' }],
      spawns: [{ position: [5, 8, 0], stack: { itemId: 'test:wood', count: 1 } }],
      despawns: [store.createReference('retired-drop')!],
    });
    slots[0]!.count = 63;
    position[0] = 99;

    expect(prepared.spawnIds).toEqual(['world-item-1', 'station-2']);
    prepared.validate();
    const result = prepared.apply();
    expect(result).toMatchObject({ actorIds: ['player'], stationIds: ['old-chest'], despawnedIds: ['retired-drop'] });
    expect(store.actorStateAccess('player').inventory.slot(0)).toEqual({ itemId: 'test:wood', count: 3 });
    const installed = store.stationSnapshot('old-chest');
    expect(installed).toMatchObject({ revision: 1 });
    expect(installed.kind === 'chest' ? installed.slots[0] : null).toEqual({ itemId: 'test:ore', count: 2 });
    expect(store.stationAt([4, 8, 0])).toMatchObject({ id: 'station-2' });
    expect(store.get('world-item-1')).toMatchObject({ stack: { itemId: 'test:wood', count: 1 } });
    expect(store.get('retired-drop')).toBeNull();
    expect(() => prepared.apply()).toThrow(/used|applied/i);
  });

  it('rejects stale station state after validation with no mutation to actor, station, drop or allocator', () => {
    const store = setup();
    const replacement = store.stationSnapshot('old-chest');
    if (replacement.kind !== 'chest') throw new Error('fixture mismatch');
    const next = { ...replacement, revision: 1, slots: [...replacement.slots] };
    const prepared = prepareEntityMutation(store, {
      actors: [{ reference: store.createReference('player')!, health: 20, components: actorWithWood(store) }],
      stations: [{ reference: store.createReference('old-chest')!, snapshot: next }],
      stationSpawns: [{ id: 'new-bench', position: [4, 8, 0], kind: 'workbench' }],
      spawns: [{ id: 'new-drop', position: [5, 8, 0], stack: { itemId: 'test:wood', count: 1 } }],
      despawns: [store.createReference('retired-drop')!],
    });
    prepared.validate();
    const external = { ...replacement, revision: 1, slots: [...replacement.slots] };
    const direct = store.prepareMutation({
      stations: [{ reference: store.createReference('old-chest')!, snapshot: external }],
    });
    direct.validate();
    direct.apply();
    const changed = store.exportComponentSnapshot();

    expect(() => prepared.apply()).toThrow(/stale|changed/i);
    expect(store.exportComponentSnapshot()).toEqual(changed);
    expect(store.get('new-bench')).toBeNull();
    expect(store.get('new-drop')).toBeNull();
    expect(store.get('retired-drop')).not.toBeNull();
  });

  it('rejects station allocation capacity before changing an actor or sequence', () => {
    const store = setup();
    const exhausted = structuredClone(store.exportComponentSnapshot());
    exhausted.lifetimeHighWater = Number.MAX_SAFE_INTEGER;
    store.restoreComponentSnapshot(exhausted);
    const before = store.exportComponentSnapshot();
    expect(() =>
      prepareEntityMutation(store, {
        actors: [{ reference: store.createReference('player')!, health: 20, components: actorWithWood(store) }],
        stationSpawns: [{ position: [8, 8, 0], kind: 'workbench' }],
      }),
    ).toThrow(/lifetime|capacity|exhausted/i);
    expect(store.exportComponentSnapshot()).toEqual(before);
    expect(store.nextSequence).toBe(before.sequence);
  });

  it('rejects duplicate station positions and invalid late station candidates before touching live state', () => {
    const store = setup();
    const before = store.exportComponentSnapshot();
    expect(() => prepareEntityMutation(store, { stationSpawns: [{ position: [1, 8, 0], kind: 'workbench' }] })).toThrow(
      /position|occupied/i,
    );
    const snapshot = store.stationSnapshot('old-chest');
    if (snapshot.kind !== 'chest') throw new Error('fixture mismatch');
    expect(() =>
      prepareEntityMutation(store, {
        actors: [{ reference: store.createReference('player')!, health: 20, components: actorWithWood(store) }],
        stations: [{ reference: store.createReference('old-chest')!, snapshot: { ...snapshot, slots: [] } }],
        spawns: [{ id: 'would-be-drop', position: [5, 8, 0], stack: { itemId: 'test:wood', count: 1 } }],
      }),
    ).toThrow(/slot|24|station/i);
    expect(store.exportComponentSnapshot()).toEqual(before);
    expect(store.get('would-be-drop')).toBeNull();
  });
});
