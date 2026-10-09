import { describe, expect, it } from 'vitest';
import { EntityStore, type EntityStoreComponentSnapshotV2 } from '../../src/server/gameplay/entity-store';
import type { TransportSpawnState } from '../../src/server/gameplay/ecs-transport-state';
import { createItemDefinitionRegistry } from '../../src/server/gameplay/item-registry';
import {
  createTransportDefinitionRegistryV1,
  type TransportDefinitionRegistryV1,
} from '../../src/server/gameplay/modules/transport-model';

const definitions = (): TransportDefinitionRegistryV1 =>
  createTransportDefinitionRegistryV1([
    {
      version: 1,
      id: 'sample:route-cart',
      locomotion: { provider: 'route', providerId: 'sample:rail' },
      bodyAabb: { min: { x: -0.4, y: 0, z: -0.4 }, max: { x: 0.4, y: 0.8, z: 0.4 } },
      seatOffset: [0, 0.55, 0],
      fuelCapacity: 100,
      inventoryCapacity: 2,
      presentationId: 'sample:route-cart-model',
    },
  ]);

const createStore = (registry = definitions()): EntityStore =>
  new EntityStore(undefined, undefined, undefined, undefined, registry);

const defaultTransportState = (): TransportSpawnState => ({
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
  inventory: [null, null],
});

const spawnTransport = (store: EntityStore, overrides: Partial<TransportSpawnState> & { id?: string } = {}) => {
  const { id = 'cart', ...transportOverrides } = overrides;
  return store.spawn({
    id,
    type: 'transport',
    position: [2, 3, 4],
    physicsVelocity: [1, 0, -2],
    transport: { ...defaultTransportState(), ...transportOverrides },
  });
};

const componentSnapshot = (store: EntityStore): EntityStoreComponentSnapshotV2 => store.exportComponentSnapshot();

describe('EntityStore transport owner', () => {
  it('owns one transport component and projects pose and velocity from its ECS entity', () => {
    const store = createStore();
    const entity = spawnTransport(store);
    const reference = store.createReference(entity.id)!;
    expect(store.transportComponentSnapshot(entity.id)).toMatchObject({
      version: 1,
      entityId: entity.id,
      revision: 0,
      definitionId: 'sample:route-cart',
      yaw: 0.25,
      routeCursor: { family: 'sample:rail' },
      rider: null,
      fuel: 40,
      inventory: [null, null],
    });
    const projection = store.transportState(reference)!;
    expect(projection).toMatchObject({
      version: 2,
      reference,
      pose: { position: [2, 3, 4], yaw: 0.25 },
      velocity: [1, 0, -2],
    });
    expect(Object.isFrozen(projection.pose.position)).toBe(true);
    expect(Reflect.set(projection.pose.position, '0', 999)).toBe(false);
    const nextProjection = store.transportState(reference)!;
    expect(nextProjection.pose.position).not.toBe(projection.pose.position);
    expect(nextProjection.pose.position).toEqual([2, 3, 4]);

    store.move(entity.id, [5, 6, 7]);
    store.updateWithoutSnapshot(entity.id, { physicsVelocity: [-3, 0, 1] });
    expect(store.transportState(store.createReference(entity.id)!)).toMatchObject({
      pose: { position: [5, 6, 7], yaw: 0.25 },
      velocity: [-3, 0, 1],
    });
    expect(componentSnapshot(store).transports).toHaveLength(1);
  });

  it('rejects invalid definition, capacity, item and foreign fields without changing the owner', () => {
    const store = createStore();
    const before = structuredClone(store.exportComponentSnapshot());
    for (const invalid of [
      { definitionId: 'sample:missing' },
      { inventory: [null, null, null] },
      { inventory: [{ itemId: 'sample:unknown-cargo', count: 1 }, null] },
    ]) {
      expect(() => spawnTransport(store, invalid)).toThrow();
      expect(store.exportComponentSnapshot()).toEqual(before);
    }
    const transport = { ...defaultTransportState(), extra: { shadowOwner: true } };
    expect(() =>
      store.spawn({
        id: 'foreign-field',
        type: 'transport',
        position: [2, 3, 4],
        transport: transport as unknown as TransportSpawnState,
      }),
    ).toThrow();
    expect(store.exportComponentSnapshot()).toEqual(before);
  });

  it('restores transport metadata atomically and rejects missing, extra or duplicate components', () => {
    const store = createStore();
    spawnTransport(store);
    const valid = componentSnapshot(store);
    expect(valid.transports).toHaveLength(1);
    const stableReference = store.createReference('cart')!;
    const variants: unknown[] = [];
    const missing = structuredClone(valid) as Partial<EntityStoreComponentSnapshotV2>;
    delete missing.transports;
    variants.push(missing);
    const extra = structuredClone(valid);
    const extraTransports = extra.transports!;
    extraTransports.push({ ...extraTransports[0]!, entityId: 'player' });
    variants.push(extra);
    const duplicate = structuredClone(valid);
    duplicate.transports!.push(duplicate.transports![0]!);
    variants.push(duplicate);

    for (const invalid of variants) {
      const before = structuredClone(store.exportComponentSnapshot());
      expect(() => store.restoreComponentSnapshot(invalid)).toThrow();
      expect(store.exportComponentSnapshot()).toEqual(before);
      expect(store.resolveReference(stableReference)).not.toBeNull();
    }
  });

  it('binds each rider to a live player lifetime and rejects invalid or duplicate riders atomically', () => {
    const store = createStore();
    store.spawn({ id: 'rider', type: 'player', position: [0, 0, 0] });
    store.spawn({ id: 'non-actor', type: 'falling-block', position: [1, 0, 0] });
    const riderRef = store.createReference('rider')!;
    const nonActorRef = store.createReference('non-actor')!;
    spawnTransport(store, { rider: { entityId: riderRef.entityId, lifetime: riderRef.lifetime } });
    expect(store.transportComponentSnapshot('cart').rider).toEqual({
      entityId: riderRef.entityId,
      lifetime: riderRef.lifetime,
    });
    const first = store.transportState(store.createReference('cart')!)!;
    expect(first.rider).toEqual(riderRef);

    const before = structuredClone(store.exportComponentSnapshot());
    expect(() =>
      spawnTransport(store, {
        id: 'cart-two',
        rider: { entityId: riderRef.entityId, lifetime: riderRef.lifetime },
      }),
    ).toThrow();
    expect(() => spawnTransport(store, { id: 'bad-rider', rider: { entityId: 'missing', lifetime: 1 } })).toThrow();
    expect(() =>
      spawnTransport(store, {
        id: 'non-actor-rider',
        rider: { entityId: nonActorRef.entityId, lifetime: nonActorRef.lifetime },
      }),
    ).toThrow();
    expect(() =>
      spawnTransport(store, {
        id: 'stale-rider',
        rider: { entityId: riderRef.entityId, lifetime: riderRef.lifetime + 1 },
      }),
    ).toThrow();
    expect(store.exportComponentSnapshot()).toEqual(before);
  });

  it('invalidates old references on restore and clears transport ownership on despawn', () => {
    const store = createStore();
    spawnTransport(store);
    const oldReference = store.createReference('cart')!;
    const checkpoint = componentSnapshot(store);
    store.restoreComponentSnapshot(checkpoint);
    expect(store.transportState(oldReference)).toBeNull();
    const restoredReference = store.createReference('cart')!;
    expect(restoredReference.epoch).toBeGreaterThan(oldReference.epoch);
    expect(store.transportState(restoredReference)?.pose.position).toEqual([2, 3, 4]);

    expect(store.despawn('cart')).toBe(true);
    expect(store.transportState(restoredReference)).toBeNull();
    spawnTransport(store, { id: 'cart-recreated', yaw: 0 });
    const recreated = store.createReference('cart-recreated')!;
    expect(store.transportComponentSnapshot('cart-recreated')).toMatchObject({ revision: 0, yaw: 0 });
    expect(store.transportState(recreated)?.pose.position).toEqual([2, 3, 4]);
  });

  it('keeps default stores child-free and restores a legacy V1 entity snapshot with an empty transport owner', () => {
    const legacy = new EntityStore();
    legacy.spawn({ id: 'player', type: 'player', position: [1, 2, 3] });
    const current = legacy.exportComponentSnapshot();
    expect(current).not.toHaveProperty('transports');
    const versionOne = { ...current, version: 1 } as unknown as Record<string, unknown>;
    delete versionOne.stations;

    const configured = createStore();
    configured.restoreComponentSnapshot(versionOne);
    expect(configured.get('player')?.position).toEqual([1, 2, 3]);
    expect(componentSnapshot(configured).transports).toEqual([]);
  });

  it('rejects corrupt rider lifetimes before replacement and projects the restored current epoch', () => {
    const store = createStore();
    store.spawn({ id: 'rider', type: 'player', position: [0, 0, 0] });
    const rider = store.createReference('rider')!;
    spawnTransport(store, { rider: { entityId: rider.entityId, lifetime: rider.lifetime } });
    const before = store.exportComponentSnapshot();
    const oldCart = store.createReference('cart')!;
    const bad = structuredClone(before);
    bad.transports![0] = { ...bad.transports![0]!, rider: { entityId: 'rider', lifetime: rider.lifetime + 100 } };
    expect(() => store.restoreComponentSnapshot(bad)).toThrow(/rider|lifetime/i);
    expect(store.exportComponentSnapshot()).toEqual(before);
    expect(store.transportState(oldCart)?.rider).toEqual(rider);
    store.restoreComponentSnapshot(before);
    expect(store.transportState(oldCart)).toBeNull();
    expect(store.transportState(store.createReference('cart')!)?.rider).toEqual(store.createReference('rider'));
    for (const transports of [undefined, null]) {
      const stable = store.exportComponentSnapshot();
      expect(() => store.restoreComponentSnapshot({ ...stable, transports })).toThrow();
      expect(store.exportComponentSnapshot()).toEqual(stable);
    }
    const unconfigured = new EntityStore();
    expect(() => unconfigured.restoreComponentSnapshot(before)).toThrow(/configured/i);
    expect(unconfigured.query()).toEqual([]);
  });

  it('copies registered cargo and rejects slot overflow without reserving an entity lifetime', () => {
    const items = createItemDefinitionRegistry([
      { id: 'sample:cargo', name: 'Cargo', itemType: 'resource', stackLimit: 4, capabilities: [] },
    ]);
    const store = new EntityStore(items, undefined, undefined, undefined, definitions());
    const before = store.exportComponentSnapshot();
    expect(() => spawnTransport(store, { inventory: [{ itemId: 'sample:cargo', count: 5 }, null] })).toThrow();
    expect(store.exportComponentSnapshot()).toEqual(before);
    const cargo = { itemId: 'sample:cargo', count: 3 };
    spawnTransport(store, { inventory: [cargo, null] });
    cargo.count = 4;
    const state = store.transportComponentSnapshot('cart');
    expect(state.inventory[0]?.count).toBe(3);
    expect(Reflect.set(state.inventory[0]!, 'count', 1)).toBe(false);
    const invalid = structuredClone(store.exportComponentSnapshot());
    invalid.transports![0] = { ...invalid.transports![0]!, inventory: [{ itemId: 'sample:cargo', count: 5 }, null] };
    expect(() => store.restoreComponentSnapshot(invalid)).toThrow();
    expect(store.transportComponentSnapshot('cart').inventory[0]?.count).toBe(3);
  });
});
