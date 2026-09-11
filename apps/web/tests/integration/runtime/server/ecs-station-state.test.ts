import { describe, expect, it } from 'vitest';
import {
  createStationStateCodec,
  type StationComponentV1,
} from '../../../../../../packages/stdlib/src/server/gameplay/ecs-station-state';
import { EntityStore } from '../../../fixtures/classic/content';
import { createItemDefinitionRegistry } from '../../../../../../packages/stdlib/src/server/gameplay/item-registry';
import {
  createFurnaceDefinitions,
  emptyFurnaceSnapshot,
} from '../../../../../../packages/stdlib/src/server/gameplay/modules/furnace-candidates';

const items = createItemDefinitionRegistry([
  { id: 'test:wood', name: 'Wood', itemType: 'resource', stackLimit: 64, capabilities: [] },
  { id: 'test:ore', name: 'Ore', itemType: 'resource', stackLimit: 64, capabilities: [] },
  { id: 'test:ingot', name: 'Ingot', itemType: 'resource', stackLimit: 64, capabilities: [] },
]);
const furnace = createFurnaceDefinitions({
  items,
  recipes: [
    {
      id: 'test:smelt',
      input: { itemId: 'test:ore', count: 1 },
      output: { itemId: 'test:ingot', count: 1 },
      durationSeconds: 5,
    },
  ],
  fuels: [{ itemId: 'test:wood', burnSeconds: 8 }],
});
const codec = createStationStateCodec({
  items,
  furnace,
  definitions: [
    { kind: 'workbench', voxel: 41 },
    { kind: 'chest', voxel: 42 },
    { kind: 'furnace', voxel: 43 },
  ],
});

describe('ECS station state', () => {
  it('creates immutable per-world station components without actor or dynamic-query leakage', () => {
    const first = new EntityStore(items, codec);
    const second = new EntityStore(items, codec);
    const created = first.spawn({ id: 'bench', type: 'station', position: [2, 8, 3], station: { kind: 'workbench' } });
    second.spawn({ id: 'bench', type: 'station', position: [9, 8, 9], station: { kind: 'workbench' } });

    expect(created).toMatchObject({ id: 'bench', type: 'station', kind: 'station', position: [2, 8, 3] });
    expect(first.query()).toEqual([]);
    expect(first.queryNearby([2, 8, 3], 1)).toEqual([]);
    expect(first.queryStations()).toEqual([created]);
    expect(first.stationAt([2, 8, 3])).toEqual(created);
    expect(first.stationAt([2, 8, 3.5])).toBeNull();
    expect(first.stationSnapshot('bench')).toEqual({
      version: 1,
      entityId: 'bench',
      revision: 0,
      kind: 'workbench',
      voxel: 41,
      grid: Array.from({ length: 9 }, () => null),
    });
    expect(second.stationAt([2, 8, 3])).toBeNull();
    expect(() => first.actorStateAccess('bench')).toThrow(/actor|inventory/i);
    expect(() =>
      new EntityStore(items).spawn({ type: 'station', position: [0, 0, 0], station: { kind: 'chest' } }),
    ).toThrow(/codec/i);
  });

  it('validates capacities, actual items, furnace state, explicit voxels and unique integer positions before mutation', () => {
    const store = new EntityStore(items, codec);
    store.spawn({ id: 'chest', type: 'station', position: [1, 2, 3], station: { kind: 'chest' } });
    const before = store.exportComponentSnapshot();
    expect(() =>
      store.spawn({ id: 'same-position', type: 'station', position: [1, 2, 3], station: { kind: 'furnace' } }),
    ).toThrow(/position|occupied/i);
    expect(() =>
      store.spawn({ id: 'fractional', type: 'station', position: [1.5, 2, 3], station: { kind: 'chest' } }),
    ).toThrow(/integer|position/i);
    expect(() => codec.decode({ ...codec.create('bad-grid', 'workbench'), grid: [] })).toThrow(/grid|9/i);
    expect(() =>
      codec.decode({
        ...codec.create('bad-item', 'chest'),
        slots: [{ itemId: 'test:missing', count: 1 }, ...Array.from({ length: 23 }, () => null)],
      }),
    ).toThrow(/item|slot/i);
    expect(() =>
      codec.decode({
        ...codec.create('bad-furnace', 'furnace'),
        furnace: { ...emptyFurnaceSnapshot(), progressSeconds: 1 },
      }),
    ).toThrow(/progress|recipe/i);
    expect(() => codec.decode({ ...codec.create('wrong-voxel', 'chest'), voxel: 43 })).toThrow(/voxel|kind/i);
    expect(store.exportComponentSnapshot()).toEqual(before);
  });

  it('retires station ids and lifetime references while allowing a new id at the released position', () => {
    const store = new EntityStore(items, codec);
    store.spawn({ id: 'old-bench', type: 'station', position: [3, 8, 3], station: { kind: 'workbench' } });
    const reference = store.createReference('old-bench')!;
    expect(store.despawn('old-bench')).toBe(true);
    expect(store.resolveReference(reference)).toBeNull();
    expect(() =>
      store.spawn({ id: 'old-bench', type: 'station', position: [3, 8, 3], station: { kind: 'workbench' } }),
    ).toThrow(/issued|retired/i);
    expect(
      store.spawn({ id: 'new-bench', type: 'station', position: [3, 8, 3], station: { kind: 'workbench' } }),
    ).toMatchObject({ id: 'new-bench' });
  });

  it('exports V2, restores V1 as empty stations, preserves lifetime across V2 and invalidates the old epoch', () => {
    const store = new EntityStore(items, codec);
    store.spawn({ id: 'player', type: 'player', position: [0, 8, 0] });
    store.spawn({ id: 'furnace', type: 'station', position: [4, 8, 0], station: { kind: 'furnace' } });
    const reference = store.createReference('furnace')!;
    const v2 = store.exportComponentSnapshot();
    expect(v2).toMatchObject({ version: 2, stations: [{ entityId: 'furnace', kind: 'furnace', voxel: 43 }] });

    store.restoreComponentSnapshot(v2);
    expect(store.resolveReference(reference)).toBeNull();
    expect(store.createReference('furnace')).toMatchObject({ entityId: 'furnace', lifetime: reference.lifetime });
    expect(store.createReference('furnace')!.epoch).toBeGreaterThan(reference.epoch);

    const current = store.exportComponentSnapshot();
    const withoutStation = {
      version: 1 as const,
      sequence: current.sequence,
      lifetimeHighWater: current.lifetimeHighWater,
      issuedIds: current.issuedIds,
      entities: current.entities.filter((entity) => entity.type !== 'station'),
      identities: current.identities.filter((identity) => identity.entityId !== 'furnace'),
      actors: current.actors,
    };
    store.restoreComponentSnapshot(withoutStation);
    expect(store.queryStations()).toEqual([]);
    expect(store.get('player')).not.toBeNull();
  });

  it('rejects non-bijective V2 identity, actor and station collections without replacing live state', () => {
    const store = new EntityStore(items, codec);
    store.spawn({ id: 'player', type: 'player', position: [0, 8, 0] });
    store.spawn({ id: 'bench', type: 'station', position: [1, 8, 0], station: { kind: 'workbench' } });
    const before = store.exportComponentSnapshot();
    const bad = structuredClone(before);
    bad.stations.push({ ...bad.stations[0]!, entityId: 'player' } as StationComponentV1);

    expect(() => store.restoreComponentSnapshot(bad)).toThrow(/station|identity|duplicate/i);
    expect(store.exportComponentSnapshot()).toEqual(before);
  });
});
