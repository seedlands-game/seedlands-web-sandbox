import { describe, expect, it } from 'vitest';
import { EcsEntityOwner, type EcsOwnedEntity } from '../../src/server/gameplay/ecs-entity-owner';
import { createItemDefinitionRegistry, ItemIds } from '../../src/server/gameplay/item-registry';

const items = createItemDefinitionRegistry([
  {
    id: ItemIds.WoodBlock,
    name: 'Test wood block',
    itemType: 'block',
    stackLimit: 64,
    capabilities: [],
  },
]);
const createOwner = () => new EcsEntityOwner(1, items);

const entity = (id: string, overrides: Partial<EcsOwnedEntity> = {}): EcsOwnedEntity => ({
  id,
  type: 'creature',
  kind: 'creature',
  lifecycle: 'active',
  position: [0, 8, 0],
  physicsVelocity: [0, 0, 0],
  health: 12,
  maxHealth: 12,
  archetype: 'grazer',
  persistent: true,
  ...overrides,
});

describe('EcsEntityOwner', () => {
  it('keeps component state and query membership isolated per world', () => {
    const first = createOwner();
    const second = createOwner();
    first.create(entity('shared', { position: [1, 8, 0] }));
    second.create(entity('shared', { position: [9, 8, 0] }));
    first.create(
      entity('drop', {
        type: 'world-item',
        kind: 'world-item',
        health: undefined,
        maxHealth: undefined,
        archetype: undefined,
        persistent: undefined,
        stack: { itemId: ItemIds.WoodBlock, count: 2 },
      }),
    );

    first.setPosition('shared', [2, 8, 0]);
    first.setStackCount('drop', 1);

    expect(first.get('shared')?.position).toEqual([2, 8, 0]);
    expect(second.get('shared')?.position).toEqual([9, 8, 0]);
    expect(first.query({ type: 'world-item' })).toEqual([
      expect.objectContaining({ id: 'drop', stack: { itemId: ItemIds.WoodBlock, count: 1 } }),
    ]);
    expect(second.query({ type: 'world-item' })).toEqual([]);
  });

  it('commits removals before allocation, invalidates old references and never reissues stable ids', () => {
    const owner = createOwner();
    owner.create(entity('old'));
    const reference = owner.createReference('old');

    expect(owner.destroy('old')).toBe(true);
    expect(() => owner.create(entity('old'))).toThrow(/issued|retired/i);

    owner.create(
      entity('replacement', {
        type: 'world-item',
        kind: 'world-item',
        health: undefined,
        maxHealth: undefined,
        archetype: undefined,
        persistent: undefined,
        stack: { itemId: ItemIds.WoodBlock, count: 1 },
      }),
    );
    expect(owner.resolveReference(reference!)).toBeNull();
    expect(owner.query().map((value) => value.id)).toEqual(['replacement']);
    expect(owner.query({ type: 'creature' })).toEqual([]);
    expect(owner.query({ type: 'world-item' })[0]).not.toHaveProperty('health');
  });

  it('returns copied projections in stable creation order after removal and replacement', () => {
    const owner = createOwner();
    owner.create(entity('first'));
    owner.create(entity('removed'));
    owner.create(entity('third'));
    owner.destroy('removed');
    owner.create(entity('fourth'));

    const result = owner.query();
    result[0]!.position[0] = 99;
    result[0]!.physicsVelocity![0] = 99;
    result[0]!.health = 0;

    expect(owner.query().map((value) => value.id)).toEqual(['first', 'third', 'fourth']);
    expect(owner.get('first')).toMatchObject({ position: [0, 8, 0], physicsVelocity: [0, 0, 0], health: 12 });
  });

  it('rejects retained actor and inventory handles after removal and slot replacement', () => {
    const owner = createOwner();
    owner.create(entity('old'));
    const actor = owner.actorStateAccess('old');
    const inventory = actor.inventory;
    owner.destroy('old');
    owner.create(entity('replacement'));
    const replacement = owner.actorStateAccess('replacement');

    expect(() => actor.mode).toThrow(/Stale actor/);
    expect(() => (actor.health = 0)).toThrow(/Stale actor/);
    expect(() => inventory.add({ itemId: ItemIds.WoodBlock, count: 1 })).toThrow(/Stale actor/);
    expect(() => owner.actorStateAccess('old')).toThrow(/Unknown/);
    expect(replacement.health).toBe(12);
    expect(replacement.inventory.slot(0)).toBeNull();
    owner.dispose();
  });

  it('rejects disposed actor handles even when another epoch restores the same id and lifetime', () => {
    const old = createOwner();
    old.create(entity('shared'));
    const reference = old.createReference('shared')!;
    const actor = old.actorStateAccess('shared');
    const inventory = actor.inventory;
    old.dispose();
    const restored = new EcsEntityOwner(2, items);
    restored.createRestored(entity('shared'), reference.lifetime);

    expect(restored.resolveReference(reference)).toBeNull();
    expect(() => actor.mode).toThrow(/Stale actor/);
    expect(() => inventory.slot(0)).toThrow(/Stale actor/);
    expect(() => old.actorStateAccess('shared')).toThrow(/disposed/);
    expect(restored.actorStateAccess('shared').health).toBe(12);
    restored.dispose();
  });

  it('keeps public lifetime projections copied while actor reads and writes remain live', () => {
    const owner = createOwner();
    owner.create(entity('actor'));
    const reference = owner.createReference('actor')!;
    const projection = owner.resolveReference(reference)!;
    const actor = owner.actorStateAccess('actor');
    projection.position[0] = 99;
    projection.health = 0;
    expect(actor.health).toBe(12);
    actor.health = 9;
    expect(owner.resolveReference(reference)).toMatchObject({ health: 9, position: [0, 8, 0] });
    expect(owner.resolveReference({ ...reference, lifetime: reference.lifetime + 1 })).toBeNull();
    expect(() => owner.actorStateAccess('missing')).toThrow();
    owner.dispose();
  });

  it('reads current component values through retained inventory handles after actor restoration', () => {
    const owner = createOwner();
    owner.create(entity('actor'));
    const first = owner.actorStateAccess('actor');
    const inventory = first.inventory;
    first.health = 8;
    first.hunger = 3;
    inventory.add({ itemId: ItemIds.WoodBlock, count: 2 });
    const second = owner.actorStateAccess('actor');
    expect(second.health).toBe(8);
    expect(second.hunger).toBe(3);
    expect(second.inventory.slot(0)?.count).toBe(2);

    const saved = owner.actorComponentSnapshot('actor');
    owner.restoreActorComponentSnapshot({
      ...saved,
      inventory: saved.inventory.map((slot, index) => (index === 0 ? { itemId: ItemIds.WoodBlock, count: 7 } : slot)),
    });
    expect(inventory.slot(0)?.count).toBe(7);
    expect(second.inventory.slot(0)?.count).toBe(7);
    expect(owner.actorStateAccess('actor').inventory.slot(0)?.count).toBe(7);
    owner.dispose();
  });
});
