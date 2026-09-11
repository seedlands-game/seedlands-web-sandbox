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
});
