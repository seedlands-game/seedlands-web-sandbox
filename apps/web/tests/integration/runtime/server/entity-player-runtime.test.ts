import { describe, expect, it } from 'vitest';
import { EntityStore } from '../../../fixtures/classic/content';
import { createPlayerState } from '../../../fixtures/classic/content';
import { ItemIds } from '../../../../../../packages/stdlib/src/server/gameplay/item-registry';

describe('entity runtime', () => {
  it('owns stable identity, lifecycle, defensive clones and spatial queries', () => {
    const entities = new EntityStore();
    const player = entities.spawn({ id: 'player-1', type: 'player', position: [0, 34, 0] });
    const item = entities.spawn({
      id: 'drop-1',
      type: 'world-item',
      position: [1, 34, 0],
      stack: { itemId: ItemIds.WoodBlock, count: 1 },
    });
    entities.spawn({ id: 'creature-1', type: 'creature', position: [40, 34, 0], health: 12, maxHealth: 12 });
    expect(entities.get('creature-1')).toMatchObject({ archetype: 'grazer' });

    player.position[0] = 999;
    item.lifecycle = 'despawned';
    expect(entities.get('player-1')?.position).toEqual([0, 34, 0]);
    expect(entities.get('drop-1')?.lifecycle).toBe('active');
    expect(
      entities
        .queryNearby([0, 34, 0], 2)
        .map((entity) => entity.id)
        .sort(),
    ).toEqual(['drop-1', 'player-1']);

    entities.move('drop-1', [35, 34, 0]);
    expect(entities.queryNearby([0, 34, 0], 2).map((entity) => entity.id)).toEqual(['player-1']);
    expect(
      entities
        .queryNearby([40, 34, 0], 6)
        .map((entity) => entity.id)
        .sort(),
    ).toEqual(['creature-1', 'drop-1']);
    expect(entities.metrics().visitedBucketCount).toBeLessThan(entities.metrics().totalBucketCount + 27);

    expect(entities.despawn('drop-1')).toBe(true);
    expect(entities.get('drop-1')).toBeNull();
  });

  it('rejects duplicate ids and invalid entity payloads without changing the store', () => {
    const entities = new EntityStore();
    entities.spawn({ id: 'player-1', type: 'player', position: [0, 34, 0] });
    expect(() => entities.spawn({ id: 'player-1', type: 'player', position: [1, 34, 0] })).toThrow(/already exists/i);
    expect(() =>
      entities.spawn({ type: 'world-item', position: [0, 0, 0], stack: { itemId: 'unknown', count: 1 } }),
    ).toThrow(/item/i);
    expect(entities.query().map((entity) => entity.id)).toEqual(['player-1']);
  });
});

describe('player state', () => {
  it('starts with canonical survival defaults and isolates inventory snapshots', () => {
    const state = createPlayerState('player-1', [0, 34, 0]);
    expect(state.snapshot()).toMatchObject({
      entityId: 'player-1',
      spawnPosition: [0, 34, 0],
      health: 20,
      maxHealth: 20,
      hunger: 20,
      maxHunger: 20,
      lifecycle: 'alive',
      selectedSlot: 0,
      hotbarSize: 8,
    });
    expect(state.snapshot().inventory).toHaveLength(24);
    state.inventory.add({ itemId: ItemIds.Berry, count: 2 });
    const snapshot = state.snapshot();
    snapshot.inventory[0]!.count = 99;
    expect(state.snapshot().inventory[0]).toEqual({ itemId: ItemIds.Berry, count: 2 });
  });

  it('only selects the eight hotbar slots', () => {
    const state = createPlayerState('player-1', [0, 34, 0]);
    expect(state.selectSlot(7)).toBe(true);
    expect(state.snapshot().selectedSlot).toBe(7);
    expect(state.selectSlot(8)).toBe(false);
    expect(state.snapshot().selectedSlot).toBe(7);
  });
});
