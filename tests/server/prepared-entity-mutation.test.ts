import { describe, expect, it } from 'vitest';
import type { ActorComponentSnapshot } from '../../packages/game-core/src/server/gameplay/ecs-actor-components';
import {
  EntityStore,
  type EntityStoreComponentSnapshot,
} from '../../packages/game-core/src/server/gameplay/entity-store';
import { createItemDefinitionRegistry } from '../../packages/game-core/src/server/gameplay/item-registry';
import { prepareEntityMutation } from '../../packages/game-core/src/server/gameplay/prepared-entity-mutation';
import { EcsEntityOwner } from '../../packages/game-core/src/server/gameplay/ecs-entity-owner';

const items = createItemDefinitionRegistry([
  { id: 'test:berry', name: 'Berry', itemType: 'food', stackLimit: 64, capabilities: [] },
  {
    id: 'test:pick',
    name: 'Pick',
    itemType: 'tool',
    stackLimit: 1,
    durability: { max: 10 },
    capabilities: [],
  },
]);

const actorSnapshot = (store: EntityStore, id: string): ActorComponentSnapshot => {
  const snapshot = store.exportComponentSnapshot().actors.find((candidate) => candidate.entityId === id);
  if (!snapshot) throw new Error(`missing actor fixture: ${id}`);
  return snapshot;
};

const withInventory = (
  snapshot: ActorComponentSnapshot,
  first: ActorComponentSnapshot['inventory'][number],
): ActorComponentSnapshot => ({ ...snapshot, inventory: [first, ...snapshot.inventory.slice(1)] });

const populated = () => {
  const store = new EntityStore(items);
  store.spawn({ id: 'player', type: 'player', position: [0, 2, 0] });
  store.spawn({ id: 'untouched', type: 'npc', archetype: 'settler', position: [3, 2, 0] });
  store.spawn({ id: 'old-drop', type: 'world-item', position: [1, 2, 0], stack: { itemId: 'test:berry', count: 2 } });
  return store;
};

describe('prepared EntityStore mutation', () => {
  it('keeps ordinary actor restore atomic when a late player component is invalid', () => {
    const owner = new EcsEntityOwner(1, items);
    owner.create({
      id: 'player',
      type: 'player',
      kind: 'player',
      lifecycle: 'active',
      position: [0, 2, 0],
      health: 20,
      maxHealth: 20,
    });
    const before = owner.actorComponentSnapshot('player');
    const invalid: ActorComponentSnapshot = {
      ...before,
      needs: { ...before.needs, hunger: 3 },
      player: {
        ...before.player!,
        breakAction: {
          position: [0, 0, 0],
          voxel: 1,
          elapsedSeconds: -1,
          requiredSeconds: 1,
        },
      },
    };

    expect(() => owner.restoreActorComponentSnapshot(invalid)).toThrow(/break action/i);
    expect(owner.actorComponentSnapshot('player')).toEqual(before);
  });

  it('atomically installs actor health/inventory, despawn and drop batch without replacing the owner epoch', () => {
    const store = populated();
    const playerReference = store.createReference('player')!;
    const untouchedReference = store.createReference('untouched')!;
    const oldDropReference = store.createReference('old-drop')!;
    const actor = withInventory(actorSnapshot(store, 'player'), {
      itemId: 'test:pick',
      count: 1,
      instance: { durability: 7 },
    });
    const firstPosition: [number, number, number] = [4, 2, 0];
    const firstStack = { itemId: 'test:pick', count: 1, instance: { durability: 6 } };
    const prepared = prepareEntityMutation(store, {
      actors: [{ reference: playerReference, health: 8, components: actor }],
      despawns: [oldDropReference],
      spawns: [
        { position: firstPosition, stack: firstStack },
        { position: [5, 2, 0], stack: { itemId: 'test:berry', count: 3 } },
      ],
    });

    actor.inventory[0]!.instance = { durability: 1 };
    firstPosition[0] = 99;
    firstStack.instance.durability = 1;
    expect(prepared.spawnIds).toEqual(['world-item-1', 'world-item-2']);
    prepared.validate();
    const result = prepared.apply();

    expect(result.actorIds).toEqual(['player']);
    expect(result.despawnedIds).toEqual(['old-drop']);
    expect(result.spawned.map((entity) => entity.id)).toEqual(prepared.spawnIds);
    expect(store.get('player')).toMatchObject({ health: 8, maxHealth: 20 });
    expect(store.playerStateAccess('player').inventory.slot(0)).toEqual({
      itemId: 'test:pick',
      count: 1,
      instance: { durability: 7 },
    });
    expect(store.get('world-item-1')).toMatchObject({
      position: [4, 2, 0],
      stack: { itemId: 'test:pick', count: 1, instance: { durability: 6 } },
    });
    expect(store.get('old-drop')).toBeNull();
    expect(store.resolveReference(playerReference)?.id).toBe('player');
    expect(store.resolveReference(untouchedReference)?.id).toBe('untouched');
    expect(store.createReference('player')).toEqual(playerReference);
    expect(Object.isFrozen(result)).toBe(true);
    expect(() => prepared.validate()).toThrow(/used|applied/i);
    expect(() => prepared.apply()).toThrow(/used|applied/i);
  });

  it('prepares actor pose and velocity without leaking caller mutations or stale spatial buckets', () => {
    const store = populated();
    const reference = store.createReference('player')!;
    const position: [number, number, number] = [24, 2, 0];
    const velocity: [number, number, number] = [0, 0, 0];
    const prepared = prepareEntityMutation(store, {
      actors: [
        {
          reference,
          health: 20,
          components: actorSnapshot(store, 'player'),
          position,
          physicsVelocity: velocity,
        },
      ],
    });

    position[0] = 99;
    velocity[0] = 99;
    expect(store.queryNearby([0, 2, 0], 1).map(({ id }) => id)).toContain('player');
    prepared.validate();
    prepared.apply();

    expect(store.get('player')).toMatchObject({ position: [24, 2, 0], physicsVelocity: [0, 0, 0] });
    expect(store.queryNearby([0, 2, 0], 1).map(({ id }) => id)).not.toContain('player');
    expect(store.queryNearby([24, 2, 0], 1).map(({ id }) => id)).toContain('player');
    expect(store.createReference('player')).toEqual(reference);
  });

  it('rejects an invalid final actor candidate without changing earlier actors, spawns or allocator state', () => {
    const store = populated();
    const playerReference = store.createReference('player')!;
    const untouchedReference = store.createReference('untouched')!;
    const player = withInventory(actorSnapshot(store, 'player'), { itemId: 'test:berry', count: 2 });
    const invalid = withInventory(actorSnapshot(store, 'untouched'), {
      itemId: 'test:pick',
      count: 1,
      instance: { durability: 11 },
    });
    const before = store.exportComponentSnapshot();

    expect(() =>
      prepareEntityMutation(store, {
        actors: [
          { reference: playerReference, health: 12, components: player },
          { reference: untouchedReference, health: 10, components: invalid },
        ],
        spawns: [{ position: [8, 2, 0], stack: { itemId: 'test:berry', count: 1 } }],
      }),
    ).toThrow(/durability|inventory|item/i);

    expect(store.exportComponentSnapshot()).toEqual(before);
    expect(store.get('world-item-1')).toBeNull();
    expect(store.resolveReference(playerReference)?.id).toBe('player');
    expect(store.resolveReference(untouchedReference)?.id).toBe('untouched');
  });

  it('rejects exhausted allocator capacity before touching a valid actor candidate', () => {
    const store = populated();
    const exhausted = structuredClone(store.exportComponentSnapshot()) as EntityStoreComponentSnapshot;
    exhausted.lifetimeHighWater = Number.MAX_SAFE_INTEGER;
    store.restoreComponentSnapshot(exhausted);
    const reference = store.createReference('player')!;
    const actor = withInventory(actorSnapshot(store, 'player'), { itemId: 'test:berry', count: 4 });
    const before = store.exportComponentSnapshot();

    expect(() =>
      prepareEntityMutation(store, {
        actors: [{ reference, health: 6, components: actor }],
        spawns: [{ position: [8, 2, 0], stack: { itemId: 'test:berry', count: 1 } }],
      }),
    ).toThrow(/lifetime|capacity|exhausted/i);
    expect(store.exportComponentSnapshot()).toEqual(before);
    expect(store.resolveReference(reference)?.id).toBe('player');
  });

  it('rejects apply after an exact actor inventory handle mutates following validation', () => {
    const store = populated();
    const reference = store.createReference('player')!;
    const actor = withInventory(actorSnapshot(store, 'player'), { itemId: 'test:berry', count: 5 });
    const prepared = prepareEntityMutation(store, {
      actors: [{ reference, health: 9, components: actor }],
      spawns: [{ id: 'new-drop', position: [8, 2, 0], stack: { itemId: 'test:berry', count: 1 } }],
    });
    prepared.validate();
    store.playerStateAccess('player').inventory.add({ itemId: 'test:berry', count: 1 });
    const afterHandleMutation = store.exportComponentSnapshot();

    expect(() => prepared.apply()).toThrow(/stale|changed|fresh/i);
    expect(store.exportComponentSnapshot()).toEqual(afterHandleMutation);
    expect(store.get('new-drop')).toBeNull();
    expect(() => prepared.apply()).toThrow(/used|applied/i);
  });

  it('rejects a prepared participant after restore replaces its captured owner and epoch', () => {
    const store = populated();
    const reference = store.createReference('player')!;
    const actor = withInventory(actorSnapshot(store, 'player'), { itemId: 'test:berry', count: 5 });
    const before = store.exportComponentSnapshot();
    const prepared = prepareEntityMutation(store, {
      actors: [{ reference, health: 9, components: actor }],
      spawns: [{ id: 'new-drop', position: [8, 2, 0], stack: { itemId: 'test:berry', count: 1 } }],
    });
    prepared.validate();
    store.restoreComponentSnapshot(before);
    const restoredReference = store.createReference('player')!;
    const afterRestore = store.exportComponentSnapshot();

    expect(restoredReference.epoch).toBeGreaterThan(reference.epoch);
    expect(() => prepared.apply()).toThrow(/owner|epoch|stale/i);
    expect(store.exportComponentSnapshot()).toEqual(afterRestore);
    expect(store.resolveReference(restoredReference)?.id).toBe('player');
    expect(store.get('new-drop')).toBeNull();
  });

  it('rejects conflicting, retired and oversized participant identities', () => {
    const store = populated();
    const reference = store.createReference('player')!;
    expect(() =>
      prepareEntityMutation(store, {
        actors: [{ reference, health: 10, components: actorSnapshot(store, 'player') }],
        despawns: [reference],
      }),
    ).toThrow(/duplicate|conflict/i);
    store.spawn({
      id: 'retired-drop',
      type: 'world-item',
      position: [0, 0, 0],
      stack: { itemId: 'test:berry', count: 1 },
    });
    store.despawn('retired-drop');
    expect(() =>
      prepareEntityMutation(store, {
        spawns: [{ id: 'retired-drop', position: [0, 0, 0], stack: { itemId: 'test:berry', count: 1 } }],
      }),
    ).toThrow(/issued|retired/i);
    expect(() =>
      prepareEntityMutation(store, {
        spawns: Array.from({ length: 129 }, (_, index) => ({
          id: `drop-${index}`,
          position: [0, 0, 0] as const,
          stack: { itemId: 'test:berry', count: 1 },
        })),
      }),
    ).toThrow(/bound|128|entries/i);
  });

  it('requires validation before apply and rejects generated IDs after sequence exhaustion', () => {
    const store = new EntityStore(items);
    store.restore([{ id: 'player', type: 'player', position: [0, 2, 0] }], Number.MAX_SAFE_INTEGER);
    const before = store.exportComponentSnapshot();
    expect(() =>
      prepareEntityMutation(store, {
        spawns: [{ position: [1, 2, 0], stack: { itemId: 'test:berry', count: 1 } }],
      }),
    ).toThrow(/sequence|exhausted/i);
    expect(store.exportComponentSnapshot()).toEqual(before);

    const explicit = prepareEntityMutation(store, {
      spawns: [{ id: 'explicit-drop', position: [1, 2, 0], stack: { itemId: 'test:berry', count: 1 } }],
    });
    expect(() => explicit.apply()).toThrow(/validate/i);
    expect(store.get('explicit-drop')).toBeNull();
  });
});
