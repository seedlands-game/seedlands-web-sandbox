import { describe, expect, it } from 'vitest';
import { GameplayRuntime } from '../../../fixtures/classic/content';
import { testCorePlatform } from '../../../../../../packages/stdlib/tests/support/core-platform';

function setup() {
  const gameplay = new GameplayRuntime({
    platform: testCorePlatform,
    getWorldTime: () => 0,
    getVoxel: () => 0,
    prepareVoxelEdit: () => {
      throw new Error('unexpected edit');
    },
  });
  gameplay.spawnPlayer({ id: 'alice', position: [0, 1, 0] });
  gameplay.giveItem('alice', { itemId: 'wood-block', count: 3 });
  return gameplay;
}

describe('actual gameplay inventory entity transactions', () => {
  it('keeps inventory, actor and gameplay revision when the final drop allocation cannot succeed', () => {
    const gameplay = setup();
    const exhausted = gameplay.createSnapshot();
    exhausted.entityStore.sequence = Number.MAX_SAFE_INTEGER;
    gameplay.restoreSnapshot(exhausted);
    const before = gameplay.createSnapshot();
    expect(() => gameplay.dropItem('alice', 0, 1)).toThrow(/sequence.*exhausted/i);
    expect(gameplay.createSnapshot()).toEqual(before);
  });
  it.each(['give', 'remove'] as const)(
    'rejects developer %s before changing inventory when gameplay revision is exhausted',
    (kind) => {
      const gameplay = setup();
      const exhausted = gameplay.createSnapshot();
      exhausted.revision = Number.MAX_SAFE_INTEGER;
      gameplay.restoreSnapshot(exhausted);
      const before = gameplay.createSnapshot();
      expect(() =>
        kind === 'give'
          ? gameplay.giveItem('alice', { itemId: 'wood-block', count: 1 })
          : gameplay.removeItem('alice', { itemId: 'wood-block', count: 1 }),
      ).toThrow(/revision.*exhausted/i);
      expect(gameplay.createSnapshot()).toEqual(before);
    },
  );
  it('settles the active Combat Action when developer removal changes the equipped stack', () => {
    const gameplay = setup();
    gameplay.giveItem('alice', { itemId: 'wood-sword', count: 1 });
    gameplay.selectHotbarSlot('alice', 1);
    gameplay.spawn({
      id: 'wolf',
      type: 'creature',
      position: [0, 1, 1],
      health: 20,
      maxHealth: 20,
    });
    expect(gameplay.attackEntity('alice', 'wolf').success).toBe(true);
    expect(gameplay.removeItem('alice', { itemId: 'wood-sword', count: 1 })).toEqual({ success: true });
    expect(gameplay.getCombatState('alice').active).toBeNull();
    expect(gameplay.simulation.actionForActor('alice')).toBeNull();
  });
  it('commits drop and pickup once each while preserving an unrelated entity reference', () => {
    const gameplay = setup();
    gameplay.spawnPlayer({ id: 'bob', position: [2, 1, 0] });
    const reference = gameplay.entities.createReference('bob')!;
    const revision = gameplay.gameplayRevision;
    const dropped = gameplay.dropItem('alice', 0, 1);
    expect(dropped.success).toBe(true);
    if (!dropped.success) throw new Error(dropped.reason);
    expect(gameplay.gameplayRevision).toBe(revision + 1);
    expect(gameplay.getInventory('alice').slots[0]?.count).toBe(2);
    expect(gameplay.pickupItem('alice', dropped.entity.id)).toEqual({ success: true });
    expect(gameplay.gameplayRevision).toBe(revision + 2);
    expect(gameplay.getInventory('alice').slots[0]?.count).toBe(3);
    expect(gameplay.entities.resolveReference(reference)?.id).toBe('bob');
  });
});
