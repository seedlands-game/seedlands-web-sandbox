import { describe, expect, it } from 'vitest';
import type { ActorComponentSnapshot } from '../../src/server/gameplay/ecs-actor-components';
import { EntityStore } from '../../src/server/gameplay/entity-store';
import { createItemDefinitionRegistry } from '../../src/server/gameplay/item-registry';
import type { PreparedEntityMutationInput } from '../../src/server/gameplay/prepared-entity-mutation';
import type { TransportSpawnState } from '../../src/server/gameplay/ecs-transport-state';
import {
  createTransportDefinitionRegistryV1,
  type TransportComponentV1,
  type TransportDefinitionRegistryV1,
} from '../../src/server/gameplay/modules/transport-model';

const items = createItemDefinitionRegistry([
  { id: 'sample:ore', name: 'Ore', itemType: 'resource', stackLimit: 64, capabilities: [] },
  { id: 'sample:cargo', name: 'Cargo', itemType: 'resource', stackLimit: 64, capabilities: [] },
]);

const definitions = (): TransportDefinitionRegistryV1 =>
  createTransportDefinitionRegistryV1([
    {
      version: 1,
      id: 'sample:route-cart',
      locomotion: { provider: 'route', providerId: 'sample:rail' },
      bodyAabb: { min: { x: -0.4, y: 0, z: -0.4 }, max: { x: 0.4, y: 0.8, z: 0.4 } },
      seatOffset: [0, 0.55, 0],
      fuelCapacity: 100,
      inventoryCapacity: 1,
      presentationId: 'sample:route-cart-model',
    },
  ]);

const transportState = (overrides: Partial<TransportSpawnState> = {}): TransportSpawnState => ({
  definitionId: 'sample:route-cart',
  yaw: 0.25,
  routeCursor: {
    family: 'sample:rail',
    cell: [0, 0, 0],
    variant: 'sample:straight',
    entry: { side: 'west', elevation: 0 },
    exit: { side: 'east', elevation: 0 },
    progress: 0,
    segmentLength: 1,
  },
  rider: null,
  fuel: 40,
  inventory: [null],
  ...overrides,
});

const setup = () => {
  const store = new EntityStore(items, undefined, undefined, undefined, definitions());
  store.spawn({ id: 'player', type: 'player', position: [0, 2, 0] });
  store.actorStateAccess('player').inventory.add({ itemId: 'sample:ore', count: 2 });
  return store;
};

const actorConsumesOre = (store: EntityStore) => {
  const reference = store.createReference('player')!;
  const entity = store.get('player')!;
  const components = store.actorComponentSnapshot('player');
  const inventory = [...components.inventory];
  const slot = inventory.findIndex((item) => item?.itemId === 'sample:ore');
  const stack = inventory[slot];
  if (slot < 0 || !stack || stack.count < 2) throw new Error('Expected a stack of at least two ore.');
  inventory[slot] = { ...stack, count: stack.count - 1 };
  return {
    reference,
    health: entity.health!,
    components: { ...components, inventory } satisfies ActorComponentSnapshot,
  };
};

const actorNoop = (store: EntityStore) => ({
  reference: store.createReference('player')!,
  health: store.get('player')!.health!,
  components: store.actorComponentSnapshot('player'),
});

const prepare = (store: EntityStore, input: PreparedEntityMutationInput) => store.prepareMutation(input);

const prepareSeries = (store: EntityStore, segments: readonly PreparedEntityMutationInput[]) =>
  store.prepareMutationSeries(segments);

const snapshot = (store: EntityStore) => structuredClone(store.exportComponentSnapshot());

const replacementFor = (store: EntityStore, id = 'cart', overrides: Partial<TransportComponentV1> = {}) => ({
  reference: store.createReference(id)!,
  snapshot: { ...store.transportComponentSnapshot(id), ...overrides },
});

describe('prepared transport EntityStore mutation', () => {
  it('prepares without writes, then applies actor inventory consumption and one transport spawn together', () => {
    const store = setup();
    const before = snapshot(store);
    const oreBefore = store.actorComponentSnapshot('player').inventory.find((stack) => stack?.itemId === 'sample:ore')!;
    const candidate = prepare(store, {
      actors: [actorConsumesOre(store)],
      transportSpawns: [
        {
          id: 'cart',
          position: [3, 2, 1],
          physicsVelocity: [0, 0, 0],
          transport: transportState(),
        },
      ],
    });
    expect(store.exportComponentSnapshot()).toEqual(before);
    candidate.validate();
    expect(store.exportComponentSnapshot()).toEqual(before);

    const applied = candidate.apply();
    expect(applied.spawned).toHaveLength(1);
    expect(applied.spawned[0]).toMatchObject({ id: 'cart', type: 'transport', position: [3, 2, 1] });
    expect(store.createReference('cart')!.lifetime).toBeGreaterThan(before.lifetimeHighWater);
    expect(
      store
        .actorStateAccess('player')
        .inventory.snapshot()
        .find((stack) => stack?.itemId === 'sample:ore'),
    ).toEqual({ itemId: 'sample:ore', count: oreBefore.count - 1 });
    expect(store.transportComponentSnapshot('cart')).toMatchObject({ revision: 0, definitionId: 'sample:route-cart' });
    const afterApply = snapshot(store);
    expect(() => candidate.apply()).toThrow(/already used|already applied/i);
    expect(store.exportComponentSnapshot()).toEqual(afterApply);
  });

  it('rejects invalid definitions, overflow cargo, wrong component revision and duplicate ids without writes', () => {
    const invalidTransportSpawns = [
      transportState({ definitionId: 'sample:missing' }),
      transportState({ inventory: [{ itemId: 'sample:cargo', count: 65 }] }),
    ];
    for (const transport of invalidTransportSpawns) {
      const store = setup();
      const before = snapshot(store);
      expect(() =>
        prepare(store, {
          actors: [actorNoop(store)],
          transportSpawns: [{ id: 'invalid', position: [1, 2, 3], transport }],
        }),
      ).toThrow();
      expect(store.exportComponentSnapshot()).toEqual(before);
    }

    const revisionStore = setup();
    revisionStore.spawn({
      id: 'cart',
      type: 'transport',
      position: [1, 2, 3],
      transport: transportState(),
    });
    const revisionBefore = snapshot(revisionStore);
    const unchanged = replacementFor(revisionStore);
    expect(() => prepare(revisionStore, { actors: [actorNoop(revisionStore)], transports: [unchanged] })).toThrow(
      /revision|transport/i,
    );
    expect(revisionStore.exportComponentSnapshot()).toEqual(revisionBefore);

    const duplicateStore = setup();
    const duplicateBefore = snapshot(duplicateStore);
    expect(() =>
      prepare(duplicateStore, {
        spawns: [{ id: 'same-id', position: [0, 0, 0], stack: { itemId: 'sample:cargo', count: 1 } }],
        transportSpawns: [{ id: 'same-id', position: [1, 2, 3], transport: transportState() }],
      }),
    ).toThrow(/duplicate|conflict|issued/i);
    expect(duplicateStore.exportComponentSnapshot()).toEqual(duplicateBefore);
  });

  it('rejects prepared candidates after inventory, transform or epoch changes', () => {
    const inventoryStore = setup();
    inventoryStore.spawn({ id: 'cart', type: 'transport', position: [1, 2, 3], transport: transportState() });
    const inventoryCandidate = prepare(inventoryStore, {
      actors: [actorConsumesOre(inventoryStore)],
      transports: [
        {
          ...replacementFor(inventoryStore),
          snapshot: { ...inventoryStore.transportComponentSnapshot('cart'), revision: 1 },
        },
      ],
    });
    inventoryCandidate.validate();
    inventoryStore.actorStateAccess('player').inventory.add({ itemId: 'sample:ore', count: 1 });
    const afterExternalInventory = snapshot(inventoryStore);
    expect(() => inventoryCandidate.apply()).toThrow(/stale|changed/i);
    expect(inventoryStore.exportComponentSnapshot()).toEqual(afterExternalInventory);

    const transformStore = setup();
    transformStore.spawn({ id: 'cart', type: 'transport', position: [1, 2, 3], transport: transportState() });
    const transformCandidate = prepare(transformStore, {
      transports: [
        {
          ...replacementFor(transformStore),
          snapshot: { ...transformStore.transportComponentSnapshot('cart'), revision: 1, yaw: 0.75 },
          position: [4, 5, 6],
        },
      ],
    });
    transformCandidate.validate();
    transformStore.move('cart', [8, 8, 8]);
    const afterExternalMove = snapshot(transformStore);
    expect(() => transformCandidate.apply()).toThrow(/stale|changed/i);
    expect(transformStore.exportComponentSnapshot()).toEqual(afterExternalMove);

    const epochStore = setup();
    epochStore.spawn({ id: 'cart', type: 'transport', position: [1, 2, 3], transport: transportState() });
    const epochCandidate = prepare(epochStore, {
      transports: [
        {
          ...replacementFor(epochStore),
          snapshot: { ...epochStore.transportComponentSnapshot('cart'), revision: 1, yaw: 1 },
        },
      ],
    });
    epochCandidate.validate();
    epochStore.restoreComponentSnapshot(epochStore.exportComponentSnapshot());
    const afterRestore = snapshot(epochStore);
    expect(() => epochCandidate.apply()).toThrow(/stale|epoch|owner/i);
    expect(epochStore.exportComponentSnapshot()).toEqual(afterRestore);
  });

  it('shares generated ids and one sequence frontier across world-item and transport series segments', () => {
    const store = setup();
    const sequenceBefore = store.nextSequence;
    const candidate = prepareSeries(store, [
      { spawns: [{ position: [0, 1, 0], stack: { itemId: 'sample:cargo', count: 1 } }] },
      { transportSpawns: [{ position: [3, 2, 1], transport: transportState() }] },
    ]);
    const reserved = candidate.spawnIds;
    expect(reserved).toHaveLength(2);
    expect(new Set(reserved).size).toBe(2);
    candidate.validate();
    const applied = candidate.apply();
    expect(applied.spawned.map(({ id }) => id)).toEqual(reserved);
    expect(store.nextSequence).toBe(sequenceBefore + 2);
    expect(store.query({ type: 'world-item' })).toHaveLength(1);
    expect(store.query({ type: 'transport' })).toHaveLength(1);
  });

  it('copies component and spatial replacements at prepare time and advances metadata revision once', () => {
    const store = setup();
    store.spawn({ id: 'cart', type: 'transport', position: [1, 2, 3], transport: transportState() });
    const originalReference = store.createReference('cart')!;
    const current = store.transportComponentSnapshot('cart');
    const mutableInventory = [{ itemId: 'sample:cargo', count: 3 }];
    const mutablePosition: [number, number, number] = [9, 8, 7];
    const candidate = prepare(store, {
      transports: [
        {
          reference: originalReference,
          snapshot: { ...current, revision: current.revision + 1, inventory: mutableInventory },
          position: mutablePosition,
          physicsVelocity: [0, 1, 0],
        },
      ],
    });
    mutableInventory[0]!.count = 60;
    mutablePosition[0] = 100;
    candidate.validate();
    candidate.apply();

    expect(store.createReference('cart')).toEqual(originalReference);
    expect(store.get('cart')?.position).toEqual([9, 8, 7]);
    expect(store.transportComponentSnapshot('cart')).toMatchObject({
      revision: current.revision + 1,
      definitionId: current.definitionId,
      inventory: [{ itemId: 'sample:cargo', count: 3 }],
    });
    expect(store.transportState(store.createReference('cart')!)?.velocity).toEqual([0, 1, 0]);
  });

  it('requires rider unlinking in the same candidate before actor death or despawn', () => {
    const deathStore = setup();
    const playerReference = deathStore.createReference('player')!;
    deathStore.spawn({
      id: 'cart',
      type: 'transport',
      position: [1, 2, 3],
      transport: transportState({ rider: { entityId: playerReference.entityId, lifetime: playerReference.lifetime } }),
    });
    const actorComponents = deathStore.actorComponentSnapshot('player');
    const death = {
      reference: playerReference,
      health: 0,
      components: { ...actorComponents, lifecycle: 'dead' as const },
    };
    const beforeDeath = snapshot(deathStore);
    expect(() => prepare(deathStore, { actors: [death] })).toThrow(/rider|transport|actor/i);
    expect(deathStore.exportComponentSnapshot()).toEqual(beforeDeath);

    const currentTransport = deathStore.transportComponentSnapshot('cart');
    const detach = {
      reference: deathStore.createReference('cart')!,
      snapshot: { ...currentTransport, revision: currentTransport.revision + 1, rider: null },
    };
    const deathAndDetach = prepare(deathStore, { actors: [death], transports: [detach] });
    deathAndDetach.validate();
    deathAndDetach.apply();
    expect(deathStore.get('player')?.health).toBe(0);
    expect(deathStore.transportComponentSnapshot('cart').rider).toBeNull();

    const despawnStore = setup();
    const rider = despawnStore.createReference('player')!;
    despawnStore.spawn({
      id: 'cart',
      type: 'transport',
      position: [1, 2, 3],
      transport: transportState({ rider: { entityId: rider.entityId, lifetime: rider.lifetime } }),
    });
    const cart = despawnStore.createReference('cart')!;
    expect(() => prepare(despawnStore, { despawns: [rider] })).toThrow(/rider|transport|actor/i);
    const current = despawnStore.transportComponentSnapshot('cart');
    const despawnAndDetach = prepare(despawnStore, {
      despawns: [rider],
      transports: [{ reference: cart, snapshot: { ...current, revision: current.revision + 1, rider: null } }],
    });
    despawnAndDetach.validate();
    despawnAndDetach.apply();
    expect(despawnStore.get('player')).toBeNull();
    expect(despawnStore.transportComponentSnapshot('cart').rider).toBeNull();
  });
});
